/*
 * The trust panel's outcome strip: 30 one-second bars, oldest at the left.
 * Each bar is split by share: good at the bottom, then refused (hollow),
 * timed out (amber), and wrong answers users reported (red) at the top.
 * Unreported wrong answers are counted as good by the engine (D10), so
 * nothing here can give one away.
 */

import type { OutcomeBucket } from '../../engine'

export interface StripShares {
  readonly good: number
  readonly refused: number
  readonly timedOut: number
  readonly wrong: number
}

/**
 * One bar's shares, in percent. Throttled prompts were turned away rather
 * than answered, so they show with the refusals; every other failure
 * (timeouts, full queues, no route, broken JSON) shows as timed out.
 */
export function stripShares(bucket: OutcomeBucket): StripShares | null {
  const refused = bucket.refused + bucket.throttled
  const total = bucket.good + refused + bucket.failed + bucket.wrongReported
  if (total === 0) return null
  return {
    good: (bucket.good / total) * 100,
    refused: (refused / total) * 100,
    timedOut: (bucket.failed / total) * 100,
    wrong: (bucket.wrongReported / total) * 100,
  }
}

export function OutcomeStrip({ strip }: { readonly strip: readonly OutcomeBucket[] }) {
  return (
    <div className="flex h-7 items-stretch gap-px" aria-hidden>
      {strip.map((bucket, i) => {
        const s = stripShares(bucket)
        return (
          <div key={i} className="flex flex-1 flex-col-reverse">
            {s === null ? (
              <div className="h-px bg-hairline" />
            ) : (
              <>
                <div className="bg-ink-dim" style={{ height: `${s.good}%` }} />
                {s.refused > 0 && <div className="border border-b-0 border-ink-faint" style={{ height: `${s.refused}%` }} />}
                {s.timedOut > 0 && <div className="bg-warn" style={{ height: `${s.timedOut}%` }} />}
                {s.wrong > 0 && <div className="bg-alarm" style={{ height: `${s.wrong}%` }} />}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
