/*
 * A tooltip from the HUD language: a raised box with a hairline and a small
 * pointer, shown above its target on hover and on keyboard focus within it.
 */

import { useId, type ReactNode } from 'react'

export interface TooltipProps {
  readonly text: string
  readonly children: ReactNode
  /** Stretch the wrapper to its parent's width (for full-width buttons). */
  readonly block?: boolean
  readonly className?: string
}

export function Tooltip({ text, children, block = false, className = '' }: TooltipProps) {
  const id = useId()
  return (
    <span className={`group relative ${block ? 'flex' : 'inline-flex'} ${className}`} aria-describedby={id}>
      {children}
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-[calc(100%+8px)] left-1/2 z-20 flex -translate-x-1/2 flex-col items-center group-focus-within:visible group-hover:visible"
      >
        <span className="rounded-control border border-hairline bg-panel-raised px-2 py-1.5 text-label font-normal whitespace-nowrap text-ink">
          {text}
        </span>
        <svg width="12" height="6" viewBox="0 0 12 6" className="-mt-px block" aria-hidden>
          <polygon points="0,0 12,0 6,6" fill="var(--panel-raised)" stroke="var(--hairline)" />
          <line x1="0.5" y1="0" x2="11.5" y2="0" stroke="var(--panel-raised)" strokeWidth="1.5" />
        </svg>
      </span>
    </span>
  )
}
