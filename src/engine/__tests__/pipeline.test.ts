import { describe, expect, it } from 'vitest'

import { DEFAULT_CATALOG } from '../catalog'
import { deliver } from '../EdgeRouter'
import { modelCallCost } from '../economy'
import { enqueue } from '../nodes/pipeline'
import { Loc } from '../types'
import { link, makePacket, nodeOfType, place, quietEngine, ticks } from './helpers'

/** $0.036: a simple chat on Fast SLM (section G). */
const SIMPLE_ON_SLM = 0.036

describe('section G unit economics', () => {
  it('costs a simple chat $0.036 on Fast SLM and $1.50 on Frontier', () => {
    const engine = quietEngine()
    const p = makePacket(engine.world, 'SIMPLE')
    expect(modelCallCost(DEFAULT_CATALOG.nodes.FAST_SLM, p)).toBeCloseTo(SIMPLE_ON_SLM, 10)
    expect(modelCallCost(DEFAULT_CATALOG.nodes.FRONTIER_API, p)).toBeCloseTo(1.5, 10)
    const c = makePacket(engine.world, 'COMPLEX')
    expect(modelCallCost(DEFAULT_CATALOG.nodes.FAST_SLM, c)).toBeCloseTo(0.096, 10)
    expect(modelCallCost(DEFAULT_CATALOG.nodes.FRONTIER_API, c)).toBeCloseTo(4.2, 10)
  })
})

describe('tick order (D24)', () => {
  it('removes expired packets from the queue before pulling, so dead packets never get processed', () => {
    const engine = quietEngine({ nodes: { FAST_SLM: { concurrency: 1 } } })
    const w = engine.world
    const slm = place(engine, 'FAST_SLM', 12, 5)
    link(engine, slm, nodeOfType(w, 'USERS_OUT'))

    const expired = makePacket(w, 'SIMPLE', -1)
    const alive = makePacket(w, 'SIMPLE')
    enqueue(slm, expired)
    enqueue(slm, alive)
    engine.tick()

    expect(w.stats.timeouts).toBe(1)
    expect(slm.busy).toBe(1)
    expect(slm.workers[0]).toBe(alive.index)
    expect(alive.loc).toBe(Loc.WORKER)

    // Only the live packet is ever charged.
    ticks(engine, 20)
    expect(w.stats.modelCalls).toBe(1)
    expect(w.stats.tokenSpend).toBeCloseTo(SIMPLE_ON_SLM, 10)
  })

  it('charges tokens for a packet that expires mid-processing, then counts it as a timeout', () => {
    const engine = quietEngine()
    const w = engine.world
    const slm = place(engine, 'FAST_SLM', 12, 5)
    link(engine, slm, nodeOfType(w, 'USERS_OUT'))
    const budgetBefore = w.budget

    // Fast SLM takes 12 ticks on a simple chat; this one's deadline passes after 2.
    enqueue(slm, makePacket(w, 'SIMPLE', 2))
    ticks(engine, 20)

    expect(w.stats.modelCalls).toBe(1)
    expect(w.stats.tokenSpend).toBeCloseTo(SIMPLE_ON_SLM, 10)
    expect(w.stats.timeouts).toBe(1)
    expect(w.stats.revenue).toBe(0)
    expect(w.stats.served).toBe(0)
    const upkeep = 20 * w.upkeepPerTick
    expect(w.budget).toBeCloseTo(budgetBefore - SIMPLE_ON_SLM - upkeep, 10)
  })

  it('counts a late finish at a non-model node as a timeout without charging tokens', () => {
    const engine = quietEngine()
    const w = engine.world
    const router = place(engine, 'PROMPT_ROUTER', 8, 9)
    link(engine, router, nodeOfType(w, 'FRONTIER_API'))
    const p = makePacket(w, 'SIMPLE', 0)
    enqueue(router, p)
    // Pulled at tick 0 (not yet expired), finishes at tick 1, past its deadline.
    ticks(engine, 2)
    expect(w.stats.timeouts).toBe(1)
    expect(w.stats.tokenSpend).toBe(0)
  })

  it('delivers a packet after exactly its transit time', () => {
    const engine = quietEngine()
    const w = engine.world
    const edge = w.edges[0] // Users in → Frontier A: 10 tiles, so 6 ticks (D30)
    expect(edge.transitTicks).toBe(6)
    const frontier = nodeOfType(w, 'FRONTIER_API')
    const p = makePacket(w)
    w.edges[0].ring[0] = p.index
    edge.length = 1
    p.loc = Loc.EDGE
    p.enterTick = 0
    p.transitTicks = edge.transitTicks
    ticks(engine, 6)
    expect(p.loc).toBe(Loc.EDGE)
    engine.tick()
    // Delivered in step 3 of tick 6, then pulled into a worker in step 4 of the same tick.
    expect(p.loc).toBe(Loc.WORKER)
    expect(frontier.busy).toBe(1)
  })
})

describe('queues and workers (D24, D25)', () => {
  it('drops arrivals at a full queue with "Queue full"', () => {
    const engine = quietEngine({ nodes: { FAST_SLM: { concurrency: 1, queueCapacity: 2 } } })
    const w = engine.world
    const slm = place(engine, 'FAST_SLM', 12, 5)
    for (let i = 0; i < 4; i++) deliver(w, slm, makePacket(w))
    expect(slm.queueLength).toBe(2)
    expect(w.stats.queueFullDrops).toBe(2)
    expect(slm.drops).toBe(2)
    expect(w.incidents.entries.at(-1)?.text).toBe("Fast SLM's queue is full. New prompts are being dropped.")
  })

  it('never makes a finished worker wait, even when the next queue is full', () => {
    const engine = quietEngine({
      nodes: { FAST_SLM: { concurrency: 1 }, OUTPUT_GUARDRAIL: { concurrency: 1, queueCapacity: 1 } },
    })
    const w = engine.world
    const slm = place(engine, 'FAST_SLM', 12, 5)
    const guard = place(engine, 'OUTPUT_GUARDRAIL', 17, 7)
    link(engine, slm, guard)
    link(engine, guard, nodeOfType(w, 'USERS_OUT'))

    // Fill the guardrail: one in work, one queued, with long deadlines.
    enqueue(guard, makePacket(w, 'SIMPLE', 10_000))
    engine.tick()
    enqueue(guard, makePacket(w, 'SIMPLE', 10_000))
    // Stall the guardrail so it stays full.
    guard.workerFinishTick[0] = 1_000_000

    const first = makePacket(w, 'SIMPLE', 10_000)
    const second = makePacket(w, 'SIMPLE', 10_000)
    enqueue(slm, first)
    enqueue(slm, second)
    engine.tick()
    expect(slm.workers[0]).toBe(first.index)

    ticks(engine, 12)
    // The first finished, left on the wire, and the second took its worker in the same tick.
    expect(first.loc).toBe(Loc.EDGE)
    expect(slm.workers[0]).toBe(second.index)

    // On arrival the full guardrail drops it, instead of anything upstream blocking.
    ticks(engine, 10)
    expect(w.stats.queueFullDrops).toBe(1)
    expect(guard.drops).toBe(1)
  })

  it('shares one concurrency pool across Frontier nodes on the same provider (D14)', () => {
    const engine = quietEngine({ nodes: { FRONTIER_API: { providerLimit: 3 } } })
    const w = engine.world
    const a = nodeOfType(w, 'FRONTIER_API')
    const b = place(engine, 'FRONTIER_API', 12, 13)
    expect(b.label).toBe('Frontier A 2')
    for (let i = 0; i < 3; i++) {
      enqueue(a, makePacket(w, 'SIMPLE', 10_000))
      enqueue(b, makePacket(w, 'SIMPLE', 10_000))
    }
    engine.tick()
    expect(a.busy + b.busy).toBe(3)
    expect(w.providers[0].inFlight).toBe(3)
    expect(a.queueLength + b.queueLength).toBe(3)
  })

  it('drops a packet with no outgoing link as "No route"', () => {
    const engine = quietEngine()
    const w = engine.world
    const slm = place(engine, 'FAST_SLM', 12, 5)
    enqueue(slm, makePacket(w))
    ticks(engine, 13)
    expect(w.stats.noRouteDrops).toBe(1)
    expect(w.incidents.entries.at(-1)?.text).toBe('Fast SLM has no route. Link it to something downstream.')
  })
})
