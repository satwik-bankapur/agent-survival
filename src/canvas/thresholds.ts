/*
 * When the board starts to warn. Shared, so a node's status light and the
 * amber core of the tubes feeding it always agree (design: "Node states",
 * "Congested").
 */

/** A queue past this share of its capacity is congested: its tubes glow amber and its light blinks amber. */
export const CONGESTED_AT = 0.7

/** Status lights blink at 1 Hz for warnings and 2 Hz for alarms, unless motion is reduced. */
export const BLINK_HZ = { warn: 1, alarm: 2 } as const
/** The share of each blink period the light is lit. */
export const BLINK_DUTY = 0.6

/** Is a blinking light lit at this moment? Steady when motion is reduced. */
export function blinkOn(timeSec: number, hz: number, reduced: boolean): boolean {
  if (reduced) return true
  const phase = (timeSec * hz) % 1
  return phase < BLINK_DUTY
}

export function congested(queueLength: number, queueCapacity: number): boolean {
  return queueCapacity > 0 && queueLength / queueCapacity > CONGESTED_AT
}
