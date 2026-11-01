/*
 * What the retrieval nodes share (D45–D47): how retrieved context changes a
 * prompt, vector DB drift, and where a prompt goes next. A RAG question
 * visits the other retrieval node if it's linked and not yet visited, then
 * the reranker, then the least-loaded model. A non-RAG prompt only passes
 * through, taking the service time and getting no context.
 */

import { ticksPerSecond } from '../catalog'
import { forward, forwardToModel, hasLinkTo } from '../EdgeRouter'
import { Retrieved, type GameNode, type Packet } from '../types'
import type { World } from '../world'

/** Replaces a prompt's retrieved context, keeping its input tokens in step. */
export function setContext(p: Packet, tokens: number): void {
  p.newInputTokens += tokens - p.contextTokens
  p.contextTokens = tokens
}

/** Drift = per-minute growth × minutes since the last index, capped (D46), plus any drift surge (J-4). */
export function vectorDbDrift(world: World, node: GameNode): number {
  const spec = world.catalog.nodes.VECTOR_DB
  const minutes = (world.tick - node.indexedTick) / ticksPerSecond(world.catalog) / 60
  const drift = Math.min(spec.driftCap, spec.driftPerMin * minutes)
  return node.driftSurge > 0 ? Math.min(world.catalog.director.driftSurge.cap, drift + node.driftSurge) : drift
}


export function forwardFromRetrieval(world: World, node: GameNode, p: Packet): void {
  if (p.category === 'RAG_QUERY' && node.type !== 'RERANKER') {
    const other = node.type === 'VECTOR_DB' ? 'BM25_SEARCH' : 'VECTOR_DB'
    const bit = other === 'VECTOR_DB' ? Retrieved.VECTOR_DB : Retrieved.BM25
    if ((p.retrievalMask & bit) === 0 && hasLinkTo(world, node, other)) {
      forward(world, node, p, other)
      return
    }
  }
  if (node.type !== 'RERANKER' && hasLinkTo(world, node, 'RERANKER')) forward(world, node, p, 'RERANKER')
  else if (hasLinkTo(world, node, 'MODEL')) forwardToModel(world, node, p, 'MODEL')
  else forward(world, node, p, null)
}
