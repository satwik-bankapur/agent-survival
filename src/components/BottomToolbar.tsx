/*
 * The build toolbar: four tools with key hints, five tabs, and the node
 * cards for the open tab (design: BottomToolbar). Card states are default,
 * hover, selected (reverse video), can't afford, blocked and new. Only the
 * Milestone 1 cards are live; the rest are locked until their milestone.
 *
 * Tools and cards set UI state only. Placing, linking and the keyboard
 * arrive in Session 4.
 */

import type { ReactNode } from 'react'

import { TOOLBAR_HEIGHT } from './ui/useCompact'
import { useUiStore, type Tool } from '../store/uiStore'
import { formatMoney } from './format'
import { CARDS, CARD_KEYS, NEW_CARDS, PREFIX_CARD_REASON, TABS, upkeepLabel, type CardDef } from './nodeCards'
import { LATER_MILESTONE } from './RightOpsPanels'
import { NodeThumb } from './ui/NodeThumb'

const TOOLS: readonly { readonly tool: Tool; readonly name: string; readonly key: string; readonly icon: ReactNode }[] = [
  { tool: 'select', name: 'Select', key: 'V', icon: <path d="M5 3l11 5.2-4.6 1.6L9.6 15z" /> },
  {
    tool: 'link',
    name: 'Link',
    key: 'C',
    icon: (
      <>
        <circle cx="4.5" cy="10" r="2.5" />
        <circle cx="15.5" cy="10" r="2.5" />
        <path d="M7 10h6" />
      </>
    ),
  },
  {
    tool: 'unlink',
    name: 'Unlink',
    key: 'U',
    icon: (
      <>
        <circle cx="4.5" cy="10" r="2.5" />
        <circle cx="15.5" cy="10" r="2.5" />
        <path d="M7 10h1.6M11.4 10H13M9 13.5l2-7" />
      </>
    ),
  },
  {
    tool: 'demolish',
    name: 'Demolish',
    key: 'X',
    icon: (
      <>
        <rect x="4" y="7" width="12" height="9" rx="1" />
        <path d="M7 4h6M9 9.5l-1.5 2.5 2 1-1 2.5M12.5 9l-1 3" />
      </>
    ),
  },
]

function Tools() {
  const tool = useUiStore((s) => s.tool)
  const setTool = useUiStore((s) => s.setTool)
  return (
    <div className="grid flex-none grid-cols-[44px_44px] content-center gap-1 border-r border-hairline p-2" role="radiogroup" aria-label="Tools">
      {TOOLS.map((t) => {
        const on = t.tool === tool
        return (
          <button
            key={t.tool}
            type="button"
            role="radio"
            aria-checked={on}
            title={`${t.name} (${t.key})`}
            onClick={() => setTool(t.tool)}
            className={`relative flex size-11 cursor-pointer items-center justify-center rounded-control border border-hairline p-0 ${
              on ? 'bg-ink text-panel' : 'bg-panel-raised text-ink hover:border-ink-dim'
            }`}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {t.icon}
            </svg>
            <span className="type-num absolute right-[3px] bottom-0.5 text-[10px] leading-[10px] opacity-80">{t.key}</span>
          </button>
        )
      })}
    </div>
  )
}

function Tabs() {
  const tab = useUiStore((s) => s.tab)
  const setTab = useUiStore((s) => s.setTab)
  return (
    <div className="flex h-8 flex-none border-b border-hairline" role="tablist" aria-label="Node groups">
      {TABS.map((t) => {
        const on = t.tab === tab
        return (
          <button
            key={t.tab}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => setTab(t.tab)}
            style={{ flex: t.flex }}
            className={`flex min-w-0 cursor-pointer items-center justify-center gap-1 border-r border-hairline px-1 text-hint whitespace-nowrap last:border-r-0 ${
              on ? 'bg-ink text-panel' : 'bg-panel text-ink hover:bg-panel-raised'
            }`}
          >
            <span className="type-num opacity-70">{t.tab}</span>
            <span className="truncate">{t.name}</span>
          </button>
        )
      })}
    </div>
  )
}

interface CardView {
  readonly name: string
  readonly cost: number
  readonly upkeep: string
  readonly locked: boolean
  readonly short: boolean
  /** Why it can't be placed, for the tooltip; null when it can. */
  readonly reason: string | null
  /** kW it still needs from a new substation, or 0 (J-1). */
  readonly kwShort: number
}

function Card({ def, index, view }: { readonly def: CardDef; readonly index: number; readonly view: CardView }) {
  const selected = useUiStore((s) => s.selectedCard === def.kind)
  const hovered = useUiStore((s) => s.hoveredCard === def.kind)
  const selectCard = useUiStore((s) => s.selectCard)
  const hoverCard = useUiStore((s) => s.hoverCard)
  const off = view.reason !== null
  const blocked = view.kwShort > 0 && !view.locked
  const isNew = NEW_CARDS.has(def.kind) && !view.locked
  const key = CARD_KEYS[index]
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-disabled={off || undefined}
      aria-label={`${view.name}, $${view.cost}, ${view.upkeep}${off ? `. ${view.reason}` : ''}`}
      onClick={() => {
        if (!off) selectCard(selected ? null : def.kind)
      }}
      onMouseEnter={() => hoverCard(def.kind)}
      onMouseLeave={() => hoverCard(null)}
      onFocus={() => hoverCard(def.kind)}
      onBlur={() => hoverCard(null)}
      className={`relative flex min-w-0 flex-1 flex-col gap-0.5 border-r border-hairline px-2 py-1.5 text-left last:border-r-0 ${
        off ? 'cursor-not-allowed' : 'cursor-pointer'
      } ${selected ? 'bg-ink text-panel' : hovered ? 'bg-panel-raised text-ink' : 'bg-panel text-ink'}`}
    >
      <div className="flex h-[46px] items-start justify-between">
        <div className="h-11 w-16" style={{ opacity: off ? 0.4 : 1 }}>
          <NodeThumb kind={def.kind} />
        </div>
        <div className="flex flex-col items-end gap-[3px]">
          <span className={`type-num rounded-badge border px-[3px] text-[10px] leading-3 ${selected ? 'border-panel' : 'border-hairline'}`}>{key}</span>
          {isNew && <span className="rounded-badge bg-ink px-1 text-[10px] leading-3 font-bold text-panel">New</span>}
        </div>
      </div>
      <div className="h-7 overflow-hidden text-label leading-[14px] text-pretty" style={{ opacity: off ? 0.55 : 1 }}>
        {view.name}
      </div>
      <div className="type-num flex justify-between gap-1 text-hint">
        <span className={view.short ? 'text-alarm' : selected ? 'text-panel' : 'text-ink'}>${view.cost}</span>
        <span className={selected ? 'text-panel' : 'text-ink-dim'}>{view.upkeep}</span>
      </div>
      {blocked && !hovered && (
        <div className="absolute top-[30px] left-2 rounded-badge border border-warn bg-panel px-1 py-px text-[10px] leading-3 text-ink">Needs {view.kwShort} kW</div>
      )}
      {off && hovered && (
        <div
          role="tooltip"
          className="absolute bottom-[calc(100%+8px)] left-1/2 z-20 -translate-x-1/2 rounded-control border border-hairline bg-panel-raised px-2 py-1.5 text-label whitespace-nowrap text-ink"
        >
          {view.reason}
        </div>
      )}
    </button>
  )
}

function Cards() {
  const tab = useUiStore((s) => s.tab)
  const prices = useUiStore((s) => s.snapshot.prices)
  const budget = useUiStore((s) => s.snapshot.money.budget)
  const prefixBuild = useUiStore((s) => s.snapshot.agentOptions.prefixCacheBuild)
  const spareKw = useUiStore((s) => s.snapshot.power.supplyKw - s.snapshot.power.drawKw)
  const vllmKw = useUiStore((s) => s.snapshot.opsOptions.vllmTiers[0]?.kw ?? 0)
  return (
    <div className="flex min-h-0 flex-1">
      {CARDS[tab].map((def, i) => {
        if (def.kind === 'prefix') {
          const view: CardView = { name: def.name, cost: prefixBuild, upkeep: upkeepLabel(def), locked: false, short: false, reason: PREFIX_CARD_REASON, kwShort: 0 }
          return <Card key={def.kind} def={def} index={i} view={view} />
        }
        const live = def.nodeType !== undefined ? prices[def.nodeType] : null
        const cost = live?.build ?? def.cost
        const locked = live === null
        const short = !locked && budget < cost
        // The engine refuses a vLLM node without spare power, so the card says so first (J-1).
        const kwShort = def.power === true ? Math.max(0, Number((vllmKw - spareKw).toFixed(1))) : 0
        const view: CardView = {
          name: live?.name ?? def.name,
          cost,
          upkeep: upkeepLabel(live === null ? def : { upgrade: def.upgrade, upkeepPerMin: live.upkeepPerMin }),
          locked,
          short,
          reason: locked
            ? LATER_MILESTONE
            : short
              ? `Needs ${formatMoney(cost - budget).replace(/\.00$/, '')} more`
              : kwShort > 0
                ? `Needs ${kwShort} kW more power. Place a power substation`
                : null,
          kwShort,
        }
        return <Card key={def.kind} def={def} index={i} view={view} />
      })}
    </div>
  )
}

export function BottomToolbar({ width }: { readonly width: number }) {
  return (
    <div className="pointer-events-auto flex rounded-panel border border-hairline bg-panel" style={{ width, height: TOOLBAR_HEIGHT }} role="toolbar" aria-label="Build">
      <Tools />
      <div className="flex min-w-0 flex-1 flex-col">
        <Tabs />
        <Cards />
      </div>
    </div>
  )
}
