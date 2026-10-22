/*
 * Prompt firewall (D18, D45). It blocks 95% of injections; a blocked attack
 * ends here with no outcome (D44). 0.5% of real prompts trip it by mistake
 * and are refused on the spot, hopping straight to Users out.
 */

import { msToTicks, type FirewallSpec } from '../catalog'
import { forward, nearestUsersOut, sendVirtual } from '../EdgeRouter'
import { BoardEffect, pushBoardEffect } from '../events'
import { releaseAttack } from '../outcomes'
import type { Rng } from '../rng'
import type { Packet } from '../types'
import type { PipelineBehavior } from './pipeline'

export const FirewallVerdict = { PASS: 0, BLOCK: 1, REFUSE: 2 } as const
export type FirewallVerdictValue = (typeof FirewallVerdict)[keyof typeof FirewallVerdict]

/** One roll per prompt: a block for an attack, a false alarm for anything else. */
export function firewallVerdict(rng: Rng, spec: FirewallSpec, p: Pick<Packet, 'isMaliciousInjection'>): FirewallVerdictValue {
  if (p.isMaliciousInjection) return rng.chance(spec.blockRate) ? FirewallVerdict.BLOCK : FirewallVerdict.PASS
  return rng.chance(spec.falseAlarmRate) ? FirewallVerdict.REFUSE : FirewallVerdict.PASS
}

export const promptFirewall: PipelineBehavior = {
  type: 'PROMPT_FIREWALL',
  burnsTokens: false,
  serviceTicks(world) {
    return msToTicks(world.catalog, world.catalog.nodes.PROMPT_FIREWALL.serviceMs)
  },
  complete(world, node, p) {
    const verdict = firewallVerdict(world.rng.rolls, world.catalog.nodes.PROMPT_FIREWALL, p)
    if (verdict === FirewallVerdict.BLOCK) {
      node.blocks++
      world.stats.attacksBlocked++
      // Blocks are loud: the attack shatters against the firewall (design: "Adversarial, blocked").
      pushBoardEffect(world, BoardEffect.ATTACK_BLOCKED, node.id)
      releaseAttack(world, p)
      return
    }
    const exit = verdict === FirewallVerdict.REFUSE ? nearestUsersOut(world, node) : undefined
    if (exit !== undefined) {
      p.refused = true
      sendVirtual(world, p, node, exit)
      return
    }
    forward(world, node, p, null)
  },
}
