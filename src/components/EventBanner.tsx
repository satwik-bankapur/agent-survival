/*
 * The incident director's banner (D48): an event's warning with a countdown
 * to its start, then the time it has left while it runs. Centred between the
 * rails, under the top bar. A provider outage is an alarm (design: 06
 * Provider outage): red, with how long it has run and a button that selects
 * a node on the provider that's down (J-4). It reads the 4 Hz snapshot only.
 */

import { useUiStore } from '../store/uiStore'
import { formatClock } from './format'
import { Num } from './ui/Num'

function OutageBanner({ left }: { readonly left: string }) {
  const event = useUiStore((s) => s.snapshot.event)
  const target = useUiStore((s) => s.snapshot.nodes.find((n) => n.type === 'FRONTIER_API' && s.snapshot.event !== null && n.provider === s.snapshot.event.provider))
  const select = useUiStore((s) => s.selectNode)
  if (event === null) return null
  const name = `Frontier ${event.provider ?? ''}`
  const active = event.state === 'active'
  return (
    <div
      role="alert"
      className="absolute flex -translate-x-1/2 items-center gap-3 rounded-panel border border-alarm bg-panel py-2 pr-2 pl-3 text-body whitespace-nowrap"
      style={{ left, top: 68 }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="block flex-none">
        <polygon points="5,1 11,1 15,5 15,11 11,15 5,15 1,11 1,5" className="fill-alarm" />
        <rect x="7.2" y="4" width="1.6" height="5" className="fill-panel" />
        <rect x="7.2" y="10.5" width="1.6" height="1.6" className="fill-panel" />
      </svg>
      <span>
        <b>Provider outage.</b> {active ? `${name} is down: every call to it fails.` : `${name} goes down in ${Math.ceil(event.secondsLeft)} s.`}
      </span>
      {active && <Num className="border-l border-hairline pl-3 text-hint text-ink-dim">{`${formatClock(Math.floor(event.elapsedSec))} elapsed`}</Num>}
      {target !== undefined && (
        <button
          type="button"
          onClick={() => select(target.id)}
          className="h-7 cursor-pointer rounded-control border border-hairline bg-panel-raised px-2.5 text-label text-ink hover:border-ink-dim"
        >
          Show {target.label}
        </button>
      )}
    </div>
  )
}

export function EventBanner({ left }: { readonly left: string }) {
  const event = useUiStore((s) => s.snapshot.event)
  if (event === null) return null
  if (event.provider !== null) return <OutageBanner left={left} />
  const seconds = Math.ceil(event.secondsLeft)
  const when = event.state === 'announced' ? `in ${seconds} s` : `${seconds} s left`
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute flex -translate-x-1/2 items-center gap-2 rounded-panel border border-hairline bg-panel px-3 py-2 text-body"
      style={{ left, top: 72 }}
    >
      <svg width="12" height="12" viewBox="0 0 10 10" aria-hidden className="block flex-none">
        <polygon points="5,0.5 9.6,9.2 0.4,9.2" className="fill-warn" />
      </svg>
      <span className="font-bold">{event.name}</span>
      <Num className="text-ink-dim">{when}</Num>
      <span className="text-ink-dim">{event.text}</span>
    </div>
  )
}
