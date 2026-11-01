/*
 * Badges stay inside the board area the HUD leaves, whatever the camera does
 * with the node they hang over.
 */

import { describe, expect, it } from 'vitest'

import { clampBadge, type BadgeBounds } from '../BoardBadge'

/** A 1440 × 900 window with the full-size rails, top bar and toolbar. */
const BOUNDS: BadgeBounds = { left: 248, right: 1440 - 272, top: 56, bottom: 900 - 152 }

describe('clampBadge', () => {
  it('leaves a badge over the middle of the board where it is', () => {
    expect(clampBadge(700, 400, 160, 30, BOUNDS)).toEqual([700, 400])
  })

  it('keeps a badge out from under the right rail', () => {
    const [x] = clampBadge(1200, 400, 160, 30, BOUNDS)
    expect(x + 80).toBeLessThanOrEqual(BOUNDS.right)
  })

  it('keeps a badge out from under the left rail and the toolbar', () => {
    const [x, y] = clampBadge(100, 800, 160, 30, BOUNDS)
    expect(x - 80).toBeGreaterThanOrEqual(BOUNDS.left)
    expect(y).toBeLessThanOrEqual(BOUNDS.bottom)
  })

  it('keeps the whole badge below the top bar, not just its leader', () => {
    const [, y] = clampBadge(700, 60, 160, 30, BOUNDS)
    expect(y - 30).toBeGreaterThanOrEqual(BOUNDS.top)
  })

  it('parks a badge wider than the board area at the left edge rather than overshooting', () => {
    const [x] = clampBadge(700, 400, 2000, 30, BOUNDS)
    expect(x).toBe(BOUNDS.left + 1000)
  })
})
