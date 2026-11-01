/*
 * The trust-critical countdown: a red ring that drains over the critical
 * window, with the seconds left in its middle.
 */

const RADIUS = 19
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export interface CountdownRingProps {
  readonly secondsLeft: number
  readonly totalSec: number
}

export function CountdownRing({ secondsLeft, totalSec }: CountdownRingProps) {
  const fraction = totalSec > 0 ? Math.max(0, Math.min(1, secondsLeft / totalSec)) : 0
  const whole = Math.ceil(secondsLeft)
  return (
    <div className="relative size-11 flex-none" title="The run ends if trust stays below 25%" role="timer" aria-label={`Run ends in ${whole} s`}>
      <svg width="44" height="44" viewBox="0 0 44 44" className="block -rotate-90">
        <circle cx="22" cy="22" r={RADIUS} fill="none" stroke="var(--hairline)" strokeWidth="3" />
        <circle
          cx="22"
          cy="22"
          r={RADIUS}
          fill="none"
          stroke="var(--alarm)"
          strokeWidth="3"
          strokeDasharray={`${(CIRCUMFERENCE * fraction).toFixed(1)} ${CIRCUMFERENCE.toFixed(1)}`}
        />
      </svg>
      <div className="type-num absolute inset-0 flex items-center justify-center text-label text-alarm">{whole} s</div>
    </div>
  )
}
