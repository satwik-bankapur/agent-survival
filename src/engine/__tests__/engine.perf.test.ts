import { describe, expect, it } from 'vitest'

import { GameEngine } from '../GameEngine'
import { attachScenario, catalogFor, scenarioById } from '../scenarios'

/**
 * CPU time, not wall time. Wall time counts the milliseconds this process sat
 * descheduled while something else held the cores (the balance suite, a build, a
 * browser), so a wall-clock budget fails with the engine untouched: under the balance
 * suite these same 6,000 ticks measured 181 ms of wall against 32 ms idle. CPU time
 * measures the work done, which is what the budget is about.
 */
function cpuMs(): number {
  const { user, system } = process.cpuUsage()
  return (user + system) / 1000
}

function timedRun(id: string, seed: number): number {
  const scenario = scenarioById(id)
  if (scenario === undefined) throw new Error(id)
  const engine = new GameEngine({ seed, catalog: catalogFor(scenario) })
  attachScenario(engine, scenario)
  const start = cpuMs()
  for (let t = 0; t < 6000; t++) engine.tick()
  const elapsed = cpuMs() - start
  expect(engine.world.tick).toBeGreaterThan(0)
  return elapsed
}

describe('performance', () => {
  it.each(['full', 'p2-full'])('runs 6,000 ticks of the %s build in under 200 ms of CPU', (id) => {
    // Best of three, after the first warms the JIT. cpuUsage() counts every thread in
    // the process, so V8's background compiles land on the early runs; the minimum sheds them.
    const times = [timedRun(id, 1), timedRun(id, 2), timedRun(id, 3)]
    expect(Math.min(...times)).toBeLessThan(200)
  })
})
