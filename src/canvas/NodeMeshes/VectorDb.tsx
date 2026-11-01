/*
 * Vector DB: four stacked discs (iso D.vdb). Tier 2 (IVF) etches sector marks
 * round every disc and on top; tier 3 (HNSW) adds a layered lattice on top.
 * Drift turns the discs out of line, each a little further than the one below,
 * and a re-index snaps them back (design: "Vector DB tiers and drift", D46).
 *
 * Tier and drift are read from the engine every frame and written onto the
 * disc groups in place. Drift is the same for every RAG question the DB
 * serves and follows from time since its last index, so the player could
 * know it (D11).
 */

import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { BufferGeometry, Float32BufferAttribute, Group, LineSegments } from 'three'

import { vectorDbDrift } from '../../engine'
import { reducedMotion } from '../../store/uiStore'
import { useEngine } from '../engineContext'
import { PX_Z } from '../iso'
import { CHIP, NodeShell, chipboardMaterial, glyphMaterial } from './common'
import { GlyphBuilder, cylinder } from './geometry'
import type { NodeMeshProps } from './types'

const DISCS = 4
const PITCH_PX = 8
const DISC_PX = 6
const RADIUS = 0.4
export const VECTOR_DB_TOP_PX = (DISCS - 1) * PITCH_PX + DISC_PX
/** At full drift (iso drift 1), radians each disc turns per step from the middle, and tiles it slides. */
const TURN = 0.9
const SLIDE = 0.05
/** Easing rate toward the new drift, per second. */
const EASE = 10

function lines(values: readonly number[]): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(values, 3))
  return g
}

/** Vertical sector marks on a disc's rim (iso: glyph lines from z0 + .8 to z0 + 5.2). */
function rimMarks(angles: readonly number[]): BufferGeometry {
  const values: number[] = []
  const r = RADIUS + 0.004
  for (const a of angles) {
    const x = r * Math.cos(a)
    const z = r * Math.sin(a)
    values.push(x, 0.8 * PX_Z, z, x, 5.2 * PX_Z, z)
  }
  return lines(values)
}

/** iso tier 3: three nested squares rising over the top disc, corner to corner. */
function lattice(): BufferGeometry {
  const levels: readonly (readonly [number, number])[] = [
    [0.22, 33],
    [0.15, 37],
    [0.08, 41],
  ]
  const corners = (w: number): [number, number][] => [
    [-w, -w],
    [w, -w],
    [w, w],
    [-w, w],
  ]
  const values: number[] = []
  // Heights are measured from the top disc's base, since the lattice rides on it.
  const base = (DISCS - 1) * PITCH_PX
  levels.forEach(([w, zPx], i) => {
    const y = (zPx - base) * PX_Z
    const c = corners(w)
    for (let k = 0; k < 4; k++) values.push(c[k][0], y, c[k][1], c[(k + 1) % 4][0], y, c[(k + 1) % 4][1])
    if (i === levels.length - 1) return
    const [w2, z2] = levels[i + 1]
    const y2 = (z2 - base) * PX_Z
    const c2 = corners(w2)
    for (let k = 0; k < 4; k++) values.push(c[k][0], y, c[k][1], c2[k][0], y2, c2[k][1])
  })
  return lines(values)
}

const FIRST = Math.PI / 4
const OTHERS = [FIRST + Math.PI / 2, FIRST + Math.PI, FIRST + (3 * Math.PI) / 2]

export function VectorDb({ node }: NodeMeshProps) {
  const engine = useEngine()
  const discs = useRef<(Group | null)[]>([])
  const sectors = useRef<(LineSegments | null)[]>([])
  const spokes = useRef<LineSegments>(null)
  const hnsw = useRef<LineSegments>(null)
  const shown = useRef({ drift: 0, tier: 0 })

  const disc = useMemo(() => cylinder(RADIUS, 0, DISC_PX), [])
  const firstMark = useMemo(() => rimMarks([FIRST]), [])
  const otherMarks = useMemo(() => rimMarks(OTHERS), [])
  const topDot = useMemo(() => new GlyphBuilder(DISC_PX).circle(0, 0, 0.06, 12).build(), [])
  const topSpokes = useMemo(() => {
    const g = new GlyphBuilder(DISC_PX)
    for (const a of [FIRST, ...OTHERS]) g.line(0.08 * Math.cos(a), 0.08 * Math.sin(a), 0.36 * Math.cos(a), 0.36 * Math.sin(a))
    return g.build()
  }, [])
  const top = useMemo(() => lattice(), [])

  useFrame((_, delta) => {
    const n = engine.world.nodeById[node.id]
    const cap = engine.world.catalog.nodes.VECTOR_DB.driftCap
    const target = n === undefined || cap <= 0 ? 0 : vectorDbDrift(engine.world, n) / cap
    const tier = n?.tier ?? 1
    const s = shown.current
    const drift = reducedMotion() ? target : s.drift + (target - s.drift) * (1 - Math.exp(-Math.min(delta, 0.25) * EASE))
    if (Math.abs(drift - s.drift) < 1e-4 && tier === s.tier) return
    s.drift = Math.abs(drift - target) < 1e-4 ? target : drift
    s.tier = tier
    for (let i = 0; i < DISCS; i++) {
      const g = discs.current[i]
      if (g === null || g === undefined) continue
      g.rotation.y = -s.drift * (i - (DISCS - 1) / 2) * TURN
      g.position.x = s.drift * SLIDE * (i % 2 === 1 ? 1 : -1)
      const sector = sectors.current[i]
      if (sector !== null && sector !== undefined) sector.visible = tier >= 2
    }
    if (spokes.current !== null) spokes.current.visible = tier >= 2
    if (hnsw.current !== null) hnsw.current.visible = tier >= 3
  })

  return (
    <NodeShell id={node.id} type={node.type} x={node.x} y={node.y} light={[0.28, 3, 0.28]}>
      {Array.from({ length: DISCS }, (_, i) => (
        <group
          key={i}
          ref={(g) => {
            discs.current[i] = g
          }}
          position={[0, i * PITCH_PX * PX_Z, 0]}
        >
          <mesh geometry={disc} material={chipboardMaterial} userData={CHIP} castShadow />
          <lineSegments geometry={firstMark} material={glyphMaterial} />
          <lineSegments
            ref={(l) => {
              sectors.current[i] = l
            }}
            geometry={otherMarks}
            material={glyphMaterial}
            visible={false}
          />
          {i === DISCS - 1 && (
            <>
              <lineSegments geometry={topDot} material={glyphMaterial} />
              <lineSegments ref={spokes} geometry={topSpokes} material={glyphMaterial} visible={false} />
              <lineSegments ref={hnsw} geometry={top} material={glyphMaterial} visible={false} />
            </>
          )}
        </group>
      ))}
    </NodeShell>
  )
}
