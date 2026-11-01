/*
 * The engine layer: the pure TypeScript simulation that owns all game state.
 *
 * It never imports react, three, @react-three/*, zustand, or src/canvas,
 * src/components or src/store, and it never reads a clock or calls
 * Math.random: every random draw goes through the engine's seeded RNG (D23).
 * ESLint enforces all of that; see eslint.config.js.
 */

export * from './types'
export { DEFAULT_CATALOG, SANDBOX, classicCatalog, makeCatalog, isModelType, sandboxCatalog, type Catalog, type DeepPartial } from './catalog'
export { Rng } from './rng'
export { GameEngine, replay, type EngineOptions } from './GameEngine'
export { createRouteGrid, markRoute, planRoute, routeLength, routeTiles, segmentIndex, transitTicksFor, type RouteGrid } from './grid'
export { CAN_SEND_TO, planLink, tierUpgradeCost, validateCommand, type LinkPlan } from './commands'
export { BOARD_EFFECTS_SIZE, BoardEffect, type BoardEffectKind, type BoardEffects } from './events'
export { buildSnapshot, packetView } from './telemetry'
export { trustValue } from './trust'
export { vectorDbDrift } from './nodes/retrieval'
export { dailySeed, SEED_MASK } from './seeds'
export { applyCommands, rebuildBoard } from './rebuild'
export { buildPostmortem, type Postmortem, type PostmortemAction, type PostmortemMarker } from './postmortem'
export { RUN_LOG_SECONDS, TRUST_COLUMNS, TRUST_SOURCES, type NodeTally, type RunLog, type RunMarker, type RunMarkerKind } from './runLog'
export {
  agentPassCosts,
  agentPaths,
  leakCosts,
  modelMixEconomics,
  ragPaths,
  runawayCosts,
  capacityShapes,
  judgeCosts,
  judgeSpendPerSec,
  largeModelMix,
  selfHostEconomics,
  vllmCapacity,
  vllmLatencyMs,
  type JudgeCost,
  type RequestShape,
  type SelfHostEconomics,
  type VllmCapacity,
  type AgentPathEconomics,
  type LeakCost,
  type ModelMixEconomics,
  type RagPathEconomics,
  type RunawayCost,
} from './unitEconomics'
export {
  CLASSIC_SCENARIOS,
  PHASE2_SCENARIOS,
  PHASE3_SCENARIOS,
  PHASE4_SCENARIOS,
  OUTAGE_DRILL,
  SCENARIOS,
  attachScenario,
  catalogFor,
  checkTarget,
  formatClock,
  referenceIdOf,
  runScenario,
  scenarioById,
  summarize,
  type BalanceTarget,
  type RunResult,
  type Scenario,
  type ScenarioApi,
  type ScenarioSummary,
  type TargetMiss,
} from './scenarios'
export type { World } from './world'
