/*
 * The opening coach mark (design: 04 Opening): a card on a leader line from
 * the top of Frontier A, shown the first time the board loses money because
 * tokens cost more than answers earn. It says why in the player's own
 * numbers, what a simple chat costs there and what it earns (both from the
 * catalog), and names the two nodes that fix it. It shows once a run: "Got
 * it", the condition clearing or a router or cache on the board retires it
 * (uiStore).
 *
 * The card is DOM over the canvas; `CoachTracker`, inside the canvas, moves
 * it and its leader with the camera every frame. It never covers a label
 * plate: it tries above-right of the cloud first (the design's spot), then
 * the other sides and farther out, and takes the first that's clear (or the
 * one that covers least).
 */

import { useFrame, useThree } from '@react-three/fiber'
import type { RefObject } from 'react'
import { Vector3 } from 'three'

import { formatMoney } from '../components/format'
import type { Catalog, GameNode, World } from '../engine'
import { useUiStore } from '../store/uiStore'
import { placeCoach, setSlot } from './domWrite'
import { useEngine } from './engineContext'
import { PX_Z } from './iso'
import type { PlateRegistry } from './LabelPlates'
import { CLOUD_PX } from './NodeMeshes/FrontierApi'

/** The cloud's top above its base, iso px (the highest puff). */
const CLOUD_TOP_PX = CLOUD_PX + 19
const CARD_WIDTH = 300
/** The card sits this far right of and above the anchor, px (iso opening). */
const CARD_DX = 40
const CARD_DY = -150

export interface Box {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

export interface CoachSpot {
  readonly x: number
  readonly y: number
  readonly side: 'left' | 'right'
}

/** Offsets tried, in order: the design's spot first, then mirrored, below, and farther out. */
const SPOT_DX = (w: number) => [CARD_DX, -CARD_DX - w, CARD_DX + 90, -CARD_DX - w - 90]
const SPOT_DY = (h: number) => [CARD_DY, 40, CARD_DY - 90, -h / 2]

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  return w > 0 && h > 0 ? w * h : 0
}

/**
 * Where to put a card of this size round anchor (ax, ay): the first spot, in order, that stays on
 * screen and clears every plate, or failing that the one that covers the least plate.
 */
export function chooseCoachSpot(ax: number, ay: number, w: number, h: number, plates: readonly Box[], screen: { width: number; height: number }): CoachSpot {
  const top = 72
  const clampX = (x: number) => Math.max(16, Math.min(screen.width - w - 16, x))
  const clampY = (y: number) => Math.max(top, Math.min(screen.height - h - 16, y))
  let best: CoachSpot | null = null
  let bestCover = Infinity
  for (const dy of SPOT_DY(h)) {
    for (const dx of SPOT_DX(w)) {
      const spot: CoachSpot = { x: clampX(ax + dx), y: clampY(ay + dy), side: dx > 0 ? 'right' : 'left' }
      const box = { x0: spot.x, y0: spot.y, x1: spot.x + w, y1: spot.y + h }
      // The card mustn't cover its own anchor either.
      const self = ax >= box.x0 && ax <= box.x1 && ay >= box.y0 && ay <= box.y1
      let cover = self ? w * h : 0
      for (const p of plates) cover += overlap(box, p)
      if (cover === 0) return spot
      if (cover < bestCover) {
        bestCover = cover
        best = spot
      }
    }
  }
  return best ?? { x: clampX(ax + CARD_DX), y: clampY(ay + CARD_DY), side: 'right' }
}

export interface CoachDom {
  card: HTMLDivElement | null
  leader: SVGPolylineElement | null
  dot: SVGCircleElement | null
}

/** What a simple chat costs on a hosted model, and what it earns. */
function simpleChatOnFrontier(catalog: Catalog): { cost: number; revenue: number } {
  const chat = catalog.traffic.chat.SIMPLE
  const spec = catalog.nodes.FRONTIER_API
  return {
    cost: (chat.inputTokens / 1000) * spec.inputPricePer1k + (chat.outputTokens / 1000) * spec.outputPricePer1k,
    revenue: chat.revenue,
  }
}

function firstFrontier(world: World): GameNode | undefined {
  return world.nodes.find((n) => n.type === 'FRONTIER_API')
}

export function CoachLayer({ dom, catalog }: { dom: RefObject<CoachDom>; catalog: Catalog }) {
  const shown = useUiStore((s) => s.coach === 'shown')
  const dismiss = useUiStore((s) => s.dismissCoach)
  if (!shown) return null
  const { cost, revenue } = simpleChatOnFrontier(catalog)
  const name = `Frontier ${catalog.nodes.FRONTIER_API.provider}`
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg className="absolute inset-0 h-full w-full" aria-hidden>
        <polyline
          ref={(el) => setSlot(dom.current, 'leader', el)}
          fill="none"
          className="stroke-ink"
          strokeWidth={1}
        />
        <circle
          ref={(el) => setSlot(dom.current, 'dot', el)}
          r={3}
          className="fill-ink"
        />
      </svg>
      <div
        ref={(el) => setSlot(dom.current, 'card', el)}
        role="dialog"
        aria-label={`${name}: why money is draining`}
        className="pointer-events-auto absolute top-0 left-0 flex flex-col gap-2.5 rounded-panel border border-hairline bg-panel px-3.5 py-3"
        style={{ width: CARD_WIDTH, transform: 'translate(-9999px, -9999px)' }}
      >
        <div className="absolute -top-2 left-2 flex">
          <span className="bg-panel px-1 text-[12px] leading-[14px] font-bold">{name}</span>
        </div>
        <p className="text-body text-pretty">
          Each simple chat here costs {formatMoney(cost)} in tokens and earns {formatMoney(revenue)}. Send simple chats somewhere cheaper with
          a prompt router, or answer repeats from a semantic cache.
        </p>
        <div className="flex items-center justify-end border-t border-hairline pt-2.5">
          <button
            type="button"
            onClick={dismiss}
            className="h-7 cursor-pointer rounded-control border border-hairline bg-panel-raised px-2.5 text-label text-ink hover:border-ink-dim"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}

const scratch = new Vector3()

export function CoachTracker({ dom, plates }: { dom: RefObject<CoachDom>; plates: RefObject<PlateRegistry> }) {
  const engine = useEngine()
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  useFrame(() => {
    const { card, leader, dot } = dom.current
    if (card === null || leader === null || dot === null) return
    const node = firstFrontier(engine.world)
    if (node === undefined) {
      placeCoach(card, leader, dot, false, 0, 0, 0, 0)
      return
    }
    scratch.set(node.x + 0.5, CLOUD_TOP_PX * PX_Z, node.y + 0.5).project(camera)
    const ax = (scratch.x * 0.5 + 0.5) * size.width
    const ay = (-scratch.y * 0.5 + 0.5) * size.height
    // Only while the card is up, so measuring the plates costs nothing the rest of the run.
    const boxes: Box[] = []
    for (const p of plates.current.values()) {
      const r = p.plate.getBoundingClientRect()
      if (r.width > 0) boxes.push({ x0: r.left - 4, y0: r.top - 4, x1: r.right + 4, y1: r.bottom + 4 })
    }
    const spot = chooseCoachSpot(ax, ay, CARD_WIDTH, card.offsetHeight, boxes, size)
    placeCoach(card, leader, dot, true, ax, ay, spot.x, spot.y, spot.side)
  })
  return null
}
