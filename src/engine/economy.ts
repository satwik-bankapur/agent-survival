/*
 * Money (D1–D4). Revenue lands at Users out, token cost when a model call
 * completes, upkeep every tick. One-second buckets feed the HUD's rates and
 * the 60 s sparkline.
 */

import { agentRevenue, ticksPerSecond, type Catalog, type ModelSpec, type PrefixCacheSpec } from './catalog'
import type { Packet } from './types'
import type { World } from './world'

export const MONEY_HISTORY_SEC = 60

export interface EconomyState {
  readonly revenue: Float64Array
  readonly tokenSpend: Float64Array
  readonly upkeep: Float64Array
  /** Breach fines (D43). */
  readonly fines: Float64Array
  /** Budget at the start of each second. */
  readonly budgetHistory: Float64Array
  /** Whether "Spending is higher than revenue" has been raised and not yet cleared. */
  spendingAboveRevenue: boolean
}

export function createEconomy(): EconomyState {
  return {
    revenue: new Float64Array(MONEY_HISTORY_SEC),
    tokenSpend: new Float64Array(MONEY_HISTORY_SEC),
    upkeep: new Float64Array(MONEY_HISTORY_SEC),
    fines: new Float64Array(MONEY_HISTORY_SEC),
    budgetHistory: new Float64Array(MONEY_HISTORY_SEC),
    spendingAboveRevenue: false,
  }
}

function bucket(world: World): number {
  return Math.floor(world.tick / ticksPerSecond(world.catalog)) % MONEY_HISTORY_SEC
}

/** Called on the first tick of every second, before anything earns or spends. */
export function beginEconomySecond(world: World): void {
  const b = bucket(world)
  const e = world.economy
  e.revenue[b] = 0
  e.tokenSpend[b] = 0
  e.upkeep[b] = 0
  e.fines[b] = 0
  e.budgetHistory[b] = world.budget
}

export function earn(world: World, amount: number): void {
  world.budget += amount
  world.economy.revenue[bucket(world)] += amount
  world.stats.revenue += amount
}

export function spendTokens(world: World, amount: number): void {
  world.budget -= amount
  world.economy.tokenSpend[bucket(world)] += amount
  world.stats.tokenSpend += amount
}

/** A breach's fine (D43). */
export function chargeFine(world: World, amount: number): void {
  world.budget -= amount
  world.economy.fines[bucket(world)] += amount
  world.stats.fines += amount
}

/** A running cost that isn't tokens or upkeep, such as a human review (D21): counted with upkeep. */
export function chargeOperating(world: World, amount: number): void {
  world.budget -= amount
  world.economy.upkeep[bucket(world)] += amount
  world.stats.upkeep += amount
}

/** Upkeep ÷ 1,200 per 50 ms tick (D2). */
export function chargeUpkeep(world: World): void {
  const amount = world.upkeepPerTick
  if (amount === 0) return
  world.budget -= amount
  world.economy.upkeep[bucket(world)] += amount
  world.stats.upkeep += amount
}

export function upkeepPerTick(catalog: Catalog, upkeepPerMin: number): number {
  return upkeepPerMin / (60 * ticksPerSecond(catalog))
}

export function revenueFor(catalog: Catalog, p: Packet): number {
  switch (p.category) {
    case 'RAG_QUERY':
      return catalog.traffic.rag.revenue
    case 'ADVERSARIAL':
      return catalog.traffic.adversarial.revenue
    case 'AGENT_TASK':
      return agentRevenue(catalog, p.requiredToolSteps)
    default:
      return catalog.traffic.chat[p.difficulty].revenue
  }
}

/** The token counts a model call is priced and timed on. */
export type CallTokens = Pick<Packet, 'newInputTokens' | 'cachedPrefixTokens' | 'outputTokensGenerated'>

/**
 * input tokens ÷ 1,000 × input price + output tokens ÷ 1,000 × output price (section G). With
 * prefix caching on (D5), `readTokens` of the input come from the cache at the read price and the
 * rest is written to it at the write price.
 */
export function modelCallCost(spec: ModelSpec, p: CallTokens, cache: PrefixCacheSpec | null = null, readTokens = 0): number {
  const input = p.newInputTokens + p.cachedPrefixTokens
  const billed = cache === null ? input : readTokens * cache.readMultiplier + (input - readTokens) * cache.writeMultiplier
  return (billed / 1000) * spec.inputPricePer1k + (p.outputTokensGenerated / 1000) * spec.outputPricePer1k
}

/** first token + input ÷ prefill rate + output × time per output token (section G). Cached tokens prefill faster (D5). */
export function modelLatencyMs(spec: ModelSpec, p: CallTokens, cache: PrefixCacheSpec | null = null, readTokens = 0): number {
  const input = p.newInputTokens + p.cachedPrefixTokens
  const prefill = cache === null ? input : input - readTokens + readTokens / cache.prefillSpeedup
  return spec.firstTokenMs + (prefill / spec.prefillTokensPerSec) * 1000 + p.outputTokensGenerated * spec.msPerOutputToken
}

/**
 * How many more dollars a purchase needs, or 0 if it's affordable. A purchase may not take the
 * budget to the game-over line or below (D4).
 */
export function purchaseShortfall(world: World, cost: number): number {
  const after = world.budget - cost
  if (after > world.catalog.budget.gameOverAt) return 0
  return Math.floor(world.catalog.budget.gameOverAt - after) + 1
}

export function refundFor(catalog: Catalog, build: number): number {
  return build * catalog.budget.refundShare
}
