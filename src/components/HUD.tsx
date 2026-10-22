/*
 * The HUD over the board. The overlay itself lets pointer events through to
 * the canvas; only the panels take them. Rails sit 16 px from the screen
 * edges and 72 px from the top; the toolbar is centred between the rails.
 * The node inspector slides in over the right rail (D36), and toasts sit
 * just above the toolbar, and the director's event banner just under the
 * top bar. The keyboard is wired here too.
 */

import { useUiStore } from '../store/uiStore'
import { BottomToolbar } from './BottomToolbar'
import { EventBanner } from './EventBanner'
import { LeftTelemetryHUD } from './LeftTelemetryHUD'
import { NodeInspectorDrawer } from './NodeInspectorDrawer'
import { PacketXRay } from './PacketXRay'
import { PhaseCard } from './PhaseCard'
import { RightOpsPanels } from './RightOpsPanels'
import { Toasts } from './Toasts'
import { TopControlBar } from './TopControlBar'
import { TutorialCard } from './TutorialCard'
import { LAYOUT, TOOLBAR_HEIGHT, useLayout } from './ui/useCompact'
import { useHotkeys } from './useHotkeys'

/** Trust critical: the screen edges glow red and pulse (design: Trust critical). */
function CriticalEdge() {
  const critical = useUiStore((s) => s.snapshot.trust.criticalSecondsLeft !== null)
  if (!critical) return null
  return <div className="critical-edge pointer-events-none absolute inset-0" aria-hidden />
}

export function HUD() {
  useHotkeys()
  const size = useLayout()
  // Centre of the gap between the rails, as an offset from the screen centre.
  const toolbarLeft = `calc(50% + ${(size.left - size.right) / 2 - size.toolbar / 2}px)`
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden font-hud text-ink">
      <CriticalEdge />
      <TopControlBar />
      <div className="absolute" style={{ left: LAYOUT.inset, top: LAYOUT.top }}>
        <LeftTelemetryHUD width={size.left} />
      </div>
      <div className="absolute" style={{ right: LAYOUT.inset, top: LAYOUT.top }}>
        <RightOpsPanels width={size.right} />
      </div>
      <div className="absolute" style={{ left: toolbarLeft, bottom: LAYOUT.inset }}>
        <BottomToolbar width={size.toolbar} />
      </div>
      {/* The banner centres on the gap between the rails, as the toolbar does. */}
      <EventBanner left={`calc(50% + ${(size.left - size.right) / 2}px)`} />
      <Toasts bottom={LAYOUT.inset + TOOLBAR_HEIGHT + 12} />
      <NodeInspectorDrawer />
      <PacketXRay />
      <PhaseCard />
      <TutorialCard />
    </div>
  )
}
