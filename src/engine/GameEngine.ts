/*
 * The engine: owns the World and runs a fixed 50 ms tick in the D24 order.
 * Tests call tick(); the canvas calls step(ms) every frame and reads alpha
 * to interpolate. The UI changes the game only through dispatch(), and every
 * applied command is logged with its tick, so seed plus log replays a run.
 */

import { DEFAULT_CATALOG, ticksPerSecond, type Catalog } from './catalog'
import { applyCommand, validateCommand } from './commands'
import { advanceTransit } from './EdgeRouter'
import { beginEconomySecond, chargeUpkeep } from './economy'
import { fireEvents, pushIncident } from './events'
import { updateDirector } from './IncidentDirector'
import { PIPELINE_BEHAVIORS, runCoordinator, runCrons } from './nodes'
import { runPipeline } from './nodes/pipeline'
import { addMarker, sampleSecond } from './runLog'
import { buildSnapshot } from './telemetry'
import { beginTrustSecond, decayTrust, trustValue, updateCritical } from './trust'
import type { Command, CommandResult, LoggedCommand, TelemetrySnapshot } from './types'
import { spawnArrivals } from './WaveDirector'
import { createWorld, type World } from './world'

/** D35: a frame's delta is clamped to this before speed applies. */
export const MAX_FRAME_MS = 250
/** D35: at most this many ticks per frame. */
export const MAX_TICKS_PER_FRAME = 40
/** The snapshot is built every this many ticks (4 Hz at 50 ms). */
export const SNAPSHOT_EVERY_TICKS = 5
/** "Spending is higher than revenue" compares this many complete seconds. */
const SPENDING_WINDOW_SEC = 10

export interface EngineOptions {
  readonly seed: number
  readonly catalog?: Catalog
}

export class GameEngine {
  readonly world: World
  /** Game speed: 1, 2 or 4 (pause with `paused`). */
  speed = 1
  paused = false
  snapshot: TelemetrySnapshot
  /** Called with every new snapshot, 4 times a second of game time. */
  onSnapshot: ((snapshot: TelemetrySnapshot) => void) | null = null
  /** Runs at the start of every tick, before queued commands. Scenarios use it to script builds. */
  beforeTick: ((engine: GameEngine) => void) | null = null

  private readonly pending: Command[] = []
  private readonly log: LoggedCommand[] = []
  private accumulatorMs = 0

  constructor(options: EngineOptions) {
    this.world = createWorld(options.seed >>> 0, options.catalog ?? DEFAULT_CATALOG)
    this.snapshot = buildSnapshot(this.world)
  }

  get tickCount(): number {
    return this.world.tick
  }

  /** How far the next tick is, from 0 to 1, for interpolating packet positions (D33). */
  get alpha(): number {
    return this.accumulatorMs / this.world.catalog.tickMs
  }

  get commandLog(): readonly LoggedCommand[] {
    return this.log
  }

  /** Validates now and queues the command for the start of the next tick. */
  dispatch(command: Command): CommandResult {
    const result = validateCommand(this.world, command)
    if (result.ok) this.pending.push(command)
    return result
  }

  /** Would this command be accepted now? Read-only: for ghosts and hover hints, which show the reason. */
  check(command: Command): CommandResult {
    return validateCommand(this.world, command)
  }

  /**
   * Rebuilds the snapshot now and hands it on. For changes made while paused, when no tick runs
   * to build one, so the HUD shows the board as it is.
   */
  refreshSnapshot(): void {
    this.snapshot = buildSnapshot(this.world)
    if (this.onSnapshot !== null) this.onSnapshot(this.snapshot)
  }

  /** Applies a command immediately, between ticks. Logged at the tick it lands before. */
  applyNow(command: Command): CommandResult {
    const result = applyCommand(this.world, command)
    if (result.ok) this.log.push({ tick: this.world.tick, command })
    return result
  }

  /** Advances by real elapsed time (D35): clamp, scale by speed, run at most 40 ticks. */
  step(elapsedMs: number): void {
    if (this.paused || this.world.gameOver !== null) return
    const tickMs = this.world.catalog.tickMs
    this.accumulatorMs += Math.min(Math.max(elapsedMs, 0), MAX_FRAME_MS) * this.speed
    let ticks = 0
    while (this.accumulatorMs >= tickMs && ticks < MAX_TICKS_PER_FRAME) {
      this.tick()
      this.accumulatorMs -= tickMs
      ticks++
    }
    // Too far behind: drop the backlog rather than spiral.
    if (this.accumulatorMs >= tickMs) this.accumulatorMs = this.accumulatorMs % tickMs
    if (this.world.gameOver !== null) this.accumulatorMs = 0
  }

  /** One 50 ms tick, in the D24 order. Does nothing once the run is over. */
  tick(): void {
    const w = this.world
    if (w.gameOver !== null) return
    const tps = ticksPerSecond(w.catalog)

    if (w.tick % tps === 0) {
      sampleSecond(w)
      beginEconomySecond(w)
      beginTrustSecond(w)
    }

    if (this.beforeTick !== null) this.beforeTick(this)

    // 1. Apply queued player commands.
    for (let i = 0; i < this.pending.length; i++) this.applyNow(this.pending[i])
    this.pending.length = 0
    if (w.gameOver !== null) {
      // The player ended the run: nothing else happens this tick.
      this.snapshot = buildSnapshot(w)
      if (this.onSnapshot !== null) this.onSnapshot(this.snapshot)
      return
    }

    // 2. Spawn arrivals from the wave director.
    spawnArrivals(w)

    // 3. Advance edges and deliver packets whose transit is done.
    advanceTransit(w)

    // 4. Per node: finish workers, expire the queue, pull into free workers.
    for (let i = 0; i < w.nodes.length; i++) {
      const node = w.nodes[i]
      const behavior = PIPELINE_BEHAVIORS[node.type]
      if (behavior !== null) runPipeline(w, node, behavior)
      else if (node.type === 'LANGGRAPH_COORDINATOR') runCoordinator(w, node)
    }

    // 5. Fire scheduled events: complaints, cron runs, the incident director.
    fireEvents(w)
    runCrons(w)
    updateDirector(w)

    // 6. Upkeep, trust decay, and both game-over rules.
    chargeUpkeep(w)
    decayTrust(w.trust)
    const trust = trustValue(w.trust)
    if (trust < w.stats.minTrust) w.stats.minTrust = trust
    if (w.tick % tps === tps - 1) this.checkSpending()
    const wasCritical = w.trust.criticalTicks > 0
    const trustOver = updateCritical(w) && !w.catalog.sandbox
    if (w.budget <= w.catalog.budget.gameOverAt && !w.catalog.sandbox) {
      w.gameOver = { cause: 'BANKRUPT', tick: w.tick }
      pushIncident(w, 'alarm', 'The budget hit −$1,000. The run is over.', null)
    } else if (trustOver) {
      w.gameOver = { cause: 'TRUST', tick: w.tick }
      pushIncident(w, 'alarm', `Trust stayed below ${w.catalog.trust.criticalBelow}% for ${w.catalog.trust.criticalSec} seconds. The run is over.`, null)
    } else if (!wasCritical && w.trust.criticalTicks > 0 && !w.catalog.sandbox) {
      addMarker(w, 'TRUST_CRITICAL', `trust below ${w.catalog.trust.criticalBelow}%`)
      pushIncident(
        w,
        'alarm',
        `Trust is below ${w.catalog.trust.criticalBelow}%. The run ends in ${w.catalog.trust.criticalSec} s unless it recovers.`,
        null,
      )
    }

    // 7. The 4 Hz snapshot.
    if (w.tick % SNAPSHOT_EVERY_TICKS === 0 || w.gameOver !== null) {
      this.snapshot = buildSnapshot(w)
      if (this.onSnapshot !== null) this.onSnapshot(this.snapshot)
    }

    w.tick++
  }

  /** Raises "Spending is higher than revenue" once each time net money turns negative. */
  private checkSpending(): void {
    const w = this.world
    const e = w.economy
    const second = Math.floor(w.tick / ticksPerSecond(w.catalog))
    let net = 0
    for (let s = second; s > second - SPENDING_WINDOW_SEC && s >= 0; s--) {
      const b = s % e.revenue.length
      net += e.revenue[b] - e.tokenSpend[b] - e.upkeep[b] - e.fines[b]
    }
    if (net < 0 && !e.spendingAboveRevenue) {
      e.spendingAboveRevenue = true
      pushIncident(w, 'warn', 'Spending is higher than revenue.', null)
    } else if (net >= 0) {
      e.spendingAboveRevenue = false
    }
  }
}

/** Runs a fresh engine through a command log, for replays. */
export function replay(seed: number, log: readonly LoggedCommand[], ticks: number, catalog?: Catalog): GameEngine {
  const engine = new GameEngine({ seed, catalog })
  let next = 0
  // Applied where the original applied them: at the start of the tick, before anything moves.
  engine.beforeTick = (e) => {
    while (next < log.length && log[next].tick === e.tickCount) e.applyNow(log[next++].command)
  }
  for (let t = 0; t < ticks; t++) engine.tick()
  engine.beforeTick = null
  return engine
}
