/*
 * Label plates (iso plate()): every node's name on a small opaque plate at
 * its front corner, plus "+N" when its queue outgrows the 12-slot rack (D38).
 *
 * The plates are one plain DOM layer over the canvas, not an Html root per
 * node: `PlateLayer` renders them once per topology, and `PlateTracker`,
 * inside the canvas, projects each anchor every frame and writes position,
 * mode and overflow straight onto the elements. Nothing re-renders at frame rate.
 * Plates of nodes on neighbouring tiles would overlap, so each frame they're
 * laid out first (plateLayout.ts): a crowding plate drops a row below.
 *
 * State comes from the 4 Hz snapshot (D11); the overflow count is the queue
 * length, which the rack already shows. A coordinator's plate also counts its
 * runs ("16 of 16 runs, 9 stuck", I-1) and turns amber while any are stuck,
 * so runaways stand out across the board. Selection comes from the UI store.
 */

import { useFrame, useThree } from '@react-three/fiber'
import { useRef, type RefObject } from 'react'
import { Vector3 } from 'three'

import type { NodeState, NodeTelemetry, TelemetrySnapshot } from '../engine'
import type { Topology } from './board'
import { useEngine } from './engineContext'
import { HAS_QUEUE } from './NodeMeshes/common'
import { rackView } from './paths'
import { createPlateLayout, plateStat, resolvePlates, type PlateLayout } from './plateLayout'
import { useUiStore } from '../store/uiStore'

type PlateMode = 'normal' | 'warn' | 'dim'

function nodeIn(snapshot: TelemetrySnapshot, id: number): NodeTelemetry | undefined {
  const nodes = snapshot.nodes
  for (let i = 0; i < nodes.length; i++) if (nodes[i].id === id) return nodes[i]
  return undefined
}

function plateMode(state: NodeState, stuck: number): PlateMode {
  if (state === 'queue-full' || stuck > 0) return 'warn'
  if (state === 'no-route') return 'dim'
  return 'normal'
}

export interface PlateAnchor {
  readonly nodeId: number
  readonly name: string
  readonly x: number
  readonly z: number
  /** Horizontal nudge, px (iso puts the Users plate 14 px left of the plaza's corner). */
  readonly dx: number
  readonly overflow: boolean
}

/** One plate per node: at the footprint's front corner, or the plaza's front corner for users. */
export function plateAnchors(topology: Topology): PlateAnchor[] {
  return topology.nodes.map((n) => {
    const plaza = topology.plazas.get(n.id)
    if (plaza !== undefined) return { nodeId: n.id, name: 'Users', x: plaza.x1, z: plaza.z1, dx: -14, overflow: false }
    return { nodeId: n.id, name: n.label, x: n.x + 1, z: n.y + 1, dx: 0, overflow: HAS_QUEUE[n.type] }
  })
}

interface PlateElements {
  readonly plate: HTMLDivElement
  readonly statEl: HTMLSpanElement | null
  mode: PlateMode | null
  selected: boolean
  /** The counts the stat line was last written from, packed, so the text is rebuilt only when they change. */
  statKey: number
  /** Measured width, px; 0 until measured, and again whenever its text changes. */
  width: number
}

/** Plate elements by node id, filled by `PlateLayer` and read by `PlateTracker`. */
export type PlateRegistry = Map<number, PlateElements>

export function PlateLayer({ anchors, registry }: { anchors: readonly PlateAnchor[]; registry: RefObject<PlateRegistry> }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {anchors.map((a) => (
        <div
          key={a.nodeId}
          ref={(el) => {
            const map = registry.current
            if (el === null) {
              map.delete(a.nodeId)
              return
            }
            map.set(a.nodeId, { plate: el, statEl: el.querySelector('span[data-stat]'), mode: null, selected: false, statKey: -1, width: 0 })
          }}
          data-mode="normal"
          data-selected="false"
          // Parked off screen until the tracker places it on the first frame.
          style={{ transform: 'translate(-9999px, -9999px)' }}
          className="group absolute top-0 left-0 flex h-[18px] items-center gap-3 rounded-badge border border-hairline bg-panel/94 px-[7px] whitespace-nowrap text-label/[16px] text-ink select-none data-[mode=dim]:opacity-55 data-[mode=warn]:border-warn data-[selected=true]:border-ink data-[selected=true]:bg-ink data-[selected=true]:text-panel data-[selected=true]:opacity-100"
        >
          <span>{a.name}</span>
          {a.overflow && <span data-stat hidden className="type-num text-hint text-ink-dim group-data-[selected=true]:text-panel" />}
        </div>
      ))}
    </div>
  )
}

const scratch = new Vector3()

export function PlateTracker({ anchors, registry }: { anchors: readonly PlateAnchor[]; registry: RefObject<PlateRegistry> }) {
  const engine = useEngine()
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  // Scratch for the layout, regrown only when the number of plates changes.
  const scratchLayout = useRef<PlateLayout | null>(null)

  useFrame(() => {
    if (scratchLayout.current === null || scratchLayout.current.x.length !== anchors.length) scratchLayout.current = createPlateLayout(anchors.length)
    const layout = scratchLayout.current
    const map = registry.current
    const selectedId = useUiStore.getState().selectedNodeId
    let selectedIndex = -1
    // Reads first: project every anchor and measure any plate whose text changed.
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i]
      const el = map.get(a.nodeId)
      scratch.set(a.x, 0, a.z).project(camera)
      layout.x[i] = (scratch.x * 0.5 + 0.5) * size.width + a.dx
      // Centred under the anchor, 6 px below it (iso plate()).
      layout.y[i] = (-scratch.y * 0.5 + 0.5) * size.height + 6
      if (el !== undefined && el.width === 0) el.width = el.plate.offsetWidth
      layout.w[i] = el?.width ?? 0
      if (a.nodeId === selectedId) selectedIndex = i
    }
    resolvePlates(layout, anchors.length, selectedIndex)

    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i]
      const el = map.get(a.nodeId)
      if (el === undefined) continue
      el.plate.style.transform = `translate(${layout.x[i].toFixed(1)}px, ${layout.outY[i].toFixed(1)}px) translateX(-50%)`

      const view = nodeIn(engine.snapshot, a.nodeId)
      const mode = plateMode(view?.state ?? 'idle', view?.runs?.stuck ?? 0)
      if (mode !== el.mode) {
        el.mode = mode
        el.plate.dataset.mode = mode
      }
      // The selected node's plate goes reverse video (design: "Selected").
      const selected = selectedId === a.nodeId
      if (selected !== el.selected) {
        el.selected = selected
        el.plate.dataset.selected = String(selected)
      }
      if (el.statEl === null) continue
      const node = engine.world.nodeById[a.nodeId]
      const runs = view?.runs ?? null
      const overflow = node === undefined ? 0 : rackView(node.queueLength).overflow
      // A tracer unlocks every queue's length on its plate (J-3).
      const traced = runs === null && engine.snapshot.tracing !== null && node !== undefined
      const key = traced
        ? -(node.queueLength * 1024 + node.queueCapacity) - 1
        : runs === null
          ? overflow
          : ((runs.inFlight * 1024 + runs.max) * 1024 + runs.stuck) * 4096 + overflow + 1
      if (key === el.statKey) continue
      el.statKey = key
      const stat = plateStat(runs, overflow, traced ? { length: node.queueLength, capacity: node.queueCapacity } : null)
      el.statEl.textContent = stat
      el.statEl.hidden = stat === ''
      // Its width changed: measure it again next frame.
      el.width = 0
    }
  })
  return null
}
