/*
 * The right rail: the live incident feed, then the four observability
 * panels. Latency and token spend unlock with a tracer, answer quality with
 * an LLM judge (D11, J-3); until then each stays in its "No telemetry" state
 * with a button that picks the node's card. Retrieval unlocks once a vector
 * DB is on the board: its drift follows from time since the last index, so
 * the player could know it (design: RightOpsPanels, 06 Provider outage).
 */

import type { NodeType } from '../engine'
import { useUiStore, type CardId } from '../store/uiStore'

import { formatClock, formatShare, formatWholeMoney } from './format'
import { IncidentFeed } from './IncidentFeed'
import { AlarmOctagon, WarnTriangle } from './ui/icons'
import { Meter } from './ui/Meter'
import { Num } from './ui/Num'
import { Button } from './ui/Button'
import { Panel } from './ui/Panel'

export const LATER_MILESTONE = 'Arrives in a later milestone'

/** The dotted "no signal" texture of a locked panel. */
function NoSignal({ className = 'h-[30px]' }: { readonly className?: string }) {
  return (
    <div
      className={`rounded-badge opacity-55 ${className}`}
      style={{ backgroundImage: 'radial-gradient(var(--ink-faint) .7px, transparent .9px)', backgroundSize: '4px 4px' }}
      aria-hidden
    />
  )
}

/** "Tracer" reads "tracer" mid-sentence; an acronym ("LLM judge") keeps its capitals. */
export function lowerFirst(name: string): string {
  return name.length > 1 && name[1] === name[1].toUpperCase() ? name : name.charAt(0).toLowerCase() + name.slice(1)
}

/** Picks a node's card in the LLMOps tab, ready to place. */
function PlaceButton({ nodeType, card }: { readonly nodeType: NodeType; readonly card: CardId }) {
  const price = useUiStore((s) => s.snapshot.prices[nodeType])
  const setTab = useUiStore((s) => s.setTab)
  const selectCard = useUiStore((s) => s.selectCard)
  return (
    <Button
      className="w-full"
      onClick={() => {
        setTab(5)
        selectCard(card)
      }}
    >
      <span>{`Place ${lowerFirst(price.name)}, ${formatWholeMoney(price.build)}`}</span>
    </Button>
  )
}

/** One label and value on a two-column panel grid. */
function Cell({ label, value, tone = 'ink', index }: { readonly label: string; readonly value: string; readonly tone?: 'ink' | 'warn' | 'alarm'; readonly index: number }) {
  return (
    <div className={`flex flex-col gap-0.5 ${index % 2 === 1 ? 'border-l border-hairline pl-2' : 'pr-2'}`}>
      <span className="text-hint text-ink-dim">{label}</span>
      <span className={`flex items-center gap-1.5 text-value ${tone === 'alarm' ? 'text-alarm' : tone === 'warn' ? 'text-warn' : 'text-ink'}`}>
        {tone === 'alarm' && <AlarmOctagon size={12} />}
        {tone === 'warn' && <WarnTriangle size={12} />}
        <Num>{value}</Num>
      </span>
    </div>
  )
}

/** "0.88 s", "4.8 s", "12 s". */
function seconds(s: number): string {
  return s < 1 ? `${s.toFixed(2)} s` : s < 10 ? `${s.toFixed(1)} s` : `${Math.round(s)} s`
}

/** A simple chat's deadline: a 95th percentile past it means users are leaving. */
const P95_WARN_SEC = 6

function LatencyPanel() {
  const tracing = useUiStore((s) => s.snapshot.tracing)
  const failed = useUiStore((s) => s.snapshot.trust.strip.reduce((sum, b) => sum + b.failed, 0))
  if (tracing === null)
    return (
      <Panel title="Latency" status="Locked" help="ttft-tpot" className="flex flex-col gap-2">
        <NoSignal />
        <div className="text-label text-pretty text-ink-dim">No telemetry. Place a tracer to see latency and token spend.</div>
        <PlaceButton nodeType="TRACER" card="tracer" />
      </Panel>
    )
  const p95 = tracing.latencyP95Sec
  return (
    <Panel title="Latency" help="ttft-tpot" className="grid grid-cols-2 gap-y-2">
      <Cell index={0} label="Median" value={tracing.latencyP50Sec === null ? 'None yet' : seconds(tracing.latencyP50Sec)} />
      <Cell index={1} label="95th percentile" value={p95 === null ? 'None yet' : seconds(p95)} tone={p95 !== null && p95 > P95_WARN_SEC ? 'warn' : 'ink'} />
      <Cell index={0} label="Failed, 30 s" value={String(failed)} tone={failed > 0 ? 'alarm' : 'ink'} />
    </Panel>
  )
}

/** A judged wrong rate past this reads amber. */
const WRONG_WARN = 0.05

function AnswerQualityPanel() {
  const quality = useUiStore((s) => s.snapshot.answerQuality)
  if (quality === null)
    return (
      <Panel title="Answer quality" help="OUTPUT_GUARDRAIL" className="flex flex-col gap-2">
        <div className="text-label text-ink-dim">Wrong answers are invisible without an eval.</div>
        <PlaceButton nodeType="LLM_JUDGE" card="judge" />
      </Panel>
    )
  const judged = quality.reduce((s, r) => s + r.judged, 0)
  const flagged = quality.reduce((s, r) => s + r.flagged, 0)
  const worst = [...quality].sort((a, b) => b.flagged / b.judged - a.flagged / a.judged).slice(0, 3)
  return (
    <Panel title="Answer quality" help="OUTPUT_GUARDRAIL" className="flex flex-col gap-2">
      <div className="grid grid-cols-2">
        <Cell index={0} label="Judged wrong" value={judged === 0 ? 'None yet' : `${((100 * flagged) / judged).toFixed(1)}%`} tone={judged > 0 && flagged / judged > WRONG_WARN ? 'warn' : 'ink'} />
        <Cell index={1} label="Samples" value={String(judged)} />
      </div>
      {worst.map((r) => (
        <div key={r.nodeId} className="flex justify-between gap-2 text-label">
          <span className="min-w-0 truncate text-ink-dim">{r.label}</span>
          <Num className={r.flagged / r.judged > WRONG_WARN ? 'text-warn' : 'text-ink'}>{`${r.flagged} of ${r.judged} wrong`}</Num>
        </div>
      ))}
    </Panel>
  )
}

/** Drift as a share of its cap: amber from half, red from 85%, as rack slots warn and alarm. */
const DRIFT_WARN = 0.5
const DRIFT_ALARM = 0.85

function RetrievalPanel() {
  const retrieval = useUiStore((s) => s.snapshot.retrieval)
  if (retrieval === null)
    return (
      <Panel title="Retrieval" help="rag-drift">
        <div className="flex items-center gap-2">
          <NoSignal className="h-4 w-10 flex-none" />
          <div className="text-label text-ink-dim">No telemetry. Place a vector DB to see drift.</div>
        </div>
      </Panel>
    )
  const level = retrieval.driftShare >= DRIFT_ALARM ? 'alarm' : retrieval.driftShare >= DRIFT_WARN ? 'warn' : 'ok'
  // A drift surge can push it past its cap (J-4): the meter stays full and says so.
  const past = retrieval.driftShare > 1
  return (
    <Panel title="Retrieval" help="rag-drift" className="flex flex-col gap-2.5">
      <Meter
        label="Vector drift"
        value={past ? `${formatShare(retrieval.driftShare)}, past its cap` : formatShare(retrieval.driftShare)}
        fraction={Math.min(1, retrieval.driftShare)}
        level={level === 'ok' ? 'ok' : level}
      />
      <div className="grid grid-cols-2">
        <div className="flex flex-col gap-0.5 pr-2">
          <span className="text-hint text-ink-dim">Drift</span>
          <span className={`flex items-center gap-1.5 text-value ${level === 'alarm' ? 'text-alarm' : level === 'warn' ? 'text-warn' : 'text-ink'}`}>
            {level === 'alarm' && <AlarmOctagon size={12} />}
            {level === 'warn' && <WarnTriangle size={12} />}
            <Num>{formatShare(retrieval.driftShare)}</Num>
          </span>
        </div>
        <div className="flex flex-col gap-0.5 border-l border-hairline pl-2">
          <span className="text-hint text-ink-dim">Re-index</span>
          {retrieval.reindexInSec === null ? (
            <span className="text-value text-ink-dim">No cron</span>
          ) : (
            <Num className="text-value">{`in ${formatClock(Math.ceil(retrieval.reindexInSec))}`}</Num>
          )}
        </div>
      </div>
    </Panel>
  )
}

function TokenSpendPanel() {
  const tracing = useUiStore((s) => s.snapshot.tracing)
  const perSec = useUiStore((s) => s.snapshot.money.tokenSpendPerSec)
  const selfHosted = useUiStore((s) => s.snapshot.nodes.filter((n) => n.vllm !== null).length)
  if (tracing === null)
    return (
      <Panel title="Token spend" status="Locked" help="tokens" className="flex flex-col gap-2">
        <NoSignal />
        <div className="text-label text-pretty text-ink-dim">No telemetry. Place a tracer to see latency and token spend.</div>
        <PlaceButton nodeType="TRACER" card="tracer" />
      </Panel>
    )
  const total = tracing.tokenSpend.reduce((s, r) => s + r.dollars, 0)
  const rows = [...tracing.tokenSpend].sort((a, b) => b.dollars - a.dollars).slice(0, 4)
  return (
    <Panel title="Token spend" status={`${formatWholeMoney(perSec)}/s`} help="tokens" className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <Meter key={r.nodeId} label={r.label} value={total > 0 ? formatShare(r.dollars / total) : '0%'} fraction={total > 0 ? r.dollars / total : 0} />
      ))}
      {selfHosted > 0 && <div className="text-label text-pretty text-ink-dim">Your vLLM nodes answer with no token cost; their price is upkeep.</div>}
    </Panel>
  )
}

export function RightOpsPanels({ width }: { readonly width: number }) {
  return (
    <div className="pointer-events-auto flex flex-col gap-3" style={{ width }}>
      <IncidentFeed />
      <LatencyPanel />
      <AnswerQualityPanel />
      <RetrievalPanel />
      <TokenSpendPanel />
    </div>
  )
}
