/*
 * Settings, from the title footer or the in-game menu: master volume (a
 * placeholder until there's sound), reduced motion and an FPS counter.
 * Settings persist across page loads (uiStore). Reduced motion stops every
 * blink, pulse and drift on the board and HUD, and the spinning parts.
 */

import { useEffect, useRef } from 'react'

import { useUiStore } from '../store/uiStore'
import { Button } from './ui/Button'

function Switch({ label, note, on, onChange }: { label: string; note: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-hairline py-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-body font-bold">{label}</span>
        <span className="text-label text-ink-dim">{note}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        className="flex flex-none cursor-pointer items-center gap-2 text-label"
      >
        <span>{on ? 'On' : 'Off'}</span>
        <span className={`relative h-5 w-9 rounded-badge border border-hairline ${on ? 'bg-ink' : 'bg-panel-raised'}`}>
          <span className={`absolute top-[2px] size-3.5 rounded-[1px] ${on ? 'left-[18px] bg-panel' : 'left-[2px] bg-ink-dim'}`} />
        </span>
      </button>
    </div>
  )
}

export function SettingsDialog() {
  const open = useUiStore((s) => s.settingsOpen)
  const settings = useUiStore((s) => s.settings)
  const setSettings = useUiStore((s) => s.setSettings)
  const setOpen = useUiStore((s) => s.setSettingsOpen)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    panel.current?.focus()
    // Esc closes it, on screens without the run's hotkeys too.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, setOpen])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-desk/70 font-hud text-ink" onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-label="Settings" className="relative flex w-[420px] flex-col rounded-panel border border-hairline bg-panel px-5 pt-5 pb-4 outline-none">
        <div className="absolute -top-2 left-3 bg-panel px-1 text-label leading-[14px] font-bold">Settings</div>
        <div className="flex flex-col gap-1.5 border-b border-hairline pb-3">
          <div className="flex items-baseline justify-between">
            <label htmlFor="volume" className="text-body font-bold">
              Master volume
            </label>
            <span className="type-num text-label">{Math.round(settings.volume * 100)}%</span>
          </div>
          <input
            id="volume"
            type="range"
            min={0}
            max={100}
            value={Math.round(settings.volume * 100)}
            onChange={(e) => setSettings({ volume: Number(e.target.value) / 100 })}
            className="w-full accent-ink"
          />
          <span className="text-label text-ink-dim">There's no sound yet. This will set its level.</span>
        </div>
        <Switch
          label="Reduced motion"
          note="No blinking, pulsing or drifting. Lights hold steady, and the model ring and guardrail scan stop."
          on={settings.reducedMotion}
          onChange={(reducedMotion) => setSettings({ reducedMotion })}
        />
        <Switch label="FPS counter" note="Frames per second, at the bottom left of the board." on={settings.showFps} onChange={(showFps) => setSettings({ showFps })} />
        <div className="flex justify-end pt-4">
          <Button variant="primary" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}
