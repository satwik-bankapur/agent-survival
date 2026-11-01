/*
 * User plazas: a low blue slab of faceless white scale figures at each end
 * of the board (iso plaza(), fig()). The entry crowd grows with traffic; the
 * exit crowd is the trust meter and thins as trust falls.
 *
 * Trust is player-visible, so reading it here leaks nothing (D11).
 */

import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { CapsuleGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, SphereGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { trustValue } from '../../engine'
import { useEngine } from '../engineContext'
import { PX_XY, PX_Z } from '../iso'
import { HEX } from '../palette'
import { PLAZA_FULL, PLAZA_MAX, entryCrowd, exitCrowd, type Rect } from '../paths'
import { FIGURE, PLAZA, paint, prism, rect } from './geometry'
import { nodePickHandlers } from '../pointer'
import type { NodeMeshProps } from './types'

const SLAB_PX = 2

/** iso.js's mulberry32, so the crowd lays out the same way every run. */
function mulberry(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Places `full` figures on a jittered grid (iso plaza()), then orders them so
 * the first n are the ones that stay when only n remain.
 */
function layout(r: Rect, full: number, seed: number): { x: number; z: number }[] {
  const w = r.x1 - r.x0
  const d = r.z1 - r.z0
  const cols = Math.max(1, Math.round(Math.sqrt((full * w) / d)))
  const rows = Math.ceil(full / cols)
  const rand = mulberry(seed)
  const places: { x: number; z: number; keep: number }[] = []
  for (let i = 0; i < full; i++) {
    const ci = i % cols
    const ri = Math.floor(i / cols)
    places.push({
      x: r.x0 + ((ci + 0.5 + (rand() - 0.5) * 0.55) * w) / cols,
      z: r.z0 + ((ri + 0.5 + (rand() - 0.5) * 0.55) * d) / rows,
      keep: 0,
    })
  }
  const order = mulberry(11)
  for (const p of places) p.keep = order()
  return places.sort((a, b) => a.keep - b.keep)
}

/** A figure: a rounded body 2.4 × 5.4 px and a head, 6 to 8 px tall in all (iso fig()). */
export const figureGeometry = (() => {
  const radius = 1.2 * PX_XY
  const bodyHeight = 5.4 * PX_Z
  const body = new CapsuleGeometry(radius, Math.max(bodyHeight - 2 * radius, 0.001), 3, 8)
  body.translate(0, bodyHeight / 2, 0)
  const head = new SphereGeometry(1.15 * PX_XY, 10, 8)
  head.translate(0, 6.75 * PX_Z, 0)
  const merged = mergeGeometries([body.toNonIndexed(), head.toNonIndexed()], false)
  body.dispose()
  head.dispose()
  if (merged === null) throw new Error('Figure geometry failed to merge')
  return paint(merged, FIGURE)
})()
export const figureMaterial = new MeshBasicMaterial({ vertexColors: true })
const slabMaterial = new MeshBasicMaterial({ vertexColors: true })

export function UserPlaza({ node, area }: NodeMeshProps & { area: Rect }) {
  const engine = useEngine()
  const entry = node.type === 'USERS_IN'
  const full = entry ? PLAZA_MAX : PLAZA_FULL
  const mesh = useRef<InstancedMesh>(null)
  const last = useRef(-1)

  const slab = useMemo(() => prism(rect(area.x0, area.z0, area.x1 - area.x0, area.z1 - area.z0), 0, SLAB_PX, PLAZA), [area])
  const places = useMemo(() => layout(area, full, entry ? 3 : 8), [area, full, entry])
  const matrices = useMemo(() => {
    const m = new Matrix4()
    return places.map((p) => m.makeTranslation(p.x, SLAB_PX * PX_Z, p.z).clone())
  }, [places])

  useFrame(() => {
    const m = mesh.current
    if (m === null) return
    if (last.current < 0) for (let i = 0; i < matrices.length; i++) m.setMatrixAt(i, matrices[i])
    const n = entry ? entryCrowd(engine.snapshot.traffic.ratePerSec) : exitCrowd(trustValue(engine.world.trust))
    if (n === last.current) return
    last.current = n
    m.count = Math.min(n, matrices.length)
    m.instanceMatrix.needsUpdate = true
  })

  return (
    <group {...nodePickHandlers(node.id, node.x, node.y)}>
      <mesh geometry={slab} material={slabMaterial} />
      <mesh
        position={[(area.x0 + area.x1) / 2, SLAB_PX * PX_Z + 0.002, (area.z0 + area.z1) / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[area.x1 - area.x0, area.z1 - area.z0]} />
        <shadowMaterial transparent opacity={0.3} color={HEX.shadow} />
      </mesh>
      <instancedMesh ref={mesh} args={[figureGeometry, figureMaterial, full]} frustumCulled={false} castShadow />
    </group>
  )
}
