/*
 * Moving packets between nodes (D32, D33). A node hands a finished packet to
 * an outgoing edge; edges deliver in step 3 of the tick. Cache hits and JSON
 * retries take a virtual hop instead: no wire, but the same transit rule.
 * Models are picked by class (a small model or a large one, J-1), skipping
 * any that can't take traffic: a cold vLLM node or an open breaker (D29).
 */

import { available, noteSent } from './breaker'
import { routeLength, transitTicksFor } from './grid'
import { deliverToCoordinator } from './nodes/coordinator'
import { enqueue } from './nodes/pipeline'
import { exitPacket } from './nodes/usersOut'
import { failPacket } from './outcomes'
import { Loc, type Edge, type GameNode, type NodeType, type Packet } from './types'
import type { World } from './world'

/**
 * A routing target: a node type, or a class of model. Small models take simple chat (Fast SLM,
 * a vLLM 8B); large ones take complex work (Frontier, a vLLM 70B) (J-1).
 */
export type ModelClass = 'MODEL' | 'SMALL_MODEL' | 'LARGE_MODEL'
export type Target = NodeType | ModelClass

/** Does a node count as this target? */
export function matches(node: GameNode, target: Target): boolean {
  switch (target) {
    case 'MODEL':
      return node.type === 'FAST_SLM' || node.type === 'FRONTIER_API' || node.type === 'VLLM_CLUSTER'
    case 'SMALL_MODEL':
      return node.type === 'FAST_SLM' || (node.type === 'VLLM_CLUSTER' && node.tier === 1)
    case 'LARGE_MODEL':
      return node.type === 'FRONTIER_API' || (node.type === 'VLLM_CLUSTER' && node.tier > 1)
    default:
      return node.type === target
  }
}

/**
 * (queue + busy workers) ÷ capacity (D32). Users out never fills, so its load is 0. A vLLM node
 * has no fixed capacity, so its load is its KV memory in use plus its queue, each as a share (D22).
 */
export function loadOf(node: GameNode): number {
  if (node.kvBudget > 0) return node.kvInUse / node.kvBudget + node.queueLength / node.queueCapacity
  return node.concurrency > 0 ? (node.queueLength + node.busy) / node.concurrency : 0
}

/**
 * The outgoing edge to the least-loaded target, ties broken by node id (D32). With a target, only
 * nodes it matches count; with null, any node does. Models that can't take traffic are skipped.
 */
export function leastLoadedEdge(world: World, node: GameNode, target: Target | null): Edge | undefined {
  return leastLoadedEdgeAmong(world, node, target, target)
}

/** The least-loaded outgoing edge to a node either target matches (D32). Two targets, so nothing allocates. */
export function leastLoadedEdgeAmong(world: World, node: GameNode, a: Target | null, b: Target | null): Edge | undefined {
  let best: Edge | undefined
  let bestLoad = Infinity
  let bestId = Infinity
  for (let i = 0; i < node.outEdges.length; i++) {
    const edge = world.edgeById[node.outEdges[i]]
    if (edge === undefined) continue
    const target = world.nodeById[edge.to]
    if (target === undefined || (a !== null && !matches(target, a) && (b === null || !matches(target, b)))) continue
    if (!available(world, target)) continue
    const load = loadOf(target)
    if (load < bestLoad || (load === bestLoad && target.id < bestId)) {
      best = edge
      bestLoad = load
      bestId = target.id
    }
  }
  return best
}

/** Is there a link to anything the target matches, whether or not it can take traffic now? */
export function hasLinkTo(world: World, node: GameNode, target: Target): boolean {
  for (let i = 0; i < node.outEdges.length; i++) {
    const edge = world.edgeById[node.outEdges[i]]
    const to = edge === undefined ? undefined : world.nodeById[edge.to]
    if (to !== undefined && matches(to, target)) return true
  }
  return false
}

export function sendOnEdge(world: World, edge: Edge, p: Packet): void {
  edge.ring[(edge.head + edge.length) % edge.ring.length] = p.index
  edge.length++
  p.loc = Loc.EDGE
  p.edgeId = edge.id
  p.lane = 0
  p.enterTick = world.tick
  p.transitTicks = edge.transitTicks
  p.nodeId = -1
  const target = world.nodeById[edge.to]
  if (target !== undefined) noteSent(target)
}

/**
 * Forwards to the least-loaded linked target (or to anything, with null). With nothing linked it
 * drops with "No route"; with only models that can't take traffic linked, it's the degraded reply.
 */
export function forward(world: World, node: GameNode, p: Packet, target: Target | null): void {
  const edge = leastLoadedEdge(world, node, target)
  if (edge !== undefined) sendOnEdge(world, edge, p)
  else if (target === null ? node.outEdges.length > 0 : hasLinkTo(world, node, target)) degrade(world, node, p)
  else failPacket(world, p, 'NO_ROUTE', node)
}

/** Forwards to the least-loaded linked target of either kind, or as `forward` does when there's none. */
export function forwardAmong(world: World, node: GameNode, p: Packet, a: Target, b: Target): void {
  const edge = leastLoadedEdgeAmong(world, node, a, b)
  if (edge !== undefined) sendOnEdge(world, edge, p)
  else if (hasLinkTo(world, node, a) || hasLinkTo(world, node, b)) degrade(world, node, p)
  else failPacket(world, p, 'NO_ROUTE', node)
}

/**
 * To a model of a class, or failing that any model that can still answer, or failing that the
 * degraded reply (D29, J-4).
 */
export function forwardToModel(world: World, node: GameNode, p: Packet, cls: ModelClass): void {
  const edge = leastLoadedEdge(world, node, cls) ?? (cls === 'MODEL' ? undefined : leastLoadedEdge(world, node, 'MODEL'))
  if (edge !== undefined) sendOnEdge(world, edge, p)
  else if (hasLinkTo(world, node, 'MODEL')) degrade(world, node, p)
  else failPacket(world, p, 'NO_ROUTE', node)
}

/**
 * Every model it could go to is open or cold: a canned "can't answer right now" reply, at once,
 * on a wireless hop to the nearest Users out (D29). It scores as a refusal (+0.5), and for an
 * agent task as a failed job (I-1).
 */
export function degrade(world: World, node: GameNode, p: Packet): void {
  const exit = nearestUsersOut(world, node)
  if (exit === undefined) {
    failPacket(world, p, 'NO_ROUTE', node)
    return
  }
  world.stats.degraded++
  p.refused = true
  sendVirtual(world, p, node, exit)
}

/** A hop with no wire, timed like a wire of the straight-line grid distance (Manhattan). */
export function sendVirtual(world: World, p: Packet, from: GameNode, to: GameNode): void {
  p.loc = Loc.VIRTUAL
  p.edgeId = -1
  p.nodeId = to.id
  p.fromNodeId = from.id
  p.enterTick = world.tick
  p.transitTicks = transitTicksFor(world.catalog, routeLength(from.x, from.y, to.x, to.y))
  world.virtual[world.virtualLength++] = p.index
}

/** The Users out closest to a node by route length, ties broken by id. */
export function nearestUsersOut(world: World, node: GameNode): GameNode | undefined {
  let best: GameNode | undefined
  let bestLength = Infinity
  for (let i = 0; i < world.nodes.length; i++) {
    const candidate = world.nodes[i]
    if (candidate.type !== 'USERS_OUT') continue
    const length = routeLength(node.x, node.y, candidate.x, candidate.y)
    if (length < bestLength) {
      best = candidate
      bestLength = length
    }
  }
  return best
}

/**
 * A packet arrives at a node: Users out resolves it, a coordinator routes or admits it (D26), anything
 * else queues it or drops it ("Queue full", D24).
 */
export function deliver(world: World, target: GameNode, p: Packet): void {
  if (target.type === 'USERS_OUT') exitPacket(world, target, p)
  else if (target.type === 'LANGGRAPH_COORDINATOR') deliverToCoordinator(world, target, p)
  else if (!enqueue(target, p)) failPacket(world, p, 'QUEUE_FULL', target)
}

/** Step 3 of the tick (D24): deliver every packet whose transit is done. */
export function advanceTransit(world: World): void {
  const packets = world.pool.packets
  for (let i = 0; i < world.edges.length; i++) {
    const edge = world.edges[i]
    const target = world.nodeById[edge.to]
    while (edge.length > 0) {
      const index = edge.ring[edge.head]
      const p = packets[index]
      // The packet's own transit: a reroute never moves a packet already on the tube.
      if (p.enterTick + p.transitTicks > world.tick) break
      edge.head = (edge.head + 1) % edge.ring.length
      edge.length--
      if (target === undefined) failPacket(world, p, 'NO_ROUTE', null)
      else deliver(world, target, p)
    }
  }

  let kept = 0
  const n = world.virtualLength
  for (let i = 0; i < n; i++) {
    const index = world.virtual[i]
    const p = packets[index]
    if (p.enterTick + p.transitTicks > world.tick) {
      world.virtual[kept++] = index
      continue
    }
    const target = world.nodeById[p.nodeId]
    if (target === undefined) failPacket(world, p, 'NO_ROUTE', null)
    else deliver(world, target, p)
  }
  world.virtualLength = kept
}
