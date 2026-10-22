/*
 * Shown instead of the game below 1280 px wide: the board and its HUD need a
 * wide screen and a mouse. The run stays in the run store, and the engine only
 * steps while the board is mounted, so widening the window picks it back up.
 */

export function DesktopOnly() {
  return (
    <main className="flex h-full w-full items-center bg-mat px-6 font-hud text-ink">
      <div className="mx-auto flex max-w-[480px] flex-col gap-6">
        <h1 className="type-display flex flex-col text-[40px] leading-[44px] tracking-[-.01em]">
          <span>AGENT:</span>
          <span>Survival Protocol</span>
        </h1>
        <p className="text-[21px] leading-7">Best played on a desktop browser.</p>
        <p className="text-body text-ink-dim">
          It's a real-time board you build with a mouse, with telemetry down both sides. Open it on a screen at least 1280
          pixels wide.
        </p>
      </div>
    </main>
  )
}
