import { describe, expect, it } from 'vitest'

import { stripShares } from '../ui/OutcomeStrip'

const empty = { good: 0, throttled: 0, refused: 0, failed: 0, wrongReported: 0 }

describe('stripShares', () => {
  it('splits a second into shares that add up to 100%', () => {
    const s = stripShares({ ...empty, good: 6, refused: 1, throttled: 1, failed: 1, wrongReported: 1 })
    expect(s).toEqual({ good: 60, refused: 20, timedOut: 10, wrong: 10 })
  })

  it('shows throttled prompts with the refusals, since they were turned away', () => {
    expect(stripShares({ ...empty, throttled: 2 })?.refused).toBe(100)
  })

  it('draws nothing for a second with no outcomes', () => {
    expect(stripShares(empty)).toBeNull()
  })
})
