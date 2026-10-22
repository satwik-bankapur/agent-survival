/*
 * The node inspector (D36, design: 05 Paused and inspecting): a 360 px
 * drawer that slides over the right rail when a node is selected, so the
 * board stays in view. Its header names the node and its state, the grid
 * shows live stats from the 4 Hz snapshot, and a line teaches what the node
 * is for. Settings (D7, D15, D45, I-2, J-1, J-3, J-4) sit under the stats:
 * Users in's throttle, the cache's strictness, the vector DB's tier, a
 * coordinator's max steps, a model's prefix caching, circuit breaker and
 * provider, a vLLM cluster's tier with what its cold start costs, and the
 * judge's sampling rate.
 *
 * Only what the snapshot holds: queue, slots, utilization, drops. Answer
 * quality and latency need a judge and a tracer (D11); their panels are on
 * the right rail.
 */

import type { ReactNode } from 'react'

import type { NodeState, NodeTelemetry, NodeType, Strictness, TelemetrySnapshot, VectorDbTierTelemetry, VllmTierTelemetry } from '../engine'
import { useUiStore } from '../store/uiStore'
import { formatMoney, formatTrust, formatWholeMoney, sharedProviderNote } from './format'
import { TEACHING } from './guide'
import { HelpDot } from './HelpPanel'
import { Button } from './ui/Button'
import { NodeThumb } from './ui/NodeThumb'
import type { ThumbKind } from './ui/nodeThumbs'
import { Num } from './ui/Num'
import { SegmentedControl } from './ui/SegmentedControl'

export const INSPECTOR_WIDTH = 360

const THUMB: Partial<Record<NodeType, ThumbKind>> = {
  FRONTIER_API: 'frontier',
  FAST_SLM: 'slm',
  SEMANTIC_CACHE: 'cache',
  PROMPT_ROUTER: 'router',
  OUTPUT_GUARDRAIL: 'guard',
  PROMPT_FIREWALL: 'firewall',
  PII_REDACTOR: 'pii',
  VECTOR_DB: 'vdb',
  BM25_SEARCH: 'bm25',
  RERANKER: 'rerank',
  INGESTION_CRON: 'cron',
  LANGGRAPH_COORDINATOR: 'coord',
  MCP_WEB_SEARCH: 'web',
  MCP_CODE_SANDBOX: 'sandbox',
  HITL_GATE: 'hitl',
  VLLM_CLUSTER: 'vllm',
  POWER_SUBSTATION: 'sub',
  TRACER: 'tracer',
  LLM_JUDGE: 'judge',
}

/** The line under the name: what kind of thing this is and how it costs. */
function typeLine(type: NodeType, upkeepPerMin: number): string {
  switch (type) {
    case 'USERS_IN':
      return 'Where prompts arrive. Always on the board'
    case 'USERS_OUT':
      return 'Where answers land and get paid for'
    case 'FRONTIER_API':
      return 'Frontier API, hosted. Pays per token'
    case 'FAST_SLM':
      return `Fast SLM, a hosted Llama 8B endpoint. $${upkeepPerMin}/min`
    case 'SEMANTIC_CACHE':
      return `Semantic cache. $${upkeepPerMin}/min`
    case 'PROMPT_ROUTER':
      return `Prompt router. $${upkeepPerMin}/min`
    case 'OUTPUT_GUARDRAIL':
      return `Output guardrail. $${upkeepPerMin}/min`
    case 'PROMPT_FIREWALL':
      return `Prompt firewall. $${upkeepPerMin}/min`
    case 'PII_REDACTOR':
      return `PII redactor. $${upkeepPerMin}/min`
    case 'VECTOR_DB':
      return `Vector DB. $${upkeepPerMin}/min`
    case 'BM25_SEARCH':
      return `BM25 hybrid search. $${upkeepPerMin}/min`
    case 'RERANKER':
      return `Cross-encoder reranker. $${upkeepPerMin}/min`
    case 'INGESTION_CRON':
      return `Ingestion cron, no links needed. $${upkeepPerMin}/min`
    case 'LANGGRAPH_COORDINATOR':
      return `LangGraph coordinator. $${upkeepPerMin}/min`
    case 'MCP_WEB_SEARCH':
      return `MCP web search. $${upkeepPerMin}/min`
    case 'MCP_CODE_SANDBOX':
      return `MCP code sandbox. $${upkeepPerMin}/min`
    case 'HITL_GATE':
      return `Human review gate, $0.50 a review. $${upkeepPerMin}/min`
    case 'VLLM_CLUSTER':
      return `vLLM cluster, your own GPUs. $${upkeepPerMin.toLocaleString('en-US')}/min`
    case 'POWER_SUBSTATION':
      return `Power substation. $${upkeepPerMin}/min`
    case 'TRACER':
      return `Tracer, no links needed. $${upkeepPerMin}/min`
    case 'LLM_JUDGE':
      return `LLM judge, plus its tokens. $${upkeepPerMin}/min`
  }
}

const STATE_LABEL: Readonly<Record<NodeState, string>> = {
  idle: 'Idle',
  healthy: 'Healthy',
  busy: 'Busy',
  'queue-full': 'Queue full',
  'no-route': 'No route',
}

function StateDot({ state }: { readonly state: NodeState }) {
  if (state === 'queue-full') return <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="block"><polygon points="5,0.5 9.6,9.2 0.4,9.2" className="fill-warn" /></svg>
  if (state === 'no-route') return <span className="h-2 w-2 rounded-full border border-ink-dim" aria-hidden />
  return <span className={`h-2 w-2 rounded-full ${state === 'busy' ? 'bg-ink' : 'bg-ink-faint'}`} aria-hidden />
}

function Stat({ label, value, index }: { readonly label: string; readonly value: string; readonly index: number }) {
  return (
    <div className={`flex flex-col gap-0.5 px-3 py-2 ${index > 1 ? 'border-t border-hairline' : ''} ${index % 2 === 1 ? 'border-l border-hairline' : ''}`}>
      <span className="text-hint text-ink-dim">{label}</span>
      <Num className="text-value">{value}</Num>
    </div>
  )
}

interface Context {
  readonly trafficPerSec: number
  readonly trust: number
  /** Wrong answers users reported in the strip's 30 seconds. */
  readonly reported: number
  /** The provider's calls in flight and its limit, for a hosted model (D14). */
  readonly provider: { readonly inFlight: number; readonly limit: number } | null
  readonly power: TelemetrySnapshot['power']
  readonly tracing: TelemetrySnapshot['tracing']
  readonly answerQuality: TelemetrySnapshot['answerQuality']
}

/** Seconds with one decimal under 10, whole above: "0.88 s", "4.8 s", "12 s". */
function seconds(s: number | null): string {
  if (s === null) return 'None yet'
  return s < 1 ? `${s.toFixed(2)} s` : s < 10 ? `${s.toFixed(1)} s` : `${Math.round(s)} s`
}

/** "112K", for KV memory in tokens. */
function kTokens(n: number): string {
  return `${Math.round(n / 1000)}K`
}

function stats(node: NodeTelemetry, c: Context): [string, string][] {
  if (node.type === 'USERS_IN') return [['Arriving', `${c.trafficPerSec.toFixed(1)}/s`], ['Dropped', String(node.drops)]]
  if (node.type === 'USERS_OUT') return [['Trust', formatTrust(c.trust)], ['Reported wrong, 30 s', String(c.reported)]]
  if (node.type === 'POWER_SUBSTATION') return [['Power on the board', `${c.power.supplyKw} kW`], ['vLLM draws', `${c.power.drawKw} kW`]]
  if (node.type === 'TRACER') return [['Latency, median', seconds(c.tracing?.latencyP50Sec ?? null)], ['Latency, 95th', seconds(c.tracing?.latencyP95Sec ?? null)]]
  if (node.type === 'LLM_JUDGE') {
    const rows = c.answerQuality ?? []
    return [
      ['Answers judged', String(rows.reduce((s, r) => s + r.judged, 0))],
      ['Flagged wrong', String(rows.reduce((s, r) => s + r.flagged, 0))],
    ]
  }
  if (node.vllm !== null) {
    return [
      ['Queue', `${node.queue} of ${node.queueCapacity}`],
      ['Batch', `${node.busy} running`],
      ['KV memory', `${kTokens(node.vllm.kvInUse)} of ${kTokens(node.vllm.kvBudget)} tokens`],
      ['Power', `${node.vllm.kw} kW`],
    ]
  }
  const rows: [string, string][] = [
    ['Queue', `${node.queue} of ${node.queueCapacity}`],
    ['Slots in use', `${node.busy} of ${node.concurrency}`],
    ['Utilization', `${Math.round(node.utilization * 100)}%`],
    ['Dropped', String(node.drops)],
  ]
  // One provider's limit is shared by all its nodes (D14).
  if (c.provider !== null) {
    rows.push(['Provider calls', `${c.provider.inFlight} of ${c.provider.limit}`], ['Rate limit used', `${Math.round((c.provider.inFlight / c.provider.limit) * 100)}%`])
  }
  // A coordinator's slots are agent runs; past the runaway count a run shows as stuck (I-1).
  if (node.runs !== null) {
    rows[1] = ['Runs', `${node.runs.inFlight} of ${node.runs.max}`]
    rows.push(['Stuck runs', String(node.runs.stuck)])
  }
  if (node.blocks !== null) rows.push(['Attacks blocked', String(node.blocks)])
  return rows
}

// Up to phase 4's traffic: 24 prompts/s at 9:00, past 50 by 20:00 (J-5).
const THROTTLES = [0, 10, 20, 30, 40, 60] as const
const STRICTNESS: readonly { readonly key: Strictness; readonly label: string }[] = [
  { key: 'LOOSE', label: 'Loose' },
  { key: 'BALANCED', label: 'Balanced' },
  { key: 'STRICT', label: 'Strict' },
]

/** A small share with the precision it needs: "52%", "4.5%", "0.3%". */
function percent(share: number): string {
  const p = share * 100
  return p >= 10 ? `${Math.round(p)}%` : `${Number(p.toFixed(1))}%`
}

/** What raising a tier costs from the current one: every upgrade in between. */
function upgradeCost(tiers: readonly VectorDbTierTelemetry[], from: number, to: number): number {
  let cost = 0
  for (let t = from; t < to; t++) cost += tiers[t].upgrade
  return cost
}

/** A setting on one row: label left, control right. */
function Setting({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-hairline p-3">
      <span className="text-label text-ink-dim">{label}</span>
      {children}
    </div>
  )
}

/** A setting whose choices carry their numbers: label above, choices full width (design: HUD language). */
function SettingBlock({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-hairline p-3">
      <span className="text-label text-ink-dim">{label}</span>
      {children}
    </div>
  )
}

/** A provider's terms against the first one's, one line each: "20% cheaper", "30% slower". */
function providerTerms(p: { readonly priceMultiplier: number; readonly slownessMultiplier: number }): [string, string] {
  if (p.priceMultiplier === 1 && p.slownessMultiplier === 1) return ['List price', 'List speed']
  return [`${Math.round((1 - p.priceMultiplier) * 100)}% cheaper`, `${Math.round((p.slownessMultiplier - 1) * 100)}% slower`]
}

type SetFn = (key: string, value: number | boolean | string, success: string) => void

const BREAKER_STATE = { closed: 'Closed', open: 'Open, sending elsewhere', 'half-open': 'Half-open, probing' } as const

/** A model's circuit breaker (D29, J-4): paid once, then free to toggle; its state is loud, so it shows. */
function BreakerSetting({ node, set }: { readonly node: NodeTelemetry; readonly set: SetFn }) {
  const build = useUiStore((s) => s.snapshot.opsOptions.breakerBuild)
  const breaker = node.breaker
  if (breaker === null) return null
  return (
    <div className="flex flex-col gap-1.5 border-b border-hairline p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-label text-ink-dim">Circuit breaker</span>
        <SegmentedControl
          label="Circuit breaker"
          value={breaker.on ? 1 : 0}
          segments={[
            { key: 0, label: 'Off', title: 'Traffic keeps coming even while its provider fails' },
            { key: 1, label: breaker.bought ? 'On' : `On, ${formatWholeMoney(build)}`, title: 'Stops sending to it while its calls fail, then probes' },
          ]}
          onChange={(v) => set('breaker', v === 1, v === 1 ? `Circuit breaker on at ${node.label}.` : `Circuit breaker off at ${node.label}.`)}
        />
      </div>
      {breaker.on && (
        <span className={`text-hint ${breaker.state === 'open' ? 'text-alarm' : breaker.state === 'half-open' ? 'text-warn' : 'text-ink-dim'}`}>{BREAKER_STATE[breaker.state]}</span>
      )}
    </div>
  )
}

/** A cold start's line: what loading the weights burns before the first token (J-1). */
export function coldStartLine(tier: Pick<VllmTierTelemetry, 'coldStartCost'>): string {
  return `Loading weights: about ${formatWholeMoney(Math.round(tier.coldStartCost / 100) * 100 || Math.round(tier.coldStartCost))} of upkeep before first token`
}

/** A vLLM cluster's tier ladder, with each upgrade's cold start, and its breaker (J-1, J-4). */
function VllmSettings({ node, set }: { readonly node: NodeTelemetry; readonly set: SetFn }) {
  const tiers = useUiStore((s) => s.snapshot.opsOptions.vllmTiers)
  const spareKw = useUiStore((s) => s.snapshot.power.supplyKw - s.snapshot.power.drawKw)
  const vllm = node.vllm
  if (vllm === null) return null
  const current = vllm.tier
  return (
    <>
      <SettingBlock label="Model">
        {vllm.coldSecondsLeft > 0 && (
          <div role="status" className="flex items-center gap-2 rounded-control border border-warn px-2.5 py-1.5 text-label">
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="block flex-none">
              <polygon points="5,0.5 9.6,9.2 0.4,9.2" className="fill-warn" />
            </svg>
            <Num>{`Loading weights, ${Math.ceil(vllm.coldSecondsLeft)} s left. Upkeep runs, nothing is served.`}</Num>
          </div>
        )}
        <div role="radiogroup" aria-label="vLLM model" className="flex flex-col overflow-hidden rounded-control border border-hairline">
          {tiers.map((t, i) => {
            const tier = i + 1
            const on = tier === current
            const below = tier < current
            const extraKw = Number((t.kw - vllm.kw).toFixed(1))
            const noPower = tier > current && extraKw > spareKw + 1e-9
            return (
              <button
                key={t.name}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={below || noPower}
                title={noPower ? `Needs ${Number((extraKw - spareKw).toFixed(1))} kW more power. Place a power substation` : tier > current ? `Upgrade for ${formatMoney(t.upgrade)}, then $${t.upkeepPerMin}/min` : on ? 'Current model' : 'Tiers only go up'}
                onClick={() => {
                  if (tier > current && !noPower) set('tier', tier, `Upgrading ${node.label} to ${t.name}. Loading weights for ${t.coldStartSec} s.`)
                }}
                className={`grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 px-2.5 py-2 text-left ${i > 0 ? 'border-t border-hairline' : ''} ${
                  on ? 'bg-ink text-panel' : below || noPower ? 'bg-panel text-ink-faint' : 'cursor-pointer bg-panel text-ink hover:bg-panel-raised'
                }`}
              >
                <span className="text-label font-bold">{t.name}</span>
                <Num className="text-hint">{on ? 'Current' : below ? '' : `Upgrade ${formatWholeMoney(t.upgrade)}`}</Num>
                <span className="col-span-2 flex gap-2.5 text-hint opacity-85">
                  <Num>{`$${t.upkeepPerMin.toLocaleString('en-US')}/min`}</Num>
                  <Num>{`${t.kw} kW`}</Num>
                  <Num>{`${t.kvGb} GB KV`}</Num>
                </span>
                <span className="col-span-2 text-hint opacity-85">{coldStartLine(t)}</span>
              </button>
            )
          })}
        </div>
      </SettingBlock>
      <BreakerSetting node={node} set={set} />
    </>
  )
}

/** The judge's sampling rate (J-3): more samples, more tokens. */
function JudgeSettings({ node, set }: { readonly node: NodeTelemetry; readonly set: SetFn }) {
  const choices = useUiStore((s) => s.snapshot.opsOptions.judgeSampleChoices)
  const rate = node.sampleRate
  if (rate === null) return null
  return (
    <Setting label="Sampling">
      <SegmentedControl
        label="Share of answers the judge grades"
        value={rate}
        segments={choices.map((c) => ({ key: c, label: `${Math.round(c * 100)}%`, title: `Grade ${Math.round(c * 100)}% of answers, paying tokens for each` }))}
        onChange={(v) => set('sampleRate', v, `The judge now grades ${Math.round(v * 100)}% of answers.`)}
      />
    </Setting>
  )
}

/** A model's settings: prefix caching, its breaker, and for Frontier its provider (D5, D14, D29, I-2). */
function ModelSettings({ node, set }: { readonly node: NodeTelemetry; readonly set: SetFn }) {
  const options = useUiStore((s) => s.snapshot.agentOptions)
  const on = node.prefixCache === true
  const price = formatWholeMoney(options.prefixCacheBuild)
  return (
    <>
      <Setting label="Prefix caching">
        <SegmentedControl
          label="Prefix caching"
          value={on ? 1 : 0}
          segments={[
            { key: 0, label: 'Off', title: 'Every pass pays for its whole context' },
            { key: 1, label: node.prefixCacheBought === true ? 'On' : `On, ${price}`, title: 'Cached context is cheaper to re-read, but writing it costs more' },
          ]}
          onChange={(v) => set('prefixCache', v === 1, v === 1 ? `Prefix caching on at ${node.label}.` : `Prefix caching off at ${node.label}.`)}
        />
      </Setting>
      <BreakerSetting node={node} set={set} />
      {node.type === 'FRONTIER_API' && (
        <SettingBlock label="Provider">
          <div role="radiogroup" aria-label="Provider" className="flex overflow-hidden rounded-control border border-hairline">
            {options.providers.map((p, i) => {
              const chosen = p.name === node.provider
              return (
                <button
                  key={p.name}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  title={`Provider ${p.name} has its own rate limit`}
                  onClick={() => set('provider', p.name, `${node.label} now calls provider ${p.name}.`)}
                  className={`flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 px-2 py-1.5 text-left whitespace-nowrap ${i > 0 ? 'border-l border-hairline' : ''} ${
                    chosen ? 'bg-ink text-panel' : 'bg-panel text-ink hover:bg-panel-raised'
                  }`}
                >
                  <span className="text-label font-bold">Provider {p.name}</span>
                  {providerTerms(p).map((term) => (
                    <Num key={term} className="text-hint">
                      {term}
                    </Num>
                  ))}
                </button>
              )
            })}
          </div>
        </SettingBlock>
      )}
    </>
  )
}

function Settings({ node }: { readonly node: NodeTelemetry }) {
  const dispatch = useUiStore((s) => s.dispatch)
  const tiers = useUiStore((s) => s.snapshot.vectorDbTiers)
  const levels = useUiStore((s) => s.snapshot.cacheStrictness)
  const maxStepsChoices = useUiStore((s) => s.snapshot.agentOptions.maxStepsChoices)
  const set = (key: string, value: number | string | boolean, success: string) => dispatch({ type: 'setSetting', nodeId: node.id, key, value }, success)
  if (node.vllm !== null) return <VllmSettings node={node} set={set} />
  if (node.sampleRate !== null) return <JudgeSettings node={node} set={set} />
  if (node.prefixCache !== null) return <ModelSettings node={node} set={set} />
  if (node.maxSteps !== null) {
    return (
      <Setting label="Max steps">
        <SegmentedControl
          label="Max steps, model passes per run"
          value={node.maxSteps}
          segments={maxStepsChoices.map((v) => ({ key: v, label: v === 0 ? 'Off' : String(v), title: v === 0 ? 'Runs loop until they finish' : `Stop a run after ${v} model passes` }))}
          onChange={(v) => set('maxSteps', v, v === 0 ? `Max steps off at ${node.label}.` : `${node.label} stops runs after ${v} steps.`)}
        />
      </Setting>
    )
  }
  if (node.maxPerSec !== null) {
    return (
      <Setting label="Throttle">
        <SegmentedControl
          label="Throttle, prompts per second"
          value={node.maxPerSec}
          segments={THROTTLES.map((v) => ({ key: v, label: v === 0 ? 'Off' : `${v}/s`, title: v === 0 ? 'Let everything in' : `Turn away prompts over ${v} a second` }))}
          onChange={(v) => set('maxPerSec', v, v === 0 ? 'Throttle off.' : `Throttling at ${v} prompts a second.`)}
        />
      </Setting>
    )
  }
  if (node.strictness !== null) {
    const value = node.strictness
    return (
      <SettingBlock label="Strictness">
        <div role="radiogroup" aria-label="Cache strictness" className="flex overflow-hidden rounded-control border border-hairline">
          {STRICTNESS.map((level, i) => {
            const on = level.key === value
            const { maxHit, wrongHit } = levels[level.key]
            return (
              <button
                key={level.key}
                type="button"
                role="radio"
                aria-checked={on}
                title={`Warm, ${percent(maxHit)} of simple chats hit, and ${percent(wrongHit)} of hits are stale`}
                onClick={() => set('strictness', level.key, `${node.label} is now ${level.key.toLowerCase()}.`)}
                className={`flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 px-2 py-1.5 text-left whitespace-nowrap ${i > 0 ? 'border-l border-hairline' : ''} ${
                  on ? 'bg-ink text-panel' : 'bg-panel text-ink hover:bg-panel-raised'
                }`}
              >
                <span className="text-label font-bold">{level.label}</span>
                <Num className="text-hint">{`Hit ${percent(maxHit)}`}</Num>
                <Num className="text-hint">{`Wrong hit ${percent(wrongHit)}`}</Num>
              </button>
            )
          })}
        </div>
      </SettingBlock>
    )
  }
  if (node.tier !== null) {
    const current = node.tier
    return (
      <SettingBlock label="Index">
        <div role="radiogroup" aria-label="Vector DB tier" className="flex flex-col overflow-hidden rounded-control border border-hairline">
          {tiers.map((t, i) => {
            const tier = i + 1
            const on = tier === current
            const cost = upgradeCost(tiers, current, tier)
            // Tiers only go up: one below the current is spent, not a choice.
            const below = tier < current
            return (
              <button
                key={t.name}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={below}
                title={tier > current ? `Upgrade for ${formatMoney(cost)}, then $${t.upkeepPerMin}/min` : on ? 'Current tier' : 'Tiers only go up'}
                onClick={() => {
                  if (tier > current) set('tier', tier, `Upgraded ${node.label} to ${t.name}.`)
                }}
                className={`grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 px-2.5 py-2 text-left ${i > 0 ? 'border-t border-hairline' : ''} ${
                  on ? 'bg-ink text-panel' : below ? 'bg-panel text-ink-faint' : 'cursor-pointer bg-panel text-ink hover:bg-panel-raised'
                }`}
              >
                <span className="text-label font-bold">{t.name}</span>
                <Num className="text-hint">{on ? 'Current' : below ? '' : `Upgrade ${formatWholeMoney(cost)}`}</Num>
                <span className="col-span-2 flex gap-2.5 text-hint opacity-85">
                  <Num>{`Quality ${percent(t.quality)}`}</Num>
                  <Num>{`${t.serviceMs} ms`}</Num>
                  <Num>{`$${t.upkeepPerMin}/min`}</Num>
                </span>
              </button>
            )
          })}
        </div>
      </SettingBlock>
    )
  }
  return null
}

export function NodeInspectorDrawer() {
  const id = useUiStore((s) => s.selectedNodeId)
  const node = useUiStore((s) => (s.selectedNodeId === null ? undefined : s.snapshot.nodes.find((n) => n.id === s.selectedNodeId)))
  const prices = useUiStore((s) => s.snapshot.prices)
  const tiers = useUiStore((s) => s.snapshot.vectorDbTiers)
  const traffic = useUiStore((s) => s.snapshot.traffic.ratePerSec)
  const trust = useUiStore((s) => s.snapshot.trust.value)
  const providers = useUiStore((s) => s.snapshot.providers)
  const strip = useUiStore((s) => s.snapshot.trust.strip)
  const power = useUiStore((s) => s.snapshot.power)
  const tracing = useUiStore((s) => s.snapshot.tracing)
  const answerQuality = useUiStore((s) => s.snapshot.answerQuality)
  const vllmTiers = useUiStore((s) => s.snapshot.opsOptions.vllmTiers)
  // A string, so the drawer re-renders only when the note itself changes.
  const providerNote = useUiStore((s) => (node === undefined ? null : sharedProviderNote(s.snapshot.nodes, node.provider, node.id)))
  const select = useUiStore((s) => s.selectNode)
  const dispatch = useUiStore((s) => s.dispatch)
  const open = id !== null && node !== undefined

  const price = node === undefined ? undefined : prices[node.type]
  const thumb = node === undefined ? undefined : THUMB[node.type]
  const preplaced = node?.type === 'USERS_IN' || node?.type === 'USERS_OUT'
  const context: Context = {
    trafficPerSec: traffic,
    trust,
    reported: strip.reduce((sum, b) => sum + b.wrongReported, 0),
    provider: node?.type === 'FRONTIER_API' ? (providers.find((p) => p.name === node.provider) ?? null) : null,
    power,
    tracing,
    answerQuality,
  }
  const upkeepPerMin =
    node === undefined || price === undefined
      ? 0
      : node.vllm !== null
        ? (vllmTiers[node.vllm.tier - 1]?.upkeepPerMin ?? price.upkeepPerMin)
        : node.tier !== null
          ? (tiers[node.tier - 1]?.upkeepPerMin ?? price.upkeepPerMin)
          : price.upkeepPerMin

  return (
    <aside
      aria-label="Node inspector"
      aria-hidden={!open}
      className={`pointer-events-auto absolute flex flex-col rounded-panel border border-hairline bg-panel transition-[transform,opacity] duration-200 ease-out ${
        open ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-6 opacity-0'
      }`}
      style={{ right: 16, top: 72, width: INSPECTOR_WIDTH }}
    >
      {node !== undefined && price !== undefined && (
        <>
          <div className="flex items-center gap-3 border-b border-hairline p-3">
            <div className="flex h-[52px] w-16 flex-none items-center justify-center rounded-badge bg-panel-raised">
              {thumb !== undefined ? <NodeThumb kind={thumb} width={60} height={48} /> : <UsersGlyph />}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-value font-bold">{node.label}</span>
                  <HelpDot id={node.type} label={node.label} className="flex-none translate-y-[1px]" />
                </span>
                <button
                  type="button"
                  title="Close (Esc)"
                  aria-label="Close inspector"
                  onClick={() => select(null)}
                  className="flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-control border border-hairline bg-panel-raised text-ink hover:border-ink-dim"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden className="block">
                    <path d="M4 4l8 8M12 4l-8 8" />
                  </svg>
                </button>
              </div>
              <span className="text-label text-ink-dim">{typeLine(node.type, upkeepPerMin)}</span>
              {providerNote !== null && <span className="text-label text-ink-dim">{providerNote}</span>}
              <span className="mt-0.5 flex items-center gap-1.5 text-label">
                <StateDot state={node.state} />
                {STATE_LABEL[node.state]}
                {!preplaced && (
                  <>
                    ,{' '}
                    <Num>{`${node.busy} of ${node.concurrency}`}</Num> slots
                  </>
                )}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 border-b border-hairline">
            {stats(node, context).map(([label, value], i) => (
              <Stat key={label} label={label} value={value} index={i} />
            ))}
          </div>
          <Settings node={node} />
          {!preplaced && (
            <div className="flex items-center justify-between border-b border-hairline p-3">
              <button
                type="button"
                onClick={() => dispatch({ type: 'demolish', nodeId: node.id }, `Demolished ${node.label}. Refunded ${formatMoney(node.refund)}.`)}
                className="cursor-pointer py-1 text-body text-alarm underline underline-offset-[3px]"
              >
                Demolish, refund {formatMoney(node.refund)}
              </button>
              <Button disabled title="Arrives with the tracer, in a later milestone">
                Show in tracer
              </Button>
            </div>
          )}
          <p className="p-3 text-body text-pretty">{TEACHING[node.type]}</p>
        </>
      )}
    </aside>
  )
}

/** A few scale figures, for the user plazas, which have no build card. */
function UsersGlyph() {
  return (
    <svg width="40" height="30" viewBox="0 0 40 30" aria-hidden className="block">
      {[8, 16, 24, 32].map((x, i) => (
        <g key={x} transform={`translate(${x} ${i % 2 === 0 ? 10 : 13})`} style={{ fill: 'var(--figure)' }}>
          <circle cx="0" cy="0" r="2.4" />
          <rect x="-2.4" y="3" width="4.8" height="10" rx="2.2" />
        </g>
      ))}
    </svg>
  )
}
