/*
 * Shared engine types. The engine keeps ground truth here; telemetry.ts turns
 * it into the player-visible snapshot (D11), whose types are at the bottom.
 */

export type NodeType =
  | 'USERS_IN'
  | 'USERS_OUT'
  | 'FRONTIER_API'
  | 'FAST_SLM'
  | 'SEMANTIC_CACHE'
  | 'PROMPT_ROUTER'
  | 'OUTPUT_GUARDRAIL'
  | 'PROMPT_FIREWALL'
  | 'PII_REDACTOR'
  | 'VECTOR_DB'
  | 'BM25_SEARCH'
  | 'RERANKER'
  | 'INGESTION_CRON'
  | 'LANGGRAPH_COORDINATOR'
  | 'MCP_WEB_SEARCH'
  | 'MCP_CODE_SANDBOX'
  | 'HITL_GATE'
  | 'VLLM_CLUSTER'
  | 'POWER_SUBSTATION'
  | 'TRACER'
  | 'LLM_JUDGE'

export const NODE_TYPES: readonly NodeType[] = [
  'USERS_IN',
  'USERS_OUT',
  'FRONTIER_API',
  'FAST_SLM',
  'SEMANTIC_CACHE',
  'PROMPT_ROUTER',
  'OUTPUT_GUARDRAIL',
  'PROMPT_FIREWALL',
  'PII_REDACTOR',
  'VECTOR_DB',
  'BM25_SEARCH',
  'RERANKER',
  'INGESTION_CRON',
  'LANGGRAPH_COORDINATOR',
  'MCP_WEB_SEARCH',
  'MCP_CODE_SANDBOX',
  'HITL_GATE',
  'VLLM_CLUSTER',
  'POWER_SUBSTATION',
  'TRACER',
  'LLM_JUDGE',
]

/** A circuit breaker's state (D29). */
export const Breaker = { CLOSED: 0, OPEN: 1, HALF_OPEN: 2 } as const
export type BreakerStateValue = (typeof Breaker)[keyof typeof Breaker]

/** Semantic cache strictness (D15). */
export type Strictness = 'LOOSE' | 'BALANCED' | 'STRICT'
export const STRICTNESS_LEVELS: readonly Strictness[] = ['LOOSE', 'BALANCED', 'STRICT']

/** Bits of Packet.retrievalMask: which retrieval nodes a RAG question has been through. */
export const Retrieved = { VECTOR_DB: 1, BM25: 2, RERANKED: 4 } as const

/** Bits of Packet.toolPlan: the tools an agent task needs (D19). Search always runs first. */
export const Tool = { SEARCH: 1, CODE: 2 } as const

/** What an agent run needs next, set by the model or tool it just left (spec v1's four rules). */
export const AgentStep = { NEXT_MODEL: 0, CALL_SEARCH: 1, CALL_CODE: 2, DONE: 3 } as const
export type AgentStepValue = (typeof AgentStep)[keyof typeof AgentStep]

export type Category = 'CHAT' | 'RAG_QUERY' | 'AGENT_TASK' | 'ADVERSARIAL'
export type Difficulty = 'SIMPLE' | 'COMPLEX'

export interface Tile {
  readonly x: number
  readonly y: number
}

/** Where a packet is. The engine stores no geometry (D33). */
export const Loc = {
  FREE: 0,
  /** On an edge: `edgeId`, `lane`, `enterTick`, `transitTicks`. */
  EDGE: 1,
  /** A wireless hop (cache hit, JSON retry) to `nodeId`, from `fromNodeId`. */
  VIRTUAL: 2,
  /** Waiting in `nodeId`'s input queue. */
  QUEUE: 3,
  /** Being worked on by `nodeId`, in worker `slot`. */
  WORKER: 4,
} as const
export type LocKind = (typeof Loc)[keyof typeof Loc]

/** Spec v1's PromptPacket, plus the Milestone 1 additions. Pooled (D31), so every field is mutable. */
export interface Packet {
  readonly index: number
  serial: number
  category: Category
  difficulty: Difficulty
  createdTick: number
  deadlineTick: number

  newInputTokens: number
  cachedPrefixTokens: number
  outputTokensGenerated: number

  contextQuality: number
  /** Retrieved context in the prompt (D45), already counted in newInputTokens. */
  contextTokens: number
  /** Vector DB staleness this RAG question picked up (D46). Ground truth. */
  drift: number
  /** Retrieved bits. */
  retrievalMask: number

  /** The shared, cacheable system prompt inside newInputTokens on the first pass (D5). 0 for chat and RAG. */
  systemPromptTokens: number
  requiredToolSteps: number
  completedToolSteps: number
  /** Agent runs: model passes so far. */
  loopCount: number
  lastVisitedNodeType: NodeType | null
  /** Tool bits (D19). */
  toolPlan: number
  agentStep: AgentStepValue
  /** The coordinator whose run this is, or -1 outside a run (D26). */
  coordinatorId: number
  /** The model this run last used: its prefix cache holds the run's context (D5, D28). */
  cacheModelId: number
  /** Ground truth: never finishes on its own (I-1). */
  stuck: boolean
  /** Ground truth: a web search result carried a hidden injection (D20). */
  tainted: boolean
  /** A needed tool wasn't wired, so the model invented its result (D19). Ground truth. */
  fabricated: boolean
  /** The user gave up at the deadline and the timeout is scored; the run may still loop (I-1). */
  lateScored: boolean
  /** Past the runaway loop count: counted on its coordinator's plate. */
  runaway: boolean
  /** Token cost of the run's last model pass and when the run last left for a model, for the runaway burn rate. */
  lastPassCost: number
  passTick: number
  /** When its last model pass finished: a prefix wiped after this is cold (J-4). */
  cachedAtTick: number
  /** Its model call started on a provider that's down, so it will fail (J-4). */
  callFails: boolean

  containsPII: boolean
  /** The redactor scrubbed its personal data: the capsule carries a black bar (design: "Redacted"). */
  redacted: boolean
  isMaliciousInjection: boolean
  /** Ground truth. Never reaches the snapshot unless revealed (D10, D11). */
  isHallucinated: boolean
  isMalformedJson: boolean
  hasRetriedSchema: boolean

  revealed: boolean
  producedByModelId: number
  cacheHit: boolean
  refused: boolean

  loc: LocKind
  edgeId: number
  lane: number
  enterTick: number
  transitTicks: number
  nodeId: number
  fromNodeId: number
  slot: number
}

export interface GameNode {
  readonly id: number
  readonly type: NodeType
  /** Renamed as others of its type come and go: "Fast SLM" alone, "Fast SLM 1" beside a second. */
  label: string
  /** Its number among its type, never reused. */
  readonly ordinal: number
  readonly x: number
  readonly y: number
  /** Index into World.providers for hosted models, otherwise -1 (D14). */
  providerIndex: number
  /** Provider each worker's call counts against, so switching provider mid-call keeps the pools right. */
  readonly workerProvider: Int8Array
  readonly outEdges: number[]
  readonly inEdges: number[]

  /** Workers in use; a vector DB's tier changes it, up to workers.length. */
  concurrency: number
  readonly queueCapacity: number
  /** Ring buffer of packet indices. */
  readonly queue: Int32Array
  queueHead: number
  queueLength: number
  /** Packet index per worker slot, or -1. */
  readonly workers: Int32Array
  readonly workerFinishTick: Int32Array
  busy: number

  /** Semantic cache lookups so far (D15 warm-up). */
  lookups: number
  /** Everything paid for this node: build plus upgrades. Demolishing refunds a share (D4, D45). */
  spent: number
  /** Vector DB tier, 1 to 3 (D45); 0 for other nodes. */
  tier: number
  /** Semantic cache strictness (D15). */
  strictness: Strictness
  /** Users in's throttle, prompts per second; 0 is off (D7). */
  throttlePerSec: number
  /** The throttle's token bucket. */
  bucket: number
  /** Vector DB: when it was last indexed (D46). Ingestion cron: when it last ran. */
  indexedTick: number
  /** Prompt firewall: attacks blocked. */
  blocks: number
  /** Coordinator: the max-steps loop breaker, 0 for off (I-2). */
  maxSteps: number
  /** Coordinator: runs past the runaway loop count. Its runs in flight are `busy`. */
  longRuns: number
  /** Models: prefix caching on, and whether its one-off price is paid (D5). */
  prefixCache: boolean
  prefixCacheBought: boolean
  /** Models: the agent system prompt stays cached until this tick (D5). */
  prefixWarmUntilTick: number
  /** Models: when a cache invalidation last wiped its prefix cache (J-4). */
  prefixWipedTick: number
  /** Vector DB: drift a drift surge added, until it's next indexed (J-4). */
  driftSurge: number
  /** vLLM: KV-cache memory in tokens (0 for every other node), in use, and per worker (D22). */
  kvBudget: number
  kvInUse: number
  readonly workerKv: Int32Array
  /** vLLM: loading weights until this tick, serving nothing (J-1). */
  coldUntilTick: number
  /** vLLM: the substation its power cable runs to, or -1. */
  powerFromId: number
  /** Models: the circuit breaker (D29), whether it's on and paid for, its state, and its last calls (1 failed, 0 ok). */
  breakerOn: boolean
  breakerBought: boolean
  breakerState: BreakerStateValue
  breakerUntilTick: number
  readonly breakerCalls: Uint8Array
  breakerHead: number
  breakerCount: number
  /** Half-open: probe calls let through, and how many came back fine. */
  probesSent: number
  probeSuccesses: number
  /** LLM judge: its sampling rate (J-3). */
  sampleRate: number
  /** Answers the judge has sampled that this node produced, and how many it flagged wrong. */
  judged: number
  judgedWrong: number
  processed: number
  drops: number
  lastQueueFullTick: number
  /** Earliest tick each per-node incident kind may fire again. */
  readonly incidentReadyTick: Int32Array
}

export interface Edge {
  readonly id: number
  readonly from: number
  readonly to: number
  /** The way back of a coordinator's two-lane link (D27): made and removed with its forward lane. */
  readonly returnLane: boolean
  /** The tube's route on the grid: start, corners, end (D30). Re-planned whenever the board changes. */
  route: readonly Tile[]
  lengthTiles: number
  /** For packets entering from now on; each packet keeps the transit it entered with. */
  transitTicks: number
  /** FIFO ring of packet indices in transit. Delivered in order. */
  readonly ring: Int32Array
  head: number
  length: number
}

/** What happened to a prompt, for trust (D8). */
/** BREACH: a leaked injection or PII (D43). */
export type OutcomeKind = 'GOOD' | 'THROTTLED' | 'REFUSED' | 'FAILED' | 'WRONG' | 'BREACH'

export type FailureReason = 'TIMEOUT' | 'QUEUE_FULL' | 'NO_ROUTE' | 'BROKEN_JSON' | 'DEMOLISHED' | 'GAVE_UP' | 'PROVIDER_ERROR'

export type SettingValue = number | string | boolean

export type Command =
  | { readonly type: 'placeNode'; readonly nodeType: NodeType; readonly x: number; readonly y: number }
  | { readonly type: 'demolish'; readonly nodeId: number }
  | { readonly type: 'link'; readonly from: number; readonly to: number }
  | { readonly type: 'unlink'; readonly from: number; readonly to: number }
  | { readonly type: 'setSetting'; readonly nodeId: number; readonly key: string; readonly value: SettingValue }
  /** The player ends the run, for a postmortem. Logged like any command, so a replay ends there too. */
  | { readonly type: 'endRun' }

export type CommandResult =
  | { readonly ok: true; readonly nodeId?: number; readonly edgeId?: number }
  | { readonly ok: false; readonly reason: string }

/** A command and the tick it applied at. Seed plus this log replays a run (D23). */
export interface LoggedCommand {
  readonly tick: number
  readonly command: Command
}

export type GameOverCause = 'BANKRUPT' | 'TRUST' | 'ENDED'

export interface GameOver {
  readonly cause: GameOverCause
  readonly tick: number
}

export type Severity = 'info' | 'warn' | 'alarm'

export interface Incident {
  readonly tick: number
  readonly severity: Severity
  readonly text: string
  readonly nodeId: number | null
}

// ---------------------------------------------------------------------------
// The player-visible snapshot (D11). Nothing here may carry ground truth.
// ---------------------------------------------------------------------------

export type NodeState = 'idle' | 'healthy' | 'busy' | 'queue-full' | 'no-route'

export interface NodeTelemetry {
  readonly id: number
  readonly type: NodeType
  readonly label: string
  readonly x: number
  readonly y: number
  readonly queue: number
  readonly queueCapacity: number
  readonly busy: number
  readonly concurrency: number
  readonly utilization: number
  readonly drops: number
  readonly state: NodeState
  /** The hosted provider whose rate limit it shares (D14), or null for everything else. */
  readonly provider: string | null
  /** Vector DB tier (1 to 3), or null for other nodes. */
  readonly tier: number | null
  /** Semantic cache strictness, or null for other nodes. */
  readonly strictness: Strictness | null
  /** Users in's throttle in prompts per second (0 is off), or null for other nodes. */
  readonly maxPerSec: number | null
  /** Attacks a prompt firewall has blocked, or null for other nodes. */
  readonly blocks: number | null
  /** A coordinator's runs: in flight, its cap, and how many have looped past the runaway count; null for other nodes. */
  readonly runs: { readonly inFlight: number; readonly max: number; readonly stuck: number } | null
  /** A coordinator's max steps (0 is off), or null for other nodes. */
  readonly maxSteps: number | null
  /** A model's prefix caching, or null for other nodes. */
  readonly prefixCache: boolean | null
  /** Whether its prefix caching is paid for, so turning it on again is free; null for other nodes. */
  readonly prefixCacheBought: boolean | null
  /** What demolishing it gives back: half of everything paid, upgrades included (D4, D45). */
  readonly refund: number
  /** A model's circuit breaker (D29): on, paid for, and its state, which is loud and so visible; null for other nodes. */
  readonly breaker: { readonly on: boolean; readonly bought: boolean; readonly state: 'closed' | 'open' | 'half-open' } | null
  /** A vLLM cluster (J-1): its tier, KV memory, power, and its cold start; null for other nodes. */
  readonly vllm: VllmTelemetry | null
  /** An LLM judge's sampling rate (J-3), or null for other nodes. */
  readonly sampleRate: number | null
}

export interface VllmTelemetry {
  readonly tier: number
  readonly tierName: string
  readonly kvInUse: number
  readonly kvBudget: number
  readonly kw: number
  /** The substation its power cable runs to, or null. */
  readonly powerFromId: number | null
  /** Seconds of loading left, or 0 once warm. */
  readonly coldSecondsLeft: number
  /** Upkeep a cold start burns before the first token, for the tier it's on (your call, J-1). */
  readonly coldStartCost: number
}

/** The judge's verdicts on one node's answers (J-3): only what it sampled, so a rate on few samples is noise. */
export interface AnswerQualityTelemetry {
  readonly nodeId: number
  readonly label: string
  readonly judged: number
  readonly flagged: number
}

/** A vector DB tier, for the inspector's upgrade control. */
export interface VectorDbTierTelemetry {
  readonly name: string
  /** Cost of this tier over the one before it. */
  readonly upgrade: number
  readonly upkeepPerMin: number
  /** Context quality it retrieves (D45). */
  readonly quality: number
  readonly serviceMs: number
}

/** What a cache strictness level does, from the catalog (D15), for the inspector. */
export interface StrictnessTelemetry {
  /** Hit chance on simple chats once warm. */
  readonly maxHit: number
  /** Share of hits that return a stale, wrong answer. */
  readonly wrongHit: number
}

/** An incident director event the player has been warned about (D48). */
export interface EventTelemetry {
  readonly name: string
  /** What it does, in a sentence: "Traffic ×1.8 for 20 s." */
  readonly text: string
  readonly state: 'announced' | 'active'
  /** Until it starts while announced, until it ends while active. */
  readonly secondsLeft: number
  /** Seconds since it started, while active. */
  readonly elapsedSec: number
  /** A provider outage's provider ("A"), or null for every other event (J-4). */
  readonly provider: string | null
}

/** A vLLM tier, for the inspector's tier ladder and the build card (J-1). */
export interface VllmTierTelemetry {
  readonly name: string
  readonly upgrade: number
  readonly upkeepPerMin: number
  readonly kw: number
  /** KV memory, GB, for the GPU memory meter: tokens × KB per token. */
  readonly kvGb: number
  readonly coldStartSec: number
  /** Upkeep a cold start burns before the first token. */
  readonly coldStartCost: number
}

export interface OutcomeBucket {
  readonly good: number
  readonly throttled: number
  readonly refused: number
  readonly failed: number
  /** Only wrong answers users have reported. Unreported ones count as good (D10). */
  readonly wrongReported: number
}

export interface AgentOptionsTelemetry {
  /** 0 is off. */
  readonly maxStepsChoices: readonly number[]
  readonly prefixCacheBuild: number
  readonly providers: readonly { readonly name: string; readonly priceMultiplier: number; readonly slownessMultiplier: number }[]
}

export interface ProviderTelemetry {
  readonly name: string
  readonly inFlight: number
  readonly limit: number
  /** An outage is loud: every call fails (J-4). */
  readonly down: boolean
}

export interface IncidentTelemetry {
  readonly tick: number
  readonly timeSec: number
  readonly severity: Severity
  readonly text: string
  readonly nodeId: number | null
}

export interface PhaseTelemetry {
  readonly name: string
  readonly startSec: number
}

/** What the build menu shows for a node type: its name, price and upkeep. */
export interface NodePriceTelemetry {
  readonly name: string
  readonly build: number
  readonly upkeepPerMin: number
  /** What demolishing one gives back (D4). */
  readonly refund: number
}

/**
 * One packet as the player can see it, for the X-ray card on a paused board. Whether its answer
 * is wrong is never here: in Milestone 1 nothing samples answers before users do (D10, D11).
 */
export interface PacketView {
  readonly index: number
  readonly serial: number
  readonly category: Category
  readonly difficulty: Difficulty
  /** Input as the capsule's bands show it: the cached prefix (an agent run's earlier passes, D6) and the new input. */
  readonly cachedTokens: number
  readonly newInputTokens: number
  /** The answer's tokens once a model (or the cache) has written it, else 0. */
  readonly outputTokens: number
  /** Personal data: still in the prompt, scrubbed by a redactor, or never there. */
  readonly pii: 'none' | 'contains' | 'redacted'
  /** Agent tasks only: the run so far (I-1). Null for other packets. */
  readonly agent: AgentRunView | null
  /** Who wrote the answer: a model's label, "Semantic cache", or null while unanswered. */
  readonly answeredBy: string | null
  readonly cacheHit: boolean
  readonly refused: boolean
  /** Where it is, in a sentence: "On the tube from Prompt router to Fast SLM". */
  readonly where: string
  /** Seconds left before its deadline; negative once it's late. */
  readonly deadlineLeftSec: number
}

/**
 * An agent run as its coordinator knows it. Reliability is the model's per-step reliability
 * compounded over the passes so far (I-1), an expectation from the catalog, never the run's own roll.
 */
export interface AgentRunView {
  readonly modelPasses: number
  /** Its coordinator's max steps, 0 when off; null once the run has left its coordinator (review, guardrail, users). */
  readonly maxSteps: number | null
  readonly toolsDone: number
  readonly toolsRequired: number
  /** Per-step reliability of the model the run is on, or null before its first pass. */
  readonly stepReliability: number | null
  /** stepReliability ^ modelPasses, or 1 before the first pass. */
  readonly reliability: number
}

export interface TelemetrySnapshot {
  readonly tick: number
  readonly timeSec: number
  /** Every phase of the run, in order, for the timeline. */
  readonly phases: readonly PhaseTelemetry[]
  readonly prices: Readonly<Record<NodeType, NodePriceTelemetry>>
  readonly vectorDbTiers: readonly VectorDbTierTelemetry[]
  readonly cacheStrictness: Readonly<Record<Strictness, StrictnessTelemetry>>
  /** The agent settings' choices (I-2): max steps, prefix caching's price, the providers a Frontier node can use. */
  readonly agentOptions: AgentOptionsTelemetry
  /** Milestone 4's choices (J-1, J-3, J-4): vLLM tiers, the judge's sampling rates, a breaker's price. */
  readonly opsOptions: { readonly vllmTiers: readonly VllmTierTelemetry[]; readonly judgeSampleChoices: readonly number[]; readonly breakerBuild: number }
  /** The director's current event, announced or active, or null. */
  readonly event: EventTelemetry | null
  readonly phase: {
    readonly index: number
    readonly name: string
    readonly startSec: number
    readonly nextName: string | null
    readonly nextStartSec: number | null
  }
  readonly money: {
    readonly budget: number
    readonly gameOverAt: number
    readonly revenuePerSec: number
    readonly tokenSpendPerSec: number
    readonly upkeepPerSec: number
    /** Breach fines (D43). */
    readonly finesPerSec: number
    readonly netPerSec: number
    /** Seconds until −$1,000 at the current net rate, or null while net is not negative. */
    readonly bankruptInSec: number | null
    /** Budget at the start of each of the last (up to) 60 seconds, oldest first. */
    readonly history: readonly number[]
  }
  readonly trust: {
    readonly value: number
    readonly criticalBelow: number
    /** How long trust may stay critical before the run ends (D9). */
    readonly criticalSec: number
    /** Seconds left before a trust game over, or null while trust is not critical (D9). */
    readonly criticalSecondsLeft: number | null
    /** One bucket per second for the last 30 seconds, oldest first. */
    readonly strip: readonly OutcomeBucket[]
  }
  readonly traffic: {
    readonly ratePerSec: number
    readonly simpleShare: number
    readonly complexShare: number
    readonly categoryShare: Readonly<Record<Category, number>>
    readonly next: { readonly atSec: number; readonly text: string } | null
  }
  /**
   * The Retrieval panel, or null with no vector DB on the board. Drift follows from time since the
   * last index, so the player could know it without a tracer (D11, D46).
   */
  readonly retrieval: {
    /** The most drifted vector DB's drift, as a share of the cap (0 to 1). */
    readonly driftShare: number
    /** Seconds to the next ingestion cron run, or null with no cron. */
    readonly reindexInSec: number | null
  } | null
  readonly nodes: readonly NodeTelemetry[]
  /**
   * With a tracer (J-3): end-to-end latency over the last answers, and token spend per model so far.
   * Null without one (D11).
   */
  readonly tracing: {
    readonly latencyP50Sec: number | null
    readonly latencyP95Sec: number | null
    readonly tokenSpend: readonly { readonly nodeId: number; readonly label: string; readonly dollars: number }[]
  } | null
  /** With an LLM judge (J-3): its verdicts per producer. Null without one, so a wrong answer is known only by its complaint. */
  readonly answerQuality: readonly AnswerQualityTelemetry[] | null
  /** Power on the board (J-1): substations' total and what vLLM draws, in kW. */
  readonly power: { readonly supplyKw: number; readonly drawKw: number }
  readonly providers: readonly ProviderTelemetry[]
  /** Newest first. */
  readonly incidents: readonly IncidentTelemetry[]
  readonly gameOver: GameOver | null
}
