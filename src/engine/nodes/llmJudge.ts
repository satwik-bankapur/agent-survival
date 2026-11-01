/*
 * LLM-as-a-judge (J-3). No links and no pipeline: it samples answers as
 * users get them, on its own RNG stream and its own endpoint, so it never
 * moves another roll and never takes a provider slot. It reads the rubric,
 * the prompt, any context or tool results, and the answer, at its own token
 * prices. It catches most wrong answers it samples and flags a few good ones,
 * and its verdict lands 2 s later naming the node that produced the answer.
 * Trust doesn't move: only users' complaints do (D10).
 */

import { ticksPerSecond } from '../catalog'
import { spendTokens } from '../economy'
import { claimNodeIncident, EventKind, NodeIncident, pushIncident } from '../events'
import { producerOf, tallyOf } from '../runLog'
import type { GameNode, Packet } from '../types'
import type { World } from '../world'
import { kvTokensOf } from './pipeline'

/** The judge on the board, or undefined. There's at most one. */
export function judgeOf(world: World): GameNode | undefined {
  for (let i = 0; i < world.nodes.length; i++) if (world.nodes[i].type === 'LLM_JUDGE') return world.nodes[i]
  return undefined
}

/** What judging one answer costs: rubric, prompt, context and answer in, a short verdict out. */
export function judgeCost(world: World, tokensJudged: number): number {
  const spec = world.catalog.nodes.LLM_JUDGE
  return ((spec.rubricTokens + tokensJudged) / 1000) * spec.inputPricePer1k + (spec.verdictTokens / 1000) * spec.outputPricePer1k
}

/** An answer just reached users in time. Maybe sample it. */
export function judgeAnswer(world: World, p: Packet): void {
  const judge = judgeOf(world)
  if (judge === undefined) return
  const rng = world.rng.judge
  if (!rng.chance(judge.sampleRate)) return
  const spec = world.catalog.nodes.LLM_JUDGE
  spendTokens(world, judgeCost(world, kvTokensOf(p)))
  world.stats.judged++
  const producerId = producerOf(p)
  const producer = world.nodeById[producerId]
  if (producer !== undefined) producer.judged++
  const flagged = rng.chance(p.isHallucinated ? spec.recall : spec.falseFlagRate)
  if (!flagged || producerId < 0) return
  const delay = Math.round(spec.delaySec * ticksPerSecond(world.catalog))
  world.events.push(world.tick + delay, EventKind.JUDGE_VERDICT, producerId * 2 + (p.isHallucinated ? 1 : 0))
}

/** The verdict lands: the producer's flagged count goes up, and the feed names it. */
export function fileVerdict(world: World, arg: number): void {
  const producerId = arg >> 1
  if ((arg & 1) === 1) world.stats.judgeReveals++
  else world.stats.judgeFalseFlags++
  const producer = world.nodeById[producerId]
  if (producer === undefined) return
  producer.judgedWrong++
  if (!claimNodeIncident(world, producer, NodeIncident.JUDGE)) return
  const label = producer.label || (tallyOf(world, producerId)?.label ?? 'a model')
  pushIncident(world, 'warn', `The judge found a wrong answer from ${label}.`, producer.id)
}
