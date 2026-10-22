import { describe, expect, it } from 'vitest'

import { deliver } from '../EdgeRouter'
import { enqueue } from '../nodes/pipeline'
import { makePacket, nodeOfType, place, quietEngine, ticks } from './helpers'

describe('economy (D1–D4)', () => {
  it('pays revenue when an answer reaches Users out: $0.30 simple, $5.00 complex', () => {
    const engine = quietEngine()
    const w = engine.world
    const usersOut = nodeOfType(w, 'USERS_OUT')
    deliver(w, usersOut, makePacket(w, 'SIMPLE'))
    expect(w.budget).toBeCloseTo(500.3, 10)
    deliver(w, usersOut, makePacket(w, 'COMPLEX'))
    expect(w.budget).toBeCloseTo(505.3, 10)
  })

  it('pays nothing for refusals, timeouts and broken answers', () => {
    const engine = quietEngine()
    const w = engine.world
    const usersOut = nodeOfType(w, 'USERS_OUT')
    const refused = makePacket(w)
    refused.refused = true
    const late = makePacket(w, 'SIMPLE', -1)
    const broken = makePacket(w)
    broken.isMalformedJson = true
    deliver(w, usersOut, refused)
    deliver(w, usersOut, late)
    deliver(w, usersOut, broken)
    expect(w.budget).toBe(500)
    expect(w.stats.refused).toBe(1)
    expect(w.stats.timeouts).toBe(1)
    expect(w.stats.brokenAnswers).toBe(1)
  })

  it('charges token cost when a model call completes, not when it starts', () => {
    const engine = quietEngine()
    const w = engine.world
    const frontier = nodeOfType(w, 'FRONTIER_API')
    enqueue(frontier, makePacket(w, 'SIMPLE'))
    engine.tick()
    expect(frontier.busy).toBe(1)
    expect(w.budget).toBe(500)
    // 2.4 s = 48 ticks: pulled at tick 0, done at tick 48.
    ticks(engine, 47)
    expect(w.budget).toBe(500)
    engine.tick()
    expect(w.budget).toBeCloseTo(498.5, 10)
  })

  it('charges upkeep every tick at upkeep ÷ 1,200 (D2)', () => {
    const engine = quietEngine()
    const w = engine.world
    place(engine, 'FAST_SLM', 14, 8)
    expect(w.budget).toBe(440)
    ticks(engine, 1200)
    expect(w.budget).toBeCloseTo(440 - 30, 8)
    expect(w.stats.upkeep).toBeCloseTo(30, 8)
  })

  it('refunds half the build cost on demolish', () => {
    const engine = quietEngine()
    const w = engine.world
    const slm = place(engine, 'FAST_SLM', 14, 8)
    expect(engine.applyNow({ type: 'demolish', nodeId: slm.id })).toEqual({ ok: true })
    expect(w.budget).toBe(470)
  })

  it('allows building in debt, but not a purchase that reaches −$1,000 (D4)', () => {
    const engine = quietEngine()
    const w = engine.world
    w.budget = -960
    expect(engine.dispatch({ type: 'placeNode', nodeType: 'FAST_SLM', x: 14, y: 8 })).toEqual({
      ok: false,
      reason: 'Needs $21 more',
    })
    w.budget = -940
    expect(engine.dispatch({ type: 'placeNode', nodeType: 'FAST_SLM', x: 14, y: 8 })).toEqual({
      ok: false,
      reason: 'Needs $1 more',
    })
    w.budget = -939.5
    expect(engine.applyNow({ type: 'placeNode', nodeType: 'FAST_SLM', x: 14, y: 8 }).ok).toBe(true)
    expect(w.budget).toBeCloseTo(-999.5, 10)
  })

  it('ends the run when the budget reaches −$1,000', () => {
    const engine = quietEngine()
    const w = engine.world
    w.budget = -1000
    engine.tick()
    expect(w.gameOver).toEqual({ cause: 'BANKRUPT', tick: 0 })
    const tick = w.tick
    engine.tick()
    expect(w.tick).toBe(tick)
  })
})
