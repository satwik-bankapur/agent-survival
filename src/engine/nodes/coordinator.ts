/*
 * LangGraph coordinator (spec v1 §5.2, D26–D28). It admits agent tasks up to
 * its runs-in-flight cap; the rest wait in a bounded admission queue, and
 * overflow is throttled. A run has one call out at a time, to a model or a
 * tool, over two-lane links. Every return is routed the moment it arrives, so
 * a return never waits and can't be dropped. Only max steps ends a loop: at
 * the deadline the user leaves (one timeout), but the run keeps burning
 * tokens until max steps stops it (I-1).
 */

import { ticksPerSecond, type ModelSpec } from '../catalog'
import { available } from '../breaker'
import { degrade, forward, forwardToModel, hasLinkTo, leastLoadedEdge, sendOnEdge } from '../EdgeRouter'
import { BoardEffect, claimNodeIncident, NodeIncident, pushBoardEffect, pushIncident } from '../events'
import { endRun, failPacket, releasePacket, scoreLateRun } from '../outcomes'
import { tallyTrust } from '../runLog'
import { recordOutcome } from '../trust'
import { AgentStep, Tool, type AgentStepValue, type Edge, type GameNode, type Packet } from '../types'
import type { World } from '../world'
import { agentWrongRate } from './model'
import { enqueue, expireQueue } from './pipeline'

/** The tool an unstuck run calls next: search first, then code (D19). */
export function nextTool(p: Packet): number {
  if (p.completedToolSteps === 0 && (p.toolPlan & Tool.SEARCH) !== 0) return Tool.SEARCH
  return Tool.CODE
}

/** A stuck run keeps calling the tool it's on, or its last one. */
function stuckTool(p: Packet): number {
  if (p.completedToolSteps < p.requiredToolSteps) return nextTool(p)
  return (p.toolPlan & Tool.CODE) !== 0 ? Tool.CODE : Tool.SEARCH
}

function callStep(tool: number): AgentStepValue {
  return tool === Tool.SEARCH ? AgentStep.CALL_SEARCH : AgentStep.CALL_CODE
}

function edgeTo(world: World, from: GameNode, to: number): Edge | undefined {
  for (let i = 0; i < from.outEdges.length; i++) {
    const edge = world.edgeById[from.outEdges[i]]
    if (edge !== undefined && edge.to === to) return edge
  }
  return undefined
}

/** A model or tool hands a run back along its return lane. */
export function returnToCoordinator(world: World, from: GameNode, p: Packet): void {
  const edge = edgeTo(world, from, p.coordinatorId)
  if (edge === undefined) failPacket(world, p, 'NO_ROUTE', from)
  else sendOnEdge(world, edge, p)
}

/**
 * After a model pass in a run (D6): the input becomes cached prefix, the output becomes the next
 * input, and the model either calls a tool, fumbles the call, or answers.
 */
export function afterAgentPass(world: World, model: GameNode, spec: ModelSpec, p: Packet): void {
  p.cachedPrefixTokens += p.newInputTokens
  p.newInputTokens = p.outputTokensGenerated
  if (p.stuck) {
    p.agentStep = callStep(stuckTool(p))
  } else if (p.completedToolSteps < p.requiredToolSteps) {
    if (world.rng.rolls.chance(spec.toolFailRate)) {
      p.newInputTokens += world.catalog.traffic.agent.failedCallTokens
      p.agentStep = AgentStep.NEXT_MODEL
    } else {
      p.agentStep = callStep(nextTool(p))
    }
  } else {
    p.isHallucinated = world.rng.rolls.chance(agentWrongRate(spec, p.loopCount)) || p.fabricated
    p.agentStep = AgentStep.DONE
  }
  returnToCoordinator(world, model, p)
}

/** A packet arrives at a coordinator: a return is routed now (D26); a new task joins the admission queue. */
export function deliverToCoordinator(world: World, node: GameNode, p: Packet): void {
  if (p.coordinatorId === node.id) {
    routeRun(world, node, p)
    return
  }
  if (enqueue(node, p)) return
  if (p.category !== 'AGENT_TASK') {
    failPacket(world, p, 'QUEUE_FULL', node)
    return
  }
  // Overflow is throttled, not failed (D26).
  world.stats.throttled++
  node.lastQueueFullTick = world.tick
  recordOutcome(world, 'THROTTLED')
  tallyTrust(world, 'THROTTLED_AGENT')
  if (claimNodeIncident(world, node, NodeIncident.QUEUE_FULL)) {
    pushIncident(world, 'warn', `${node.label} is at its run limit. New agent tasks are turned away.`, node.id)
  }
  releasePacket(world, p)
}

/** Step 4 of the tick for a coordinator: expire waiting tasks, then admit while runs are free. */
export function runCoordinator(world: World, node: GameNode): void {
  expireQueue(world, node)
  const packets = world.pool.packets
  while (node.queueLength > 0) {
    const p = packets[node.queue[node.queueHead]]
    if (p.category === 'AGENT_TASK' && node.busy >= node.concurrency) break
    node.queueHead = (node.queueHead + 1) % node.queue.length
    node.queueLength--
    node.processed++
    if (p.category !== 'AGENT_TASK') {
      // Not a run: it passes through to a model like any prompt.
      forwardToModel(world, node, p, 'MODEL')
      continue
    }
    node.busy++
    p.coordinatorId = node.id
    world.stats.agentRuns++
    routeRun(world, node, p)
  }
}

/** Spec v1's four rules, with the late-user and runaway checks in front. */
function routeRun(world: World, node: GameNode, p: Packet): void {
  if (!p.lateScored && world.tick > p.deadlineTick) scoreLateRun(world, p, node)
  if (!p.runaway && p.loopCount > world.catalog.traffic.agent.runawayLoops) markRunaway(world, node, p)
  // 4. Done.
  if (p.agentStep === AgentStep.DONE) {
    finishRun(world, node, p)
    return
  }
  // 1. The loop breaker.
  if (node.maxSteps > 0 && p.loopCount >= node.maxSteps) {
    breakRun(world, node, p)
    return
  }
  // 3. A tool call: to a linked tool, or the model invents the result (D19).
  if (p.agentStep === AgentStep.CALL_SEARCH || p.agentStep === AgentStep.CALL_CODE) {
    const code = p.agentStep === AgentStep.CALL_CODE
    const edge = leastLoadedEdge(world, node, code ? 'MCP_CODE_SANDBOX' : 'MCP_WEB_SEARCH')
    if (edge !== undefined) {
      sendOnEdge(world, edge, p)
      return
    }
    world.stats.fabricatedTools++
    p.fabricated = true
    if (!p.stuck) p.completedToolSteps++
    // With no sandbox the model runs the code itself, injected instructions and all (D20).
    if (code && p.tainted) p.isMaliciousInjection = true
    p.agentStep = AgentStep.NEXT_MODEL
  }
  // 2. Reasoning: back to the run's model unless its queue is too full (D28).
  sendToModel(world, node, p)
}

function sendToModel(world: World, node: GameNode, p: Packet): void {
  const sticky = world.nodeById[p.cacheModelId]
  let edge: Edge | undefined
  // A run moves off its model only when that model's queue is over 80% full, or it can't take
  // traffic: an open breaker or a cold vLLM node (D28, D29).
  if (
    sticky !== undefined &&
    sticky.queueLength <= world.catalog.nodes.LANGGRAPH_COORDINATOR.stickyQueueShare * sticky.queueCapacity &&
    available(world, sticky)
  ) {
    edge = edgeTo(world, node, sticky.id)
  }
  edge ??= leastLoadedEdge(world, node, 'MODEL')
  if (edge === undefined) {
    if (!hasLinkTo(world, node, 'MODEL')) {
      failPacket(world, p, 'NO_ROUTE', node)
      return
    }
    // Every model is open or cold: the run ends with the degraded reply (D29), a failed job.
    endRun(node, p)
    degrade(world, node, p)
    return
  }
  p.passTick = world.tick
  sendOnEdge(world, edge, p)
}

/** Done: to the guardrail if linked, else to users. A run whose user already left just ends. */
function finishRun(world: World, node: GameNode, p: Packet): void {
  world.stats.agentRunsDone++
  if (p.isHallucinated) world.stats.agentWrong++
  endRun(node, p)
  if (p.lateScored) {
    releasePacket(world, p)
    return
  }
  forward(world, node, p, leastLoadedEdge(world, node, 'OUTPUT_GUARDRAIL') !== undefined ? 'OUTPUT_GUARDRAIL' : 'USERS_OUT')
}

/** Max steps hit unfinished: to human review if there is one (D21), else the run gives up (−3). */
function breakRun(world: World, node: GameNode, p: Packet): void {
  world.stats.loopBroken++
  endRun(node, p)
  const review = p.lateScored ? undefined : leastLoadedEdge(world, node, 'HITL_GATE')
  if (review === undefined) {
    failPacket(world, p, 'GAVE_UP', node)
    return
  }
  sendOnEdge(world, review, p)
}

/** A run past the runaway count: counted on the plate, and one incident with its burn rate. */
function markRunaway(world: World, node: GameNode, p: Packet): void {
  p.runaway = true
  node.longRuns++
  world.stats.runaways++
  if (!claimNodeIncident(world, node, NodeIncident.RUNAWAY)) return
  const sec = Math.max(1, world.tick - p.passTick) / ticksPerSecond(world.catalog)
  const burn = p.lastPassCost / sec
  pushIncident(
    world,
    'alarm',
    `An agent run at ${node.label} has looped ${p.loopCount} times. Its last step cost $${p.lastPassCost.toFixed(2)}, about $${burn.toFixed(2)}/s.`,
    node.id,
  )
}

/** A code sandbox contains a tool-borne injection: its inner cube glows (D20). */
export function containTaint(world: World, sandbox: GameNode): void {
  world.stats.taintContained++
  pushBoardEffect(world, BoardEffect.TAINT_CONTAINED, sandbox.id)
}
