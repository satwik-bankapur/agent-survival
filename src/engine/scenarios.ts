/*
 * Scripted builds, each a timed list of real commands, plus the balance
 * target it must hit: decisions section G in classic mode (D40), D49 on
 * Survival's phase 2 traffic, I-4 on 0:00–9:00 with agents from 5:00, and
 * J-6 on phase 4: the outage drill to 11:00 and the endless phase to 25:00.
 * The balance report, the balance test and the canvas's ?scene= loader all
 * run these.
 */

import { classicCatalog, DEFAULT_CATALOG, makeCatalog, ticksPerSecond, type Catalog } from './catalog'
import { GameEngine } from './GameEngine'
import type { Command, GameOverCause, NodeType, SettingValue } from './types'
import type { World } from './world'

/** What a scenario script can do. Every call is a real command, so it lands in the command log. */
export interface ScenarioApi {
  readonly usersIn: number
  readonly usersOut: number
  readonly frontierA: number
  place(type: NodeType, x: number, y: number): number
  link(from: number, to: number): void
  unlink(from: number, to: number): void
  demolish(nodeId: number): void
  set(nodeId: number, key: string, value: SettingValue): void
  /** The node on a tile, or -1. */
  at(x: number, y: number): number
}

export interface ScenarioStep {
  readonly atSec: number
  run(api: ScenarioApi): void
}

/** Section G targets over many seeds. Every field present must hold. */
export interface BalanceTarget {
  readonly minDeathRate?: number
  readonly maxDeathRate?: number
  /** Most deaths must have this cause. */
  readonly mostlyCause?: GameOverCause
  readonly medianDeathSec?: readonly [number, number]
  /** At least `rate` of runs die of `cause` before `sec`. */
  readonly deathBefore?: { readonly cause: GameOverCause; readonly sec: number; readonly rate: number }
  readonly minSurvivalRate?: number
  readonly medianFinalBudget?: readonly [number, number]
  /** Final budgets' interquartile range, over survivors, at least this (D49: events are felt). */
  readonly minBudgetIqr?: number
  /** With the director off, the death rate may be at most this much lower (D49). */
  readonly maxDeathDropWithoutEvents?: number
  /** Median final budget (survivors) at most this share of another scenario's (D49). */
  readonly budgetAtMostShareOf?: { readonly id: string; readonly share: number }
  /** Median budget at the end over every run, dead ones at their death, at most this share of another scenario's. */
  readonly endBudgetAtMostShareOf?: { readonly id: string; readonly share: number }
  /** Median wrong answers served at least this many times another scenario's (I-4: a missing tool). */
  readonly agentWrongAtLeastTimesOf?: { readonly id: string; readonly times: number }
  /** Median agent token spend per finished agent run at least this many times another scenario's. */
  readonly agentCostPerTaskAtLeastTimesOf?: { readonly id: string; readonly times: number }
  /** Median loud failures (timeouts and drops) at most this many times another scenario's (I-4). */
  readonly failuresAtMostTimesOf?: { readonly id: string; readonly times: number }
  /** Median lowest trust from the scenario's `trustFromSec` on, at least this (J-6). */
  readonly minMedianTrustFrom?: number
  /**
   * Loses less than another scenario (J-6): a lower death rate, or the same one with a higher
   * median lowest trust from `trustFromSec`.
   */
  readonly losesLessThanOf?: { readonly id: string }
  /** Median lowest trust at least this many points below another scenario's (I-4: agents on Fast SLM). */
  readonly minTrustPointsBelowOf?: { readonly id: string; readonly points: number }
}

/** The scenario a target compares against, if any. Every comparison in one target names the same one. */
export function referenceIdOf(target: BalanceTarget): string | undefined {
  return (
    target.budgetAtMostShareOf?.id ??
    target.endBudgetAtMostShareOf?.id ??
    target.agentWrongAtLeastTimesOf?.id ??
    target.agentCostPerTaskAtLeastTimesOf?.id ??
    target.failuresAtMostTimesOf?.id ??
    target.losesLessThanOf?.id ??
    target.minTrustPointsBelowOf?.id
  )
}

/** Classic: Milestone 1's chat-only traffic and fixed spike (D40). Survival: phase 2 traffic and the director. */
export type ScenarioMode = 'classic' | 'survival'

export interface Scenario {
  readonly id: string
  readonly label: string
  readonly mode: ScenarioMode
  readonly steps: readonly ScenarioStep[]
  readonly target: BalanceTarget
  readonly targetText: string
  /** How long it runs: 5:00 unless it says otherwise (phase 3 runs to 9:00). */
  readonly untilSec?: number
  /** Its own catalog, instead of its mode's: the outage drill's (J-6). */
  readonly catalog?: Catalog
  /** Where `minTrustFrom` starts counting (J-6); the whole run by default. */
  readonly trustFromSec?: number
}

/** A scenario's run length in ticks. */
export function scenarioTicks(scenario: Scenario, catalog: Catalog): number {
  return Math.round((scenario.untilSec ?? 300) * ticksPerSecond(catalog))
}

const CLASSIC = classicCatalog()
const EVENTS_OFF = makeCatalog({ director: { enabled: false } })

/** The catalog a scenario runs on. `eventsOff` turns the incident director off, for D49's events check. */
export function catalogFor(scenario: Scenario, eventsOff = false): Catalog {
  if (scenario.catalog !== undefined) return scenario.catalog
  if (scenario.mode === 'classic') return CLASSIC
  return eventsOff ? EVENTS_OFF : DEFAULT_CATALOG
}

/**
 * The full Milestone 1 build, laid out like the hero: one main row from Users in (2, 9) to Users
 * out (23, 9). The router forks there: the Fast SLM lane turns up at the router and runs along
 * row 6, while the Frontier lane runs straight on through Frontier A, still at (12, 9). Both rejoin
 * at the guardrail (or, without one, at Users out). Tubes stay short (D30) and none crosses a node.
 */
interface FullBuild {
  readonly router: number
  /** What Users in feeds: the cache, or the router without one. */
  readonly entry: number
}

function buildFull(api: ScenarioApi, options: { cache: boolean; guardrail: boolean }): FullBuild {
  const router = api.place('PROMPT_ROUTER', 8, 9)
  const slm = api.place('FAST_SLM', 12, 6)
  const guard = options.guardrail ? api.place('OUTPUT_GUARDRAIL', 17, 9) : -1
  api.unlink(api.usersIn, api.frontierA)
  let entry = router
  if (options.cache) {
    const cache = api.place('SEMANTIC_CACHE', 5, 9)
    api.link(api.usersIn, cache)
    api.link(cache, router)
    entry = cache
  } else {
    api.link(api.usersIn, router)
  }
  api.link(router, slm)
  api.link(router, api.frontierA)
  if (guard >= 0) {
    api.link(slm, guard)
    api.link(api.frontierA, guard)
    api.unlink(api.frontierA, api.usersOut)
    api.link(guard, api.usersOut)
  } else {
    api.link(slm, api.usersOut)
  }
  return { router, entry }
}

interface M2Options {
  readonly firewall: boolean
  readonly redactor: boolean
  /** Vector DB tier, or 0 for no retrieval. */
  readonly tier: number
  readonly reranker: boolean
}

/**
 * Milestone 2 on top of the full build: the firewall and redactor on the main row between Users
 * in and the cache, and the RAG lane under it, from the router down to the vector DB, across to
 * the reranker, and up into Frontier A.
 */
function addM2(api: ScenarioApi, full: FullBuild, options: M2Options): void {
  // Every purchase first, the firewall and redactor before retrieval, then the wiring. A purchase
  // the budget can't cover ends the step (Unaffordable) with the board still wired as it was.
  const firewall = options.firewall ? api.place('PROMPT_FIREWALL', 3, 9) : -1
  const redactor = options.redactor ? api.place('PII_REDACTOR', 4, 9) : -1
  const vdb = options.tier > 0 ? api.place('VECTOR_DB', 8, 12) : -1
  if (options.tier > 1) api.set(vdb, 'tier', options.tier)
  const rerank = options.tier > 0 && options.reranker ? api.place('RERANKER', 12, 12) : -1
  if (firewall >= 0 || redactor >= 0) {
    api.unlink(api.usersIn, full.entry)
    let prev = api.usersIn
    for (const node of [firewall, redactor]) {
      if (node < 0) continue
      api.link(prev, node)
      prev = node
    }
    api.link(prev, full.entry)
  }
  if (vdb >= 0) {
    api.link(full.router, vdb)
    if (rerank >= 0) {
      api.link(vdb, rerank)
      api.link(rerank, api.frontierA)
    } else {
      api.link(vdb, api.frontierA)
    }
  }
}

const FULL_M2: M2Options = { firewall: true, redactor: true, tier: 2, reranker: true }

function fullM2(api: ScenarioApi, options: M2Options = FULL_M2): void {
  addM2(api, buildFull(api, { cache: true, guardrail: true }), options)
}

interface M3Options {
  /** The coordinators' max steps; 0 is off. */
  readonly maxSteps: number
  /** Prefix caching on the agents' model, and on Frontier A too. */
  readonly prefixAgentModel: boolean
  readonly prefixA: boolean
  readonly sandbox: boolean
  /** Which model the coordinators run agents on. */
  readonly agentModel: 'B' | 'SLM'
  /** Frontier B also takes the router's and reranker's overflow; off, it serves agents only. */
  readonly bOverflow: boolean
  /** Users in's throttle, prompts per second (0 is off): sheds surges both pools can't serve (D7). */
  readonly throttle: number
  /** Frontier B's provider: B, or A for the single-provider build (J-6). */
  readonly bProvider?: 'A' | 'B'
  /** Circuit breakers on every model (D29, J-4). */
  readonly breakers?: boolean
}

const FULL_M3: M3Options = { maxSteps: 5, prefixAgentModel: true, prefixA: false, sandbox: true, agentModel: 'B', bOverflow: true, throttle: 40 }
const AGENTS_ONLY_B: M3Options = { ...FULL_M3, bOverflow: false }

/**
 * Milestone 3 on top of full M2 (I-4): Frontier B on the Fast SLM lane's row, taking the router's
 * and reranker's overflow, and the agent lane above the main row: the router feeds two
 * coordinators, each looping with the agent model, web search and the code sandbox, with a human
 * review gate beside them and the guardrail for finished runs. Users in is throttled at 40 prompts/s, so a
 * surge past what providers A and B can serve together is shed as throttles (+0.8), not timeouts.
 */
function addM3(api: ScenarioApi, o: M3Options): void {
  const router = api.at(8, 9)
  const slm = api.at(12, 6)
  const guard = api.at(17, 9)
  const rerank = api.at(12, 12)
  // Every purchase first, then the wiring, as in addM2.
  const b = api.place('FRONTIER_API', 16, 6)
  if ((o.bProvider ?? 'B') === 'B') api.set(b, 'provider', 'B')
  if (o.breakers === true) for (const model of [api.frontierA, b, slm]) api.set(model, 'breaker', true)
  const coordinators = [api.place('LANGGRAPH_COORDINATOR', 8, 4), api.place('LANGGRAPH_COORDINATOR', 10, 4)]
  const search = api.place('MCP_WEB_SEARCH', 12, 2)
  const sandbox = o.sandbox ? api.place('MCP_CODE_SANDBOX', 14, 2) : -1
  const review = api.place('HITL_GATE', 6, 4)
  // Keeps the vector DB fresh (D46): without it drift caps by about 7:30 and trust idles near 50% (J-6, your call).
  api.place('INGESTION_CRON', 6, 14)
  const agentModel = o.agentModel === 'B' ? b : slm
  if (o.prefixAgentModel) api.set(agentModel, 'prefixCache', true)
  if (o.prefixA) api.set(api.frontierA, 'prefixCache', true)
  if (o.throttle > 0) api.set(api.usersIn, 'maxPerSec', o.throttle)
  if (o.bOverflow) {
    api.link(router, b)
    if (rerank >= 0) api.link(rerank, b)
  }
  api.link(b, guard)
  for (const c of coordinators) {
    if (o.maxSteps > 0) api.set(c, 'maxSteps', o.maxSteps)
    api.link(router, c)
    api.link(c, agentModel)
    api.link(c, search)
    if (sandbox >= 0) api.link(c, sandbox)
    api.link(c, review)
    api.link(c, guard)
  }
}

function fullM3(api: ScenarioApi, o: M3Options = FULL_M3): void {
  addM3(api, o)
}

/** Where the vLLM replicas and their substations go, under the RAG lane (J-6). */
const VLLM_TILES: readonly { readonly vllm: readonly [number, number]; readonly sub: readonly [number, number] }[] = [
  { vllm: [16, 12], sub: [19, 12] },
  { vllm: [16, 14], sub: [19, 14] },
  { vllm: [14, 14], sub: [19, 16] },
]

/**
 * A 70B vLLM replica on top of full M3 (J-6): its substation, the node upgraded to the 70B at
 * once, a breaker, and links from the router, the reranker and both coordinators, out to the
 * guardrail. Users in's throttle rises by `throttleAdd`, since the board now serves more.
 */
function addVllmReplica(api: ScenarioApi, replica: number, throttleAdd: number, breaker = true): void {
  const at = VLLM_TILES[replica]
  api.place('POWER_SUBSTATION', at.sub[0], at.sub[1])
  const vllm = api.place('VLLM_CLUSTER', at.vllm[0], at.vllm[1])
  api.set(vllm, 'tier', 2)
  if (breaker) api.set(vllm, 'breaker', true)
  api.link(api.at(8, 9), vllm)
  api.link(api.at(12, 12), vllm)
  for (const c of [api.at(8, 4), api.at(10, 4)]) api.link(c, vllm)
  api.link(vllm, api.at(17, 9))
  if (throttleAdd > 0) {
    const usersIn = api.usersIn
    api.set(usersIn, 'maxPerSec', FULL_M3.throttle + throttleAdd * replica)
  }
}

/** Full M4 (J-6): full M3 plus a 70B replica, its substation, and breakers on every model. */
function fullM4(api: ScenarioApi, breakers = true): void {
  if (breakers) for (const model of [api.frontierA, api.at(16, 6), api.at(12, 6)]) api.set(model, 'breaker', true)
  addVllmReplica(api, 0, 0, breakers)
}

/** Decisions section G, in classic mode (D40). */
export const CLASSIC_SCENARIOS: readonly Scenario[] = [
  {
    id: 'naive',
    mode: 'classic',
    label: 'Naive: Users in → Frontier → Users out',
    steps: [],
    target: { minDeathRate: 0.9, mostlyCause: 'BANKRUPT', medianDeathSec: [210, 285] },
    targetText: '≥90% die, mostly bankrupt, median death 3:30–4:45',
  },
  {
    id: 'all-slm',
    mode: 'classic',
    label: 'All Fast SLM',
    steps: [
      {
        atSec: 0,
        run(api) {
          // The Fast SLM takes Frontier A's place on the main row.
          api.demolish(api.frontierA)
          const slm = api.place('FAST_SLM', 12, 9)
          api.link(api.usersIn, slm)
          api.link(slm, api.usersOut)
        },
      },
    ],
    target: { deathBefore: { cause: 'TRUST', sec: 90, rate: 0.9 } },
    targetText: '≥90% die of trust before 1:30',
  },
  {
    id: 'router',
    mode: 'classic',
    label: 'Router + Fast SLM + Frontier, no guardrail',
    steps: [{ atSec: 0, run: (api) => buildFull(api, { cache: false, guardrail: false }) }],
    target: { minDeathRate: 0.15, maxDeathRate: 0.5 },
    targetText: '15–50% die',
  },
  {
    id: 'full-minus-cache',
    mode: 'classic',
    label: 'Full build minus the cache',
    steps: [{ atSec: 0, run: (api) => buildFull(api, { cache: false, guardrail: true }) }],
    target: { minDeathRate: 0.1, maxDeathRate: 0.4 },
    targetText: '10–40% die',
  },
  {
    id: 'full',
    mode: 'classic',
    label: 'Full: cache + router + guardrail + Fast SLM + Frontier',
    steps: [{ atSec: 0, run: (api) => buildFull(api, { cache: true, guardrail: true }) }],
    target: { minSurvivalRate: 0.95, medianFinalBudget: [900, 1800] },
    targetText: '≥95% survive, median final budget $900–1,800',
  },
  {
    id: 'naive-to-full',
    mode: 'classic',
    label: 'Naive, then the full build at 3:00',
    steps: [{ atSec: 180, run: (api) => buildFull(api, { cache: true, guardrail: true }) }],
    target: { minSurvivalRate: 0.9 },
    targetText: '≥90% survive',
  },
]

/** D49: phase 2 traffic and the incident director, 0:00–5:00. */
export const PHASE2_SCENARIOS: readonly Scenario[] = [
  {
    id: 'p2-naive',
    mode: 'survival',
    label: 'Naive',
    steps: [],
    target: { minDeathRate: 0.95, medianDeathSec: [150, 255] },
    targetText: '≥95% die, median death 2:30–4:15',
  },
  {
    id: 'p2-m1-full',
    mode: 'survival',
    label: 'Milestone 1 full build, nothing added',
    steps: [{ atSec: 0, run: (api) => void buildFull(api, { cache: true, guardrail: true }) }],
    target: { minDeathRate: 0.9, medianDeathSec: [180, 270] },
    targetText: '≥90% die, median death 3:00–4:30',
  },
  {
    id: 'p2-secure-no-rag',
    mode: 'survival',
    label: 'M1 full + firewall + redactor, no retrieval',
    steps: [{ atSec: 0, run: (api) => fullM2(api, { firewall: true, redactor: true, tier: 0, reranker: false }) }],
    target: { minDeathRate: 0.85, mostlyCause: 'TRUST' },
    targetText: '≥85% die, mostly of trust',
  },
  {
    id: 'p2-flat',
    mode: 'survival',
    label: 'M1 full + firewall + redactor + Flat vector DB, no reranker',
    steps: [{ atSec: 0, run: (api) => fullM2(api, { firewall: true, redactor: true, tier: 1, reranker: false }) }],
    target: { budgetAtMostShareOf: { id: 'p2-full', share: 0.4 } },
    targetText: "median budget at most 40% of full M2's",
  },
  {
    id: 'p2-full',
    mode: 'survival',
    label: 'Full M2: firewall, redactor, cache, router, IVF vector DB, reranker, guardrail, Fast SLM, Frontier',
    steps: [{ atSec: 0, run: (api) => fullM2(api) }],
    target: { minSurvivalRate: 0.9, medianFinalBudget: [700, 1800] },
    targetText: '≥90% survive, median final budget $700–1,800',
  },
  {
    id: 'p2-no-firewall',
    mode: 'survival',
    label: 'Full M2 minus the firewall',
    steps: [{ atSec: 0, run: (api) => fullM2(api, { ...FULL_M2, firewall: false }) }],
    // Survivors' median below $0; a death ends at −$1,000, so that's the range's floor.
    target: { minDeathRate: 0.4, medianFinalBudget: [-1000, 0] },
    targetText: '≥40% die, median budget below $0',
  },
  {
    id: 'p2-no-redactor',
    mode: 'survival',
    label: 'Full M2 minus the redactor',
    steps: [{ atSec: 0, run: (api) => fullM2(api, { ...FULL_M2, redactor: false }) }],
    target: { minDeathRate: 0.8 },
    targetText: '≥80% die',
  },
  {
    id: 'p2-upgrade',
    mode: 'survival',
    label: 'M1 full, upgraded to full M2 at 2:30',
    steps: [
      { atSec: 0, run: (api) => void buildFull(api, { cache: true, guardrail: true }) },
      // The full build's router and cache, by where buildFull put them.
      { atSec: 150, run: (api) => addM2(api, { router: api.at(8, 9), entry: api.at(5, 9) }, FULL_M2) },
    ],
    target: { minSurvivalRate: 0.8 },
    targetText: '≥80% survive',
  },
  {
    id: 'p2-events',
    mode: 'survival',
    label: 'Full M2, events felt',
    steps: [{ atSec: 0, run: (api) => fullM2(api) }],
    target: { minBudgetIqr: 150, maxDeathDropWithoutEvents: 0.1 },
    targetText: 'final budget IQR ≥$150; events off kills ≤10 points fewer',
  },
]

/** Phase 3 (I-4): 0:00–9:00, agents from 5:00. Full M2 goes down at 0:00 and Milestone 3 at 4:00, ahead of the agents. */
const M3_AT = 240
const NINE = 540
const TWELVE = 720

function phase3(
  id: string,
  label: string,
  o: M3Options | null,
  target: BalanceTarget,
  targetText: string,
  atSec = M3_AT,
  untilSec = NINE,
): Scenario {
  const steps: ScenarioStep[] = [{ atSec: 0, run: (api) => fullM2(api) }]
  if (o !== null) steps.push({ atSec, run: (api) => fullM3(api, o) })
  return { id, mode: 'survival', label, steps, target, targetText, untilSec }
}

export const PHASE3_SCENARIOS: readonly Scenario[] = [
  phase3('p3-m2-full', 'Full M2, nothing added', null, { minDeathRate: 0.9, medianDeathSec: [330, 450] }, '≥90% die, median death 5:30–7:30'),
  phase3('p3-full', 'Full M3: + Frontier B, 2 coordinators (max steps 5), search, sandbox, review, prefix caching on B', FULL_M3, { minSurvivalRate: 0.9, medianFinalBudget: [3500, 6000] }, '≥90% survive, median final budget $3,500–6,000'),
  phase3(
    'p3-no-max-steps',
    'Full M3, max steps off',
    { ...FULL_M3, maxSteps: 0 },
    { endBudgetAtMostShareOf: { id: 'p3-full', share: 0.85 } },
    "median end budget by 9:00 at most 85% of full M3's",
  ),
  // The runaway needs time: the same build, phase 3 traffic running on to 12:00.
  phase3('p3-no-max-steps-12', 'Full M3, max steps off, to 12:00', { ...FULL_M3, maxSteps: 0 }, { minDeathRate: 0.6 }, '≥60% die by 12:00', M3_AT, TWELVE),
  // The caching bet on a model kept for agents; full M3 itself is the mixed case.
  phase3('p3-b-agents', 'Full M3, Frontier B serving agents only', AGENTS_ONLY_B, {}, 'the reference for the caching bet'),
  phase3(
    'p3-no-prefix',
    'Full M3, Frontier B serving agents only, without prefix caching',
    { ...AGENTS_ONLY_B, prefixAgentModel: false },
    { agentCostPerTaskAtLeastTimesOf: { id: 'p3-b-agents', times: 1.4 } },
    "agent token spend per finished task at least 1.4× agents-only B's",
  ),
  phase3('p3-prefix-everywhere', 'Full M3 with prefix caching on Frontier A too', { ...FULL_M3, prefixA: true }, { budgetAtMostShareOf: { id: 'p3-full', share: 0.85 } }, "median budget at most 85% of full M3's"),
  phase3(
    'p3-no-sandbox',
    'Full M3 minus the code sandbox',
    { ...FULL_M3, sandbox: false },
    { agentWrongAtLeastTimesOf: { id: 'p3-full', times: 3 }, failuresAtMostTimesOf: { id: 'p3-full', times: 1.2 } },
    "agents' own wrong answers ≥3× full M3's, failures ≤1.2×",
  ),
  // Your call (Session 10): with the cron, trust has room for its wrong answers, so the lesson is the answers, not a death.
  phase3(
    'p3-slm-agents',
    'Agents on Fast SLM instead of B',
    { ...FULL_M3, agentModel: 'SLM' },
    { agentWrongAtLeastTimesOf: { id: 'p3-full', times: 10 }, minTrustPointsBelowOf: { id: 'p3-full', points: 10 } },
    "agents' wrong answers ≥10× full M3's, lowest trust ≥10 points lower",
  ),
  phase3('p3-upgrade', 'Full M2, upgraded to full M3 at 5:00', FULL_M3, { minSurvivalRate: 0.8 }, '≥80% survive', 300),
]

/**
 * The outage drill (J-6): the director as usual until 9:00 and quiet after it, and Frontier A down
 * from 9:30 to 10:30. Runs go to 11:00.
 */
export const OUTAGE_DRILL: Catalog = makeCatalog({ director: { quietFromSec: 540, drill: { provider: 0, startSec: 570, endSec: 630 } } })
/**
 * The single-provider drill (J-6): full M2's one provider, Frontier A, down from 3:30 to 4:30, with
 * the director quiet from 3:00. Its own catalog, so the phase 2 table (D49) is untouched.
 */
export const SINGLE_PROVIDER_DRILL: Catalog = makeCatalog({ director: { quietFromSec: 180, drill: { provider: 0, startSec: 210, endSec: 270 } } })
/** The drill's quiet hours with no outage: what trust does from 9:30 anyway (a reference). */
const QUIET_AFTER_NINE: Catalog = makeCatalog({ director: { quietFromSec: 540 } })
const ELEVEN = 660
const M4_AT = 480
const ENDLESS = 1500

function phase4(
  id: string,
  label: string,
  steps: readonly ScenarioStep[],
  target: BalanceTarget,
  targetText: string,
  untilSec: number,
  drill: boolean,
): Scenario {
  return {
    id,
    mode: 'survival',
    label,
    steps: [{ atSec: 0, run: (api) => fullM2(api) }, ...steps],
    target,
    targetText,
    untilSec,
    ...(drill ? { catalog: OUTAGE_DRILL, trustFromSec: OUTAGE_DRILL.director.drill?.startSec ?? 0 } : {}),
  }
}

const DRILL_START = OUTAGE_DRILL.director.drill?.startSec ?? 0

const M3_STEP = (o: M3Options): ScenarioStep => ({ atSec: M3_AT, run: (api) => fullM3(api, o) })
const M4_STEP = (atSec: number): ScenarioStep => ({ atSec, run: fullM4 })
/** The endless strong build adds a replica, and lets 20 more prompts/s through, at 12:00 and 15:00. */
const REPLICA_STEPS: readonly ScenarioStep[] = [
  { atSec: 720, run: (api) => addVllmReplica(api, 1, 20) },
  { atSec: 900, run: (api) => addVllmReplica(api, 2, 20) },
]

export const PHASE4_SCENARIOS: readonly Scenario[] = [
  // A build that is single-provider by nature, on its own catalog so D49 stays locked (J-6, your call).
  {
    id: 'p4-single',
    mode: 'survival',
    label: 'Single-provider drill: full M2, Frontier A down 3:30–4:30',
    steps: [{ atSec: 0, run: (api) => fullM2(api) }],
    target: { minDeathRate: 0.7 },
    targetText: '≥70% die by 5:00',
    untilSec: 300,
    catalog: SINGLE_PROVIDER_DRILL,
    trustFromSec: SINGLE_PROVIDER_DRILL.director.drill?.startSec ?? 0,
  },
  phase4('p4-m3-drill', 'Outage drill: full M3, no breakers (reference)', [M3_STEP(FULL_M3)], {}, 'reference for breakers', ELEVEN, true),
  // A reference, your call: breakers can't help without spare capacity. With A down, B's 64 calls are all there is.
  phase4('p4-breakers', 'Outage drill: full M3 + breakers (reference)', [M3_STEP({ ...FULL_M3, breakers: true })], {}, "reference: breakers can't help without spare capacity", ELEVEN, true),
  phase4(
    'p4-full-drill',
    'Outage drill: full M4 (+ 70B vLLM, substation, breakers at 8:00)',
    [M3_STEP(FULL_M3), M4_STEP(M4_AT)],
    { minSurvivalRate: 0.9, minMedianTrustFrom: 50 },
    '≥90% survive, median lowest trust from 9:30 ≥50%',
    ELEVEN,
    true,
  ),
  phase4('p4-m4-no-breakers', 'Outage drill: full M4 without breakers (reference)', [M3_STEP(FULL_M3), { atSec: M4_AT, run: (api) => fullM4(api, false) }], {}, 'reference: a failing provider attracts traffic', ELEVEN, true),
  {
    ...phase4('p4-m4-quiet', 'Full M4, no outage, quiet after 9:00 (reference)', [M3_STEP(FULL_M3), M4_STEP(M4_AT)], {}, "reference: trust from 9:30 without an outage", ELEVEN, false),
    catalog: QUIET_AFTER_NINE,
    trustFromSec: DRILL_START,
  },
  phase4('p4-upgrade', 'Full M3, upgraded to full M4 at 9:00', [M3_STEP(FULL_M3), M4_STEP(540)], { minSurvivalRate: 0.85 }, '≥85% survive the transition (to 11:00)', ELEVEN, false),
  phase4('p4-m3-endless', 'Endless: full M3, nothing added', [M3_STEP(FULL_M3)], { medianDeathSec: [570, 720] }, 'median death 9:30–12:00', ENDLESS, false),
  phase4(
    'p4-m4-endless',
    'Endless: full M4, a replica more at 12:00 and 15:00',
    [M3_STEP(FULL_M3), M4_STEP(M4_AT), ...REPLICA_STEPS],
    { medianDeathSec: [840, 1200] },
    'median death 14:00–20:00',
    ENDLESS,
    false,
  ),
]

export const SCENARIOS: readonly Scenario[] = [...CLASSIC_SCENARIOS, ...PHASE2_SCENARIOS, ...PHASE3_SCENARIOS, ...PHASE4_SCENARIOS]

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id)
}

/** A scripted purchase the budget can't cover: the player couldn't have made it either. */
class Unaffordable extends Error {}

function apiFor(engine: GameEngine): ScenarioApi {
  const world = engine.world
  const run = (command: Command): number => {
    const result = engine.applyNow(command)
    if (!result.ok && result.reason.startsWith('Needs $')) throw new Unaffordable(result.reason)
    if (!result.ok) throw new Error(`Scenario command ${command.type} failed: ${result.reason}`)
    return result.nodeId ?? -1
  }
  const start = world.catalog.startingBoard
  const idAt = (x: number, y: number): number => world.occupancy[y * world.catalog.board.cols + x]
  return {
    usersIn: idAt(start.usersIn.x, start.usersIn.y),
    usersOut: idAt(start.usersOut.x, start.usersOut.y),
    frontierA: idAt(start.frontier.x, start.frontier.y),
    place: (nodeType, x, y) => run({ type: 'placeNode', nodeType, x, y }),
    link: (from, to) => void run({ type: 'link', from, to }),
    unlink: (from, to) => void run({ type: 'unlink', from, to }),
    demolish: (nodeId) => void run({ type: 'demolish', nodeId }),
    set: (nodeId, key, value) => void run({ type: 'setSetting', nodeId, key, value }),
    at: idAt,
  }
}

export interface AttachedScenario {
  /** Steps cut short by a purchase the budget couldn't cover. */
  cutShort: number
}

/**
 * Scripts a scenario onto an engine through its beforeTick hook. Call before the first tick.
 * `onStep` runs after each step has built, so the board can frame what it built. A step whose
 * purchase the budget can't cover stops there, as a player's would, and is counted.
 */
export function attachScenario(engine: GameEngine, scenario: Scenario, onStep?: () => void): AttachedScenario {
  const api = apiFor(engine)
  const tps = ticksPerSecond(engine.world.catalog)
  const attached: AttachedScenario = { cutShort: 0 }
  let next = 0
  engine.beforeTick = (e) => {
    while (next < scenario.steps.length && Math.round(scenario.steps[next].atSec * tps) <= e.tickCount) {
      try {
        scenario.steps[next++].run(api)
      } catch (error) {
        if (!(error instanceof Unaffordable)) throw error
        attached.cutShort++
      }
      onStep?.()
    }
  }
  return attached
}

export interface RunResult {
  readonly seed: number
  readonly died: boolean
  readonly cause: GameOverCause | null
  readonly deathSec: number | null
  readonly finalBudget: number
  readonly minTrust: number
  readonly timeouts: number
  readonly wrongAnswers: number
  readonly served: number
  readonly breaches: number
  /** Agent runs that finished wrong, caught by the guardrail or not. */
  readonly agentWrong: number
  /** Agent token spend per finished agent run, 0 with none finished. */
  readonly agentCostPerTask: number
  /** Loud failures: timeouts, queue-full and no-route drops, and runs that gave up. */
  readonly failures: number
  /** Scripted steps the budget couldn't pay for. */
  readonly cutShort: number
  /** Lowest trust from the scenario's `trustFromSec` on, sampled once a second (J-6). */
  readonly minTrustFrom: number
}

/** Lowest per-second trust sample from a time on; the whole run's minimum with none taken yet. */
function minTrustFrom(world: World, fromSec: number): number {
  const log = world.runLog
  let min = Infinity
  for (let s = Math.max(0, Math.floor(fromSec)); s < log.seconds; s++) min = Math.min(min, log.trust[s])
  return min === Infinity ? world.stats.minTrust : min
}

export function resultOf(world: World, cutShort = 0, trustFromSec = 0): RunResult {
  const tps = ticksPerSecond(world.catalog)
  return {
    seed: world.seed,
    died: world.gameOver !== null,
    cause: world.gameOver?.cause ?? null,
    deathSec: world.gameOver === null ? null : world.gameOver.tick / tps,
    finalBudget: world.budget,
    minTrust: world.stats.minTrust,
    timeouts: world.stats.timeouts,
    wrongAnswers: world.stats.wrongServed,
    served: world.stats.served,
    breaches: world.stats.injectionBreaches + world.stats.piiBreaches,
    agentWrong: world.stats.agentWrong,
    agentCostPerTask: world.stats.agentRunsDone > 0 ? world.stats.agentTokenSpend / world.stats.agentRunsDone : 0,
    failures: world.stats.timeouts + world.stats.queueFullDrops + world.stats.noRouteDrops + world.stats.gaveUp,
    cutShort,
    minTrustFrom: minTrustFrom(world, trustFromSec),
  }
}

/** Runs a scenario headless for `ticks` ticks (its own length by default), or until the run ends. */
export function runScenario(scenario: Scenario, seed: number, ticks?: number, catalog: Catalog = catalogFor(scenario)): RunResult {
  const engine = new GameEngine({ seed, catalog })
  const attached = attachScenario(engine, scenario)
  const length = ticks ?? scenarioTicks(scenario, catalog)
  for (let t = 0; t < length && engine.world.gameOver === null; t++) engine.tick()
  return resultOf(engine.world, attached.cutShort, scenario.trustFromSec ?? 0)
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export interface ScenarioSummary {
  readonly runs: number
  readonly deaths: number
  readonly causes: Readonly<Record<GameOverCause, number>>
  readonly medianDeathSec: number | null
  /** Median budget at the end, over runs that survived. */
  readonly medianFinalBudget: number | null
  /** Median budget at the end over every run, dead ones at their death. */
  readonly medianEndBudget: number
  readonly medianMinTrust: number
  readonly medianMinTrustFrom: number
  readonly medianTimeouts: number
  readonly medianWrongAnswers: number
  readonly medianServed: number
  readonly medianBreaches: number
  readonly medianFailures: number
  readonly medianAgentWrong: number
  readonly medianAgentCostPerTask: number
  /** Interquartile range of survivors' final budgets, or null with fewer than 2 survivors. */
  readonly budgetIqr: number | null
}

function quantile(sorted: readonly number[], q: number): number {
  const at = (sorted.length - 1) * q
  const lo = Math.floor(at)
  const hi = Math.ceil(at)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo)
}

export function summarize(results: readonly RunResult[]): ScenarioSummary {
  const deaths = results.filter((r) => r.died)
  const survivors = results.filter((r) => !r.died)
  return {
    runs: results.length,
    deaths: deaths.length,
    causes: {
      BANKRUPT: deaths.filter((r) => r.cause === 'BANKRUPT').length,
      TRUST: deaths.filter((r) => r.cause === 'TRUST').length,
      ENDED: deaths.filter((r) => r.cause === 'ENDED').length,
    },
    medianDeathSec: median(deaths.map((r) => r.deathSec ?? 0)),
    medianFinalBudget: median(survivors.map((r) => r.finalBudget)),
    medianEndBudget: median(results.map((r) => r.finalBudget)) ?? 0,
    medianMinTrust: median(results.map((r) => r.minTrust)) ?? 0,
    medianMinTrustFrom: median(results.map((r) => r.minTrustFrom)) ?? 0,
    medianTimeouts: median(results.map((r) => r.timeouts)) ?? 0,
    medianWrongAnswers: median(results.map((r) => r.wrongAnswers)) ?? 0,
    medianServed: median(results.map((r) => r.served)) ?? 0,
    medianBreaches: median(results.map((r) => r.breaches)) ?? 0,
    medianFailures: median(results.map((r) => r.failures)) ?? 0,
    medianAgentWrong: median(results.map((r) => r.agentWrong)) ?? 0,
    medianAgentCostPerTask: median(results.map((r) => r.agentCostPerTask)) ?? 0,
    budgetIqr: survivors.length < 2 ? null : iqr(survivors.map((r) => r.finalBudget)),
  }
}

function iqr(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return quantile(sorted, 0.75) - quantile(sorted, 0.25)
}

/** A missed target, and whether it's big: over 10 points, or 10% past a median's nearer bound (D49). */
export interface TargetMiss {
  readonly text: string
  readonly big: boolean
}

/** How far outside [lo, hi] a value is, as a share of the nearer bound. */
function outsideShare(value: number, lo: number, hi: number): number {
  if (value < lo) return (lo - value) / Math.abs(lo)
  if (value > hi) return (value - hi) / Math.abs(hi)
  return 0
}

const BIG_POINTS = 0.1

/**
 * Checks results against a target. Returns the misses, empty when it passes. `eventsOff` are the
 * same runs with the director off, for `maxDeathDropWithoutEvents`; `reference` are the runs of
 * the scenario the target compares against (`referenceIdOf`).
 */
export function checkTarget(
  target: BalanceTarget,
  results: readonly RunResult[],
  eventsOff?: readonly RunResult[],
  reference?: readonly RunResult[],
): TargetMiss[] {
  const s = summarize(results)
  const misses: TargetMiss[] = []
  const deathRate = s.deaths / s.runs
  const pct = (x: number): string => `${Math.round(x * 100)}%`
  const rateMiss = (text: string, by: number) => misses.push({ text: `${text} (${Math.round(by * 100)} points)`, big: by > BIG_POINTS })
  if (target.minDeathRate !== undefined && deathRate < target.minDeathRate) {
    rateMiss(`death rate ${pct(deathRate)} < ${pct(target.minDeathRate)}`, target.minDeathRate - deathRate)
  }
  if (target.maxDeathRate !== undefined && deathRate > target.maxDeathRate) {
    rateMiss(`death rate ${pct(deathRate)} > ${pct(target.maxDeathRate)}`, deathRate - target.maxDeathRate)
  }
  if (target.mostlyCause !== undefined && s.causes[target.mostlyCause] * 2 <= s.deaths) {
    const share = s.deaths > 0 ? s.causes[target.mostlyCause] / s.deaths : 0
    rateMiss(`only ${s.causes[target.mostlyCause]} of ${s.deaths} deaths were ${target.mostlyCause}`, 0.5 - share)
  }
  if (target.medianDeathSec !== undefined) {
    const [lo, hi] = target.medianDeathSec
    if (s.medianDeathSec === null || s.medianDeathSec < lo || s.medianDeathSec > hi) {
      misses.push({
        text: `median death ${s.medianDeathSec === null ? 'none' : formatClock(s.medianDeathSec)} outside ${formatClock(lo)}–${formatClock(hi)}`,
        big: s.medianDeathSec === null || outsideShare(s.medianDeathSec, lo, hi) > BIG_POINTS,
      })
    }
  }
  if (target.deathBefore !== undefined) {
    const { cause, sec, rate } = target.deathBefore
    const early = results.filter((r) => r.cause === cause && r.deathSec !== null && r.deathSec < sec).length / s.runs
    if (early < rate) rateMiss(`${pct(early)} died of ${cause} before ${formatClock(sec)}, needs ${pct(rate)}`, rate - early)
  }
  if (target.minSurvivalRate !== undefined && 1 - deathRate < target.minSurvivalRate) {
    rateMiss(`survival ${pct(1 - deathRate)} < ${pct(target.minSurvivalRate)}`, target.minSurvivalRate - (1 - deathRate))
  }
  if (target.medianFinalBudget !== undefined) {
    const [lo, hi] = target.medianFinalBudget
    if (s.medianFinalBudget === null || s.medianFinalBudget < lo || s.medianFinalBudget > hi) {
      misses.push({
        text: `median final budget ${s.medianFinalBudget === null ? 'none' : `$${Math.round(s.medianFinalBudget)}`} outside $${lo}–$${hi}`,
        big: s.medianFinalBudget === null || outsideShare(s.medianFinalBudget, lo, hi) > BIG_POINTS,
      })
    }
  }
  if (target.minBudgetIqr !== undefined && (s.budgetIqr === null || s.budgetIqr < target.minBudgetIqr)) {
    misses.push({
      text: `final budget IQR ${s.budgetIqr === null ? 'none' : `$${Math.round(s.budgetIqr)}`} < $${target.minBudgetIqr}`,
      big: s.budgetIqr === null || outsideShare(s.budgetIqr, target.minBudgetIqr, Infinity) > BIG_POINTS,
    })
  }
  if (target.budgetAtMostShareOf !== undefined && reference !== undefined) {
    const ref = summarize(reference).medianFinalBudget
    const cap = ref === null ? null : ref * target.budgetAtMostShareOf.share
    if (cap === null || s.medianFinalBudget === null || s.medianFinalBudget > cap) {
      misses.push({
        text: `median final budget ${s.medianFinalBudget === null ? 'none' : `$${Math.round(s.medianFinalBudget)}`} over ${Math.round(target.budgetAtMostShareOf.share * 100)}% of ${target.budgetAtMostShareOf.id}'s (${cap === null ? 'none' : `$${Math.round(cap)}`})`,
        big: cap === null || s.medianFinalBudget === null || outsideShare(s.medianFinalBudget, -Infinity, cap) > BIG_POINTS,
      })
    }
  }
  if (target.endBudgetAtMostShareOf !== undefined && reference !== undefined) {
    const cap = summarize(reference).medianEndBudget * target.endBudgetAtMostShareOf.share
    if (s.medianEndBudget > cap) {
      misses.push({
        text: `median end budget $${Math.round(s.medianEndBudget)} over ${Math.round(target.endBudgetAtMostShareOf.share * 100)}% of ${target.endBudgetAtMostShareOf.id}'s ($${Math.round(cap)})`,
        big: outsideShare(s.medianEndBudget, -Infinity, cap) > BIG_POINTS,
      })
    }
  }
  if (target.agentCostPerTaskAtLeastTimesOf !== undefined && reference !== undefined) {
    const floor = summarize(reference).medianAgentCostPerTask * target.agentCostPerTaskAtLeastTimesOf.times
    if (s.medianAgentCostPerTask < floor) {
      misses.push({
        text: `median agent spend per task $${s.medianAgentCostPerTask.toFixed(2)} under ${target.agentCostPerTaskAtLeastTimesOf.times}× ${target.agentCostPerTaskAtLeastTimesOf.id}'s ($${floor.toFixed(2)})`,
        big: outsideShare(s.medianAgentCostPerTask, floor, Infinity) > BIG_POINTS,
      })
    }
  }
  if (target.agentWrongAtLeastTimesOf !== undefined && reference !== undefined) {
    const floor = summarize(reference).medianAgentWrong * target.agentWrongAtLeastTimesOf.times
    if (s.medianAgentWrong < floor) {
      misses.push({
        text: `median agent wrong answers ${Math.round(s.medianAgentWrong)} under ${target.agentWrongAtLeastTimesOf.times}× ${target.agentWrongAtLeastTimesOf.id}'s (${Math.round(floor)})`,
        big: outsideShare(s.medianAgentWrong, floor, Infinity) > BIG_POINTS,
      })
    }
  }
  if (target.failuresAtMostTimesOf !== undefined && reference !== undefined) {
    const cap = summarize(reference).medianFailures * target.failuresAtMostTimesOf.times
    if (s.medianFailures > cap) {
      misses.push({
        text: `median failures ${Math.round(s.medianFailures)} over ${target.failuresAtMostTimesOf.times}× ${target.failuresAtMostTimesOf.id}'s (${Math.round(cap)})`,
        big: outsideShare(s.medianFailures, -Infinity, cap) > BIG_POINTS,
      })
    }
  }
  if (target.losesLessThanOf !== undefined && reference !== undefined) {
    const ref = summarize(reference)
    const refRate = ref.deaths / ref.runs
    const less = deathRate < refRate || (deathRate === refRate && s.medianMinTrustFrom > ref.medianMinTrustFrom)
    if (!less) {
      misses.push({
        text: `doesn't lose less than ${target.losesLessThanOf.id}: death rate ${pct(deathRate)} against ${pct(refRate)}, lowest trust ${s.medianMinTrustFrom.toFixed(1)}% against ${ref.medianMinTrustFrom.toFixed(1)}%`,
        big: deathRate - refRate > BIG_POINTS,
      })
    }
  }
  if (target.minTrustPointsBelowOf !== undefined && reference !== undefined) {
    const ceiling = summarize(reference).medianMinTrust - target.minTrustPointsBelowOf.points
    if (s.medianMinTrust > ceiling) {
      rateMiss(
        `median lowest trust ${s.medianMinTrust.toFixed(1)}% not ${target.minTrustPointsBelowOf.points} points below ${target.minTrustPointsBelowOf.id}'s (needs ≤${ceiling.toFixed(1)}%)`,
        (s.medianMinTrust - ceiling) / 100,
      )
    }
  }
  if (target.minMedianTrustFrom !== undefined && s.medianMinTrustFrom < target.minMedianTrustFrom) {
    rateMiss(`median lowest trust ${s.medianMinTrustFrom.toFixed(1)}% < ${target.minMedianTrustFrom}%`, (target.minMedianTrustFrom - s.medianMinTrustFrom) / 100)
  }
  if (target.maxDeathDropWithoutEvents !== undefined && eventsOff !== undefined) {
    const off = summarize(eventsOff)
    const drop = deathRate - off.deaths / off.runs
    if (drop > target.maxDeathDropWithoutEvents) {
      rateMiss(`events off: death rate ${pct(off.deaths / off.runs)}, ${pct(drop)} lower`, drop - target.maxDeathDropWithoutEvents)
    }
  }
  return misses
}

export function formatClock(sec: number): string {
  const s = Math.floor(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
