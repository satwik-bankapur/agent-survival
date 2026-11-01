/*
 * Small shape-coded icons. Severity is always a shape as well as a colour
 * (circle, triangle, octagon), and each traffic category has its own
 * capsule silhouette, so colour is never the only signal.
 */

import type { Severity } from '../../engine'

const SEVERITY_SHAPE = {
  info: <circle cx="6" cy="6" r="3" fill="var(--ink-dim)" />,
  warn: <polygon points="6,1 11.5,11 0.5,11" fill="var(--warn)" />,
  alarm: <polygon points="3.5,.5 8.5,.5 11.5,3.5 11.5,8.5 8.5,11.5 3.5,11.5 .5,8.5 .5,3.5" fill="var(--alarm)" />,
} as const

const SEVERITY_NAME: Record<Severity, string> = { info: 'Info', warn: 'Warning', alarm: 'Alarm' }

export function SeverityIcon({ severity, size = 12 }: { readonly severity: Severity; readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" className="block flex-none" role="img" aria-label={SEVERITY_NAME[severity]}>
      {SEVERITY_SHAPE[severity]}
    </svg>
  )
}

/** The outlined warning triangle beside amber readouts (bankrupt-in, trust from 25 to 60%). */
export function WarnTriangle({ size = 14 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" className="block flex-none" aria-hidden>
      <polygon points="7,1.5 13,12.5 1,12.5" fill="none" stroke="var(--warn)" strokeWidth="1.5" strokeLinejoin="round" />
      {size <= 14 && <line x1="7" y1="5.5" x2="7" y2="8.5" stroke="var(--warn)" strokeWidth="1.5" />}
    </svg>
  )
}

/** The filled alarm octagon beside red readouts. */
export function AlarmOctagon({ size = 14 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" className="block flex-none" aria-hidden>
      <polygon points="4.5,1 9.5,1 13,4.5 13,9.5 9.5,13 4.5,13 1,9.5 1,4.5" fill="var(--alarm)" />
    </svg>
  )
}

export type CueCategory = 'chat' | 'complex' | 'rag' | 'agent' | 'adv'

export const CATEGORY_LABEL: Record<CueCategory, string> = {
  chat: 'Simple chat',
  complex: 'Complex chat',
  rag: 'RAG',
  agent: 'Agent',
  adv: 'Adversarial',
}

/** Mix-bar fill per category. Complex chat is the chat colour stepped down, so the two read apart. */
export const CATEGORY_FILL: Record<CueCategory, string> = {
  chat: 'var(--pkt-chat)',
  complex: '#E6D7B8',
  rag: 'var(--pkt-rag)',
  agent: 'var(--pkt-agent)',
  adv: 'var(--pkt-adv)',
}

/** The capsule silhouette for a category: plain, banded (complex), chunked (RAG), comet (agent), shard (adversarial). */
export function CategoryCue({ category }: { readonly category: CueCategory }) {
  const c = category === 'complex' ? 'var(--pkt-chat)' : CATEGORY_FILL[category]
  let shape
  switch (category) {
    case 'agent':
      shape = (
        <>
          <polygon points="0,5.5 6,3.6 6,7.4" fill={c} opacity={0.5} />
          <rect x="5" y="3" width="11" height="5" rx="2.5" fill={c} />
        </>
      )
      break
    case 'adv':
      shape = <polygon points="15,5.5 9,1.5 4,2.5 1,4.5 3,8.5 8,9.5 12,8" fill={c} />
      break
    default:
      shape = (
        <>
          <rect x="1" y="3" width="13" height="5" rx="2.5" fill={c} />
          {category === 'complex' && <rect x="6.6" y="1.4" width="1.6" height="8.2" rx=".8" fill="none" stroke={c} strokeWidth="1" />}
          {category === 'rag' && (
            <>
              <rect x="3" y="0" width="2.4" height="2.4" fill={c} />
              <rect x="6.6" y="0" width="2.4" height="2.4" fill={c} />
            </>
          )}
        </>
      )
  }
  return (
    <svg width="16" height="11" viewBox="0 0 16 11" className="block flex-none" role="img" aria-label={CATEGORY_LABEL[category]}>
      {shape}
    </svg>
  )
}
