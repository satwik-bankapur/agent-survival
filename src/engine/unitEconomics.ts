/*
 * Unit economics, computed from the catalog with the engine's own formulas
 * (the same cost, latency, quality and wrong-rate functions the simulation
 * runs), so the numbers can't drift from the game. `npm run balance` prints
 * them before any run: what each RAG path costs and earns per question, and
 * what leaked PII and attacks cost per second at phase 2 traffic.
 */

import { agentRevenue, type Catalog, type ModelSpec, type PrefixCacheSpec } from './catalog'
import { modelCallCost, modelLatencyMs, type CallTokens } from './economy'
import { transitTicksFor } from './grid'
import { agentWrongRate, boostQuality, ragWrongRate } from './nodes/model'
import { toolCount } from './nodes/usersIn'
import { Rng } from './rng'
import { Tool } from './types'
import { arrivalRate, categoryShare, complexShare, drawToolPlan } from './WaveDirector'
import { providerModelSpec } from './world'

export interface RagPathEconomics {
  readonly path: string
  readonly model: 'FRONTIER_API' | 'FAST_SLM'
  /** Context quality q the model sees. */
  readonly quality: number
  readonly inputTokens: number
  /** Token cost of the model call. */
  readonly cost: number
  /** Revenue minus cost: what a right or a wrong answer earns (wrong ones pay too, D10). */
  readonly margin: number
  /** P(wrong), with no drift. */
  readonly wrongRate: number
  /** Service time along the path: retrieval plus the model call, with no queues or transit. */
  readonly latencyMs: number
}

interface PathShape {
  readonly path: string
  readonly vectorDb: boolean
  readonly bm25: boolean
  readonly reranker: boolean
}

/** D42's four pipelines, on a Flat vector DB. */
const PATHS: readonly PathShape[] = [
  { path: 'No retrieval', vectorDb: false, bm25: false, reranker: false },
  { path: 'Vector DB (Flat)', vectorDb: true, bm25: false, reranker: false },
  { path: 'Vector DB + reranker', vectorDb: true, bm25: false, reranker: true },
  { path: 'Vector DB + BM25 + reranker', vectorDb: true, bm25: true, reranker: true },
]

const MODELS: readonly ('FRONTIER_API' | 'FAST_SLM')[] = ['FRONTIER_API', 'FAST_SLM']

/** Every RAG path on every model, Frontier first. */
export function ragPaths(catalog: Catalog): RagPathEconomics[] {
  const rag = catalog.traffic.rag
  const n = catalog.nodes
  const out: RagPathEconomics[] = []
  for (const model of MODELS) {
    const spec = n[model]
    for (const shape of PATHS) {
      let q = 0
      let context = 0
      let ms = 0
      if (shape.vectorDb) {
        const tier = n.VECTOR_DB.tiers[0]
        q = tier.quality
        context = n.VECTOR_DB.contextTokens
        ms += tier.serviceMs
      }
      if (shape.bm25) {
        q = boostQuality(q, n.BM25_SEARCH.hybridBoost)
        ms += n.BM25_SEARCH.serviceMs
      }
      if (shape.reranker) {
        ms += n.RERANKER.baseMs + context * n.RERANKER.msPerContextToken
        q = boostQuality(q, n.RERANKER.boost)
        context = Math.min(context, n.RERANKER.compressTo)
      }
      const tokens: CallTokens = { newInputTokens: rag.inputTokens + context, cachedPrefixTokens: 0, outputTokensGenerated: rag.outputTokens }
      const cost = modelCallCost(spec, tokens)
      out.push({
        path: shape.path,
        model,
        quality: q,
        inputTokens: tokens.newInputTokens,
        cost,
        margin: rag.revenue - cost,
        wrongRate: ragWrongRate(catalog, spec, q, 0),
        latencyMs: ms + modelLatencyMs(spec, tokens),
      })
    }
  }
  return out
}

export interface LeakCost {
  readonly label: string
  readonly breachesPerSec: number
  readonly finesPerSec: number
  /** Leaked PII: the revenue the breached prompts would have earned. Attacks: their wasted tokens. */
  readonly otherPerSec: number
  readonly totalPerSec: number
  /** Trust score lost per second to breaches (D8). */
  readonly trustPerSec: number
}

/**
 * Expected cost per second of leaks at a moment of phase 2 traffic, with no director event and
 * no cache in front: PII with and without a redactor (every hosted model leaks it, D43), and
 * attacks on each model with and without a firewall.
 */
export function leakCosts(catalog: Catalog, sec: number): LeakCost[] {
  const t = catalog.traffic
  const n = catalog.nodes
  const rate = arrivalRate(catalog, sec)
  const adversarial = categoryShare(catalog, t.adversarial, sec)
  const rag = categoryShare(catalog, t.rag, sec)
  const chat = 1 - adversarial - rag
  const complex = complexShare(catalog, sec)
  const trustHit = -catalog.trust.score.BREACH
  const row = (label: string, breaches: number, fine: number, other: number): LeakCost => ({
    label,
    breachesPerSec: breaches,
    finesPerSec: breaches * fine,
    otherPerSec: other,
    totalPerSec: breaches * fine + other,
    trustPerSec: breaches * trustHit,
  })

  const nonAttack = rate * (1 - adversarial)
  const pii = nonAttack * t.piiShare
  const chatRevenue = complex * t.chat.COMPLEX.revenue + (1 - complex) * t.chat.SIMPLE.revenue
  const meanRevenue = nonAttack > 0 ? (rag * t.rag.revenue + chat * chatRevenue) / (1 - adversarial) : 0
  const piiThrough = pii * (1 - n.PII_REDACTOR.scrubRate)
  const piiFine = catalog.breachFine.PII
  const rows = [
    row('PII, no redactor', pii, piiFine, pii * meanRevenue),
    row('PII, with redactor', piiThrough, piiFine, piiThrough * meanRevenue),
  ]

  const attacks = rate * adversarial
  const attack: CallTokens = { newInputTokens: t.adversarial.inputTokens, cachedPrefixTokens: 0, outputTokensGenerated: t.adversarial.outputTokens }
  for (const model of ['FAST_SLM', 'FRONTIER_API'] as const) {
    const spec = n[model]
    const tokens = modelCallCost(spec, attack)
    for (const firewall of [false, true]) {
      const reaching = firewall ? attacks * (1 - n.PROMPT_FIREWALL.blockRate) : attacks
      rows.push(
        row(`Attacks on ${spec.name}, ${firewall ? 'with' : 'no'} firewall`, reaching * spec.injectionBreachRate, catalog.breachFine.INJECTION, reaching * tokens),
      )
    }
  }
  return rows
}

// ---------------------------------------------------------------------------
// Agent tasks (I-3)
// ---------------------------------------------------------------------------

/** A tube of a typical 4 tiles, each way (D30). */
const HOP_TILES = 4
/** Tasks simulated per agent path: enough for rates to about ±0.4 points. */
const AGENT_SAMPLES = 20_000

export interface AgentPathOptions {
  readonly model: ModelSpec
  /** 0 is off. */
  readonly maxSteps: number
  readonly prefixCache: boolean
  /** Tool bits that aren't wired, so the model invents their results (D19). */
  readonly missingTools: number
}

/** One simulated task: its token cost, time, model passes and how it ended. */
interface AgentTaskResult {
  cost: number
  /** The last pass's cost alone. */
  lastPass: number
  ms: number
  passes: number
  outcome: 'good' | 'wrong' | 'broken' | 'runaway'
}

/**
 * Plays one agent task the way the coordinator, models and tools do (D5, D6, D19, I-1), with the
 * same cost and latency functions, and no queues. The shared system prompt is warm. A stuck run
 * with max steps off stops at `untilSec`.
 */
function playAgentTask(catalog: Catalog, o: AgentPathOptions, plan: number, rng: Rng, untilSec: number, forceStuck = false): AgentTaskResult {
  const a = catalog.traffic.agent
  const cache: PrefixCacheSpec | null = o.prefixCache ? catalog.prefixCache : null
  const hopMs = transitTicksFor(catalog, HOP_TILES) * catalog.tickMs
  const required = toolCount(plan)
  const t: CallTokens & { newInputTokens: number; cachedPrefixTokens: number } = {
    newInputTokens: a.systemPromptTokens + a.inputTokens,
    cachedPrefixTokens: 0,
    outputTokensGenerated: a.outputTokens,
  }
  const r: AgentTaskResult = { cost: 0, lastPass: 0, ms: 0, passes: 0, outcome: 'good' }
  let done = 0
  let fabricated = false
  let stuck = forceStuck
  for (;;) {
    if (o.maxSteps > 0 && r.passes >= o.maxSteps) {
      r.outcome = 'broken'
      return r
    }
    // Pass 1 reads the warm system prompt; later ones read the run's whole context.
    const read = cache === null ? 0 : r.passes === 0 ? a.systemPromptTokens : t.cachedPrefixTokens
    r.lastPass = modelCallCost(o.model, t, cache, read)
    r.cost += r.lastPass
    r.ms += modelLatencyMs(o.model, t, cache, read) + 2 * hopMs
    r.passes++
    if (r.passes === 1 && !forceStuck) stuck = rng.chance(o.model.stuckRate)
    t.cachedPrefixTokens += t.newInputTokens
    t.newInputTokens = a.outputTokens
    if (!stuck && done >= required) {
      r.outcome = fabricated || rng.chance(agentWrongRate(o.model, r.passes)) ? 'wrong' : 'good'
      return r
    }
    if (r.ms / 1000 >= untilSec) {
      r.outcome = 'runaway'
      return r
    }
    if (!stuck && rng.chance(o.model.toolFailRate)) {
      t.newInputTokens += a.failedCallTokens
      continue
    }
    const tool = done === 0 && (plan & Tool.SEARCH) !== 0 ? Tool.SEARCH : stuck && (plan & Tool.CODE) === 0 ? Tool.SEARCH : Tool.CODE
    if (!stuck) done++
    if ((o.missingTools & tool) !== 0) {
      fabricated = true
      continue
    }
    const spec = tool === Tool.SEARCH ? catalog.nodes.MCP_WEB_SEARCH : catalog.nodes.MCP_CODE_SANDBOX
    t.newInputTokens += spec.outputTokens
    r.ms += spec.serviceMs + 2 * hopMs
  }
}

export interface AgentPathEconomics {
  readonly label: string
  readonly maxSteps: number
  readonly prefixCache: boolean
  /** Token cost per task, including stuck runs up to the deadline. */
  readonly cost: number
  /** Revenue per task: answers delivered by the deadline, right or wrong (D1). */
  readonly revenue: number
  readonly margin: number
  readonly success: number
  readonly wrong: number
  /** Hit max steps unfinished. */
  readonly broken: number
  /** Still running at the deadline: with max steps off, the runaways. */
  readonly late: number
  readonly passes: number
  readonly latencyMs: number
}

/** Mean economics of one agent task on a path, over the tool mix. Deterministic: a fixed seed. */
export function agentPath(catalog: Catalog, label: string, o: AgentPathOptions): AgentPathEconomics {
  const rng = new Rng(7)
  const deadline = catalog.traffic.agent.deadlineSec
  let cost = 0
  let revenue = 0
  let ms = 0
  let passes = 0
  let good = 0
  let wrong = 0
  let broken = 0
  let late = 0
  for (let i = 0; i < AGENT_SAMPLES; i++) {
    const plan = drawToolPlan(catalog, rng.float())
    const r = playAgentTask(catalog, o, plan, rng, deadline)
    cost += r.cost
    ms += r.ms
    passes += r.passes
    const inTime = r.ms / 1000 <= deadline
    if (r.outcome === 'broken') broken++
    if (r.outcome === 'runaway' || !inTime) late++
    if ((r.outcome === 'good' || r.outcome === 'wrong') && inTime) {
      revenue += agentRevenue(catalog, toolCount(plan))
      if (r.outcome === 'good') good++
      else wrong++
    }
  }
  const n = AGENT_SAMPLES
  return {
    label,
    maxSteps: o.maxSteps,
    prefixCache: o.prefixCache,
    cost: cost / n,
    revenue: revenue / n,
    margin: (revenue - cost) / n,
    success: good / n,
    wrong: wrong / n,
    broken: broken / n,
    late: late / n,
    passes: passes / n,
    latencyMs: ms / n,
  }
}

/** Frontier on each provider (I-2). */
function frontierSpecs(catalog: Catalog): { label: string; spec: ModelSpec }[] {
  const f = catalog.nodes.FRONTIER_API
  return [{ label: `Frontier ${f.provider}`, spec: f }, ...f.otherProviders.map((p) => ({ label: `Frontier ${p.name}`, spec: providerModelSpec(f, p) }))]
}

/** The I-3 table: every model by max steps and prefix caching, then a missing code sandbox. */
export function agentPaths(catalog: Catalog): AgentPathEconomics[] {
  const models = [...frontierSpecs(catalog), { label: 'Fast SLM', spec: catalog.nodes.FAST_SLM as ModelSpec }]
  const rows: AgentPathEconomics[] = []
  for (const m of models) {
    for (const maxSteps of [3, 5, 10, 0]) {
      for (const prefixCache of [false, true]) rows.push(agentPath(catalog, m.label, { model: m.spec, maxSteps, prefixCache, missingTools: 0 }))
    }
  }
  for (const m of [models[0], models[models.length - 1]]) {
    rows.push(agentPath(catalog, `${m.label}, no sandbox`, { model: m.spec, maxSteps: 5, prefixCache: true, missingTools: Tool.CODE }))
  }
  return rows
}

/** Per-pass cost of a [SEARCH, CODE] task with no failures: the quadratic growth, pass by pass. */
export function agentPassCosts(catalog: Catalog, model: ModelSpec, prefixCache: boolean): number[] {
  const a = catalog.traffic.agent
  const cache = prefixCache ? catalog.prefixCache : null
  const t = { newInputTokens: a.systemPromptTokens + a.inputTokens, cachedPrefixTokens: 0, outputTokensGenerated: a.outputTokens }
  const costs: number[] = []
  for (const tool of [catalog.nodes.MCP_WEB_SEARCH, catalog.nodes.MCP_CODE_SANDBOX, null]) {
    const read = cache === null ? 0 : costs.length === 0 ? a.systemPromptTokens : t.cachedPrefixTokens
    costs.push(modelCallCost(model, t, cache, read))
    t.cachedPrefixTokens += t.newInputTokens
    t.newInputTokens = a.outputTokens + (tool === null ? 0 : tool.outputTokens)
  }
  return costs
}

export interface RunawayCost {
  readonly sec: number
  readonly passes: number
  readonly cost: number
  readonly lastPass: number
}

/** A stuck [SEARCH] run on Frontier A with max steps off: what it has burned by each time. */
export function runawayCosts(catalog: Catalog, prefixCache: boolean, times: readonly number[]): RunawayCost[] {
  const o: AgentPathOptions = { model: catalog.nodes.FRONTIER_API, maxSteps: 0, prefixCache, missingTools: 0 }
  return times.map((sec) => {
    const r = playAgentTask(catalog, o, Tool.SEARCH, new Rng(1), sec, true)
    return { sec, passes: r.passes, cost: r.cost, lastPass: r.lastPass }
  })
}

export interface ModelMixEconomics {
  readonly label: string
  /** Prompts per second the model serves. */
  readonly perSec: number
  /** Net dollars per second, revenue minus tokens, with prefix caching off and on. */
  readonly netOff: number
  readonly netOn: number
}

/**
 * One Frontier A at a moment of traffic: serving every prompt that isn't an attack (simple and
 * complex chat, reranked RAG, agents at max steps 5), or only the agents. Prefix caching writes
 * every chat and RAG input and never reads it back, and saves on every agent pass (D5). The
 * target: about break-even mixed, clearly positive kept for agents.
 */
export function modelMixEconomics(catalog: Catalog, sec: number): ModelMixEconomics[] {
  const t = catalog.traffic
  const spec = catalog.nodes.FRONTIER_API
  const rate = arrivalRate(catalog, sec)
  const rag = categoryShare(catalog, t.rag, sec)
  const adversarial = categoryShare(catalog, t.adversarial, sec)
  const agentShare = categoryShare(catalog, t.agent, sec)
  const chat = 1 - rag - adversarial - agentShare
  const complex = complexShare(catalog, sec)
  const reranked = t.rag.inputTokens + catalog.nodes.RERANKER.compressTo
  const prompts = [
    { perSec: rate * chat * (1 - complex), revenue: t.chat.SIMPLE.revenue, tokens: { newInputTokens: t.chat.SIMPLE.inputTokens, cachedPrefixTokens: 0, outputTokensGenerated: t.chat.SIMPLE.outputTokens } },
    { perSec: rate * chat * complex, revenue: t.chat.COMPLEX.revenue, tokens: { newInputTokens: t.chat.COMPLEX.inputTokens, cachedPrefixTokens: 0, outputTokensGenerated: t.chat.COMPLEX.outputTokens } },
    { perSec: rate * rag, revenue: t.rag.revenue, tokens: { newInputTokens: reranked, cachedPrefixTokens: 0, outputTokensGenerated: t.rag.outputTokens } },
  ]
  let chatPerSec = 0
  let chatOff = 0
  let chatOn = 0
  for (const p of prompts) {
    chatPerSec += p.perSec
    chatOff += p.perSec * (p.revenue - modelCallCost(spec, p.tokens))
    chatOn += p.perSec * (p.revenue - modelCallCost(spec, p.tokens, catalog.prefixCache, 0))
  }
  const agents = rate * agentShare
  const off = agentPath(catalog, 'agents', { model: spec, maxSteps: 5, prefixCache: false, missingTools: 0 })
  const on = agentPath(catalog, 'agents', { model: spec, maxSteps: 5, prefixCache: true, missingTools: 0 })
  return [
    { label: 'Frontier A serving the whole mix', perSec: chatPerSec + agents, netOff: chatOff + agents * off.margin, netOn: chatOn + agents * on.margin },
    { label: 'Frontier A serving only agents', perSec: agents, netOff: agents * off.margin, netOn: agents * on.margin },
  ]
}

// ---------------------------------------------------------------------------
// Milestone 4: self-hosting and the judge (J-1, J-2, J-3)
// ---------------------------------------------------------------------------

/** One kind of request: its tokens in and out, and its share of a mix. */
export interface RequestShape {
  readonly label: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly share: number
}

/**
 * A request's latency on a vLLM tier with `batch` sequences running, as the engine times it: the
 * model's latency, plus every output token slowed by batch ÷ 64 (J-1).
 */
export function vllmLatencyMs(catalog: Catalog, tier: number, r: RequestShape, batch: number): number {
  const spec = catalog.nodes.VLLM_CLUSTER
  const model = spec.tiers[tier - 1].model
  const tokens: CallTokens = { newInputTokens: r.inputTokens, cachedPrefixTokens: 0, outputTokensGenerated: r.outputTokens }
  return modelLatencyMs(model, tokens) + (r.outputTokens * model.msPerOutputToken * batch) / spec.batchSlowdownSeqs
}

export interface VllmCapacity {
  /** Sequences running at once at full load: KV memory or the 256 cap, whichever binds. */
  readonly batch: number
  /** Mean latency at that batch. */
  readonly latencyMs: number
  /** Requests a second one replica serves at full load. */
  readonly perSec: number
}

/**
 * One replica at full load on a mix, by Little's law: it runs as many sequences as its KV memory
 * (or the sequence cap) allows, each slowed by the batch, so throughput = batch ÷ mean latency.
 */
export function vllmCapacity(catalog: Catalog, tier: number, mix: readonly RequestShape[]): VllmCapacity {
  const t = catalog.nodes.VLLM_CLUSTER.tiers[tier - 1]
  const seqs = catalog.nodes.VLLM_CLUSTER.concurrency
  const total = mix.reduce((s, r) => s + r.share, 0)
  // At full load the running batch has the mix's shares weighted by how long each kind stays in.
  // Iterate: guess a batch, find the KV each running sequence holds, refit the batch to memory.
  let batch = seqs
  for (let i = 0; i < 50; i++) {
    let held = 0
    let time = 0
    for (const r of mix) {
      const l = vllmLatencyMs(catalog, tier, r, batch)
      held += (r.share / total) * l * (r.inputTokens + r.outputTokens)
      time += (r.share / total) * l
    }
    batch = Math.min(seqs, t.kvTokens / (held / time))
  }
  const latencyMs = mix.reduce((s, r) => s + (r.share / total) * vllmLatencyMs(catalog, tier, r, batch), 0)
  return { batch, latencyMs, perSec: batch / (latencyMs / 1000) }
}

/** Complex chat and reranked RAG at a moment's mix: the traffic a large model takes. */
export function largeModelMix(catalog: Catalog, sec: number): RequestShape[] {
  const t = catalog.traffic
  const rag = categoryShare(catalog, t.rag, sec)
  const chat = 1 - rag - categoryShare(catalog, t.adversarial, sec) - categoryShare(catalog, t.agent, sec)
  return [
    { label: 'Complex chat', inputTokens: t.chat.COMPLEX.inputTokens, outputTokens: t.chat.COMPLEX.outputTokens, share: chat * complexShare(catalog, sec) },
    { label: 'RAG question, reranked', inputTokens: t.rag.inputTokens + catalog.nodes.RERANKER.compressTo, outputTokens: t.rag.outputTokens, share: rag },
  ]
}

/** The J-1 capacity table's requests, each served alone. */
export function capacityShapes(catalog: Catalog): RequestShape[] {
  const t = catalog.traffic
  const a = t.agent
  return [
    { label: 'Simple chat', inputTokens: t.chat.SIMPLE.inputTokens, outputTokens: t.chat.SIMPLE.outputTokens, share: 1 },
    { label: 'Complex chat', inputTokens: t.chat.COMPLEX.inputTokens, outputTokens: t.chat.COMPLEX.outputTokens, share: 1 },
    { label: 'RAG question, reranked', inputTokens: t.rag.inputTokens + catalog.nodes.RERANKER.compressTo, outputTokens: t.rag.outputTokens, share: 1 },
    { label: 'RAG question, not reranked', inputTokens: t.rag.inputTokens + catalog.nodes.VECTOR_DB.contextTokens, outputTokens: t.rag.outputTokens, share: 1 },
    // A [SEARCH] run's second pass: system prompt, input, first output, search result.
    { label: 'Agent pass, mid-run', inputTokens: a.systemPromptTokens + a.inputTokens + a.outputTokens + catalog.nodes.MCP_WEB_SEARCH.outputTokens, outputTokens: a.outputTokens, share: 1 },
    { label: '8K context', inputTokens: 7700, outputTokens: 300, share: 1 },
  ]
}

export interface SelfHostRow {
  readonly perSec: number
  readonly replicas: number
  readonly kw: number
  readonly substations: number
  /** vLLM's upkeep and its substations' per request. */
  readonly vllmPerRequest: number
  readonly frontierA: number
  readonly frontierB: number
  /** What Frontier A's and B's pools can serve together, per second. */
  readonly hostedPerSec: number
}

export interface SelfHostEconomics {
  readonly replicaPerSec: number
  readonly latencyMs: number
  readonly upkeepPerSec: number
  readonly breakEvenA: number
  readonly breakEvenB: number
  readonly rows: readonly SelfHostRow[]
}

/** A Frontier provider's cost per request on a mix, and what its pool serves a second. */
function hostedOn(spec: ModelSpec, limit: number, mix: readonly RequestShape[]): { cost: number; perSec: number } {
  const total = mix.reduce((s, r) => s + r.share, 0)
  let cost = 0
  let ms = 0
  for (const r of mix) {
    const tokens: CallTokens = { newInputTokens: r.inputTokens, cachedPrefixTokens: 0, outputTokensGenerated: r.outputTokens }
    cost += (r.share / total) * modelCallCost(spec, tokens)
    ms += (r.share / total) * modelLatencyMs(spec, tokens)
  }
  return { cost, perSec: limit / (ms / 1000) }
}

/** The 70B against Frontier A and B on the 9:00 large-model mix, at several traffic levels (J-2). */
export function selfHostEconomics(catalog: Catalog, rates: readonly number[], sec = 540, tier = 2): SelfHostEconomics {
  const mix = largeModelMix(catalog, sec)
  const cap = vllmCapacity(catalog, tier, mix)
  const t = catalog.nodes.VLLM_CLUSTER.tiers[tier - 1]
  const sub = catalog.nodes.POWER_SUBSTATION
  const frontier = catalog.nodes.FRONTIER_API
  const b = frontier.otherProviders[0]
  const a = hostedOn(frontier, frontier.providerLimit, mix)
  const bOn = hostedOn(providerModelSpec(frontier, b), b.limit, mix)
  const upkeepPerSec = t.upkeepPerMin / 60
  const rows = rates.map((perSec) => {
    const replicas = Math.ceil(perSec / cap.perSec)
    const kw = replicas * t.kw
    const substations = Math.ceil(kw / sub.kw - 1e-9)
    return {
      perSec,
      replicas,
      kw,
      substations,
      vllmPerRequest: (replicas * upkeepPerSec + (substations * sub.upkeepPerMin) / 60) / perSec,
      frontierA: a.cost,
      frontierB: bOn.cost,
      hostedPerSec: Math.min(perSec, a.perSec + bOn.perSec),
    }
  })
  return { replicaPerSec: cap.perSec, latencyMs: cap.latencyMs, upkeepPerSec, breakEvenA: upkeepPerSec / a.cost, breakEvenB: upkeepPerSec / bOn.cost, rows }
}

export interface JudgeCost {
  readonly label: string
  readonly tokensRead: number
  readonly cost: number
}

/** What judging one answer of each kind costs (J-3): rubric, prompt, context and answer in, a verdict out. */
export function judgeCosts(catalog: Catalog): JudgeCost[] {
  const j = catalog.nodes.LLM_JUDGE
  const t = catalog.traffic
  const cost = (judged: number): number => ((j.rubricTokens + judged) / 1000) * j.inputPricePer1k + (j.verdictTokens / 1000) * j.outputPricePer1k
  const kinds = [
    { label: 'Simple chat', judged: t.chat.SIMPLE.inputTokens + t.chat.SIMPLE.outputTokens },
    { label: 'Complex chat', judged: t.chat.COMPLEX.inputTokens + t.chat.COMPLEX.outputTokens },
    { label: 'RAG question, reranked', judged: t.rag.inputTokens + catalog.nodes.RERANKER.compressTo + t.rag.outputTokens },
    { label: 'Agent task, one search', judged: t.agent.systemPromptTokens + t.agent.inputTokens + 2 * t.agent.outputTokens + catalog.nodes.MCP_WEB_SEARCH.outputTokens },
  ]
  return kinds.map((k) => ({ label: k.label, tokensRead: j.rubricTokens + k.judged, cost: cost(k.judged) }))
}

/** The judge's token spend per second at a moment's traffic, at each sampling choice (J-3). */
export function judgeSpendPerSec(catalog: Catalog, sec: number): { readonly sample: number; readonly perSec: number }[] {
  const t = catalog.traffic
  const costs = judgeCosts(catalog)
  const rate = arrivalRate(catalog, sec)
  const rag = categoryShare(catalog, t.rag, sec)
  const agent = categoryShare(catalog, t.agent, sec)
  const chat = 1 - rag - categoryShare(catalog, t.adversarial, sec) - agent
  const cx = complexShare(catalog, sec)
  const all = rate * (chat * (1 - cx) * costs[0].cost + chat * cx * costs[1].cost + rag * costs[2].cost + agent * costs[3].cost)
  return [...catalog.nodes.LLM_JUDGE.sampleChoices].sort((a, b) => a - b).map((sample) => ({ sample, perSec: all * sample }))
}
