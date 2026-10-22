/*
 * Low-level board mutations: add and remove nodes and edges. No validation
 * or money here; commands.ts does that and then calls these.
 */

import { maxConcurrency, ticksPerSecond } from './catalog'
import { upkeepPerTick } from './economy'
import { NODE_INCIDENT_KINDS } from './events'
import { createRouteGrid, markRoute, planRoute, routeLength, routeTiles, transitTicksFor } from './grid'
import { failPacket } from './outcomes'
import { addMarker, openTally, tallyOf } from './runLog'
import { Breaker, type Edge, type GameNode, type NodeType } from './types'
import { tileIndex, type World } from './world'

/**
 * A node's label. Users in and out keep their names. Hosted models are named after their
 * provider, numbered among that provider's nodes: Frontier A, Frontier A 2, Frontier B. Every other node is its bare type name while it's the
 * only one of its type, and gets its never-reused number once there are two ("Fast SLM 1",
 * "Fast SLM 2"), so a lone node reads like the hero's "Prompt router".
 */
export function labelFor(world: World, type: NodeType, ordinal: number, ofType: number): string {
  switch (type) {
    case 'USERS_IN':
    case 'USERS_OUT':
      return world.catalog.nodes[type].name
    case 'FRONTIER_API': {
      // `ordinal` is the node's place among its provider's nodes here (relabel).
      const provider = world.providers[ofType].name
      return ordinal === 1 ? `Frontier ${provider}` : `Frontier ${provider} ${ordinal}`
    }
    default:
      return ofType > 1 ? `${world.catalog.nodes[type].name} ${ordinal}` : world.catalog.nodes[type].name
  }
}

/** Relabels every node of a type after one is added, removed, or (a Frontier node) moved to another provider. */
export function relabel(world: World, type: NodeType): void {
  if (type === 'FRONTIER_API') {
    const counts = world.providers.map(() => 0)
    for (const node of world.nodes) {
      if (node.type !== type) continue
      node.label = labelFor(world, type, ++counts[node.providerIndex], node.providerIndex)
      const tally = tallyOf(world, node.id)
      if (tally !== undefined) tally.label = node.label
    }
    return
  }
  let ofType = 0
  for (let i = 0; i < world.nodes.length; i++) if (world.nodes[i].type === type) ofType++
  for (let i = 0; i < world.nodes.length; i++) {
    const node = world.nodes[i]
    if (node.type !== type) continue
    node.label = labelFor(world, type, node.ordinal, ofType)
    const tally = tallyOf(world, node.id)
    if (tally !== undefined) tally.label = node.label
  }
}

/** A node's upkeep per minute: its type's, or for a vector DB or vLLM cluster, its tier's (D45, J-1). */
export function nodeUpkeepPerMin(world: World, node: GameNode): number {
  if (node.type === 'VECTOR_DB') return world.catalog.nodes.VECTOR_DB.tiers[node.tier - 1].upkeepPerMin
  if (node.type === 'VLLM_CLUSTER') return world.catalog.nodes.VLLM_CLUSTER.tiers[node.tier - 1].upkeepPerMin
  return world.catalog.nodes[node.type].upkeepPerMin
}

/** What a vLLM node draws, in kW, at its tier (J-1); 0 for everything else. */
export function powerDraw(world: World, node: GameNode): number {
  return node.type === 'VLLM_CLUSTER' ? world.catalog.nodes.VLLM_CLUSTER.tiers[node.tier - 1].kw : 0
}

/** Substations' total supply and vLLM's total draw, in kW. */
export function powerBalance(world: World): { supplyKw: number; drawKw: number } {
  let supplyKw = 0
  let drawKw = 0
  for (const node of world.nodes) {
    if (node.type === 'POWER_SUBSTATION') supplyKw += world.catalog.nodes.POWER_SUBSTATION.kw
    drawKw += powerDraw(world, node)
  }
  return { supplyKw, drawKw }
}

/**
 * Runs a power cable from each vLLM node, in id order, to the nearest substation with power to
 * spare (ties by id). Cables are drawn, not linked (J-1). Called whenever the board or a tier changes.
 */
export function assignPower(world: World): void {
  const spare = new Map<number, number>()
  for (const node of world.nodes) if (node.type === 'POWER_SUBSTATION') spare.set(node.id, world.catalog.nodes.POWER_SUBSTATION.kw)
  for (const node of world.nodes) {
    if (node.type !== 'VLLM_CLUSTER') continue
    const draw = powerDraw(world, node)
    let best = -1
    let bestLength = Infinity
    for (const [id, left] of spare) {
      const sub = world.nodeById[id]
      if (sub === undefined || left + 1e-9 < draw) continue
      const length = routeLength(node.x, node.y, sub.x, sub.y)
      if (length < bestLength) {
        best = id
        bestLength = length
      }
    }
    node.powerFromId = best
    if (best >= 0) spare.set(best, (spare.get(best) ?? 0) - draw)
  }
}

export function recomputeUpkeep(world: World): void {
  let perMin = 0
  for (let i = 0; i < world.nodes.length; i++) perMin += nodeUpkeepPerMin(world, world.nodes[i])
  world.upkeepPerTick = upkeepPerTick(world.catalog, perMin)
}

export function addNode(world: World, type: NodeType, x: number, y: number): GameNode {
  const spec = world.catalog.nodes[type]
  const id = world.nextNodeId++
  const ordinal = ++world.labelCounts[type]
  // Worker slots for the top tier, so a vector DB upgrade never allocates mid-run.
  const slots = maxConcurrency(world.catalog, type)
  const node: GameNode = {
    id,
    type,
    label: '',
    ordinal,
    x,
    y,
    providerIndex: type === 'FRONTIER_API' ? 0 : -1,
    workerProvider: new Int8Array(slots).fill(-1),
    outEdges: [],
    inEdges: [],
    concurrency: spec.concurrency,
    queueCapacity: spec.queueCapacity,
    queue: new Int32Array(spec.queueCapacity),
    queueHead: 0,
    queueLength: 0,
    workers: new Int32Array(slots).fill(-1),
    workerFinishTick: new Int32Array(slots),
    busy: 0,
    lookups: 0,
    spent: spec.build,
    tier: type === 'VECTOR_DB' || type === 'VLLM_CLUSTER' ? 1 : 0,
    strictness: 'BALANCED',
    throttlePerSec: 0,
    bucket: 0,
    indexedTick: world.tick,
    blocks: 0,
    maxSteps: type === 'LANGGRAPH_COORDINATOR' ? world.catalog.nodes.LANGGRAPH_COORDINATOR.maxStepsChoices[0] : 0,
    longRuns: 0,
    prefixCache: false,
    prefixCacheBought: false,
    prefixWarmUntilTick: -1,
    prefixWipedTick: -1,
    driftSurge: 0,
    kvBudget: type === 'VLLM_CLUSTER' ? world.catalog.nodes.VLLM_CLUSTER.tiers[0].kvTokens : 0,
    kvInUse: 0,
    workerKv: new Int32Array(slots),
    coldUntilTick: type === 'VLLM_CLUSTER' ? world.tick + Math.round(world.catalog.nodes.VLLM_CLUSTER.tiers[0].coldStartSec * ticksPerSecond(world.catalog)) : 0,
    powerFromId: -1,
    breakerOn: false,
    breakerBought: false,
    breakerState: Breaker.CLOSED,
    breakerUntilTick: 0,
    breakerCalls: new Uint8Array(world.catalog.breaker.window),
    breakerHead: 0,
    breakerCount: 0,
    probesSent: 0,
    probeSuccesses: 0,
    sampleRate: type === 'LLM_JUDGE' ? world.catalog.nodes.LLM_JUDGE.sampleChoices[0] : 0,
    judged: 0,
    judgedWrong: 0,
    processed: 0,
    drops: 0,
    lastQueueFullTick: -1_000_000,
    incidentReadyTick: new Int32Array(NODE_INCIDENT_KINDS),
  }
  world.nodes.push(node)
  world.nodeById[id] = node
  world.occupancy[tileIndex(world, x, y)] = id
  if (type === 'USERS_IN' && world.usersInId < 0) world.usersInId = id
  openTally(world, node)
  relabel(world, type)
  // The board a run starts with isn't news; what the player builds later is.
  if (world.tick > 0) addMarker(world, 'PLACED', `${spec.name} placed`)
  recomputeUpkeep(world)
  assignPower(world)
  planAllRoutes(world)
  return node
}

export function addEdge(world: World, from: GameNode, to: GameNode, returnLane = false): Edge {
  const edge: Edge = {
    id: world.nextEdgeId++,
    from: from.id,
    to: to.id,
    returnLane,
    route: [],
    lengthTiles: 0,
    transitTicks: 0,
    ring: new Int32Array(world.pool.size),
    head: 0,
    length: 0,
  }
  world.edges.push(edge)
  world.edgeById[edge.id] = edge
  from.outEdges.push(edge.id)
  to.inEdges.push(edge.id)
  planAllRoutes(world)
  return edge
}

/** Straight-line grid distance between an edge's two nodes. */
function spanOf(world: World, edge: Edge): number {
  const from = world.nodeById[edge.from]
  const to = world.nodeById[edge.to]
  return from === undefined || to === undefined ? 0 : routeLength(from.x, from.y, to.x, to.y)
}

/**
 * Re-plans every tube, shortest link first (ties by edge id), so each one steers around every
 * node and, where it cheaply can, avoids crossing the tubes planned before it. Short hops claim
 * the straight lines; long runs bend round them. Runs whenever a node or link is added or
 * removed. Packets already on a tube keep the transit time they entered with.
 */
export function planAllRoutes(world: World): void {
  const { cols, rows } = world.catalog.board
  const grid = createRouteGrid(cols, rows, world.occupancy)
  const order = [...world.edges].sort((a, b) => spanOf(world, a) - spanOf(world, b) || a.id - b.id)
  for (const edge of order) {
    const from = world.nodeById[edge.from]
    const to = world.nodeById[edge.to]
    if (from === undefined || to === undefined || edge.returnLane) continue
    edge.route = planRoute(grid, from, to, from.outEdges.length > 1)
    edge.lengthTiles = routeTiles(edge.route)
    edge.transitTicks = transitTicksFor(world.catalog, edge.lengthTiles)
    markRoute(grid, edge.route)
  }
  // A return lane runs back along its forward lane, in the same two-lane tube (D27, D33).
  for (const edge of world.edges) {
    if (!edge.returnLane) continue
    const forward = forwardLaneOf(world, edge)
    if (forward === undefined) continue
    edge.route = [...forward.route].reverse()
    edge.lengthTiles = forward.lengthTiles
    edge.transitTicks = forward.transitTicks
  }
}

/** The forward lane a return lane pairs with: the link from its target back to its source. */
export function forwardLaneOf(world: World, ret: Edge): Edge | undefined {
  const from = world.nodeById[ret.to]
  if (from === undefined) return undefined
  for (const id of from.outEdges) {
    const edge = world.edgeById[id]
    if (edge !== undefined && edge.to === ret.from && !edge.returnLane) return edge
  }
  return undefined
}

function removeFrom(list: number[], value: number): void {
  const i = list.indexOf(value)
  if (i >= 0) list.splice(i, 1)
}

/** Removes an edge. Packets in transit on it are lost. Returns how many. */
export function removeEdge(world: World, edge: Edge): number {
  const lost = edge.length
  for (let i = 0; i < edge.length; i++) {
    const index = edge.ring[(edge.head + i) % edge.ring.length]
    failPacket(world, world.pool.packets[index], 'DEMOLISHED', null)
  }
  edge.length = 0
  world.edges.splice(world.edges.indexOf(edge), 1)
  world.edgeById[edge.id] = undefined
  const from = world.nodeById[edge.from]
  const to = world.nodeById[edge.to]
  if (from !== undefined) removeFrom(from.outEdges, edge.id)
  if (to !== undefined) removeFrom(to.inEdges, edge.id)
  planAllRoutes(world)
  return lost
}

/** Removes a node, its edges, and every packet queued, in work, or hopping to it. Returns how many were lost. */
export function removeNode(world: World, node: GameNode): number {
  let lost = 0
  const packets = world.pool.packets

  for (let i = 0; i < node.queueLength; i++) {
    failPacket(world, packets[node.queue[(node.queueHead + i) % node.queue.length]], 'DEMOLISHED', null)
    lost++
  }
  node.queueLength = 0

  for (let slot = 0; slot < node.workers.length; slot++) {
    const index = node.workers[slot]
    if (index < 0) continue
    node.workers[slot] = -1
    node.kvInUse -= node.workerKv[slot]
    node.workerKv[slot] = 0
    if (node.workerProvider[slot] >= 0) world.providers[node.workerProvider[slot]].inFlight--
    node.workerProvider[slot] = -1
    failPacket(world, packets[index], 'DEMOLISHED', null)
    lost++
  }
  node.busy = 0

  let kept = 0
  for (let i = 0; i < world.virtualLength; i++) {
    const index = world.virtual[i]
    if (packets[index].nodeId === node.id) {
      failPacket(world, packets[index], 'DEMOLISHED', null)
      lost++
    } else {
      world.virtual[kept++] = index
    }
  }
  world.virtualLength = kept

  const edgeIds = [...node.outEdges, ...node.inEdges]
  for (const edgeId of edgeIds) {
    const edge = world.edgeById[edgeId]
    if (edge !== undefined) lost += removeEdge(world, edge)
  }

  world.nodes.splice(world.nodes.indexOf(node), 1)
  world.nodeById[node.id] = undefined
  world.occupancy[tileIndex(world, node.x, node.y)] = -1
  relabel(world, node.type)
  recomputeUpkeep(world)
  assignPower(world)
  planAllRoutes(world)
  return lost
}
