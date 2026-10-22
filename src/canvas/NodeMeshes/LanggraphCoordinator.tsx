/*
 * LangGraph coordinator (iso D.coord): a round chipboard base, four posts
 * carrying a glass orbit track, and an inner hub engraved with two rings,
 * with small nubs round the rim.
 *
 * The track shows the coordinator's run slots (D26), one bead per slot:
 * an empty slot is a faint dot, a run in flight a short lime bead, and a run
 * past the runaway loop count (I-1) a longer, swollen amber bead. Length,
 * girth and colour all change, so a track full of stuck runs reads at a
 * glance without relying on colour. 16 slots share a small track, so the
 * beads carry no comet trails: they'd merge into one band. Counts are the coordinator's
 * own (busy, longRuns), the same as its plate's "16 of 16 runs, 9 stuck",
 * so nothing leaks past D11. The beads drift slowly round the track, and
 * hold still under reduced motion.
 */

import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { CapsuleGeometry, Color, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, TorusGeometry, Vector3 } from 'three'

import { reducedMotion } from '../../store/uiStore'
import { useEngine } from '../engineContext'
import { PX_ALONG, PX_XY, PX_Z, CAPSULE_DIAMETER_PX } from '../iso'
import { GLOW, HEX, OPACITY, linear } from '../palette'
import { CHIP, NodeShell, chipboardMaterial, glyphMaterial } from './common'
import { GlyphBuilder, cylinder, merge, prism, square } from './geometry'
import type { NodeMeshProps } from './types'

/** iso D.coord on a 2 × 2 footprint, halved onto our one tile. */
const BASE_R = 0.46
const BASE_PX = 10
const HUB_R = 0.24
const HUB_TOP_PX = 17
const TRACK_R = 0.37
const TRACK_PX = 20
export const COORDINATOR_TOP_PX = TRACK_PX + 3

const glassMaterial = new MeshBasicMaterial({ color: HEX.glass, transparent: true, opacity: OPACITY.glass + 0.08, depthWrite: false })
const trackGeometry = (() => {
  const g = new TorusGeometry(TRACK_R, 2.5 * PX_XY, 6, 48)
  g.rotateX(Math.PI / 2)
  g.translate(0, TRACK_PX * PX_Z, 0)
  return g
})()

/** Run slots most coordinators have (D26); the mesh grows if a catalog ever asks for more. */
const MAX_SLOTS = 32
const DIAMETER = CAPSULE_DIAMETER_PX * PX_XY
const BEAD = {
  empty: { length: 2 * PX_ALONG, girth: 0.5, color: linear(HEX.inkFaint) },
  run: { length: 3.5 * PX_ALONG, girth: 0.8, color: linear(HEX.pktAgent).multiplyScalar(GLOW.capsule) },
  stuck: { length: 5.5 * PX_ALONG, girth: 1.5, color: linear(HEX.warn).multiplyScalar(GLOW.capsule) },
} as const
/** Drift round the track, radians per second. */
const DRIFT = 0.25

const beadGeometry = (() => {
  const g = new CapsuleGeometry(0.5, 1, 4, 10)
  g.rotateZ(Math.PI / 2)
  g.scale(0.5, 1, 1)
  return g
})()
const beadMaterial = new MeshBasicMaterial({ toneMapped: false })

// Scratch, reused every frame.
const m = new Matrix4()
const pos = new Vector3()
const tangent = new Vector3()
const quat = new Quaternion()
const scale = new Vector3()
const X_AXIS = new Vector3(1, 0, 0)

function Orbit({ nodeId }: { nodeId: number }) {
  const engine = useEngine()
  const beads = useRef<InstancedMesh>(null)
  const phase = useRef(0)
  const colored = useMemo(() => new Color(), [])

  useFrame((_, delta) => {
    const mesh = beads.current
    const node = engine.world.nodeById[nodeId]
    if (mesh === null || node === undefined) return
    if (!reducedMotion()) phase.current = (phase.current + Math.min(delta, 0.25) * DRIFT) % (Math.PI * 2)
    const slots = Math.min(node.concurrency, MAX_SLOTS)
    const busy = Math.min(node.busy, slots)
    const stuck = Math.min(node.longRuns, busy)
    for (let i = 0; i < slots; i++) {
      // Runs fill the track from the front; stuck ones lead, so they bunch where they read.
      const look = i < stuck ? BEAD.stuck : i < busy ? BEAD.run : BEAD.empty
      const a = phase.current + (i / slots) * Math.PI * 2
      pos.set(TRACK_R * Math.cos(a), TRACK_PX * PX_Z, TRACK_R * Math.sin(a))
      tangent.set(-Math.sin(a), 0, Math.cos(a))
      quat.setFromUnitVectors(X_AXIS, tangent)
      const d = DIAMETER * look.girth
      scale.set(look.length, d, d)
      m.compose(pos, quat, scale)
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, colored.copy(look.color))
    }
    mesh.count = slots
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh ref={beads} args={[beadGeometry, beadMaterial, MAX_SLOTS]} frustumCulled={false} />
  )
}

export function LanggraphCoordinator({ node }: NodeMeshProps) {
  const body = useMemo(() => {
    const parts = [cylinder(BASE_R, 0, BASE_PX, undefined, { segments: 48 }), cylinder(HUB_R, BASE_PX, HUB_TOP_PX - BASE_PX, undefined, { segments: 36 })]
    // Four posts carry the track.
    for (const deg of [45, 135, 225, 315]) {
      const a = (deg * Math.PI) / 180
      parts.push(prism(square(TRACK_R * Math.cos(a), TRACK_R * Math.sin(a), 0.022), BASE_PX, TRACK_PX - 2 - BASE_PX))
    }
    // Nubs round the rim.
    for (let deg = 0; deg < 360; deg += 60) {
      const a = (deg * Math.PI) / 180
      parts.push(prism(square(BASE_R * Math.cos(a), BASE_R * Math.sin(a), 0.025), 3, 4))
    }
    return merge(parts)
  }, [])
  const glyph = useMemo(() => new GlyphBuilder(HUB_TOP_PX).circle(0, 0, 0.14, 24).circle(0, 0, 0.06, 16).build(), [])
  return (
    <NodeShell id={node.id} type={node.type} x={node.x} y={node.y} light={[0.33, 5, 0.33]}>
      <mesh geometry={body} material={chipboardMaterial} userData={CHIP} castShadow />
      <lineSegments geometry={glyph} material={glyphMaterial} />
      <mesh geometry={trackGeometry} material={glassMaterial} />
      {node.id >= 0 && <Orbit nodeId={node.id} />}
    </NodeShell>
  )
}
