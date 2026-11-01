/*
 * The postmortem (design: "Postmortem"): the one light screen, a drafting
 * sheet laid a little askew over the desk, written up from the run log like
 * an incident review.
 *
 *   header        the cause and time, and the run, seed and mode
 *   facts         survived, final budget, answers, wrong answers, timeouts, tokens, seed
 *   timeline      budget and trust over the run, with phases and markers
 *   review        root cause, contributing factors, what went well
 *   final board   the board as it ended, with the node most to blame tagged
 *   action items  the nodes that would have helped, with checkboxes
 *   buttons       Retry this seed (R), Retry with this build, New run
 *
 * It may show ground truth, such as which model gave users wrong answers,
 * because the run is over (D39). The postmortem itself comes from src/run.ts.
 */

import { useEffect, useMemo, useState } from 'react'

import type { NodeType, Postmortem } from '../engine'
import { retrySeed, retryWithBuild, toTitle } from '../run'
import { useRunStore, type FinalBoard, type RunMode } from '../store/runStore'
import { formatClock, formatMoney, formatRunNumber, formatSeed, formatTokens, MINUS } from './format'
import { guideEntry } from './guide'
import { HelpDot } from './HelpPanel'
import { NodeThumb } from './ui/NodeThumb'
import type { ThumbKind } from './ui/nodeThumbs'
import { Num } from './ui/Num'

const MODE_NAME: Record<RunMode, string> = { survival: 'Survival', sandbox: 'Sandbox', daily: 'Daily outage' }

const THUMB: Record<NodeType, ThumbKind> = {
  USERS_IN: 'slm',
  USERS_OUT: 'slm',
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

// ---------------------------------------------------------------------------
// The budget-and-trust chart
// ---------------------------------------------------------------------------

const W = 1008
const H = 268
const PAD = { left: 64, right: 48, top: 50, bottom: 28 }
/** Budget gridlines fall on multiples of this. */
const BUDGET_STEP = 350
const MARKER_ROW_PX = 14
const MARKER_ROWS = 3
/** Phase bands alternate between these sheet greys (design). */
const BANDS = ['#E6EAE7', '#DCE3E3']

/** Four even budget steps that cover every value, each a whole multiple of BUDGET_STEP. */
export function budgetAxis(values: readonly number[]): { lo: number; step: number } {
  let min = 0
  let max = 0
  for (const v of values) {
    min = Math.min(min, v)
    max = Math.max(max, v)
  }
  for (let k = 1; ; k++) {
    const step = BUDGET_STEP * k
    const lo = Math.floor(min / step) * step
    if (lo + step * 4 >= max) return { lo, step }
  }
}

/** Rough label width on the chart, px: B612 at 11 px. */
function labelWidth(text: string): number {
  return text.length * 6.2 + 8
}

/** Puts each marker label in the first row where it clears the labels already there. */
export function markerRows(markers: readonly { readonly x: number; readonly right: boolean; readonly width: number }[], rows: number): number[] {
  const ends: number[][] = Array.from({ length: rows }, () => [])
  return markers.map((m) => {
    const x0 = m.right ? m.x - m.width : m.x
    const x1 = m.right ? m.x : m.x + m.width
    for (let r = 0; r < rows; r++) {
      if (ends[r].every((span, i) => i % 2 === 1 || x1 < span || x0 > ends[r][i + 1])) {
        ends[r].push(x0, x1)
        return r
      }
    }
    return rows - 1
  })
}

function axisMoney(v: number): string {
  const text = Math.abs(v).toLocaleString('en-US')
  return v < 0 ? `${MINUS}$${text}` : `$${text}`
}

function Chart({ pm }: { pm: Postmortem }) {
  const end = Math.max(pm.endSec, 1)
  const w = W - PAD.left - PAD.right
  const h = H - PAD.top - PAD.bottom
  const { lo, step } = budgetAxis(pm.budget)
  const hi = lo + step * 4
  const x = (s: number) => PAD.left + (Math.min(s, end) / end) * w
  const yb = (v: number) => PAD.top + h - ((v - lo) / (hi - lo)) * h
  const yt = (v: number) => PAD.top + h - (v / 100) * h
  // Samples are one a second; the last is the end of the run.
  const at = (i: number, n: number) => (i === n - 1 ? end : i)
  const budget = pm.budget.map((v, i) => `${x(at(i, pm.budget.length)).toFixed(1)},${yb(v).toFixed(1)}`).join(' ')
  const trust = pm.trust.map((v, i) => `${x(at(i, pm.trust.length)).toFixed(1)},${yt(v).toFixed(1)}`).join(' ')
  const ticks: number[] = []
  const tickEvery = end > 600 ? 120 : 60
  for (let t = 0; t <= end; t += tickEvery) ticks.push(t)
  const gridlines = [0, 1, 2, 3, 4].map((k) => lo + step * k)
  const right = (sec: number) => x(sec) > PAD.left + w * 0.7
  const rows = markerRows(
    pm.markers.map((m) => ({ x: x(m.sec), right: right(m.sec), width: labelWidth(m.text) })),
    MARKER_ROWS,
  )
  const critical = pm.cause === 'TRUST' ? pm.markers.find((m) => m.alarm && m.text.includes('trust below')) : undefined

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="block font-hud" role="img" aria-label="Budget and trust over the run">
      {pm.phases.map((p, i) => {
        const next = pm.phases[i + 1]?.startSec ?? end
        return (
          <g key={p.name}>
            <rect x={x(p.startSec)} y={PAD.top} width={x(next) - x(p.startSec)} height={h} fill={BANDS[i % 2]} />
            <text x={x(p.startSec) + 6} y={PAD.top + h - 8} fontSize="12" fill="var(--sheet-ink)">
              {p.name}
            </text>
          </g>
        )
      })}
      {gridlines.map((v) => (
        <g key={v}>
          <line x1={PAD.left} x2={PAD.left + w} y1={yb(v)} y2={yb(v)} stroke="#C3CBCE" strokeWidth=".7" />
          <text x={PAD.left - 8} y={yb(v) + 4} textAnchor="end" fontFamily="var(--font-num)" fontSize="11" fill="#3E5466">
            {axisMoney(v)}
          </text>
        </g>
      ))}
      {[0, 25, 50, 75, 100].map((v) => (
        <text key={v} x={PAD.left + w + 8} y={yt(v) + 4} fontFamily="var(--font-num)" fontSize="11" fill="#3E5466">
          {v}%
        </text>
      ))}
      <line x1={PAD.left} x2={PAD.left + w} y1={yt(25)} y2={yt(25)} stroke="var(--sheet-alarm)" strokeDasharray="2 2" />
      {ticks.map((t) => (
        <text key={t} x={x(t)} y={H - 8} textAnchor="middle" fontFamily="var(--font-num)" fontSize="11" fill="#3E5466">
          {formatClock(t)}
        </text>
      ))}
      {critical !== undefined && <rect x={x(critical.sec)} y={PAD.top} width={x(end) - x(critical.sec)} height={h} fill="var(--sheet-alarm)" opacity=".12" />}
      <polyline points={budget} fill="none" stroke="var(--sheet-ink)" strokeWidth="2" strokeLinejoin="round" />
      <polyline points={trust} fill="none" stroke="var(--sheet-ink)" strokeWidth="2" strokeDasharray="5 3" strokeLinejoin="round" />
      {pm.markers.map((m, i) => {
        const mx = x(m.sec)
        const my = 6 + rows[i] * MARKER_ROW_PX
        const color = m.alarm ? 'var(--sheet-alarm)' : 'var(--sheet-ink)'
        const onRight = right(m.sec)
        return (
          <g key={`${m.sec}-${m.text}`}>
            <line x1={mx} x2={mx} y1={my + 3} y2={PAD.top + h} stroke={color} strokeWidth="1" />
            <circle cx={mx} cy={my + 3} r="2.5" fill={color} />
            <text x={onRight ? mx - 6 : mx + 6} y={my + 7} textAnchor={onRight ? 'end' : 'start'} fontSize="11" fill={color}>
              {m.text}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// The final board, with the blamed node tagged
// ---------------------------------------------------------------------------

const BOARD_BOX_H = 300

function FinalBoardView({ board, tag, boxWidth }: { board: FinalBoard; tag: string | null; boxWidth: number }) {
  // Cover the box, centred on the tagged node if there is one.
  const scale = Math.max(boxWidth / board.width, BOARD_BOX_H / board.height) * 1.15
  const cx = board.tag?.x ?? board.width / 2
  const cy = board.tag?.y ?? board.height / 2
  const left = Math.min(0, Math.max(boxWidth - board.width * scale, boxWidth / 2 - cx * scale))
  const top = Math.min(0, Math.max(BOARD_BOX_H - board.height * scale, BOARD_BOX_H / 2 - cy * scale))
  const tx = board.tag === null ? 0 : left + board.tag.x * scale
  const ty = board.tag === null ? 0 : top + board.tag.y * scale
  return (
    <div className="relative overflow-hidden border border-sheet-ink bg-desk" style={{ height: BOARD_BOX_H }}>
      <img
        src={board.image}
        alt="The board as the run ended"
        className="absolute max-w-none"
        style={{ left, top, width: board.width * scale, height: board.height * scale }}
      />
      {board.tag !== null && tag !== null && (
        <>
          <div
            className="pointer-events-none absolute rounded-full"
            style={{ left: tx - 34, top: ty - 30, width: 68, height: 68, background: 'radial-gradient(circle, rgb(255 68 51 / .55) 0%, rgb(255 68 51 / 0) 70%)' }}
          />
          <div
            className="absolute flex items-center gap-1.5 rounded-badge border border-sheet-ink bg-sheet px-1.5 py-0.5 text-[11px] whitespace-nowrap text-sheet-ink"
            style={{ left: Math.min(tx + 22, boxWidth - 200), top: Math.max(6, ty - 46) }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" className="block" aria-hidden>
              <polygon points="3,0 7,0 10,3 10,7 7,10 3,10 0,7 0,3" fill="var(--sheet-alarm)" />
            </svg>
            {tag}
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="border-b border-sheet-ink pb-1.5 text-label font-bold">{title}</div>
      {children}
    </div>
  )
}

function NumberedList({ items }: { items: readonly string[] }) {
  return (
    <>
      {items.map((text, i) => (
        <div key={text} className="grid grid-cols-[24px_1fr] text-body">
          <span className="type-num text-[#3E5466]">{i + 1}</span>
          <span className="text-pretty">{text}</span>
        </div>
      ))}
    </>
  )
}

/** The sheet's inner width, px: 1120 less its padding, and the right column's share of that. */
const SHEET_INNER = 1120 - 112
const RIGHT_COLUMN = Math.round(((SHEET_INNER - 48) * 1) / 2.25)

export function PostmortemScreen() {
  const pm = useRunStore((s) => s.postmortem)
  const board = useRunStore((s) => s.finalBoard)
  const config = useRunStore((s) => s.config)
  const runNumber = useRunStore((s) => s.runNumber)
  const [done, setDone] = useState<ReadonlySet<number>>(new Set())

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') {
        if (e.ctrlKey || e.metaKey || e.altKey) return
        e.preventDefault()
        retrySeed()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const facts = useMemo(() => {
    if (pm === null) return []
    return [
      { k: 'Survived', v: formatClock(pm.facts.survivedSec), bad: false },
      { k: 'Final budget', v: formatMoney(pm.facts.finalBudget), bad: pm.facts.finalBudget < 0 },
      { k: 'Prompts answered', v: pm.facts.answered.toLocaleString('en-US'), bad: false },
      { k: 'Wrong answers users saw', v: pm.facts.wrongSeen.toLocaleString('en-US'), bad: pm.facts.wrongSeen > 0 },
      { k: 'Timeouts', v: pm.facts.timeouts.toLocaleString('en-US'), bad: false },
      { k: 'Tokens used', v: formatTokens(pm.facts.tokens), bad: false },
      { k: 'Seed', v: formatSeed(pm.seed), bad: false },
    ]
  }, [pm])

  if (pm === null || config === null) return null
  const ended = formatClock(pm.endSec)
  return (
    <main className="relative h-full w-full overflow-x-hidden overflow-y-auto bg-desk font-hud text-sheet-ink">
      {board !== null && (
        <div className="pointer-events-none absolute top-[120px] -right-[260px] h-[900px] w-[1440px] opacity-50" aria-hidden>
          <img src={board.image} alt="" className="h-full w-full object-cover" />
        </div>
      )}
      <article
        className="relative mt-14 mb-16 ml-[72px] flex w-[1120px] origin-top-left flex-col gap-10 rounded-[2px] bg-sheet px-14 pt-12 pb-14 shadow-[12px_18px_36px_rgb(0_0_0/0.55)]"
        style={{ transform: 'rotate(-0.4deg)' }}
      >
        <header className="flex items-start justify-between gap-8">
          <div className="flex flex-col gap-3">
            <h1 className="type-display text-display whitespace-nowrap">Postmortem for run {formatRunNumber(runNumber)}</h1>
            <p className="text-value leading-6 text-pretty">{pm.headline}</p>
          </div>
          <div className="grid flex-none grid-cols-[auto_auto] border border-sheet-ink text-label">
            <span className="border-r border-b border-sheet-ink px-2.5 py-1.5 text-[#3E5466]">Run</span>
            <Num className="border-b border-sheet-ink px-2.5 py-1.5">{formatRunNumber(runNumber)}</Num>
            <span className="border-r border-b border-sheet-ink px-2.5 py-1.5 text-[#3E5466]">Seed</span>
            <Num className="border-b border-sheet-ink px-2.5 py-1.5 whitespace-nowrap">{formatSeed(pm.seed)}</Num>
            <span className="border-r border-sheet-ink px-2.5 py-1.5 text-[#3E5466]">Mode</span>
            <span className="px-2.5 py-1.5">{MODE_NAME[config.mode]}</span>
          </div>
        </header>

        <div className="grid grid-cols-7 border-t-2 border-b border-sheet-ink">
          {facts.map((f, i) => (
            <div key={f.k} className={`flex flex-col gap-1 px-3 pt-3 pb-3.5 ${i > 0 ? 'border-l border-[#C3CBCE]' : ''}`}>
              <span className="text-label text-[#3E5466]">{f.k}</span>
              <Num className={`text-value-lg leading-7 whitespace-nowrap ${f.bad ? 'text-sheet-alarm' : ''}`}>{f.v}</Num>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <span className="text-value font-bold">Budget and trust, 0:00 to {ended}</span>
            <span className="flex gap-5 text-label">
              <span className="flex items-center gap-1.5">
                <svg width="20" height="4" className="block" aria-hidden>
                  <line x1="0" y1="2" x2="20" y2="2" stroke="var(--sheet-ink)" strokeWidth="2" />
                </svg>
                Budget
              </span>
              <span className="flex items-center gap-1.5">
                <svg width="20" height="4" className="block" aria-hidden>
                  <line x1="0" y1="2" x2="20" y2="2" stroke="var(--sheet-ink)" strokeWidth="2" strokeDasharray="4 3" />
                </svg>
                Trust
              </span>
              <span className="flex items-center gap-1.5">
                <svg width="20" height="4" className="block" aria-hidden>
                  <line x1="0" y1="2" x2="20" y2="2" stroke="var(--sheet-alarm)" strokeWidth="1" strokeDasharray="2 2" />
                </svg>
                Trust 25%
              </span>
            </span>
          </div>
          <Chart pm={pm} />
        </div>

        <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-12">
          <div className="flex flex-col gap-8">
            <Section title="Root cause">
              <p className="text-[21px] leading-[30px] text-pretty">{pm.rootCause}</p>
            </Section>
            {pm.factors.length > 0 && (
              <Section title="Contributing factors">
                <NumberedList items={pm.factors} />
              </Section>
            )}
            <Section title="What went well">
              <NumberedList items={pm.wentWell} />
            </Section>
          </div>
          <div className="flex flex-col gap-8">
            <Section title={`Final board at ${ended}`}>
              {board !== null ? (
                <FinalBoardView board={board} tag={pm.worst?.text ?? null} boxWidth={RIGHT_COLUMN} />
              ) : (
                <div className="flex h-[300px] items-center justify-center border border-sheet-ink text-label text-[#3E5466]">No picture of the board.</div>
              )}
            </Section>
            {pm.actions.length > 0 && (
              <Section title="Action items">
                <div className="flex flex-col">
                  {pm.actions.map((a, i) => {
                    const on = done.has(i)
                    return (
                      <label key={a.text} className="grid cursor-pointer grid-cols-[20px_52px_1fr] items-center gap-2.5 border-b border-[#C9D0D3] py-1.5 text-body">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() =>
                            setDone((d) => {
                              const next = new Set(d)
                              if (next.has(i)) next.delete(i)
                              else next.add(i)
                              return next
                            })
                          }
                          className="size-4 cursor-pointer accent-sheet-ink"
                        />
                        <span className="flex h-10 w-[52px] items-center justify-center rounded-[2px] bg-mat">
                          <NodeThumb kind={THUMB[a.nodeType]} width={48} height={36} />
                        </span>
                        <span className={`flex items-baseline gap-1.5 text-pretty ${on ? 'line-through decoration-1' : ''}`}>
                          {a.text}
                          <HelpDot id={a.nodeType} label={guideEntry(a.nodeType)?.name ?? 'this'} className="translate-y-[2px] border-[#8A99A6] text-[#3E5466] hover:border-sheet-ink hover:text-sheet-ink" />
                        </span>
                      </label>
                    )
                  })}
                </div>
              </Section>
            )}
          </div>
        </div>

        <footer className="flex items-center gap-3 border-t-2 border-sheet-ink pt-6">
          <button
            type="button"
            onClick={retrySeed}
            className="flex h-11 cursor-pointer items-center gap-2.5 rounded-control border border-sheet-ink bg-sheet-ink px-5 text-body font-bold whitespace-nowrap text-sheet"
          >
            Retry this seed
            <span className="type-num rounded-[2px] border border-[#6F93B3] px-1 text-hint font-normal">R</span>
          </button>
          <button type="button" onClick={retryWithBuild} className="h-11 cursor-pointer rounded-control border border-sheet-ink px-5 text-body whitespace-nowrap hover:bg-[#E3E8E6]">
            Retry with this build
          </button>
          <button type="button" onClick={toTitle} className="h-11 cursor-pointer rounded-control border border-sheet-ink px-5 text-body whitespace-nowrap hover:bg-[#E3E8E6]">
            New run
          </button>
        </footer>
      </article>
    </main>
  )
}
