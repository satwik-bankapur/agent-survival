/*
 * BM25 hybrid search (D45). Beside a vector DB it boosts the context's
 * quality for free. On its own it retrieves 2,000 tokens at q 0.55.
 */

import { msToTicks } from '../catalog'
import { Retrieved } from '../types'
import { boostQuality } from './model'
import type { PipelineBehavior } from './pipeline'
import { forwardFromRetrieval, setContext } from './retrieval'

export const bm25Search: PipelineBehavior = {
  type: 'BM25_SEARCH',
  burnsTokens: false,
  serviceTicks(world) {
    return msToTicks(world.catalog, world.catalog.nodes.BM25_SEARCH.serviceMs)
  },
  complete(world, node, p) {
    if (p.category === 'RAG_QUERY' && (p.retrievalMask & Retrieved.BM25) === 0) {
      const spec = world.catalog.nodes.BM25_SEARCH
      if ((p.retrievalMask & Retrieved.VECTOR_DB) !== 0) {
        p.contextQuality = boostQuality(p.contextQuality, spec.hybridBoost)
      } else {
        p.contextQuality = spec.aloneQuality
        setContext(p, spec.aloneContextTokens)
      }
      p.retrievalMask |= Retrieved.BM25
    }
    forwardFromRetrieval(world, node, p)
  },
}
