/*
 * Users out: where answers resolve. No queue, no workers: a packet resolves
 * the moment it arrives. Revenue lands here (D1), and a wrong answer looks,
 * pays and scores exactly like a good one until users complain (D10).
 */

import { ticksPerSecond } from '../catalog'
import { earn, revenueFor } from '../economy'
import { BoardEffect, pushBoardEffect, scheduleComplaint } from '../events'
import { failPacket, releasePacket } from '../outcomes'
import { tallyServed, tallyTrust } from '../runLog'
import { recordOutcome } from '../trust'
import type { GameNode, Packet } from '../types'
import type { World } from '../world'
import { judgeAnswer } from './llmJudge'

export function exitPacket(world: World, usersOut: GameNode, p: Packet): void {
  const stats = world.stats
  if (p.category === 'ADVERSARIAL') {
    // An attack answered without a breach: nothing earned, nothing scored (D44).
    stats.attacksResisted++
    usersOut.processed++
    releasePacket(world, p)
    return
  }
  if (world.tick > p.deadlineTick) {
    failPacket(world, p, 'TIMEOUT', usersOut)
    return
  }
  if (p.refused) {
    stats.refused++
    // An agent task refused is a job not done: it scores as a failure (I-1). Review answers
    // in the gate and never gets here, so it keeps +0.5.
    recordOutcome(world, p.category === 'AGENT_TASK' ? 'FAILED' : 'REFUSED')
    tallyTrust(world, p.category === 'AGENT_TASK' ? 'AGENT_REFUSED' : 'REFUSED')
  } else if (p.isMalformedJson) {
    // No guardrail caught it, so users get a broken answer (D16).
    failPacket(world, p, 'BROKEN_JSON', usersOut)
    return
  } else {
    const revenue = revenueFor(world.catalog, p)
    earn(world, revenue)
    // Complex answers are the money moments; simple chats' 30 cents would only be noise on the board.
    if (p.difficulty === 'COMPLEX') pushBoardEffect(world, BoardEffect.REVENUE, usersOut.id, revenue)
    stats.served++
    tallyServed(world, p, revenue)
    recordOutcome(world, 'GOOD')
    tallyTrust(world, 'GOOD')
    if (p.isHallucinated) {
      stats.wrongServed++
      if (p.category === 'RAG_QUERY' && p.drift >= world.catalog.nodes.VECTOR_DB.driftCap / 2) stats.wrongDrifted++
      scheduleComplaint(world, usersOut.id)
    } else {
      stats.good++
    }
    // The tracer's latency, end to end, newest first in a ring (J-3).
    world.latency[world.latencyCount++ % world.latency.length] = (world.tick - p.createdTick) / ticksPerSecond(world.catalog)
    judgeAnswer(world, p)
  }
  usersOut.processed++
  releasePacket(world, p)
}
