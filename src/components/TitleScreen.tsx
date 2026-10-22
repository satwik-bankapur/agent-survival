/*
 * The title screen (design: "Title screen"): the full Milestone 1 build
 * playing on the mat behind a dark wash, the wordmark and tagline, and the
 * three modes.
 *
 *   Survival      traffic grows until something breaks
 *   Sandbox       pick a budget and a traffic level; no game over
 *   Daily outage  today's seed, the same for everyone
 *
 * Pointing at a mode (or the arrow keys) highlights it; a click or Enter
 * starts it. Sandbox opens its two choices first.
 */

import { useEffect, useMemo, useState } from 'react'

import { boardFor, fastForward } from '../canvas/devScenes'
import type { BoardInsets } from '../canvas/IsometricScene'
import { LazyScene } from '../canvas/LazyScene'
import { GameEngine, SANDBOX } from '../engine'
import { configFor, startRun, todaysSeed } from '../run'
import type { RunMode } from '../store/runStore'
import { useUiStore } from '../store/uiStore'
import { formatMoney, formatSeed } from './format'
import { Button } from './ui/Button'
import { Num } from './ui/Num'
import { SegmentedControl } from './ui/SegmentedControl'

const MODES: readonly { readonly mode: RunMode; readonly name: string; readonly line: string }[] = [
  { mode: 'survival', name: 'Survival', line: 'Traffic grows until something breaks.' },
  { mode: 'sandbox', name: 'Sandbox', line: 'Any budget, any traffic, no game over.' },
  { mode: 'daily', name: 'Daily outage', line: 'Everyone plays the same seed and incidents today.' },
]

/** The backdrop board: the full build, a little way in so traffic is flowing. */
const BACKDROP_SEED = 7
const BACKDROP_AT_SEC = 70
/** The board sits right of the title column and runs off the edges, close up (design: zoom 1.75, centre at 1010 of 1440). */
const BACKDROP_INSETS: BoardInsets = { left: 560, right: -120, top: -20, bottom: -20 }

function Backdrop() {
  const [setup] = useState(() => {
    const engine = new GameEngine({ seed: BACKDROP_SEED })
    const board = boardFor(engine, 'full', 0)
    fastForward(engine, BACKDROP_AT_SEC)
    return board
  })
  return (
    <div className="absolute inset-0">
      <LazyScene engine={setup.engine} framing={setup.framing} insets={BACKDROP_INSETS} backdrop />
      {/* The design's wash: dark behind the title column, clear over the board. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'linear-gradient(90deg, rgb(11 8 6 / 0.97) 0%, rgb(11 8 6 / 0.88) 40%, rgb(11 8 6 / 0) 70%)' }}
      />
    </div>
  )
}

function SandboxOptions({ budget, traffic, onBudget, onTraffic, onStart }: {
  budget: number
  traffic: number
  onBudget: (v: number) => void
  onTraffic: (v: number) => void
  onStart: () => void
}) {
  return (
    <div className="ml-[18px] flex flex-col gap-3 border-l border-hairline py-1 pl-4">
      <div className="flex items-center gap-3">
        <span className="w-24 text-label text-ink-dim">Budget</span>
        <SegmentedControl
          label="Sandbox budget"
          value={budget}
          onChange={onBudget}
          segments={SANDBOX.budgets.map((b) => ({ key: b, title: `Start with ${formatMoney(b)}`, label: <Num>{formatMoney(b).replace('.00', '')}</Num> }))}
        />
      </div>
      <div className="flex items-center gap-3">
        <span className="w-24 text-label text-ink-dim">Traffic</span>
        <SegmentedControl
          label="Sandbox traffic"
          value={traffic}
          onChange={onTraffic}
          segments={SANDBOX.trafficMultipliers.map((t) => ({ key: t, title: `${t}× Survival's traffic`, label: <Num>{`${t}×`}</Num> }))}
        />
      </div>
      <div>
        <Button variant="primary" onClick={onStart}>
          Start sandbox
        </Button>
      </div>
    </div>
  )
}

export function TitleScreen() {
  const [selected, setSelected] = useState(0)
  const [sandboxOpen, setSandboxOpen] = useState(false)
  const [budget, setBudget] = useState<number>(SANDBOX.budgets[0])
  const [traffic, setTraffic] = useState<number>(1)
  const openSettings = useUiStore((s) => s.setSettingsOpen)
  const seed = useMemo(() => todaysSeed(), [])

  const start = (i: number) => {
    const { mode } = MODES[i]
    if (mode === 'sandbox' && !sandboxOpen) {
      setSelected(i)
      setSandboxOpen(true)
      return
    }
    startRun(configFor(mode, { budget, traffic }))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useUiStore.getState().settingsOpen) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setSelected((i) => (i + (e.key === 'ArrowDown' ? 1 : MODES.length - 1)) % MODES.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        document.getElementById(`mode-${selected}`)?.click()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  return (
    <main className="relative h-full w-full overflow-hidden bg-desk font-hud text-ink">
      <Backdrop />
      <div className="absolute top-[140px] left-24 flex w-[560px] flex-col gap-14">
        <div className="flex flex-col gap-5">
          <h1 className="type-display flex flex-col text-display-xl leading-[72px] tracking-[-.01em]" aria-label="AGENT: Survival Protocol">
            <span className="flex items-center">
              AGENT
              <span className="mt-2.5 mr-[18px] ml-3 inline-flex flex-col gap-3" aria-hidden>
                <span className="block h-3 w-[30px] rounded-[6px] bg-pkt-chat shadow-[0_0_10px_var(--pkt-chat),0_0_22px_rgb(255_242_216/0.5)]" />
                <span className="block h-3 w-[30px] rounded-[6px] bg-pkt-agent shadow-[0_0_10px_var(--pkt-agent),0_0_22px_rgb(166_226_46/0.5)]" />
              </span>
            </span>
            <span>Survival Protocol</span>
          </h1>
          <p className="text-[21px] leading-7">Cheap, correct and fast. Your users want all three.</p>
        </div>
        <div className="flex flex-col gap-1" role="menu" aria-label="Modes">
          {MODES.map((m, i) => {
            const on = i === selected
            return (
              <div key={m.mode} className="flex flex-col gap-2">
                <button
                  id={`mode-${i}`}
                  type="button"
                  role="menuitem"
                  onPointerEnter={() => setSelected(i)}
                  onFocus={() => setSelected(i)}
                  onClick={() => start(i)}
                  className={`flex w-[440px] cursor-pointer flex-col items-start gap-1 rounded-control px-[18px] py-3.5 text-left hover:outline hover:outline-ink-dim ${
                    on ? 'bg-ink text-panel' : 'bg-transparent text-ink'
                  }`}
                >
                  <span className="text-[36px] leading-10 font-bold whitespace-nowrap">{m.name}</span>
                  <span className={`text-body whitespace-nowrap ${on ? 'text-panel' : 'text-ink-dim'}`}>{m.line}</span>
                </button>
                {m.mode === 'sandbox' && sandboxOpen && (
                  <SandboxOptions budget={budget} traffic={traffic} onBudget={setBudget} onTraffic={setTraffic} onStart={() => startRun(configFor('sandbox', { budget, traffic }))} />
                )}
              </div>
            )
          })}
        </div>
      </div>
      <footer className="absolute right-24 bottom-10 left-24 flex items-center gap-8 border-t border-hairline pt-4 text-body">
        <span className="text-ink-dim">
          Today's seed: <Num className="text-ink">{formatSeed(seed)}</Num>
        </span>
        <span className="flex-1" />
        <button type="button" onClick={() => openSettings(true)} className="cursor-pointer py-1.5 hover:underline">
          Settings
        </button>
        <button type="button" aria-disabled className="cursor-not-allowed py-1.5 text-ink-faint" title="Arrives in a later milestone">
          Credits
        </button>
      </footer>
    </main>
  )
}
