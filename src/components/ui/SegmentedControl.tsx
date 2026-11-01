/*
 * A row of joined buttons, one of them on. The active one is reverse video
 * (ink fill, panel text), as everywhere in the HUD.
 */

import type { ReactNode } from 'react'

export interface Segment<K extends string | number> {
  readonly key: K
  readonly label: ReactNode
  readonly title: string
}

export interface SegmentedControlProps<K extends string | number> {
  readonly segments: readonly Segment<K>[]
  readonly value: K
  readonly onChange: (key: K) => void
  readonly label: string
}

export function SegmentedControl<K extends string | number>({ segments, value, onChange, label }: SegmentedControlProps<K>) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-none overflow-hidden rounded-control border border-hairline">
      {segments.map((segment, i) => {
        const on = segment.key === value
        return (
          <button
            key={segment.key}
            type="button"
            role="radio"
            aria-checked={on}
            title={segment.title}
            onClick={() => onChange(segment.key)}
            className={`type-num flex h-8 min-w-10 cursor-pointer items-center justify-center gap-1.5 px-2.5 text-label ${
              i > 0 ? 'border-l border-hairline' : ''
            } ${on ? 'bg-ink text-panel' : 'bg-panel text-ink hover:bg-panel-raised'}`}
          >
            {segment.label}
          </button>
        )
      })}
    </div>
  )
}
