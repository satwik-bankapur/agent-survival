/*
 * The run lifecycle: title, run, death, postmortem, retry.
 *
 * Each run gets a fresh engine, connected to the UI store, and a new run id
 * that remounts the board. When a run ends, the board grabs its final frame
 * and hands it here, and the postmortem is written from the run log (D39).
 * Retries reuse the seed: "Retry this seed" starts from the starting board,
 * so the same moves give the same run (D23); "Retry with this build" lays the
 * final board back down at 0:00, paused.
 */

import { baseSceneId, boardFor, stressCatalog, STRESS_SCENE } from './canvas/devScenes'
import {
  applyCommands,
  buildPostmortem,
  catalogFor,
  dailySeed,
  GameEngine,
  rebuildBoard,
  sandboxCatalog,
  SANDBOX,
  scenarioById,
  SEED_MASK,
  type Command,
  type LoggedCommand,
  type World,
} from './engine'
import type { ShareKind, SharedRun } from './share'
import { useRunStore, type RunConfig, type RunMode } from './store/runStore'
import { connectEngine, useUiStore } from './store/uiStore'

const RUN_COUNT_KEY = 'agent-survival.runs'

let disconnect: (() => void) | null = null

/** A fresh 24-bit seed. The UI layer may use the platform's randomness; the engine never does (D23). */
export function randomSeed(): number {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return buf[0] & SEED_MASK
}

/** Today, local time, as "YYYY-MM-DD". */
export function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function todaysSeed(): number {
  return dailySeed(today())
}

export function configFor(mode: RunMode, sandbox: RunConfig['sandbox'] = { budget: 500, traffic: 1 }): RunConfig {
  return { mode, seed: mode === 'daily' ? todaysSeed() : randomSeed(), sandbox, scene: null, at: 0 }
}

function nextRunNumber(): number {
  let n = useRunStore.getState().runNumber
  try {
    n = Math.max(n, Number.parseInt(localStorage.getItem(RUN_COUNT_KEY) ?? '0', 10) || 0)
  } catch {
    // Blocked storage: count from this page load.
  }
  n++
  try {
    localStorage.setItem(RUN_COUNT_KEY, String(n))
  } catch {
    // As above.
  }
  return n
}

function engineFor(config: RunConfig): GameEngine {
  if (config.scene === STRESS_SCENE) return new GameEngine({ seed: config.seed, catalog: stressCatalog() })
  const scenario = config.scene === null ? undefined : scenarioById(baseSceneId(config.scene))
  if (scenario !== undefined) return new GameEngine({ seed: config.seed, catalog: catalogFor(scenario) })
  if (config.mode === 'sandbox') return new GameEngine({ seed: config.seed, catalog: sandboxCatalog(config.sandbox.budget, config.sandbox.traffic) })
  return new GameEngine({ seed: config.seed })
}

/** How a run starts with a board already on it. All three start paused at 0:00. */
export interface RunStart {
  /** "Retry with this build": lay a finished run's final board down (D23). */
  readonly rebuildFrom?: World
  /** A shared build: lay these commands down. */
  readonly build?: readonly Command[]
  /** A shared run: replay this log at its own ticks, with the board read-only. */
  readonly watch?: readonly LoggedCommand[]
  /** The toast that explains the board the player is looking at. */
  readonly toast?: string
}

/** Starts a run, optionally with a board already laid down (`start`), in which case it starts paused. */
export function startRun(config: RunConfig, start: RunStart = {}): void {
  const engine = engineFor(config)
  const paused = start.rebuildFrom !== undefined || start.build !== undefined || start.watch !== undefined
  const problems =
    start.rebuildFrom !== undefined
      ? rebuildBoard(engine, start.rebuildFrom)
      : start.build !== undefined
        ? applyCommands(engine, start.build)
        : start.watch !== undefined
          ? // Whatever was laid out before the clock started is already on the board when you press play.
            applyCommands(engine, start.watch.filter((e) => e.tick === 0).map((e) => e.command))
          : []
  if (start.watch !== undefined) {
    const log = start.watch
    let next = log.findIndex((e) => e.tick > 0)
    if (next < 0) next = log.length
    // Applied where the player made them: at the start of the tick, before anything moves (replay()).
    engine.beforeTick = (e) => {
      while (next < log.length && log[next].tick === e.tickCount) e.applyNow(log[next++].command)
    }
  }
  const setup = boardFor(engine, config.scene, config.at)
  if (paused) {
    engine.paused = true
    // No tick has run since the build went down, so the snapshot still shows the empty board.
    engine.refreshSnapshot()
  }
  disconnect?.()
  // Phase cards pause the game; a sandbox has no phases to announce, a dev scene is for looking,
  // and a replay shouldn't stop for them.
  disconnect = connectEngine(engine, {
    phaseCards: config.mode !== 'sandbox' && config.scene === null && start.watch === undefined,
    watching: start.watch !== undefined,
  })
  useRunStore.setState((s) => ({
    screen: 'run',
    runId: s.runId + 1,
    runNumber: nextRunNumber(),
    config,
    setup,
    postmortem: null,
    finalBoard: null,
    shared: null,
  }))
  const ui = useUiStore.getState()
  if (problems.length > 0) ui.toast(`Part of the build couldn't be placed: ${problems[0]}`, 'alarm')
  else if (start.toast !== undefined) ui.toast(start.toast)
}

/** A sandbox budget big enough to lay a shared build down: what it cost, plus a starting budget to play with. */
function budgetFor(seed: number, commands: readonly Command[]): number {
  const headroom = 1_000_000
  const probe = new GameEngine({ seed, catalog: sandboxCatalog(headroom, 1) })
  applyCommands(probe, commands)
  return Math.ceil(headroom - probe.world.budget) + SANDBOX.budgets[0]
}

/**
 * Opens a shared link (src/share.ts): the build in a sandbox with the budget it took, or the run
 * replayed at its own ticks. Either way it starts paused at 0:00.
 */
export function startShared(kind: ShareKind, run: SharedRun): void {
  const commands = run.log.map((e) => e.command)
  if (kind === 'build') {
    const sandbox = { budget: budgetFor(run.seed, commands), traffic: 1 }
    startRun({ mode: 'sandbox', seed: run.seed, sandbox, scene: null, at: 0 }, { build: commands, toast: 'A shared build, at 0:00. Press Space to run it.' })
  } else {
    startRun({ mode: 'survival', seed: run.seed, sandbox: { budget: 500, traffic: 1 }, scene: null, at: 0 }, { watch: run.log, toast: 'Watching a shared run. Press Space to start it.' })
  }
  useRunStore.setState({ shared: { kind, seed: run.seed } })
}

/** The "Play this seed in Survival" button on a shared run: the same seed, an empty board. */
export function playSharedSeed(): void {
  const shared = useRunStore.getState().shared
  if (shared !== null) startRun({ mode: 'survival', seed: shared.seed, sandbox: { budget: 500, traffic: 1 }, scene: null, at: 0 })
}

/** The board's last frame and where each node sat in it, grabbed as the run ended. */
export interface FinalFrame {
  readonly image: string
  readonly width: number
  readonly height: number
  readonly nodeAt: ReadonlyMap<number, { readonly x: number; readonly y: number }>
}

/** The run is over: write the postmortem and show it. */
export function finishRun(engine: GameEngine, frame: FinalFrame | null): void {
  const run = useRunStore.getState()
  if (run.setup?.engine !== engine || run.screen !== 'run') return
  const postmortem = buildPostmortem(engine.world)
  const tag = postmortem.worst === null ? null : (frame?.nodeAt.get(postmortem.worst.nodeId) ?? null)
  useRunStore.setState({
    screen: 'postmortem',
    postmortem,
    finalBoard: frame === null ? null : { image: frame.image, width: frame.width, height: frame.height, tag },
  })
}

/** The player ends the run from the menu. Logged as a command, so a replay ends there too. */
export function endRun(): void {
  useUiStore.getState().dispatch({ type: 'endRun' })
}

export function retrySeed(): void {
  const config = useRunStore.getState().config
  if (config !== null) startRun({ ...config, at: 0 })
}

export function retryWithBuild(): void {
  const { config, setup } = useRunStore.getState()
  if (config !== null && setup !== null) startRun({ ...config, scene: null, at: 0 }, { rebuildFrom: setup.engine.world, toast: 'Your build is back at 0:00. Press Space to start.' })
}

export function toTitle(): void {
  disconnect?.()
  disconnect = null
  useRunStore.setState({ screen: 'title', setup: null, postmortem: null, finalBoard: null, shared: null })
}
