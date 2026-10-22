/*
 * The HUD is built for 1440 × 900 and 1280 × 720. Below the larger one it
 * switches to the compact column widths (216 / 240 / 640) and drops the
 * extras the design drops (the money sparkline, the fourth incident). From
 * 1920 × 900 it takes the wide widths instead, so the HUD grows with the
 * window rather than sitting as a 1440-wide island in the middle of it.
 */

import { useCallback, useSyncExternalStore } from 'react'

function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = window.matchMedia(query)
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false)
}

export function useCompact(): boolean {
  return useMedia('(max-width: 1439px), (max-height: 899px)')
}

/** A window with room to spare: the rails and toolbar take their wide widths rather than leave the HUD an island. */
export function useWide(): boolean {
  return useMedia('(min-width: 1920px) and (min-height: 900px)')
}

/** Too narrow to play: the game gives way to "Best played on a desktop browser". */
export function useNarrow(): boolean {
  return useMedia('(max-width: 1279px)')
}

/** The bottom toolbar's height, px. */
export const TOOLBAR_HEIGHT = 136

export const LAYOUT = {
  inset: 16,
  top: 72,
  wide: { left: 264, right: 288, toolbar: 800 },
  full: { left: 232, right: 256, toolbar: 720 },
  compact: { left: 216, right: 240, toolbar: 640 },
} as const

/** The rail and toolbar widths for a window. */
export interface RailWidths {
  readonly left: number
  readonly right: number
  readonly toolbar: number
}

/** The widths for this window. The board is framed around them (App), so the HUD and App both read it. */
export function useLayout(): RailWidths {
  const compact = useCompact()
  const wide = useWide()
  return wide ? LAYOUT.wide : compact ? LAYOUT.compact : LAYOUT.full
}
