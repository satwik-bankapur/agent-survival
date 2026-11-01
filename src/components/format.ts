/*
 * How the HUD writes numbers. Pure functions, so every live readout keeps
 * one fixed shape per value range and B612 Mono never shifts at 4 Hz.
 * Negative amounts use a true minus sign (U+2212), never a hyphen.
 */

export const MINUS = '\u2212'

const dollars = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const wholeDollars = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/** A budget: "$1,284.50", "−$12.00". */
export function formatMoney(value: number): string {
  const rounded = Math.round(value * 100) / 100
  const text = dollars.format(Math.abs(rounded))
  return rounded < 0 ? `${MINUS}$${text}` : `$${text}`
}

/** A whole-dollar amount: "$55", "−$1,000". */
export function formatWholeMoney(value: number): string {
  const rounded = Math.round(value)
  const text = wholeDollars.format(Math.abs(rounded))
  return rounded < 0 ? `${MINUS}$${text}` : `$${text}`
}

/** A price in prose (the field guide and the tutorial): whole dollars when it's whole, cents when it isn't. */
export function formatPrice(value: number): string {
  return Number.isInteger(value) ? formatWholeMoney(value) : formatMoney(value)
}

/** A money rate with its sign: "+$2.10/s", "−$12.82/s", and "$0.00/s" when it rounds to nothing. */
export function formatRate(perSec: number): string {
  const rounded = Math.round(perSec * 100) / 100
  if (rounded === 0) return '$0.00/s'
  return `${rounded > 0 ? '+' : MINUS}$${dollars.format(Math.abs(rounded))}/s`
}

/** A countdown: "43s", "4m 43s", "1h 5m". */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

/** Trust: "87.4%", and "100%" at the top. */
export function formatTrust(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return rounded >= 100 ? '100%' : `${Math.max(0, rounded).toFixed(1)}%`
}

/** A share of 0–1 as a whole percentage: "76%". */
export function formatShare(share: number): string {
  return `${Math.round(share * 100)}%`
}

/** The Traffic panel's mix, in the order the bar draws it. */
export type MixCategory = 'chat' | 'complex' | 'rag' | 'agent' | 'adv'

/**
 * Splits the snapshot's traffic into the mix bar's five kinds. Arrivals are counted by difficulty
 * with RAG questions and agent tasks as complex and attacks as simple (D41), so chat is what's left of each.
 */
export function trafficMix(traffic: {
  readonly simpleShare: number
  readonly complexShare: number
  readonly categoryShare: { readonly RAG_QUERY: number; readonly AGENT_TASK: number; readonly ADVERSARIAL: number }
}): { readonly category: MixCategory; readonly share: number }[] {
  const rag = traffic.categoryShare.RAG_QUERY
  const agent = traffic.categoryShare.AGENT_TASK
  const adv = traffic.categoryShare.ADVERSARIAL
  return [
    { category: 'chat', share: Math.max(0, traffic.simpleShare - adv) },
    { category: 'complex', share: Math.max(0, traffic.complexShare - rag - agent) },
    { category: 'rag', share: rag },
    { category: 'agent', share: agent },
    { category: 'adv', share: adv },
  ]
}

/** The game clock: "6:12". */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** A phase start on the timeline: "2:00", or "9:00 on" for the last one. */
export function formatPhaseStart(sec: number, last: boolean): string {
  return last ? `${formatClock(sec)} on` : formatClock(sec)
}

/**
 * B612 Mono sets ".", "," and ":" in a full 0.65 em cell with the ink at the
 * left, which reads as "0. 42 s" and "6: 12". Splitting them out lets `Num`
 * tighten just those glyphs by a constant, so digits stay tabular and
 * nothing jitters.
 */
export function splitNumberText(text: string): { text: string; punct: boolean }[] {
  const runs: { text: string; punct: boolean }[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch !== '.' && ch !== ',' && ch !== ':') continue
    if (i > start) runs.push({ text: text.slice(start, i), punct: false })
    runs.push({ text: ch, punct: true })
    start = i + 1
  }
  if (start < text.length) runs.push({ text: text.slice(start), punct: false })
  return runs
}

/** A 24-bit seed as six hex digits, "A7F3-29", the way the title and postmortem show it. */
export function formatSeed(seed: number): string {
  const hex = (seed & 0xffffff).toString(16).toUpperCase().padStart(6, '0')
  return `${hex.slice(0, 4)}-${hex.slice(4)}`
}

/** Reads a seed back from "A7F3-29" (the dash optional), or null. */
export function parseSeed(text: string): number | null {
  const hex = text.trim().replace('-', '')
  return /^[0-9a-fA-F]{6}$/.test(hex) ? Number.parseInt(hex, 16) : null
}

/** A token count, short: "940", "48.2K", "3.2M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 2 : 1)}K`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** A run number on the postmortem: "0042". */
export function formatRunNumber(n: number): string {
  return String(n).padStart(4, '0')
}

/**
 * What a hosted model shares with another on its provider (D14): "Same provider as Frontier A:
 * shares its rate limit", naming the lowest-numbered other node on that provider, or null when
 * there is none. `selfId` is the node being described, or null for one not placed yet.
 */
export function sharedProviderNote(
  nodes: readonly { readonly id: number; readonly label: string; readonly provider: string | null }[],
  provider: string | null,
  selfId: number | null,
): string | null {
  if (provider === null) return null
  let sibling: { readonly id: number; readonly label: string } | undefined
  for (const n of nodes) {
    if (n.provider !== provider || n.id === selfId) continue
    if (sibling === undefined || n.id < sibling.id) sibling = n
  }
  return sibling === undefined ? null : `Same provider as ${sibling.label}: shares its rate limit`
}
