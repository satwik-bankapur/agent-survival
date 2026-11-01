/*
 * The 60-second budget sparkline with the dashed bankruptcy line. Seconds
 * sit on a fixed 60-slot axis, so at the start of a run the line grows in
 * from the right instead of stretching.
 */

import { formatWholeMoney } from '../format'

const SLOTS = 60
const HEIGHT = 32

export interface SparklineProps {
  /** Oldest first, one value per second, up to 60. */
  readonly values: readonly number[]
  /** The bankruptcy line, −$1,000. */
  readonly floor: number
  /** Drawing width in px: the rail's inner width, so the label isn't stretched. */
  readonly width: number
}

export function Sparkline({ values, floor, width }: SparklineProps) {
  let hi = -Infinity
  let lo = floor - 100
  for (const v of values) {
    if (v > hi) hi = v
    if (v < lo) lo = v
  }
  hi = Math.max(hi * 1.04 + 50, lo + 100)
  const y = (v: number) => HEIGHT - 1 - ((v - lo) / (hi - lo)) * (HEIGHT - 2)
  const first = SLOTS - values.length
  const points = values.map((v, i) => `${(((first + i) / (SLOTS - 1)) * width).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const floorY = y(floor)
  return (
    <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} className="block overflow-visible" aria-hidden>
      <line x1="0" y1={floorY} x2={width} y2={floorY} stroke="var(--alarm)" strokeWidth="1" strokeDasharray="3 3" />
      {values.length > 1 && <polyline points={points} fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinejoin="round" />}
      <text x={width} y={floorY - 3} textAnchor="end" fontFamily="B612" fontSize="10" fill="var(--alarm)">
        Bankrupt, {formatWholeMoney(floor)}
      </text>
    </svg>
  )
}
