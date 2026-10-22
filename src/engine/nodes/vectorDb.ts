/*
 * Vector DB (D45, D46). Its tier sets its speed, workers and context
 * quality. It adds 4,000 tokens of context to a RAG question, and the
 * drift it has built up since its last index.
 */

import { msToTicks } from '../catalog'
import { Retrieved } from '../types'
import { boostQuality } from './model'
import type { PipelineBehavior } from './pipeline'
import { forwardFromRetrieval, setContext, vectorDbDrift } from './retrieval'

export const vectorDb: PipelineBehavior = {
  type: 'VECTOR_DB',
  burnsTokens: false,
  serviceTicks(world, node) {
    return msToTicks(world.catalog, world.catalog.nodes.VECTOR_DB.tiers[node.tier - 1].serviceMs)
  },
  complete(world, node, p) {
    if (p.category === 'RAG_QUERY' && (p.retrievalMask & Retrieved.VECTOR_DB) === 0) {
      const spec = world.catalog.nodes.VECTOR_DB
      const q = spec.tiers[node.tier - 1].quality
      // After BM25 it's a hybrid: the vector DB's quality with BM25's boost, and its own context.
      const hybrid = (p.retrievalMask & Retrieved.BM25) !== 0
      p.contextQuality = hybrid ? boostQuality(q, world.catalog.nodes.BM25_SEARCH.hybridBoost) : q
      setContext(p, spec.contextTokens)
      p.drift = vectorDbDrift(world, node)
      if (p.drift >= spec.driftCap && world.runLog.driftCapTick < 0) world.runLog.driftCapTick = world.tick
      p.retrievalMask |= Retrieved.VECTOR_DB
    }
    forwardFromRetrieval(world, node, p)
  },
}
