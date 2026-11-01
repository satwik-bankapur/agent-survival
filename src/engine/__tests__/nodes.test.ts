import { describe, expect, it } from 'vitest'

import { DEFAULT_CATALOG } from '../catalog'
import { cacheHitChance, CacheLookup, guardrailVerdict, rollCacheLookup, routerPick, Verdict } from '../nodes'
import { enqueue } from '../nodes/pipeline'
import { Rng } from '../rng'
import { Loc } from '../types'
import { link, makePacket, nodeOfType, place, quietEngine, ticks, unlink } from './helpers'

const N = 100_000

describe('prompt router (D32)', () => {
  it('sends 94% of simple chats to Fast SLM and 94% of complex chats to Frontier', () => {
    const rng = new Rng(3)
    let simpleToSlm = 0
    let complexToFrontier = 0
    for (let i = 0; i < N; i++) {
      if (routerPick(rng, 0.94, 'SIMPLE', true, true) === 'SMALL_MODEL') simpleToSlm++
      if (routerPick(rng, 0.94, 'COMPLEX', true, true) === 'LARGE_MODEL') complexToFrontier++
    }
    expect(Math.abs(simpleToSlm / N - 0.94)).toBeLessThan(0.005)
    expect(Math.abs(complexToFrontier / N - 0.94)).toBeLessThan(0.005)
  })

  it('sends everything to the one model kind that is linked, and nothing when none is', () => {
    const rng = new Rng(3)
    expect(routerPick(rng, 0.94, 'COMPLEX', true, false)).toBe('SMALL_MODEL')
    expect(routerPick(rng, 0.94, 'SIMPLE', false, true)).toBe('LARGE_MODEL')
    expect(routerPick(rng, 0.94, 'SIMPLE', false, false)).toBeNull()
  })

  it('routes on the board: a complex chat reaches Frontier through the router', () => {
    const engine = quietEngine({ nodes: { PROMPT_ROUTER: { accuracy: 1 } } })
    const w = engine.world
    const router = place(engine, 'PROMPT_ROUTER', 8, 9)
    const slm = place(engine, 'FAST_SLM', 14, 8)
    const frontier = nodeOfType(w, 'FRONTIER_API')
    link(engine, router, slm)
    link(engine, router, frontier)
    const simple = makePacket(w, 'SIMPLE')
    const complex = makePacket(w, 'COMPLEX')
    enqueue(router, simple)
    enqueue(router, complex)
    // Pulled at tick 0, routed at tick 1 (40 ms rounds to one tick).
    ticks(engine, 2)
    expect(simple.loc).toBe(Loc.EDGE)
    expect(w.edgeById[simple.edgeId]?.to).toBe(slm.id)
    expect(w.edgeById[complex.edgeId]?.to).toBe(frontier.id)
  })
})

describe('semantic cache (D15)', () => {
  const spec = DEFAULT_CATALOG.nodes.SEMANTIC_CACHE

  it('warms up as maxHit × (1 − e^(−lookups ÷ 150))', () => {
    expect(cacheHitChance(spec, 'SIMPLE', 0)).toBe(0)
    expect(cacheHitChance(spec, 'SIMPLE', 150)).toBeCloseTo(0.4 * (1 - Math.exp(-1)), 12)
    expect(cacheHitChance(spec, 'COMPLEX', 300)).toBeCloseTo(0.08 * (1 - Math.exp(-2)), 12)
    expect(cacheHitChance(spec, 'SIMPLE', 1e9)).toBeCloseTo(0.4, 12)
  })

  it('hits at its warm rate, and 1.5% of hits are wrong', () => {
    const rng = new Rng(5)
    let hits = 0
    let wrong = 0
    const lookups = 4 * N
    for (let i = 0; i < lookups; i++) {
      const r = rollCacheLookup(rng, spec, 'SIMPLE', 1e9)
      if (r !== CacheLookup.MISS) hits++
      if (r === CacheLookup.WRONG_HIT) wrong++
    }
    expect(Math.abs(hits / lookups - 0.4)).toBeLessThan(0.005)
    expect(Math.abs(wrong / hits - 0.015)).toBeLessThan(0.0015)
  })

  it('hits at the warm-up curve while cold', () => {
    const rng = new Rng(6)
    let hits = 0
    for (let i = 0; i < N; i++) if (rollCacheLookup(rng, spec, 'SIMPLE', 150) !== CacheLookup.MISS) hits++
    expect(Math.abs(hits / N - cacheHitChance(spec, 'SIMPLE', 150))).toBeLessThan(0.005)
  })

  it('sends a hit straight to the nearest Users out, skipping the guardrail', () => {
    const engine = quietEngine({ nodes: { SEMANTIC_CACHE: { warmupLookups: 1e-9, maxHitRate: { SIMPLE: 1 } } } })
    const w = engine.world
    const cache = place(engine, 'SEMANTIC_CACHE', 5, 9)
    const guard = place(engine, 'OUTPUT_GUARDRAIL', 19, 9)
    const frontier = nodeOfType(w, 'FRONTIER_API')
    const usersOut = nodeOfType(w, 'USERS_OUT')
    link(engine, cache, frontier)
    link(engine, frontier, guard)
    unlink(engine, frontier, usersOut)
    link(engine, guard, usersOut)

    const p = makePacket(w, 'SIMPLE')
    enqueue(cache, p)
    engine.tick()
    engine.tick()
    expect(p.loc).toBe(Loc.VIRTUAL)
    expect(p.nodeId).toBe(usersOut.id)
    expect(p.cacheHit).toBe(true)
    // (5, 9) to (23, 9) is 18 tiles: transit clamps to 8 ticks (D30).
    expect(p.transitTicks).toBe(8)
    ticks(engine, 10)
    expect(w.stats.served).toBe(1)
    expect(w.stats.cacheHits).toBe(1)
    expect(w.stats.modelCalls).toBe(0)
    expect(guard.processed).toBe(0)
  })
})

describe('output guardrail (D16)', () => {
  const spec = DEFAULT_CATALOG.nodes.OUTPUT_GUARDRAIL

  it('catches 85% of wrong answers and flags 1% of good ones', () => {
    const engine = quietEngine()
    const rng = new Rng(8)
    const wrong = makePacket(engine.world)
    wrong.isHallucinated = true
    const good = makePacket(engine.world)
    let caught = 0
    let flagged = 0
    for (let i = 0; i < N; i++) {
      if (guardrailVerdict(rng, spec, wrong) === Verdict.REFUSE) caught++
      if (guardrailVerdict(rng, spec, good) === Verdict.REFUSE) flagged++
    }
    expect(Math.abs(caught / N - 0.85)).toBeLessThan(0.005)
    expect(Math.abs(flagged / N - 0.01)).toBeLessThan(0.0015)
  })

  it('retries malformed JSON once, then refuses', () => {
    const engine = quietEngine()
    const rng = new Rng(1)
    const p = makePacket(engine.world)
    p.isMalformedJson = true
    expect(guardrailVerdict(rng, spec, p)).toBe(Verdict.RETRY)
    p.hasRetriedSchema = true
    expect(guardrailVerdict(rng, spec, p)).toBe(Verdict.REFUSE)
  })

  it('sends malformed JSON back to the model that made it, which pays again, then refuses the second failure', () => {
    const engine = quietEngine({ nodes: { FAST_SLM: { malformedJsonRate: 1, wrongRate: { SIMPLE: 0 } } } })
    const w = engine.world
    const slm = place(engine, 'FAST_SLM', 14, 8)
    const guard = place(engine, 'OUTPUT_GUARDRAIL', 19, 9)
    link(engine, slm, guard)
    link(engine, guard, nodeOfType(w, 'USERS_OUT'))
    enqueue(slm, makePacket(w, 'SIMPLE'))
    ticks(engine, 100)
    expect(w.stats.modelCalls).toBe(2)
    expect(w.stats.jsonRetries).toBe(1)
    expect(w.stats.tokenSpend).toBeCloseTo(2 * 0.036, 10)
    expect(w.stats.refused).toBe(1)
    expect(w.stats.brokenAnswers).toBe(0)
    expect(w.stats.served).toBe(0)
  })

  it('without a guardrail, malformed JSON reaches users as a broken answer', () => {
    const engine = quietEngine({ nodes: { FAST_SLM: { malformedJsonRate: 1 } } })
    const w = engine.world
    const slm = place(engine, 'FAST_SLM', 14, 8)
    link(engine, slm, nodeOfType(w, 'USERS_OUT'))
    enqueue(slm, makePacket(w, 'SIMPLE'))
    ticks(engine, 40)
    expect(w.stats.brokenAnswers).toBe(1)
    expect(w.stats.revenue).toBe(0)
  })

  it('turns a caught wrong answer into a refusal that earns nothing and never draws a complaint', () => {
    const engine = quietEngine({
      nodes: { FAST_SLM: { malformedJsonRate: 0, wrongRate: { SIMPLE: 1 } }, OUTPUT_GUARDRAIL: { catchRate: 1 } },
    })
    const w = engine.world
    const slm = place(engine, 'FAST_SLM', 14, 8)
    const guard = place(engine, 'OUTPUT_GUARDRAIL', 19, 9)
    link(engine, slm, guard)
    link(engine, guard, nodeOfType(w, 'USERS_OUT'))
    enqueue(slm, makePacket(w, 'SIMPLE'))
    ticks(engine, 600)
    expect(w.stats.refused).toBe(1)
    expect(w.stats.revenue).toBe(0)
    expect(w.stats.complaints).toBe(0)
  })
})
