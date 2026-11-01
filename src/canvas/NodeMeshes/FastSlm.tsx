/*
 * Fast SLM: a tower of stacked cylinders with a lighter ring (iso D.slm).
 * The ring's white highlight marks turn while the model works, so the eye
 * can see it spin; the ring itself stays put so its shading stays true.
 */

import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial } from 'three'

import { reducedMotion } from '../../store/uiStore'
import { useEngine } from '../engineContext'
import { PX_Z } from '../iso'
import { CHIP, NodeShell, chipboardMaterial, glyphMaterial } from './common'
import { GlyphBuilder, SLM_RING, cylinder, merge } from './geometry'
import type { NodeMeshProps } from './types'

const TOP_PX = 35
const RING_RADIUS = 0.37
/** Radians per second at full utilisation. */
const SPIN_RATE = 2.4

const highlightMaterial = new LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55 })

function highlightArcs(): BufferGeometry {
  // iso.js draws two arcs (0.2–0.8 rad and 1.3–1.8 rad); repeated round the ring so it reads when it turns.
  const values: number[] = []
  const y = 25.5 * PX_Z
  const r = RING_RADIUS + 0.004
  for (let k = 0; k < 3; k++) {
    for (const [a0, a1] of [
      [0.2, 0.8],
      [1.3, 1.8],
    ]) {
      const steps = 6
      for (let i = 0; i < steps; i++) {
        const t0 = a0 + ((a1 - a0) * i) / steps + (k * 2 * Math.PI) / 3
        const t1 = a0 + ((a1 - a0) * (i + 1)) / steps + (k * 2 * Math.PI) / 3
        values.push(r * Math.cos(t0), y, r * Math.sin(t0), r * Math.cos(t1), y, r * Math.sin(t1))
      }
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(values, 3))
  return g
}

export function FastSlm({ node }: NodeMeshProps) {
  const engine = useEngine()
  const spinner = useRef<Group>(null)
  const body = useMemo(
    () =>
      merge([
        cylinder(0.36, 0, 4),
        cylinder(0.27, 4, 28),
        cylinder(RING_RADIUS, 24, 3, SLM_RING),
        cylinder(0.22, 32, 3),
      ]),
    [],
  )
  const arcs = useMemo(() => highlightArcs(), [])
  const glyph = useMemo(
    () =>
      new GlyphBuilder(TOP_PX)
        .polyline([
          [-0.1, -0.08],
          [0, 0],
          [-0.1, 0.08],
        ])
        .polyline([
          [0.02, -0.08],
          [0.12, 0],
          [0.02, 0.08],
        ])
        .build(),
    [],
  )

  useFrame((_, delta) => {
    const g = spinner.current
    const n = engine.world.nodeById[node.id]
    if (g === null || n === undefined || engine.paused || reducedMotion()) return
    g.rotation.y -= Math.min(delta, 0.25) * SPIN_RATE * engine.speed * (n.busy / n.concurrency)
  })

  return (
    <NodeShell id={node.id} type={node.type} x={node.x} y={node.y} light={[0.19, 16, 0.19]}>
      <mesh geometry={body} material={chipboardMaterial} userData={CHIP} castShadow />
      <group ref={spinner}>
        <lineSegments geometry={arcs} material={highlightMaterial} />
      </group>
      <lineSegments geometry={glyph} material={glyphMaterial} />
    </NodeShell>
  )
}
