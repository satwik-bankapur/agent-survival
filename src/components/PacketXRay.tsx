/*
 * The packet X-ray (design: "Paused and inspecting"): click a capsule on a
 * paused board and a card opens beside it, with a leader to the capsule.
 *
 * It shows the packet as the player can see it (packetView, D11): its kind,
 * its tokens in the capsule's three bands (cached prefix, new input, the
 * answer once there is one), where it is, time to deadline, and who answered.
 * An agent task adds its loop, tool steps and the model's reliability
 * compounded over its passes (I-1), an expectation, not the run's own roll.
 * Whether the answer is wrong is always "Unknown": nothing samples answers
 * before users do until the judge (M4).
 */

import type { Category, PacketView } from '../engine'
import { useUiStore } from '../store/uiStore'
import { Num } from './ui/Num'
import { LAYOUT, useCompact } from './ui/useCompact'

const CARD_WIDTH = 276
/** Gap between the capsule and the card, px. */
const GAP = 48
const RING_RADIUS = 9

function kindOf(view: PacketView): string {
  switch (view.category) {
    case 'RAG_QUERY':
      return 'RAG question'
    case 'AGENT_TASK':
      return 'Agent task'
    case 'ADVERSARIAL':
      return 'Adversarial'
    case 'CHAT':
      return view.difficulty === 'COMPLEX' ? 'Complex chat' : 'Simple chat'
  }
}

/** The capsule's body colour per kind, and its frosted cached band (iso: the colour 60% toward #5E7488). */
const BODY: Readonly<Record<Category, string>> = {
  CHAT: 'var(--pkt-chat)',
  RAG_QUERY: 'var(--pkt-rag)',
  AGENT_TASK: 'var(--pkt-agent)',
  ADVERSARIAL: 'var(--pkt-adv)',
}
const cachedColor = (c: Category) => `color-mix(in srgb, ${BODY[c]} 40%, #5E7488)`

function loopText(passes: number, maxSteps: number | null): string {
  if (maxSteps === null) return `${passes} model passes`
  return maxSteps > 0 ? `${passes} of ${maxSteps}` : `${passes}, no max steps`
}

function piiText(pii: PacketView['pii']): string | null {
  if (pii === 'contains') return 'Contains personal data. A hosted model that sees it is a breach.'
  if (pii === 'redacted') return 'Redacted'
  return null
}

function deadlineText(sec: number): string {
  return sec >= 0 ? `${sec.toFixed(1)} s left` : `${(-sec).toFixed(1)} s late`
}

function tokens(n: number): string {
  return n.toLocaleString('en-US')
}

export function PacketXRay() {
  const xray = useUiStore((s) => s.xray)
  const compact = useCompact()
  if (xray === null) return null
  const { view, x, y } = xray
  const rails = compact ? LAYOUT.compact : LAYOUT.full
  const minLeft = LAYOUT.inset + rails.left + 16
  const maxRight = window.innerWidth - LAYOUT.inset - rails.right - 16
  // Left of the capsule if it fits, else right of it.
  const left = x - GAP - CARD_WIDTH >= minLeft ? x - GAP - CARD_WIDTH : Math.min(x + GAP, maxRight - CARD_WIDTH)
  const top = Math.max(LAYOUT.top, Math.min(y - 140, window.innerHeight - 340))
  const onLeft = left < x
  const edgeX = onLeft ? left + CARD_WIDTH : left
  const total = view.cachedTokens + view.newInputTokens + view.outputTokens
  const bands: { key: string; label: string; tokens: number; color: string; glow?: boolean }[] = [
    { key: 'cached', label: 'Cached prefix', tokens: view.cachedTokens, color: cachedColor(view.category) },
    { key: 'new', label: view.cachedTokens > 0 ? 'New' : 'Input', tokens: view.newInputTokens, color: BODY[view.category] },
    { key: 'out', label: view.agent !== null ? 'Out' : 'Answer', tokens: view.outputTokens, color: '#ffffff', glow: true },
  ].filter((b) => b.tokens > 0)
  const fields: [string, string][] = [['category', kindOf(view)]]
  const run = view.agent
  if (run !== null) {
    fields.push(['loop', loopText(run.modelPasses, run.maxSteps)])
    fields.push(['tool_steps', `${run.toolsDone} of ${run.toolsRequired}`])
    if (run.stepReliability !== null) {
      fields.push(['reliability', `${(run.reliability * 100).toFixed(1)}%, ${run.stepReliability} per step over ${run.modelPasses} passes`])
    }
  }
  const pii = piiText(view.pii)
  if (pii !== null) fields.push(['personal_data', pii])
  fields.push(
    ['where', view.where],
    ['deadline', deadlineText(view.deadlineLeftSec)],
    ['answered_by', view.answeredBy === null ? 'Not yet' : view.cacheHit ? `${view.answeredBy}, a cache hit` : view.answeredBy],
  )
  if (view.refused) fields.push(['flags', 'Refused. Users get "I don\'t have enough information."'])
  fields.push(['hallucinated', 'Unknown. No eval has sampled this.'])

  return (
    <>
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
        <circle cx={x} cy={y} r={RING_RADIUS} fill="none" stroke="var(--ink)" strokeWidth="1" />
        <polyline
          points={`${x + (onLeft ? -RING_RADIUS : RING_RADIUS)},${y} ${x + (onLeft ? -16 : 16)},${y} ${edgeX},${top + 60}`}
          fill="none"
          stroke="var(--ink)"
          strokeWidth="1"
        />
      </svg>
      <section
        aria-label="Packet X-ray"
        className="pointer-events-auto absolute flex flex-col gap-2.5 rounded-panel border border-hairline bg-panel px-3.5 pt-3.5 pb-3"
        style={{ left, top, width: CARD_WIDTH }}
      >
        <div className="absolute -top-2 right-2 left-2 flex justify-between">
          <span className="bg-panel px-1 text-label leading-[14px] font-bold">Packet X-ray</span>
          <span className="bg-panel px-1 text-hint leading-[14px] text-ink-dim">
            {kindOf(view)} <Num>{tokens(total)}</Num> tokens
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex h-11 items-center rounded-control bg-mat px-3">
            <div className="flex h-3.5 w-full overflow-hidden rounded-full" style={{ opacity: view.refused ? 0.5 : 1 }}>
              {bands.map((b) => (
                <div key={b.key} className={b.glow === true ? 'h-full shadow-[0_0_8px_white]' : 'h-full'} style={{ flexGrow: b.tokens, background: b.color }} />
              ))}
            </div>
          </div>
          {/* Labels share the bar's proportions, with a floor so a thin band's label still fits. */}
          <div className="grid text-hint" style={{ gridTemplateColumns: bands.map((b) => `minmax(44px, ${b.tokens}fr)`).join(' ') }}>
            {bands.map((b) => (
              <div key={b.key} className="flex min-w-0 flex-col pl-1.5" style={{ borderLeft: `1px solid ${b.color}` }}>
                <span className="truncate text-ink-dim">{b.label}</span>
                <Num>{tokens(b.tokens)}</Num>
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-[112px_1fr] border-t border-hairline text-label">
          {fields.map(([k, v]) => (
            <div key={k} className="contents">
              <span className="type-num border-b border-hairline py-[5px] text-ink-dim">{k}</span>
              <span className="border-b border-hairline py-[5px] text-pretty">{v}</span>
            </div>
          ))}
        </div>
        <div className="text-hint text-ink-dim">Paused. Press Space to resume.</div>
      </section>
    </>
  )
}
