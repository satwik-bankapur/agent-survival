/*
 * Cross-encoder reranker (D17, D45). It reads the whole retrieved context,
 * so it's slow and takes longer the more it reads, then compresses it to
 * 1,200 tokens and raises its quality.
 */

import { msToTicks } from '../catalog'
import { Retrieved } from '../types'
import { boostQuality } from './model'
import type { PipelineBehavior } from './pipeline'
import { forwardFromRetrieval, setContext } from './retrieval'

export const reranker: PipelineBehavior = {
  type: 'RERANKER',
  burnsTokens: false,
  serviceTicks(world, _node, p) {
    const spec = world.catalog.nodes.RERANKER
    return msToTicks(world.catalog, spec.baseMs + p.contextTokens * spec.msPerContextToken)
  },
  complete(world, node, p) {
    if (p.category === 'RAG_QUERY' && p.contextTokens > 0 && (p.retrievalMask & Retrieved.RERANKED) === 0) {
      const spec = world.catalog.nodes.RERANKER
      p.contextQuality = boostQuality(p.contextQuality, spec.boost)
      if (p.contextTokens > spec.compressTo) setContext(p, spec.compressTo)
      p.retrievalMask |= Retrieved.RERANKED
    }
    forwardFromRetrieval(world, node, p)
  },
}
