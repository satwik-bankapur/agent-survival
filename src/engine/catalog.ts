/*
 * Every gameplay number lives here (CLAUDE.md). The values are decisions
 * section G; a change to any of them goes into docs/decisions.md too.
 *
 * Prices follow D3: pick the traffic level where two options should break
 * even, then derive the price. A node with upkeep U ($/min) that saves s
 * dollars per request wins above U ÷ (60 × s) requests per second.
 */

import type { Difficulty, NodeType, OutcomeKind, Strictness, Tile } from './types'

export interface ChatSpec {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly deadlineSec: number
  readonly revenue: number
}

export interface NodeSpec {
  /** The type's display name, used in labels and reasons. */
  readonly name: string
  readonly build: number
  /** Dollars per minute (D2). */
  readonly upkeepPerMin: number
  /** 0 for Users in and Users out, which have no queue or workers. */
  readonly concurrency: number
  readonly queueCapacity: number
}

export interface ModelSpec extends NodeSpec {
  readonly firstTokenMs: number
  readonly prefillTokensPerSec: number
  readonly msPerOutputToken: number
  readonly inputPricePer1k: number
  readonly outputPricePer1k: number
  /** P(wrong) by difficulty (D13). */
  readonly wrongRate: Readonly<Record<Difficulty, number>>
  readonly malformedJsonRate: number
  /** Unredacted PII it completes is a breach: true for every hosted model (D43). */
  readonly leaksPii: boolean
  /** P(an injection that reaches it breaches) (D43). */
  readonly injectionBreachRate: number
  /** P(an agent's tool call is malformed): +400 error tokens and one more pass (I-1). */
  readonly toolFailRate: number
  /** P(an agent run gets stuck and never finishes on its own), rolled on its first pass (I-1). */
  readonly stuckRate: number
  /** Per-step reliability r: an agent run ends wrong with P = 1 − r^(model passes) (I-1). */
  readonly stepReliability: number
}

/** A hosted provider beyond the first: its own call pool and its own price and speed (D14, I-2). */
export interface ProviderSpec {
  readonly name: string
  readonly limit: number
  /** On both token prices. */
  readonly priceMultiplier: number
  /** On first token and time per output token. */
  readonly slownessMultiplier: number
}

export interface FrontierSpec extends ModelSpec {
  readonly provider: string
  /** Concurrent calls shared by every node on the same provider (D14). */
  readonly providerLimit: number
  /** Providers a Frontier node can be switched to, after the first (I-2). */
  readonly otherProviders: readonly ProviderSpec[]
}

/** Prefix caching, a paid setting on a model (D5). */
export interface PrefixCacheSpec {
  readonly build: number
  /** Writing input to the cache, on the input price. */
  readonly writeMultiplier: number
  /** Reading a cached prefix, on the input price. */
  readonly readMultiplier: number
  /** The agent system prompt stays cached this long after its last use. */
  readonly expirySec: number
  /** Cached tokens prefill this many times faster. */
  readonly prefillSpeedup: number
}

export interface CoordinatorSpec extends NodeSpec {
  /** Max-steps choices, in model passes; 0 is off. The first is the default. */
  readonly maxStepsChoices: readonly number[]
  /** A run leaves its model only when that model's queue is fuller than this share (D28). */
  readonly stickyQueueShare: number
}

export interface McpToolSpec extends NodeSpec {
  readonly serviceMs: number
  /** Tokens its result adds to the run's next input (D6). */
  readonly outputTokens: number
  /** Share of results carrying a hidden injection (D20). */
  readonly taintRate: number
}

export interface HitlSpec extends NodeSpec {
  readonly serviceMs: number
  readonly reviewCost: number
}

/** Agent tasks (D6, D19, I-1). `inputTokens` is the user's; the system prompt comes on top. */
export interface AgentSpec extends CategorySpec {
  readonly systemPromptTokens: number
  /** Revenue is `revenue` plus this per required tool. */
  readonly revenuePerTool: number
  /** Tool plans (Tool bits) and their shares, summing to 1. */
  readonly toolMix: readonly { readonly plan: number; readonly share: number }[]
  /** Tokens a failed tool call adds. */
  readonly failedCallTokens: number
  /** A run past this many passes counts as stuck on its coordinator's plate, with an incident. */
  readonly runawayLoops: number
}

export interface CacheSpec extends NodeSpec {
  readonly serviceMs: number
  readonly maxHitRate: Readonly<Record<Difficulty, number>>
  readonly warmupLookups: number
  readonly wrongHitRate: number
  /** Max hit chance for RAG questions (D47). */
  readonly ragMaxHitRate: number
  /** Multipliers on hit chance and wrong hits by strictness (D15). */
  readonly strictness: Readonly<Record<Strictness, { readonly hit: number; readonly wrong: number }>>
}

export interface RouterSpec extends NodeSpec {
  readonly serviceMs: number
  readonly accuracy: number
}

export interface GuardrailSpec extends NodeSpec {
  readonly serviceMs: number
  readonly catchRate: number
  readonly falseAlarmRate: number
  /** RAG recall = catchRate × (base + (1 − base) × q) (D16). */
  readonly ragRecallBase: number
}

export interface FirewallSpec extends NodeSpec {
  readonly serviceMs: number
  readonly blockRate: number
  readonly falseAlarmRate: number
}

export interface RedactorSpec extends NodeSpec {
  readonly serviceMs: number
  readonly scrubRate: number
}

export interface VectorDbTier {
  readonly name: string
  /** Cost over the tier before it; 0 for tier 1, whose price is the build. */
  readonly upgrade: number
  readonly upkeepPerMin: number
  readonly concurrency: number
  readonly serviceMs: number
  /** Context quality q of what it retrieves (D42). */
  readonly quality: number
}

/** Build, upkeep and concurrency are tier 1's. */
export interface VectorDbSpec extends NodeSpec {
  readonly tiers: readonly VectorDbTier[]
  readonly contextTokens: number
  /** Drift grows this much per minute since the last index, up to the cap (D46). */
  readonly driftPerMin: number
  readonly driftCap: number
}

export interface Bm25Spec extends NodeSpec {
  readonly serviceMs: number
  /** Boost b on a vector DB's quality when it runs with one (D45). */
  readonly hybridBoost: number
  /** On its own: q and context tokens. */
  readonly aloneQuality: number
  readonly aloneContextTokens: number
}

export interface RerankerSpec extends NodeSpec {
  readonly baseMs: number
  readonly msPerContextToken: number
  readonly compressTo: number
  readonly boost: number
}

export interface CronSpec extends NodeSpec {
  readonly intervalSec: number
}

/** A RAG question or an adversarial prompt (D41). */
export interface CategorySpec extends ChatSpec {
  /**
   * Share of arrivals: 0 at the mix start (`fromSec`, or the traffic's `mixFromSec`), linear to
   * `reaches` at `atSec`, then capped.
   */
  readonly share: { readonly fromSec?: number; readonly atSec: number; readonly reaches: number; readonly cap: number }
}

/** A vLLM cluster tier (J-1): the GPUs it rents, the model it serves, and what loading it costs. */
export interface VllmTier {
  readonly name: string
  /** Cost over the tier before it; 0 for tier 1, whose price is the build. */
  readonly upgrade: number
  /** GPU rental and power, dollars per minute. */
  readonly upkeepPerMin: number
  readonly kw: number
  /** KV-cache memory, in tokens: what limits continuous batching (D22). */
  readonly kvTokens: number
  /** KV memory a token takes, KB: for the GPU memory meter (D22). */
  readonly kvKbPerToken: number
  readonly coldStartSec: number
  /** Speed and quality. Its token prices are 0: you rent the GPUs, not the calls. */
  readonly model: ModelSpec
}

/** The vLLM cluster (D22, J-1). Build, upkeep and queue are tier 1's; concurrency is the sequence cap. */
export interface VllmSpec extends NodeSpec {
  readonly tiers: readonly VllmTier[]
  /** Time per output token × (1 + sequences in the batch ÷ this) (J-1). */
  readonly batchSlowdownSeqs: number
}

export interface SubstationSpec extends NodeSpec {
  readonly kw: number
}

/** The tracer (J-3): latency percentiles over this many recent answers. */
export interface TracerSpec extends NodeSpec {
  readonly latencySamples: number
}

/** LLM-as-a-judge (J-3). */
export interface JudgeSpec extends NodeSpec {
  /** Sampling choices; the first is the default (5%). */
  readonly sampleChoices: readonly number[]
  readonly rubricTokens: number
  readonly verdictTokens: number
  readonly inputPricePer1k: number
  readonly outputPricePer1k: number
  /** P(it flags a wrong answer it samples), and P(it flags a good one). */
  readonly recall: number
  readonly falseFlagRate: number
  readonly delaySec: number
}

/** Circuit breakers (D29), a paid model setting (J-4). */
export interface BreakerSpec {
  readonly build: number
  /** It opens when more than `failShare` of its last `window` calls failed. */
  readonly window: number
  readonly failShare: number
  readonly openSec: number
  readonly probes: number
}

export type DirectorEventKind =
  | 'VIRAL_SPIKE'
  | 'HARD_WAVE'
  | 'SLOWDOWN'
  | 'CACHE_WIPE'
  | 'JAILBREAK'
  | 'OUTAGE'
  | 'CACHE_INVALIDATION'
  | 'DRIFT_SURGE'
  | 'TRAFFIC_SURGE'
/** Phase 4's kinds come last, so the weighted pick before 9:00 walks the list it always did. */
export const DIRECTOR_EVENT_KINDS: readonly DirectorEventKind[] = [
  'VIRAL_SPIKE',
  'HARD_WAVE',
  'SLOWDOWN',
  'CACHE_WIPE',
  'JAILBREAK',
  'OUTAGE',
  'CACHE_INVALIDATION',
  'DRIFT_SURGE',
  'TRAFFIC_SURGE',
]

export interface DirectorEventSpec {
  readonly name: string
  /** Weight in phase 1, in phases 2 and 3, and from phase 4 (9:00) on. */
  readonly weights: readonly [number, number, number]
  /** Duration range in seconds; 0 for instant events. */
  readonly durationSec: readonly [number, number]
  /** Never picked to start before this. */
  readonly notBeforeSec: number
}

/** The incident director (D48). */
export interface DirectorSpec {
  readonly enabled: boolean
  readonly firstAnnounceSec: readonly [number, number]
  readonly gapSec: readonly [number, number]
  /** Gap multiplier by phase index; the last one applies to every later phase. */
  readonly phaseFactor: readonly number[]
  readonly leadSec: number
  readonly events: Readonly<Record<DirectorEventKind, DirectorEventSpec>>
  /** Viral spike: m = 1 + uniform(range) × k[phase]. */
  readonly spike: { readonly range: readonly [number, number]; readonly k: readonly number[] }
  readonly hardWaveComplexShare: number
  readonly slowdownMultiplier: number
  readonly jailbreakShare: number
  /**
   * The endless phase (J-5): from `fromSec` the gap factor shrinks by `gapDecayPerMin` a minute,
   * down to `minGapFactor`, and the spike's k grows by `kAdd` every `kEverySec`.
   */
  readonly late: {
    readonly fromSec: number
    readonly gapDecayPerMin: number
    readonly minGapFactor: number
    readonly kEverySec: number
    readonly kAdd: number
  }
  /** Provider outage (J-4): which provider, from the size draw, and how it lengthens. */
  readonly outage: {
    /** Size draws below this take down the first provider, the rest the second. */
    readonly firstProviderShare: number
    readonly growEverySec: number
    readonly growSec: number
    readonly maxSec: number
    /** A call on a provider that's down fails this long after it starts. */
    readonly failAfterMs: number
  }
  readonly surge: { readonly range: readonly [number, number] }
  /** Drift surge: added to every vector DB's drift until it's next indexed, the total at most `cap`. */
  readonly driftSurge: { readonly add: number; readonly cap: number }
  /** Balance only: no event is announced from this second on. Infinity in play. */
  readonly quietFromSec: number
  /** Balance only, the outage drill (J-6): a forced outage on one provider. */
  readonly drill: { readonly provider: number; readonly startSec: number; readonly endSec: number } | null
}

export interface Catalog {
  /** Sandbox: no game over of either kind, so neither countdown shows. */
  readonly sandbox: boolean
  readonly tickMs: number
  readonly board: { readonly cols: number; readonly rows: number }
  readonly budget: {
    readonly start: number
    /** The run ends when the budget reaches this (D4). */
    readonly gameOverAt: number
    readonly refundShare: number
  }
  readonly packetPoolSize: number
  /** transitTicks = clamp(1 + ceil(routeLengthTiles ÷ 2), min, max) (D30). */
  readonly transit: { readonly minTicks: number; readonly maxTicks: number }
  readonly traffic: {
    readonly chat: Readonly<Record<Difficulty, ChatSpec>>
    /** Arrival rate keyframes; linear in between. */
    readonly ratePoints: readonly { readonly sec: number; readonly perSec: number }[]
    /** Growth after the last keyframe, prompts/s per minute. */
    readonly growthPerMinAfter: number
    /** The endless phase (J-5): from `fromSec` growth is `perMin` instead. */
    readonly lateGrowth: { readonly fromSec: number; readonly perMin: number }
    /** The fixed spike of classic mode (D40); none in Survival, where the director makes events. */
    readonly spike: { readonly startSec: number; readonly endSec: number; readonly multiplier: number } | null
    readonly complexShare: {
      readonly start: number
      readonly atSec: number
      readonly reaches: number
      readonly cap: number
    }
    /** RAG and adversarial traffic, and PII, start here (D41). Infinity in classic mode. */
    readonly mixFromSec: number
    readonly rag: CategorySpec
    readonly adversarial: CategorySpec
    readonly agent: AgentSpec
    /** Share of chat, RAG and agent prompts carrying PII. */
    readonly piiShare: number
  }
  readonly trust: {
    /** S = N = prior at the start (D8). */
    readonly prior: number
    readonly windowSec: number
    readonly score: Readonly<Record<OutcomeKind, number>>
    readonly criticalBelow: number
    readonly criticalSec: number
    readonly complaintDelaySec: { readonly min: number; readonly max: number }
  }
  readonly nodes: {
    readonly USERS_IN: NodeSpec
    readonly USERS_OUT: NodeSpec
    readonly FRONTIER_API: FrontierSpec
    readonly FAST_SLM: ModelSpec
    readonly SEMANTIC_CACHE: CacheSpec
    readonly PROMPT_ROUTER: RouterSpec
    readonly OUTPUT_GUARDRAIL: GuardrailSpec
    readonly PROMPT_FIREWALL: FirewallSpec
    readonly PII_REDACTOR: RedactorSpec
    readonly VECTOR_DB: VectorDbSpec
    readonly BM25_SEARCH: Bm25Spec
    readonly RERANKER: RerankerSpec
    readonly INGESTION_CRON: CronSpec
    readonly LANGGRAPH_COORDINATOR: CoordinatorSpec
    readonly MCP_WEB_SEARCH: McpToolSpec
    readonly MCP_CODE_SANDBOX: McpToolSpec
    readonly HITL_GATE: HitlSpec
    readonly VLLM_CLUSTER: VllmSpec
    readonly POWER_SUBSTATION: SubstationSpec
    readonly TRACER: TracerSpec
    readonly LLM_JUDGE: JudgeSpec
  }
  readonly prefixCache: PrefixCacheSpec
  readonly breaker: BreakerSpec
  /** RAG P(wrong) = H[model][COMPLEX] + (1 − q) × contextWeight + drift, at most maxWrong (D42). */
  readonly rag: { readonly contextWeight: number; readonly maxWrong: number }
  /** What a breach costs on top of its trust score, by kind (D43). */
  readonly breachFine: { readonly PII: number; readonly INJECTION: number }
  readonly director: DirectorSpec
  /** One incident of a kind per node per this many seconds. */
  readonly incidentCooldownSec: number
  readonly phases: readonly { readonly name: string; readonly startSec: number }[]
  readonly startingBoard: { readonly usersIn: Tile; readonly frontier: Tile; readonly usersOut: Tile }
}

export const DEFAULT_CATALOG: Catalog = {
  sandbox: false,
  tickMs: 50,
  board: { cols: 26, rows: 18 },
  budget: { start: 500, gameOverAt: -1000, refundShare: 0.5 },
  packetPoolSize: 2000,
  transit: { minTicks: 2, maxTicks: 8 },

  traffic: {
    chat: {
      // Fast SLM serves it for $0.036, so it earns $0.26. Frontier costs $1.50 and loses $1.20:
      // the lesson of the first two minutes.
      SIMPLE: { inputTokens: 500, outputTokens: 200, deadlineSec: 6, revenue: 0.3 },
      // Frontier costs $4.20, so it earns $0.80. Fast SLM earns $4.90 but is wrong 40% of the time.
      COMPLEX: { inputTokens: 1200, outputTokens: 600, deadlineSec: 12, revenue: 5.0 },
    },
    ratePoints: [
      { sec: 0, perSec: 3 },
      { sec: 120, perSec: 8 },
      { sec: 300, perSec: 16 },
    ],
    growthPerMinAfter: 2,
    // The endless phase: from 9:00 traffic grows faster, 24/s then, 39/s at 14:00, 57/s at 20:00 (J-5).
    lateGrowth: { fromSec: 540, perMin: 3 },
    // Survival has no fixed spike: the incident director makes them (D48). Classic mode keeps it.
    spike: null,
    complexShare: { start: 0.2, atSec: 300, reaches: 0.35, cap: 0.5 },
    mixFromSec: 120,
    // On Frontier with no retrieval: $2.80 and 63% wrong. With a vector DB (4,800 in) $6.80, a
    // $0.80 loss; reranked (2,000 in) $4.00, earning $2.00. The reranker is what makes RAG pay.
    rag: { inputTokens: 800, outputTokens: 400, deadlineSec: 12, revenue: 6, share: { atSec: 300, reaches: 0.3, cap: 0.4 } },
    // Earns nothing. Costs $2.10 on Frontier, and breaches 20% of the time there, 60% on Fast SLM.
    adversarial: { inputTokens: 600, outputTokens: 300, deadlineSec: 6, revenue: 0, share: { atSec: 300, reaches: 0.04, cap: 0.08 } },
    // Each pass outputs 300 tokens, which join the next pass's input with the tool's result (D6).
    // A [SEARCH, CODE] task on Frontier costs $4.00 + $5.50 + $6.40 = $15.90 uncached, $9.41 with
    // prefix caching, against $19. Off a coordinator its tools are invented: one $4 pass, wrong.
    // The 40 s deadline is about 2.6× a two-tool run's 15 s.
    agent: {
      systemPromptTokens: 2000,
      inputTokens: 500,
      outputTokens: 300,
      deadlineSec: 40,
      revenue: 5,
      revenuePerTool: 7,
      share: { fromSec: 300, atSec: 540, reaches: 0.1, cap: 0.15 },
      toolMix: [
        { plan: 1, share: 0.45 },
        { plan: 2, share: 0.25 },
        { plan: 3, share: 0.3 },
      ],
      failedCallTokens: 400,
      runawayLoops: 10,
    },
    piiShare: 0.02,
  },

  trust: {
    prior: 90,
    windowSec: 30,
    score: { GOOD: 1, THROTTLED: 0.8, REFUSED: 0.5, FAILED: -3, WRONG: -14, BREACH: -14 },
    criticalBelow: 25,
    criticalSec: 15,
    complaintDelaySec: { min: 5, max: 15 },
  },

  nodes: {
    USERS_IN: { name: 'Users in', build: 0, upkeepPerMin: 0, concurrency: 0, queueCapacity: 0 },
    USERS_OUT: { name: 'Users out', build: 0, upkeepPerMin: 0, concurrency: 0, queueCapacity: 0 },

    // No upkeep, so nothing to amortize: it pays purely per token. $1.00 / $5.00 per 1K makes a
    // simple chat cost $1.50 against $0.30 revenue, and a complex chat $4.20 against $5.00.
    FRONTIER_API: {
      name: 'Frontier API',
      build: 20,
      upkeepPerMin: 0,
      concurrency: 64,
      // About 1.8 s of waiting at the provider limit: overflow is dropped before a simple chat's
      // wait plus its 2.4 s call can pass the 6 s deadline.
      queueCapacity: 32,
      firstTokenMs: 350,
      prefillTokensPerSec: 10_000,
      msPerOutputToken: 10,
      inputPricePer1k: 1.0,
      outputPricePer1k: 5.0,
      wrongRate: { SIMPLE: 0.01, COMPLEX: 0.03 },
      malformedJsonRate: 0.01,
      leaksPii: true,
      injectionBreachRate: 0.2,
      // Spec v1's tool-calling skill 0.92. A stuck run never finishes on its own (I-1).
      toolFailRate: 0.08,
      stuckRate: 0.1,
      // Errors compound over a run: about 2.7 passes at 0.99 is 2.6% wrong, near the old flat 3%.
      stepReliability: 0.99,
      provider: 'A',
      providerLimit: 64,
      // Phase 3 outgrows A's 64 calls even without agents (about 75 at 9:00). B is the second pool:
      // 20% cheaper per token, 30% slower to decode, so a complex chat costs $3.36 but takes 8.4 s.
      otherProviders: [{ name: 'B', limit: 64, priceMultiplier: 0.8, slownessMultiplier: 1.3 }],
    },

    // $30/min against Frontier: a simple chat costs $0.036 here instead of $1.50, saving $1.464,
    // so it breaks even at 30 ÷ (60 × 1.464) ≈ 0.34 simple chats/s, well under the opening 2.4/s.
    // $0.04 / $0.08 per 1K keeps its margin on simple chat at $0.26. Its price is accuracy, not money.
    FAST_SLM: {
      name: 'Fast SLM',
      build: 60,
      upkeepPerMin: 30,
      concurrency: 8,
      // About 4.8 s of work at 13.3 simple chats/s. A full queue's prompts finish past the 6 s
      // deadline, so a spike it can't absorb collapses into timeouts. That's the cache's job.
      queueCapacity: 64,
      firstTokenMs: 80,
      prefillTokensPerSec: 20_000,
      msPerOutputToken: 2.5,
      inputPricePer1k: 0.04,
      outputPricePer1k: 0.08,
      wrongRate: { SIMPLE: 0.02, COMPLEX: 0.4 },
      malformedJsonRate: 0.05,
      // A provider's hosted small-model endpoint, not your own hardware: PII sent here leaks (D43).
      leaksPii: true,
      // Small models jailbreak more easily.
      injectionBreachRate: 0.6,
      // Spec v1's 0.55 tool-calling skill: cheap agent runs, but wrong or giving up about half the time.
      toolFailRate: 0.45,
      stuckRate: 0.15,
      stepReliability: 0.8,
    },

    // $9/min. A warm hit (40% of simple chat) skips a model call. In front of Fast SLM that saves
    // 0.40 × $0.036 per prompt, breaking even at 9 ÷ (60 × 0.0144) ≈ 10 prompts/s, around 2:50.
    // In front of Frontier it saves 0.40 × $1.50, breaking even at 0.25 prompts/s. Its real job is
    // absorbing the 3:30 spike, which overflows a single Fast SLM.
    SEMANTIC_CACHE: {
      name: 'Semantic cache',
      build: 70,
      upkeepPerMin: 9,
      concurrency: 64,
      queueCapacity: 64,
      serviceMs: 30,
      maxHitRate: { SIMPLE: 0.4, COMPLEX: 0.08 },
      warmupLookups: 150,
      wrongHitRate: 0.015,
      ragMaxHitRate: 0.15,
      strictness: {
        LOOSE: { hit: 1.3, wrong: 3 },
        BALANCED: { hit: 1, wrong: 1 },
        STRICT: { hit: 0.6, wrong: 0.2 },
      },
    },

    // $6/min. Sending a simple chat to Fast SLM instead of Frontier saves $1.464 at 94% accuracy,
    // so it breaks even at 6 ÷ (60 × 1.464 × 0.94) ≈ 0.07 simple chats/s. It is cheap on purpose:
    // it's the first upgrade the opening teaches.
    PROMPT_ROUTER: {
      name: 'Prompt router',
      build: 65,
      upkeepPerMin: 6,
      concurrency: 64,
      queueCapacity: 64,
      serviceMs: 40,
      accuracy: 0.94,
    },

    // $12/min buys trust, not money: each caught wrong answer turns a −14 into a +0.5 refusal.
    // Behind a router build (≈2.7% wrong answers; at 8 prompts/s that's ≈11 caught per minute)
    // that is worth far more than its $12, while the 1% false alarms cost ≈$6/min of revenue.
    OUTPUT_GUARDRAIL: {
      name: 'Output guardrail',
      build: 55,
      upkeepPerMin: 12,
      concurrency: 24,
      queueCapacity: 48,
      serviceMs: 150,
      catchRate: 0.85,
      falseAlarmRate: 0.01,
      ragRecallBase: 0.4,
    },

    // $5/min. At about 0.6 attacks/s by 5:00, blocking 95% saves about 0.6 × 0.95 × 60% × $50 ≈
    // $17/s in fines on attacks routed to Fast SLM, plus $2.10 in tokens per attack bound for Frontier.
    PROMPT_FIREWALL: {
      name: 'Prompt firewall',
      build: 50,
      upkeepPerMin: 5,
      concurrency: 64,
      queueCapacity: 64,
      serviceMs: 25,
      blockRate: 0.95,
      falseAlarmRate: 0.005,
    },

    // $5/min. Every hosted model leaks PII (D43). At about 15 model calls/s by 5:00, 2% PII costs
    // ≈ 2% × $100 × 15 ≈ $30/s in fines, so it pays above 5 ÷ (60 × 100 × 0.98) ≈ 0.001 PII prompts/s.
    PII_REDACTOR: {
      name: 'PII redactor',
      build: 45,
      upkeepPerMin: 5,
      concurrency: 32,
      queueCapacity: 64,
      serviceMs: 60,
      scrubRate: 0.98,
    },

    // Flat serves 3 ÷ 0.6 s = 5 RAG/s, about phase 2's 4.8 RAG/s at 5:00, so any spike overflows it:
    // the reason to upgrade. (Session 6: 4 → 3; at 6.7/s a Flat build never died.)
    VECTOR_DB: {
      name: 'Vector DB',
      build: 140,
      upkeepPerMin: 14,
      concurrency: 3,
      queueCapacity: 32,
      tiers: [
        { name: 'Flat', upgrade: 0, upkeepPerMin: 14, concurrency: 3, serviceMs: 600, quality: 0.72 },
        { name: 'IVF', upgrade: 60, upkeepPerMin: 18, concurrency: 8, serviceMs: 150, quality: 0.68 },
        { name: 'HNSW', upgrade: 90, upkeepPerMin: 24, concurrency: 16, serviceMs: 40, quality: 0.71 },
      ],
      contextTokens: 4000,
      driftPerMin: 0.02,
      driftCap: 0.15,
    },

    BM25_SEARCH: {
      name: 'BM25 hybrid search',
      build: 90,
      upkeepPerMin: 8,
      concurrency: 32,
      queueCapacity: 64,
      serviceMs: 30,
      hybridBoost: 0.45,
      aloneQuality: 0.55,
      aloneContextTokens: 2000,
    },

    // $12/min. Compressing 4,000 context tokens to 1,200 saves $2.80 per RAG question on Frontier,
    // so it pays at 12 ÷ (60 × 2.8) ≈ 0.07 RAG/s. Its real cost is throughput: 4 at 320 ms ≈ 12.5/s (D17).
    RERANKER: {
      name: 'Cross-encoder reranker',
      build: 110,
      upkeepPerMin: 12,
      concurrency: 4,
      queueCapacity: 32,
      baseMs: 120,
      msPerContextToken: 1 / 20,
      compressTo: 1200,
      boost: 0.7,
    },

    // $5/min keeps every vector DB's drift at 0 (D46). Drift is small by 5:00; it matters later.
    INGESTION_CRON: { name: 'Ingestion cron', build: 65, upkeepPerMin: 5, concurrency: 0, queueCapacity: 0, intervalSec: 60 },

    // Concurrency is runs in flight (D26: 12 → 16, so two cover about 2.4 tasks/s at 9:00 by
    // Little's law, 2.4 × 13 s ≈ 31). Its queue is the admission queue; overflow is throttled.
    // Max steps is off until the player sets it: a coordinator left as placed lets runs loop away.
    LANGGRAPH_COORDINATOR: {
      name: 'LangGraph coordinator',
      build: 120,
      upkeepPerMin: 10,
      concurrency: 16,
      queueCapacity: 24,
      maxStepsChoices: [0, 3, 5, 10],
      stickyQueueShare: 0.8,
    },
    // $6/min against $12 to $19 a task: without it a search task's answer is invented and wrong.
    MCP_WEB_SEARCH: { name: 'MCP web search', build: 60, upkeepPerMin: 6, concurrency: 16, queueCapacity: 32, serviceMs: 800, outputTokens: 1200, taintRate: 0.1 },
    // 8 at 1.5 s ≈ 5.3 code calls/s, against about 1.3/s at 9:00. It also contains tool-borne injections (D20).
    MCP_CODE_SANDBOX: { name: 'MCP code sandbox', build: 95, upkeepPerMin: 10, concurrency: 8, queueCapacity: 16, serviceMs: 1500, outputTokens: 600, taintRate: 0 },
    // One review every 8 s (0.125/s) at $0.50 (D21): about the 4% of runs a max of 5 breaks at 9:00.
    // Each review turns a −3 give-up into a +0.5 refusal.
    HITL_GATE: { name: 'Human review gate', build: 70, upkeepPerMin: 6, concurrency: 1, queueCapacity: 16, serviceMs: 8000, reviewCost: 0.5 },

    // Self-hosted, so no price per token and no PII breach (D18). Its cost is the GPUs, by the minute,
    // busy or not. The 70B at $2,800/min breaks even with Frontier A's $4.07 a complex or RAG request
    // at about 11.5/s, and with B's $3.25 at about 14/s (J-2). KV memory and the 256-sequence cap
    // limit how many run at once, and each sequence in the batch slows decoding (J-1).
    VLLM_CLUSTER: {
      name: 'vLLM cluster',
      build: 400,
      upkeepPerMin: 90,
      concurrency: 256,
      queueCapacity: 64,
      batchSlowdownSeqs: 64,
      tiers: [
        {
          name: 'Llama 8B',
          upgrade: 0,
          upkeepPerMin: 90,
          kw: 0.5,
          // 30 GB of a 48 GB GPU at 128 KB a token.
          kvTokens: 240_000,
          kvKbPerToken: 128,
          coldStartSec: 15,
          model: {
            name: 'Llama 8B',
            build: 400,
            upkeepPerMin: 90,
            concurrency: 256,
            queueCapacity: 64,
            firstTokenMs: 80,
            prefillTokensPerSec: 20_000,
            msPerOutputToken: 1.5,
            inputPricePer1k: 0,
            outputPricePer1k: 0,
            wrongRate: { SIMPLE: 0.02, COMPLEX: 0.4 },
            malformedJsonRate: 0.05,
            leaksPii: false,
            injectionBreachRate: 0.6,
            toolFailRate: 0.45,
            stuckRate: 0.15,
            stepReliability: 0.8,
          },
        },
        {
          name: 'Llama 70B',
          upgrade: 1200,
          upkeepPerMin: 2800,
          kw: 2,
          // FP8 on 2 × 80 GB: 70 GB of weights, 80 GB of KV at 320 KB a token.
          kvTokens: 250_000,
          kvKbPerToken: 320,
          coldStartSec: 30,
          model: {
            name: 'Llama 70B',
            build: 1200,
            upkeepPerMin: 2800,
            concurrency: 256,
            queueCapacity: 64,
            firstTokenMs: 250,
            prefillTokensPerSec: 8000,
            // Under batching: 3.5 ms × (1 + batch ÷ 64). Full, about 116 run at once and a replica
            // serves about 23 complex chats and RAG questions a second, as J-2 has it.
            msPerOutputToken: 3.5,
            inputPricePer1k: 0,
            outputPricePer1k: 0,
            wrongRate: { SIMPLE: 0.015, COMPLEX: 0.05 },
            malformedJsonRate: 0.02,
            leaksPii: false,
            injectionBreachRate: 0.3,
            toolFailRate: 0.12,
            stuckRate: 0.1,
            stepReliability: 0.97,
          },
        },
      ],
    },
    // 3 kW: one 70B and two 8Bs, or six 8Bs. No vLLM node goes down without one (J-1).
    POWER_SUBSTATION: { name: 'Power substation', build: 250, upkeepPerMin: 20, concurrency: 0, queueCapacity: 0, kw: 3 },
    TRACER: { name: 'Tracer', build: 120, upkeepPerMin: 15, concurrency: 0, queueCapacity: 0, latencySamples: 256 },
    // It reads rubric, prompt, context and answer at Frontier B's prices on its own endpoint: about
    // $4.30/s at 10% sampling at 9:00. It defaults to 5% (J-3).
    LLM_JUDGE: {
      name: 'LLM judge',
      build: 100,
      upkeepPerMin: 10,
      concurrency: 0,
      queueCapacity: 0,
      sampleChoices: [0.05, 0.01, 0.1],
      rubricTokens: 300,
      verdictTokens: 50,
      inputPricePer1k: 0.8,
      outputPricePer1k: 4,
      recall: 0.9,
      falseFlagRate: 0.03,
      delaySec: 2,
    },
  },

  // Session 8: write 1.25 → 1.4. At Anthropic's 1.25 a model serving the whole 9:00 mix still won
  // $6/s from caching; at 1.4 the mix roughly breaks even (+$1/s) while a model kept for agents
  // makes about $12/s. Saves ≈ $5 an agent task on Frontier, so $80 pays back in about 16 tasks.
  prefixCache: { build: 80, writeMultiplier: 1.4, readMultiplier: 0.1, expirySec: 300, prefillSpeedup: 10 },
  // Paid and off by default: failover is a choice the postmortem can point at (J-4).
  breaker: { build: 40, window: 10, failShare: 0.5, openSec: 5, probes: 3 },

  rag: { contextWeight: 0.6, maxWrong: 0.95 },
  // Leaking a user's personal data costs more than being jailbroken (Session 6: PII $50 → $100,
  // so a build without a redactor dies; attacks stay at $50).
  breachFine: { PII: 100, INJECTION: 50 },

  director: {
    enabled: true,
    firstAnnounceSec: [30, 45],
    gapSec: [30, 60],
    phaseFactor: [1.3, 1.0, 0.8, 0.6],
    leadSec: 10,
    events: {
      VIRAL_SPIKE: { name: 'Viral spike', weights: [0.4, 0.25, 0.1], durationSec: [15, 25], notBeforeSec: 0 },
      HARD_WAVE: { name: 'Hard-question wave', weights: [0.3, 0.2, 0.1], durationSec: [30, 30], notBeforeSec: 0 },
      // ×1.5, not ×2: a complex chat's 6.5 s would become 12.9 s and miss every 12 s deadline.
      SLOWDOWN: { name: 'Provider slowdown', weights: [0.3, 0.2, 0.1], durationSec: [40, 40], notBeforeSec: 0 },
      // From 9:00 cache invalidation takes its place, and wipes prefix caches too.
      CACHE_WIPE: { name: 'Cache wipe', weights: [0, 0.15, 0], durationSec: [0, 0], notBeforeSec: 0 },
      JAILBREAK: { name: 'Jailbreak wave', weights: [0, 0.2, 0.1], durationSec: [25, 25], notBeforeSec: 135 },
      // Phase 4's chaos (J-4): about one outage every 4 to 5 minutes from 9:00, getting longer.
      OUTAGE: { name: 'Provider outage', weights: [0, 0, 0.2], durationSec: [45, 75], notBeforeSec: 0 },
      CACHE_INVALIDATION: { name: 'Cache invalidation', weights: [0, 0, 0.15], durationSec: [0, 0], notBeforeSec: 0 },
      DRIFT_SURGE: { name: 'Drift surge', weights: [0, 0, 0.1], durationSec: [0, 0], notBeforeSec: 0 },
      TRAFFIC_SURGE: { name: 'Traffic surge', weights: [0, 0, 0.15], durationSec: [60, 90], notBeforeSec: 0 },
    },
    spike: { range: [0.5, 1.0], k: [0.7, 1.0, 1.3] },
    hardWaveComplexShare: 0.6,
    slowdownMultiplier: 1.5,
    jailbreakShare: 0.2,
    late: { fromSec: 540, gapDecayPerMin: 0.05, minGapFactor: 0.4, kEverySec: 180, kAdd: 0.1 },
    outage: { firstProviderShare: 0.6, growEverySec: 180, growSec: 10, maxSec: 120, failAfterMs: 2000 },
    surge: { range: [1.4, 1.8] },
    driftSurge: { add: 0.1, cap: 0.25 },
    quietFromSec: Infinity,
    drill: null,
  },

  incidentCooldownSec: 10,

  phases: [
    { name: 'Wrapper startup', startSec: 0 },
    { name: 'Knowledge crisis', startSec: 120 },
    { name: 'Rise of the agents', startSec: 300 },
    { name: 'Enterprise scale', startSec: 540 },
  ],

  startingBoard: {
    usersIn: { x: 2, y: 9 },
    frontier: { x: 12, y: 9 },
    usersOut: { x: 23, y: 9 },
  },
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mergeRecords(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const key of Object.keys(patch)) {
    const next = patch[key]
    const current = out[key]
    if (isPlainObject(next) && isPlainObject(current)) out[key] = mergeRecords(current, next)
    else if (next !== undefined) out[key] = next
  }
  return out
}

/** The default catalog with a deep patch applied, for tests and experiments. Arrays are replaced. */
export function makeCatalog(patch?: DeepPartial<Catalog>): Catalog {
  if (patch === undefined) return DEFAULT_CATALOG
  return mergeRecords(DEFAULT_CATALOG as unknown as Record<string, unknown>, patch as Record<string, unknown>) as unknown as Catalog
}

/**
 * Classic mode (D40): Milestone 1 as it was, chat only, with the fixed 3:30 spike and no
 * director. The section G balance suite runs on it. Its traffic draws exactly what Milestone 1
 * drew, so its results match seed for seed.
 */
export function classicCatalog(): Catalog {
  return makeCatalog({
    // 23 s, not 20: long enough that a lone Fast SLM's backlog outlives the deadline (decisions G).
    traffic: {
      spike: { startSec: 210, endSec: 233, multiplier: 1.8 },
      mixFromSec: Infinity,
      agent: { share: { fromSec: Infinity, atSec: 540, reaches: 0.1, cap: 0.15 } },
      lateGrowth: { fromSec: Infinity },
    },
    director: { enabled: false },
  })
}

/** The sandbox's choices on the title screen: a starting budget, and traffic as a multiple of Survival's. */
export const SANDBOX = {
  budgets: [500, 2000, 10000],
  trafficMultipliers: [0.5, 1, 2, 3],
} as const

/** Survival's catalog with a different start budget and scaled traffic, and no game over. */
export function sandboxCatalog(budget: number, trafficMultiplier: number): Catalog {
  const traffic = DEFAULT_CATALOG.traffic
  return makeCatalog({
    sandbox: true,
    budget: { start: budget },
    traffic: {
      ratePoints: traffic.ratePoints.map((p) => ({ sec: p.sec, perSec: p.perSec * trafficMultiplier })),
      growthPerMinAfter: traffic.growthPerMinAfter * trafficMultiplier,
      lateGrowth: { perMin: traffic.lateGrowth.perMin * trafficMultiplier },
    },
  })
}

/** An agent task's revenue: base plus one price per required tool (I-1). */
export function agentRevenue(catalog: Catalog, tools: number): number {
  const a = catalog.traffic.agent
  return a.revenue + a.revenuePerTool * tools
}

export type ModelNodeType = 'FRONTIER_API' | 'FAST_SLM' | 'VLLM_CLUSTER'

export function isModelType(type: NodeType): type is ModelNodeType {
  return type === 'FRONTIER_API' || type === 'FAST_SLM' || type === 'VLLM_CLUSTER'
}

export function nodeSpec(catalog: Catalog, type: NodeType): NodeSpec {
  return catalog.nodes[type]
}

/** The most workers a node of this type ever needs: for a vector DB, its top tier's. */
export function maxConcurrency(catalog: Catalog, type: NodeType): number {
  if (type !== 'VECTOR_DB') return catalog.nodes[type].concurrency
  return Math.max(...catalog.nodes.VECTOR_DB.tiers.map((t) => t.concurrency))
}

export function ticksPerSecond(catalog: Catalog): number {
  return 1000 / catalog.tickMs
}

/**
 * A service time in whole ticks, rounded to the nearest tick (at least 1). Rounding up would
 * quietly cut throughput: Fast SLM's 605 ms simple chat would take 650 ms, not 600.
 */
export function msToTicks(catalog: Catalog, ms: number): number {
  return Math.max(1, Math.round(ms / catalog.tickMs))
}
