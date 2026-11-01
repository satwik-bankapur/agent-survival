import { describe, expect, it } from 'vitest'

import { DEFAULT_CATALOG, ticksPerSecond, type Catalog, type DeepPartial } from '../catalog'
import { modelCallCost, modelLatencyMs } from '../economy'
import type { GameEngine } from '../GameEngine'
import { agentWrongRate, cachedReadTokens } from '../nodes'
import { spawnArrival } from '../nodes/usersIn'
import { buildSnapshot } from '../telemetry'
import { Tool, type GameNode } from '../types'
import { agentPassCosts, agentPaths, modelMixEconomics, runawayCosts } from '../unitEconomics'
import { categoryShare, drawToolPlan } from '../WaveDirector'
import { Rng } from '../rng'
import { STRIP_COLUMNS, StripColumn } from '../trust'
import { link, nodeOfType, place, quietEngine, ticks, unlink } from './helpers'

const C = DEFAULT_CATALOG

/** Frontier that never fumbles, never sticks and is never wrong, unless a test says otherwise. */
function calm(patch: DeepPartial<Catalog['nodes']['FRONTIER_API']> = {}, others: DeepPartial<Catalog['nodes']> = {}): DeepPartial<Catalog> {
  return {
    nodes: {
      FRONTIER_API: { toolFailRate: 0, stuckRate: 0, stepReliability: 1, wrongRate: { SIMPLE: 0, COMPLEX: 0 }, malformedJsonRate: 0, ...patch },
      ...others,
    },
  }
}

interface AgentBoard {
  readonly engine: GameEngine
  readonly usersIn: GameNode
  readonly frontier: GameNode
  readonly coordinator: GameNode
  readonly search: GameNode
}

/** Users in → coordinator ⇄ Frontier A and web search (and a sandbox if asked) → Users out. */
function agentBoard(patch: DeepPartial<Catalog> = calm(), options: { sandbox?: boolean } = {}): AgentBoard & { sandbox: GameNode | null } {
  const engine = quietEngine({ budget: { start: 10_000 }, ...patch })
  const w = engine.world
  const usersIn = nodeOfType(w, 'USERS_IN')
  const usersOut = nodeOfType(w, 'USERS_OUT')
  const frontier = nodeOfType(w, 'FRONTIER_API')
  const coordinator = place(engine, 'LANGGRAPH_COORDINATOR', 7, 9)
  const search = place(engine, 'MCP_WEB_SEARCH', 7, 5)
  const sandbox = options.sandbox === false ? null : place(engine, 'MCP_CODE_SANDBOX', 9, 5)
  unlink(engine, usersIn, frontier)
  link(engine, usersIn, coordinator)
  link(engine, coordinator, frontier)
  link(engine, coordinator, search)
  if (sandbox !== null) link(engine, coordinator, sandbox)
  link(engine, coordinator, usersOut)
  return { engine, usersIn, frontier, coordinator, search, sandbox }
}

function spawnAgent(b: AgentBoard, plan: number, pii = false): void {
  spawnArrival(b.engine.world, b.usersIn, 'AGENT_TASK', 'COMPLEX', pii, plan)
}

describe('agent traffic (I-1)', () => {
  it('starts at 5:00, reaches 10% at 9:00 and caps at 15%', () => {
    const agent = C.traffic.agent
    expect(categoryShare(C, agent, 299)).toBe(0)
    expect(categoryShare(C, agent, 540)).toBeCloseTo(0.1, 10)
    expect(categoryShare(C, agent, 2000)).toBe(0.15)
  })

  it('draws the tool mix 45 / 25 / 30, search first', () => {
    const rng = new Rng(3)
    const counts = { [Tool.SEARCH]: 0, [Tool.CODE]: 0, [Tool.SEARCH | Tool.CODE]: 0 }
    const n = 100_000
    for (let i = 0; i < n; i++) counts[drawToolPlan(C, rng.float())]++
    expect(counts[Tool.SEARCH] / n).toBeCloseTo(0.45, 2)
    expect(counts[Tool.CODE] / n).toBeCloseTo(0.25, 2)
    expect(counts[Tool.SEARCH | Tool.CODE] / n).toBeCloseTo(0.3, 2)
  })

  it('pays $12 for one tool and $19 for two', () => {
    const b = agentBoard()
    spawnAgent(b, Tool.SEARCH | Tool.CODE)
    ticks(b.engine, 1200)
    expect(b.engine.world.stats.revenue).toBe(19)
    expect(b.engine.world.stats.good).toBe(1)
  })
})

describe('context growth (D6) and prefix caching (D5)', () => {
  it('grows each pass by the output and the tool result: $4.00 + $5.50 + $6.40 on Frontier', () => {
    const costs = agentPassCosts(C, C.nodes.FRONTIER_API, false)
    expect(costs.map((c) => +c.toFixed(4))).toEqual([4, 5.5, 6.4])
  })

  it('with caching, reads the prefix at 0.1× and writes the rest at 1.4×: $2.40 + $3.85 + $3.16', () => {
    const costs = agentPassCosts(C, C.nodes.FRONTIER_API, true)
    expect(costs.map((c) => +c.toFixed(4))).toEqual([2.4, 3.85, 3.16])
  })

  it('charges a chat that never repeats the write premium, and prefills cached tokens 10× faster', () => {
    const chat = { newInputTokens: 1200, cachedPrefixTokens: 0, outputTokensGenerated: 600 }
    expect(modelCallCost(C.nodes.FRONTIER_API, chat)).toBeCloseTo(4.2, 10)
    expect(modelCallCost(C.nodes.FRONTIER_API, chat, C.prefixCache, 0)).toBeCloseTo(4.68, 10)
    const run = { newInputTokens: 300, cachedPrefixTokens: 10_000, outputTokensGenerated: 300 }
    const plain = modelLatencyMs(C.nodes.FRONTIER_API, run)
    const cached = modelLatencyMs(C.nodes.FRONTIER_API, run, C.prefixCache, 10_000)
    expect(plain - cached).toBeCloseTo(900, 6)
  })

  it('a run pays the same in the engine as in the unit economics', () => {
    const b = agentBoard()
    b.engine.applyNow({ type: 'setSetting', nodeId: b.frontier.id, key: 'prefixCache', value: true })
    // A first task warms the shared system prompt, then a second one runs warm.
    spawnAgent(b, Tool.SEARCH | Tool.CODE)
    ticks(b.engine, 1200)
    const before = b.engine.world.stats.tokenSpend
    spawnAgent(b, Tool.SEARCH | Tool.CODE)
    ticks(b.engine, 1200)
    expect(b.engine.world.stats.tokenSpend - before).toBeCloseTo(2.4 + 3.85 + 3.16, 6)
  })

  it('keeps the system prompt warm for 300 s after its last use', () => {
    const b = agentBoard()
    const w = b.engine.world
    b.engine.applyNow({ type: 'setSetting', nodeId: b.frontier.id, key: 'prefixCache', value: true })
    spawnAgent(b, Tool.SEARCH)
    ticks(b.engine, 600)
    const p = w.pool.packets[w.pool.acquire()]
    p.systemPromptTokens = C.traffic.agent.systemPromptTokens
    expect(cachedReadTokens(w, b.frontier, p)).toBe(2000)
    ticks(b.engine, 300 * ticksPerSecond(C) + 1)
    expect(cachedReadTokens(w, b.frontier, p)).toBe(0)
  })

  it('charges $80 once to turn caching on, then toggles for free', () => {
    const b = agentBoard()
    const w = b.engine.world
    const start = w.budget
    const set = (value: boolean) => b.engine.applyNow({ type: 'setSetting', nodeId: b.frontier.id, key: 'prefixCache', value })
    expect(set(true).ok).toBe(true)
    expect(set(false).ok).toBe(true)
    expect(set(true).ok).toBe(true)
    expect(start - w.budget).toBe(80)
    expect(b.frontier.spent).toBe(C.nodes.FRONTIER_API.build + 80)
  })
})

describe('the coordinator (spec v1 §5.2, D26–D28)', () => {
  it('runs a [SEARCH, CODE] task in three passes and hands the answer to users', () => {
    const b = agentBoard()
    spawnAgent(b, Tool.SEARCH | Tool.CODE)
    ticks(b.engine, 1200)
    const s = b.engine.world.stats
    expect(s.modelCalls).toBe(3)
    expect(s.agentRuns).toBe(1)
    expect(s.agentRunsDone).toBe(1)
    expect(b.coordinator.busy).toBe(0)
    expect(b.engine.world.pool.liveCount).toBe(0)
  })

  it('makes a two-lane link and removes it as one', () => {
    const b = agentBoard()
    const w = b.engine.world
    const lanes = () => w.edges.filter((e) => (e.from === b.coordinator.id && e.to === b.search.id) || (e.from === b.search.id && e.to === b.coordinator.id))
    expect(lanes().map((e) => e.returnLane).sort()).toEqual([false, true])
    unlink(b.engine, b.search, b.coordinator)
    expect(lanes()).toEqual([])
  })

  it('still rejects every loop that isn\'t through a coordinator (D27)', () => {
    const b = agentBoard()
    const router = place(b.engine, 'PROMPT_ROUTER', 3, 3)
    const cache = place(b.engine, 'SEMANTIC_CACHE', 5, 3)
    link(b.engine, router, cache)
    expect(b.engine.applyNow({ type: 'link', from: cache.id, to: router.id })).toEqual({ ok: false, reason: 'Loops are only allowed through the agent coordinator' })
  })

  it('admits 16 runs and queues the rest; a full admission queue throttles (D26)', () => {
    const b = agentBoard(calm({ stuckRate: 1 }))
    const w = b.engine.world
    for (let i = 0; i < 16; i++) spawnAgent(b, Tool.SEARCH)
    ticks(b.engine, 5)
    for (let i = 0; i < 24 + 3; i++) spawnAgent(b, Tool.SEARCH)
    ticks(b.engine, 5)
    expect(b.coordinator.busy).toBe(16)
    expect(b.coordinator.queueLength).toBe(24)
    expect(w.stats.throttled).toBe(3)
  })

  it('keeps a run on its model until that queue is over 80% full (D28)', () => {
    const b = agentBoard()
    const w = b.engine.world
    const second = place(b.engine, 'FRONTIER_API', 12, 3)
    link(b.engine, b.coordinator, second)
    spawnAgent(b, Tool.SEARCH | Tool.CODE)
    // Let the first pass land, then crowd its model's queue.
    let first = -1
    for (let t = 0; t < 400 && first < 0; t++) {
      b.engine.tick()
      const p = w.pool.packets.find((q) => q.category === 'AGENT_TASK' && q.loopCount === 1)
      if (p !== undefined) first = p.cacheModelId
    }
    // 27 of 32 queued (over 80%), held there by a provider pool that's full.
    const firstModel = w.nodeById[first] as GameNode
    for (let i = 0; i < 27; i++) {
      const index = w.pool.acquire()
      w.pool.packets[index].deadlineTick = 1_000_000
      firstModel.queue[(firstModel.queueHead + firstModel.queueLength++) % firstModel.queue.length] = index
    }
    w.providers[0].inFlight += 64
    ticks(b.engine, 200)
    const run = w.pool.packets.find((q) => q.category === 'AGENT_TASK')
    expect(run?.nodeId).toBe(second.id)
  })
})

describe('max steps, review and runaways (I-1, D21)', () => {
  it('gives up at max steps with no review gate (−3)', () => {
    const b = agentBoard(calm({ stuckRate: 1 }))
    b.engine.applyNow({ type: 'setSetting', nodeId: b.coordinator.id, key: 'maxSteps', value: 5 })
    spawnAgent(b, Tool.SEARCH)
    ticks(b.engine, 1200)
    const s = b.engine.world.stats
    expect(s.modelCalls).toBe(5)
    expect(s.loopBroken).toBe(1)
    expect(s.gaveUp).toBe(1)
    expect(b.coordinator.busy).toBe(0)
  })

  it('drains a broken run through review as a refusal, 8 s and $0.50', () => {
    const b = agentBoard(calm({ stuckRate: 1 }))
    const w = b.engine.world
    const review = place(b.engine, 'HITL_GATE', 5, 5)
    link(b.engine, b.coordinator, review)
    b.engine.applyNow({ type: 'setSetting', nodeId: b.coordinator.id, key: 'maxSteps', value: 3 })
    spawnAgent(b, Tool.SEARCH)
    ticks(b.engine, 1200)
    expect(w.stats.reviews).toBe(1)
    expect(w.stats.refused).toBe(1)
    expect(w.stats.gaveUp).toBe(0)
    expect(w.stats.upkeep).toBeGreaterThanOrEqual(0.5)
  })

  it('with max steps off, scores the deadline once and keeps the run burning', () => {
    const b = agentBoard(calm({ stuckRate: 1 }))
    const w = b.engine.world
    spawnAgent(b, Tool.SEARCH)
    ticks(b.engine, 120 * ticksPerSecond(C))
    expect(w.stats.timeouts).toBe(1)
    expect(b.coordinator.busy).toBe(1)
    expect(w.stats.modelCalls).toBeGreaterThan(10)
    // Past 10 loops: counted on the plate, with one incident naming its burn rate.
    expect(b.coordinator.longRuns).toBe(1)
    const node = buildSnapshot(w).nodes.find((n) => n.id === b.coordinator.id)
    expect(node?.runs).toEqual({ inFlight: 1, max: 16, stuck: 1 })
    expect(w.incidents.entries.some((e) => /has looped 11 times.*\$[\d.]+\/s/.test(e.text))).toBe(true)
  })

  it('matches the unit economics\' runaway: a stuck run costs more every pass', () => {
    const [at40, at120] = runawayCosts(C, false, [40, 120])
    expect(at120.cost).toBeGreaterThan(at40.cost * 3)
    expect(at120.lastPass).toBeGreaterThan(at40.lastPass)
  })
})

/** Outcomes of one kind in the trust strip's last 30 s. */
function stripCount(engine: GameEngine, column: number): number {
  const strip = engine.world.trust.strip
  let n = 0
  for (let i = column; i < strip.length; i += STRIP_COLUMNS) n += strip[i]
  return n
}

describe('compounding errors and agent scoring (I-1)', () => {
  it('ends a run wrong with P = 1 − r^passes', () => {
    expect(agentWrongRate(C.nodes.FRONTIER_API, 3)).toBeCloseTo(1 - 0.99 ** 3, 12)
    expect(agentWrongRate(C.nodes.FAST_SLM, 3)).toBeCloseTo(1 - 0.8 ** 3, 12)
    expect(agentWrongRate(C.nodes.FAST_SLM, 5)).toBeGreaterThan(agentWrongRate(C.nodes.FAST_SLM, 2))
  })

  it('counts a run that finished wrong, and its token spend, for the phase 3 targets', () => {
    const b = agentBoard(calm({ stepReliability: 0 }))
    spawnAgent(b, Tool.SEARCH)
    ticks(b.engine, 1200)
    const s = b.engine.world.stats
    expect(s.agentRunsDone).toBe(1)
    expect(s.agentWrong).toBe(1)
    expect(s.wrongServed).toBe(1)
    expect(s.agentTokenSpend).toBeCloseTo(s.tokenSpend, 10)
  })

  it('scores an agent task the guardrail refuses as a failure (−3), not a refusal', () => {
    const b = agentBoard(calm({ stepReliability: 0 }, { OUTPUT_GUARDRAIL: { catchRate: 1 } }))
    const w = b.engine.world
    const guard = place(b.engine, 'OUTPUT_GUARDRAIL', 9, 9)
    link(b.engine, b.coordinator, guard)
    link(b.engine, guard, nodeOfType(w, 'USERS_OUT'))
    spawnAgent(b, Tool.SEARCH)
    for (let t = 0; t < 1200 && w.stats.refused === 0; t++) b.engine.tick()
    expect(w.stats.refused).toBe(1)
    expect(stripCount(b.engine, StripColumn.FAILED)).toBe(1)
    expect(stripCount(b.engine, StripColumn.REFUSED)).toBe(0)
  })

  it('times out a review that lands after the user\'s deadline', () => {
    const b = agentBoard(calm({ stuckRate: 1 }, { HITL_GATE: { serviceMs: 60_000 } }))
    const w = b.engine.world
    const review = place(b.engine, 'HITL_GATE', 5, 5)
    link(b.engine, b.coordinator, review)
    b.engine.applyNow({ type: 'setSetting', nodeId: b.coordinator.id, key: 'maxSteps', value: 3 })
    spawnAgent(b, Tool.SEARCH)
    ticks(b.engine, 2000)
    expect(w.stats.reviews).toBe(1)
    expect(w.stats.refused).toBe(0)
    expect(w.stats.timeouts).toBe(1)
  })
})

describe('missing tools and tool-borne injection (D19, D20)', () => {
  it('invents a missing tool: a wrong answer that pays, not an error', () => {
    const b = agentBoard(calm(), { sandbox: false })
    const w = b.engine.world
    spawnAgent(b, Tool.CODE)
    ticks(b.engine, 1200)
    expect(w.stats.fabricatedTools).toBe(1)
    expect(w.stats.wrongServed).toBe(1)
    expect(w.stats.revenue).toBe(12)
    expect(w.stats.timeouts + w.stats.noRouteDrops + w.stats.gaveUp).toBe(0)
  })

  it('treats an agent task with no coordinator as complex chat, its tools invented', () => {
    const engine = quietEngine(calm())
    const w = engine.world
    spawnArrival(w, nodeOfType(w, 'USERS_IN'), 'AGENT_TASK', 'COMPLEX', false, Tool.SEARCH)
    ticks(engine, 600)
    expect(w.stats.modelCalls).toBe(1)
    expect(w.stats.wrongServed).toBe(1)
  })

  it('a tainted run breaches when it runs code without a sandbox, and is contained with one', () => {
    const patch: DeepPartial<Catalog> = { ...calm({ injectionBreachRate: 1 }), nodes: { ...calm({ injectionBreachRate: 1 }).nodes, MCP_WEB_SEARCH: { taintRate: 1 } } }
    const bare = agentBoard(patch, { sandbox: false })
    spawnAgent(bare, Tool.SEARCH | Tool.CODE)
    ticks(bare.engine, 1200)
    expect(bare.engine.world.stats.injectionBreaches).toBe(1)

    const boxed = agentBoard(patch)
    spawnAgent(boxed, Tool.SEARCH | Tool.CODE)
    ticks(boxed.engine, 1200)
    expect(boxed.engine.world.stats.injectionBreaches).toBe(0)
    expect(boxed.engine.world.stats.taintContained).toBe(1)
  })
})

describe('provider B (I-2)', () => {
  it('is its own pool, 20% cheaper per token and 30% slower to decode', () => {
    const b = agentBoard()
    const w = b.engine.world
    expect(b.engine.applyNow({ type: 'setSetting', nodeId: b.frontier.id, key: 'provider', value: 'B' }).ok).toBe(true)
    expect(b.frontier.label).toBe('Frontier B')
    const spec = w.providers[1].spec
    expect(spec.inputPricePer1k).toBeCloseTo(0.8, 10)
    expect(spec.outputPricePer1k).toBeCloseTo(4, 10)
    expect(spec.firstTokenMs).toBeCloseTo(455, 10)
    expect(spec.msPerOutputToken).toBeCloseTo(13, 10)
    expect(b.engine.applyNow({ type: 'setSetting', nodeId: b.frontier.id, key: 'provider', value: 'C' }).ok).toBe(false)
  })

  it('a call started on A finishes on A\'s pool after the node moves to B', () => {
    const b = agentBoard()
    const w = b.engine.world
    spawnAgent(b, Tool.SEARCH)
    for (let t = 0; t < 200 && w.providers[0].inFlight === 0; t++) b.engine.tick()
    expect(w.providers[0].inFlight).toBe(1)
    b.engine.applyNow({ type: 'setSetting', nodeId: b.frontier.id, key: 'provider', value: 'B' })
    ticks(b.engine, 1200)
    expect(w.providers.map((p) => p.inFlight)).toEqual([0, 0])
  })

  it('shows B in the snapshot only once a node is on it', () => {
    const b = agentBoard()
    expect(buildSnapshot(b.engine.world).providers.map((p) => p.name)).toEqual(['A'])
    b.engine.applyNow({ type: 'setSetting', nodeId: b.frontier.id, key: 'provider', value: 'B' })
    expect(buildSnapshot(b.engine.world).providers.map((p) => p.name)).toEqual(['A', 'B'])
  })
})

describe('unit economics (I-3)', () => {
  it('max steps 5 with caching beats no caching on Frontier, and a missing sandbox raises wrong answers', () => {
    const rows = agentPaths(C)
    const row = (label: string, maxSteps: number, cache: boolean) => rows.find((r) => r.label === label && r.maxSteps === maxSteps && r.prefixCache === cache)
    const off = row('Frontier A', 5, false)
    const on = row('Frontier A', 5, true)
    const noBox = row('Frontier A, no sandbox', 5, true)
    expect(on !== undefined && off !== undefined && on.margin > off.margin + 3).toBe(true)
    expect(noBox !== undefined && on !== undefined && noBox.wrong > on.wrong * 10 && Math.abs(noBox.broken - on.broken) < 0.01).toBe(true)
  })

  it('caching roughly breaks even on a model serving the 9:00 mix and pays on one kept for agents', () => {
    const [mixed, agentsOnly] = modelMixEconomics(C, 540)
    expect(Math.abs(mixed.netOn - mixed.netOff)).toBeLessThan(3)
    expect(agentsOnly.netOn - agentsOnly.netOff).toBeGreaterThan(8)
  })
})
