/*
 * The incident director (D48): one event at a time, announced 10 s ahead,
 * picked by phase weights, never the same kind twice in a row. It draws on
 * its own RNG stream, so a seed gives the same events whatever the build.
 * Step 5 of the tick (D24) advances it; the wave director and the models
 * read its active effect from the next tick on. From 9:00 it adds phase 4's
 * chaos and comes faster every minute (J-4, J-5).
 */

import { DIRECTOR_EVENT_KINDS, ticksPerSecond, type Catalog, type DirectorEventKind } from './catalog'
import { pushIncident } from './events'
import type { Rng } from './rng'
import { addMarker } from './runLog'
import type { World } from './world'

export type DirectorStage = 'waiting' | 'announced' | 'active'

export interface DirectorState {
  stage: DirectorStage
  /** The event announced or active, or the last one while waiting. */
  kind: DirectorEventKind | null
  announceTick: number
  startTick: number
  endTick: number
  /** A viral spike's or traffic surge's arrival-rate multiplier. */
  magnitude: number
  /** A provider outage's provider, by index (J-4). */
  outageProvider: number
}

/** The phase a time falls in, by index. */
export function phaseIndexAt(catalog: Catalog, sec: number): number {
  let index = 0
  while (index + 1 < catalog.phases.length && sec >= catalog.phases[index + 1].startSec) index++
  return index
}

function byPhase(values: readonly number[], phase: number): number {
  return values[Math.min(phase, values.length - 1)]
}

/** The weight column for a start time: phase 1, phases 2 and 3, or phase 4 on. */
function weightColumn(catalog: Catalog, sec: number): 0 | 1 | 2 {
  const phase = phaseIndexAt(catalog, sec)
  return phase === 0 ? 0 : phase < 3 ? 1 : 2
}

/** The gap factor at a time: by phase, shrinking every minute after 9:00 down to a floor (J-5). */
export function gapFactorAt(catalog: Catalog, sec: number): number {
  const d = catalog.director
  const factor = byPhase(d.phaseFactor, phaseIndexAt(catalog, sec))
  if (sec <= d.late.fromSec) return factor
  return Math.max(d.late.minGapFactor, factor * (1 - d.late.gapDecayPerMin) ** ((sec - d.late.fromSec) / 60))
}

/** A viral spike's k at a time: by phase, plus the endless phase's growth (J-5). */
export function spikeKAt(catalog: Catalog, sec: number): number {
  const d = catalog.director
  const k = byPhase(d.spike.k, phaseIndexAt(catalog, sec))
  if (sec < d.late.fromSec) return k
  return k + d.late.kAdd * Math.floor((sec - d.late.fromSec) / d.late.kEverySec)
}

/** An outage's length: its drawn duration, plus its growth past 9:00, capped (J-4). */
export function outageSecAt(catalog: Catalog, drawnSec: number, startSec: number): number {
  const o = catalog.director.outage
  const late = Math.max(0, startSec - catalog.director.late.fromSec)
  return Math.min(o.maxSec, drawnSec + o.growSec * Math.floor(late / o.growEverySec))
}

/** The first announcement, drawn on the director's own stream. Never, when the director is off. */
export function createDirector(catalog: Catalog, rng: Rng): DirectorState {
  const d = catalog.director
  const tps = ticksPerSecond(catalog)
  const first = rng.uniform(d.firstAnnounceSec[0], d.firstAnnounceSec[1])
  return {
    stage: 'waiting',
    kind: null,
    announceTick: d.enabled ? Math.round(first * tps) : Infinity,
    startTick: Infinity,
    endTick: Infinity,
    magnitude: 1,
    outageProvider: -1,
  }
}

/** Picks the next kind by weight for the phase it starts in, skipping the last kind and any too early. */
export function pickEventKind(catalog: Catalog, roll: number, startSec: number, last: DirectorEventKind | null): DirectorEventKind {
  const column = weightColumn(catalog, startSec)
  const events = catalog.director.events
  let total = 0
  for (const kind of DIRECTOR_EVENT_KINDS) {
    if (kind !== last && startSec >= events[kind].notBeforeSec) total += events[kind].weights[column]
  }
  let target = roll * total
  let pick: DirectorEventKind = 'VIRAL_SPIKE'
  for (const kind of DIRECTOR_EVENT_KINDS) {
    if (kind === last || startSec < events[kind].notBeforeSec) continue
    const w = events[kind].weights[column]
    if (w <= 0) continue
    pick = kind
    if (target < w) break
    target -= w
  }
  return pick
}

function durationSec(d: DirectorState, catalog: Catalog): number {
  return (d.endTick - d.startTick) / ticksPerSecond(catalog)
}

/** What the event does, in a sentence: "Traffic ×1.8 for 20 s." */
export function eventEffectText(d: DirectorState, catalog: Catalog, providerName = ''): string {
  const dir = catalog.director
  const secs = Math.round(durationSec(d, catalog))
  switch (d.kind) {
    case 'VIRAL_SPIKE':
    case 'TRAFFIC_SURGE':
      return `Traffic ×${d.magnitude.toFixed(1)} for ${secs} s.`
    case 'HARD_WAVE':
      return `${Math.round(dir.hardWaveComplexShare * 100)}% of chats complex for ${secs} s.`
    case 'SLOWDOWN':
      return `Frontier calls take ×${dir.slowdownMultiplier} as long for ${secs} s.`
    case 'CACHE_WIPE':
      return 'Every semantic cache starts cold.'
    case 'JAILBREAK':
      return `${Math.round(dir.jailbreakShare * 100)}% of prompts are attacks for ${secs} s.`
    case 'OUTAGE':
      return `Frontier ${providerName} is down for ${secs} s. Every call to it fails.`
    case 'CACHE_INVALIDATION':
      return 'Every semantic cache and prefix cache starts cold.'
    case 'DRIFT_SURGE':
      return `Every vector DB's drift jumps by ${dir.driftSurge.add.toFixed(2)} until it's next indexed.`
    default:
      return ''
  }
}

function providerNameOf(world: World, d: DirectorState): string {
  return world.providers[d.outageProvider]?.name ?? ''
}

function announce(world: World): void {
  const d = world.director
  const catalog = world.catalog
  const dir = catalog.director
  const rng = world.rng.director
  const tps = ticksPerSecond(catalog)
  // Three draws every time, so the stream never depends on which kind came up.
  const kindRoll = rng.float()
  const durationRoll = rng.float()
  const sizeRoll = rng.float()
  d.startTick = d.announceTick + Math.round(dir.leadSec * tps)
  const startSec = d.startTick / tps
  if (startSec >= dir.quietFromSec) {
    // The drill's quiet hours: nothing more is announced.
    d.announceTick = Infinity
    d.startTick = Infinity
    return
  }
  const kind = pickEventKind(catalog, kindRoll, startSec, d.kind)
  const [lo, hi] = dir.events[kind].durationSec
  let seconds = lo + (hi - lo) * durationRoll
  if (kind === 'OUTAGE') seconds = outageSecAt(catalog, seconds, startSec)
  d.kind = kind
  d.endTick = d.startTick + Math.round(seconds * tps)
  if (kind === 'TRAFFIC_SURGE') {
    d.magnitude = dir.surge.range[0] + (dir.surge.range[1] - dir.surge.range[0]) * sizeRoll
  } else {
    const [a, b] = dir.spike.range
    d.magnitude = 1 + (a + (b - a) * sizeRoll) * spikeKAt(catalog, startSec)
  }
  // The provider comes from the size draw, never from the build (J-4).
  d.outageProvider = kind === 'OUTAGE' ? (sizeRoll < dir.outage.firstProviderShare ? 0 : 1) : -1
  d.stage = 'announced'
  pushIncident(world, 'warn', `${dir.events[kind].name} in ${dir.leadSec} s: ${lowerFirst(eventEffectText(d, catalog, providerNameOf(world, d)))}`, null)
}

/** "Traffic ×1.8 …" reads "traffic ×1.8 …" after a colon; Frontier and Every stay as they are. */
function lowerFirst(text: string): string {
  return text.startsWith('Frontier') ? text : text.charAt(0).toLowerCase() + text.slice(1)
}

function start(world: World): void {
  const d = world.director
  d.stage = 'active'
  addMarker(world, 'EVENT', world.catalog.director.events[d.kind ?? 'VIRAL_SPIKE'].name.toLowerCase())
  if (d.kind === 'VIRAL_SPIKE' || d.kind === 'TRAFFIC_SURGE') world.runLog.surges.push({ startTick: d.startTick, endTick: d.endTick })
  if (d.kind === 'CACHE_WIPE' || d.kind === 'CACHE_INVALIDATION') {
    for (let i = 0; i < world.nodes.length; i++) if (world.nodes[i].type === 'SEMANTIC_CACHE') world.nodes[i].lookups = 0
  }
  if (d.kind === 'CACHE_INVALIDATION') {
    // Every prefix cache too (D5): the shared system prompt and every run's context go cold.
    for (let i = 0; i < world.nodes.length; i++) {
      const node = world.nodes[i]
      node.prefixWarmUntilTick = -1
      node.prefixWipedTick = world.tick
    }
  }
  if (d.kind === 'DRIFT_SURGE') {
    const surge = world.catalog.director.driftSurge
    for (let i = 0; i < world.nodes.length; i++) {
      const node = world.nodes[i]
      if (node.type === 'VECTOR_DB') node.driftSurge = Math.min(surge.cap, node.driftSurge + surge.add)
    }
  }
}

function end(world: World): void {
  const d = world.director
  const catalog = world.catalog
  const dir = catalog.director
  const tps = ticksPerSecond(catalog)
  const instant = dir.events[d.kind ?? 'VIRAL_SPIKE'].durationSec[1] === 0
  if (!instant) {
    const name = d.kind === 'OUTAGE' ? `outage at Frontier ${providerNameOf(world, d)}` : dir.events[d.kind ?? 'VIRAL_SPIKE'].name.toLowerCase()
    pushIncident(world, 'info', `The ${name} is over.`, null)
  }
  const gap = world.rng.director.uniform(dir.gapSec[0], dir.gapSec[1]) * gapFactorAt(catalog, d.startTick / tps)
  // Never before this one ends, so events never overlap.
  d.announceTick = Math.max(d.startTick + Math.round(gap * tps), d.endTick)
  d.stage = 'waiting'
}

/** Step 5 of the tick (D24). */
export function updateDirector(world: World): void {
  const d = world.director
  if (d.stage === 'waiting' && world.tick >= d.announceTick) announce(world)
  if (d.stage === 'announced' && world.tick >= d.startTick) start(world)
  if (d.stage === 'active' && world.tick >= d.endTick) end(world)
}

export function eventActive(world: World, kind: DirectorEventKind): boolean {
  const d = world.director
  return d.stage === 'active' && d.kind === kind
}
