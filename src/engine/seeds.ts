/*
 * Seeds the player sees. Runs use 24-bit seeds, shown as six hex digits
 * ("A7F3-29", formatted in the HUD). The daily outage seed comes from the
 * date, so everyone plays the same run that day; the date is passed in,
 * because the engine never reads a clock (D23).
 */

/** Seeds fit in 24 bits, so they print as six hex digits. */
export const SEED_MASK = 0xffffff

/** The seed for a calendar day, from its "YYYY-MM-DD" text: FNV-1a, folded to 24 bits. */
export function dailySeed(day: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < day.length; i++) {
    h ^= day.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return ((h >>> 24) ^ h) & SEED_MASK
}
