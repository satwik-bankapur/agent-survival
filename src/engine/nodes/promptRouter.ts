/*
 * Prompt router (D32, D47): simple chat to a small model (Fast SLM, a vLLM
 * 8B), complex chat to a large one (Frontier, a vLLM 70B), 94% accurate. A misroute goes to the other kind if it's linked;
 * if only one kind is linked, everything goes there. RAG questions go to a
 * linked retrieval node, or as complex chat when there's none. Attacks look
 * like simple chat, so they route as one. Agent tasks go to a linked
 * coordinator, or as complex chat, their tools then invented (D19).
 */

import { msToTicks } from '../catalog'
import { forward, forwardAmong, forwardToModel, hasLinkTo, type ModelClass } from '../EdgeRouter'
import type { Rng } from '../rng'
import type { Difficulty } from '../types'
import type { PipelineBehavior } from './pipeline'

/** The model class a packet should go to, or null when no model is linked. */
export function routerPick(
  rng: Rng,
  accuracy: number,
  difficulty: Difficulty,
  hasSmall: boolean,
  hasLarge: boolean,
): ModelClass | null {
  if (!hasSmall && !hasLarge) return null
  if (!hasSmall) return 'LARGE_MODEL'
  if (!hasLarge) return 'SMALL_MODEL'
  const correct: ModelClass = difficulty === 'SIMPLE' ? 'SMALL_MODEL' : 'LARGE_MODEL'
  const other: ModelClass = difficulty === 'SIMPLE' ? 'LARGE_MODEL' : 'SMALL_MODEL'
  return rng.chance(accuracy) ? correct : other
}

export const promptRouter: PipelineBehavior = {
  type: 'PROMPT_ROUTER',
  burnsTokens: false,
  serviceTicks(world) {
    return msToTicks(world.catalog, world.catalog.nodes.PROMPT_ROUTER.serviceMs)
  },
  complete(world, node, p) {
    if (p.category === 'AGENT_TASK' && hasLinkTo(world, node, 'LANGGRAPH_COORDINATOR')) {
      forward(world, node, p, 'LANGGRAPH_COORDINATOR')
      return
    }
    if (p.category === 'RAG_QUERY' && (hasLinkTo(world, node, 'VECTOR_DB') || hasLinkTo(world, node, 'BM25_SEARCH'))) {
      forwardAmong(world, node, p, 'VECTOR_DB', 'BM25_SEARCH')
      return
    }
    const target = routerPick(
      world.rng.rolls,
      world.catalog.nodes.PROMPT_ROUTER.accuracy,
      p.difficulty,
      hasLinkTo(world, node, 'SMALL_MODEL'),
      hasLinkTo(world, node, 'LARGE_MODEL'),
    )
    // With no model linked (only a cache, say), it forwards like any other node. With its class
    // open or cold, a packet goes to the other class, then gets the degraded reply (D29).
    if (target === null) forward(world, node, p, null)
    else forwardToModel(world, node, p, target)
  },
}
