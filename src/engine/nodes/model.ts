/*
 * What Fast SLM, Frontier API and the vLLM cluster share: latency, token
 * cost, breaches, and the wrong-answer and malformed-JSON rolls (D13, D16,
 * D42, D43). With prefix caching on, part of the input is read from the
 * model's cache (D5). A pass inside an agent run hands the packet back to its
 * coordinator (D6). A call on a provider in an outage fails after 2 s (J-4),
 * and every call counts toward the model's circuit breaker (D29).
 */

import { recordCall } from '../breaker'
import { msToTicks, ticksPerSecond, type Catalog, type ModelNodeType, type ModelSpec } from '../catalog'
import { forward, leastLoadedEdge } from '../EdgeRouter'
import { modelCallCost, modelLatencyMs, spendTokens } from '../economy'
import { eventActive } from '../IncidentDirector'
import { breachPacket, failPacket } from '../outcomes'
import { tallyOf } from '../runLog'
import type { Rng } from '../rng'
import type { GameNode, Packet } from '../types'
import { modelSpecOf, providerDown, type World } from '../world'
import { afterAgentPass } from './coordinator'
import type { PipelineBehavior } from './pipeline'

/** Stacked retrieval boosts: q' = q + (1 − q) × b, so they never pass 1 (D13). */
export function boostQuality(q: number, b: number): number {
  return q + (1 - q) * b
}

/** P(wrong) for a RAG question: H[model][COMPLEX] + (1 − q) × 0.6 + drift, clamped (D42). */
export function ragWrongRate(catalog: Catalog, spec: ModelSpec, q: number, drift: number): number {
  const r = catalog.rag
  return Math.min(r.maxWrong, Math.max(0, spec.wrongRate.COMPLEX + (1 - q) * r.contextWeight + drift))
}

/** P(wrong) for any packet a model answers. */
export function wrongRateFor(catalog: Catalog, spec: ModelSpec, p: Packet): number {
  return p.category === 'RAG_QUERY' ? ragWrongRate(catalog, spec, p.contextQuality, p.drift) : spec.wrongRate[p.difficulty]
}

/** Rolls the answer's hidden quality. Both rolls always happen, so the roll stream never depends on the result. */
/** An agent run's errors compound: P(wrong) = 1 − r^(model passes) (I-1). */
export function agentWrongRate(spec: ModelSpec, passes: number): number {
  return 1 - spec.stepReliability ** passes
}

export function rollAnswer(rng: Rng, catalog: Catalog, spec: ModelSpec, p: Packet): void {
  p.isHallucinated = rng.chance(wrongRateFor(catalog, spec, p))
  p.isMalformedJson = rng.chance(spec.malformedJsonRate)
}

/** A model's answer goes to a linked output guardrail if there is one, otherwise to Users out (D32). */
export function routeAnswer(world: World, node: GameNode, p: Packet): void {
  if (leastLoadedEdge(world, node, 'OUTPUT_GUARDRAIL') !== undefined) forward(world, node, p, 'OUTPUT_GUARDRAIL')
  else forward(world, node, p, 'USERS_OUT')
}

/**
 * How much of a call's input this model's prefix cache already holds (D5): the run's whole context
 * if the run's last pass was here, else the shared agent system prompt while it's still warm.
 */
export function cachedReadTokens(world: World, node: GameNode, p: Packet): number {
  if (!node.prefixCache) return 0
  // A cache invalidation since the run's last pass here wiped its context (J-4).
  if (p.cacheModelId === node.id && node.prefixWipedTick < p.cachedAtTick) return p.cachedPrefixTokens
  return p.systemPromptTokens > 0 && world.tick <= node.prefixWarmUntilTick ? p.systemPromptTokens : 0
}

export function makeModelBehavior(type: ModelNodeType): PipelineBehavior {
  return {
    type,
    burnsTokens: true,
    serviceTicks(world, node, p) {
      // A call that starts on a provider in an outage fails fast (J-4).
      p.callFails = type === 'FRONTIER_API' && providerDown(world, node.providerIndex)
      if (p.callFails) return msToTicks(world.catalog, world.catalog.director.outage.failAfterMs)
      const spec = modelSpecOf(world, node)
      const cache = node.prefixCache ? world.catalog.prefixCache : null
      let ms = modelLatencyMs(spec, p, cache, cachedReadTokens(world, node, p))
      // Continuous batching: each sequence in the batch, this one included, slows decoding (J-1).
      if (type === 'VLLM_CLUSTER') ms += (p.outputTokensGenerated * spec.msPerOutputToken * (node.busy + 1)) / world.catalog.nodes.VLLM_CLUSTER.batchSlowdownSeqs
      // A provider slowdown stretches the hosted calls that start during it (D48).
      const slow = type === 'FRONTIER_API' && eventActive(world, 'SLOWDOWN') ? world.catalog.director.slowdownMultiplier : 1
      return msToTicks(world.catalog, ms * slow)
    },
    complete(world, node, p) {
      if (p.callFails) {
        // No answer and no tokens: the provider returned an error (J-4).
        p.callFails = false
        failPacket(world, p, 'PROVIDER_ERROR', node)
        return
      }
      const spec = modelSpecOf(world, node)
      const cache = node.prefixCache ? world.catalog.prefixCache : null
      // Tokens are spent whether or not the answer is still wanted (D30).
      const cost = modelCallCost(spec, p, cache, cachedReadTokens(world, node, p))
      spendTokens(world, cost)
      if (p.category === 'AGENT_TASK') world.stats.agentTokenSpend += cost
      if (cache !== null && p.systemPromptTokens > 0) {
        node.prefixWarmUntilTick = world.tick + Math.round(cache.expirySec * ticksPerSecond(world.catalog))
      }
      const inRun = p.coordinatorId >= 0
      if (inRun) {
        p.cacheModelId = node.id
        p.cachedAtTick = world.tick
        p.lastPassCost = cost
        p.loopCount++
        // Rolled only for agent runs, so other traffic's roll stream is unchanged.
        if (p.loopCount === 1) p.stuck = world.rng.rolls.chance(spec.stuckRate)
      }
      world.stats.modelCalls++
      world.stats.tokens += p.newInputTokens + p.cachedPrefixTokens + p.outputTokensGenerated
      const tally = tallyOf(world, node.id)
      if (tally !== undefined) tally.tokenSpend += cost
      p.producedByModelId = node.id
      p.lastVisitedNodeType = type
      // The prompt has reached the model, late or not, so a breach has already happened (D43).
      // Rolled only for attacks, so chat traffic's roll stream is the same as Milestone 1's.
      if (p.isMaliciousInjection && world.rng.rolls.chance(spec.injectionBreachRate)) {
        breachPacket(world, p, node, 'INJECTION')
        return
      }
      // A tool-borne injection gets one try, on the pass that ran its code (D20).
      if (p.category === 'AGENT_TASK') p.isMaliciousInjection = false
      if (p.containsPII && spec.leaksPii) {
        breachPacket(world, p, node, 'PII')
        return
      }
      if (inRun) {
        recordCall(world, node, false)
        afterAgentPass(world, node, spec, p)
        return
      }
      if (world.tick > p.deadlineTick) {
        failPacket(world, p, 'TIMEOUT', node)
        return
      }
      recordCall(world, node, false)
      rollAnswer(world.rng.rolls, world.catalog, spec, p)
      // An agent task answered without its tools: the model invented their results (D19).
      if (p.category === 'AGENT_TASK' && p.completedToolSteps < p.requiredToolSteps) {
        p.isHallucinated = true
        if (!p.fabricated) world.stats.fabricatedTools += p.requiredToolSteps - p.completedToolSteps
        p.fabricated = true
      }
      routeAnswer(world, node, p)
    },
  }
}
