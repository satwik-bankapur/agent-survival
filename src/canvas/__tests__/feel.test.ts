import { describe, expect, it } from 'vitest'

import { FLOAT_INTERVAL_SEC, RevenueCoalescer } from '../MoneyFloats'
import { chooseCoachSpot } from '../CoachMark'
import { blinkOn, congested } from '../thresholds'

describe('money floats', () => {
  it('lets the first landing out at once, then sums the rest into one float per interval', () => {
    const c = new RevenueCoalescer()
    expect(c.take(0)).toBe(0)
    c.add(5)
    expect(c.take(1)).toBe(5)
    c.add(5)
    c.add(5)
    expect(c.take(1 + FLOAT_INTERVAL_SEC / 2)).toBe(0)
    c.add(5)
    expect(c.take(1 + FLOAT_INTERVAL_SEC)).toBe(15)
    expect(c.take(10)).toBe(0)
  })
})

describe('status light thresholds', () => {
  it('calls a queue congested only past 70%', () => {
    expect(congested(44, 64)).toBe(false)
    expect(congested(45, 64)).toBe(true)
    expect(congested(0, 0)).toBe(false)
  })

  it('blinks at the given rate, and holds steady under reduced motion', () => {
    expect(blinkOn(0.1, 1, false)).toBe(true)
    expect(blinkOn(0.8, 1, false)).toBe(false)
    expect(blinkOn(0.4, 2, false)).toBe(false)
    expect(blinkOn(0.8, 1, true)).toBe(true)
  })
})

describe('coach mark placement', () => {
  const screen = { width: 1440, height: 900 }
  it("takes the design's spot, above right of the cloud, when it's clear", () => {
    expect(chooseCoachSpot(600, 400, 300, 140, [], screen)).toEqual({ x: 640, y: 250, side: 'right' })
  })

  it('moves to the left when a plate sits in the way', () => {
    const plate = { x0: 700, y0: 300, x1: 790, y1: 318 }
    expect(chooseCoachSpot(600, 400, 300, 140, [plate], screen)).toEqual({ x: 260, y: 250, side: 'left' })
  })
})
