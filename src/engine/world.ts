/*
 * The World: every piece of mutable game state, in one object. The engine
 * modules are functions over it; GameEngine owns it and runs the tick.
 */

import { addEdge, addNode } from './board'
import { ticksPerSecond, type Catalog, type FrontierSpec, type ModelSpec, type ProviderSpec } from './catalog'
import { createDirector, type DirectorState } from './IncidentDirector'
import { createEconomy, type EconomyState } from './economy'
import { createBoardEffects, createIncidentLog, EventQueue, type BoardEffects, type IncidentLog } from './events'
import { createRunLog, type RunLog } from './runLog'
import { PacketPool } from './PacketPool'
import { deriveSeed, Rng } from './rng'
import { createTrust, type TrustState } from './trust'
import { NODE_TYPES, type Edge, type GameNode, type GameOver, type NodeType } from './types'
import { createTrafficMeter, type TrafficMeter } from './WaveDirector'

export interface ProviderState {
  readonly name: string
  readonly limit: number
  inFlight: number
  /** Frontier API as this provider prices and runs it (I-2). */
  readonly spec: ModelSpec
}

/** Frontier API on another provider: its prices and decode speed scaled (I-2). */
export function providerModelSpec(frontier: FrontierSpec, p: ProviderSpec): ModelSpec {
  return {
    ...frontier,
    inputPricePer1k: frontier.inputPricePer1k * p.priceMultiplier,
    outputPricePer1k: frontier.outputPricePer1k * p.priceMultiplier,
    firstTokenMs: frontier.firstTokenMs * p.slownessMultiplier,
    msPerOutputToken: frontier.msPerOutputToken * p.slownessMultiplier,
  }
}

/** Ground truth for tests and the balance report. Never part of the snapshot (D11). */
export interface Stats {
  arrivals: number
  throttled: number
  /** Answers that reached users before their deadline and earned revenue, right or wrong. */
  served: number
  good: number
  wrongServed: number
  refused: number
  timeouts: number
  queueFullDrops: number
  noRouteDrops: number
  brokenAnswers: number
  demolishedDrops: number
  complaints: number
  cacheHits: number
  wrongCacheHits: number
  modelCalls: number
  /** Input plus output tokens of every model call. */
  tokens: number
  jsonRetries: number
  revenue: number
  tokenSpend: number
  upkeep: number
  buildSpend: number
  fines: number
  /** Breaches (D43): leaked injections and leaked PII. */
  injectionBreaches: number
  piiBreaches: number
  /** Attacks the firewall stopped, and ones that reached users without a breach (D44). */
  attacksBlocked: number
  attacksResisted: number
  /** Agent runs (I-1, I-2): admitted, finished, broken by max steps, sent to review, past the runaway count. */
  agentRuns: number
  agentRunsDone: number
  loopBroken: number
  /** Broken runs with no review gate: they gave up (−3). */
  gaveUp: number
  reviews: number
  runaways: number
  /** Tool results a model invented because the tool wasn't wired (D19). */
  fabricatedTools: number
  /** Agent runs that finished with a wrong answer, before the guardrail catches any (I-4). */
  agentWrong: number
  /** Tokens spent on agent tasks' model passes, for the caching bet (I-4). */
  agentTokenSpend: number
  /** Tool-borne injections a code sandbox contained (D20). */
  taintContained: number
  /** A return to a coordinator that found no room. D26 says this never happens; the flood test holds it to 0. */
  returnDrops: number
  /** Wrong answers served to RAG questions whose vector DB had drifted past half its cap (J-7). */
  wrongDrifted: number
  /** Calls that failed on a provider in an outage (J-4). */
  providerErrors: number
  /** Packets given the degraded canned reply because every model they could go to was open or cold (D29). */
  degraded: number
  /** Breakers that opened (D29). */
  breakerTrips: number
  /** Judge (J-3): answers sampled, wrong answers it revealed, and good ones it flagged by mistake. */
  judged: number
  judgeReveals: number
  judgeFalseFlags: number
  minTrust: number
}

function createStats(): Stats {
  return {
    arrivals: 0,
    throttled: 0,
    served: 0,
    good: 0,
    wrongServed: 0,
    refused: 0,
    timeouts: 0,
    queueFullDrops: 0,
    noRouteDrops: 0,
    brokenAnswers: 0,
    demolishedDrops: 0,
    complaints: 0,
    cacheHits: 0,
    wrongCacheHits: 0,
    modelCalls: 0,
    tokens: 0,
    jsonRetries: 0,
    revenue: 0,
    tokenSpend: 0,
    upkeep: 0,
    buildSpend: 0,
    fines: 0,
    injectionBreaches: 0,
    piiBreaches: 0,
    attacksBlocked: 0,
    attacksResisted: 0,
    agentRuns: 0,
    agentRunsDone: 0,
    loopBroken: 0,
    gaveUp: 0,
    reviews: 0,
    runaways: 0,
    fabricatedTools: 0,
    agentWrong: 0,
    agentTokenSpend: 0,
    taintContained: 0,
    returnDrops: 0,
    wrongDrifted: 0,
    providerErrors: 0,
    degraded: 0,
    breakerTrips: 0,
    judged: 0,
    judgeReveals: 0,
    judgeFalseFlags: 0,
    minTrust: 100,
  }
}

export interface World {
  readonly catalog: Catalog
  readonly seed: number
  /** The tick being processed, or the next one to run between ticks. */
  tick: number
  /** Separate streams, so a draw in one never shifts another (traffic stays identical across builds). */
  readonly rng: { readonly traffic: Rng; readonly rolls: Rng; readonly complaints: Rng; readonly director: Rng; readonly judge: Rng }
  readonly pool: PacketPool

  /** Live nodes and edges, in ascending id order. */
  readonly nodes: GameNode[]
  readonly nodeById: (GameNode | undefined)[]
  readonly edges: Edge[]
  readonly edgeById: (Edge | undefined)[]
  nextNodeId: number
  nextEdgeId: number
  readonly labelCounts: Record<NodeType, number>
  /** Node id per tile, or -1. */
  readonly occupancy: Int32Array
  readonly providers: ProviderState[]
  usersInId: number

  /** Packets on virtual hops (cache hits, JSON retries), in send order. */
  readonly virtual: Int32Array
  virtualLength: number

  budget: number
  upkeepPerTick: number
  readonly economy: EconomyState
  readonly trust: TrustState
  readonly events: EventQueue
  readonly incidents: IncidentLog
  /** Timeouts, cache hits and complaints, for the board to draw (canvas only, never the HUD). */
  readonly effects: BoardEffects
  complaintIncidentReadyTick: number
  readonly traffic: TrafficMeter
  readonly stats: Stats
  /** Ground truth for the postmortem, after the run (D39). Never part of the snapshot. */
  readonly runLog: RunLog
  /** The incident director's schedule and current event (D48). */
  readonly director: DirectorState
  /** End-to-end seconds of the newest answers, for the tracer's percentiles (J-3). A ring. */
  readonly latency: Float32Array
  latencyCount: number
  gameOver: GameOver | null
}

/** A fresh world with the starting board: Users in → Frontier A → Users out, already linked. */
export function createWorld(seed: number, catalog: Catalog): World {
  const cells = catalog.board.cols * catalog.board.rows
  const frontier = catalog.nodes.FRONTIER_API
  const directorRng = new Rng(deriveSeed(seed, 4))
  const world: World = {
    catalog,
    seed,
    tick: 0,
    rng: {
      traffic: new Rng(deriveSeed(seed, 1)),
      rolls: new Rng(deriveSeed(seed, 2)),
      complaints: new Rng(deriveSeed(seed, 3)),
      director: directorRng,
      // Its own stream, so placing a judge never moves another roll (J-3).
      judge: new Rng(deriveSeed(seed, 5)),
    },
    pool: new PacketPool(catalog.packetPoolSize),
    nodes: [],
    nodeById: [],
    edges: [],
    edgeById: [],
    nextNodeId: 1,
    nextEdgeId: 1,
    labelCounts: Object.fromEntries(NODE_TYPES.map((t) => [t, 0])) as Record<NodeType, number>,
    occupancy: new Int32Array(cells).fill(-1),
    providers: [
      { name: frontier.provider, limit: frontier.providerLimit, inFlight: 0, spec: frontier },
      ...frontier.otherProviders.map((p) => ({ name: p.name, limit: p.limit, inFlight: 0, spec: providerModelSpec(frontier, p) })),
    ],
    usersInId: -1,
    virtual: new Int32Array(catalog.packetPoolSize),
    virtualLength: 0,
    budget: catalog.budget.start,
    upkeepPerTick: 0,
    economy: createEconomy(),
    trust: createTrust(catalog),
    events: new EventQueue(1024),
    incidents: createIncidentLog(),
    effects: createBoardEffects(),
    complaintIncidentReadyTick: 0,
    traffic: createTrafficMeter(catalog),
    stats: createStats(),
    runLog: createRunLog(),
    director: createDirector(catalog, directorRng),
    latency: new Float32Array(catalog.nodes.TRACER.latencySamples),
    latencyCount: 0,
    gameOver: null,
  }

  const start = catalog.startingBoard
  const usersIn = addNode(world, 'USERS_IN', start.usersIn.x, start.usersIn.y)
  const frontierA = addNode(world, 'FRONTIER_API', start.frontier.x, start.frontier.y)
  const usersOut = addNode(world, 'USERS_OUT', start.usersOut.x, start.usersOut.y)
  addEdge(world, usersIn, frontierA)
  addEdge(world, frontierA, usersOut)
  return world
}

export function tileIndex(world: World, x: number, y: number): number {
  return y * world.catalog.board.cols + x
}

export function nodeAt(world: World, x: number, y: number): GameNode | undefined {
  const id = world.occupancy[tileIndex(world, x, y)]
  return id >= 0 ? world.nodeById[id] : undefined
}

/** The spec a model node runs on: a Frontier node's provider's (I-2), a vLLM cluster's tier's (J-1), otherwise Fast SLM's. */
export function modelSpecOf(world: World, node: GameNode): ModelSpec {
  if (node.type === 'FRONTIER_API' && node.providerIndex >= 0) return world.providers[node.providerIndex].spec
  if (node.type === 'VLLM_CLUSTER') return world.catalog.nodes.VLLM_CLUSTER.tiers[node.tier - 1].model
  return world.catalog.nodes.FAST_SLM
}

/** Is a provider in an outage now: the director's, or the balance drill's (J-4, J-6)? */
export function providerDown(world: World, providerIndex: number): boolean {
  const d = world.director
  if (d.stage === 'active' && d.kind === 'OUTAGE' && d.outageProvider === providerIndex) return true
  const drill = world.catalog.director.drill
  if (drill === null || drill.provider !== providerIndex) return false
  const sec = world.tick / ticksPerSecond(world.catalog)
  return sec >= drill.startSec && sec < drill.endSec
}
