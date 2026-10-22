/*
 * LLM-as-a-judge (iso D.judge): a chipboard lighthouse. A tapering tower, a
 * gallery, a clear acrylic lantern with a warm lamp, and a cap. Its beam
 * sweeps the board, the lighthouse sweep: the judge samples answers as they
 * land, so it never stops looking. Reduced motion holds the beam still.
 */

import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, MeshBasicMaterial, SphereGeometry } from 'three'

import { reducedMotion } from '../../store/uiStore'
import { PX_XY, PX_Z } from '../iso'
import { GLOW, HEX, OPACITY, linear } from '../palette'
import { CHIP, GHOST_ID, NodeShell, chipboardMaterial } from './common'
import { cylinder, merge } from './geometry'
import type { NodeMeshProps } from './types'

export const JUDGE_TOP_PX = 72
const LAMP_PX = 58.5
/** The beam's reach and half-width at its end, tiles; one turn takes this long, seconds. */
const BEAM_REACH = 7
const BEAM_HALF = 1.4
const TURN_SEC = 12

const lanternMaterial = new MeshBasicMaterial({ color: HEX.acrylic, transparent: true, opacity: OPACITY.acrylic * 0.7, depthWrite: false })
const lampGeometry = new SphereGeometry(3.2 * PX_XY, 12, 8)
const lampMaterial = new MeshBasicMaterial({ color: linear('#fff6e2').multiplyScalar(GLOW.capsule), toneMapped: false })
/** iso: the beam at .14 over the mat. Below the bloom threshold, so it lights without glowing. */
const beamMaterial = new MeshBasicMaterial({ color: '#fff4dc', transparent: true, opacity: 0.1, depthWrite: false, side: DoubleSide })
const beamGeometry = (() => {
  const g = new BufferGeometry()
  const y = 0.02
  g.setAttribute('position', new Float32BufferAttribute([0, y, 0, BEAM_REACH, y, -BEAM_HALF, BEAM_REACH, y, BEAM_HALF], 3))
  return g
})()

export function LlmJudge({ node }: NodeMeshProps) {
  const tower = useMemo(
    () =>
      merge([
        cylinder(0.28, 0, 52, undefined, { topRadius: 0.17 }),
        cylinder(0.25, 52, 2),
        cylinder(0.18, 63, 8, undefined, { topRadius: 0.03, segments: 24 }),
      ]),
    [],
  )
  const lantern = useMemo(() => cylinder(0.14, 54, 9, undefined, { segments: 24 }), [])
  const beam = useRef<Group>(null)
  useFrame(({ clock }) => {
    if (beam.current === null || reducedMotion()) return
    beam.current.rotation.y = -((clock.elapsedTime / TURN_SEC) * Math.PI * 2)
  })
  return (
    <NodeShell id={node.id} type={node.type} x={node.x} y={node.y} light={[0.2, 4, 0.2]}>
      <mesh geometry={tower} material={chipboardMaterial} userData={CHIP} castShadow />
      <mesh geometry={lantern} material={lanternMaterial} />
      <mesh geometry={lampGeometry} material={lampMaterial} position={[0, LAMP_PX * PX_Z, 0]} />
      {node.id !== GHOST_ID && (
        <group ref={beam} rotation={[0, -Math.PI / 4, 0]}>
          <mesh geometry={beamGeometry} material={beamMaterial} />
        </group>
      )}
    </NodeShell>
  )
}
