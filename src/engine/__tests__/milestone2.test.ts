import { describe, expect, it } from 'vitest'

import { DEFAULT_CATALOG, makeCatalog, ticksPerSecond } from '../catalog'
import { BOARD_EFFECTS_SIZE, BoardEffect } from '../events'
import { GameEngine } from '../GameEngine'
import { pickEventKind } from '../IncidentDirector'
import {
  boostQuality,
  cacheHitChance,
  firewallVerdict,
  FirewallVerdict,
  guardrailRecall,
  PIPELINE_BEHAVIORS,
  ragWrongRate,
  scrubPii,
} from '../nodes'
import { enqueue } from '../nodes/pipeline'
import { spawnArrival } from '../nodes/usersIn'
import { exitPacket } from '../nodes/usersOut'
import { failPacket } from '../outcomes'
import { Rng } from '../rng'
import { leakCosts, ragPaths } from '../unitEconomics'
import { Loc, type Packet } from '../types'
import type { World } from '../world'
import { eventsOf, link, makePacket, nodeOfType, place, quietEngine, ticks } from './helpers'

const N = 100_000
const C = DEFAULT_CATALOG

function trustSnapshot(world: World): [number, number] {
  return [world.trust.s, world.trust.n]
}

function ragPacket(world: World): Packet {
  const p = makePacket(world, 'COMPLEX')
  const rag = world.catalog.traffic.rag
  p.category = 'RAG_QUERY'
  p.newInputTokens = rag.inputTokens
  p.outputTokensGenerated = rag.outputTokens
  p.contextQuality = 0
  return p
}

function attackPacket(world: World): Packet {
  const p = makePacket(world, 'SIMPLE')
  p.category = 'ADVERSARIAL'
  p.isMaliciousInjection = true
  return p
}

describe('prompt firewall (D45)', () => {
  it('blocks 95% of injections and refuses 0.5% of real prompts', () => {
    const rng = new Rng(11)
    const spec = C.nodes.PROMPT_FIREWALL
    let blocked = 0
    let refused = 0
    for (let i = 0; i < N; i++) {
      if (firewallVerdict(rng, spec, { isMaliciousInjection: true }) === FirewallVerdict.BLOCK) blocked++
      if (firewallVerdict(rng, spec, { isMaliciousInjection: false }) === FirewallVerdict.REFUSE) refused++
    }
    expect(Math.abs(blocked / N - 0.95)).toBeLessThan(0.004)
    expect(Math.abs(refused / N - 0.005)).toBeLessThan(0.0015)
  })

  it('ends a blocked attack at the firewall with no trust outcome (D44), and counts it', () => {
    const engine = quietEngine({ nodes: { PROMPT_FIREWALL: { blockRate: 1 } } })
    const w = engine.world
    const firewall = place(engine, 'PROMPT_FIREWALL', 5, 9)
    link(engine, firewall, nodeOfType(w, 'FRONTIER_API'))
    const before = trustSnapshot(w)
    const p = attackPacket(w)
    PIPELINE_BEHAVIORS.PROMPT_FIREWALL?.complete(w, firewall, p)
    expect(p.loc).toBe(Loc.FREE)
    expect(firewall.blocks).toBe(1)
    expect(w.stats.attacksBlocked).toBe(1)
    expect(trustSnapshot(w)).toEqual(before)
    // The board shatters it at the firewall.
    const last = (w.effects.total - 1) % BOARD_EFFECTS_SIZE
    expect(w.effects.kinds[last]).toBe(BoardEffect.ATTACK_BLOCKED)
    expect(w.effects.nodeIds[last]).toBe(firewall.id)
  })

  it('sends a false alarm straight to Users out as a refusal', () => {
    const engine = quietEngine({ nodes: { PROMPT_FIREWALL: { falseAlarmRate: 1 } } })
    const w = engine.world
    const firewall = place(engine, 'PROMPT_FIREWALL', 5, 9)
    link(engine, firewall, nodeOfType(w, 'FRONTIER_API'))
    const p = makePacket(w)
    PIPELINE_BEHAVIORS.PROMPT_FIREWALL?.complete(w, firewall, p)
    expect(p.refused).toBe(true)
    expect(p.loc).toBe(Loc.VIRTUAL)
    expect(p.nodeId).toBe(nodeOfType(w, 'USERS_OUT').id)
  })
})

describe('PII redactor (D45)', () => {
  it('scrubs 98% of PII and never adds any', () => {
    const rng = new Rng(12)
    const spec = C.nodes.PII_REDACTOR
    let left = 0
    let mismatched = 0
    for (let i = 0; i < N; i++) {
      const p = { containsPII: true, redacted: false }
      scrubPii(rng, spec, p)
      if (p.containsPII) left++
      // A scrub leaves the black bar; a miss leaves the tag (design: "Redacted").
      if (p.redacted === p.containsPII) mismatched++
      const clean = { containsPII: false, redacted: false }
      scrubPii(rng, spec, clean)
      if (clean.containsPII || clean.redacted) mismatched++
    }
    expect(mismatched).toBe(0)
    expect(Math.abs(left / N - 0.02)).toBeLessThan(0.002)
  })
})

describe('breaches (D43)', () => {
  it.each(['FRONTIER_API', 'FAST_SLM'] as const)('PII reaching %s is a breach: −14 trust, a $100 fine, $0', (type) => {
    const engine = quietEngine()
    const w = engine.world
    const model = type === 'FRONTIER_API' ? nodeOfType(w, 'FRONTIER_API') : place(engine, 'FAST_SLM', 14, 4)
    const p = makePacket(w)
    p.containsPII = true
    const [s, n] = trustSnapshot(w)
    const budget = w.budget
    PIPELINE_BEHAVIORS[type]?.complete(w, model, p)
    expect(w.stats.piiBreaches).toBe(1)
    expect(w.stats.fines).toBe(100)
    expect(w.stats.revenue).toBe(0)
    expect(w.budget).toBeCloseTo(budget - 100 - w.stats.tokenSpend, 9)
    expect(w.trust.s).toBeCloseTo(s - 14, 9)
    expect(w.trust.n).toBeCloseTo(n + 1, 9)
    expect(p.loc).toBe(Loc.FREE)
    expect(w.incidents.entries.at(-1)?.severity).toBe('alarm')
  })

  it('leaves PII alone on a model that does not leak it (the M4 self-hosted case)', () => {
    const engine = quietEngine({ nodes: { FAST_SLM: { leaksPii: false } } })
    const w = engine.world
    const slm = place(engine, 'FAST_SLM', 14, 4)
    link(engine, slm, nodeOfType(w, 'USERS_OUT'))
    const p = makePacket(w)
    p.containsPII = true
    PIPELINE_BEHAVIORS.FAST_SLM?.complete(w, slm, p)
    expect(w.stats.piiBreaches).toBe(0)
    expect(p.loc).toBe(Loc.EDGE)
  })

  it.each([
    ['FRONTIER_API', 0.2],
    ['FAST_SLM', 0.6],
  ] as const)('an injection reaching %s breaches %s of the time', (type, rate) => {
    const engine = quietEngine({ packetPoolSize: 3000 })
    const w = engine.world
    // Frontier A is linked to Users out on the starting board.
    const model = type === 'FRONTIER_API' ? nodeOfType(w, 'FRONTIER_API') : place(engine, 'FAST_SLM', 14, 4)
    if (type === 'FAST_SLM') link(engine, model, nodeOfType(w, 'USERS_OUT'))
    const runs = 2500
    for (let i = 0; i < runs; i++) PIPELINE_BEHAVIORS[type]?.complete(w, model, attackPacket(w))
    // 4 standard errors.
    expect(Math.abs(w.stats.injectionBreaches / runs - rate)).toBeLessThan(4 * Math.sqrt((rate * (1 - rate)) / runs))
  })
})

describe('stopped attacks score nothing (D44)', () => {
  it('a timed-out or resisted attack leaves trust alone', () => {
    const engine = quietEngine()
    const w = engine.world
    const before = trustSnapshot(w)
    failPacket(w, attackPacket(w), 'TIMEOUT', null)
    exitPacket(w, nodeOfType(w, 'USERS_OUT'), attackPacket(w))
    expect(trustSnapshot(w)).toEqual(before)
    expect(w.stats.attacksResisted).toBe(1)
    expect(w.stats.revenue).toBe(0)
  })
})

describe('RAG quality (D42)', () => {
  const frontier = C.nodes.FRONTIER_API
  const guard = C.nodes.OUTPUT_GUARDRAIL

  it('stacks boosts with diminishing returns, never past 1', () => {
    expect(boostQuality(0.72, 0.7)).toBeCloseTo(0.916, 9)
    expect(boostQuality(boostQuality(0.72, 0.45), 0.7)).toBeCloseTo(0.9538, 4)
    expect(boostQuality(0.99, 0.99)).toBeLessThan(1)
  })

  it.each([
    [0, 0.63, 0.4158],
    [0.72, 0.198, 0.058],
    [0.916, 0.0804, 0.0153],
    [0.9538, 0.0577, 0.01],
  ])('q %s: wrong %s, leaking past a guardrail %s', (q, wrong, leak) => {
    const w = ragWrongRate(C, frontier, q, 0)
    expect(w).toBeCloseTo(wrong, 3)
    expect(w * (1 - guardrailRecall(guard, { category: 'RAG_QUERY', contextQuality: q }))).toBeCloseTo(leak, 2)
  })

  it('adds drift and clamps to 0.95', () => {
    expect(ragWrongRate(C, frontier, 0.72, 0.05)).toBeCloseTo(0.248, 9)
    expect(ragWrongRate(C, C.nodes.FAST_SLM, 0, 0.15)).toBe(0.95)
  })

  it('a RAG question through a Flat vector DB and the reranker reaches Frontier with 1,200 tokens of context at q 0.916', () => {
    const engine = quietEngine()
    const w = engine.world
    const vdb = place(engine, 'VECTOR_DB', 8, 12)
    const rerank = place(engine, 'RERANKER', 12, 12)
    const frontierNode = nodeOfType(w, 'FRONTIER_API')
    link(engine, vdb, rerank)
    link(engine, rerank, frontierNode)
    const p = ragPacket(w)
    enqueue(vdb, p)
    for (let t = 0; t < 200 && p.nodeId !== frontierNode.id; t++) engine.tick()
    expect(p.nodeId).toBe(frontierNode.id)
    expect(p.contextQuality).toBeCloseTo(0.916, 9)
    expect(p.contextTokens).toBe(1200)
    expect(p.newInputTokens).toBe(2000)
  })

  it('takes the reranker 120 ms + 1 ms per 20 context tokens', () => {
    const engine = quietEngine()
    const w = engine.world
    const rerank = place(engine, 'RERANKER', 12, 12)
    const p = ragPacket(w)
    p.contextTokens = 4000
    // 320 ms rounds to 6 ticks.
    expect(PIPELINE_BEHAVIORS.RERANKER?.serviceTicks(w, rerank, p)).toBe(6)
  })

  it('BM25 alone retrieves 2,000 tokens at q 0.55; a non-RAG prompt passes through unchanged', () => {
    const engine = quietEngine()
    const w = engine.world
    const bm25 = place(engine, 'BM25_SEARCH', 8, 12)
    link(engine, bm25, nodeOfType(w, 'FRONTIER_API'))
    const p = ragPacket(w)
    PIPELINE_BEHAVIORS.BM25_SEARCH?.complete(w, bm25, p)
    expect(p.contextQuality).toBe(0.55)
    expect(p.newInputTokens).toBe(2800)
    const chat = makePacket(w)
    const tokens = chat.newInputTokens
    PIPELINE_BEHAVIORS.BM25_SEARCH?.complete(w, bm25, chat)
    expect(chat.newInputTokens).toBe(tokens)
  })
})

describe('drift and the ingestion cron (D46)', () => {
  it('grows 0.02 a minute, and a cron re-indexes every vector DB each minute', () => {
    const engine = quietEngine()
    const w = engine.world
    const tps = ticksPerSecond(w.catalog)
    const vdb = place(engine, 'VECTOR_DB', 8, 12)
    link(engine, vdb, nodeOfType(w, 'FRONTIER_API'))
    ticks(engine, 120 * tps)
    const p = ragPacket(w)
    PIPELINE_BEHAVIORS.VECTOR_DB?.complete(w, vdb, p)
    expect(p.drift).toBeCloseTo(0.04, 9)
    const cron = place(engine, 'INGESTION_CRON', 20, 15)
    ticks(engine, 60 * tps + 1)
    expect(vdb.indexedTick).toBe(cron.indexedTick)
    expect(vdb.indexedTick).toBeGreaterThan(120 * tps)
  })

  it('caps drift at 0.15', () => {
    const engine = quietEngine()
    const w = engine.world
    const vdb = place(engine, 'VECTOR_DB', 8, 12)
    link(engine, vdb, nodeOfType(w, 'FRONTIER_API'))
    ticks(engine, 10 * 60 * ticksPerSecond(w.catalog))
    const p = ragPacket(w)
    PIPELINE_BEHAVIORS.VECTOR_DB?.complete(w, vdb, p)
    expect(p.drift).toBe(0.15)
  })
})

describe('vector DB tiers (D45)', () => {
  it('upgrades charge the difference, change workers and upkeep, and only go up', () => {
    const engine = quietEngine()
    const w = engine.world
    const vdb = place(engine, 'VECTOR_DB', 8, 12)
    const budget = w.budget
    expect(engine.applyNow({ type: 'setSetting', nodeId: vdb.id, key: 'tier', value: 3 })).toEqual({ ok: true })
    expect(w.budget).toBe(budget - 150)
    expect(vdb.concurrency).toBe(16)
    expect(vdb.spent).toBe(290)
    expect(w.upkeepPerTick * 1200).toBeCloseTo(24, 9)
    expect(engine.applyNow({ type: 'setSetting', nodeId: vdb.id, key: 'tier', value: 2 }).ok).toBe(false)
    const before = w.budget
    engine.applyNow({ type: 'demolish', nodeId: vdb.id })
    expect(w.budget).toBe(before + 145)
  })
})

describe('settings', () => {
  it('rejects settings a node does not have, and bad values', () => {
    const engine = quietEngine()
    const w = engine.world
    const usersIn = nodeOfType(w, 'USERS_IN')
    expect(engine.applyNow({ type: 'setSetting', nodeId: usersIn.id, key: 'tier', value: 2 }).ok).toBe(false)
    expect(engine.applyNow({ type: 'setSetting', nodeId: usersIn.id, key: 'maxPerSec', value: -1 }).ok).toBe(false)
    const cache = place(engine, 'SEMANTIC_CACHE', 5, 9)
    expect(engine.applyNow({ type: 'setSetting', nodeId: cache.id, key: 'strictness', value: 'SLOPPY' }).ok).toBe(false)
    expect(engine.applyNow({ type: 'setSetting', nodeId: cache.id, key: 'strictness', value: 'STRICT' })).toEqual({ ok: true })
    expect(cache.strictness).toBe('STRICT')
  })

  it('the throttle admits a 1 s burst, then turns prompts away as throttled (+0.8)', () => {
    const engine = quietEngine()
    const w = engine.world
    const usersIn = nodeOfType(w, 'USERS_IN')
    expect(engine.applyNow({ type: 'setSetting', nodeId: usersIn.id, key: 'maxPerSec', value: 5 })).toEqual({ ok: true })
    const [s, n] = trustSnapshot(w)
    for (let i = 0; i < 8; i++) spawnArrival(w, usersIn, 'CHAT', 'SIMPLE', false)
    expect(w.stats.throttled).toBe(3)
    expect(w.trust.s).toBeCloseTo(s + 3 * 0.8, 9)
    expect(w.trust.n).toBeCloseTo(n + 3, 9)
  })

  it('cache strictness scales hits, and RAG questions hit at most 15%', () => {
    const spec = C.nodes.SEMANTIC_CACHE
    expect(cacheHitChance(spec, 'SIMPLE', 1e9, 'LOOSE')).toBeCloseTo(0.52, 9)
    expect(cacheHitChance(spec, 'SIMPLE', 1e9, 'STRICT')).toBeCloseTo(0.24, 9)
    expect(cacheHitChance(spec, 'COMPLEX', 1e9, 'BALANCED', 'RAG_QUERY')).toBeCloseTo(0.15, 9)
  })
})

describe('routing and connections (D47)', () => {
  it('the router sends RAG questions to retrieval, and to Frontier when none is linked', () => {
    const engine = quietEngine({ nodes: { PROMPT_ROUTER: { accuracy: 1 } } })
    const w = engine.world
    const router = place(engine, 'PROMPT_ROUTER', 8, 9)
    const frontier = nodeOfType(w, 'FRONTIER_API')
    link(engine, router, frontier)
    const first = ragPacket(w)
    PIPELINE_BEHAVIORS.PROMPT_ROUTER?.complete(w, router, first)
    expect(w.edgeById[first.edgeId]?.to).toBe(frontier.id)
    const vdb = place(engine, 'VECTOR_DB', 8, 12)
    link(engine, router, vdb)
    const second = ragPacket(w)
    PIPELINE_BEHAVIORS.PROMPT_ROUTER?.complete(w, router, second)
    expect(w.edgeById[second.edgeId]?.to).toBe(vdb.id)
  })

  it('allows the new links, rejects loops between pairs, and gives the cron no links', () => {
    const engine = quietEngine()
    const w = engine.world
    const firewall = place(engine, 'PROMPT_FIREWALL', 4, 9)
    const redactor = place(engine, 'PII_REDACTOR', 6, 9)
    const vdb = place(engine, 'VECTOR_DB', 8, 12)
    const bm25 = place(engine, 'BM25_SEARCH', 10, 12)
    const cron = place(engine, 'INGESTION_CRON', 20, 15)
    expect(engine.applyNow({ type: 'link', from: nodeOfType(w, 'USERS_IN').id, to: firewall.id }).ok).toBe(true)
    expect(engine.applyNow({ type: 'link', from: firewall.id, to: redactor.id }).ok).toBe(true)
    expect(engine.applyNow({ type: 'link', from: redactor.id, to: firewall.id }).ok).toBe(false)
    expect(engine.applyNow({ type: 'link', from: vdb.id, to: bm25.id }).ok).toBe(true)
    expect(engine.applyNow({ type: 'link', from: bm25.id, to: vdb.id }).ok).toBe(false)
    expect(engine.applyNow({ type: 'link', from: cron.id, to: vdb.id }).ok).toBe(false)
    expect(engine.applyNow({ type: 'link', from: redactor.id, to: vdb.id }).ok).toBe(false)
  })
})

describe('incident director (D48)', () => {
  it('gives the same events on the same seed whatever the build', () => {
    expect(eventsOf('p2-naive', 7)).toEqual(eventsOf('p2-full', 7))
  })

  it('picks by phase weights and skips the last kind', () => {
    // Phase 1 has no cache wipe or jailbreak.
    for (let r = 0; r < 1; r += 0.01) expect(['VIRAL_SPIKE', 'HARD_WAVE', 'SLOWDOWN']).toContain(pickEventKind(C, r, 60, null))
    for (let r = 0; r < 1; r += 0.01) expect(pickEventKind(C, r, 200, 'VIRAL_SPIKE')).not.toBe('VIRAL_SPIKE')
  })

  it('stays off in classic mode', () => {
    const engine = new GameEngine({ seed: 1, catalog: makeCatalog({ director: { enabled: false } }) })
    ticks(engine, 6000)
    expect(engine.world.director.stage).toBe('waiting')
    expect(engine.world.runLog.markers.some((m) => m.kind === 'EVENT')).toBe(false)
  })
})

describe('unit economics', () => {
  it('reproduces D41 and D42: RAG on Frontier costs $2.80, $6.80, $4.00 and is wrong 63%, 20%, 8%, 6%', () => {
    const frontier = ragPaths(C).filter((r) => r.model === 'FRONTIER_API')
    expect(frontier.map((r) => Number(r.cost.toFixed(2)))).toEqual([2.8, 6.8, 4, 4])
    expect(frontier.map((r) => Math.round(r.wrongRate * 100))).toEqual([63, 20, 8, 6])
    expect(frontier[2].latencyMs).toBe(600 + 320 + 350 + 200 + 4000)
    const slm = ragPaths(C).filter((r) => r.model === 'FAST_SLM')
    expect(slm[1].cost).toBeCloseTo(0.224, 9)
    expect(slm[0].wrongRate).toBe(0.95)
  })

  it('prices leaks at 5:00: 2% of non-attack traffic carrying PII, all of it breaching without a redactor', () => {
    const rows = leakCosts(C, 300)
    const pii = rows[0]
    expect(pii.breachesPerSec).toBeCloseTo(16 * 0.96 * 0.02, 9)
    expect(pii.finesPerSec).toBeCloseTo(pii.breachesPerSec * 100, 9)
    expect(rows[1].breachesPerSec).toBeCloseTo(pii.breachesPerSec * 0.02, 9)
    const slmAttacks = rows.find((r) => r.label === 'Attacks on Fast SLM, no firewall')
    expect(slmAttacks?.breachesPerSec).toBeCloseTo(16 * 0.04 * 0.6, 9)
    expect(slmAttacks?.finesPerSec).toBeCloseTo(16 * 0.04 * 0.6 * 50, 9)
  })
})
