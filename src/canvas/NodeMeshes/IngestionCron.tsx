/*
 * Ingestion cron: a post with a pyramid cap and a clock on its face (iso
 * D.cron). It has no links. Each time it re-indexes, a ring pulses round it
 * and round every vector DB it reached (hero: the cron "Firing"), unless
 * reduced motion is on.
 */

import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, LineBasicMaterial, Mesh, MeshBasicMaterial, RingGeometry } from 'three'

import { reducedMotion } from '../../store/uiStore'
import { useEngine } from '../engineContext'
import { PX_Z } from '../iso'
import { HEX, linear } from '../palette'
import { CHIP, NodeShell, chipboardMaterial } from './common'
import { cylinder, flat, merge, prism, square, squareFrustum } from './geometry'
import type { NodeMeshProps } from './types'

const POST_PX = 30
const CAP_PX = 10
const FACE_Z = 0.32
const CLOCK_PX = 19
/** How long a pulse shows, seconds of game time. */
const PULSE_SEC = 1
/** Rings round vector DBs, at most; a board rarely has more than two. */
const MAX_DB_RINGS = 8

const handMaterial = new LineBasicMaterial({ color: '#3b352b' })

function ring(radius: number): BufferGeometry {
  const g = new RingGeometry(radius - 0.012, radius + 0.012, 48)
  g.rotateX(-Math.PI / 2)
  g.translate(0, 1 * PX_Z, 0)
  return g
}
const INNER = ring(0.55)
const OUTER = ring(0.85)
const AT_DB = ring(0.62)

function pulseMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color: linear(HEX.glassGlow).multiplyScalar(1.6),
    toneMapped: false,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: DoubleSide,
  })
}

export function IngestionCron({ node }: NodeMeshProps) {
  const engine = useEngine()
  const pulse = useRef<Group>(null)
  const dbRings = useRef<(Mesh | null)[]>([])
  const seen = useRef<number | null>(null)
  const inner = useMemo(pulseMaterial, [])
  const outer = useMemo(pulseMaterial, [])

  const body = useMemo(() => {
    const face = cylinder(1, 0, 0.1, flat('#d6ccb4'), { segments: 24 })
    face.rotateX(Math.PI / 2)
    face.scale(0.17, 6 * PX_Z, 1)
    face.translate(0, CLOCK_PX * PX_Z, FACE_Z + 0.004)
    return merge([prism(square(0, 0, 0.32), 0, POST_PX), squareFrustum(0.34, 0.04, POST_PX, CAP_PX), face])
  }, [])
  const hands = useMemo(() => {
    const y = CLOCK_PX * PX_Z
    const z = FACE_Z + 0.008
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute([0, y, z, 0, y + 4.5 * PX_Z, z, 0, y, z, 0.1, y, z], 3))
    return g
  }, [])

  useFrame(() => {
    const w = engine.world
    const n = w.nodeById[node.id]
    const g = pulse.current
    if (n === undefined || g === null) return
    // The first frame only learns the last run (or the placement); a pulse is for a run seen happening.
    if (seen.current === null) seen.current = n.indexedTick
    const fired = n.indexedTick !== seen.current
    const age = (w.tick - n.indexedTick) / (1000 / w.catalog.tickMs)
    const k = fired && !reducedMotion() ? Math.max(0, 1 - age / PULSE_SEC) : 0
    g.visible = k > 0
    if (k === 0) return
    inner.opacity = 0.55 * k
    outer.opacity = 0.25 * k
    let r = 0
    for (let i = 0; i < w.nodes.length && r < MAX_DB_RINGS; i++) {
      const db = w.nodes[i]
      if (db.type !== 'VECTOR_DB') continue
      const m = dbRings.current[r++]
      if (m === null || m === undefined) continue
      m.visible = true
      m.position.set(db.x - n.x, 0, db.y - n.y)
    }
    for (; r < MAX_DB_RINGS; r++) {
      const m = dbRings.current[r]
      if (m !== null && m !== undefined) m.visible = false
    }
  })

  return (
    <NodeShell id={node.id} type={node.type} x={node.x} y={node.y} light={[0.32, 26, -0.15]}>
      <mesh geometry={body} material={chipboardMaterial} userData={CHIP} castShadow />
      <lineSegments geometry={hands} material={handMaterial} />
      <group ref={pulse} visible={false}>
        <mesh geometry={INNER} material={inner} />
        <mesh geometry={OUTER} material={outer} />
        {Array.from({ length: MAX_DB_RINGS }, (_, i) => (
          <mesh
            key={i}
            ref={(m) => {
              dbRings.current[i] = m
            }}
            geometry={AT_DB}
            material={inner}
            visible={false}
          />
        ))}
      </group>
    </NodeShell>
  )
}
