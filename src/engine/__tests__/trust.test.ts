import { describe, expect, it } from 'vitest'

import { deliver } from '../EdgeRouter'
import { buildSnapshot } from '../telemetry'
import { decayTrust, recordOutcome, trustValue } from '../trust'
import { makePacket, nodeOfType, quietEngine, ticks } from './helpers'

const DECAY = Math.exp(-0.05 / 30)

describe('trust (D8)', () => {
  it('starts at 100 and stays there with no outcomes', () => {
    const engine = quietEngine()
    ticks(engine, 1000)
    expect(trustValue(engine.world.trust)).toBeCloseTo(100, 10)
  })

  it('matches the closed form of the decaying S ÷ N ratio', () => {
    const engine = quietEngine()
    const w = engine.world
    recordOutcome(w, 'FAILED')
    for (let i = 0; i < 400; i++) decayTrust(w.trust)
    recordOutcome(w, 'GOOD')
    recordOutcome(w, 'REFUSED')
    for (let i = 0; i < 100; i++) decayTrust(w.trust)
    const s = ((90 - 3) * DECAY ** 400 + 1 + 0.5) * DECAY ** 100
    const n = (91 * DECAY ** 400 + 2) * DECAY ** 100
    expect(w.trust.s).toBeCloseTo(s, 10)
    expect(w.trust.n).toBeCloseTo(n, 10)
    expect(trustValue(w.trust)).toBeCloseTo((100 * s) / n, 8)
  })

  it('scores outcomes as the D8 table says', () => {
    const engine = quietEngine()
    const w = engine.world
    const scores = { GOOD: 1, THROTTLED: 0.8, REFUSED: 0.5, FAILED: -3, WRONG: -14 } as const
    for (const [kind, score] of Object.entries(scores)) {
      const before = w.trust.s
      recordOutcome(w, kind as keyof typeof scores)
      expect(w.trust.s - before).toBeCloseTo(score, 12)
    }
  })
})

describe('trust game over (D9)', () => {
  it('ends the run after 15 continuous seconds below 25%', () => {
    const engine = quietEngine()
    const w = engine.world
    w.trust.s = 0
    ticks(engine, 299)
    expect(w.gameOver).toBeNull()
    expect(buildSnapshot(w).trust.criticalSecondsLeft).toBeCloseTo(0.05, 10)
    engine.tick()
    expect(w.gameOver).toEqual({ cause: 'TRUST', tick: 299 })
  })

  it('resets the countdown when trust recovers', () => {
    const engine = quietEngine()
    const w = engine.world
    w.trust.s = 0
    ticks(engine, 200)
    expect(w.trust.criticalTicks).toBe(200)
    w.trust.s = w.trust.n
    engine.tick()
    expect(w.trust.criticalTicks).toBe(0)
    w.trust.s = 0
    ticks(engine, 299)
    expect(w.gameOver).toBeNull()
  })
})

describe('complaints (D10)', () => {
  it('land 5 to 15 seconds after a wrong answer exits', () => {
    const delays: number[] = []
    for (let seed = 1; seed <= 200; seed++) {
      const engine = quietEngine({}, seed)
      const w = engine.world
      ticks(engine, 7)
      const p = makePacket(w)
      p.isHallucinated = true
      const exitTick = w.tick
      deliver(w, nodeOfType(w, 'USERS_OUT'), p)
      while (w.stats.complaints === 0 && w.tick < 1000) engine.tick()
      delays.push(w.tick - 1 - exitTick)
    }
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(100)
    expect(Math.max(...delays)).toBeLessThanOrEqual(300)
    // Spread across the whole window, not bunched.
    expect(Math.min(...delays)).toBeLessThan(120)
    expect(Math.max(...delays)).toBeGreaterThan(280)
  })

  it('pays like a good answer at exit, then corrects it to one −14 outcome', () => {
    const run = (wrong: boolean) => {
      const engine = quietEngine({}, 3)
      const w = engine.world
      const p = makePacket(w)
      p.isHallucinated = wrong
      deliver(w, nodeOfType(w, 'USERS_OUT'), p)
      return engine
    }
    const wrong = run(true)
    const good = run(false)
    // At exit nothing tells them apart.
    expect(wrong.world.budget).toBe(good.world.budget)
    expect(wrong.world.trust.s).toBe(good.world.trust.s)
    expect(wrong.world.trust.n).toBe(good.world.trust.n)

    while (wrong.world.stats.complaints === 0) {
      wrong.tick()
      good.tick()
    }
    const after = 50
    ticks(wrong, after)
    ticks(good, after)
    // The complaint moved S by −15 (from +1 to −14) and left N alone, then both decayed: once in
    // step 6 of the complaint's own tick (events fire in step 5), then once per tick after.
    expect(wrong.world.trust.n).toBeCloseTo(good.world.trust.n, 10)
    expect(wrong.world.trust.s - good.world.trust.s).toBeCloseTo(-15 * DECAY ** (after + 1), 8)
    expect(wrong.world.incidents.entries.at(-1)?.text).toBe('Users reported a wrong answer.')
    expect(wrong.world.incidents.entries.at(-1)?.nodeId).toBe(nodeOfType(wrong.world, 'USERS_OUT').id)
  })
})
