/*
 * PII redactor (D18, D45). It scrubs 98% of the personal data it sees, so
 * a hosted model downstream never receives it (D43).
 */

import { msToTicks, type RedactorSpec } from '../catalog'
import { forward } from '../EdgeRouter'
import type { Rng } from '../rng'
import type { Packet } from '../types'
import type { PipelineBehavior } from './pipeline'

/** Rolled only for PII, so other traffic's roll stream is untouched. */
export function scrubPii(rng: Rng, spec: RedactorSpec, p: Pick<Packet, 'containsPII' | 'redacted'>): void {
  if (p.containsPII && rng.chance(spec.scrubRate)) {
    p.containsPII = false
    p.redacted = true
  }
}

export const piiRedactor: PipelineBehavior = {
  type: 'PII_REDACTOR',
  burnsTokens: false,
  serviceTicks(world) {
    return msToTicks(world.catalog, world.catalog.nodes.PII_REDACTOR.serviceMs)
  },
  complete(world, node, p) {
    scrubPii(world.rng.rolls, world.catalog.nodes.PII_REDACTOR, p)
    forward(world, node, p, null)
  },
}
