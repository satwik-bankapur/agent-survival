/*
 * The left rail: money, trust, traffic and capacity, all from the 4 Hz
 * snapshot (design: LeftTelemetryHUD). Each panel subscribes to its own
 * slice, so a panel re-renders only when its slice changes.
 */

import { useEffect, useRef } from 'react'

import type { TelemetrySnapshot } from '../engine'
import { useUiStore } from '../store/uiStore'
import { formatDuration, formatMoney, formatRate, formatShare, formatTrust, trafficMix } from './format'
import { CountdownRing } from './ui/CountdownRing'
import { AlarmOctagon, CATEGORY_FILL, CATEGORY_LABEL, CategoryCue, WarnTriangle } from './ui/icons'
import { Meter, type Level } from './ui/Meter'
import { Num } from './ui/Num'
import { OutcomeStrip } from './ui/OutcomeStrip'
import { Panel } from './ui/Panel'
import { Sparkline } from './ui/Sparkline'
import { useCompact } from './ui/useCompact'

/** Bankrupt-in turns from amber to red with less than this left. */
export const BANKRUPT_ALARM_SEC = 60
/** Trust reads in plain ink above this; amber from here down to the critical line (design: Trust panel). */
export const TRUST_WARN_BELOW = 60
/** A provider meter turns amber at this share of its rate limit. */
export const RATE_LIMIT_WARN = 0.85

function MoneyPanel({ innerWidth }: { readonly innerWidth: number }) {
  const money = useUiStore((s) => s.snapshot.money)
  const compact = useCompact()
  const rows = [
    { label: 'Revenue', value: formatRate(money.revenuePerSec) },
    { label: 'Tokens', value: formatRate(-money.tokenSpendPerSec) },
    { label: 'Upkeep', value: formatRate(-money.upkeepPerSec) },
    // Breach fines (D43) get a cell only while there are any, so net always adds up.
    ...(money.finesPerSec > 0 ? [{ label: 'Fines', value: formatRate(-money.finesPerSec) }] : []),
  ]
  const bankrupt = money.bankruptInSec
  const bankruptAlarm = bankrupt !== null && bankrupt < BANKRUPT_ALARM_SEC
  const pulse = useNetTurnsNegative(money.netPerSec)
  return (
    // The wrapper carries the one red pulse when net turns negative.
    <div ref={pulse} className="rounded-panel">
      <Panel title="Money" status="Budget" help="tokens" className="flex flex-col gap-2">
        <Num className="text-readout tracking-[-.02em]">{formatMoney(money.budget)}</Num>
        <div className="grid text-hint" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}>
          {rows.map((row, i) => (
            <div key={row.label} className={`flex min-w-0 flex-col gap-px ${i > 0 ? 'border-l border-hairline pl-1.5' : ''}`}>
              <span className="text-ink-dim">{row.label}</span>
              <Num className="tracking-[-.03em] whitespace-nowrap">{row.value}</Num>
            </div>
          ))}
        </div>
        <div className="flex items-baseline justify-between border-t border-hairline pt-1.5">
          <span className="text-label font-bold">Net</span>
          <Num className="text-value">{formatRate(money.netPerSec)}</Num>
        </div>
        {!compact && (
          <div className="border-t border-hairline pt-2">
            <Sparkline values={money.history} floor={money.gameOverAt} width={innerWidth} />
          </div>
        )}
        {bankrupt !== null && (
          <div className={`flex items-center gap-1.5 text-label ${bankruptAlarm ? 'text-alarm' : 'text-warn'}`} role="status">
            {bankruptAlarm ? <AlarmOctagon /> : <WarnTriangle />}
            <span className="type-num">Bankrupt in {formatDuration(bankrupt)}</span>
          </div>
        )}
      </Panel>
    </div>
  )
}

/**
 * One red pulse on the money panel each time net turns negative: two beats, then still. The
 * class is restarted in place, so the panel never re-renders for it; reduced motion drops it in CSS.
 */
function useNetTurnsNegative(net: number) {
  const el = useRef<HTMLDivElement>(null)
  const wasNegative = useRef(net < 0)
  useEffect(() => {
    const negative = net < 0
    if (negative && !wasNegative.current && el.current !== null) {
      el.current.classList.remove('net-pulse')
      void el.current.offsetWidth
      el.current.classList.add('net-pulse')
    }
    wasNegative.current = negative
  }, [net])
  return el
}

function TrustLegendSwatch({ kind }: { readonly kind: 'good' | 'refused' | 'timedOut' | 'wrong' | 'unknown' }) {
  const look = {
    good: 'bg-ink-dim',
    refused: 'border border-ink-faint',
    timedOut: 'bg-warn',
    wrong: 'bg-alarm',
    unknown: 'border border-dashed border-ink-dim',
  }[kind]
  return <span className={`size-2 flex-none ${look}`} aria-hidden />
}

function TrustPanel() {
  const trust = useUiStore((s) => s.snapshot.trust)
  const wrongSeen = useUiStore((s) => s.wrongAnswersSeen)
  const critical = trust.criticalSecondsLeft !== null
  const level: Level = critical ? 'alarm' : trust.value < TRUST_WARN_BELOW ? 'warn' : 'ok'
  const ink = { ok: 'text-ink', warn: 'text-warn', alarm: 'text-alarm' }[level]
  return (
    <Panel title="Trust" status="Last 30 s" help="USERS_OUT" alarm={critical} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className={`flex items-center gap-2 ${ink}`}>
          {level === 'warn' && (
            <svg width="16" height="16" viewBox="0 0 16 16" className="block" aria-label="Warning">
              <polygon points="8,1.5 15,14 1,14" fill="none" stroke="var(--warn)" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
          )}
          {level === 'alarm' && (
            <svg width="16" height="16" viewBox="0 0 16 16" className="block" aria-label="Critical">
              <polygon points="5,1 11,1 15,5 15,11 11,15 5,15 1,11 1,5" fill="var(--alarm)" />
            </svg>
          )}
          <Num className="text-readout tracking-[-.02em]">{formatTrust(trust.value)}</Num>
        </div>
        {trust.criticalSecondsLeft !== null && <CountdownRing secondsLeft={trust.criticalSecondsLeft} totalSec={trust.criticalSec} />}
      </div>
      <OutcomeStrip strip={trust.strip} />
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-hint leading-[13px] text-ink-dim">
        <span className="flex items-center gap-[5px]">
          <TrustLegendSwatch kind="good" />
          Good
        </span>
        <span className="flex items-center gap-[5px]">
          <TrustLegendSwatch kind="refused" />
          Refused
        </span>
        <span className="flex items-center gap-[5px]">
          <TrustLegendSwatch kind="timedOut" />
          Timed out
        </span>
        <span className="flex items-center gap-[5px]">
          <TrustLegendSwatch kind={wrongSeen ? 'wrong' : 'unknown'} />
          {wrongSeen ? 'Wrong answer' : 'Wrong answers: unknown'}
        </span>
      </div>
    </Panel>
  )
}

function TrafficPanel() {
  const traffic = useUiStore((s) => s.snapshot.traffic)
  // All five kinds from the start, at 0% until they arrive, so the legend never jumps about at 4 Hz.
  const mix = trafficMix(traffic)
  return (
    <Panel title="Traffic" help="throttling" className="flex flex-col gap-2">
      <div className="flex items-baseline gap-1.5">
        <Num className="text-value-lg">{String(Math.round(traffic.ratePerSec))}</Num>
        <span className="text-label text-ink-dim">prompts/s</span>
      </div>
      <div className="flex h-2 gap-px overflow-hidden rounded-badge bg-panel-raised" aria-hidden>
        {mix.map((m) => (
          <div key={m.category} style={{ width: `${m.share * 100}%`, background: CATEGORY_FILL[m.category] }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-hint">
        {mix.map((m) => (
          <span key={m.category} className="flex items-center gap-1" title={CATEGORY_LABEL[m.category]}>
            <CategoryCue category={m.category} />
            <Num>{formatShare(m.share)}</Num>
          </span>
        ))}
      </div>
      {traffic.next !== null && (
        <div className="flex gap-1.5 border-t border-hairline pt-2 text-label text-ink-dim">
          <span className="flex-none font-bold text-ink">Next</span>
          <span>{traffic.next.text}</span>
        </div>
      )}
    </Panel>
  )
}

/** GPU memory in use, GB, over every vLLM node: each node's KV share of its tier's memory (D22). */
function gpuMemory(nodes: TelemetrySnapshot['nodes'], tiers: TelemetrySnapshot['opsOptions']['vllmTiers']): { used: number; total: number } {
  let used = 0
  let total = 0
  for (const n of nodes) {
    if (n.vllm === null) continue
    const gb = tiers[n.vllm.tier - 1]?.kvGb ?? 0
    total += gb
    used += n.vllm.kvBudget > 0 ? (gb * n.vllm.kvInUse) / n.vllm.kvBudget : 0
  }
  return { used, total }
}

function CapacityPanel() {
  const providers = useUiStore((s) => s.snapshot.providers)
  const power = useUiStore((s) => s.snapshot.power)
  const nodes = useUiStore((s) => s.snapshot.nodes)
  const tiers = useUiStore((s) => s.snapshot.opsOptions.vllmTiers)
  const memory = gpuMemory(nodes, tiers)
  return (
    <Panel title="Capacity" help="ttft-tpot" className="flex flex-col gap-2.5">
      {providers.length === 0 && power.supplyKw === 0 && <div className="text-label text-ink-dim">No hosted providers or GPUs on the board.</div>}
      {providers.map((p) => {
        const fraction = p.limit > 0 ? p.inFlight / p.limit : 0
        // An outage is loud (J-4): the hatched red alarm fill the design keeps for it.
        return (
          <Meter
            key={p.name}
            label={`Frontier ${p.name}`}
            value={p.down ? 'Outage' : `${Math.round(fraction * 100)}% of rate limit`}
            fraction={fraction}
            level={p.down ? 'alarm' : fraction >= RATE_LIMIT_WARN ? 'warn' : 'ok'}
          />
        )
      })}
      {power.supplyKw > 0 && (
        <Meter
          label="Power"
          value={`${Number(power.drawKw.toFixed(1))} of ${power.supplyKw} kW`}
          fraction={power.drawKw / power.supplyKw}
          level={power.drawKw / power.supplyKw >= RATE_LIMIT_WARN ? 'warn' : 'ok'}
        />
      )}
      {memory.total > 0 && (
        <Meter
          label="GPU memory"
          value={`${Math.round(memory.used)} of ${memory.total} GB`}
          fraction={memory.used / memory.total}
          level={memory.used / memory.total >= RATE_LIMIT_WARN ? 'warn' : 'ok'}
        />
      )}
    </Panel>
  )
}

export function LeftTelemetryHUD({ width }: { readonly width: number }) {
  const compact = useCompact()
  // Border plus padding on each side.
  const innerWidth = width - 2 - (compact ? 20 : 24)
  return (
    <div className="pointer-events-auto flex flex-col gap-3" style={{ width }}>
      <MoneyPanel innerWidth={innerWidth} />
      <TrustPanel />
      <TrafficPanel />
      <CapacityPanel />
    </div>
  )
}
