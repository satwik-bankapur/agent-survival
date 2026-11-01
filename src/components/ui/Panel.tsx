/*
 * The HUD panel: opaque, 1 px hairline, radius 6, with its name set into the
 * top border and an optional status at the right (design: "Panel anatomy").
 */

import type { ReactNode } from 'react'

import { HelpDot } from '../HelpPanel'
import { useCompact } from './useCompact'

export interface PanelProps {
  readonly title: string
  /** Right side of the top border: a key hint or status, in dim ink. */
  readonly status?: string
  /** Red border: trust critical. */
  readonly alarm?: boolean
  /** Padding for the incident feed, which runs its rows to the bottom edge. */
  readonly tight?: boolean
  /** A guide entry id: adds the small "?" beside the title (guide.ts). */
  readonly help?: string
  readonly className?: string
  readonly children: ReactNode
}

export function Panel({ title, status, alarm = false, tight = false, help, className = '', children }: PanelProps) {
  const compact = useCompact()
  const padding = tight ? (compact ? '9px 10px 3px' : '10px 12px 4px') : compact ? '10px 10px 9px' : '11px 12px 10px'
  return (
    <section
      aria-label={title}
      className={`relative rounded-panel border border-hairline bg-panel ${className}`}
      style={{ padding }}
    >
      {alarm && <div className="pointer-events-none absolute -inset-px rounded-panel border border-alarm" />}
      <div className="absolute -top-2 right-2 left-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 bg-panel px-1 text-label leading-[14px] font-bold">
          {title}
          {help !== undefined && <HelpDot id={help} label={title.toLowerCase()} />}
        </span>
        {status !== undefined && <span className="bg-panel px-1 text-hint leading-[14px] text-ink-dim">{status}</span>}
      </div>
      {children}
    </section>
  )
}

export interface CellProps {
  readonly label: string
  readonly children: ReactNode
  /** Cells after the first get a hairline on their left. */
  readonly first?: boolean
  readonly className?: string
}

/** Dim label over a value, split from its neighbour by a hairline. */
export function Cell({ label, children, first = false, className = '' }: CellProps) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 ${first ? 'pr-2' : 'border-l border-hairline px-2'} ${className}`}>
      <span className="text-hint text-ink-dim">{label}</span>
      {children}
    </div>
  )
}
