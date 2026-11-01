/*
 * The queue and worker pipeline every processing node shares. Step 4 of the
 * tick (D24) runs, per node: finish workers whose time is up, remove expired
 * packets from the queue, then pull from the queue into free workers.
 * A finished worker always hands its packet off, so nothing waits except in
 * input queues and nothing can deadlock (D25). A vLLM cluster batches
 * continuously: it admits while the KV memory a request needs still fits,
 * not up to a fixed number of workers (D22).
 */

import { BoardEffect, pushBoardEffect } from '../events'
import { failPacket } from '../outcomes'
import { Loc, type GameNode, type NodeType, type Packet } from '../types'
import type { World } from '../world'

export interface PipelineBehavior {
  readonly type: NodeType
  /**
   * Models burn tokens even on a packet that expired mid-processing (D30), so they handle late
   * packets themselves. For every other node, a late finish is a timeout before complete() runs.
   */
  readonly burnsTokens: boolean
  serviceTicks(world: World, node: GameNode, p: Packet): number
  /** The work is done: change the packet and hand it off. It must leave this node. */
  complete(world: World, node: GameNode, p: Packet): void
}

/** Puts a packet in a node's input queue. False if the queue is full. */
export function enqueue(node: GameNode, p: Packet): boolean {
  if (node.queueLength >= node.queueCapacity) return false
  node.queue[(node.queueHead + node.queueLength) % node.queue.length] = p.index
  node.queueLength++
  p.loc = Loc.QUEUE
  p.nodeId = node.id
  p.edgeId = -1
  return true
}

/**
 * Whether a packet can time out where it waits or works. An agent task that has started its run
 * never does: its coordinator scores the deadline, and only max steps ends the loop (I-1).
 */
export function canExpire(p: Packet): boolean {
  return p.category !== 'AGENT_TASK' || p.loopCount === 0
}

export function finishWorkers(world: World, node: GameNode, behavior: PipelineBehavior): void {
  if (node.busy === 0) return
  for (let slot = 0; slot < node.workers.length; slot++) {
    const index = node.workers[slot]
    if (index < 0 || node.workerFinishTick[slot] > world.tick) continue
    node.workers[slot] = -1
    node.busy--
    node.processed++
    node.kvInUse -= node.workerKv[slot]
    node.workerKv[slot] = 0
    // The pool the call started on, even if the node has since moved provider (I-2).
    if (node.workerProvider[slot] >= 0) world.providers[node.workerProvider[slot]].inFlight--
    node.workerProvider[slot] = -1
    const p = world.pool.packets[index]
    p.slot = -1
    if (!behavior.burnsTokens && world.tick > p.deadlineTick && canExpire(p)) failPacket(world, p, 'TIMEOUT', node)
    else behavior.complete(world, node, p)
  }
}

/** Removes queued packets past their deadline. Runs before the pull, so dead packets never get processed (D24). */
export function expireQueue(world: World, node: GameNode): void {
  const n = node.queueLength
  if (n === 0) return
  const cap = node.queue.length
  let kept = 0
  for (let i = 0; i < n; i++) {
    const index = node.queue[(node.queueHead + i) % cap]
    const p = world.pool.packets[index]
    if (world.tick > p.deadlineTick && canExpire(p)) {
      failPacket(world, p, 'TIMEOUT', node)
      pushBoardEffect(world, BoardEffect.QUEUE_TIMEOUT, node.id)
    } else {
      node.queue[(node.queueHead + kept++) % cap] = index
    }
  }
  node.queueLength = kept
}

/** The KV memory a request holds while it runs: its whole context and its answer (D22). */
export function kvTokensOf(p: Packet): number {
  return p.newInputTokens + p.cachedPrefixTokens + p.outputTokensGenerated
}

export function pullQueue(world: World, node: GameNode, behavior: PipelineBehavior): void {
  // A vLLM node loading its weights serves nothing (J-1).
  if (node.coldUntilTick > world.tick) return
  const provider = node.providerIndex >= 0 ? world.providers[node.providerIndex] : null
  let slot = 0
  while (node.queueLength > 0 && node.busy < node.concurrency) {
    if (provider !== null && provider.inFlight >= provider.limit) return
    const index = node.queue[node.queueHead]
    const p = world.pool.packets[index]
    // First come, first served: the oldest waits until its KV fits (D22).
    const kv = node.kvBudget > 0 ? kvTokensOf(p) : 0
    if (kv > 0 && node.busy > 0 && node.kvInUse + kv > node.kvBudget) return
    while (node.workers[slot] >= 0) slot++
    node.queueHead = (node.queueHead + 1) % node.queue.length
    node.queueLength--
    node.workerKv[slot] = kv
    node.kvInUse += kv
    node.workers[slot] = index
    node.workerFinishTick[slot] = world.tick + Math.max(1, behavior.serviceTicks(world, node, p))
    node.busy++
    if (provider !== null) {
      provider.inFlight++
      node.workerProvider[slot] = node.providerIndex
    }
    p.loc = Loc.WORKER
    p.slot = slot
  }
}

export function runPipeline(world: World, node: GameNode, behavior: PipelineBehavior): void {
  finishWorkers(world, node, behavior)
  expireQueue(world, node)
  pullQueue(world, node, behavior)
}
