/*
 * Loud failures and throttling. Each one is a trust outcome (D8), counts in
 * the ground-truth stats, may raise an incident, and frees the packet.
 * Answers that reach users resolve in nodes/usersOut.ts.
 */

import { recordCall } from './breaker'
import { isModelType } from './catalog'
import { chargeFine } from './economy'
import { BoardEffect, claimNodeIncident, NodeIncident, pushBoardEffect, pushIncident } from './events'
import { tallyOf, tallyTrust } from './runLog'
import { recordOutcome } from './trust'
import type { Category, FailureReason, GameNode, Packet } from './types'
import type { World } from './world'

/**
 * Every packet leaves through here. One still in an agent run frees its place on the coordinator
 * (D26), so a run can't outlive its packet.
 */
export function releasePacket(world: World, p: Packet): void {
  if (p.coordinatorId >= 0) {
    const coordinator = world.nodeById[p.coordinatorId]
    if (coordinator !== undefined) endRun(coordinator, p)
  }
  world.pool.release(p.index)
}

/** Takes a packet off its coordinator's runs. It travels on as a plain packet, if at all. */
export function endRun(coordinator: GameNode, p: Packet): void {
  coordinator.busy--
  if (p.runaway) coordinator.longRuns--
  p.coordinatorId = -1
}

/**
 * The user behind an agent run gave up at the deadline: one timeout, scored now (I-1). The run
 * itself goes on until max steps ends it, and nothing it does later scores again.
 */
export function scoreLateRun(world: World, p: Packet, coordinator: GameNode): void {
  p.lateScored = true
  recordFailure(world, p, 'TIMEOUT', coordinator)
}

/** Frees a packet that failed loudly: −3 trust, $0. The caller has already taken it out of wherever it was. */
export function failPacket(world: World, p: Packet, reason: FailureReason, node: GameNode | null): void {
  recordFailure(world, p, reason, node)
  releasePacket(world, p)
}

function recordFailure(world: World, p: Packet, reason: FailureReason, node: GameNode | null): void {
  const stats = world.stats
  switch (reason) {
    case 'TIMEOUT':
      stats.timeouts++
      if (node !== null) bump(world, node.id, 'timeouts')
      if (node !== null && claimNodeIncident(world, node, NodeIncident.TIMEOUT)) {
        pushIncident(world, 'warn', `Prompts are timing out at ${node.label}.`, node.id)
      }
      break
    case 'QUEUE_FULL':
      stats.queueFullDrops++
      if (node !== null) bump(world, node.id, 'queueFullDrops')
      if (node !== null) {
        node.drops++
        node.lastQueueFullTick = world.tick
        pushBoardEffect(world, BoardEffect.QUEUE_FULL, node.id)
        if (claimNodeIncident(world, node, NodeIncident.QUEUE_FULL)) {
          pushIncident(world, 'warn', `${node.label}'s queue is full. New prompts are being dropped.`, node.id)
        }
      }
      break
    case 'NO_ROUTE':
      stats.noRouteDrops++
      if (node !== null) bump(world, node.id, 'noRouteDrops')
      if (node !== null) {
        node.drops++
        if (claimNodeIncident(world, node, NodeIncident.NO_ROUTE)) {
          pushIncident(world, 'warn', `${node.label} has no route. Link it to something downstream.`, node.id)
        }
      }
      break
    case 'BROKEN_JSON':
      stats.brokenAnswers++
      if (node !== null && claimNodeIncident(world, node, NodeIncident.BROKEN_ANSWER)) {
        pushIncident(world, 'warn', 'Users got a broken answer: the JSON was malformed.', node.id)
      }
      break
    case 'DEMOLISHED':
      stats.demolishedDrops++
      break
    case 'PROVIDER_ERROR':
      stats.providerErrors++
      if (node !== null && claimNodeIncident(world, node, NodeIncident.PROVIDER_ERROR)) {
        pushIncident(world, 'alarm', `${node.label} is returning errors: its provider is down.`, node.id)
      }
      break
    case 'GAVE_UP':
      stats.gaveUp++
      if (node !== null && claimNodeIncident(world, node, NodeIncident.GAVE_UP)) {
        pushIncident(world, 'warn', `Agent runs are giving up at ${node.label}: they hit max steps unfinished.`, node.id)
      }
      break
  }
  // A model's loud failures count toward its circuit breaker (D29). Wrong answers never do.
  if (node !== null && isModelType(node.type) && reason === 'PROVIDER_ERROR') {
    recordCall(world, node, true)
  }
  // Attackers aren't users: a stopped attack scores nothing (D44). A run whose user already
  // left has had its one outcome (I-1).
  if (p.category !== 'ADVERSARIAL' && !p.lateScored) {
    recordOutcome(world, 'FAILED')
    tallyTrust(world, reason, node?.type ?? null)
  }
}

export type BreachKind = 'INJECTION' | 'PII'

/**
 * A breach (D43): an injection got through, or PII reached a hosted model. It's the prompt's one
 * outcome: −14 trust, a fine, $0. Breaches are loud, so the incident names the model.
 */
export function breachPacket(world: World, p: Packet, model: GameNode, kind: BreachKind): void {
  if (kind === 'INJECTION') world.stats.injectionBreaches++
  else world.stats.piiBreaches++
  const tally = tallyOf(world, model.id)
  if (tally !== undefined) {
    tally.breaches++
    if (kind === 'PII') tally.piiBreaches++
  }
  const amount = world.catalog.breachFine[kind]
  chargeFine(world, amount)
  if (!p.lateScored) {
    recordOutcome(world, 'BREACH')
    tallyTrust(world, 'BREACH', model.type)
  }
  if (claimNodeIncident(world, model, NodeIncident.BREACH)) {
    const fine = `$${amount} fine`
    pushIncident(
      world,
      'alarm',
      kind === 'INJECTION'
        ? `Breach: a prompt injection took over ${model.label}. ${fine}.`
        : `Breach: ${model.label} was sent a user's personal data unredacted. ${fine}.`,
      model.id,
    )
  }
  releasePacket(world, p)
}

/** A stopped attack leaves without an outcome (D44). */
export function releaseAttack(world: World, p: Packet): void {
  releasePacket(world, p)
}

function bump(world: World, nodeId: number, key: 'timeouts' | 'queueFullDrops' | 'noRouteDrops'): void {
  const tally = tallyOf(world, nodeId)
  if (tally !== undefined) tally[key]++
}

/** Users in turns a new prompt away: the pool is empty (D31), or the player's throttle is on (D7). */
export function throttleArrival(world: World, usersIn: GameNode, category: Category, byThrottle: boolean): void {
  world.stats.throttled++
  if (category !== 'ADVERSARIAL') {
    recordOutcome(world, 'THROTTLED')
    tallyTrust(world, 'THROTTLED_IN')
  }
  if (claimNodeIncident(world, usersIn, NodeIncident.QUEUE_FULL)) {
    pushIncident(
      world,
      'warn',
      byThrottle ? 'Users in is throttling: prompts over the limit are turned away.' : 'Too many prompts are in flight. Users in is turning new ones away.',
      usersIn.id,
    )
  }
}
