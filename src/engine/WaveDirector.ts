/*
 * Traffic: Poisson arrivals whose rate and complex share rise over the run
 * (section G). From 2:00, RAG questions and attacks join the chat, and some
 * prompts carry PII (D41). The incident director's events bend the rate and
 * the mix (D48); classic mode's fixed spike is here too (D40). It also
 * measures what arrived at Users in, for the HUD's traffic panel.
 */

import { ticksPerSecond, type Catalog, type CategorySpec } from './catalog'
import { eventActive } from './IncidentDirector'
import { spawnArrival } from './nodes/usersIn'
import type { Category, Difficulty } from './types'
import type { World } from './world'

/** The traffic readout averages arrivals at Users in over this many seconds. */
export const TRAFFIC_WINDOW_SEC = 5

/**
 * Arrivals at Users in per tick, simple and complex, over the last TRAFFIC_WINDOW_SEC seconds:
 * a sliding window, so the readout is never more than one tick old.
 */
export interface TrafficMeter {
  readonly simple: Int16Array
  readonly complex: Int16Array
  readonly rag: Int16Array
  readonly adversarial: Int16Array
  readonly agent: Int16Array
  /** The newest tick the window holds, or −1 before the first. */
  lastTick: number
}

export function trafficWindowTicks(catalog: Catalog): number {
  return Math.round(TRAFFIC_WINDOW_SEC * ticksPerSecond(catalog))
}

export function createTrafficMeter(catalog: Catalog): TrafficMeter {
  const ticks = trafficWindowTicks(catalog)
  return {
    simple: new Int16Array(ticks),
    complex: new Int16Array(ticks),
    rag: new Int16Array(ticks),
    adversarial: new Int16Array(ticks),
    agent: new Int16Array(ticks),
    lastTick: -1,
  }
}

/** Counts one prompt arriving at Users in this tick, throttled or not. */
export function countArrival(world: World, category: Category, difficulty: Difficulty): void {
  const meter = world.traffic
  const b = world.tick % meter.simple.length
  if (difficulty === 'COMPLEX') meter.complex[b]++
  else meter.simple[b]++
  if (category === 'RAG_QUERY') meter.rag[b]++
  else if (category === 'ADVERSARIAL') meter.adversarial[b]++
  else if (category === 'AGENT_TASK') meter.agent[b]++
}

export interface RecentArrivals {
  readonly simple: number
  readonly complex: number
  readonly rag: number
  readonly adversarial: number
  readonly agent: number
  /** Ticks the window covers. */
  readonly ticks: number
}

/** Arrivals in the window ending with the newest tick run. */
export function recentArrivals(world: World): RecentArrivals {
  const meter = world.traffic
  const size = meter.simple.length
  const covered = Math.min(size, meter.lastTick + 1)
  let simple = 0
  let complex = 0
  let rag = 0
  let adversarial = 0
  let agent = 0
  for (let i = 0; i < covered; i++) {
    const b = (meter.lastTick - i) % size
    simple += meter.simple[b]
    complex += meter.complex[b]
    rag += meter.rag[b]
    adversarial += meter.adversarial[b]
    agent += meter.agent[b]
  }
  return { simple, complex, rag, adversarial, agent, ticks: covered }
}

/**
 * Prompts per second at a time: linear between keyframes, then steady growth, faster again from
 * the endless phase (J-5), times classic mode's spike.
 */
export function arrivalRate(catalog: Catalog, sec: number): number {
  const t = catalog.traffic
  const points = t.ratePoints
  let rate: number
  const last = points[points.length - 1]
  const late = t.lateGrowth.fromSec
  if (sec >= late && late >= last.sec) {
    rate = last.perSec + (t.growthPerMinAfter * (late - last.sec)) / 60 + (t.lateGrowth.perMin * (sec - late)) / 60
  } else if (sec >= last.sec) {
    rate = last.perSec + (t.growthPerMinAfter * (sec - last.sec)) / 60
  } else {
    let i = 0
    while (i < points.length - 2 && sec >= points[i + 1].sec) i++
    const a = points[i]
    const b = points[i + 1]
    rate = a.perSec + ((b.perSec - a.perSec) * (sec - a.sec)) / (b.sec - a.sec)
  }
  if (t.spike !== null && sec >= t.spike.startSec && sec < t.spike.endSec) rate *= t.spike.multiplier
  return rate
}

/** A RAG, adversarial or agent share: 0 until its mix starts, linear to its target, then capped (D41, I-1). */
export function categoryShare(catalog: Catalog, spec: CategorySpec, sec: number): number {
  const from = spec.share.fromSec ?? catalog.traffic.mixFromSec
  if (sec < from) return 0
  return Math.min(spec.share.cap, (spec.share.reaches * (sec - from)) / (spec.share.atSec - from))
}

/** Complex share: rises linearly from its start to its 5:00 value, keeps the same slope, and caps. */
export function complexShare(catalog: Catalog, sec: number): number {
  const c = catalog.traffic.complexShare
  return Math.min(c.cap, c.start + ((c.reaches - c.start) * sec) / c.atSec)
}

/** Step 2 of the tick (D24). */
export function spawnArrivals(world: World): void {
  const meter = world.traffic
  const b = world.tick % meter.simple.length
  meter.simple[b] = 0
  meter.complex[b] = 0
  meter.rag[b] = 0
  meter.adversarial[b] = 0
  meter.agent[b] = 0
  meter.lastTick = world.tick
  const usersIn = world.nodeById[world.usersInId]
  if (usersIn === undefined) return
  const catalog = world.catalog
  const tickSec = catalog.tickMs / 1000
  const sec = world.tick * tickSec
  // The throttle's bucket refills every tick and holds at most 1 s of prompts (D7, D47).
  if (usersIn.throttlePerSec > 0) usersIn.bucket = Math.min(usersIn.throttlePerSec, usersIn.bucket + usersIn.throttlePerSec * tickSec)
  const rng = world.rng.traffic
  const director = catalog.director
  const spike = eventActive(world, 'VIRAL_SPIKE') || eventActive(world, 'TRAFFIC_SURGE') ? world.director.magnitude : 1
  const count = rng.poisson(arrivalRate(catalog, sec) * spike * tickSec)
  if (count === 0) return
  const share = eventActive(world, 'HARD_WAVE') ? director.hardWaveComplexShare : complexShare(catalog, sec)
  // Everything is drawn before the pool is touched, so the traffic stream never depends on the build.
  if (sec < catalog.traffic.mixFromSec) {
    // Chat only, drawn exactly as Milestone 1 drew it, so classic mode replays section G seed for seed.
    for (let i = 0; i < count; i++) spawnArrival(world, usersIn, 'CHAT', rng.chance(share) ? 'COMPLEX' : 'SIMPLE', false)
    return
  }
  const traffic = catalog.traffic
  // A jailbreak wave takes its attacks from chat; RAG and agents keep their shares.
  const adversarial = eventActive(world, 'JAILBREAK') ? director.jailbreakShare : categoryShare(catalog, traffic.adversarial, sec)
  const rag = categoryShare(catalog, traffic.rag, sec)
  // 0 before 5:00, so phase 2 draws exactly what it drew before agents existed.
  const agent = categoryShare(catalog, traffic.agent, sec)
  for (let i = 0; i < count; i++) {
    const u = rng.float()
    if (u < adversarial) spawnArrival(world, usersIn, 'ADVERSARIAL', 'SIMPLE', false)
    else if (u < adversarial + rag) spawnArrival(world, usersIn, 'RAG_QUERY', 'COMPLEX', rng.chance(traffic.piiShare))
    else if (u < adversarial + rag + agent) {
      const plan = drawToolPlan(catalog, rng.float())
      spawnArrival(world, usersIn, 'AGENT_TASK', 'COMPLEX', rng.chance(traffic.piiShare), plan)
    } else {
      const difficulty: Difficulty = rng.chance(share) ? 'COMPLEX' : 'SIMPLE'
      spawnArrival(world, usersIn, 'CHAT', difficulty, rng.chance(traffic.piiShare))
    }
  }
}

/** The tool plan (Tool bits) for a roll in [0, 1), by the agent tool mix (I-1). */
export function drawToolPlan(catalog: Catalog, roll: number): number {
  const mix = catalog.traffic.agent.toolMix
  let acc = 0
  for (const entry of mix) {
    acc += entry.share
    if (roll < acc) return entry.plan
  }
  return mix[mix.length - 1].plan
}

function clock(sec: number): string {
  const s = Math.round(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The next scheduled change in traffic the player is told about, or null. */
export function upcoming(catalog: Catalog, sec: number): { atSec: number; text: string } | null {
  const spike = catalog.traffic.spike
  const candidates: { atSec: number; text: string }[] = []
  if (spike !== null && sec < spike.startSec) {
    candidates.push({
      atSec: spike.startSec,
      text: `A traffic spike hits at ${clock(spike.startSec)}: ×${spike.multiplier} for ${spike.endSec - spike.startSec} s.`,
    })
  }
  for (const phase of catalog.phases) {
    if (phase.startSec > sec) candidates.push({ atSec: phase.startSec, text: `${phase.name} starts at ${clock(phase.startSec)}.` })
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.atSec - b.atSec)
  return candidates[0]
}
