/*
 * Circuit breakers (D29), a paid model setting (J-4), and whether a model
 * can take traffic at all. A breaker counts its model's loud failures over
 * the last 10 calls: provider errors, timeouts and queue-full drops, never
 * wrong answers. More than half failed opens it for 5 s; then 3 probe calls
 * go through, and it closes only if all 3 come back. While it's open, routers
 * and coordinators send elsewhere. Without one, nothing does: a provider in
 * an outage fails fast, so its queue looks empty and it attracts traffic.
 */

import { ticksPerSecond } from './catalog'
import { claimNodeIncident, NodeIncident, pushIncident } from './events'
import { Breaker, type GameNode } from './types'
import type { World } from './world'

/**
 * Can routing send this model a packet now? Not while a vLLM node loads its weights (J-1), nor
 * while its breaker is open, nor once a half-open breaker has sent its probes. An open breaker
 * past its 5 s turns half-open here.
 */
export function available(world: World, node: GameNode): boolean {
  if (node.coldUntilTick > world.tick) return false
  if (!node.breakerOn || node.breakerState === Breaker.CLOSED) return true
  if (node.breakerState === Breaker.OPEN) {
    if (world.tick < node.breakerUntilTick) return false
    node.breakerState = Breaker.HALF_OPEN
    node.probesSent = 0
    node.probeSuccesses = 0
  }
  return node.probesSent < world.catalog.breaker.probes
}

/** A packet is on its way to this node: a half-open breaker counts it as a probe. */
export function noteSent(node: GameNode): void {
  if (node.breakerOn && node.breakerState === Breaker.HALF_OPEN) node.probesSent++
}

function clearCalls(node: GameNode): void {
  node.breakerCalls.fill(0)
  node.breakerHead = 0
  node.breakerCount = 0
}

function open(world: World, node: GameNode): void {
  const spec = world.catalog.breaker
  node.breakerState = Breaker.OPEN
  node.breakerUntilTick = world.tick + Math.round(spec.openSec * ticksPerSecond(world.catalog))
  clearCalls(node)
  world.stats.breakerTrips++
  if (claimNodeIncident(world, node, NodeIncident.BREAKER)) {
    pushIncident(world, 'warn', `${node.label}'s circuit breaker opened: traffic goes to other models for ${spec.openSec} s.`, node.id)
  }
}

/** One call's outcome at a model. Only counted with the breaker on. */
export function recordCall(world: World, node: GameNode, failed: boolean): void {
  if (!node.breakerOn || node.breakerState === Breaker.OPEN) return
  const spec = world.catalog.breaker
  if (node.breakerState === Breaker.HALF_OPEN) {
    if (failed) {
      open(world, node)
      return
    }
    if (++node.probeSuccesses >= spec.probes) {
      node.breakerState = Breaker.CLOSED
      clearCalls(node)
    }
    return
  }
  node.breakerCalls[node.breakerHead] = failed ? 1 : 0
  node.breakerHead = (node.breakerHead + 1) % node.breakerCalls.length
  if (node.breakerCount < node.breakerCalls.length) node.breakerCount++
  let failures = 0
  for (let i = 0; i < node.breakerCount; i++) failures += node.breakerCalls[i]
  if (failures > spec.failShare * spec.window) open(world, node)
}

/** Turning a breaker off forgets its state. */
export function resetBreaker(node: GameNode): void {
  node.breakerState = Breaker.CLOSED
  clearCalls(node)
  node.probesSent = 0
  node.probeSuccesses = 0
}

export function breakerStateName(node: GameNode): 'closed' | 'open' | 'half-open' {
  return node.breakerState === Breaker.OPEN ? 'open' : node.breakerState === Breaker.HALF_OPEN ? 'half-open' : 'closed'
}
