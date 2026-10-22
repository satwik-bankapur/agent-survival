/*
 * Semantic cache (D15). Hit chance warms up with lookups. A hit goes straight
 * to the nearest Users out on a virtual hop, skipping every downstream check,
 * and 1.5% of hits are wrong answers. Strictness trades hits for wrong hits,
 * and RAG questions hit at most 15% (D47). Attacks and prompts carrying PII
 * always miss (D50): crafted or personal text matches no cached answer. So do
 * agent tasks: every task is unique (I-1).
 */

import { msToTicks, type CacheSpec } from '../catalog'
import { forward, nearestUsersOut, sendVirtual } from '../EdgeRouter'
import { BoardEffect, pushBoardEffect } from '../events'
import type { Rng } from '../rng'
import type { Category, Difficulty, Strictness } from '../types'
import type { PipelineBehavior } from './pipeline'

export const CacheLookup = { MISS: 0, HIT: 1, WRONG_HIT: 2 } as const
export type CacheLookupResult = (typeof CacheLookup)[keyof typeof CacheLookup]

/** maxHit × strictness × (1 − e^(−lookups ÷ warm-up)) (D15). maxHit is by difficulty, or RAG's own. */
export function cacheHitChance(
  spec: CacheSpec,
  difficulty: Difficulty,
  lookups: number,
  strictness: Strictness = 'BALANCED',
  category: Category = 'CHAT',
): number {
  const max = category === 'RAG_QUERY' ? spec.ragMaxHitRate : spec.maxHitRate[difficulty]
  return max * spec.strictness[strictness].hit * (1 - Math.exp(-lookups / spec.warmupLookups))
}

export function rollCacheLookup(
  rng: Rng,
  spec: CacheSpec,
  difficulty: Difficulty,
  lookups: number,
  strictness: Strictness = 'BALANCED',
  category: Category = 'CHAT',
): CacheLookupResult {
  if (!rng.chance(cacheHitChance(spec, difficulty, lookups, strictness, category))) return CacheLookup.MISS
  return rng.chance(spec.wrongHitRate * spec.strictness[strictness].wrong) ? CacheLookup.WRONG_HIT : CacheLookup.HIT
}

export const semanticCache: PipelineBehavior = {
  type: 'SEMANTIC_CACHE',
  burnsTokens: false,
  serviceTicks(world) {
    return msToTicks(world.catalog, world.catalog.nodes.SEMANTIC_CACHE.serviceMs)
  },
  complete(world, node, p) {
    node.lookups++
    // No roll for them, so the roll stream of everything else is unchanged.
    if (p.isMaliciousInjection || p.containsPII || p.category === 'AGENT_TASK') {
      forward(world, node, p, null)
      return
    }
    const result = rollCacheLookup(world.rng.rolls, world.catalog.nodes.SEMANTIC_CACHE, p.difficulty, node.lookups, node.strictness, p.category)
    const exit = result === CacheLookup.MISS ? undefined : nearestUsersOut(world, node)
    if (exit === undefined) {
      forward(world, node, p, null)
      return
    }
    p.cacheHit = true
    p.isHallucinated = result === CacheLookup.WRONG_HIT
    world.stats.cacheHits++
    if (p.isHallucinated) world.stats.wrongCacheHits++
    pushBoardEffect(world, BoardEffect.CACHE_HIT, node.id)
    sendVirtual(world, p, node, exit)
  },
}
