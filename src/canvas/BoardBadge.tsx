/*
 * A board badge (iso badge()): a small opaque tag above something on the
 * board, with a 6 px leader down to it. An alarm badge has a red octagon, a
 * warning an amber triangle, and a note a dim dot, so the kind never rests on
 * colour alone.
 *
 * Badges are plain DOM over the canvas, written in place from useFrame:
 * `showBadge` sets the text, kind and position without React re-rendering.
 * A badge for a moment (rather than a lasting state) rises into place once
 * when it appears; reduced motion turns that off in CSS.
 */

import type { Ref } from 'react'

export type BadgeKind = 'alarm' | 'warn' | 'info'

/** The visible board area, screen px: the HUD paints over everything outside it. */
export interface BadgeBounds {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

/**
 * Keeps a badge box of `w` × `h` inside `bounds`, given the foot of its leader at (sx, sy).
 * The box hangs above the foot (translate(-50%, -100%)), so it spans sx ± w/2 and sy − h to sy.
 * A box wider or taller than the area parks at the area's left or top rather than overshooting.
 */
export function clampBadge(sx: number, sy: number, w: number, h: number, bounds: BadgeBounds): [number, number] {
  const lo = bounds.left + w / 2
  const hi = bounds.right - w / 2
  const top = bounds.top + h
  return [Math.min(Math.max(sx, lo), Math.max(lo, hi)), Math.min(Math.max(sy, top), Math.max(top, bounds.bottom))]
}

export function BoardBadgeElement({ elRef }: { elRef: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={elRef}
      hidden
      data-kind="info"
      className="group absolute top-0 left-0 flex flex-col items-center whitespace-nowrap select-none"
      style={{ transform: 'translate(-9999px, -9999px)' }}
    >
      <div data-body className="flex min-h-[18px] max-w-[240px] items-center gap-[6px] rounded-badge border border-ink-dim bg-panel pr-[7px] pl-[5px] text-[11px] leading-[14px] text-ink group-data-[kind=alarm]:border-alarm group-data-[kind=warn]:border-warn">
        <svg width="10" height="10" viewBox="0 0 10 10" className="block flex-none" aria-hidden>
          <polygon className="hidden fill-alarm group-data-[kind=alarm]:block" points="3.1,0.4 6.9,0.4 9.6,3.1 9.6,6.9 6.9,9.6 3.1,9.6 0.4,6.9 0.4,3.1" />
          <polygon className="hidden fill-warn group-data-[kind=warn]:block" points="5,0.4 9.8,9.2 0.2,9.2" />
          <circle className="hidden fill-ink-dim group-data-[kind=info]:block" cx="5" cy="5" r="2.6" />
        </svg>
        <span data-text className="py-[2px] whitespace-normal" />
      </div>
      <div className="h-[6px] w-px bg-ink-dim group-data-[kind=alarm]:bg-alarm group-data-[kind=warn]:bg-warn" />
    </div>
  )
}

/**
 * Shows a badge with its leader's foot at screen point (sx, sy), or hides it when text is null.
 * `rise`, in px, makes a newly shown (or newly worded) badge rise that far into place.
 * With `bounds`, the badge stays inside the visible board area instead of sliding under the HUD.
 */
export function showBadge(
  el: HTMLDivElement | null,
  text: string | null,
  kind: BadgeKind,
  sx: number,
  sy: number,
  rise = 0,
  bounds?: BadgeBounds,
): void {
  if (el === null) return
  if (text === null) {
    if (!el.hidden) el.hidden = true
    return
  }
  const span = el.querySelector<HTMLSpanElement>('span[data-text]')
  const fresh = el.hidden || (span !== null && span.textContent !== text)
  if (el.hidden) el.hidden = false
  if (el.dataset.kind !== kind) el.dataset.kind = kind
  if (span !== null && span.textContent !== text) span.textContent = text
  if (fresh) {
    const body = el.firstElementChild
    if (body instanceof HTMLElement) {
      body.classList.remove('badge-rise')
      if (rise > 0) {
        body.style.setProperty('--rise', `${rise}px`)
        // Restart the animation: a reflow between removing and re-adding the class.
        void body.offsetWidth
        body.classList.add('badge-rise')
      }
    }
  }
  // Measured after the text is in: a badge is as wide as its words.
  const [x, y] = bounds === undefined ? [sx, sy] : clampBadge(sx, sy, el.offsetWidth, el.offsetHeight, bounds)
  el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`
}
