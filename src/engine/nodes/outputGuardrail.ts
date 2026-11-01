/*
 * Output guardrail (D16). Malformed JSON goes back once to the model that
 * produced it; a second failure becomes a refusal. Otherwise it catches 85%
 * of wrong answers and flags 1% of good ones, and both become refusals. On a
 * RAG answer, recall falls with context quality: it can't check what it
 * can't ground (D42). It doesn't catch injections; that's the firewall's job.
 */

import { isModelType, msToTicks, type GuardrailSpec } from '../catalog'
import { forward, sendVirtual } from '../EdgeRouter'
import type { Rng } from '../rng'
import type { Packet } from '../types'
import type { PipelineBehavior } from './pipeline'

export const Verdict = { PASS: 0, REFUSE: 1, RETRY: 2 } as const
export type VerdictValue = (typeof Verdict)[keyof typeof Verdict]

/** catchRate, or on a RAG answer catchRate × (base + (1 − base) × q) (D16). */
export function guardrailRecall(spec: GuardrailSpec, p: Pick<Packet, 'category' | 'contextQuality'>): number {
  if (p.category !== 'RAG_QUERY') return spec.catchRate
  return spec.catchRate * (spec.ragRecallBase + (1 - spec.ragRecallBase) * p.contextQuality)
}

export function guardrailVerdict(rng: Rng, spec: GuardrailSpec, p: Packet): VerdictValue {
  if (p.isMalformedJson) return p.hasRetriedSchema ? Verdict.REFUSE : Verdict.RETRY
  if (p.isHallucinated) return rng.chance(guardrailRecall(spec, p)) ? Verdict.REFUSE : Verdict.PASS
  return rng.chance(spec.falseAlarmRate) ? Verdict.REFUSE : Verdict.PASS
}

export const outputGuardrail: PipelineBehavior = {
  type: 'OUTPUT_GUARDRAIL',
  burnsTokens: false,
  serviceTicks(world) {
    return msToTicks(world.catalog, world.catalog.nodes.OUTPUT_GUARDRAIL.serviceMs)
  },
  complete(world, node, p) {
    let verdict = guardrailVerdict(world.rng.rolls, world.catalog.nodes.OUTPUT_GUARDRAIL, p)
    if (verdict === Verdict.RETRY) {
      const model = world.nodeById[p.producedByModelId]
      if (model !== undefined && isModelType(model.type)) {
        p.hasRetriedSchema = true
        world.stats.jsonRetries++
        sendVirtual(world, p, node, model)
        return
      }
      // The model that produced it is gone, so there's nothing to retry against.
      verdict = Verdict.REFUSE
    }
    if (verdict === Verdict.REFUSE) {
      // "I don't have enough information." The content is replaced, so its flaws go with it.
      p.refused = true
      p.isMalformedJson = false
    }
    forward(world, node, p, 'USERS_OUT')
  },
}
