import { describe, expect, it } from 'vitest'
import { available } from '../breaker'
import { classicCatalog, DEFAULT_CATALOG, makeCatalog, sandboxCatalog, ticksPerSecond } from '../catalog'
import { forward } from '../EdgeRouter'
import { GameEngine } from '../GameEngine'
import { gapFactorAt, outageSecAt } from '../IncidentDirector'
import { runCrons } from '../nodes'
import { cachedReadTokens } from '../nodes/model'
import { enqueue } from '../nodes/pipeline'
import { vectorDbDrift } from '../nodes/retrieval'
import { staleIndexCapSec, surgeNeededThrottle } from '../postmortem'
import { checkTarget } from '../scenarios'
import { coldStartCost } from '../telemetry'
import { Breaker, type GameNode } from '../types'
import { selfHostEconomics } from '../unitEconomics'
import { arrivalRate } from '../WaveDirector'
import { providerDown, type World } from '../world'
import { link, makePacket, nodeOfType, place, quietEngine, ticks, unlink } from './helpers'

// A sandbox, so a test that fails prompts on purpose never ends the run (and stalls its loop).
const RICH = { sandbox: true, budget: { start: 100_000 } }

function warm(engine: GameEngine, node: GameNode): void {
  while (node.coldUntilTick > engine.world.tick) engine.tick()
}

/** One complex chat from Users in, routed as Users in routes. */
function sendComplex(world: World): void {
  const p = makePacket(world, 'COMPLEX')
  forward(world, nodeOfType(world, 'USERS_IN'), p, null)
}

describe('power (J-1)', () => {
  it('refuses a vLLM cluster with no substation, and places one with a substation', () => {
    const engine = quietEngine(RICH)
    const check = engine.check({ type: 'placeNode', nodeType: 'VLLM_CLUSTER', x: 6, y: 5 })
    expect(check).toEqual({ ok: false, reason: 'Needs 0.5 kW more power. Place a power substation' })
    const sub = place(engine, 'POWER_SUBSTATION', 5, 5)
    const vllm = place(engine, 'VLLM_CLUSTER', 6, 5)
    // The cable runs to the substation that powers it.
    expect(vllm.powerFromId).toBe(sub.id)
    expect(engine.snapshot.power).toEqual({ supplyKw: 0, drawKw: 0 })
    engine.refreshSnapshot()
    expect(engine.snapshot.power).toEqual({ supplyKw: 3, drawKw: 0.5 })
  })

  it('refuses the 70B without 1.5 kW spare, and a substation still in use', () => {
    const engine = quietEngine(RICH)
    const sub = place(engine, 'POWER_SUBSTATION', 5, 5)
    const vllms = [6, 7, 8, 9, 10].map((x) => place(engine, 'VLLM_CLUSTER', x, 5))
    expect(engine.check({ type: 'setSetting', nodeId: vllms[0].id, key: 'tier', value: 2 })).toEqual({
      ok: false,
      reason: 'Needs 1 kW more power. Place a power substation',
    })
    expect(engine.check({ type: 'demolish', nodeId: sub.id })).toEqual({ ok: false, reason: 'Powering Llama 8B' })
    place(engine, 'POWER_SUBSTATION', 5, 7)
    expect(engine.applyNow({ type: 'setSetting', nodeId: vllms[0].id, key: 'tier', value: 2 }).ok).toBe(true)
    expect(vllms[0].kvBudget).toBe(DEFAULT_CATALOG.nodes.VLLM_CLUSTER.tiers[1].kvTokens)
  })

  it('allows one tracer and one judge per board', () => {
    const engine = quietEngine(RICH)
    place(engine, 'TRACER', 3, 3)
    place(engine, 'LLM_JUDGE', 4, 3)
    expect(engine.check({ type: 'placeNode', nodeType: 'TRACER', x: 5, y: 3 })).toEqual({ ok: false, reason: "There's already a tracer on the board" })
    expect(engine.check({ type: 'placeNode', nodeType: 'LLM_JUDGE', x: 5, y: 3 })).toEqual({ ok: false, reason: "There's already a llm judge on the board" })
  })
})

describe('vLLM continuous batching (D22, J-1)', () => {
  function seventyB(): { engine: GameEngine; vllm: GameNode } {
    const engine = quietEngine(RICH)
    place(engine, 'POWER_SUBSTATION', 5, 5)
    const vllm = place(engine, 'VLLM_CLUSTER', 6, 5)
    engine.applyNow({ type: 'setSetting', nodeId: vllm.id, key: 'tier', value: 2 })
    return { engine, vllm }
  }

  function rag(world: World, input: number) {
    const p = makePacket(world, 'COMPLEX')
    p.newInputTokens = input
    p.outputTokensGenerated = 400
    return p
  }

  it('serves nothing while it loads its weights, and routing skips it', () => {
    const { engine, vllm } = seventyB()
    const w = engine.world
    expect(available(w, vllm)).toBe(false)
    enqueue(vllm, rag(w, 2000))
    ticks(engine, 10)
    expect(vllm.busy).toBe(0)
    // Users in linked only to a cold model: the degraded reply, not a queue.
    const usersIn = nodeOfType(w, 'USERS_IN')
    unlink(engine, usersIn, nodeOfType(w, 'FRONTIER_API'))
    link(engine, usersIn, vllm)
    sendComplex(w)
    expect(w.stats.degraded).toBe(1)
    warm(engine, vllm)
    enqueue(vllm, rag(w, 2000))
    engine.tick()
    expect(vllm.busy).toBe(1)
  })

  it('admits by KV memory: 48 unreranked RAG questions, 104 reranked, never past the budget', () => {
    for (const [input, fits] of [
      [4800, 48],
      [2000, 104],
    ] as const) {
      const { engine, vllm } = seventyB()
      warm(engine, vllm)
      for (let i = 0; i < 64; i++) enqueue(vllm, rag(engine.world, input))
      engine.tick()
      expect(vllm.busy).toBe(Math.min(64, fits))
      expect(vllm.kvInUse).toBeLessThanOrEqual(vllm.kvBudget)
    }
    const { engine, vllm } = seventyB()
    warm(engine, vllm)
    for (let t = 0; t < 400; t++) {
      while (vllm.queueLength < 64) enqueue(vllm, rag(engine.world, 4800))
      engine.tick()
      expect(vllm.kvInUse).toBeLessThanOrEqual(vllm.kvBudget)
      expect(vllm.busy).toBeLessThanOrEqual(48)
    }
  })

  it('slows decoding as the batch grows', () => {
    const { engine, vllm } = seventyB()
    warm(engine, vllm)
    for (let i = 0; i < 40; i++) enqueue(vllm, rag(engine.world, 2000))
    engine.tick()
    const finishes = Array.from(vllm.workerFinishTick.subarray(0, 40))
    expect(finishes[39]).toBeGreaterThan(finishes[0])
  })

  it('costs about $1,400 of upkeep before the 70B serves a token', () => {
    expect(coldStartCost(DEFAULT_CATALOG, 2)).toBeCloseTo(1400)
    expect(coldStartCost(DEFAULT_CATALOG, 1)).toBeCloseTo(22.5)
    const { engine, vllm } = seventyB()
    engine.refreshSnapshot()
    const view = engine.snapshot.nodes.find((n) => n.id === vllm.id)?.vllm
    expect(view?.coldStartCost).toBeCloseTo(1400)
    expect(view?.coldSecondsLeft).toBe(30)
    expect(view?.tierName).toBe('Llama 70B')
  })

  it("keeps PII in: self-hosted answers aren't breaches", () => {
    const { engine, vllm } = seventyB()
    const w = engine.world
    warm(engine, vllm)
    const p = rag(w, 2000)
    p.containsPII = true
    enqueue(vllm, p)
    ticks(engine, 200)
    expect(w.stats.piiBreaches).toBe(0)
  })
})

/** A board with Frontier A and Frontier B both linked from Users in, and A down from 10 s to 70 s. */
function outageBoard(breakers: boolean): { engine: GameEngine; a: GameNode; b: GameNode } {
  const engine = quietEngine({ ...RICH, director: { enabled: false, drill: { provider: 0, startSec: 10, endSec: 70 } } })
  const w = engine.world
  const a = nodeOfType(w, 'FRONTIER_API')
  const b = place(engine, 'FRONTIER_API', 12, 12)
  engine.applyNow({ type: 'setSetting', nodeId: b.id, key: 'provider', value: 'B' })
  link(engine, nodeOfType(w, 'USERS_IN'), b)
  link(engine, b, nodeOfType(w, 'USERS_OUT'))
  if (breakers) for (const n of [a, b]) engine.applyNow({ type: 'setSetting', nodeId: n.id, key: 'breaker', value: true })
  return { engine, a, b }
}

/** Sends 10 complex chats a second for a span and counts what each model was sent. */
function feed(engine: GameEngine, fromSec: number, toSec: number, a: GameNode, b: GameNode): { a: number; b: number } {
  const w = engine.world
  const tps = ticksPerSecond(w.catalog)
  while (w.tick < fromSec * tps) {
    if (w.tick % 2 === 0) sendComplex(w)
    engine.tick()
  }
  const start = { a: a.processed + a.busy + a.queueLength, b: b.processed + b.busy + b.queueLength }
  while (w.tick < toSec * tps) {
    if (w.tick % 2 === 0) sendComplex(w)
    engine.tick()
  }
  return { a: a.processed + a.busy + a.queueLength - start.a, b: b.processed + b.busy + b.queueLength - start.b }
}

describe('provider outages and circuit breakers (D29, J-4)', () => {
  it('fails every call on a provider that is down, after 2 s and without charging tokens', () => {
    const { engine } = outageBoard(false)
    const w = engine.world
    ticks(engine, 10 * 20)
    expect(providerDown(w, 0)).toBe(true)
    expect(providerDown(w, 1)).toBe(false)
    const spent = w.stats.tokenSpend
    const a = nodeOfType(w, 'FRONTIER_API')
    enqueue(a, makePacket(w, 'COMPLEX'))
    ticks(engine, 39)
    expect(w.stats.providerErrors).toBe(0)
    ticks(engine, 2)
    expect(w.stats.providerErrors).toBe(1)
    expect(w.stats.tokenSpend).toBe(spent)
  })

  it('without breakers, a provider in an outage attracts traffic: it fails fast, so it looks least loaded', () => {
    const { engine, a, b } = outageBoard(false)
    const before = feed(engine, 0, 10, a, b)
    const during = feed(engine, 20, 60, a, b)
    // Healthy, A's faster calls already win a bit more than half.
    expect(before.a / (before.a + before.b)).toBeLessThan(0.65)
    // Down, it pulls most of the traffic, and fails all of it.
    expect(during.a / (during.a + during.b)).toBeGreaterThan(0.7)
  })

  it('with breakers, traffic goes to the healthy provider', () => {
    const { engine, a, b } = outageBoard(true)
    const during = feed(engine, 20, 60, a, b)
    expect(during.a / (during.a + during.b)).toBeLessThan(0.1)
  })

  it('opens within 10 calls, goes half-open after 5 s with 3 probes, and closes when they come back', () => {
    const { engine, a, b } = outageBoard(true)
    const w = engine.world
    const tps = ticksPerSecond(w.catalog)
    // Only A, so every packet has to go there.
    unlink(engine, nodeOfType(w, 'USERS_IN'), b)
    ticks(engine, 11 * tps)
    for (let i = 0; i < 10; i++) sendComplex(w)
    ticks(engine, 3 * tps)
    expect(a.breakerState).toBe(Breaker.OPEN)
    expect(w.stats.breakerTrips).toBe(1)
    expect(w.stats.providerErrors).toBeLessThanOrEqual(10)
    // Open: the degraded reply at once.
    sendComplex(w)
    expect(w.stats.degraded).toBe(1)
    // After 5 s it lets 3 probes through, and no more.
    ticks(engine, 5 * tps)
    for (let i = 0; i < 4; i++) sendComplex(w)
    expect(a.breakerState).toBe(Breaker.HALF_OPEN)
    expect(a.probesSent).toBe(3)
    expect(w.stats.degraded).toBe(2)
    // Still down: a probe fails and it opens again.
    ticks(engine, 4 * tps)
    expect(a.breakerState).toBe(Breaker.OPEN)
    // The outage ends at 70 s; probes then come back and it closes.
    while (w.tick < 72 * tps) engine.tick()
    expect(available(w, a)).toBe(true)
    for (let i = 0; i < 3; i++) sendComplex(w)
    ticks(engine, 10 * tps)
    expect(a.breakerState).toBe(Breaker.CLOSED)
  })

  it('never trips on lateness or full queues, only on provider errors', () => {
    const engine = quietEngine(RICH)
    const w = engine.world
    const a = nodeOfType(w, 'FRONTIER_API')
    engine.applyNow({ type: 'setSetting', nodeId: a.id, key: 'breaker', value: true })
    for (let i = 0; i < 40; i++) enqueue(a, makePacket(w, 'COMPLEX', 1))
    ticks(engine, 200)
    expect(w.stats.timeouts).toBeGreaterThan(10)
    expect(a.breakerState).toBe(Breaker.CLOSED)
  })

  it('charges $40 once for a breaker, then toggles free', () => {
    const engine = quietEngine()
    const w = engine.world
    const a = nodeOfType(w, 'FRONTIER_API')
    const budget = w.budget
    engine.applyNow({ type: 'setSetting', nodeId: a.id, key: 'breaker', value: true })
    engine.applyNow({ type: 'setSetting', nodeId: a.id, key: 'breaker', value: false })
    engine.applyNow({ type: 'setSetting', nodeId: a.id, key: 'breaker', value: true })
    expect(w.budget).toBe(budget - 40)
  })
})

describe('LLM judge (J-3)', () => {
  /** Survival traffic on a sandbox, answered by Fast SLM alone: plenty of wrong answers. */
  function slmBoard(seed: number, judge: number | null): World {
    const engine = new GameEngine({ seed, catalog: sandboxCatalog(10_000, 1) })
    const w = engine.world
    const usersIn = nodeOfType(w, 'USERS_IN')
    const slms = [place(engine, 'FAST_SLM', 8, 6), place(engine, 'FAST_SLM', 8, 12)]
    unlink(engine, usersIn, nodeOfType(w, 'FRONTIER_API'))
    for (const slm of slms) {
      link(engine, usersIn, slm)
      link(engine, slm, nodeOfType(w, 'USERS_OUT'))
    }
    if (judge !== null) {
      const j = place(engine, 'LLM_JUDGE', 4, 3)
      expect(j.sampleRate).toBe(0.05)
      engine.applyNow({ type: 'setSetting', nodeId: j.id, key: 'sampleRate', value: judge })
    }
    ticks(engine, 240 * 20)
    return w
  }

  it("without a judge, nothing is revealed before users complain, and answer quality stays locked", () => {
    const w = slmBoard(1, null)
    expect(w.stats.wrongServed).toBeGreaterThan(100)
    expect(w.stats.judged).toBe(0)
    expect(w.stats.judgeReveals).toBe(0)
    expect(w.nodes.every((n) => n.judgedWrong === 0)).toBe(true)
    const engine = new GameEngine({ seed: 1 })
    expect(engine.snapshot.answerQuality).toBeNull()
  })

  it('at 10%, reveals at least 8% of wrong answers before their complaint, each named to its producer', () => {
    let wrong = 0
    let reveals = 0
    for (const seed of [1, 2, 3]) {
      const w = slmBoard(seed, 0.1)
      wrong += w.stats.wrongServed
      reveals += w.stats.judgeReveals
      const flagged = w.nodes.reduce((s, n) => s + n.judgedWrong, 0)
      expect(flagged).toBe(w.stats.judgeReveals + w.stats.judgeFalseFlags)
      // Only the models answered, so only models are named.
      expect(w.nodes.filter((n) => n.judgedWrong > 0).every((n) => n.type === 'FAST_SLM')).toBe(true)
    }
    expect(reveals / wrong).toBeGreaterThanOrEqual(0.08)
  })

  it("doesn't move trust: the same run with and without a judge has the same trust", () => {
    const off = slmBoard(4, null)
    const on = slmBoard(4, 0.1)
    expect(on.trust.s).toBe(off.trust.s)
    expect(on.trust.n).toBe(off.trust.n)
    expect(on.stats.tokenSpend).toBeGreaterThan(off.stats.tokenSpend)
  })
})

describe('tracer (J-3)', () => {
  it('unlocks latency and token spend only once placed', () => {
    const engine = new GameEngine({ seed: 1 })
    ticks(engine, 60 * 20)
    expect(engine.snapshot.tracing).toBeNull()
    place(engine, 'TRACER', 3, 3)
    engine.refreshSnapshot()
    const tracing = engine.snapshot.tracing
    expect(tracing?.latencyP50Sec).toBeGreaterThan(0)
    expect(tracing?.latencyP95Sec).toBeGreaterThanOrEqual(tracing?.latencyP50Sec ?? 0)
    expect(tracing?.tokenSpend[0].dollars).toBeGreaterThan(0)
  })
})

describe('phase 4 chaos and the endless phase (J-4, J-5)', () => {
  it('grows traffic 3/s a minute from 9:00, and leaves classic mode and earlier minutes alone', () => {
    expect(arrivalRate(DEFAULT_CATALOG, 300)).toBe(16)
    expect(arrivalRate(DEFAULT_CATALOG, 540)).toBe(24)
    expect(arrivalRate(DEFAULT_CATALOG, 840)).toBe(39)
    expect(arrivalRate(DEFAULT_CATALOG, 1200)).toBe(57)
    expect(arrivalRate(classicCatalog(), 840)).toBe(34)
    expect(arrivalRate(sandboxCatalog(500, 2), 840)).toBe(78)
  })

  it('comes faster after 9:00, and lengthens outages', () => {
    expect(gapFactorAt(DEFAULT_CATALOG, 300)).toBe(0.8)
    expect(gapFactorAt(DEFAULT_CATALOG, 540)).toBe(0.6)
    expect(gapFactorAt(DEFAULT_CATALOG, 600)).toBeCloseTo(0.57)
    expect(gapFactorAt(DEFAULT_CATALOG, 3600)).toBe(0.4)
    expect(outageSecAt(DEFAULT_CATALOG, 60, 540)).toBe(60)
    expect(outageSecAt(DEFAULT_CATALOG, 60, 900)).toBe(80)
    expect(outageSecAt(DEFAULT_CATALOG, 75, 3600)).toBe(120)
  })

  it('goes quiet in the drill after 9:00', () => {
    const engine = quietEngine({ director: { enabled: true, quietFromSec: 540 } })
    ticks(engine, 15 * 60 * 20)
    expect(engine.world.runLog.markers.filter((m) => m.kind === 'EVENT' && m.tick > 540 * 20)).toEqual([])
  })

  it('raises drift in a drift surge until the next index', () => {
    const engine = quietEngine(RICH)
    const w = engine.world
    const vdb = place(engine, 'VECTOR_DB', 6, 6)
    place(engine, 'INGESTION_CRON', 6, 8)
    vdb.driftSurge = 0.1
    expect(vectorDbDrift(w, vdb)).toBeCloseTo(0.1)
    vdb.driftSurge = 0.3
    expect(vectorDbDrift(w, vdb)).toBe(w.catalog.director.driftSurge.cap)
    ticks(engine, 61 * 20)
    runCrons(w)
    expect(vdb.driftSurge).toBe(0)
  })

  it("wipes a run's cached context in a cache invalidation", () => {
    const engine = quietEngine()
    const w = engine.world
    const a = nodeOfType(w, 'FRONTIER_API')
    a.prefixCache = true
    const p = makePacket(w, 'COMPLEX')
    p.cacheModelId = a.id
    p.cachedPrefixTokens = 3000
    p.cachedAtTick = 10
    expect(cachedReadTokens(w, a, p)).toBe(3000)
    a.prefixWipedTick = 10
    expect(cachedReadTokens(w, a, p)).toBe(0)
  })
})

describe('self-hosting economics (J-2)', () => {
  it('keeps the 70B break-evens where J-2 has them', () => {
    const e = selfHostEconomics(DEFAULT_CATALOG, [5, 15, 30, 60])
    expect(e.breakEvenA).toBeCloseTo(11.5, 1)
    expect(e.breakEvenB).toBeCloseTo(14.3, 1)
    expect(e.replicaPerSec).toBeGreaterThan(21)
    expect(e.replicaPerSec).toBeLessThan(25)
    expect(e.rows.map((r) => r.replicas)).toEqual([1, 1, 2, 3])
    expect(e.rows.map((r) => r.vllmPerRequest.toFixed(2))).toEqual(['9.40', '3.13', '3.13', '2.34'])
  })
})

describe('the postmortem names the throttle (J-7)', () => {
  function surgeDeath(throttle: number): World {
    const engine = new GameEngine({ seed: 1, catalog: makeCatalog({ director: { enabled: false } }) })
    const w = engine.world
    ticks(engine, 100 * 20)
    engine.applyNow({ type: 'setSetting', nodeId: w.usersInId, key: 'maxPerSec', value: throttle })
    w.runLog.poolsFull.fill(1, 70, 100)
    w.runLog.surges.push({ startTick: 90 * 20, endTick: 99 * 20 })
    w.gameOver = { cause: 'TRUST', tick: 100 * 20 }
    return w
  }

  it('when surge timeouts kill a run with every pool full and no throttle', () => {
    expect(surgeNeededThrottle(surgeDeath(0), 'timeouts')).toBe(true)
    expect(surgeNeededThrottle(surgeDeath(0), 'queueFull')).toBe(true)
    // A tight throttle was already on; another cause; no surge; pools with room.
    expect(surgeNeededThrottle(surgeDeath(5), 'timeouts')).toBe(false)
    expect(surgeNeededThrottle(surgeDeath(0), 'wrong')).toBe(false)
    const calm = surgeDeath(0)
    calm.runLog.surges.length = 0
    expect(surgeNeededThrottle(calm, 'timeouts')).toBe(false)
    const roomy = surgeDeath(0)
    roomy.runLog.poolsFull.fill(0)
    expect(surgeNeededThrottle(roomy, 'timeouts')).toBe(false)
  })
})

describe('the postmortem names a stale index (J-7)', () => {
  function staleRun(withCron: boolean): World {
    const engine = new GameEngine({ seed: 1, catalog: makeCatalog({ director: { enabled: false } }) })
    const w = engine.world
    if (withCron) place(engine, 'INGESTION_CRON', 3, 3)
    w.stats.wrongServed = 10
    w.stats.wrongDrifted = 7
    w.runLog.driftCapTick = 444 * 20
    return w
  }

  it('leads with the cron when most wrong answers came from a drifted index and no cron was placed', () => {
    expect(staleIndexCapSec(staleRun(false))).toBe(444)
    expect(staleIndexCapSec(staleRun(true))).toBeNull()
    const few = staleRun(false)
    few.stats.wrongDrifted = 5
    expect(staleIndexCapSec(few)).toBeNull()
  })
})

describe('"loses less than" (J-6)', () => {
  const result = (died: boolean, minTrustFrom: number) =>
    ({ seed: 1, died, cause: died ? 'TRUST' : null, deathSec: died ? 600 : null, finalBudget: 0, minTrust: 0, timeouts: 0, wrongAnswers: 0, served: 0, breaches: 0, agentWrong: 0, agentCostPerTask: 0, failures: 0, cutShort: 0, minTrustFrom }) as const
  const target = { losesLessThanOf: { id: 'ref' } }

  it('passes on fewer deaths, or the same deaths and higher trust, and fails otherwise', () => {
    expect(checkTarget(target, [result(false, 0), result(true, 0)], undefined, [result(true, 0), result(true, 0)])).toEqual([])
    expect(checkTarget(target, [result(true, 30)], undefined, [result(true, 20)])).toEqual([])
    expect(checkTarget(target, [result(true, 20)], undefined, [result(true, 20)])).toHaveLength(1)
  })
})
