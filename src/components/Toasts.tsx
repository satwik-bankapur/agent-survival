/*
 * Short notes above the toolbar: what a click just did ("Demolished Fast SLM
 * 1. Refunded $30.") or why it didn't happen, in the engine's own words. A
 * rejection carries the alarm octagon, so it never rests on colour alone.
 */

import { useUiStore } from '../store/uiStore'
import { AlarmOctagon } from './ui/icons'

export function Toasts({ bottom }: { readonly bottom: number }) {
  const toasts = useUiStore((s) => s.toasts)
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5"
      style={{ bottom }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-center gap-2 rounded-control border bg-panel max-w-[560px] px-3 py-1.5 text-body text-ink ${
            t.tone === 'alarm' ? 'border-alarm' : 'border-hairline'
          }`}
        >
          {t.tone === 'alarm' && <AlarmOctagon size={12} />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}
