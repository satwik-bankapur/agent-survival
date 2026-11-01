/*
 * Trust (D8, D9): a weighted success ratio over about the last 30 seconds.
 * S and N start at the prior, both decay every tick, and each outcome adds
 * its score to S and 1 to N. Trust = clamp(S ÷ N, 0, 1) × 100.
 */

import { ticksPerSecond, type Catalog } from './catalog'
import type { OutcomeKind } from './types'
import type { World } from './world'

export const STRIP_SECONDS = 30

/** Columns of the outcome strip, per one-second bucket. */
export const StripColumn = { GOOD: 0, THROTTLED: 1, REFUSED: 2, FAILED: 3, WRONG_REPORTED: 4 } as const
export const STRIP_COLUMNS = 5

export interface TrustState {
  s: number
  n: number
  /** Per-tick decay factor, exp(−tick ÷ window). */
  readonly decay: number
  /** Consecutive ticks below the critical line (D9). */
  criticalTicks: number
  readonly criticalLimitTicks: number
  /** STRIP_SECONDS buckets × STRIP_COLUMNS counts. */
  readonly strip: Int32Array
}

export function createTrust(catalog: Catalog): TrustState {
  const tickSec = catalog.tickMs / 1000
  return {
    s: catalog.trust.prior,
    n: catalog.trust.prior,
    decay: Math.exp(-tickSec / catalog.trust.windowSec),
    criticalTicks: 0,
    criticalLimitTicks: Math.round(catalog.trust.criticalSec * ticksPerSecond(catalog)),
    strip: new Int32Array(STRIP_SECONDS * STRIP_COLUMNS),
  }
}

export function trustValue(t: TrustState): number {
  const ratio = t.n > 0 ? t.s / t.n : 1
  return Math.min(1, Math.max(0, ratio)) * 100
}

function stripBase(world: World): number {
  return (Math.floor(world.tick / ticksPerSecond(world.catalog)) % STRIP_SECONDS) * STRIP_COLUMNS
}

/** Called on the first tick of every second. */
export function beginTrustSecond(world: World): void {
  const base = stripBase(world)
  world.trust.strip.fill(0, base, base + STRIP_COLUMNS)
}

function stripColumn(kind: OutcomeKind): number {
  switch (kind) {
    case 'GOOD':
      return StripColumn.GOOD
    case 'THROTTLED':
      return StripColumn.THROTTLED
    case 'REFUSED':
      return StripColumn.REFUSED
    case 'FAILED':
    case 'BREACH':
      // The strip has the design's four kinds; a breach reads as a failure there.
      return StripColumn.FAILED
    case 'WRONG':
      return StripColumn.WRONG_REPORTED
  }
}

export function recordOutcome(world: World, kind: OutcomeKind): void {
  const t = world.trust
  t.s += world.catalog.trust.score[kind]
  t.n += 1
  t.strip[stripBase(world) + stripColumn(kind)]++
}

/**
 * A complaint about an answer that already counted as good at exit (D10). It corrects that
 * outcome to a wrong answer: S moves by (wrong − good) and N stays, so the prompt nets one
 * −14 outcome, exactly as if it had been known at exit.
 */
export function correctToWrong(world: World): void {
  const score = world.catalog.trust.score
  world.trust.s += score.WRONG - score.GOOD
  world.trust.strip[stripBase(world) + StripColumn.WRONG_REPORTED]++
}

export function decayTrust(t: TrustState): void {
  t.s *= t.decay
  t.n *= t.decay
}

/** Advances the D9 critical timer. True once trust has been critical long enough to end the run. */
export function updateCritical(world: World): boolean {
  const t = world.trust
  if (trustValue(t) < world.catalog.trust.criticalBelow) t.criticalTicks++
  else t.criticalTicks = 0
  return t.criticalTicks >= t.criticalLimitTicks
}

/** Wrong answers reported in the last STRIP_SECONDS seconds. */
export function recentWrongReports(t: TrustState): number {
  let total = 0
  for (let i = 0; i < STRIP_SECONDS; i++) total += t.strip[i * STRIP_COLUMNS + StripColumn.WRONG_REPORTED]
  return total
}
