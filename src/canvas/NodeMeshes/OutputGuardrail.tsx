/*
 * Output guardrail: two pillars under a lintel, with a glass scan plane that
 * sweeps up through the arch while it checks answers (iso D.guard).
 */

import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three'

import { reducedMotion } from '../../store/uiStore'
import { useEngine } from '../engineContext'
import { PX_Z } from '../iso'
import { HEX } from '../palette'
import { CHIP, NodeShell, chipboardMaterial } from './common'
import { merge, prism, rect } from './geometry'
import type { NodeMeshProps } from './types'

const PILLAR_PX = 26
const SCAN_LOW_PX = 2
const SCAN_HIGH_PX = 24
/** Seconds per sweep while working; idle it drifts at a quarter of that. */
const SWEEP_SEC = 1.2

const scanMaterial = new MeshBasicMaterial({
  color: HEX.glassGlow,
  transparent: true,
  opacity: 0.22,
  side: DoubleSide,
  depthWrite: false,
})
const scanEdgeMaterial = new LineBasicMaterial({ color: HEX.glassGlow, transparent: true, opacity: 0.6 })

const scanGeometry = (() => {
  const g = new PlaneGeometry(0.26, 0.6)
  g.rotateX(-Math.PI / 2)
  return g
})()

const scanEdge = (() => {
  const x = 0.13
  const z = 0.3
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute([-x, 0, -z, x, 0, -z, x, 0, z, -x, 0, z], 3))
  return g
})()

export function OutputGuardrail({ node }: NodeMeshProps) {
  const engine = useEngine()
  const scan = useRef<Group>(null)
  const phase = useRef(0)
  const body = useMemo(
    () =>
      merge([
        prism(rect(-0.14, -0.48, 0.28, 0.16), 0, PILLAR_PX),
        prism(rect(-0.14, 0.32, 0.28, 0.16), 0, PILLAR_PX),
        prism(rect(-0.16, -0.5, 0.32, 1), PILLAR_PX, 6),
      ]),
    [],
  )

  useFrame((_, delta) => {
    const g = scan.current
    const n = engine.world.nodeById[node.id]
    if (g === null || n === undefined) return
    if (!engine.paused && !reducedMotion()) {
      const rate = n.busy > 0 ? 1 : 0.25
      phase.current = (phase.current + (Math.min(delta, 0.25) * engine.speed * rate) / SWEEP_SEC) % 1
    }
    g.position.y = (SCAN_LOW_PX + (SCAN_HIGH_PX - SCAN_LOW_PX) * phase.current) * PX_Z
  })

  return (
    <NodeShell id={node.id} type={node.type} x={node.x} y={node.y} light={[0.16, 29, 0]}>
      <mesh geometry={body} material={chipboardMaterial} userData={CHIP} castShadow />
      <group ref={scan} position={[0, 13 * PX_Z, 0]}>
        <mesh geometry={scanGeometry} material={scanMaterial} />
        <lineLoop geometry={scanEdge} material={scanEdgeMaterial} />
      </group>
    </NodeShell>
  )
}
