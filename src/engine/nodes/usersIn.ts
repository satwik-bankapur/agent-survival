/*
 * Users in: where prompts enter. No queue, no workers: the wave director
 * spawns a packet here and it leaves on an outgoing link in the same tick.
 * The player's throttle (D7) turns prompts away here, before they cost anything.
 */

import { ticksPerSecond } from '../catalog'
import { forward } from '../EdgeRouter'
import { throttleArrival } from '../outcomes'
import { countArrival } from '../WaveDirector'
import { Tool, type Category, type Difficulty, type GameNode } from '../types'
import type { World } from '../world'

/** Spawns one prompt at Users in and sends it on. Throttles if the throttle is on and empty (D7), or the pool is (D31). */
export function spawnArrival(world: World, usersIn: GameNode, category: Category, difficulty: Difficulty, pii: boolean, toolPlan = 0): void {
  world.stats.arrivals++
  countArrival(world, category, difficulty)
  if (usersIn.throttlePerSec > 0) {
    if (usersIn.bucket < 1) {
      throttleArrival(world, usersIn, category, true)
      return
    }
    usersIn.bucket -= 1
  }
  const index = world.pool.acquire()
  if (index < 0) {
    throttleArrival(world, usersIn, category, false)
    return
  }
  const p = world.pool.packets[index]
  const traffic = world.catalog.traffic
  const spec =
    category === 'RAG_QUERY' ? traffic.rag : category === 'ADVERSARIAL' ? traffic.adversarial : category === 'AGENT_TASK' ? traffic.agent : traffic.chat[difficulty]
  p.category = category
  p.difficulty = difficulty
  p.createdTick = world.tick
  p.deadlineTick = world.tick + Math.round(spec.deadlineSec * ticksPerSecond(world.catalog))
  p.newInputTokens = spec.inputTokens
  p.outputTokensGenerated = spec.outputTokens
  if (category === 'AGENT_TASK') {
    // The shared system prompt rides in front of the user's input (D5, D6).
    p.systemPromptTokens = traffic.agent.systemPromptTokens
    p.newInputTokens += p.systemPromptTokens
    p.toolPlan = toolPlan
    p.requiredToolSteps = toolCount(toolPlan)
  }
  // A RAG question starts with no context: its quality comes from retrieval (D42).
  p.contextQuality = category === 'RAG_QUERY' ? 0 : 1
  p.containsPII = pii
  p.isMaliciousInjection = category === 'ADVERSARIAL'
  usersIn.processed++
  // Without a router, a node forwards to its least-loaded target regardless of difficulty (D32).
  forward(world, usersIn, p, null)
}

/** How many tools a plan needs. */
export function toolCount(plan: number): number {
  return ((plan & Tool.SEARCH) !== 0 ? 1 : 0) + ((plan & Tool.CODE) !== 0 ? 1 : 0)
}
