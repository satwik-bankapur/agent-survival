import { describe, expect, it } from 'vitest'

import { budgetAxis, markerRows } from '../PostmortemScreen'

describe('postmortem chart', () => {
  it('splits the budget axis into four whole steps that cover every value', () => {
    expect(budgetAxis([500, 1197.9])).toEqual({ lo: 0, step: 350 })
    expect(budgetAxis([500, -1002.2])).toEqual({ lo: -1400, step: 700 })
    const { lo, step } = budgetAxis([500, 3800])
    expect(lo + 4 * step).toBeGreaterThanOrEqual(3800)
    expect(step % 350).toBe(0)
  })

  it('stacks marker labels so none overlap', () => {
    const rows = markerRows(
      [
        { x: 100, right: false, width: 120 },
        { x: 150, right: false, width: 120 },
        { x: 400, right: false, width: 50 },
        { x: 900, right: true, width: 140 },
        { x: 930, right: true, width: 80 },
      ],
      3,
    )
    expect(rows).toEqual([0, 1, 0, 0, 1])
  })
})
