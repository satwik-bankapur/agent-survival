/*
 * Glass tubes along each edge's grid route (iso tube()): 8 px of glass at
 * 30% on standoffs every 2 tiles, a faint inner core, a highlight along the
 * top, and chevrons etched for direction. A tube whose downstream queue is
 * over 70% full tints its core amber. While a node is hovered or selected,
 * its own tubes keep a brighter core and every other tube fades back, so
 * one node's wiring reads out of a crowded board. A coordinator's two-lane
 * link is two slimmer tubes side by side, the return lane with the brighter
 * rim; the engine runs the return back along the same route (D27, D33).
 *
 * Geometry is per edge and rebuilt only when the topology changes.
 */

import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferGeometry,
  CircleGeometry,
  CurvePath,
  CylinderGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineCurve3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  TubeGeometry,
  Vector3,
} from 'three'

import { TUBE_Y, type EdgeView, type Topology } from './board'
import { useEngine } from './engineContext'
import { focusedNodeId } from './focus'
import './threeLine'
import { PX_XY, PX_Z } from './iso'
import { HEX, OPACITY, linear } from './palette'
import { congested } from './thresholds'
import type { Pt } from './paths'
import { edgePickHandlers } from './pointer'

export const GLASS_RADIUS = 4 * PX_XY
/** Each lane of a two-lane tube is 5.5 px of glass instead of 8 (iso tube(), kind 'two'). */
const TWIN_SCALE = 5.5 / 8
/** The invisible sleeve a click on a tube hits: wider than the glass, so a 9 px tube is easy to pick. */
const PICK_RADIUS = 0.16
const CORE_RADIUS = 0.9 * PX_XY
const CONGESTED_CORE_RADIUS = 1.2 * PX_XY
const STANDOFF_EVERY = 2
const CHEVRON_EVERY = 1.1

const glassMaterial = new MeshBasicMaterial({
  color: HEX.glass,
  transparent: true,
  opacity: OPACITY.glass,
  depthWrite: false,
})
const highlightMaterial = new LineBasicMaterial({ color: HEX.glassGlow, transparent: true, opacity: 0.32 })
/** A return lane's rim is brighter, so the way back reads apart from the way out (iso: .7 against .32). */
const returnHighlightMaterial = new LineBasicMaterial({ color: HEX.glassGlow, transparent: true, opacity: 0.7 })
const chevronMaterial = new LineBasicMaterial({ color: HEX.glassGlow, transparent: true, opacity: 0.42 })
const standoffMaterial = new MeshBasicMaterial({ color: HEX.standoff })
/** Raycast, never drawn. */
const pickMaterial = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false })
const footMaterial = new MeshBasicMaterial({ color: HEX.standoffFoot })

const CORE = {
  calm: { color: linear(HEX.glassGlow), opacity: 0.26 },
  /** A tube of the focused node: the same glass, a brighter core. */
  focused: { color: linear(HEX.glassGlow), opacity: 0.62 },
  congested: { color: linear(HEX.warn).multiplyScalar(1.4), opacity: 0.8 },
} as const

/** Tubes not on the focused node fade to this share of their opacity. */
const UNFOCUSED_FADE = 0.4

/** How a tube looks: its congestion, and whether it's on the focused node, off it, or nothing is focused. */
const Focus = { NONE: 0, ON: 1, OFF: 2 } as const
type FocusValue = (typeof Focus)[keyof typeof Focus]

function curveOf(points: readonly Pt[], y: number): CurvePath<Vector3> {
  const path = new CurvePath<Vector3>()
  for (let i = 1; i < points.length; i++) {
    path.add(new LineCurve3(new Vector3(points[i - 1].x, y, points[i - 1].z), new Vector3(points[i].x, y, points[i].z)))
  }
  return path
}

/** Point and unit direction at arc length s (iso at()). */
function at(points: readonly Pt[], s: number): { x: number; z: number; dx: number; dz: number } {
  let rest = s
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const d = Math.hypot(b.x - a.x, b.z - a.z)
    if (rest <= d || i === points.length - 1) {
      const t = d > 0 ? Math.min(1, Math.max(0, rest / d)) : 0
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dx: d > 0 ? (b.x - a.x) / d : 1, dz: d > 0 ? (b.z - a.z) / d : 0 }
    }
    rest -= d
  }
  return { x: points[0].x, z: points[0].z, dx: 1, dz: 0 }
}

function chevrons(edge: EdgeView): BufferGeometry {
  const values: number[] = []
  const y = TUBE_Y + 3.4 * PX_Z
  for (let s = 0.6; s < edge.length - 0.2; s += CHEVRON_EVERY) {
    const { x, z, dx, dz } = at(edge.points, s)
    const nx = -dz
    const nz = dx
    values.push(x - dx * 0.09 + nx * 0.07, y, z - dz * 0.09 + nz * 0.07, x, y, z)
    values.push(x, y, z, x - dx * 0.09 - nx * 0.07, y, z - dz * 0.09 - nz * 0.07)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(values, 3))
  return g
}

function highlight(edge: EdgeView): BufferGeometry {
  const y = TUBE_Y + 2.7 * PX_Z * (edge.lanes === 'single' ? 1 : TWIN_SCALE)
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(edge.points.flatMap((p) => [p.x, y, p.z]), 3))
  return g
}

function Tube({ edge }: { edge: EdgeView }) {
  const engine = useEngine()
  const geometries = useMemo(() => {
    const curve = curveOf(edge.points, TUBE_Y)
    const segments = Math.max(8, Math.ceil(edge.length * 16))
    const k = edge.lanes === 'single' ? 1 : TWIN_SCALE
    return {
      glass: new TubeGeometry(curve, segments, GLASS_RADIUS * k, 10, false),
      core: new TubeGeometry(curve, segments, CORE_RADIUS * k, 6, false),
      wideCore: new TubeGeometry(curve, segments, CONGESTED_CORE_RADIUS * k, 6, false),
      highlight: highlight(edge),
      chevrons: chevrons(edge),
      pick: new TubeGeometry(curve, segments, PICK_RADIUS, 6, false),
    }
  }, [edge])
  const { cols, rows } = engine.world.catalog.board
  const pick = useMemo(() => edgePickHandlers(edge.id, cols, rows), [edge.id, cols, rows])
  // Its own glass and line materials, so it can fade back on its own while another node is focused.
  const materials = useMemo(
    () => ({
      glass: glassMaterial.clone(),
      highlight: (edge.lanes === 'back' ? returnHighlightMaterial : highlightMaterial).clone(),
      chevrons: chevronMaterial.clone(),
    }),
    [edge.lanes],
  )
  const rimOpacity = edge.lanes === 'back' ? returnHighlightMaterial.opacity : highlightMaterial.opacity
  const core = useRef<Mesh>(null)
  const coreMaterial = useRef<MeshBasicMaterial>(null)
  const isCongested = useRef(false)
  const focus = useRef<FocusValue>(Focus.NONE)

  useEffect(
    () => () => {
      for (const g of Object.values(geometries)) g.dispose()
    },
    [geometries],
  )
  // useFrame changes the materials through this ref, filled once they're mounted.
  const liveMaterials = useRef<typeof materials | null>(null)
  useEffect(() => {
    liveMaterials.current = materials
    return () => {
      liveMaterials.current = null
      for (const m of Object.values(materials)) m.dispose()
    }
  }, [materials])

  useFrame(() => {
    const target = engine.world.nodeById[edge.to]
    const now = target !== undefined && congested(target.queueLength, target.queueCapacity)
    const focusedId = focusedNodeId()
    const nowFocus: FocusValue = focusedId < 0 ? Focus.NONE : focusedId === edge.from || focusedId === edge.to ? Focus.ON : Focus.OFF
    const lines = liveMaterials.current
    if ((now === isCongested.current && nowFocus === focus.current) || core.current === null || coreMaterial.current === null || lines === null) return
    isCongested.current = now
    focus.current = nowFocus
    const look = now ? CORE.congested : nowFocus === Focus.ON ? CORE.focused : CORE.calm
    const fade = nowFocus === Focus.OFF ? UNFOCUSED_FADE : 1
    coreMaterial.current.color.copy(look.color)
    coreMaterial.current.opacity = look.opacity * fade
    core.current.geometry = now ? geometries.wideCore : geometries.core
    lines.glass.opacity = glassMaterial.opacity * fade
    lines.highlight.opacity = rimOpacity * fade
    lines.chevrons.opacity = chevronMaterial.opacity * fade
  })

  return (
    <group>
      <mesh ref={core} geometry={geometries.core}>
        <meshBasicMaterial
          ref={coreMaterial}
          color={CORE.calm.color}
          transparent
          opacity={CORE.calm.opacity}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
      <mesh geometry={geometries.glass} material={materials.glass} castShadow />
      <threeLine geometry={geometries.highlight} material={materials.highlight} />
      <lineSegments geometry={geometries.chevrons} material={materials.chevrons} />
      <mesh geometry={geometries.pick} material={pickMaterial} {...pick} />
    </group>
  )
}

/** Standoff posts and their feet for every tube, as two instanced meshes. */
function Standoffs({ edges }: { edges: readonly EdgeView[] }) {
  const posts = useRef<InstancedMesh>(null)
  const feet = useRef<InstancedMesh>(null)
  const spots = useMemo(() => {
    const out: { x: number; z: number }[] = []
    for (const edge of edges) for (let s = 1; s < edge.length - 0.3; s += STANDOFF_EVERY) out.push(at(edge.points, s))
    return out
  }, [edges])
  const postGeometry = useMemo(() => {
    const h = TUBE_Y - GLASS_RADIUS
    const g = new CylinderGeometry(0.8 * PX_XY, 0.8 * PX_XY, h, 6)
    g.translate(0, h / 2, 0)
    return g
  }, [])
  const footGeometry = useMemo(() => {
    const g = new CircleGeometry(2.4 * PX_XY, 12)
    g.rotateX(-Math.PI / 2)
    g.translate(0, 0.003, 0)
    return g
  }, [])

  useEffect(() => {
    const m = new Matrix4()
    for (const mesh of [posts.current, feet.current]) {
      if (mesh === null) continue
      spots.forEach((p, i) => mesh.setMatrixAt(i, m.makeTranslation(p.x, 0, p.z)))
      mesh.count = spots.length
      mesh.instanceMatrix.needsUpdate = true
    }
  }, [spots])

  const capacity = Math.max(1, spots.length)
  return (
    <>
      <instancedMesh key={`f${capacity}`} ref={feet} args={[footGeometry, footMaterial, capacity]} frustumCulled={false} />
      <instancedMesh key={`p${capacity}`} ref={posts} args={[postGeometry, standoffMaterial, capacity]} frustumCulled={false} castShadow />
    </>
  )
}

export function TubeSystem({ topology }: { topology: Topology }) {
  return (
    <group>
      {topology.edges.map((edge) => (
        <Tube key={edge.id} edge={edge} />
      ))}
      <Standoffs edges={topology.edges} />
    </group>
  )
}
