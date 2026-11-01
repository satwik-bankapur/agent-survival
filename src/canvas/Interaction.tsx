/*
 * The build tools on the board: placing, linking, unlinking, demolishing and
 * selecting, each with its hover preview (design: "Placement ghost", "Link
 * ghost", "Selected"). Every preview asks the engine first (GameEngine.check),
 * so an invalid one shows the engine's own reason in red before you click.
 * A link clicked against the flow is made the right way round (planLink), and
 * the link ghost carries chevrons showing which way prompts will go.
 *
 * Pick targets write what's under the pointer into `boardPointer`; this layer
 * reads it, and the UI store's tool, card and selection, once a frame, and
 * rebuilds geometry only when what it shows changes. A click goes through the
 * store's `dispatch`, so a rejection explains itself in a toast.
 */

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import {
  BufferGeometry,
  CurvePath,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineCurve3,
  LineDashedMaterial,
  LineLoop,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  TubeGeometry,
  Vector3,
  type Camera,
} from 'three'

import { formatMoney, sharedProviderNote } from '../components/format'
import { nodeTypeOfCard } from '../components/nodeCards'
import { createRouteGrid, markRoute, packetView, planLink, planRoute, type Command, type GameEngine, type GameNode, type Tile } from '../engine'
import { useUiStore } from '../store/uiStore'
import { BoardBadgeElement, showBadge, type BadgeKind } from './BoardBadge'
import { NODE_TOP_PX, TUBE_Y, type Topology } from './board'
import { useEngine } from './engineContext'
import './threeLine'
import { PX_XY, PX_Z } from './iso'
import { NodeMesh } from './NodeMeshes'
import { GHOST_ID } from './NodeMeshes/common'
import { HEX, linear } from './palette'
import { routePolyline, type Pt, type Rect } from './paths'
import { setCursor, setSlot, showPlate } from './domWrite'
import { nearestPick, type CapsulePicks } from './capsulePicks'
import { boardFocus } from './focus'
import { boardClick, boardPointer, matPickHandlers } from './pointer'

/** The DOM half of the previews: the ghost's price plate and one hint badge. */
export interface InteractionDom {
  plate: HTMLDivElement | null
  badge: HTMLDivElement | null
}

export function InteractionLayer({ dom }: { dom: RefObject<InteractionDom> }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        ref={(el) => setSlot(dom.current, 'plate', el)}
        hidden
        data-bad="false"
        className="absolute top-0 left-0 flex h-[18px] items-center rounded-badge border border-ink bg-panel/94 px-[7px] text-label/[16px] whitespace-nowrap text-ink select-none data-[bad=true]:border-alarm"
      />
      <BoardBadgeElement
        elRef={(el) => setSlot(dom.current, 'badge', el)}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Materials and small geometry
// ---------------------------------------------------------------------------

const INK = linear(HEX.ink)
const ALARM = linear(HEX.alarm)

/**
 * The placement ghost is a dashed wireframe (iso .gh: every stroke ink, dashed 3 2, no fill), red
 * when the tile won't take it. Its faces draw only depth, pushed back a little, so edges behind
 * the form stay hidden as in the design's visible-faces drawing.
 */
const ghostDepth = new MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
const ghostDash = new LineDashedMaterial({ color: INK, dashSize: 3 * PX_XY, gapSize: 2 * PX_XY })
/** Fold angle above which a mesh edge is drawn on the ghost, so curved forms don't show their facets. */
const GHOST_EDGE_DEG = 25
/** The ghost draws after everything opaque on the board. */
const GHOST_RENDER_ORDER = 10
/** The footprint under a ghost or a node about to go: 12% ink, or 18% red (iso ghost). */
const footFill = new MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.12, depthWrite: false })
const footLine = new LineDashedMaterial({ color: INK, transparent: true, opacity: 0.6, dashSize: 4 * PX_XY, gapSize: 3 * PX_XY })
/** The link ghost: a dashed line in a faint 8 px sleeve (iso ghost tube). */
const linkLine = new LineDashedMaterial({ color: INK, dashSize: 5 * PX_XY, gapSize: 4 * PX_XY })
const linkSleeve = new MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.12, depthWrite: false })
/** Flow chevrons on the link ghost, pointing the way prompts will go. */
const linkArrow = new LineBasicMaterial({ color: INK })
/** Chevrons sit this far apart along the ghost tube, in tiles, with arms this long. */
const ARROW_EVERY = 0.8
const ARROW_ARM = 0.18
/** A tube about to be unlinked. */
const unlinkSleeve = new MeshBasicMaterial({ color: ALARM, transparent: true, opacity: 0.45, depthWrite: false })
const cropMaterial = new LineBasicMaterial({ color: INK })

function tint(bad: boolean): void {
  const c = bad ? ALARM : INK
  for (const m of [ghostDash, footLine, linkLine, linkSleeve, linkArrow]) m.color.copy(c)
  footFill.color.copy(c)
  footFill.opacity = bad ? 0.18 : 0.12
}

const footGeometry = (() => {
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute([0, 0.004, 0, 1, 0.004, 0, 1, 0.004, 1, 0, 0.004, 1], 3))
  g.setIndex([0, 2, 1, 0, 3, 2])
  return g
})()
const footOutline = (() => {
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute([0, 0.005, 0, 1, 0.005, 0, 1, 0.005, 1, 0, 0.005, 1], 3))
  new LineLoop(g, footLine).computeLineDistances()
  return g
})()

/** Crop-mark corners round a rectangle on the mat (iso crop(): 0.14 out, 0.28-tile arms). */
function cropGeometry(r: Rect): BufferGeometry {
  const e = 0.14
  const arm = 0.28
  const y = 0.01
  const v: number[] = []
  const corners: [number, number, number, number][] = [
    [r.x0 - e, r.z0 - e, 1, 1],
    [r.x1 + e, r.z0 - e, -1, 1],
    [r.x1 + e, r.z1 + e, -1, -1],
    [r.x0 - e, r.z1 + e, 1, -1],
  ]
  for (const [x, z, sx, sz] of corners) v.push(x + sx * arm, y, z, x, y, z, x, y, z, x, y, z + sz * arm)
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(v, 3))
  return g
}

function tubeAlong(points: readonly Pt[], radius: number): TubeGeometry | null {
  if (points.length < 2) return null
  const path = new CurvePath<Vector3>()
  for (let i = 1; i < points.length; i++) {
    path.add(new LineCurve3(new Vector3(points[i - 1].x, TUBE_Y, points[i - 1].z), new Vector3(points[i].x, TUBE_Y, points[i].z)))
  }
  let length = 0
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z)
  return new TubeGeometry(path, Math.max(8, Math.ceil(length * 12)), radius, 8, false)
}

function lineAlong(points: readonly Pt[]): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(points.flatMap((p) => [p.x, TUBE_Y, p.z]), 3))
  return g
}

/** Chevrons along a polyline, one every ARROW_EVERY tiles, pointing from its start to its end. */
function chevronsAlong(points: readonly Pt[]): BufferGeometry {
  const v: number[] = []
  const y = TUBE_Y + 0.01
  let at = ARROW_EVERY / 2
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const length = Math.hypot(b.x - a.x, b.z - a.z)
    if (length === 0) continue
    const dx = (b.x - a.x) / length
    const dz = (b.z - a.z) / length
    for (; at < length; at += ARROW_EVERY) {
      const tx = a.x + dx * at
      const tz = a.z + dz * at
      const bx = tx - dx * ARROW_ARM
      const bz = tz - dz * ARROW_ARM
      const ox = -dz * ARROW_ARM * 0.8
      const oz = dx * ARROW_ARM * 0.8
      v.push(bx + ox, y, bz + oz, tx, y, tz, tx, y, tz, bx - ox, y, bz - oz)
    }
    at -= length
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(v, 3))
  return g
}

/** The route a new link from `from` to a tile would take, around everything already on the board. */
function ghostRoute(engine: GameEngine, from: GameNode, to: Tile): Tile[] {
  const w = engine.world
  const grid = createRouteGrid(w.catalog.board.cols, w.catalog.board.rows, w.occupancy)
  for (const edge of w.edges) markRoute(grid, edge.route)
  // The new link makes the source fork if it already has one.
  return planRoute(grid, from, to, from.outEdges.length >= 1)
}

/**
 * The node under the pointer: one of its meshes, or failing that its tile on the mat. Tubes run
 * into their nodes' centres, so a pointer on a tube inside a node's tile points at the node.
 */
function pointedNode(engine: GameEngine): GameNode | undefined {
  const w = engine.world
  const p = boardPointer
  if (!p.inside) return undefined
  if (p.nodeId >= 0) return w.nodeById[p.nodeId]
  if (p.tileX < 0) return undefined
  const id = w.occupancy[p.tileY * w.catalog.board.cols + p.tileX]
  return id >= 0 ? w.nodeById[id] : undefined
}

function nodeRect(topology: Topology, node: { id: number; x: number; y: number }): Rect {
  return topology.plazas.get(node.id) ?? { x0: node.x, z0: node.y, x1: node.x + 1, z1: node.y + 1 }
}

// ---------------------------------------------------------------------------
// Clicks
// ---------------------------------------------------------------------------

function onBoardClick(engine: GameEngine): void {
  const s = useUiStore.getState()
  const w = engine.world
  const p = boardPointer
  const node = pointedNode(engine)
  const placeType = nodeTypeOfCard(s.selectedCard)
  if (placeType !== null) {
    if (p.tileX >= 0) s.dispatch({ type: 'placeNode', nodeType: placeType, x: p.tileX, y: p.tileY })
    return
  }
  switch (s.tool) {
    case 'select':
      s.selectNode(node?.id ?? null)
      return
    case 'link': {
      const from = s.linkFrom === null ? undefined : w.nodeById[s.linkFrom]
      // Any node can start a link: one clicked against the flow is flipped on the second click.
      if (from === undefined) {
        if (node !== undefined) s.setLinkFrom(node.id)
        return
      }
      if (node === undefined || node.id === from.id) {
        s.setLinkFrom(null)
        return
      }
      const plan = planLink(w, from.id, node.id)
      if (!plan.ok) {
        s.toast(plan.reason, 'alarm')
        return
      }
      const a = w.nodeById[plan.from]
      const b = w.nodeById[plan.to]
      if (a === undefined || b === undefined) return
      const success = plan.flipped
        ? `Flipped: linked ${a.label} to ${b.label}, the way prompts flow.`
        : `Linked ${a.label} to ${b.label}.`
      if (s.dispatch({ type: 'link', from: a.id, to: b.id }, success).ok) s.setLinkFrom(null)
      return
    }
    case 'unlink': {
      const edge = p.edgeId >= 0 ? w.edgeById[p.edgeId] : undefined
      if (edge === undefined) return
      const a = w.nodeById[edge.from]
      const b = w.nodeById[edge.to]
      if (a === undefined || b === undefined) return
      s.dispatch({ type: 'unlink', from: a.id, to: b.id }, `Unlinked ${a.label} from ${b.label}.`)
      return
    }
    case 'demolish': {
      if (node === undefined) return
      const refund = s.snapshot.prices[node.type].refund
      s.dispatch({ type: 'demolish', nodeId: node.id }, `Demolished ${node.label}. Refunded ${formatMoney(refund)}.`)
      return
    }
  }
}

/** A capsule counts as clicked within this many px of its centre. */
const XRAY_PICK_PX = 10

/**
 * Paused, with the select tool and no card, a click on a capsule opens its X-ray instead of
 * selecting. The card shows the packet as the player can see it (packetView, D11), at the click.
 */
function pickCapsule(engine: GameEngine, picks: CapsulePicks, camera: Camera, width: number, height: number): boolean {
  const s = useUiStore.getState()
  if (!engine.paused || s.tool !== 'select' || s.selectedCard !== null) return false
  const sx = (boardPointer.ndcX * 0.5 + 0.5) * width
  const sy = (-boardPointer.ndcY * 0.5 + 0.5) * height
  const slot = nearestPick(picks, camera, width, height, sx, sy, XRAY_PICK_PX)
  if (slot < 0) {
    if (s.xray !== null) s.setXray(null)
    return false
  }
  const view = packetView(engine.world, picks.index[slot], picks.serial[slot])
  if (view === null) return false
  scratch.set(picks.xyz[slot * 3], picks.xyz[slot * 3 + 1], picks.xyz[slot * 3 + 2]).project(camera)
  s.setXray({ view, x: (scratch.x * 0.5 + 0.5) * width, y: (-scratch.y * 0.5 + 0.5) * height })
  return true
}

/** Right-click: drop the link in progress, else put the card down. */
function onBoardCancel(): void {
  const s = useUiStore.getState()
  if (s.linkFrom !== null) s.setLinkFrom(null)
  else if (s.selectedCard !== null) s.selectCard(null)
}

// ---------------------------------------------------------------------------
// The layer
// ---------------------------------------------------------------------------

const scratch = new Vector3()

function toScreen(camera: Camera, size: { width: number; height: number }, x: number, y: number, z: number): [number, number] {
  scratch.set(x, y, z).project(camera)
  return [(scratch.x * 0.5 + 0.5) * size.width, (-scratch.y * 0.5 + 0.5) * size.height]
}

/** The point a node's badge hangs from: 12 px above its top (iso badge anchor). */
function badgeAnchor(node: GameNode): [number, number, number] {
  return [node.x + 0.5, (NODE_TOP_PX[node.type] + 12) * PX_Z, node.y + 0.5]
}

export function Interaction({ topology, dom, picks }: { topology: Topology; dom: RefObject<InteractionDom>; picks: CapsulePicks }) {
  const engine = useEngine()
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const { cols, rows } = engine.world.catalog.board
  const placeType = useUiStore((s) => nodeTypeOfCard(s.selectedCard))

  const ghost = useRef<Group>(null)
  const ghostBodyGroup = useRef<Group>(null)
  const foot = useRef<Group>(null)
  const linkGhost = useRef<Group>(null)
  const linkLineRef = useRef<Line>(null)
  const linkSleeveRef = useRef<Mesh>(null)
  const linkArrowsRef = useRef<LineSegments>(null)
  const unlinkRef = useRef<Mesh>(null)
  const crops = useRef<LineSegments>(null)
  const sourceCrops = useRef<LineSegments>(null)

  // Remembered between frames, so geometry is rebuilt only when what it shows changes.
  const linkKey = useRef('')
  const unlinkKey = useRef(-1)
  const cropKey = useRef('')
  const sourceKey = useRef('')
  const cursor = useRef('')

  useEffect(() => {
    boardClick.handler = () => {
      if (!pickCapsule(engine, picks, camera, size.width, size.height)) onBoardClick(engine)
    }
    boardClick.cancel = onBoardCancel
    return () => {
      boardClick.handler = null
      boardClick.cancel = null
    }
  }, [engine, picks, camera, size.width, size.height])

  // The ghost is the real node mesh, redrawn as a dashed wireframe with no shadow.
  useLayoutEffect(() => {
    const group = ghostBodyGroup.current
    if (group === null) return
    const meshes: Mesh[] = []
    const lines: Line[] = []
    group.traverse((o) => {
      o.castShadow = false
      if (o instanceof Mesh) meshes.push(o)
      else if (o instanceof Line) lines.push(o)
    })
    const added: LineSegments[] = []
    for (const mesh of meshes) {
      // Drawn after the opaque board, or its depth would punch a hole in the mat.
      mesh.material = ghostDepth
      mesh.renderOrder = GHOST_RENDER_ORDER
      const edges = new LineSegments(new EdgesGeometry(mesh.geometry, GHOST_EDGE_DEG), ghostDash)
      edges.computeLineDistances()
      edges.renderOrder = GHOST_RENDER_ORDER + 1
      mesh.add(edges)
      added.push(edges)
    }
    for (const line of lines) {
      line.material = ghostDash
      line.computeLineDistances()
      line.renderOrder = GHOST_RENDER_ORDER + 1
    }
    return () => {
      for (const edges of added) {
        edges.removeFromParent()
        edges.geometry.dispose()
      }
    }
  }, [placeType])

  const mat = useMemo(() => matPickHandlers(cols, rows), [cols, rows])

  useFrame((state) => {
    const s = useUiStore.getState()
    const w = engine.world
    const p = boardPointer
    const d = dom.current
    let plateText: string | null = null
    let plateAt: [number, number, number] = [0, 0, 0]
    let plateBad = false
    let badgeText: string | null = null
    let badgeKind: BadgeKind = 'info'
    let badgeAt: [number, number, number] = [0, 0, 0]
    let showGhost = false
    let footAt: Tile | null = null
    let linkTo: { from: GameNode; tile: Tile; bad: boolean } | null = null
    let unlinkEdge = -1
    let wantCursor = ''
    const hovered = pointedNode(engine)
    boardFocus.hoveredNodeId = hovered?.id ?? -1

    const check = (command: Command): string | null => {
      const r = engine.check(command)
      return r.ok ? null : r.reason
    }

    if (placeType !== null) {
      if (p.inside && p.tileX >= 0) {
        const reason = check({ type: 'placeNode', nodeType: placeType, x: p.tileX, y: p.tileY })
        showGhost = true
        footAt = { x: p.tileX, y: p.tileY }
        plateBad = reason !== null
        plateText = `$${s.snapshot.prices[placeType].build}`
        plateAt = [p.tileX + 1, 0, p.tileY + 1]
        tint(plateBad)
        // A second node on a provider adds no capacity (D14), so the ghost says so before it's bought.
        const note =
          placeType === 'FRONTIER_API' ? sharedProviderNote(s.snapshot.nodes, w.catalog.nodes.FRONTIER_API.provider, null) : null
        if (reason !== null || note !== null) {
          badgeText = reason ?? note
          badgeKind = reason !== null ? 'alarm' : 'info'
          badgeAt = [p.tileX + 0.5, (NODE_TOP_PX[placeType] + 12) * PX_Z, p.tileY + 0.5]
        }
        wantCursor = reason === null ? 'copy' : 'not-allowed'
      }
    } else if (s.tool === 'link') {
      const from = s.linkFrom === null ? undefined : w.nodeById[s.linkFrom]
      if (from === undefined) {
        if (hovered !== undefined) wantCursor = 'pointer'
      } else if (p.inside && p.tileX >= 0) {
        const target = hovered !== undefined && hovered.id !== from.id ? hovered : undefined
        const plan = target === undefined ? null : planLink(w, from.id, target.id)
        if (target !== undefined && plan !== null && plan.ok && plan.flipped) {
          // Drawn the way it will be made, so the chevrons show the real flow.
          linkTo = { from: target, tile: from, bad: false }
          badgeText = `Flips to ${target.label} → ${from.label}`
          badgeKind = 'info'
          badgeAt = badgeAnchor(target)
        } else {
          linkTo = { from, tile: target ?? { x: p.tileX, y: p.tileY }, bad: plan !== null && !plan.ok }
          if (target !== undefined && plan !== null && !plan.ok) {
            badgeText = plan.reason
            badgeKind = 'alarm'
            badgeAt = badgeAnchor(target)
          }
        }
        if (target !== undefined) wantCursor = linkTo.bad ? 'not-allowed' : 'pointer'
      }
    } else if (s.tool === 'unlink') {
      const edge = p.inside && p.edgeId >= 0 ? w.edgeById[p.edgeId] : undefined
      const a = edge === undefined ? undefined : w.nodeById[edge.from]
      const b = edge === undefined ? undefined : w.nodeById[edge.to]
      const view = edge === undefined ? undefined : topology.edges.find((e) => e.id === edge.id)
      if (edge !== undefined && a !== undefined && b !== undefined && view !== undefined) {
        unlinkEdge = edge.id
        const mid = view.points[Math.floor(view.points.length / 2)]
        badgeText = `Unlink ${a.label} from ${b.label}`
        badgeKind = 'info'
        badgeAt = [mid.x, TUBE_Y + 6 * PX_Z, mid.z]
        wantCursor = 'pointer'
      }
    } else if (s.tool === 'demolish') {
      if (hovered !== undefined) {
        const reason = check({ type: 'demolish', nodeId: hovered.id })
        badgeAt = badgeAnchor(hovered)
        if (reason === null) {
          footAt = { x: hovered.x, y: hovered.y }
          tint(true)
          badgeText = `Demolish, refund ${formatMoney(s.snapshot.prices[hovered.type].refund)}`
          badgeKind = 'alarm'
          wantCursor = 'pointer'
        } else {
          badgeText = reason
          badgeKind = 'alarm'
          wantCursor = 'not-allowed'
        }
      }
    } else if (hovered !== undefined) {
      wantCursor = 'pointer'
    }

    // Placement ghost and footprint.
    if (ghost.current !== null) {
      ghost.current.visible = showGhost
      if (showGhost && footAt !== null) ghost.current.position.set(footAt.x, 0, footAt.y)
    }
    if (foot.current !== null) {
      foot.current.visible = footAt !== null
      if (footAt !== null) foot.current.position.set(footAt.x, 0, footAt.y)
    }

    // Link ghost: rebuilt when its ends or its colour change.
    const key = linkTo === null ? '' : `${linkTo.from.id}:${linkTo.tile.x},${linkTo.tile.y}:${linkTo.bad ? 1 : 0}`
    if (
      key !== linkKey.current &&
      linkGhost.current !== null &&
      linkLineRef.current !== null &&
      linkSleeveRef.current !== null &&
      linkArrowsRef.current !== null
    ) {
      linkKey.current = key
      linkLineRef.current.geometry.dispose()
      linkSleeveRef.current.geometry.dispose()
      linkArrowsRef.current.geometry.dispose()
      const route = linkTo === null ? [] : ghostRoute(engine, linkTo.from, linkTo.tile)
      const points = route.length < 2 ? [] : routePolyline(route)
      linkLineRef.current.geometry = lineAlong(points)
      linkLineRef.current.computeLineDistances()
      linkSleeveRef.current.geometry = tubeAlong(points, 4 * PX_XY) ?? new BufferGeometry()
      linkArrowsRef.current.geometry = chevronsAlong(points)
      if (linkTo !== null) tint(linkTo.bad)
      linkGhost.current.visible = points.length >= 2
    }

    // The tube about to be unlinked.
    if (unlinkEdge !== unlinkKey.current && unlinkRef.current !== null) {
      unlinkKey.current = unlinkEdge
      unlinkRef.current.geometry.dispose()
      const view = topology.edges.find((e) => e.id === unlinkEdge)
      unlinkRef.current.geometry = (view === undefined ? null : tubeAlong(view.points, 5.5 * PX_XY)) ?? new BufferGeometry()
      unlinkRef.current.visible = view !== undefined
    }

    // Crop marks on the selected node, and on the link tool's source.
    const selected = s.selectedNodeId === null ? undefined : w.nodeById[s.selectedNodeId]
    const sel = selected === undefined ? '' : `${selected.id}:${selected.x},${selected.y}`
    if (sel !== cropKey.current && crops.current !== null) {
      cropKey.current = sel
      crops.current.geometry.dispose()
      crops.current.geometry = selected === undefined ? new BufferGeometry() : cropGeometry(nodeRect(topology, selected))
      crops.current.visible = selected !== undefined
    }
    const source = s.tool === 'link' && s.linkFrom !== null ? w.nodeById[s.linkFrom] : undefined
    const src = source === undefined ? '' : `${source.id}:${source.x},${source.y}`
    if (src !== sourceKey.current && sourceCrops.current !== null) {
      sourceKey.current = src
      sourceCrops.current.geometry.dispose()
      sourceCrops.current.geometry = source === undefined ? new BufferGeometry() : cropGeometry(nodeRect(topology, source))
      sourceCrops.current.visible = source !== undefined
    }

    // DOM: the ghost's price plate and the hint badge.
    if (plateText === null) showPlate(d.plate, null, false, 0, 0)
    else {
      const [sx, sy] = toScreen(camera, size, plateAt[0], plateAt[1], plateAt[2])
      showPlate(d.plate, plateText, plateBad, sx, sy)
    }
    if (badgeText === null) showBadge(d.badge, null, badgeKind, 0, 0)
    else {
      const [bx, by] = toScreen(camera, size, badgeAt[0], badgeAt[1], badgeAt[2])
      showBadge(d.badge, badgeText, badgeKind, bx, by)
    }

    if (wantCursor !== cursor.current) {
      cursor.current = wantCursor
      setCursor(state.gl.domElement, wantCursor)
    }
  })

  return (
    <>
      {/* The mat's pick plane: wider than the mat, so a click on the desk still clears the selection. */}
      <mesh position={[cols / 2, 0, rows / 2]} rotation={[-Math.PI / 2, 0, 0]} {...mat}>
        <planeGeometry args={[cols * 4, rows * 4]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      <group ref={foot} visible={false}>
        <mesh geometry={footGeometry} material={footFill} />
        <lineLoop geometry={footOutline} material={footLine} />
      </group>
      <group ref={ghost} visible={false}>
        <group ref={ghostBodyGroup}>
          {placeType !== null && <NodeMesh key={placeType} node={{ id: GHOST_ID, type: placeType, label: '', x: 0, y: 0 }} topology={topology} />}
        </group>
      </group>
      <group ref={linkGhost} visible={false}>
        <threeLine ref={linkLineRef} material={linkLine} />
        <mesh ref={linkSleeveRef} material={linkSleeve} />
        <lineSegments ref={linkArrowsRef} material={linkArrow} />
      </group>
      <mesh ref={unlinkRef} material={unlinkSleeve} visible={false} />
      <lineSegments ref={crops} material={cropMaterial} visible={false} />
      <lineSegments ref={sourceCrops} material={cropMaterial} visible={false} />
    </>
  )
}
