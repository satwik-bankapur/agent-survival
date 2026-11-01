/*
 * The build menu's cards, tab by tab, in the design's order. Milestone 1
 * types are live: their name and prices come from the snapshot, so they
 * always match catalog.ts. Later types are shown locked, with the design's
 * provisional name and prices for display only; each milestone moves its
 * types into catalog.ts and onto the live list.
 */

import type { NodeType } from '../engine'
import type { Tab } from '../store/uiStore'
import type { ThumbKind } from './ui/nodeThumbs'

export interface CardDef {
  readonly kind: ThumbKind
  /** Set when the node exists in the engine: the card is live. */
  readonly nodeType?: NodeType
  /** Display only, for locked cards: the design's name, build cost and upkeep per minute. */
  readonly name: string
  readonly cost: number
  readonly upkeepPerMin: number
  /** Upgrades go on another node instead of a tile of their own. */
  readonly upgrade?: boolean
  /** It draws power: placing it needs spare kW from a substation (J-1). The amount comes from the snapshot. */
  readonly power?: true
}

export const TABS: readonly { readonly tab: Tab; readonly name: string; readonly flex: number }[] = [
  { tab: 1, name: 'Ingress and guard', flex: 1.15 },
  { tab: 2, name: 'Models and GPU', flex: 1.05 },
  { tab: 3, name: 'RAG and memory', flex: 1.05 },
  { tab: 4, name: 'Agents and MCP', flex: 1 },
  { tab: 5, name: 'LLMOps and eval', flex: 1.05 },
]

export const CARDS: Readonly<Record<Tab, readonly CardDef[]>> = {
  1: [
    { kind: 'firewall', nodeType: 'PROMPT_FIREWALL', name: 'Prompt firewall', cost: 50, upkeepPerMin: 5 },
    { kind: 'pii', nodeType: 'PII_REDACTOR', name: 'PII redactor', cost: 45, upkeepPerMin: 5 },
    { kind: 'cache', nodeType: 'SEMANTIC_CACHE', name: 'Semantic cache', cost: 70, upkeepPerMin: 9 },
    { kind: 'router', nodeType: 'PROMPT_ROUTER', name: 'Prompt router', cost: 65, upkeepPerMin: 6 },
  ],
  2: [
    { kind: 'slm', nodeType: 'FAST_SLM', name: 'Fast SLM', cost: 60, upkeepPerMin: 30 },
    { kind: 'frontier', nodeType: 'FRONTIER_API', name: 'Frontier API', cost: 20, upkeepPerMin: 0 },
    { kind: 'vllm', nodeType: 'VLLM_CLUSTER', name: 'vLLM cluster', cost: 400, upkeepPerMin: 90, power: true },
    { kind: 'guard', nodeType: 'OUTPUT_GUARDRAIL', name: 'Output guardrail', cost: 55, upkeepPerMin: 12 },
    { kind: 'prefix', name: 'Prefix caching', cost: 80, upkeepPerMin: 0, upgrade: true },
  ],
  3: [
    { kind: 'vdb', nodeType: 'VECTOR_DB', name: 'Vector DB', cost: 140, upkeepPerMin: 14 },
    { kind: 'bm25', nodeType: 'BM25_SEARCH', name: 'BM25 hybrid search', cost: 90, upkeepPerMin: 8 },
    { kind: 'rerank', nodeType: 'RERANKER', name: 'Cross-encoder reranker', cost: 110, upkeepPerMin: 12 },
    { kind: 'memory', name: 'Episodic memory', cost: 100, upkeepPerMin: 10 },
  ],
  4: [
    { kind: 'coord', nodeType: 'LANGGRAPH_COORDINATOR', name: 'LangGraph coordinator', cost: 120, upkeepPerMin: 10 },
    { kind: 'web', nodeType: 'MCP_WEB_SEARCH', name: 'MCP web search', cost: 60, upkeepPerMin: 6 },
    { kind: 'sandbox', nodeType: 'MCP_CODE_SANDBOX', name: 'MCP code sandbox', cost: 95, upkeepPerMin: 10 },
    { kind: 'hitl', nodeType: 'HITL_GATE', name: 'Human-in-the-loop gate', cost: 70, upkeepPerMin: 8 },
  ],
  5: [
    { kind: 'tracer', nodeType: 'TRACER', name: 'Tracer', cost: 120, upkeepPerMin: 15 },
    { kind: 'judge', nodeType: 'LLM_JUDGE', name: 'LLM judge', cost: 100, upkeepPerMin: 10 },
    { kind: 'cron', nodeType: 'INGESTION_CRON', name: 'Ingestion cron', cost: 65, upkeepPerMin: 5 },
    { kind: 'sub', nodeType: 'POWER_SUBSTATION', name: 'Power substation', cost: 250, upkeepPerMin: 20 },
  ],
}

/** Cards marked "New" this milestone: Milestone 4's GPUs, power and LLMOps nodes. */
export const NEW_CARDS: ReadonlySet<ThumbKind> = new Set(['vllm', 'sub', 'tracer', 'judge'])

/** Prefix caching isn't placed: it's bought in a model's inspector (D5). */
export const PREFIX_CARD_REASON = "Turn it on in a model's inspector"

export const CARD_KEYS = ['Q', 'W', 'E', 'R', 'T'] as const

/** The upkeep line on a card: "$30/min", "Per token" for hosted APIs, "Upgrade" for upgrades. */
export function upkeepLabel(card: Pick<CardDef, 'upgrade' | 'upkeepPerMin'>): string {
  if (card.upgrade === true) return 'Upgrade'
  return card.upkeepPerMin > 0 ? `$${card.upkeepPerMin}/min` : 'Per token'
}

/** The node type a selected card places, or null for a locked card or no card. */
export function nodeTypeOfCard(card: string | null): NodeType | null {
  if (card === null) return null
  for (const tab of TABS) for (const def of CARDS[tab.tab]) if (def.kind === card) return def.nodeType ?? null
  return null
}
