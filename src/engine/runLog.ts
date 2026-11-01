/*
 * The run log: what the postmortem reads once the run is over (D39).
 *
 *   samples   budget and trust at the start of every second, preallocated
 *   markers   rare moments worth a line on the timeline: a node placed, the
 *             first wrong answer users reported, trust going critical
 *   tallies   ground truth per node, kept after a node is demolished: what
 *             each model answered and got wrong, what timed out or dropped where
 *
 * This is ground truth. Nothing here reaches the snapshot or the board during
 * play (D11); only the postmortem reads it, after the run.
 */

import { ticksPerSecond } from './catalog'
import { trustValue } from './trust'
import { NODE_TYPES, type FailureReason, type GameNode, type NodeType, type Packet } from './types'
import type { World } from './world'

/** An hour of per-second samples. Longer sandbox runs stop sampling there. */
export const RUN_LOG_SECONDS = 3600

export type RunMarkerKind = 'PLACED' | 'FIRST_COMPLAINT' | 'TRUST_CRITICAL' | 'EVENT'

export interface RunMarker {
  readonly tick: number
  readonly kind: RunMarkerKind
  readonly text: string
}

export interface NodeTally {
  readonly nodeId: number
  readonly type: NodeType
  /** The node's latest label, kept after it's demolished. */
  label: string
  /** Answers this node produced (a model) or served from cache (a cache) that reached users in time. */
  simpleServed: number
  complexServed: number
  /** Of those, how many were wrong. Ground truth. */
  wrongServed: number
  revenue: number
  tokenSpend: number
  timeouts: number
  queueFullDrops: number
  noRouteDrops: number
  /** Leaked injections and PII at this model (D43), and how many of them were PII. */
  breaches: number
  piiBreaches: number
  /**
   * The failure counts (wrong served, timeouts, queue-full drops, no-route drops) as they stood
   * at the last two 30 s marks. The older one, subtracted from now, gives the last 30 to 60
   * seconds: what trust (a 30 s window, D8) was reacting to when the run ended.
   */
  readonly marks: Int32Array
}

/** Seconds between the failure-count marks. */
export const MARK_EVERY_SEC = 30
export const FAILURE_KEYS = ['wrongServed', 'timeouts', 'queueFullDrops', 'noRouteDrops', 'breaches'] as const
export type FailureKey = (typeof FAILURE_KEYS)[number]

export interface RunLog {
  readonly budget: Float32Array
  readonly trust: Float32Array
  /** Seconds sampled so far. */
  seconds: number
  readonly markers: RunMarker[]
  /** By node id; undefined for ids never used. */
  readonly tallies: (NodeTally | undefined)[]
  /** 1 for a second that began with every provider pool in use at least 95% busy (J-7). */
  readonly poolsFull: Uint8Array
  /** When a vector DB first served a question at its drift cap, or −1 (J-7). */
  driftCapTick: number
  /** Viral spikes and traffic surges, by tick (J-7). */
  readonly surges: { readonly startTick: number; readonly endTick: number }[]
  /**
   * Every trust outcome so far, by source and, for failures, by the node type it happened at
   * (`trustIndex`). Ground truth for the balance report's trust composition.
   */
  readonly trustTally: Float64Array
}

/** Where a trust outcome came from. Failures add their reason (`FAILURE_SOURCES`). */
export const TRUST_SOURCES = [
  'GOOD',
  'REFUSED',
  'REVIEWED',
  'THROTTLED_IN',
  'THROTTLED_AGENT',
  'AGENT_REFUSED',
  'BREACH',
  'WRONG_REPORTED',
  'TIMEOUT',
  'QUEUE_FULL',
  'NO_ROUTE',
  'BROKEN_JSON',
  'DEMOLISHED',
  'GAVE_UP',
  'PROVIDER_ERROR',
] as const
export type TrustSource = (typeof TRUST_SOURCES)[number]

/** Columns per source: one per node type, and a last one for none. */
export const TRUST_COLUMNS = NODE_TYPES.length + 1

export function trustIndex(source: TrustSource, nodeType: NodeType | null): number {
  return TRUST_SOURCES.indexOf(source) * TRUST_COLUMNS + (nodeType === null ? NODE_TYPES.length : NODE_TYPES.indexOf(nodeType))
}

/** Counts one trust outcome for the run log. */
export function tallyTrust(world: World, source: TrustSource | FailureReason, nodeType: NodeType | null = null): void {
  world.runLog.trustTally[trustIndex(source, nodeType)]++
}

/** A pool counts as full at this share of its limit (J-7). */
export const POOL_FULL_SHARE = 0.95

export function createRunLog(): RunLog {
  return {
    budget: new Float32Array(RUN_LOG_SECONDS),
    trust: new Float32Array(RUN_LOG_SECONDS),
    seconds: 0,
    markers: [],
    tallies: [],
    poolsFull: new Uint8Array(RUN_LOG_SECONDS),
    driftCapTick: -1,
    surges: [],
    trustTally: new Float64Array(TRUST_SOURCES.length * TRUST_COLUMNS),
  }
}

/** Called on the first tick of every second, before anything moves. */
export function sampleSecond(world: World): void {
  const log = world.runLog
  const second = world.tick / ticksPerSecond(world.catalog)
  if (second > 0 && second % MARK_EVERY_SEC === 0) {
    for (let i = 0; i < log.tallies.length; i++) {
      const t = log.tallies[i]
      if (t !== undefined) markFailures(t)
    }
  }
  if (log.seconds >= RUN_LOG_SECONDS) return
  log.budget[log.seconds] = world.budget
  log.trust[log.seconds] = trustValue(world.trust)
  log.poolsFull[log.seconds] = everyPoolFull(world) ? 1 : 0
  log.seconds++
}

/** Is every provider some node uses at least 95% busy? False with none in use. */
export function everyPoolFull(world: World): boolean {
  let used = 0
  for (let i = 0; i < world.providers.length; i++) {
    let inUse = false
    for (const node of world.nodes) if (node.type === 'FRONTIER_API' && node.providerIndex === i) inUse = true
    if (!inUse) continue
    used++
    const p = world.providers[i]
    if (p.inFlight < POOL_FULL_SHARE * p.limit) return false
  }
  return used > 0
}

export function addMarker(world: World, kind: RunMarkerKind, text: string): void {
  world.runLog.markers.push({ tick: world.tick, kind, text })
}

/** Called once per node, when it's placed. */
export function openTally(world: World, node: GameNode): void {
  world.runLog.tallies[node.id] = {
    nodeId: node.id,
    type: node.type,
    label: node.label,
    simpleServed: 0,
    complexServed: 0,
    wrongServed: 0,
    revenue: 0,
    tokenSpend: 0,
    timeouts: 0,
    queueFullDrops: 0,
    noRouteDrops: 0,
    breaches: 0,
    piiBreaches: 0,
    marks: new Int32Array(FAILURE_KEYS.length * 2),
  }
}

/** Failures since the older mark: the last 30 to 60 seconds. */
export function recentFailures(t: NodeTally, key: FailureKey): number {
  return t[key] - t.marks[FAILURE_KEYS.indexOf(key)]
}

function markFailures(t: NodeTally): void {
  const n = FAILURE_KEYS.length
  for (let k = 0; k < n; k++) {
    t.marks[k] = t.marks[n + k]
    t.marks[n + k] = t[FAILURE_KEYS[k]]
  }
}

export function tallyOf(world: World, nodeId: number): NodeTally | undefined {
  return nodeId >= 0 ? world.runLog.tallies[nodeId] : undefined
}

/** Who answered a packet: the model that wrote it, or the cache that served it. */
export function producerOf(p: Packet): number {
  if (p.producedByModelId >= 0) return p.producedByModelId
  return p.cacheHit ? p.fromNodeId : -1
}

/** An answer reached users in time: credit whoever produced it. */
export function tallyServed(world: World, p: Packet, revenue: number): void {
  const t = tallyOf(world, producerOf(p))
  if (t === undefined) return
  if (p.difficulty === 'COMPLEX') t.complexServed++
  else t.simpleServed++
  if (p.isHallucinated) t.wrongServed++
  t.revenue += revenue
}
