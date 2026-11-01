/*
 * The top bar: the wordmark with its capsule colon, the phase timeline with
 * its playhead and next-up marker, the clock, the speed control, Help and the
 * menu (design: TopControlBar). A run opened from a share link also says so,
 * and offers its seed in Survival.
 *
 * Share copies a link holding the seed and the command log (src/share.ts):
 * the build, or the whole run to watch.
 */

import { useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { endRun, playSharedSeed } from '../run'
import { encodeShare, shareUrl, type ShareKind } from '../share'
import { useRunStore } from '../store/runStore'
import { useUiStore, type Speed } from '../store/uiStore'
import { formatClock, formatPhaseStart, formatSeed } from './format'
import { GUIDE } from './guide'
import { Num } from './ui/Num'
import { SegmentedControl, type Segment } from './ui/SegmentedControl'
import { KeyHint } from './ui/Button'

/** The timeline spans 12 minutes, as in the design; the open-ended last phase ("9:00 on") fills the rest. */
const TIMELINE_SEC = 12 * 60

/** Segments sit 2 px apart, so a time maps to a percentage plus that much of the gaps. */
const GAP_PX = 2

function Wordmark() {
  return (
    <div className="type-display flex flex-none items-center text-body leading-none tracking-[.01em] whitespace-nowrap" aria-label="AGENT: Survival Protocol">
      <span>AGENT</span>
      <span className="mt-0.5 mr-1.5 ml-1 inline-flex flex-col gap-[3px]" aria-hidden>
        <span className="block h-[3px] w-[7px] rounded-[2px] bg-pkt-chat shadow-[0_0_4px_var(--pkt-chat)]" />
        <span className="block h-[3px] w-[7px] rounded-[2px] bg-pkt-agent shadow-[0_0_4px_var(--pkt-agent)]" />
      </span>
      <span>Survival Protocol</span>
    </div>
  )
}

function PhaseTimeline() {
  const { phases, timeSec, next } = useUiStore(
    useShallow((s) => ({
      phases: s.snapshot.phases,
      // Whole seconds: the playhead moves once a second, not on every snapshot.
      timeSec: Math.floor(s.snapshot.timeSec),
      next: s.snapshot.traffic.next,
    })),
  )
  const end = TIMELINE_SEC
  const gaps = (phases.length - 1) * GAP_PX
  const pos = (sec: number) => {
    const p = Math.min(sec, end) / end
    return `calc(${(p * 100).toFixed(2)}% + ${(gaps * p).toFixed(1)}px)`
  }
  return (
    <div className="flex min-w-0 flex-1 justify-center">
      {/* No cap: on a wide window the timeline fills the bar rather than leaving an empty middle. */}
      <div className="relative flex w-full gap-0.5" role="group" aria-label="Phases">
        {phases.map((phase, i) => {
          const last = i === phases.length - 1
          const stop = last ? end : phases[i + 1].startSec
          const current = timeSec >= phase.startSec && (timeSec < stop || last)
          const fill = Math.max(0, Math.min(1, (timeSec - phase.startSec) / (stop - phase.startSec)))
          return (
            <div key={phase.name} className="flex min-w-0 flex-col gap-1" style={{ flex: stop - phase.startSec }} aria-current={current ? 'step' : undefined}>
              <div className={`truncate text-label leading-[14px] ${current ? 'font-bold text-ink' : 'text-ink-dim'}`}>{phase.name}</div>
              <div className="relative h-1.5 overflow-hidden rounded-badge border border-hairline bg-panel-raised">
                <div className="absolute inset-y-0 left-0 bg-ink-dim" style={{ width: `${(fill * 100).toFixed(1)}%` }} />
              </div>
              <Num className="text-hint leading-3 text-ink-faint">{formatPhaseStart(phase.startSec, last)}</Num>
            </div>
          )
        })}
        <div className="absolute top-[15px] -ml-px h-3.5 w-0.5 rounded-[1px] bg-ink" style={{ left: pos(timeSec) }} aria-hidden />
        {next !== null && (
          <div className="absolute top-4 -translate-x-1.5" style={{ left: pos(next.atSec) }} title={next.text}>
            <svg width="12" height="12" viewBox="0 0 12 12" className="block" role="img" aria-label={`Next: ${next.text}`}>
              <polygon points="6,1 11,6 6,11 1,6" fill="var(--panel)" stroke="var(--ink)" strokeWidth="1.5" />
            </svg>
          </div>
        )}
      </div>
    </div>
  )
}

function Clock() {
  const clock = useUiStore((s) => formatClock(s.snapshot.timeSec))
  return (
    <div className="min-w-[62px] flex-none text-right text-value-lg" role="timer" aria-label="Game clock">
      <Num>{clock}</Num>
    </div>
  )
}

const PAUSE_ICON = (
  <svg width="12" height="12" viewBox="0 0 12 12" className="block" aria-hidden>
    <rect x="2" y="1.5" width="2.6" height="9" fill="currentColor" />
    <rect x="7.4" y="1.5" width="2.6" height="9" fill="currentColor" />
  </svg>
)

function SpeedControl() {
  const speed = useUiStore((s) => s.speed)
  const setSpeed = useUiStore((s) => s.setSpeed)
  const segments: Segment<string>[] = [
    {
      key: 'paused',
      title: 'Pause (Space)',
      label: (
        <>
          {PAUSE_ICON}
          {speed === 'paused' && <span>Paused</span>}
        </>
      ),
    },
    { key: '1', title: 'Speed 1×', label: '1×' },
    { key: '2', title: 'Speed 2×', label: '2×' },
    { key: '4', title: 'Speed 4×', label: '4×' },
  ]
  return (
    <SegmentedControl
      label="Game speed"
      segments={segments}
      value={String(speed)}
      onChange={(key) => setSpeed(key === 'paused' ? 'paused' : (Number(key) as Exclude<Speed, 'paused'>))}
    />
  )
}

/** Copies a link to this run: the build at 0:00, or the whole run to watch. */
async function copyShareLink(kind: ShareKind): Promise<void> {
  const { setup, config } = useRunStore.getState()
  const ui = useUiStore.getState()
  if (setup === null || config === null) return
  try {
    const code = await encodeShare({ seed: config.seed, log: setup.engine.commandLog })
    await navigator.clipboard.writeText(shareUrl(kind, code))
    ui.toast(kind === 'build' ? 'Link copied: your build, at 0:00.' : 'Link copied: this run, to watch.')
  } catch {
    ui.toast("The browser wouldn't let the link onto the clipboard.", 'alarm')
  }
}

/** A run opened from a share link: what it is, and the way out of it. */
function SharedNote() {
  const shared = useRunStore((s) => s.shared)
  if (shared === null) return null
  return (
    <div className="flex flex-none items-center gap-2 rounded-control border border-hairline bg-panel-raised px-2.5 py-1">
      <span className="text-label whitespace-nowrap">{shared.kind === 'build' ? 'Shared build' : 'Shared run'}</span>
      <Num className="text-hint text-ink-dim">{formatSeed(shared.seed)}</Num>
      <button type="button" onClick={playSharedSeed} className="cursor-pointer text-label whitespace-nowrap underline underline-offset-[3px] hover:text-ink">
        Play this seed in Survival
      </button>
    </div>
  )
}

function HelpButton() {
  const openHelp = useUiStore((s) => s.openHelp)
  return (
    <button
      type="button"
      onClick={() => openHelp(GUIDE[0].id)}
      title="Field guide (?)"
      className="flex h-8 flex-none cursor-pointer items-center gap-2 rounded-control border border-hairline bg-panel-raised px-2.5 text-label hover:border-ink-dim"
    >
      <span>Help</span>
      <KeyHint className="border-hairline text-ink-dim">?</KeyHint>
    </button>
  )
}

function Menu() {
  const open = useUiStore((s) => s.menuOpen)
  const setOpen = useUiStore((s) => s.setMenuOpen)
  const openSettings = useUiStore((s) => s.setSettingsOpen)
  const box = useRef<HTMLDivElement>(null)
  // A click anywhere outside the menu closes it.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (box.current !== null && e.target instanceof Node && !box.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open, setOpen])
  return (
    <div ref={box} className="relative flex-none">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
        className="flex h-8 cursor-pointer items-center gap-2 rounded-control border border-hairline bg-panel-raised px-2.5 text-label hover:border-ink-dim"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" className="block" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
          <line x1="3" y1="4.5" x2="13" y2="4.5" />
          <line x1="3" y1="8" x2="13" y2="8" />
          <line x1="3" y1="11.5" x2="13" y2="11.5" />
        </svg>
        <span>Menu</span>
        <KeyHint className="border-hairline text-ink-dim">Esc</KeyHint>
      </button>
      {open && (
        <div role="menu" className="absolute top-10 right-0 z-10 flex w-40 flex-col rounded-panel border border-hairline bg-panel-raised p-1">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              openSettings(true)
            }}
            className="cursor-pointer rounded-control px-2.5 py-2 text-left text-body hover:bg-panel"
          >
            Settings
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              endRun()
            }}
            className="cursor-pointer rounded-control px-2.5 py-2 text-left text-body hover:bg-panel"
          >
            End run
          </button>
          <div className="my-1 border-t border-hairline" />
          <button
            type="button"
            role="menuitem"
            title="A link that opens your architecture on this seed, at 0:00"
            onClick={() => {
              setOpen(false)
              void copyShareLink('build')
            }}
            className="cursor-pointer rounded-control px-2.5 py-2 text-left text-body hover:bg-panel"
          >
            Share this build
          </button>
          <button
            type="button"
            role="menuitem"
            title="A link that replays this run from 0:00, to watch"
            onClick={() => {
              setOpen(false)
              void copyShareLink('watch')
            }}
            className="cursor-pointer rounded-control px-2.5 py-2 text-left text-body hover:bg-panel"
          >
            Share this run
          </button>
        </div>
      )}
    </div>
  )
}

export function TopControlBar() {
  return (
    <header className="pointer-events-auto absolute inset-x-0 top-0 flex h-14 items-center gap-6 border-b border-hairline bg-panel px-4">
      <Wordmark />
      <PhaseTimeline />
      <SharedNote />
      <Clock />
      <SpeedControl />
      <HelpButton />
      <Menu />
    </header>
  )
}
