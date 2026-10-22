import { describe, expect, it } from 'vitest'

import { deriveSeed, Rng } from '../rng'

function draws(rng: Rng, n: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(rng.float())
  return out
}

describe('Rng (D23)', () => {
  it('gives the same sequence for the same seed', () => {
    expect(draws(new Rng(42), 1000)).toEqual(draws(new Rng(42), 1000))
  })

  it('gives different sequences for different seeds', () => {
    expect(draws(new Rng(1), 10)).not.toEqual(draws(new Rng(2), 10))
  })

  it('matches the reference mulberry32 output', () => {
    // First three draws of mulberry32 seeded with 1.
    const rng = new Rng(1)
    expect(rng.float()).toBeCloseTo(0.6270739405881613, 15)
    expect(rng.float()).toBeCloseTo(0.002735721180215478, 15)
    expect(rng.float()).toBeCloseTo(0.5274470399599522, 15)
  })

  it('keeps floats in [0, 1) and ints inside their bounds', () => {
    const rng = new Rng(7)
    for (let i = 0; i < 10_000; i++) {
      const f = rng.float()
      expect(f).toBeGreaterThanOrEqual(0)
      expect(f).toBeLessThan(1)
      const n = rng.int(3, 5)
      expect([3, 4, 5]).toContain(n)
      const u = rng.uniform(5, 15)
      expect(u).toBeGreaterThanOrEqual(5)
      expect(u).toBeLessThan(15)
    }
  })

  it('hits a chance at its rate', () => {
    const rng = new Rng(9)
    let hits = 0
    for (let i = 0; i < 100_000; i++) if (rng.chance(0.3)) hits++
    expect(hits / 100_000).toBeCloseTo(0.3, 2)
  })

  it.each([0.15, 1.2, 75])('draws Poisson counts with mean and variance %s', (lambda) => {
    const rng = new Rng(11)
    const n = 40_000
    let sum = 0
    let sumSq = 0
    for (let i = 0; i < n; i++) {
      const k = rng.poisson(lambda)
      sum += k
      sumSq += k * k
    }
    const mean = sum / n
    const variance = sumSq / n - mean * mean
    expect(Math.abs(mean - lambda) / lambda).toBeLessThan(0.03)
    expect(Math.abs(variance - lambda) / lambda).toBeLessThan(0.05)
  })

  it('derives distinct, stable stream seeds', () => {
    expect(deriveSeed(5, 1)).toBe(deriveSeed(5, 1))
    expect(new Set([deriveSeed(5, 1), deriveSeed(5, 2), deriveSeed(5, 3), deriveSeed(6, 1)]).size).toBe(4)
  })
})
