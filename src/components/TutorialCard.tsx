/*
 * The tutorial card: one step at a time, ringed around whatever it's talking
 * about, waiting for the player to do the thing. The steps, their copy and
 * the "has it been done yet" test live in tutorial.ts; the store advances
 * them (uiStore.noteTutorial). Skippable at every step.
 *
 * The card and its ring are placed by writing their style, not by holding a
 * measurement in state: the step's anchor is one of the HUD's own panels, so
 * it only moves when the window does.
 */

import { useCallback, useEffect, useRef } from 'react'

import { useUiStore } from '../store/uiStore'
import { cardSpot, TUTORIAL } from './tutorial'
import { Button } from './ui/Button'

const CARD_WIDTH = 320
/** How far the ring sits outside what it rings, px. */
const RING = 3

export function TutorialCard() {
  const step = useUiStore((s) => s.tutorial)
  const ack = useUiStore((s) => s.ackTutorial)
  const skip = useUiStore((s) => s.skipTutorial)
  const root = useRef<HTMLDivElement>(null)

  const place = useCallback(
    (node: HTMLDivElement | null) => {
      root.current = node
      if (node === null || step === null) return
      const card = node.querySelector<HTMLElement>('[data-card]')
      const ring = node.querySelector<HTMLElement>('[data-ring]')
      if (card === null || ring === null) return
      const anchor = document.querySelector(TUTORIAL[step].anchor)?.getBoundingClientRect()
      ring.hidden = anchor === undefined
      if (anchor !== undefined) {
        ring.style.left = `${anchor.left - RING}px`
        ring.style.top = `${anchor.top - RING}px`
        ring.style.width = `${anchor.width + RING * 2}px`
        ring.style.height = `${anchor.height + RING * 2}px`
      }
      const box = anchor ?? new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0)
      const spot = cardSpot(box, { width: card.offsetWidth, height: card.offsetHeight }, { width: window.innerWidth, height: window.innerHeight })
      card.style.left = `${spot.left}px`
      card.style.top = `${spot.top}px`
    },
    [step],
  )

  useEffect(() => {
    const onResize = () => place(root.current)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [place])

  if (step === null) return null
  const current = TUTORIAL[step]
  return (
    // Keyed by step: the card is placed again, from scratch, for each one.
    <div key={step} ref={place}>
      <div data-ring className="pointer-events-none fixed rounded-panel border border-ink" aria-hidden />
      <section
        data-card
        aria-label="Tutorial"
        className="pointer-events-auto fixed flex flex-col gap-2 rounded-panel border border-hairline bg-panel p-4"
        style={{ width: CARD_WIDTH, left: -9999, top: -9999 }}
      >
        <span className="text-hint text-ink-dim">
          Step {step + 1} of {TUTORIAL.length}
        </span>
        <h2 className="text-value font-bold">{current.title}</h2>
        <p className="text-body text-pretty">{current.body}</p>
        <div className="flex items-center justify-between pt-1">
          <button type="button" onClick={skip} className="cursor-pointer text-label text-ink-dim underline underline-offset-[3px] hover:text-ink">
            Skip the tutorial
          </button>
          {current.ack !== undefined && (
            <Button variant="primary" onClick={ack}>
              {current.ack}
            </Button>
          )}
        </div>
      </section>
    </div>
  )
}
