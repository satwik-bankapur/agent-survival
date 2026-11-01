import { describe, expect, it } from 'vitest'

import { PLATE_GAP, PLATE_H, createPlateLayout, plateStat, resolvePlates, type PlateLayout } from '../plateLayout'

function layout(plates: readonly [number, number, number][]): PlateLayout {
  const l = createPlateLayout(plates.length)
  plates.forEach(([x, y, w], i) => {
    l.x[i] = x
    l.y[i] = y
    l.w[i] = w
  })
  return l
}

function overlaps(l: PlateLayout, n: number): number {
  let count = 0
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++) {
      const clearX = Math.abs(l.x[a] - l.x[b]) >= (l.w[a] + l.w[b]) / 2 + PLATE_GAP - 1e-3
      const clearY = Math.abs(l.outY[a] - l.outY[b]) >= PLATE_H + PLATE_GAP - 1e-3
      if (!clearX && !clearY) count++
    }
  return count
}

describe('label plate layout', () => {
  it('leaves plates that already clear each other where they are', () => {
    const l = layout([
      [100, 100, 80],
      [300, 100, 80],
      [100, 200, 80],
    ])
    resolvePlates(l, 3)
    expect(Array.from(l.outY)).toEqual([100, 100, 200])
  })

  it('drops a crowding plate one row below its neighbour', () => {
    // Firewall, redactor and cache on neighbouring tiles: each plate 32 px right and 16 px down.
    const l = layout([
      [400, 300, 110],
      [432, 316, 96],
      [464, 332, 120],
    ])
    resolvePlates(l, 3)
    expect(l.outY[0]).toBe(300)
    expect(l.outY[1]).toBe(300 + PLATE_H + PLATE_GAP)
    expect(overlaps(l, 3)).toBe(0)
  })

  it('never leaves an overlap, even with six plates on adjacent tiles', () => {
    const plates: [number, number, number][] = []
    for (let i = 0; i < 6; i++) plates.push([500 + (i % 3) * 32 - Math.floor(i / 3) * 32, 300 + (i % 3) * 16 + Math.floor(i / 3) * 16, 90 + i * 7])
    const l = layout(plates)
    resolvePlates(l, 6)
    expect(overlaps(l, 6)).toBe(0)
  })

  it('keeps the selected plate in place and moves its neighbour instead', () => {
    const l = layout([
      [400, 300, 110],
      [420, 305, 110],
    ])
    resolvePlates(l, 2, 1)
    expect(l.outY[1]).toBe(305)
    expect(l.outY[0]).toBe(305 + PLATE_H + PLATE_GAP)
  })
})

describe('plate stats', () => {
  it("reads a coordinator's runs, stuck ones named, then the rack's overflow", () => {
    expect(plateStat({ inFlight: 16, max: 16, stuck: 9 }, 0)).toBe('16 of 16 runs, 9 stuck')
    expect(plateStat({ inFlight: 3, max: 16, stuck: 0 }, 0)).toBe('3 of 16 runs')
    expect(plateStat({ inFlight: 16, max: 16, stuck: 2 }, 4)).toBe('16 of 16 runs, 2 stuck +4')
    expect(plateStat(null, 5)).toBe('+5')
    expect(plateStat(null, 0)).toBe('')
    // With a tracer, a queue's length, which already counts the overflow (J-3).
    expect(plateStat(null, 5, { length: 17, capacity: 32 })).toBe('Queue 17 of 32')
    expect(plateStat({ inFlight: 3, max: 16, stuck: 0 }, 0, { length: 2, capacity: 24 })).toBe('3 of 16 runs')
  })
})
