/* One mesh per node type, picked by the engine node's type. */

import type { Topology, NodeView } from '../board'
import { Bm25Search } from './Bm25Search'
import { FastSlm } from './FastSlm'
import { FrontierApi } from './FrontierApi'
import { HitlGate } from './HitlGate'
import { LlmJudge } from './LlmJudge'
import { PowerSubstation } from './PowerSubstation'
import { Tracer } from './Tracer'
import { VllmCluster } from './VllmCluster'
import { IngestionCron } from './IngestionCron'
import { LanggraphCoordinator } from './LanggraphCoordinator'
import { McpCodeSandbox } from './McpCodeSandbox'
import { McpWebSearch } from './McpWebSearch'
import { OutputGuardrail } from './OutputGuardrail'
import { PiiRedactor } from './PiiRedactor'
import { PromptFirewall } from './PromptFirewall'
import { PromptRouter } from './PromptRouter'
import { Reranker } from './Reranker'
import { SemanticCache } from './SemanticCache'
import { UserPlaza } from './UserPlaza'
import { VectorDb } from './VectorDb'

export function NodeMesh({ node, topology }: { node: NodeView; topology: Topology }) {
  switch (node.type) {
    case 'USERS_IN':
    case 'USERS_OUT': {
      const area = topology.plazas.get(node.id)
      return area === undefined ? null : <UserPlaza node={node} area={area} />
    }
    case 'FAST_SLM':
      return <FastSlm node={node} />
    case 'FRONTIER_API':
      return <FrontierApi node={node} />
    case 'SEMANTIC_CACHE':
      return <SemanticCache node={node} />
    case 'PROMPT_ROUTER':
      return <PromptRouter node={node} />
    case 'OUTPUT_GUARDRAIL':
      return <OutputGuardrail node={node} />
    case 'PROMPT_FIREWALL':
      return <PromptFirewall node={node} />
    case 'PII_REDACTOR':
      return <PiiRedactor node={node} />
    case 'VECTOR_DB':
      return <VectorDb node={node} />
    case 'BM25_SEARCH':
      return <Bm25Search node={node} />
    case 'RERANKER':
      return <Reranker node={node} />
    case 'INGESTION_CRON':
      return <IngestionCron node={node} />
    case 'LANGGRAPH_COORDINATOR':
      return <LanggraphCoordinator node={node} />
    case 'MCP_WEB_SEARCH':
      return <McpWebSearch node={node} />
    case 'MCP_CODE_SANDBOX':
      return <McpCodeSandbox node={node} />
    case 'HITL_GATE':
      return <HitlGate node={node} />
    case 'VLLM_CLUSTER':
      return <VllmCluster node={node} />
    case 'POWER_SUBSTATION':
      return <PowerSubstation node={node} />
    case 'TRACER':
      return <Tracer node={node} />
    case 'LLM_JUDGE':
      return <LlmJudge node={node} />
  }
}
