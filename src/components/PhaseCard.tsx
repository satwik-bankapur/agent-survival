/*
 * The phase card (design: HUD language, "PhaseCard"): at the start of each
 * phase the game pauses and a card says what's changing. Continue, or Space,
 * resumes; resuming any other way closes the card too. The opening card also
 * offers the guided first run, once (Tutorial.tsx).
 *
 * Milestone 1 is chat only, so the cards talk about chat traffic. The
 * design's "New traffic" and "New nodes" rows show only where there's
 * something new: the opening's two kinds of chat and the two nodes it teaches.
 * Sandbox runs and dev scenes show no cards. The store decides when a card
 * is up (uiStore announcePhase), so this only draws it.
 */

import { useState } from 'react'

import { useUiStore } from '../store/uiStore'
import { formatClock } from './format'
import { Button, KeyHint } from './ui/Button'
import { CATEGORY_LABEL, CategoryCue, type CueCategory } from './ui/icons'
import { tutorialSeen } from './tutorial'
import { NodeThumb } from './ui/NodeThumb'
import { Num } from './ui/Num'
import type { ThumbKind } from './ui/nodeThumbs'

interface PhaseCopy {
  readonly line: string
  readonly traffic: readonly CueCategory[]
  readonly nodes: readonly { readonly kind: ThumbKind; readonly name: string }[]
}

/** By phase index. Phases past the table reuse its last entry. */
const COPY: readonly PhaseCopy[] = [
  {
    line: 'One model behind an API. Make it pay before the money runs out.',
    traffic: ['chat', 'complex'],
    nodes: [
      { kind: 'cache', name: 'Semantic cache' },
      { kind: 'router', name: 'Prompt router' },
    ],
  },
  { line: 'Traffic is growing and questions are getting harder.', traffic: [], nodes: [] },
  { line: 'Traffic keeps climbing, two more prompts a second every minute.', traffic: [], nodes: [] },
]

export function PhaseCard() {
  const shown = useUiStore((s) => s.phaseCard)
  const phases = useUiStore((s) => s.snapshot.phases)
  const togglePause = useUiStore((s) => s.togglePause)
  const startTutorial = useUiStore((s) => s.startTutorial)
  const skipTutorial = useUiStore((s) => s.skipTutorial)
  // Offered on the opening card of a first run, and never again once it's been answered.
  const [offer] = useState(() => !tutorialSeen())
  if (shown === null) return null
  const phase = phases[shown]
  const copy = COPY[Math.min(shown, COPY.length - 1)]
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <section
        aria-label={phase.name}
        className="pointer-events-auto flex w-[600px] flex-col gap-5 rounded-panel border border-hairline bg-panel p-8"
      >
        <div className="flex flex-col gap-2">
          <Num className="text-label text-ink-dim">{formatClock(phase.startSec)}</Num>
          <h2 className="type-display text-display">{phase.name}</h2>
          <p className="text-value leading-6">{copy.line}</p>
        </div>
        {(copy.traffic.length > 0 || copy.nodes.length > 0) && (
          <div className="grid grid-cols-[1fr_2fr] gap-6 border-t border-hairline pt-4">
            <div className="flex flex-col gap-2">
              <span className="text-label font-bold">Traffic</span>
              {copy.traffic.map((c) => (
                <span key={c} className="flex items-center gap-2 text-body">
                  <CategoryCue category={c} />
                  {CATEGORY_LABEL[c]}
                </span>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-label font-bold">New nodes</span>
              <div className="flex gap-2">
                {copy.nodes.map((n) => (
                  <div key={n.kind} className="flex flex-1 flex-col items-start gap-1">
                    <NodeThumb kind={n.kind} />
                    <span className="text-label leading-[14px]">{n.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        <div className="flex items-center justify-end gap-3">
          {offer && shown === 0 && (
            <>
              <button
                type="button"
                onClick={() => {
                  skipTutorial()
                  togglePause()
                }}
                className="mr-auto cursor-pointer text-label text-ink-dim underline underline-offset-[3px] hover:text-ink"
              >
                No thanks
              </button>
              <Button
                className="h-11 px-4 text-body"
                onClick={() => {
                  startTutorial()
                  togglePause()
                }}
              >
                Show me how
              </Button>
            </>
          )}
          <Button variant="primary" className="h-11 px-4 text-body" onClick={togglePause}>
            Continue
            <KeyHint className="border-panel font-normal">Space</KeyHint>
          </Button>
        </div>
      </section>
    </div>
  )
}
