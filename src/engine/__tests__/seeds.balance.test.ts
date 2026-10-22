import { describe, expect, it } from 'vitest'

import { classicCatalog, ticksPerSecond } from '../catalog'
import { GameEngine } from '../GameEngine'
import { attachScenario, scenarioById } from '../scenarios'
import { arrivalRate, TRAFFIC_WINDOW_SEC } from '../WaveDirector'
import { eventsOf, quietEngine, ticks } from './helpers'

/*
 * Statistics over many seeds (the incident director, the traffic readout): slow, so they run with
 * the balance targets (npm run test:balance), not in npm test.
 */

describe('incident director over 40 seeds (D48)', () => {
  it('never overlaps events, never repeats a kind twice running, and runs about 5 in 5:00', { timeout: 30_000 }, () => {
    let total = 0
    const seeds = 40
    for (let seed = 1; seed <= seeds; seed++) {
      const events = eventsOf('p2-naive', seed)
      for (let i = 1; i < events.length; i++) {
        expect(events[i].start).toBeGreaterThanOrEqual(events[i - 1].end)
        expect(events[i].kind).not.toBe(events[i - 1].kind)
      }
      expect(events.every((e) => e.kind !== 'JAILBREAK' || e.start >= 135 * 20)).toBe(true)
      expect(events.every((e) => e.kind !== 'CACHE_WIPE' || e.start >= 120 * 20)).toBe(true)
      total += events.length
    }
    expect(total / seeds).toBeGreaterThanOrEqual(4.5)
    expect(total / seeds).toBeLessThanOrEqual(5.5)
  })

})

describe('phase 4 chaos over 20 seeds (J-4)', () => {
  it("starts phase 4's events only from 9:00, and outages on both providers", { timeout: 30_000 }, () => {
    const fourth = new Set(['provider outage', 'cache invalidation', 'drift surge', 'traffic surge'])
    let outages = 0
    for (let seed = 1; seed <= 20; seed++) {
      const engine = quietEngine({ director: { enabled: true } }, seed)
      ticks(engine, 15 * 60 * 20)
      for (const m of engine.world.runLog.markers) {
        if (m.kind !== 'EVENT' || !fourth.has(m.text)) continue
        expect(m.tick).toBeGreaterThanOrEqual(540 * 20)
        if (m.text === 'provider outage') outages++
      }
    }
    expect(outages).toBeGreaterThan(10)
  })

})

describe('traffic readout over 100 seeds', () => {
  const full = scenarioById('full')
  if (full === undefined) throw new Error('No full scenario')

  /** Mean λ over the window that ends with the tick the snapshot was built on. */
  function windowLambda(engine: GameEngine): number {
    const catalog = engine.world.catalog
    const tps = ticksPerSecond(catalog)
    const last = engine.world.traffic.lastTick
    const n = TRAFFIC_WINDOW_SEC * tps
    let sum = 0
    for (let t = last - n + 1; t <= last; t++) sum += arrivalRate(catalog, t / tps)
    return sum / n
  }

  it.each([72, 280])('tracks λ(t) at %i s within Poisson noise, measured at Users in', (sec) => {
    const seeds = 100
    let readouts = 0
    let lambdas = 0
    for (let seed = 1; seed <= seeds; seed++) {
      // Classic traffic: λ(t) is the whole story there, with no director events bending it.
      const engine = new GameEngine({ seed, catalog: classicCatalog() })
      attachScenario(engine, full)
      const ticks = sec * ticksPerSecond(engine.world.catalog)
      for (let t = 0; t < ticks; t++) engine.tick()
      const lambda = windowLambda(engine)
      const rate = engine.snapshot.traffic.ratePerSec
      // One seed: the window's count is Poisson with mean λ × 5 s.
      const mu = lambda * TRAFFIC_WINDOW_SEC
      expect(Math.abs(rate * TRAFFIC_WINDOW_SEC - mu), `seed ${seed}`).toBeLessThanOrEqual(4.5 * Math.sqrt(mu))
      readouts += rate
      lambdas += lambda
    }
    // Across seeds: the mean readout is within 3 standard errors of the mean λ.
    const meanLambda = lambdas / seeds
    const standardError = Math.sqrt(meanLambda / TRAFFIC_WINDOW_SEC / seeds)
    expect(Math.abs(readouts / seeds - meanLambda)).toBeLessThan(3 * standardError)
  }, 30_000)
})
