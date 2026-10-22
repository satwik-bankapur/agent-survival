/*
 * The live incident feed, newest first: a time column, a severity shape and
 * a plain sentence per row (design: IncidentFeed).
 */

import { useUiStore } from '../store/uiStore'
import { formatClock } from './format'
import { SeverityIcon } from './ui/icons'
import { Num } from './ui/Num'
import { Panel } from './ui/Panel'
import { useCompact } from './ui/useCompact'

export function IncidentFeed() {
  const incidents = useUiStore((s) => s.snapshot.incidents)
  const compact = useCompact()
  const rows = incidents.slice(0, compact ? 3 : 4)
  return (
    <Panel title="Incidents" status="Newest first" tight>
      <ol className="flex flex-col" aria-live="polite">
        {rows.length === 0 && <li className="py-1 text-label text-ink-dim">Nothing yet.</li>}
        {rows.map((incident, i) => (
          <li
            key={`${incident.tick}-${incident.text}`}
            className={`grid grid-cols-[34px_14px_1fr] items-start gap-1.5 py-1 text-label ${i > 0 ? 'border-t border-hairline' : ''}`}
          >
            <Num className="text-ink-dim">{formatClock(incident.timeSec)}</Num>
            <span className="pt-0.5">
              <SeverityIcon severity={incident.severity} />
            </span>
            <span className="text-pretty">{incident.text}</span>
          </li>
        ))}
      </ol>
    </Panel>
  )
}
