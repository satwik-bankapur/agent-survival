/*
 * The player-visible snapshot (D11), built 4 times a second. It shows only
 * what the player could know: no packet's hidden quality, no per-node answer
 * quality, no latency or token breakdowns. A wrong answer exists here only
 * once users report it. This is the one place the engine allocates on a
 * schedule, at 4 Hz.
 */

import { powerBalance } from './board'
import { breakerStateName } from './breaker'
import { ticksPerSecond, type Catalog } from './catalog'
import { MONEY_HISTORY_SEC, refundFor } from './economy'
import { INCIDENT_LOG_SIZE } from './events'
import { eventEffectText } from './IncidentDirector'
import { STRIP_COLUMNS, STRIP_SECONDS, StripColumn, trustValue } from './trust'
import {
  Loc,
  NODE_TYPES,
  type AgentRunView,
  type Category,
  type GameNode,
  type NodePriceTelemetry,
  type NodeState,
  type NodeTelemetry,
  type NodeType,
  type OutcomeBucket,
  type Packet,
  type PacketView,
  type Strictness,
  type TelemetrySnapshot,
  type VectorDbTierTelemetry,
  type VllmTelemetry,
} from './types'
import { tallyOf } from './runLog'
import { vectorDbDrift } from './nodes/retrieval'
import { recentArrivals, upcoming } from './WaveDirector'
import { modelSpecOf, providerDown, type World } from './world'

/** Money rates average this many complete seconds. */
export const MONEY_RATE_WINDOW_SEC = 10
/** A node shows "queue full" for this long after it last dropped an arrival. */
export const QUEUE_FULL_SHOW_SEC = 2
/** A node shows "busy" at or above this utilization. */
export const BUSY_UTILIZATION = 0.8

export const INCIDENTS_IN_SNAPSHOT = 20

/** Sums the last `window` complete seconds of a per-second ring. Returns [sum, seconds counted]. */
function sumRecent(ring: Float64Array, currentSecond: number, window: number): [number, number] {
  let sum = 0
  let counted = 0
  for (let s = currentSecond - 1; s >= 0 && counted < window; s--) {
    sum += ring[s % ring.length]
    counted++
  }
  return [sum, counted]
}

function nodeState(world: World, node: GameNode): NodeState {
  if (node.type === 'USERS_IN' || node.type === 'USERS_OUT') {
    return node.outEdges.length === 0 && node.type === 'USERS_IN' ? 'no-route' : 'healthy'
  }
  // The cron works on a timer, the review gate answers users itself, and power, the tracer and
  // the judge need no links: none of them needs a link out.
  if (
    node.type === 'INGESTION_CRON' ||
    node.type === 'HITL_GATE' ||
    node.type === 'POWER_SUBSTATION' ||
    node.type === 'TRACER' ||
    node.type === 'LLM_JUDGE'
  ) {
    return 'healthy'
  }
  if (node.outEdges.length === 0) return 'no-route'
  if (world.tick - node.lastQueueFullTick < QUEUE_FULL_SHOW_SEC * ticksPerSecond(world.catalog)) return 'queue-full'
  if (node.busy === 0 && node.queueLength === 0) return 'idle'
  if (node.kvBudget > 0) return node.queueLength > 0 || node.kvInUse / node.kvBudget >= BUSY_UTILIZATION ? 'busy' : 'healthy'
  if (node.queueLength > 0 || node.busy / node.concurrency >= BUSY_UTILIZATION) return 'busy'
  return 'healthy'
}

function nodeTelemetry(world: World, node: GameNode): NodeTelemetry {
  return {
    id: node.id,
    type: node.type,
    label: node.label,
    x: node.x,
    y: node.y,
    queue: node.queueLength,
    queueCapacity: node.queueCapacity,
    busy: node.busy,
    concurrency: node.concurrency,
    utilization: node.concurrency > 0 ? node.busy / node.concurrency : 0,
    drops: node.drops,
    state: nodeState(world, node),
    provider: node.providerIndex >= 0 ? world.providers[node.providerIndex].name : null,
    tier: node.type === 'VECTOR_DB' ? node.tier : null,
    strictness: node.type === 'SEMANTIC_CACHE' ? node.strictness : null,
    maxPerSec: node.type === 'USERS_IN' ? node.throttlePerSec : null,
    blocks: node.type === 'PROMPT_FIREWALL' ? node.blocks : null,
    runs: node.type === 'LANGGRAPH_COORDINATOR' ? { inFlight: node.busy, max: node.concurrency, stuck: node.longRuns } : null,
    maxSteps: node.type === 'LANGGRAPH_COORDINATOR' ? node.maxSteps : null,
    prefixCache: node.type === 'FRONTIER_API' || node.type === 'FAST_SLM' ? node.prefixCache : null,
    prefixCacheBought: node.type === 'FRONTIER_API' || node.type === 'FAST_SLM' ? node.prefixCacheBought : null,
    refund: refundFor(world.catalog, node.spent),
    breaker:
      node.type === 'FRONTIER_API' || node.type === 'FAST_SLM' || node.type === 'VLLM_CLUSTER'
        ? { on: node.breakerOn, bought: node.breakerBought, state: breakerStateName(node) }
        : null,
    vllm: node.type === 'VLLM_CLUSTER' ? vllmTelemetry(world, node) : null,
    sampleRate: node.type === 'LLM_JUDGE' ? node.sampleRate : null,
  }
}

function vllmTelemetry(world: World, node: GameNode): VllmTelemetry {
  const tps = ticksPerSecond(world.catalog)
  const tier = world.catalog.nodes.VLLM_CLUSTER.tiers[node.tier - 1]
  return {
    tier: node.tier,
    tierName: tier.name,
    kvInUse: node.kvInUse,
    kvBudget: node.kvBudget,
    kw: tier.kw,
    powerFromId: node.powerFromId >= 0 ? node.powerFromId : null,
    coldSecondsLeft: Math.max(0, node.coldUntilTick - world.tick) / tps,
    coldStartCost: coldStartCost(world.catalog, node.tier),
  }
}

/** The upkeep a tier burns loading its weights before its first token (J-1): "about $1,400" for the 70B. */
export function coldStartCost(catalog: Catalog, tier: number): number {
  const t = catalog.nodes.VLLM_CLUSTER.tiers[tier - 1]
  return (t.upkeepPerMin / 60) * t.coldStartSec
}

/** The tracer's view (J-3): latency percentiles over the newest answers, and token spend per model. */
function tracingTelemetry(world: World): TelemetrySnapshot['tracing'] {
  if (!world.nodes.some((n) => n.type === 'TRACER')) return null
  const n = Math.min(world.latencyCount, world.latency.length)
  const sorted = Array.from(world.latency.subarray(0, n)).sort((a, b) => a - b)
  const at = (q: number): number | null => (n === 0 ? null : sorted[Math.min(n - 1, Math.floor(q * n))])
  const tokenSpend = []
  for (const node of world.nodes) {
    if (node.type !== 'FRONTIER_API' && node.type !== 'FAST_SLM' && node.type !== 'VLLM_CLUSTER') continue
    tokenSpend.push({ nodeId: node.id, label: node.label, dollars: tallyOf(world, node.id)?.tokenSpend ?? 0 })
  }
  return { latencyP50Sec: at(0.5), latencyP95Sec: at(0.95), tokenSpend }
}

/** The judge's verdicts per producer (J-3), or null without a judge. Only what it sampled and flagged. */
function answerQualityTelemetry(world: World): TelemetrySnapshot['answerQuality'] {
  if (!world.nodes.some((n) => n.type === 'LLM_JUDGE')) return null
  const rows = []
  for (const node of world.nodes) if (node.judged > 0) rows.push({ nodeId: node.id, label: node.label, judged: node.judged, flagged: node.judgedWrong })
  return rows
}

const tiersByCatalog = new WeakMap<Catalog, readonly VectorDbTierTelemetry[]>()

function tiersFor(catalog: Catalog): readonly VectorDbTierTelemetry[] {
  let tiers = tiersByCatalog.get(catalog)
  if (tiers === undefined) {
    tiers = catalog.nodes.VECTOR_DB.tiers.map((t) => ({ name: t.name, upgrade: t.upgrade, upkeepPerMin: t.upkeepPerMin, quality: t.quality, serviceMs: t.serviceMs }))
    tiersByCatalog.set(catalog, tiers)
  }
  return tiers
}

const strictnessByCatalog = new WeakMap<Catalog, TelemetrySnapshot['cacheStrictness']>()

function strictnessFor(catalog: Catalog): TelemetrySnapshot['cacheStrictness'] {
  let levels = strictnessByCatalog.get(catalog)
  if (levels === undefined) {
    const cache = catalog.nodes.SEMANTIC_CACHE
    const level = (s: Strictness) => ({ maxHit: cache.maxHitRate.SIMPLE * cache.strictness[s].hit, wrongHit: cache.wrongHitRate * cache.strictness[s].wrong })
    levels = { LOOSE: level('LOOSE'), BALANCED: level('BALANCED'), STRICT: level('STRICT') }
    strictnessByCatalog.set(catalog, levels)
  }
  return levels
}

const opsOptionsByCatalog = new WeakMap<Catalog, TelemetrySnapshot['opsOptions']>()

function opsOptionsFor(catalog: Catalog): TelemetrySnapshot['opsOptions'] {
  let options = opsOptionsByCatalog.get(catalog)
  if (options === undefined) {
    options = {
      vllmTiers: catalog.nodes.VLLM_CLUSTER.tiers.map((t, i) => ({
        name: t.name,
        upgrade: t.upgrade,
        upkeepPerMin: t.upkeepPerMin,
        kw: t.kw,
        kvGb: Math.round((t.kvTokens * t.kvKbPerToken) / 1_000_000),
        coldStartSec: t.coldStartSec,
        coldStartCost: coldStartCost(catalog, i + 1),
      })),
      judgeSampleChoices: [...catalog.nodes.LLM_JUDGE.sampleChoices].sort((a, b) => a - b),
      breakerBuild: catalog.breaker.build,
    }
    opsOptionsByCatalog.set(catalog, options)
  }
  return options
}

const agentOptionsByCatalog = new WeakMap<Catalog, TelemetrySnapshot['agentOptions']>()

function agentOptionsFor(catalog: Catalog): TelemetrySnapshot['agentOptions'] {
  let options = agentOptionsByCatalog.get(catalog)
  if (options === undefined) {
    const frontier = catalog.nodes.FRONTIER_API
    options = {
      maxStepsChoices: catalog.nodes.LANGGRAPH_COORDINATOR.maxStepsChoices,
      prefixCacheBuild: catalog.prefixCache.build,
      providers: [{ name: frontier.provider, priceMultiplier: 1, slownessMultiplier: 1 }, ...frontier.otherProviders],
    }
    agentOptionsByCatalog.set(catalog, options)
  }
  return options
}

/** The director's event once it's announced, until it ends (D48). Instant events show only their warning. */
function eventTelemetry(world: World): TelemetrySnapshot['event'] {
  const d = world.director
  if (d.kind === null || d.stage === 'waiting') return null
  const tps = ticksPerSecond(world.catalog)
  const announced = d.stage === 'announced'
  const provider = d.kind === 'OUTAGE' ? (world.providers[d.outageProvider]?.name ?? null) : null
  return {
    name: world.catalog.director.events[d.kind].name,
    text: eventEffectText(d, world.catalog, provider ?? ''),
    state: announced ? 'announced' : 'active',
    secondsLeft: Math.max(0, (announced ? d.startTick : d.endTick) - world.tick) / tps,
    elapsedSec: announced ? 0 : Math.max(0, world.tick - d.startTick) / tps,
    provider,
  }
}

/** Prices only, never quality: built once per catalog, so the 4 Hz snapshot doesn't rebuild them. */
const pricesByCatalog = new WeakMap<Catalog, TelemetrySnapshot['prices']>()

function pricesFor(catalog: Catalog): TelemetrySnapshot['prices'] {
  let prices = pricesByCatalog.get(catalog)
  if (prices === undefined) {
    const entries = NODE_TYPES.map((type): [NodeType, NodePriceTelemetry] => {
      const spec = catalog.nodes[type]
      return [type, { name: spec.name, build: spec.build, upkeepPerMin: spec.upkeepPerMin, refund: refundFor(catalog, spec.build) }]
    })
    prices = Object.fromEntries(entries) as Record<NodeType, NodePriceTelemetry>
    pricesByCatalog.set(catalog, prices)
  }
  return prices
}

function phaseAt(world: World, sec: number): TelemetrySnapshot['phase'] {
  const phases = world.catalog.phases
  let index = 0
  while (index + 1 < phases.length && sec >= phases[index + 1].startSec) index++
  const next = index + 1 < phases.length ? phases[index + 1] : null
  return {
    index,
    name: phases[index].name,
    startSec: phases[index].startSec,
    nextName: next === null ? null : next.name,
    nextStartSec: next === null ? null : next.startSec,
  }
}

/** The Retrieval panel: the worst vector DB's drift and the next cron run, or null with no vector DB. */
export function retrievalTelemetry(world: World): TelemetrySnapshot['retrieval'] {
  const tps = ticksPerSecond(world.catalog)
  const cap = world.catalog.nodes.VECTOR_DB.driftCap
  const every = Math.round(world.catalog.nodes.INGESTION_CRON.intervalSec * tps)
  let databases = 0
  let drift = 0
  let nextRun: number | null = null
  for (const node of world.nodes) {
    if (node.type === 'VECTOR_DB') {
      databases++
      drift = Math.max(drift, vectorDbDrift(world, node))
    } else if (node.type === 'INGESTION_CRON') {
      const left = Math.max(0, node.indexedTick + every - world.tick)
      nextRun = nextRun === null ? left : Math.min(nextRun, left)
    }
  }
  if (databases === 0) return null
  return { driftShare: cap > 0 ? drift / cap : 0, reindexInSec: nextRun === null ? null : nextRun / tps }
}

export function buildSnapshot(world: World): TelemetrySnapshot {
  const catalog = world.catalog
  const tps = ticksPerSecond(catalog)
  const timeSec = world.tick / tps
  const second = Math.floor(world.tick / tps)

  // Money
  const e = world.economy
  const [revenue, moneySeconds] = sumRecent(e.revenue, second, MONEY_RATE_WINDOW_SEC)
  const [tokenSpend] = sumRecent(e.tokenSpend, second, MONEY_RATE_WINDOW_SEC)
  const [upkeepRecent] = sumRecent(e.upkeep, second, MONEY_RATE_WINDOW_SEC)
  const [finesRecent] = sumRecent(e.fines, second, MONEY_RATE_WINDOW_SEC)
  const revenuePerSec = moneySeconds > 0 ? revenue / moneySeconds : 0
  const tokenSpendPerSec = moneySeconds > 0 ? tokenSpend / moneySeconds : 0
  // Before a full second has passed, show the upkeep the board is committed to.
  const upkeepPerSec = moneySeconds > 0 ? upkeepRecent / moneySeconds : world.upkeepPerTick * tps
  const finesPerSec = moneySeconds > 0 ? finesRecent / moneySeconds : 0
  const netPerSec = revenuePerSec - tokenSpendPerSec - upkeepPerSec - finesPerSec
  const headroom = world.budget - catalog.budget.gameOverAt
  const history: number[] = []
  const firstSecond = Math.max(0, second - MONEY_HISTORY_SEC + 1)
  for (let s = firstSecond; s <= second; s++) history.push(e.budgetHistory[s % MONEY_HISTORY_SEC])

  // Trust
  const t = world.trust
  const strip: OutcomeBucket[] = []
  for (let s = second - STRIP_SECONDS + 1; s <= second; s++) {
    if (s < 0) {
      strip.push({ good: 0, throttled: 0, refused: 0, failed: 0, wrongReported: 0 })
      continue
    }
    const base = (s % STRIP_SECONDS) * STRIP_COLUMNS
    strip.push({
      good: t.strip[base + StripColumn.GOOD],
      throttled: t.strip[base + StripColumn.THROTTLED],
      refused: t.strip[base + StripColumn.REFUSED],
      failed: t.strip[base + StripColumn.FAILED],
      wrongReported: t.strip[base + StripColumn.WRONG_REPORTED],
    })
  }
  const trust = trustValue(t)
  const critical = trust < catalog.trust.criticalBelow

  // Traffic: arrivals at Users in over the last 5 s, up to and including this tick
  const recent = recentArrivals(world)
  const { simple, complex } = recent
  const trafficSeconds = recent.ticks / tps
  const arrivals = simple + complex
  const share = (n: number): number => (arrivals > 0 ? n / arrivals : 0)
  const categoryShare: Record<Category, number> = {
    CHAT: share(arrivals - recent.rag - recent.adversarial - recent.agent),
    RAG_QUERY: share(recent.rag),
    AGENT_TASK: share(recent.agent),
    ADVERSARIAL: share(recent.adversarial),
  }

  // Incidents, newest first
  const entries = world.incidents.entries
  const incidents = []
  for (let i = entries.length - 1; i >= 0 && incidents.length < Math.min(INCIDENTS_IN_SNAPSHOT, INCIDENT_LOG_SIZE); i--) {
    const entry = entries[i]
    incidents.push({
      tick: entry.tick,
      timeSec: entry.tick / tps,
      severity: entry.severity,
      text: entry.text,
      nodeId: entry.nodeId,
    })
  }

  return {
    tick: world.tick,
    timeSec,
    phases: catalog.phases,
    prices: pricesFor(catalog),
    vectorDbTiers: tiersFor(catalog),
    cacheStrictness: strictnessFor(catalog),
    agentOptions: agentOptionsFor(catalog),
    opsOptions: opsOptionsFor(catalog),
    event: eventTelemetry(world),
    phase: phaseAt(world, timeSec),
    money: {
      budget: world.budget,
      gameOverAt: catalog.budget.gameOverAt,
      revenuePerSec,
      tokenSpendPerSec,
      upkeepPerSec,
      finesPerSec,
      netPerSec,
      bankruptInSec: netPerSec < 0 && !catalog.sandbox ? Math.max(0, headroom) / -netPerSec : null,
      history,
    },
    trust: {
      value: trust,
      criticalBelow: catalog.trust.criticalBelow,
      criticalSec: catalog.trust.criticalSec,
      criticalSecondsLeft: critical && !catalog.sandbox ? Math.max(0, t.criticalLimitTicks - t.criticalTicks) / tps : null,
      strip,
    },
    traffic: {
      ratePerSec: trafficSeconds > 0 ? arrivals / trafficSeconds : 0,
      simpleShare: arrivals > 0 ? simple / arrivals : 0,
      complexShare: arrivals > 0 ? complex / arrivals : 0,
      categoryShare,
      next: upcoming(catalog, timeSec),
    },
    retrieval: retrievalTelemetry(world),
    nodes: world.nodes.map((node) => nodeTelemetry(world, node)),
    tracing: tracingTelemetry(world),
    answerQuality: answerQualityTelemetry(world),
    power: powerBalance(world),
    // The first provider always shows; another once a node is on it, or a call still is (I-2).
    providers: world.providers
      .filter((p, i) => i === 0 || p.inFlight > 0 || world.nodes.some((n) => n.providerIndex === i))
      .map((p) => ({ name: p.name, inFlight: p.inFlight, limit: p.limit, down: providerDown(world, world.providers.indexOf(p)) })),
    incidents,
    gameOver: world.gameOver,
  }
}

function ordinalWord(n: number): string {
  const words = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth']
  return n <= words.length ? words[n - 1] : `number ${n}`
}

/** The player-visible view of one live packet, or null if that packet has gone (D11). */
function agentRunView(world: World, p: Packet): AgentRunView {
  const model = p.cacheModelId >= 0 ? world.nodeById[p.cacheModelId] : undefined
  const r = model === undefined ? null : modelSpecOf(world, model).stepReliability
  return {
    modelPasses: p.loopCount,
    maxSteps: p.coordinatorId >= 0 ? (world.nodeById[p.coordinatorId]?.maxSteps ?? null) : null,
    toolsDone: p.completedToolSteps,
    toolsRequired: p.requiredToolSteps,
    stepReliability: r,
    reliability: r === null ? 1 : r ** p.loopCount,
  }
}

export function packetView(world: World, index: number, serial: number): PacketView | null {
  const p = world.pool.packets[index]
  if (p === undefined || p.serial !== serial || p.loc === Loc.FREE) return null
  const label = (id: number) => world.nodeById[id]?.label ?? 'a removed node'
  let where: string
  switch (p.loc) {
    case Loc.EDGE: {
      const edge = world.edgeById[p.edgeId]
      where = edge === undefined ? 'On a tube' : `On the tube from ${label(edge.from)} to ${label(edge.to)}`
      break
    }
    case Loc.VIRTUAL:
      where = `${p.cacheHit ? 'Cache hit, flying' : 'Sent back'} from ${label(p.fromNodeId)} to ${label(p.nodeId)}`
      break
    case Loc.QUEUE: {
      const node = world.nodeById[p.nodeId]
      let place = 0
      if (node !== undefined) {
        for (let k = 0; k < node.queueLength; k++) if (node.queue[(node.queueHead + k) % node.queue.length] === index) place = k + 1
      }
      where = place > 0 ? `Queued at ${label(p.nodeId)}, ${ordinalWord(place)} in line` : `Queued at ${label(p.nodeId)}`
      break
    }
    default:
      where = `Inside ${label(p.nodeId)}`
  }
  const answered = p.producedByModelId >= 0 || p.cacheHit
  const inRun = p.category === 'AGENT_TASK' && p.loopCount > 0
  const answeredBy =
    p.producedByModelId >= 0 ? label(p.producedByModelId) : p.cacheHit ? world.catalog.nodes.SEMANTIC_CACHE.name : null
  return {
    index,
    serial,
    category: p.category,
    difficulty: p.difficulty,
    cachedTokens: p.cachedPrefixTokens,
    // In a run, the last pass's output is already the head of the next input (D6): count it once, as output.
    newInputTokens: inRun ? Math.max(0, p.newInputTokens - p.outputTokensGenerated) : p.newInputTokens,
    outputTokens: answered ? p.outputTokensGenerated : 0,
    pii: p.containsPII ? 'contains' : p.redacted ? 'redacted' : 'none',
    agent: p.category === 'AGENT_TASK' ? agentRunView(world, p) : null,
    answeredBy,
    cacheHit: p.cacheHit,
    refused: p.refused,
    where,
    deadlineLeftSec: (p.deadlineTick - world.tick) / ticksPerSecond(world.catalog),
  }
}
