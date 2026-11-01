/*
 * Scheduled events (complaints now; cron runs and chaos later) and the
 * incident feed. Events sit in a preallocated binary min-heap ordered by
 * tick, then by scheduling order, so equal-tick events fire deterministically.
 */

import { ticksPerSecond } from './catalog'
import { correctToWrong, recentWrongReports } from './trust'
import type { GameNode, Incident, Severity } from './types'
import { fileVerdict } from './nodes/llmJudge'
import { addMarker, tallyTrust } from './runLog'
import type { World } from './world'

export const EventKind = { COMPLAINT: 1, JUDGE_VERDICT: 2 } as const
export type EventKindValue = (typeof EventKind)[keyof typeof EventKind]

export class EventQueue {
  private ticks: Int32Array
  private seqs: Int32Array
  private kinds: Uint8Array
  private args: Int32Array
  private count = 0
  private nextSeq = 0

  constructor(capacity: number) {
    this.ticks = new Int32Array(capacity)
    this.seqs = new Int32Array(capacity)
    this.kinds = new Uint8Array(capacity)
    this.args = new Int32Array(capacity)
  }

  get size(): number {
    return this.count
  }

  push(tick: number, kind: EventKindValue, arg: number): void {
    if (this.count === this.ticks.length) this.grow()
    let i = this.count++
    const seq = this.nextSeq++
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (!this.before(tick, seq, parent)) break
      this.copy(parent, i)
      i = parent
    }
    this.ticks[i] = tick
    this.seqs[i] = seq
    this.kinds[i] = kind
    this.args[i] = arg
  }

  /** The earliest event's tick, or Infinity when empty. */
  peekTick(): number {
    return this.count > 0 ? this.ticks[0] : Infinity
  }

  peekKind(): number {
    return this.kinds[0]
  }

  peekArg(): number {
    return this.args[0]
  }

  pop(): void {
    if (this.count === 0) return
    this.count--
    if (this.count === 0) return
    const last = this.count
    const tick = this.ticks[last]
    const seq = this.seqs[last]
    const kind = this.kinds[last]
    const arg = this.args[last]
    let i = 0
    for (;;) {
      const left = 2 * i + 1
      if (left >= this.count) break
      const right = left + 1
      const child = right < this.count && this.lessAt(right, left) ? right : left
      if (!this.lessThan(child, tick, seq)) break
      this.copy(child, i)
      i = child
    }
    this.ticks[i] = tick
    this.seqs[i] = seq
    this.kinds[i] = kind
    this.args[i] = arg
  }

  private before(tick: number, seq: number, at: number): boolean {
    return tick < this.ticks[at] || (tick === this.ticks[at] && seq < this.seqs[at])
  }

  private lessAt(a: number, b: number): boolean {
    return this.ticks[a] < this.ticks[b] || (this.ticks[a] === this.ticks[b] && this.seqs[a] < this.seqs[b])
  }

  private lessThan(at: number, tick: number, seq: number): boolean {
    return this.ticks[at] < tick || (this.ticks[at] === tick && this.seqs[at] < seq)
  }

  private copy(from: number, to: number): void {
    this.ticks[to] = this.ticks[from]
    this.seqs[to] = this.seqs[from]
    this.kinds[to] = this.kinds[from]
    this.args[to] = this.args[from]
  }

  private grow(): void {
    const size = this.ticks.length * 2
    const ticks = new Int32Array(size)
    const seqs = new Int32Array(size)
    const kinds = new Uint8Array(size)
    const args = new Int32Array(size)
    ticks.set(this.ticks)
    seqs.set(this.seqs)
    kinds.set(this.kinds)
    args.set(this.args)
    this.ticks = ticks
    this.seqs = seqs
    this.kinds = kinds
    this.args = args
  }
}

// ---------------------------------------------------------------------------
// Complaints (D10)
// ---------------------------------------------------------------------------

/** A wrong answer just reached users. They'll complain 5 to 15 seconds from now. */
export function scheduleComplaint(world: World, usersOutId: number): void {
  const delay = world.catalog.trust.complaintDelaySec
  const ticks = Math.round(world.rng.complaints.uniform(delay.min, delay.max) * ticksPerSecond(world.catalog))
  world.events.push(world.tick + ticks, EventKind.COMPLAINT, usersOutId)
}

/** Step 5 of the tick (D24). */
export function fireEvents(world: World): void {
  const queue = world.events
  while (queue.peekTick() <= world.tick) {
    const kind = queue.peekKind()
    const arg = queue.peekArg()
    queue.pop()
    if (kind === EventKind.COMPLAINT) fileComplaint(world, arg)
    else if (kind === EventKind.JUDGE_VERDICT) fileVerdict(world, arg)
  }
}

function fileComplaint(world: World, usersOutId: number): void {
  world.stats.complaints++
  if (world.stats.complaints === 1) addMarker(world, 'FIRST_COMPLAINT', 'first wrong answer reported')
  correctToWrong(world)
  tallyTrust(world, 'WRONG_REPORTED')
  pushBoardEffect(world, BoardEffect.COMPLAINT, usersOutId)
  // Complaints never name the node that caused them (D10).
  if (world.tick < world.complaintIncidentReadyTick) return
  world.complaintIncidentReadyTick = world.tick + incidentCooldownTicks(world)
  const recent = recentWrongReports(world.trust)
  const text =
    recent <= 1 ? 'Users reported a wrong answer.' : `Users reported ${recent} wrong answers in the last 30 seconds.`
  pushIncident(world, 'alarm', text, usersOutId)
}

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

export const INCIDENT_LOG_SIZE = 50

/** Per-node incident kinds, each with its own cooldown. */
export const NodeIncident = { QUEUE_FULL: 0, TIMEOUT: 1, NO_ROUTE: 2, BROKEN_ANSWER: 3, BREACH: 4, GAVE_UP: 5, RUNAWAY: 6, BREAKER: 7, PROVIDER_ERROR: 8, JUDGE: 9 } as const
export const NODE_INCIDENT_KINDS = 10
export type NodeIncidentKind = (typeof NodeIncident)[keyof typeof NodeIncident]

export interface IncidentLog {
  readonly entries: Incident[]
  /** Total incidents ever pushed; entries keeps the newest INCIDENT_LOG_SIZE. */
  total: number
}

export function createIncidentLog(): IncidentLog {
  return { entries: [], total: 0 }
}

export function incidentCooldownTicks(world: World): number {
  return Math.round(world.catalog.incidentCooldownSec * ticksPerSecond(world.catalog))
}

export function pushIncident(world: World, severity: Severity, text: string, nodeId: number | null): void {
  const log = world.incidents
  if (log.entries.length === INCIDENT_LOG_SIZE) log.entries.shift()
  log.entries.push({ tick: world.tick, severity, text, nodeId })
  log.total++
}

/** True if this node may raise this kind of incident now, and starts its cooldown if so. */
export function claimNodeIncident(world: World, node: GameNode, kind: NodeIncidentKind): boolean {
  if (world.tick < node.incidentReadyTick[kind]) return false
  node.incidentReadyTick[kind] = world.tick + incidentCooldownTicks(world)
  return true
}

// ---------------------------------------------------------------------------
// Board effects: what just happened where, for the board's badges and flashes
// ---------------------------------------------------------------------------

/**
 * Only things the player can see happen: a queued prompt timing out, a cache hit (right or
 * wrong, they look the same), a complaint landing at Users out, a full queue dropping an
 * arrival, a code sandbox containing an injection (its inner cube glows, D20), and a complex answer's revenue landing (a wrong one pays the same, D10). Never a
 * hidden wrong answer.
 */
export const BoardEffect = { QUEUE_TIMEOUT: 1, CACHE_HIT: 2, COMPLAINT: 3, QUEUE_FULL: 4, REVENUE: 5, ATTACK_BLOCKED: 6, TAINT_CONTAINED: 7 } as const
export type BoardEffectKind = (typeof BoardEffect)[keyof typeof BoardEffect]

export const BOARD_EFFECTS_SIZE = 128

/** A preallocated ring of the newest BOARD_EFFECTS_SIZE effects. Entry i lives at i % size. */
export interface BoardEffects {
  readonly ticks: Int32Array
  readonly kinds: Uint8Array
  readonly nodeIds: Int32Array
  /** Dollars, for REVENUE; 0 for everything else. */
  readonly amounts: Float32Array
  /** Effects ever pushed. A reader remembers the total it has seen and reads from there. */
  total: number
}

export function createBoardEffects(): BoardEffects {
  return {
    ticks: new Int32Array(BOARD_EFFECTS_SIZE),
    kinds: new Uint8Array(BOARD_EFFECTS_SIZE),
    nodeIds: new Int32Array(BOARD_EFFECTS_SIZE),
    amounts: new Float32Array(BOARD_EFFECTS_SIZE),
    total: 0,
  }
}

export function pushBoardEffect(world: World, kind: BoardEffectKind, nodeId: number, amount = 0): void {
  const fx = world.effects
  const i = fx.total % BOARD_EFFECTS_SIZE
  fx.ticks[i] = world.tick
  fx.kinds[i] = kind
  fx.nodeIds[i] = nodeId
  fx.amounts[i] = amount
  fx.total++
}
