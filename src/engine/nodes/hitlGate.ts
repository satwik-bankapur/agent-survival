/*
 * Human review gate (D21): one reviewer, one run every 8 seconds at $0.50.
 * A run that hit max steps unfinished drains here as a refusal (+0.5) instead
 * of giving up (−3). The reviewer answers the user directly, so it needs no
 * link out.
 */

import { msToTicks } from '../catalog'
import { chargeOperating } from '../economy'
import { failPacket, releasePacket } from '../outcomes'
import { tallyTrust } from '../runLog'
import { recordOutcome } from '../trust'
import type { PipelineBehavior } from './pipeline'

export const hitlGate: PipelineBehavior = {
  type: 'HITL_GATE',
  burnsTokens: false,
  serviceTicks(world) {
    return msToTicks(world.catalog, world.catalog.nodes.HITL_GATE.serviceMs)
  },
  complete(world, node, p) {
    chargeOperating(world, world.catalog.nodes.HITL_GATE.reviewCost)
    world.stats.reviews++
    // A review that lands after the user's deadline is a timeout, as at Users out.
    if (!p.lateScored && world.tick > p.deadlineTick) {
      failPacket(world, p, 'TIMEOUT', node)
      return
    }
    if (!p.lateScored) {
      world.stats.refused++
      recordOutcome(world, 'REFUSED')
      tallyTrust(world, 'REVIEWED')
    }
    releasePacket(world, p)
  },
}
