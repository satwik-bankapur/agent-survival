/*
 * A live number in B612 Mono. B612 Mono gives ".", "," and ":" a full-width
 * cell with the ink at the left, so "0.42 s" would read "0. 42 s". Num
 * tightens just those glyphs by a constant (.num-punct in globals.css). Digits
 * keep their fixed width, so a value never shifts as it updates at 4 Hz.
 */

import { splitNumberText } from '../format'

export interface NumProps {
  readonly children: string
  readonly className?: string
}

export function Num({ children, className = '' }: NumProps) {
  return (
    <span className={`type-num ${className}`}>
      {splitNumberText(children).map((run, i) =>
        run.punct ? (
          <span key={i} className="num-punct">
            {run.text}
          </span>
        ) : (
          run.text
        ),
      )}
    </span>
  )
}
