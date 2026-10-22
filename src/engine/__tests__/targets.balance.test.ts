import { describe, expect, it } from 'vitest'

import {
  catalogFor,
  checkTarget,
  CLASSIC_SCENARIOS,
  PHASE2_SCENARIOS,
  PHASE3_SCENARIOS,
  PHASE4_SCENARIOS,
  referenceIdOf,
  runScenario,
  scenarioById,
  type RunResult,
  type Scenario,
} from '../scenarios'

/*
 * The balance targets, on 20 seeds to keep the suite fast: decisions section G in classic mode
 * (D40), D49 on phase 2 traffic, I-4 on phase 3, and J-6 on phase 4. `npm run balance` checks the same targets on 40. If one
 * misses, tune catalog.ts and log it in docs/decisions.md. Never widen a range.
 */
const SEEDS = 20
// Agents on Fast SLM sit near their target, where 20 seeds are too noisy: they run on 40 (I-4).
const FORTY_SEEDS = new Set(['p3-slm-agents'])

function runAll(scenario: Scenario, eventsOff: boolean): RunResult[] {
  const results: RunResult[] = []
  const seeds = FORTY_SEEDS.has(scenario.id) ? 40 : SEEDS
  for (let seed = 1; seed <= seeds; seed++) results.push(runScenario(scenario, seed, undefined, catalogFor(scenario, eventsOff)))
  return results
}

function check(scenario: Scenario): string[] {
  const off = scenario.target.maxDeathDropWithoutEvents !== undefined ? runAll(scenario, true) : undefined
  const refId = referenceIdOf(scenario.target)
  const refScenario = refId === undefined ? undefined : scenarioById(refId)
  const reference = refScenario === undefined ? undefined : runAll(refScenario, false)
  return checkTarget(scenario.target, runAll(scenario, false), off, reference).map((m) => m.text)
}

describe('balance targets, classic mode (decisions section G)', () => {
  it.each(CLASSIC_SCENARIOS.map((s) => [s.label, s] as const))('%s', (_label, scenario) => {
    expect(check(scenario), scenario.targetText).toEqual([])
  })
})

describe('balance targets, phase 2 (D49)', () => {
  it.each(PHASE2_SCENARIOS.map((s) => [s.label, s] as const))('%s', { timeout: 60_000 }, (_label, scenario) => {
    expect(check(scenario), scenario.targetText).toEqual([])
  })
})

describe('balance targets, phase 3 (I-4)', () => {
  it.each(PHASE3_SCENARIOS.map((s) => [s.label, s] as const))('%s', { timeout: 120_000 }, (_label, scenario) => {
    expect(check(scenario), scenario.targetText).toEqual([])
  })
})

describe('balance targets, phase 4 (J-6)', () => {
  it.each(PHASE4_SCENARIOS.map((s) => [s.label, s] as const))('%s', { timeout: 300_000 }, (_label, scenario) => {
    expect(check(scenario), scenario.targetText).toEqual([])
  })
})
