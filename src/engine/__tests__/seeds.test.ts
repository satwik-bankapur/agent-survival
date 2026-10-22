import { describe, expect, it } from 'vitest'

import { dailySeed, SEED_MASK } from '../seeds'

describe('daily seed', () => {
  it('is the same all day, different the next, and fits in 24 bits', () => {
    expect(dailySeed('2026-10-19')).toBe(dailySeed('2026-10-19'))
    expect(dailySeed('2026-10-19')).not.toBe(dailySeed('2026-10-20'))
    for (const day of ['2026-01-01', '2026-10-19', '2027-12-31']) {
      expect(dailySeed(day)).toBeGreaterThanOrEqual(0)
      expect(dailySeed(day)).toBeLessThanOrEqual(SEED_MASK)
    }
  })
})
