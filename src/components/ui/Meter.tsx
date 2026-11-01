/*
 * A 4 px meter bar with a label and a mono readout above it. Warning fills
 * amber; alarm fills full with red hatching, so it reads without colour.
 */

import { Num } from './Num'

export type Level = 'ok' | 'warn' | 'alarm'

export const LEVEL_INK: Record<Level, string> = { ok: 'text-ink', warn: 'text-warn', alarm: 'text-alarm' }

const FILL: Record<Level, string> = {
  ok: 'var(--ink-dim)',
  warn: 'var(--warn)',
  alarm: 'repeating-linear-gradient(135deg, var(--alarm) 0 3px, transparent 3px 6px)',
}

export interface MeterProps {
  readonly label: string
  readonly value: string
  /** 0 to 1. */
  readonly fraction: number
  readonly level?: Level
}

export function Meter({ label, value, fraction, level = 'ok' }: MeterProps) {
  const pct = level === 'alarm' ? 100 : Math.max(0, Math.min(1, fraction)) * 100
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between gap-2 text-label whitespace-nowrap">
        <span className="min-w-0 truncate text-ink-dim">{label}</span>
        <Num className={`tracking-[-.03em] ${LEVEL_INK[level]}`}>{value}</Num>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-badge border border-hairline bg-panel-raised">
        <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: FILL[level] }} />
      </div>
    </div>
  )
}
