/*
 * The screens: the title, a run (the board with the HUD over it), and the
 * postmortem. src/run.ts moves between them; the engine pushes its 4 Hz
 * snapshot into the UI store, which is all the HUD reads.
 */

import { useMemo } from 'react'

import type { BoardInsets } from './canvas/IsometricScene'
import { LazyScene } from './canvas/LazyScene'
import { DesktopOnly } from './components/DesktopOnly'
import { HelpPanel } from './components/HelpPanel'
import { HUD } from './components/HUD'
import { PostmortemScreen } from './components/PostmortemScreen'
import { SettingsDialog } from './components/SettingsDialog'
import { TitleScreen } from './components/TitleScreen'
import { LAYOUT, TOOLBAR_HEIGHT, useLayout, useNarrow } from './components/ui/useCompact'
import { finishRun } from './run'
import { useRunStore } from './store/runStore'
import { useUiStore } from './store/uiStore'

/** The toolbar's height plus its gap to the screen's bottom edge, px. */
const TOOLBAR_BAND = TOOLBAR_HEIGHT + LAYOUT.inset

function Run() {
  const setup = useRunStore((s) => s.setup)
  const runId = useRunStore((s) => s.runId)
  const paused = useUiStore((s) => s.speed === 'paused')
  const showFps = useUiStore((s) => s.settings.showFps)
  const size = useLayout()
  // The board is framed between the rails, below the top bar and above the toolbar.
  const insets = useMemo<BoardInsets>(
    () => ({ left: LAYOUT.inset + size.left, right: LAYOUT.inset + size.right, top: 56, bottom: TOOLBAR_BAND }),
    [size],
  )
  if (setup === null) return null
  return (
    <main className="relative h-full w-full overflow-hidden bg-desk">
      {/* Paused, the board loses 20% of its colour; the HUD keeps all of it (design: "Paused and inspecting"). */}
      <div className="absolute inset-0 transition-[filter] duration-200" style={{ filter: paused ? 'saturate(0.8)' : undefined }}>
        <LazyScene
          key={runId}
          engine={setup.engine}
          framing={setup.framing}
          insets={insets}
          dev={import.meta.env.DEV && setup.scene !== null}
          fps={showFps}
          onGameOver={finishRun}
        />
      </div>
      <HUD />
    </main>
  )
}

export default function App() {
  const screen = useRunStore((s) => s.screen)
  const narrow = useNarrow()
  if (narrow) return <DesktopOnly />
  return (
    <>
      {screen === 'title' && <TitleScreen />}
      {screen === 'run' && <Run />}
      {screen === 'postmortem' && <PostmortemScreen />}
      <SettingsDialog />
      <HelpPanel />
    </>
  )
}
