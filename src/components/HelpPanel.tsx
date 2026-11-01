/*
 * The field guide (key ?, the Help button, or any small "?" on a panel, the
 * inspector or a postmortem action item): every node and every idea the game
 * teaches, each answering the same four questions, plus a legend for the
 * shapes on the board.
 *
 * The entries and their numbers live in guide.ts, which reads the catalog, so
 * nothing here can go stale. Rendered globally (App), so it opens over a run,
 * the title screen and the postmortem alike.
 */

import { useEffect, useRef, type ReactNode } from 'react'

import { useUiStore } from '../store/uiStore'
import { GUIDE, guideEntry, type GuideEntry, type GuideGroup } from './guide'
import { Button } from './ui/Button'
import { CATEGORY_LABEL, CategoryCue, SeverityIcon, type CueCategory } from './ui/icons'
import { NodeThumb } from './ui/NodeThumb'

const GROUPS: readonly GuideGroup[] = ['Nodes', 'Ideas']
const LEGEND = 'legend'

/** What the player sees on the board, and what each of them means. */
const CAPSULES: readonly CueCategory[] = ['chat', 'complex', 'rag', 'agent', 'adv']

const PLATES: readonly [string, string][] = [
  ['Idle', 'Nothing in its queue. A node with no work is still charging upkeep.'],
  ['Healthy', 'Working, with room to spare.'],
  ['Busy', 'Every worker taken; new arrivals wait in the queue.'],
  ['Queue full', 'The queue is at capacity, so arrivals are dropped on the spot.'],
  ['No route', 'Nowhere to send what it finishes. Link it onward.'],
]

const BADGES: readonly [string, 'alarm' | 'warn' | 'info', string][] = [
  ['Wrong answer reported', 'alarm', 'A user complained about an answer they were given a few seconds ago. The only proof a wrong answer ever existed.'],
  ['Timed out', 'alarm', 'A prompt waited past its deadline and was lost.'],
  ['Queue full', 'alarm', 'An arrival was dropped because the queue was at capacity.'],
  ['No route', 'info', 'A lasting state, not a moment: this node has nowhere to send its output.'],
]

function Field({ label, children }: { readonly label: string; readonly children: string }) {
  return (
    <div className="flex flex-col gap-1 border-t border-hairline pt-3">
      <span className="text-label font-bold">{label}</span>
      <p className="text-body text-pretty">{children}</p>
    </div>
  )
}

function EntryView({ entry }: { readonly entry: GuideEntry }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {entry.thumb !== undefined && (
          <span className="flex h-[52px] w-16 flex-none items-center justify-center rounded-badge bg-panel-raised">
            <NodeThumb kind={entry.thumb} width={60} height={48} />
          </span>
        )}
        <h2 className="type-display text-value-lg">{entry.name}</h2>
      </div>
      <Field label="What it does here">{entry.here}</Field>
      <Field label="What it is in real life">{entry.real}</Field>
      <Field label="When to buy it">{entry.buy}</Field>
      <Field label="Which death spiral it fights">{entry.spiral}</Field>
    </div>
  )
}

function Row({ cue, label, note }: { readonly cue: ReactNode; readonly label: string; readonly note: string }) {
  return (
    <div className="grid grid-cols-[20px_140px_1fr] items-start gap-3 border-t border-hairline py-2">
      <span className="flex h-[18px] items-center">{cue}</span>
      <span className="text-body font-bold">{label}</span>
      <span className="text-label text-pretty text-ink-dim">{note}</span>
    </div>
  )
}

const CAPSULE_NOTE: Record<CueCategory, string> = {
  chat: 'Short and easy. Cheap to answer, and most of the early traffic.',
  complex: 'Longer and harder. Pays well, and a small model gets it wrong often.',
  rag: 'Needs your documents. Without retrieval the answer is invented.',
  agent: 'A task, not a question: several model passes and tool calls before an answer.',
  adv: 'An attack. It pays nothing, and what it costs you is a fine and your trust.',
}

function LegendView() {
  return (
    <div className="flex flex-col gap-5">
      <h2 className="type-display text-value-lg">Legend</h2>
      <section className="flex flex-col">
        <span className="text-label font-bold">Capsules</span>
        <p className="pb-1 text-label text-ink-dim">
          Each kind of traffic has its own silhouette as well as its own colour, so the board still reads without colour.
        </p>
        {CAPSULES.map((c) => (
          <Row key={c} cue={<CategoryCue category={c} />} label={CATEGORY_LABEL[c]} note={CAPSULE_NOTE[c]} />
        ))}
      </section>
      <section className="flex flex-col">
        <span className="text-label font-bold">Node states</span>
        <p className="pb-1 text-label text-ink-dim">The word on a node's plate, under its name.</p>
        {PLATES.map(([label, note]) => (
          <Row key={label} cue={null} label={label} note={note} />
        ))}
      </section>
      <section className="flex flex-col">
        <span className="text-label font-bold">Badges</span>
        <p className="pb-1 text-label text-ink-dim">
          A tag above a node: an octagon for an alarm, a triangle for a warning, a dot for a note. Only things you could have
          seen happen appear here.
        </p>
        {BADGES.map(([label, kind, note]) => (
          <Row key={label} cue={<SeverityIcon severity={kind} />} label={label} note={note} />
        ))}
      </section>
    </div>
  )
}

export function HelpPanel() {
  const id = useUiStore((s) => s.help)
  const openHelp = useUiStore((s) => s.openHelp)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (id === null) return
    panel.current?.focus()
    // Esc closes it, on screens without the run's hotkeys too.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      openHelp(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [id, openHelp])

  if (id === null) return null
  const entry = guideEntry(id)
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-desk/70 font-hud text-ink"
      onPointerDown={(e) => e.target === e.currentTarget && openHelp(null)}
    >
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-label="Field guide"
        className="relative flex h-[660px] max-h-[88vh] w-[940px] max-w-[94vw] rounded-panel border border-hairline bg-panel outline-none"
      >
        <div className="absolute -top-2 left-3 bg-panel px-1 text-label leading-[14px] font-bold">Field guide</div>
        <nav aria-label="Guide entries" className="flex w-[228px] flex-none flex-col overflow-y-auto border-r border-hairline p-2">
          {GROUPS.map((group) => (
            <div key={group} className="flex flex-col">
              <span className="px-2.5 pt-3 pb-1 text-hint text-ink-dim">{group}</span>
              {GUIDE.filter((e) => e.group === group).map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => openHelp(e.id)}
                  aria-current={e.id === id}
                  className={`cursor-pointer rounded-control px-2.5 py-1.5 text-left text-body ${e.id === id ? 'bg-panel-raised font-bold' : 'hover:bg-panel-raised'}`}
                >
                  {e.name}
                </button>
              ))}
            </div>
          ))}
          <span className="px-2.5 pt-3 pb-1 text-hint text-ink-dim">On the board</span>
          <button
            type="button"
            onClick={() => openHelp(LEGEND)}
            aria-current={id === LEGEND}
            className={`cursor-pointer rounded-control px-2.5 py-1.5 text-left text-body ${id === LEGEND ? 'bg-panel-raised font-bold' : 'hover:bg-panel-raised'}`}
          >
            Legend
          </button>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-6 py-5">{entry === undefined ? <LegendView /> : <EntryView entry={entry} />}</div>
          <div className="flex justify-end border-t border-hairline p-3">
            <Button variant="primary" onClick={() => openHelp(null)}>
              Done
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** The small "?" that opens a guide entry, on a panel's border, the inspector or an action item. */
export function HelpDot({ id, label, className = '' }: { readonly id: string; readonly label: string; readonly className?: string }) {
  const openHelp = useUiStore((s) => s.openHelp)
  return (
    <button
      type="button"
      title={`What is ${label}?`}
      aria-label={`What is ${label}?`}
      onClick={() => openHelp(id)}
      className={`flex size-[14px] cursor-pointer items-center justify-center rounded-full border border-hairline text-hint leading-none text-ink-dim hover:border-ink-dim hover:text-ink ${className}`}
    >
      ?
    </button>
  )
}
