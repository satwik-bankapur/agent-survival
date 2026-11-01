import { describe, expect, it } from 'vitest'

import { makeCatalog, ticksPerSecond } from '../catalog'
import { GameEngine } from '../GameEngine'
import { attachScenario, scenarioById } from '../scenarios'
import { NODE_TYPES, type TelemetrySnapshot } from '../types'
import { packetView, retrievalTelemetry } from '../telemetry'
import { TRAFFIC_WINDOW_SEC } from '../WaveDirector'
import { deliver } from '../EdgeRouter'
import { BOARD_EFFECTS_SIZE, BoardEffect } from '../events'
import { enqueue } from '../nodes/pipeline'
import { makePacket, nodeOfType, place, quietEngine, ticks } from './helpers'

function naiveRun(wrongRate: number) {
  const engine = new GameEngine({
    seed: 21,
    catalog: makeCatalog({ nodes: { FRONTIER_API: { wrongRate: { SIMPLE: wrongRate, COMPLEX: wrongRate } } } }),
  })
  const snapshots: TelemetrySnapshot[] = []
  engine.onSnapshot = (s) => snapshots.push(s)
  return { engine, snapshots }
}

/** Every key anywhere in a value. */
function keysOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) keysOf(item, out)
  else if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      out.add(key)
      keysOf(child, out)
    }
  }
  return out
}

describe('the snapshot never leaks an unrevealed wrong answer (D10, D11)', () => {
  it('is identical whether every answer is right or every answer is wrong, until users complain', () => {
    const right = naiveRun(0)
    const wrong = naiveRun(1)
    let firstExit = -1
    for (let t = 0; t < 2000; t++) {
      right.engine.tick()
      wrong.engine.tick()
      if (firstExit < 0 && wrong.engine.world.stats.served > 0) firstExit = t
    }
    expect(firstExit).toBeGreaterThan(0)
    expect(wrong.engine.world.stats.wrongServed).toBeGreaterThan(50)

    // Complaints land at least 5 s (100 ticks) after a wrong answer exits.
    const quietUntil = firstExit + 100
    const before = (s: TelemetrySnapshot) => s.tick < quietUntil
    const rightBefore = right.snapshots.filter(before)
    const wrongBefore = wrong.snapshots.filter(before)
    expect(wrongBefore.length).toBeGreaterThan(20)
    expect(wrongBefore).toEqual(rightBefore)

    // By then a few wrong answers had already reached users, unrevealed.
    const exitedUnrevealed = wrong.engine.world.stats.wrongServed
    expect(exitedUnrevealed).toBeGreaterThan(0)

    // And once complaints arrive, the snapshot does show them: the test can see a difference.
    expect(wrong.snapshots.at(-1)).not.toEqual(right.snapshots.at(-1))
    const reported = wrong.snapshots.at(-1)?.trust.strip.reduce((sum, b) => sum + b.wrongReported, 0) ?? 0
    expect(reported).toBeGreaterThan(0)
  })

  it('has no ground-truth fields anywhere, phase 2 included', () => {
    const engine = new GameEngine({ seed: 4 })
    const scenario = scenarioById('p2-full')
    if (scenario === undefined) throw new Error('no p2-full scenario')
    attachScenario(engine, scenario)
    // Past 2:00, so RAG questions, attacks and PII are in flight.
    for (let t = 0; t < 4000; t++) engine.tick()
    // The Retrieval panel shows vector DB drift by design: it follows from time since the last
    // index, the same for every question, so the player could know it (decisions F). Exactly that, nothing more.
    expect(Object.keys(engine.snapshot.retrieval ?? {}).sort()).toEqual(['driftShare', 'reindexInSec'])
    // Node types (PII_REDACTOR and the like) key the price list; they name what's on sale, not a packet's truth.
    const { retrieval, ...rest } = engine.snapshot
    expect(retrieval).not.toBeNull()
    const keys = [...keysOf(rest)].filter((k) => !(NODE_TYPES as readonly string[]).includes(k))
    const forbidden = keys.filter((k) =>
      /halluc|malformed|wrongServed|wrongAnswers|producedBy|revealed|isWrong|cacheHit|drift|pii|malicious|injection|contextQuality|retrieval/i.test(k),
    )
    expect(forbidden).toEqual([])
  })
})

describe('snapshot contents', () => {
  it('reports money, trust, traffic, nodes and providers on the starting board', () => {
    const engine = new GameEngine({ seed: 2 })
    for (let t = 0; t < 1200; t++) engine.tick()
    const s = engine.snapshot
    expect(s.tick).toBe(1195)
    expect(s.phase.name).toBe('Wrapper startup')
    expect(s.phase.nextName).toBe('Knowledge crisis')
    // The naive board loses money on every simple chat.
    expect(s.money.netPerSec).toBeLessThan(0)
    expect(s.money.bankruptInSec).not.toBeNull()
    expect(s.money.history).toHaveLength(60)
    expect(s.trust.strip).toHaveLength(30)
    expect(s.traffic.ratePerSec).toBeGreaterThan(2)
    expect(s.traffic.ratePerSec).toBeLessThan(8)
    expect(s.traffic.categoryShare.CHAT).toBe(1)
    expect(s.traffic.next?.atSec).toBe(120)
    expect(s.nodes.map((n) => n.label)).toEqual(['Users in', 'Frontier A', 'Users out'])
    expect(s.providers).toEqual([{ name: 'A', inFlight: s.nodes[1].busy, limit: 64, down: false }])
    expect(s.incidents[0]?.text).toBeDefined()
    expect(s.incidents.some((i) => i.text === 'Spending is higher than revenue.')).toBe(true)
  })

  it('shows a node with nowhere to send as "no-route"', () => {
    const engine = new GameEngine({ seed: 2 })
    engine.applyNow({ type: 'placeNode', nodeType: 'FAST_SLM', x: 14, y: 8 })
    engine.tick()
    expect(engine.snapshot.nodes.find((n) => n.type === 'FAST_SLM')?.state).toBe('no-route')
  })

  it('carries the phase timeline, the critical countdown length and build prices for the HUD', () => {
    const engine = new GameEngine({ seed: 2 })
    engine.tick()
    const s = engine.snapshot
    expect(s.phases.map((p) => p.startSec)).toEqual([0, 120, 300, 540])
    expect(s.trust.criticalSec).toBe(15)
    expect(s.prices.FAST_SLM).toEqual({ name: 'Fast SLM', build: 60, upkeepPerMin: 30, refund: 30 })
    expect(s.prices.FRONTIER_API.upkeepPerMin).toBe(0)
    // Prices only: nothing about answer quality reaches the HUD (D11).
    expect(keysOf(s.prices).has('wrongRate')).toBe(false)
    // Built once per catalog, not on every snapshot.
    for (let t = 0; t < 5; t++) engine.tick()
    expect(engine.snapshot.prices).toBe(s.prices)
  })
})

describe('traffic readout', () => {
  it('follows a step in the arrival rate within the 5 s window', () => {
    const catalog = makeCatalog({
      traffic: { ratePoints: [{ sec: 0, perSec: 2 }, { sec: 30, perSec: 2 }, { sec: 30.001, perSec: 20 }, { sec: 600, perSec: 20 }], growthPerMinAfter: 0, spike: null },
      budget: { start: 1e9, gameOverAt: -1e12 },
      trust: { criticalSec: 1e9 },
    })
    const engine = new GameEngine({ seed: 4, catalog })
    const tps = ticksPerSecond(catalog)
    for (let t = 0; t < 30 * tps; t++) engine.tick()
    expect(engine.snapshot.traffic.ratePerSec).toBeLessThan(5)
    for (let t = 0; t < TRAFFIC_WINDOW_SEC * tps; t++) engine.tick()
    expect(engine.snapshot.traffic.ratePerSec).toBeGreaterThan(14)
    expect(engine.snapshot.traffic.ratePerSec).toBeLessThan(26)
  })

  it('counts arrivals the pool had to throttle: they still arrived', () => {
    const catalog = makeCatalog({ packetPoolSize: 1, traffic: { ratePoints: [{ sec: 0, perSec: 20 }], growthPerMinAfter: 0, spike: null } })
    const engine = new GameEngine({ seed: 5, catalog })
    for (let t = 0; t < 10 * ticksPerSecond(catalog); t++) engine.tick()
    expect(engine.world.stats.throttled).toBeGreaterThan(0)
    expect(engine.snapshot.traffic.ratePerSec).toBeGreaterThan(14)
  })
})

function fullScenario() {
  const scenario = scenarioById('full')
  if (scenario === undefined) throw new Error('No full scenario')
  return scenario
}

describe('retrieval panel (D46)', () => {
  it('is locked until a vector DB is placed, then shows its drift as a share of the cap', () => {
    // No director: a drift surge after 9:00 would push drift past its cap (J-4).
    const engine = quietEngine({ director: { enabled: false } })
    const w = engine.world
    expect(retrievalTelemetry(w)).toBeNull()
    place(engine, 'VECTOR_DB', 6, 4)
    expect(retrievalTelemetry(w)).toEqual({ driftShare: 0, reindexInSec: null })
    const minute = 60 * ticksPerSecond(w.catalog)
    ticks(engine, minute)
    const { driftPerMin, driftCap } = w.catalog.nodes.VECTOR_DB
    expect(retrievalTelemetry(w)?.driftShare).toBeCloseTo(driftPerMin / driftCap)
    ticks(engine, 10 * minute)
    expect(retrievalTelemetry(w)?.driftShare).toBe(1)
  })

  it('counts down to the next cron run, and a run resets the drift', () => {
    const engine = quietEngine()
    const w = engine.world
    const tps = ticksPerSecond(w.catalog)
    place(engine, 'VECTOR_DB', 6, 4)
    place(engine, 'INGESTION_CRON', 8, 4)
    const every = w.catalog.nodes.INGESTION_CRON.intervalSec
    expect(retrievalTelemetry(w)?.reindexInSec).toBeCloseTo(every)
    ticks(engine, 20 * tps)
    expect(retrievalTelemetry(w)?.reindexInSec).toBeCloseTo(every - 20)
    expect(retrievalTelemetry(w)?.driftShare).toBeGreaterThan(0)
    ticks(engine, (every - 20) * tps)
    expect(retrievalTelemetry(w)?.reindexInSec).toBe(0)
    // The cron fires in this tick's events step (D24).
    engine.tick()
    expect(retrievalTelemetry(w)?.driftShare).toBeLessThan(0.001)
    expect(retrievalTelemetry(w)?.reindexInSec).toBeGreaterThan(every - 0.1)
  })
})

describe('board effects', () => {
  it('records timeouts, cache hits and complaints in a ring that wraps in place', () => {
    const engine = new GameEngine({ seed: 3 })
    attachScenario(engine, fullScenario())
    const fx = engine.world.effects
    const kinds = fx.kinds
    for (let t = 0; t < 4800 && engine.world.gameOver === null; t++) engine.tick()
    expect(fx.kinds).toBe(kinds)
    expect(fx.total).toBeGreaterThan(BOARD_EFFECTS_SIZE)
    const seen = new Set<number>()
    for (let i = 0; i < BOARD_EFFECTS_SIZE; i++) seen.add(fx.kinds[i])
    expect([...seen].every((k) => (Object.values(BoardEffect) as number[]).includes(k))).toBe(true)
  })

  it('draws a wrong cache hit exactly like a right one, and a wrong answer only once users report it', () => {
    const engine = new GameEngine({
      seed: 8,
      catalog: makeCatalog({ nodes: { SEMANTIC_CACHE: { wrongHitRate: 1 } } }),
    })
    attachScenario(engine, fullScenario())
    let complaintsSeen = 0
    let read = 0
    for (let t = 0; t < 2400; t++) {
      engine.tick()
      const fx = engine.world.effects
      for (; read < fx.total; read++) if (fx.kinds[read % BOARD_EFFECTS_SIZE] === BoardEffect.COMPLAINT) complaintsSeen++
      // Every complaint effect matches a filed complaint, never an unrevealed wrong answer.
      expect(complaintsSeen).toBe(engine.world.stats.complaints)
    }
    expect(engine.world.stats.wrongCacheHits).toBeGreaterThan(complaintsSeen)
  })

  it('marks each arrival a full queue drops, at that node', () => {
    const engine = quietEngine()
    const w = engine.world
    const frontier = nodeOfType(w, 'FRONTIER_API')
    while (enqueue(frontier, makePacket(w))) {
      // Fill the queue.
    }
    const before = w.effects.total
    deliver(w, frontier, makePacket(w))
    deliver(w, frontier, makePacket(w))
    expect(w.effects.total - before).toBe(2)
    for (let i = before; i < w.effects.total; i++) {
      expect(w.effects.kinds[i % BOARD_EFFECTS_SIZE]).toBe(BoardEffect.QUEUE_FULL)
      expect(w.effects.nodeIds[i % BOARD_EFFECTS_SIZE]).toBe(frontier.id)
    }
  })

  it('marks revenue for complex answers only, and a wrong one exactly like a right one', () => {
    const engine = quietEngine()
    const w = engine.world
    const usersOut = nodeOfType(w, 'USERS_OUT')
    deliver(w, usersOut, makePacket(w, 'SIMPLE'))
    expect(w.effects.total).toBe(0)
    deliver(w, usersOut, makePacket(w, 'COMPLEX'))
    const wrong = makePacket(w, 'COMPLEX')
    wrong.isHallucinated = true
    deliver(w, usersOut, wrong)
    expect(w.effects.total).toBe(2)
    for (let i = 0; i < 2; i++) {
      expect(w.effects.kinds[i]).toBe(BoardEffect.REVENUE)
      expect(w.effects.nodeIds[i]).toBe(usersOut.id)
      expect(w.effects.amounts[i]).toBeCloseTo(5, 6)
      expect(w.effects.ticks[i]).toBe(w.tick)
    }
  })
})

describe('packet view (the X-ray)', () => {
  it('describes a live packet in player terms, and never whether its answer is wrong', () => {
    const engine = new GameEngine({ seed: 5, catalog: makeCatalog({ nodes: { FRONTIER_API: { wrongRate: { SIMPLE: 1, COMPLEX: 1 } } } }) })
    let seen = 0
    for (let t = 0; t < 400; t++) {
      engine.tick()
      const w = engine.world
      for (const p of w.pool.packets) {
        if (p.loc === 0) continue
        const view = packetView(w, p.index, p.serial)
        expect(view).not.toBeNull()
        expect(Object.keys(view ?? {}).some((k) => /halluc|wrong|revealed/i.test(k))).toBe(false)
        if (p.producedByModelId >= 0) {
          expect(view?.answeredBy).toBe('Frontier A')
          seen++
        }
      }
    }
    expect(seen).toBeGreaterThan(0)
  })

  it('returns null once the packet is gone or its slot is reused', () => {
    const engine = quietEngine()
    const w = engine.world
    const frontier = nodeOfType(w, 'FRONTIER_API')
    const p = makePacket(w)
    enqueue(frontier, p)
    expect(packetView(w, p.index, p.serial)?.where).toBe('Queued at Frontier A, first in line')
    expect(packetView(w, p.index, p.serial + 1)).toBeNull()
  })

  it("shows an agent run's bands, steps and compounded reliability, never its ground truth", () => {
    // Full M3 at 6:30: agent runs looping on Frontier B, PII in the traffic, a redactor at the door.
    const scenario = scenarioById('p3-full')
    if (scenario === undefined) throw new Error('p3-full missing')
    const engine = new GameEngine({ seed: 3 })
    attachScenario(engine, scenario)
    const w = engine.world
    const r = w.catalog.nodes.FRONTIER_API.stepReliability
    let looped = 0
    let redacted = 0
    for (let t = 0; t < 390 * ticksPerSecond(w.catalog); t++) engine.tick()
    for (let t = 0; t < 400; t++) {
      engine.tick()
      for (const p of w.pool.packets) {
        if (p.loc === 0) continue
        const view = packetView(w, p.index, p.serial)
        if (view === null) throw new Error('live packet without a view')
        const keys = [...Object.keys(view), ...Object.keys(view.agent ?? {})]
        expect(keys.some((k) => /halluc|wrong|revealed|stuck|taint|fabricat|runaway/i.test(k))).toBe(false)
        // The bands add up to the packet's tokens (build plan, Session 9 "Done when"). In a run the
        // last output is already the head of the next input (D6), so it counts once.
        const answered = p.producedByModelId >= 0 || p.cacheHit
        const inRun = p.category === 'AGENT_TASK' && p.loopCount > 0
        expect(view.cachedTokens + view.newInputTokens + view.outputTokens).toBe(
          p.cachedPrefixTokens + p.newInputTokens + (answered && !inRun ? p.outputTokensGenerated : 0),
        )
        if (inRun) expect(view.outputTokens).toBe(p.outputTokensGenerated)
        expect(view.pii).toBe(p.containsPII ? 'contains' : p.redacted ? 'redacted' : 'none')
        if (view.pii === 'redacted') redacted++
        if (p.category !== 'AGENT_TASK') {
          expect(view.agent).toBeNull()
          continue
        }
        expect(view.agent?.modelPasses).toBe(p.loopCount)
        expect(view.agent?.toolsRequired).toBe(p.requiredToolSteps)
        if (p.loopCount >= 2) {
          looped++
          expect(view.cachedTokens).toBeGreaterThan(0)
          expect(view.agent?.stepReliability).toBe(r)
          expect(view.agent?.reliability).toBeCloseTo(r ** p.loopCount, 12)
        }
      }
    }
    expect(looped).toBeGreaterThan(0)
    expect(redacted).toBeGreaterThan(0)
  })
})
