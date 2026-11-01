/*
 * Every live packet as a glowing capsule (D34), in one InstancedMesh.
 *
 * Each frame walks the engine's own structures (edge rings, virtual hops,
 * queue heads) and writes instance buffers directly; nothing per packet ever
 * touches React state, and nothing here allocates.
 *
 *   on an edge     interpolated along the edge's samples (D33), along its tangent
 *   on a hop       a raised arc: cache hits to the exit, JSON retries back to the model
 *   queued         upright in the node's rack, oldest first, at most 12 (D38)
 *   in a worker    hidden inside the node
 *
 * Length comes from tokens and colour from category. Complex chats carry a
 * ring round their middle, so difficulty never rests on length alone, and
 * refusals are hollow outlines with no glow. Once a model has written the
 * answer (or the cache has), the capsule carries a white-hot output tip on
 * its leading 16%, so answered traffic reads apart from prompts still on
 * their way to a model (D34). A RAG question carries one small plate per
 * retrieved chunk along its top, so the reranker visibly strips them, and
 * an attack flies as a faceted magenta shard (design: "Token capsules"). Ground truth such as
 * isHallucinated is never read: a wrong answer looks exactly like a right one (D10, D11).
 *
 * Agent runs (Session 9, design: "Bands", "Modifiers"): a frosted, dim band over the tail for the
 * cached prefix the run has built up (D6), the body for new input, the white tip for output; a
 * lime comet trail behind that grows with every model pass; and past the length cap the capsule
 * swells, up to twice as fat, so a runaway reads at a glance (D34). A prompt carrying personal
 * data wears a small amber tag, which the redactor pops into a black bar. Taint stays unseen (D20).
 */

import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  BufferAttribute,
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  LineDashedMaterial,
  Line,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  ShaderMaterial,
  TorusGeometry,
  Vector3,
} from 'three'

import { routeLength, type Category, type Packet } from '../engine'
import { TUBE_Y, hopAnchor, type Topology } from './board'
import { clearPicks, recordPick, type CapsulePicks } from './capsulePicks'
import { useEngine } from './engineContext'
import './threeLine'
import { CAPSULE_DIAMETER_PX, MAX_CHUNKS, PX_ALONG, PX_XY, PX_Z, capsuleLengthPx, capsuleSwell, chunkCount, cometLengthPx } from './iso'
import { GLOW, HEX, linear } from './palette'
import {
  RACK_RADIUS,
  SAMPLE_STRIDE,
  SAMPLES_PER_EDGE,
  Urgency,
  arcPoint,
  edgeT,
  hopLift,
  rackSlotAngle,
  rackUrgency,
  rackView,
  samplePoint,
} from './paths'

/** A rack capsule stands 7 px tall and 2.6 px wide (iso rackCap). */
const RACK_HEIGHT = 7 * PX_Z
const RACK_WIDTH = 2.6 * PX_XY
const DIAMETER = CAPSULE_DIAMETER_PX * PX_XY

/** A capsule of length 1 and diameter 1 along +X, scaled per instance. */
const capsuleGeometry = (() => {
  const g = new CapsuleGeometry(0.5, 1, 4, 12)
  g.rotateZ(Math.PI / 2)
  g.scale(0.5, 1, 1)
  return g
})()

/** The complex-chat ring, axis along +X, radius 0.5 (iso: a thin ring round its middle). */
const ringGeometry = (() => {
  const g = new TorusGeometry(0.5, 0.11, 6, 18)
  g.rotateY(Math.PI / 2)
  return g
})()
const RING_SCALE = DIAMETER * 1.25

/** The output tip: the leading share of an answered capsule, a little proud of its body (design: "Three bands"). */
const TIP_SHARE = 0.16
const TIP_DIAMETER = DIAMETER * 1.06
const tipMaterial = new MeshBasicMaterial({ color: new Color(1, 1, 1).multiplyScalar(GLOW.capsule * 1.5), toneMapped: false })

const CATEGORY_GLOW: Readonly<Record<Category, Color>> = {
  CHAT: linear(HEX.pktChat).multiplyScalar(GLOW.capsule),
  RAG_QUERY: linear(HEX.pktRag).multiplyScalar(GLOW.capsule),
  AGENT_TASK: linear(HEX.pktAgent).multiplyScalar(GLOW.capsule),
  ADVERSARIAL: linear(HEX.pktAdv).multiplyScalar(GLOW.capsule),
}
/** Racks sit with the chipboard, below the bloom threshold (iso draws them in the body layer). */
const CATEGORY_RACK: Readonly<Record<Category, Color>> = {
  CHAT: linear(HEX.pktChat),
  RAG_QUERY: linear(HEX.pktRag),
  AGENT_TASK: linear(HEX.pktAgent),
  ADVERSARIAL: linear(HEX.pktAdv),
}
const RACK_WARN = linear(HEX.warn)
const RACK_ALARM = linear(HEX.alarm)

/** iso: a dark seam across the complex ring (#9a8c70), so it reads as a band, not more glow. */
const ringMaterial = new MeshBasicMaterial({ color: '#9a8c70' })

/** A refusal is a hollow outline in dim ink: only the silhouette is drawn. */
const refusedMaterial = new ShaderMaterial({
  uniforms: { uColor: { value: linear(HEX.inkDim) } },
  vertexShader: /* glsl */ `
    varying vec3 vNormal;
    void main() {
      vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
      gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    varying vec3 vNormal;
    void main() {
      if (abs(vNormal.z) > 0.42) discard;
      gl_FragColor = vec4(uColor, 1.0);
    }
  `,
})

/** iso capsule(): a 2.1 k square per chunk on a 5 k capsule, spaced at most 1.7 widths, riding .6 k above it. */
const CHUNK = DIAMETER * 0.42
const CHUNK_GAP = CHUNK * 1.7
const CHUNK_LIFT = DIAMETER / 2 + CHUNK / 2 + DIAMETER * 0.12
const chunkGeometry = new BoxGeometry(1, 1, 1)
const chunkMaterial = new MeshBasicMaterial({
  color: linear(HEX.pktRag).lerp(new Color(1, 1, 1), 0.35).multiplyScalar(GLOW.capsule),
  toneMapped: false,
})

/**
 * The adversarial shard: an irregular octahedron along +X (iso: "faceted like a crystal shard"),
 * one tone per facet so it reads faceted on an unlit material.
 */
const shardGeometry = (() => {
  const tip: [number, number, number] = [0.5, 0, 0]
  const tail: [number, number, number] = [-0.5, 0.05, 0]
  const ring: [number, number, number][] = [
    [0.1, 0.55, 0],
    [-0.18, 0, 0.5],
    [0.05, -0.5, 0.05],
    [-0.08, 0.05, -0.55],
  ]
  const tones = [1, 0.62, 0.84, 0.5, 0.74, 0.55, 0.92, 0.66]
  const positions: number[] = []
  const colors: number[] = []
  for (let i = 0; i < 4; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % 4]
    for (const [k, face] of [
      [i, [tip, a, b]],
      [i + 4, [tail, b, a]],
    ] as const) {
      for (const v of face) {
        positions.push(...v)
        colors.push(tones[k], tones[k], tones[k])
      }
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  g.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
  return g
})()
const shardMaterial = new MeshBasicMaterial({
  color: linear(HEX.pktAdv).multiplyScalar(GLOW.capsule),
  vertexColors: true,
  toneMapped: false,
  side: DoubleSide,
})
/** A shard is a little fatter than a capsule, so its facets read. */
const SHARD_DIAMETER = DIAMETER * 1.5

/** The cached prefix band: the body colour 60% toward #5E7488, frosted and dim, below the bloom threshold (iso capsule()). */
const cachedMaterial = new MeshBasicMaterial({ color: linear(HEX.pktAgent).lerp(linear('#5E7488'), 0.6) })
const BAND_DIAMETER = 1.04

/** The comet trail: a lime cone behind the tail at 40%, its tip pointing back (iso: d × .84 at its base). */
const cometGeometry = (() => {
  const g = new ConeGeometry(0.5, 1, 10)
  g.rotateZ(Math.PI / 2)
  return g
})()
const cometMaterial = new MeshBasicMaterial({
  color: linear(HEX.pktAgent).multiplyScalar(GLOW.capsule),
  transparent: true,
  opacity: 0.4,
  depthWrite: false,
  toneMapped: false,
})
const COMET_DIAMETER = 0.84

/** The PII tag: 3.8 × 2.5 px of amber riding on top; the redactor's bar: 4.4 px of black round the middle (iso capsule()). */
const PII_TAG = new Vector3(3.8 * PX_ALONG, 2.5 * PX_Z, 1.6 * PX_XY)
const piiMaterial = new MeshBasicMaterial({ color: linear(HEX.warn).multiplyScalar(GLOW.capsule), toneMapped: false })
const BAR_ALONG = 4.4 * PX_ALONG
const BAR_DIAMETER = 1.08
const barMaterial = new MeshBasicMaterial({ color: '#050506' })

// Scratch values, reused every frame.
const m = new Matrix4()
const pos = new Vector3()
const dir = new Vector3()
const quat = new Quaternion()
const scale = new Vector3()
const tipPos = new Vector3()
const tipScale = new Vector3()
const chunkPos = new Vector3()
const chunkScale = new Vector3(CHUNK, CHUNK, CHUNK)
const partPos = new Vector3()
const partScale = new Vector3()
const Y_AXIS = new Vector3(0, 1, 0)
const X_AXIS = new Vector3(1, 0, 0)
const UPRIGHT = new Quaternion().setFromUnitVectors(X_AXIS, new Vector3(0, 1, 0))
const RACK_SCALE = new Vector3(RACK_HEIGHT, RACK_WIDTH, RACK_WIDTH)
const RING = new Vector3(RING_SCALE, RING_SCALE, RING_SCALE)
const onEdge = { x: 0, z: 0, dx: 1, dz: 0 }
const onArc = { x: 0, y: 0, z: 0, dx: 1, dy: 0, dz: 0 }
const anchorA = { x: 0, y: 0, z: 0 }
const anchorB = { x: 0, y: 0, z: 0 }

/**
 * Tokens the capsule shows: its input, plus the answer once a model has written it. In an agent run
 * the last pass's output is already part of the next input (D6), so it isn't added twice.
 */
function shownTokens(p: Packet): number {
  const inRun = p.category === 'AGENT_TASK' && p.loopCount > 0
  return p.newInputTokens + p.cachedPrefixTokens + (p.producedByModelId >= 0 && !inRun ? p.outputTokensGenerated : 0)
}

export function CapsuleSwarm({ topology, picks }: { topology: Topology; picks?: CapsulePicks }) {
  const engine = useEngine()
  const capacity = engine.world.pool.size
  const main = useRef<InstancedMesh>(null)
  const rings = useRef<InstancedMesh>(null)
  const refused = useRef<InstancedMesh>(null)
  const tips = useRef<InstancedMesh>(null)
  const chunks = useRef<InstancedMesh>(null)
  const shards = useRef<InstancedMesh>(null)
  const bands = useRef<InstancedMesh>(null)
  const comets = useRef<InstancedMesh>(null)
  const tags = useRef<InstancedMesh>(null)
  const bars = useRef<InstancedMesh>(null)
  const material = useMemo(() => new MeshBasicMaterial({ toneMapped: false }), [])

  useEffect(() => {
    // Create the colour attribute up front, so the frame loop never allocates it.
    const mesh = main.current
    if (mesh !== null) for (let i = 0; i < capacity; i++) mesh.setColorAt(i, CATEGORY_RACK.CHAT)
    return () => material.dispose()
  }, [capacity, material])

  useFrame(() => {
    const mesh = main.current
    const ringMesh = rings.current
    const refusedMesh = refused.current
    const tipMesh = tips.current
    const chunkMesh = chunks.current
    const shardMesh = shards.current
    const bandMesh = bands.current
    const cometMesh = comets.current
    const tagMesh = tags.current
    const barMesh = bars.current
    if (
      mesh === null ||
      ringMesh === null ||
      refusedMesh === null ||
      tipMesh === null ||
      chunkMesh === null ||
      shardMesh === null ||
      bandMesh === null ||
      cometMesh === null ||
      tagMesh === null ||
      barMesh === null
    )
      return
    const w = engine.world
    const packets = w.pool.packets
    const tick = w.tick
    const alpha = engine.alpha
    let n = 0
    let nRing = 0
    let nRefused = 0
    let nTip = 0
    let nChunk = 0
    let nShard = 0
    let nBand = 0
    let nComet = 0
    let nTag = 0
    let nBar = 0
    if (picks !== undefined) clearPicks(picks)

    const travel = (p: Packet) => {
      dir.normalize()
      quat.setFromUnitVectors(X_AXIS, dir)
      const tokens = shownTokens(p)
      const length = capsuleLengthPx(tokens) * PX_ALONG
      const d = DIAMETER * capsuleSwell(tokens)
      scale.set(length, d, d)
      m.compose(pos, quat, scale)
      if (picks !== undefined) recordPick(picks, p.index, p.serial, pos.x, pos.y, pos.z)
      if (p.refused) {
        refusedMesh.setMatrixAt(nRefused++, m)
        return
      }
      if (p.category === 'ADVERSARIAL') {
        scale.set(length, SHARD_DIAMETER, SHARD_DIAMETER)
        m.compose(pos, quat, scale)
        shardMesh.setMatrixAt(nShard++, m)
        return
      }
      const plates = p.category === 'RAG_QUERY' ? chunkCount(p.contextTokens) : 0
      if (plates > 0) {
        // Along the capsule from its tail, riding on top (world up).
        const gap = Math.min((length - d * 0.6) / plates, CHUNK_GAP)
        for (let c = 0; c < plates; c++) {
          const along = -length / 2 + d * 0.3 + c * gap + CHUNK / 2
          chunkPos.copy(dir).multiplyScalar(along).add(pos).addScaledVector(Y_AXIS, CHUNK_LIFT + (d - DIAMETER) / 2)
          m.compose(chunkPos, quat, chunkScale)
          chunkMesh.setMatrixAt(nChunk++, m)
        }
        m.compose(pos, quat, scale)
      }
      mesh.setMatrixAt(n, m)
      mesh.setColorAt(n, CATEGORY_GLOW[p.category])
      n++
      // The ring marks complex chat; agent tasks are always complex and read by their trail instead.
      if (p.difficulty === 'COMPLEX' && p.category === 'CHAT') {
        m.compose(pos, quat, RING)
        ringMesh.setMatrixAt(nRing++, m)
      }
      if (p.cachedPrefixTokens > 0) {
        const band = Math.max(length * (p.cachedPrefixTokens / tokens), d)
        partPos.copy(dir).multiplyScalar((band - length) / 2).add(pos)
        partScale.set(band, d * BAND_DIAMETER, d * BAND_DIAMETER)
        m.compose(partPos, quat, partScale)
        bandMesh.setMatrixAt(nBand++, m)
      }
      if (p.category === 'AGENT_TASK' && p.loopCount > 0) {
        const comet = cometLengthPx(p.loopCount) * PX_ALONG
        partPos.copy(dir).multiplyScalar(-(length - d) / 2 - comet / 2).add(pos)
        partScale.set(comet, d * COMET_DIAMETER, d * COMET_DIAMETER)
        m.compose(partPos, quat, partScale)
        cometMesh.setMatrixAt(nComet++, m)
      }
      if (p.producedByModelId >= 0 || p.cacheHit) {
        const tip = length * TIP_SHARE
        const tipD = d * (TIP_DIAMETER / DIAMETER)
        tipPos.copy(dir).multiplyScalar((length - tip) / 2).add(pos)
        tipScale.set(tip, tipD, tipD)
        m.compose(tipPos, quat, tipScale)
        tipMesh.setMatrixAt(nTip++, m)
      }
      if (p.containsPII) {
        partPos.copy(pos).addScaledVector(Y_AXIS, d / 2 + PII_TAG.y / 2 + 0.6 * PX_Z)
        m.compose(partPos, quat, PII_TAG)
        tagMesh.setMatrixAt(nTag++, m)
      } else if (p.redacted) {
        partScale.set(BAR_ALONG, d * BAR_DIAMETER, d * BAR_DIAMETER)
        m.compose(pos, quat, partScale)
        barMesh.setMatrixAt(nBar++, m)
      }
    }

    // On edges, in delivery order.
    const samples = topology.samples
    for (let e = 0; e < w.edges.length; e++) {
      const edge = w.edges[e]
      const slot = edge.id < topology.slotOfEdge.length ? topology.slotOfEdge[edge.id] : -1
      if (slot < 0) continue
      const base = slot * SAMPLES_PER_EDGE * SAMPLE_STRIDE
      for (let k = 0; k < edge.length; k++) {
        const p = packets[edge.ring[(edge.head + k) % edge.ring.length]]
        samplePoint(samples, base, edgeT(tick, alpha, p.enterTick, p.transitTicks), onEdge)
        pos.set(onEdge.x, TUBE_Y, onEdge.z)
        dir.set(onEdge.dx, 0, onEdge.dz)
        travel(p)
      }
    }

    // On virtual hops: wireless, but timed like a wire (D15, D16).
    for (let i = 0; i < w.virtualLength; i++) {
      const p = packets[w.virtual[i]]
      const from = w.nodeById[p.fromNodeId]
      const to = w.nodeById[p.nodeId]
      if (from === undefined || to === undefined) continue
      hopAnchor(from, anchorA)
      hopAnchor(to, anchorB)
      const lift = hopLift(routeLength(from.x, from.y, to.x, to.y))
      arcPoint(anchorA.x, anchorA.y, anchorA.z, anchorB.x, anchorB.y, anchorB.z, lift, edgeT(tick, alpha, p.enterTick, p.transitTicks), onArc)
      pos.set(onArc.x, onArc.y, onArc.z)
      dir.set(onArc.dx, onArc.dy, onArc.dz)
      travel(p)
    }

    // Queued, upright in the rack: the 12 nearest the front of the queue (D38).
    for (let j = 0; j < w.nodes.length; j++) {
      const node = w.nodes[j]
      if (node.queueCapacity === 0) continue
      const shown = rackView(node.queueLength).shown
      const cx = node.x + 0.5
      const cz = node.y + 0.5
      for (let k = 0; k < shown; k++) {
        const p = packets[node.queue[(node.queueHead + k) % node.queue.length]]
        const a = rackSlotAngle(k)
        pos.set(cx + RACK_RADIUS * Math.cos(a), RACK_HEIGHT / 2, cz + RACK_RADIUS * Math.sin(a))
        m.compose(pos, UPRIGHT, RACK_SCALE)
        if (picks !== undefined) recordPick(picks, p.index, p.serial, pos.x, pos.y, pos.z)
        mesh.setMatrixAt(n, m)
        const urgency = rackUrgency(tick, p.createdTick, p.deadlineTick)
        mesh.setColorAt(n, urgency === Urgency.ALARM ? RACK_ALARM : urgency === Urgency.WARN ? RACK_WARN : CATEGORY_RACK[p.category])
        n++
      }
    }

    mesh.count = n
    ringMesh.count = nRing
    refusedMesh.count = nRefused
    tipMesh.count = nTip
    tipMesh.instanceMatrix.needsUpdate = true
    chunkMesh.count = nChunk
    chunkMesh.instanceMatrix.needsUpdate = true
    shardMesh.count = nShard
    shardMesh.instanceMatrix.needsUpdate = true
    bandMesh.count = nBand
    bandMesh.instanceMatrix.needsUpdate = true
    cometMesh.count = nComet
    cometMesh.instanceMatrix.needsUpdate = true
    tagMesh.count = nTag
    tagMesh.instanceMatrix.needsUpdate = true
    barMesh.count = nBar
    barMesh.instanceMatrix.needsUpdate = true
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true
    ringMesh.instanceMatrix.needsUpdate = true
    refusedMesh.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <instancedMesh ref={main} args={[capsuleGeometry, material, capacity]} frustumCulled={false} />
      <instancedMesh ref={rings} args={[ringGeometry, ringMaterial, capacity]} frustumCulled={false} />
      <instancedMesh ref={refused} args={[capsuleGeometry, refusedMaterial, capacity]} frustumCulled={false} />
      <instancedMesh ref={tips} args={[capsuleGeometry, tipMaterial, capacity]} frustumCulled={false} />
      <instancedMesh ref={chunks} args={[chunkGeometry, chunkMaterial, capacity * MAX_CHUNKS]} frustumCulled={false} />
      <instancedMesh ref={shards} args={[shardGeometry, shardMaterial, capacity]} frustumCulled={false} />
      <instancedMesh ref={bands} args={[capsuleGeometry, cachedMaterial, capacity]} frustumCulled={false} />
      <instancedMesh ref={comets} args={[cometGeometry, cometMaterial, capacity]} frustumCulled={false} />
      <instancedMesh ref={tags} args={[chunkGeometry, piiMaterial, capacity]} frustumCulled={false} />
      <instancedMesh ref={bars} args={[capsuleGeometry, barMaterial, capacity]} frustumCulled={false} />
      <CacheArcs topology={topology} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Cache-hit arcs: a dotted arc from each cache straight to its exit (D15),
// shown while hits are in flight and fading out after.
// ---------------------------------------------------------------------------

const ARC_POINTS = 32
const ARC_OPACITY = 0.55
/** Opacity change per second as hits start and stop. */
const ARC_FADE = 3

function CacheArc({ cacheId, usersOutId }: { cacheId: number; usersOutId: number }) {
  const engine = useEngine()
  const line = useRef<Line>(null)
  const material = useRef<LineDashedMaterial>(null)
  const geometry = useMemo(() => {
    const w = engine.world
    const from = w.nodeById[cacheId]
    const to = w.nodeById[usersOutId]
    const values: number[] = []
    if (from !== undefined && to !== undefined) {
      hopAnchor(from, anchorA)
      hopAnchor(to, anchorB)
      const lift = hopLift(routeLength(from.x, from.y, to.x, to.y))
      for (let i = 0; i < ARC_POINTS; i++) {
        arcPoint(anchorA.x, anchorA.y, anchorA.z, anchorB.x, anchorB.y, anchorB.z, lift, i / (ARC_POINTS - 1), onArc)
        values.push(onArc.x, onArc.y, onArc.z)
      }
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(values, 3))
    return g
  }, [engine, cacheId, usersOutId])

  // Dashes need per-vertex distances along the line.
  useLayoutEffect(() => {
    line.current?.computeLineDistances()
  }, [geometry])
  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame((_, delta) => {
    const l = line.current
    const mat = material.current
    if (l === null || mat === null) return
    const w = engine.world
    let live = false
    for (let i = 0; i < w.virtualLength && !live; i++) {
      const p = w.pool.packets[w.virtual[i]]
      live = p.cacheHit && p.fromNodeId === cacheId
    }
    const target = live ? ARC_OPACITY : 0
    const step = Math.min(delta, 0.25) * ARC_FADE
    mat.opacity = mat.opacity < target ? Math.min(target, mat.opacity + step) : Math.max(target, mat.opacity - step)
    l.visible = mat.opacity > 0.001
  })

  return (
    <threeLine ref={line} geometry={geometry} visible={false}>
      <lineDashedMaterial
        ref={material}
        color={HEX.pktChat}
        transparent
        opacity={0}
        dashSize={1 * PX_ALONG}
        gapSize={4 * PX_ALONG}
        depthWrite={false}
      />
    </threeLine>
  )
}

function CacheArcs({ topology }: { topology: Topology }) {
  return (
    <>
      {topology.arcs.map((arc) => (
        <CacheArc key={`${arc.cacheId}-${arc.usersOutId}`} cacheId={arc.cacheId} usersOutId={arc.usersOutId} />
      ))}
    </>
  )
}
