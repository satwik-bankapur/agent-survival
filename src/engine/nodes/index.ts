/*
 * One file per node behaviour, each using the same queue and worker pipeline
 * (pipeline.ts). Users in and Users out have no pipeline: Users in spawns and
 * forwards, and Users out resolves on arrival.
 */

import type { NodeType } from '../types'
import { bm25Search } from './bm25Search'
import { fastSlm } from './fastSlm'
import { frontierApi } from './frontierApi'
import { hitlGate } from './hitlGate'
import { mcpCodeSandbox, mcpWebSearch } from './mcpTool'
import { outputGuardrail } from './outputGuardrail'
import { piiRedactor } from './piiRedactor'
import type { PipelineBehavior } from './pipeline'
import { promptFirewall } from './promptFirewall'
import { promptRouter } from './promptRouter'
import { reranker } from './reranker'
import { semanticCache } from './semanticCache'
import { vectorDb } from './vectorDb'
import { vllmCluster } from './vllmCluster'

export const PIPELINE_BEHAVIORS: Readonly<Record<NodeType, PipelineBehavior | null>> = {
  USERS_IN: null,
  USERS_OUT: null,
  FRONTIER_API: frontierApi,
  FAST_SLM: fastSlm,
  SEMANTIC_CACHE: semanticCache,
  PROMPT_ROUTER: promptRouter,
  OUTPUT_GUARDRAIL: outputGuardrail,
  PROMPT_FIREWALL: promptFirewall,
  PII_REDACTOR: piiRedactor,
  VECTOR_DB: vectorDb,
  BM25_SEARCH: bm25Search,
  RERANKER: reranker,
  // No pipeline: it runs on a timer (ingestionCron.ts).
  INGESTION_CRON: null,
  // No pipeline: it admits runs and routes returns itself (coordinator.ts).
  LANGGRAPH_COORDINATOR: null,
  MCP_WEB_SEARCH: mcpWebSearch,
  MCP_CODE_SANDBOX: mcpCodeSandbox,
  HITL_GATE: hitlGate,
  VLLM_CLUSTER: vllmCluster,
  // No pipelines: a substation supplies power, and the tracer and judge watch from the side.
  POWER_SUBSTATION: null,
  TRACER: null,
  LLM_JUDGE: null,
}

export { cacheHitChance, CacheLookup, rollCacheLookup } from './semanticCache'
export { routerPick } from './promptRouter'
export { guardrailRecall, guardrailVerdict, Verdict } from './outputGuardrail'
export { agentWrongRate, boostQuality, ragWrongRate, rollAnswer, wrongRateFor } from './model'
export { runCrons } from './ingestionCron'
export { cachedReadTokens } from './model'
export { nextTool, runCoordinator } from './coordinator'
export { firewallVerdict, FirewallVerdict } from './promptFirewall'
export { scrubPii } from './piiRedactor'
export type { PipelineBehavior } from './pipeline'
