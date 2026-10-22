/*
 * Dev-only scene loader: `?scene=<id>` runs a scripted build from
 * src/engine/scenarios.ts, and `?scene=stress` floods a long-tubed board
 * until the whole 2,000-packet pool is in flight. `?seed=<n>` picks the seed
 * (default 1), and `?at=<sec>` starts the run that far in, for screenshots.
 * Any of them skips the title screen and lands in the run (src/run.ts).
 */

import { GameEngine, attachScenario, makeCatalog, scenarioById, type Catalog, type NodeType, type ScenarioApi } from '../engine'

export const STRESS_SCENE = 'stress'
const OPS_SUFFIX = '+ops'

/** The scenario a dev scene name stands for, without its "+ops" suffix. */
export function baseSceneId(scene: string): string {
  return scene.endsWith(OPS_SUFFIX) ? scene.slice(0, -OPS_SUFFIX.length) : scene
}

/**
 * A flood that neither game over can end. Edges have no capacity (D25), so
 * at this rate the long tubes below hold the whole 2,000-packet pool in
 * flight, where every packet is drawn.
 */
export function stressCatalog(): Catalog {
  return makeCatalog({
    traffic: {
      ratePoints: [{ sec: 0, perSec: 6000 }],
      growthPerMinAfter: 0,
      spike: null,
      mixFromSec: Infinity,
    },
    budget: { start: 1e12, gameOverAt: -1e15 },
    trust: { criticalSec: 1e9 },
  })
}

/**
 * Users in fans out over long, maximum-transit tubes to four far-apart
 * nodes, which feed a guardrail and the exit, so traffic spreads over the
 * whole mat instead of piling up at one queue.
 */
export function buildStressBoard(engine: GameEngine): void {
  const w = engine.world
  const start = w.catalog.startingBoard
  const at = (x: number, y: number) => w.occupancy[y * w.catalog.board.cols + x]
  const place = (nodeType: NodeType, x: number, y: number): number => {
    const result = engine.applyNow({ type: 'placeNode', nodeType, x, y })
    if (!result.ok || result.nodeId === undefined) throw new Error(`Stress board: ${result.ok ? 'no node id' : result.reason}`)
    return result.nodeId
  }
  const link = (from: number, to: number) => {
    const result = engine.applyNow({ type: 'link', from, to })
    if (!result.ok) throw new Error(`Stress board: ${result.reason}`)
  }
  const usersIn = at(start.usersIn.x, start.usersIn.y)
  const usersOut = at(start.usersOut.x, start.usersOut.y)
  const frontier = at(start.frontier.x, start.frontier.y)
  const cache = place('SEMANTIC_CACHE', 20, 1)
  const router = place('PROMPT_ROUTER', 20, 17)
  const slm = place('FAST_SLM', 12, 1)
  const guard = place('OUTPUT_GUARDRAIL', 12, 17)
  link(usersIn, cache)
  link(usersIn, router)
  link(usersIn, slm)
  link(cache, frontier)
  link(router, frontier)
  link(slm, guard)
  link(guard, usersOut)
}

/** Counts requests to frame the camera on the board again; the camera rig watches it. */
export interface FrameRequests {
  count: number
}

export interface BoardSetup {
  readonly engine: GameEngine
  /** The dev scene in play, or null for the plain starting board. */
  readonly scene: string | null
  /** Bumped after each scripted build step, so the camera frames what it built. */
  readonly framing: FrameRequests
}

/** Runs the engine headless up to `sec` of game time, so a screenshot can land on a moment such as the 3:30 spike. */
export function fastForward(engine: GameEngine, sec: number): void {
  const ticks = Math.round((sec * 1000) / engine.world.catalog.tickMs)
  for (let i = 0; i < ticks && engine.world.gameOver === null; i++) engine.tick()
}

/** The dev URL parameters, or null when there are none (production ignores them all). */
export interface DevParams {
  readonly seed: number | null
  readonly scene: string | null
  readonly at: number
}

export function devParamsFrom(search: string, dev: boolean): DevParams | null {
  if (!dev) return null
  const params = new URLSearchParams(search)
  const seedParam = Number.parseInt(params.get('seed') ?? '', 10)
  const atParam = Number.parseFloat(params.get('at') ?? '')
  const scene = params.get('scene')
  const seed = Number.isFinite(seedParam) ? seedParam : null
  const at = Number.isFinite(atParam) && atParam > 0 ? atParam : 0
  if (scene === null && seed === null && at === 0) return null
  return { seed, scene, at }
}

/**
 * Sets up a run's board: the stress flood, a scripted scene, or the plain starting board.
 * `?at=` then fast-forwards it headless. A stress engine needs `stressCatalog()`.
 */
export function boardFor(engine: GameEngine, scene: string | null, at: number): BoardSetup {
  const framing: FrameRequests = { count: 0 }
  let setup: BoardSetup
  if (scene === STRESS_SCENE) {
    buildStressBoard(engine)
    setup = { engine, scene: STRESS_SCENE, framing }
  } else {
    // Dev only: "<scene>+ops" adds a tracer and a judge at 0:01, so the LLMOps panels can be seen (J-3).
    const ops = scene?.endsWith(OPS_SUFFIX) === true
    const base = scene === null ? undefined : scenarioById(baseSceneId(scene))
    const scenario =
      base === undefined || !ops
        ? base
        : {
            ...base,
            steps: [
              ...base.steps,
              {
                atSec: 1,
                run: (api: ScenarioApi) => {
                  api.place('TRACER', 2, 15)
                  api.place('LLM_JUDGE', 4, 15)
                },
              },
            ].sort((a, b) => a.atSec - b.atSec),
          }
    if (scenario !== undefined) attachScenario(engine, scenario, () => framing.count++)
    else if (scene !== null) console.warn(`Unknown scene "${scene}". Showing the starting board.`)
    setup = { engine, scene: scenario === undefined ? null : (scene ?? null), framing }
  }
  if (at > 0) fastForward(engine, at)
  return setup
}
