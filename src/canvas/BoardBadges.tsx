/*
 * Node-state badges and the moments behind them (design: "Node states",
 * "Timed out", "Semantic cache hit", "Wrong answer reported"):
 *
 *   No route               a node with nowhere to send, for as long as that lasts
 *   Timed out              2 s after a queued prompt expires, while it fizzles out of the rack
 *   Queue full             2 s after a full queue drops an arrival
 *   Wrong answer reported  4 s at Users out when users complain, with a red flag in the crowd
 *   cache hit              a brief white flash at the cache as the hit leaves on its arc
 *   attack blocked         magenta shards burst off the firewall
 *
 * The three moments rise into place as they appear; "Wrong answer reported"
 * rises furthest, up out of the exit crowd. "No route" is a lasting state
 * and stays still.
 *
 * A badge hangs over its node wherever the node is, so it is clamped into the
 * board area the HUD leaves (the insets the camera frames to): the rails and
 * the toolbar paint over the canvas, and a badge under one is a badge lost.
 *
 * Everything here is something the player saw happen: the engine's board
 * effects ring holds timeouts, drops, cache hits (right and wrong alike) and
 * complaints, never a wrong answer users haven't reported (D10, D11).
 * Badges are DOM, written in place; sparks and flashes are one instanced mesh.
 */

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { Color, Group, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, SphereGeometry, Vector3 } from 'three'

import { BOARD_EFFECTS_SIZE, BoardEffect, type GameNode } from '../engine'
import { BoardBadgeElement, showBadge, type BadgeBounds, type BadgeKind } from './BoardBadge'
import { NODE_TOP_PX, type Topology } from './board'
import { useEngine } from './engineContext'
import { PX_XY, PX_Z } from './iso'
import type { BoardInsets } from './IsometricScene'
import { nodeStateIn } from './NodeMeshes/common'
import { GLOW, HEX, linear } from './palette'
import { RACK_RADIUS, rackSlotAngle, type Rect } from './paths'

/** How long each badge stays up after its moment, seconds of game time. */
const TIMED_OUT_SEC = 2
const COMPLAINT_SEC = 4
const QUEUE_FULL_SEC = 2
/** How far a moment's badge rises into place, px. A complaint climbs out of the crowd. */
const RISE_PX = 8
const COMPLAINT_RISE_PX = 16
/** The cache flash: a bright halo and a held core, real seconds. */
const FLASH_SEC = 0.32
/** Figures stand this tall, iso px: a plaza's badge hangs above them. */
const CROWD_TOP_PX = 10

export type BadgeRegistry = Map<number, HTMLDivElement>

export function BadgeLayer({ topology, registry }: { topology: Topology; registry: RefObject<BadgeRegistry> }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {topology.nodes.map((n) => (
        <BoardBadgeElement
          key={n.id}
          elRef={(el) => {
            if (el === null) registry.current.delete(n.id)
            else registry.current.set(n.id, el)
          }}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sparks and flashes
// ---------------------------------------------------------------------------

const PARTICLES = 96
const SPARKS_PER_FIZZLE = 7
const sphere = new SphereGeometry(1, 10, 8)
const WHITE_CORE = new Color(1, 1, 1).multiplyScalar(GLOW.capsule * 1.6)
const WHITE_HALO = new Color(1, 1, 1).multiplyScalar(1.15)
const SPARK = linear(HEX.warn).multiplyScalar(GLOW.light)
const SHARDS_PER_BLOCK = 8
const SHARD = linear(HEX.pktAdv).multiplyScalar(GLOW.capsule)

interface Particle {
  alive: boolean
  born: number
  life: number
  x: number
  y: number
  z: number
  /** Rise over its life, world units. */
  rise: number
  /** Radius at birth and at death, world units. */
  r0: number
  r1: number
  color: Color
}

function makeParticles(): Particle[] {
  return Array.from({ length: PARTICLES }, () => ({ alive: false, born: 0, life: 1, x: 0, y: 0, z: 0, rise: 0, r0: 0, r1: 0, color: SPARK }))
}

function spawn(particles: Particle[], now: number, init: Omit<Particle, 'alive' | 'born'>): void {
  // Reuse a dead slot, or the oldest one if every slot is busy.
  let slot = 0
  for (let i = 0; i < particles.length; i++) {
    if (!particles[i].alive) {
      slot = i
      break
    }
    if (particles[i].born < particles[slot].born) slot = i
  }
  Object.assign(particles[slot], init, { alive: true, born: now })
}

const m = new Matrix4()
const pos = new Vector3()
const scl = new Vector3()
const NO_ROTATION = new Quaternion()
const scratch = new Vector3()

/** Where a node's badge hangs from: above its top, or above the crowd for a plaza. */
function anchorOf(node: GameNode, plaza: Rect | undefined): [number, number, number] {
  if (plaza !== undefined) return [(plaza.x0 + plaza.x1) / 2, (CROWD_TOP_PX + 12) * PX_Z, (plaza.z0 + plaza.z1) / 2]
  return [node.x + 0.5, (NODE_TOP_PX[node.type] + 12) * PX_Z, node.y + 0.5]
}

export function BoardBadges({ topology, registry, insets }: { topology: Topology; registry: RefObject<BadgeRegistry>; insets: BoardInsets }) {
  const engine = useEngine()
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const mesh = useRef<InstancedMesh>(null)
  const material = useMemo(() => new MeshBasicMaterial({ toneMapped: false }), [])
  const particles = useRef<Particle[]>([])
  // Read the effects ring from where it is now: what happened before the board mounted is old news.
  const read = useRef(engine.world.effects.total)
  const timedOutUntil = useRef(new Map<number, number>())
  const complaintUntil = useRef(new Map<number, number>())
  const queueFullUntil = useRef(new Map<number, number>())

  useEffect(() => {
    const mesh_ = mesh.current
    if (mesh_ !== null) for (let i = 0; i < PARTICLES; i++) mesh_.setColorAt(i, SPARK)
    return () => material.dispose()
  }, [material])

  useFrame(({ clock }) => {
    if (particles.current.length === 0) particles.current = makeParticles()
    const w = engine.world
    const now = clock.elapsedTime
    const tps = 1000 / w.catalog.tickMs
    const fx = w.effects

    // New moments since the last frame.
    for (let i = Math.max(read.current, fx.total - BOARD_EFFECTS_SIZE); i < fx.total; i++) {
      const at = i % BOARD_EFFECTS_SIZE
      const node = w.nodeById[fx.nodeIds[at]]
      if (node === undefined) continue
      const kind = fx.kinds[at]
      if (kind === BoardEffect.QUEUE_TIMEOUT) {
        timedOutUntil.current.set(node.id, fx.ticks[at] + TIMED_OUT_SEC * tps)
        // The prompt that expired was the rack's oldest, in slot 0.
        const a = rackSlotAngle(0)
        const x = node.x + 0.5 + RACK_RADIUS * Math.cos(a)
        const z = node.y + 0.5 + RACK_RADIUS * Math.sin(a)
        for (let k = 0; k < SPARKS_PER_FIZZLE; k++) {
          spawn(particles.current, now, {
            life: 0.45 + Math.random() * 0.3,
            x: x + (Math.random() - 0.5) * 9 * PX_XY,
            y: (4 + Math.random() * 4) * PX_Z,
            z: z + (Math.random() - 0.5) * 9 * PX_XY,
            rise: (6 + Math.random() * 6) * PX_Z,
            r0: (0.6 + Math.random() * 0.8) * PX_XY,
            r1: 0,
            color: SPARK,
          })
        }
      } else if (kind === BoardEffect.CACHE_HIT) {
        const y = NODE_TOP_PX[node.type] * PX_Z
        spawn(particles.current, now, { life: FLASH_SEC, x: node.x + 0.5, y, z: node.y + 0.5, rise: 0, r0: 11 * PX_XY, r1: 4 * PX_XY, color: WHITE_HALO })
        spawn(particles.current, now, { life: FLASH_SEC, x: node.x + 0.5, y, z: node.y + 0.5, rise: 0, r0: 3.5 * PX_XY, r1: 2.5 * PX_XY, color: WHITE_CORE })
      } else if (kind === BoardEffect.ATTACK_BLOCKED) {
        // iso shatter: a faint burst and a scatter of shards at tube height.
        for (let k = 0; k < SHARDS_PER_BLOCK; k++) {
          spawn(particles.current, now, {
            life: 0.35 + Math.random() * 0.25,
            x: node.x + 0.5 + (Math.random() - 0.5) * 0.7,
            y: (6 + Math.random() * 8) * PX_Z,
            z: node.y + 0.5 + (Math.random() - 0.5) * 0.7,
            rise: (Math.random() - 0.3) * 6 * PX_Z,
            r0: (0.8 + Math.random() * 0.9) * PX_XY,
            r1: 0,
            color: SHARD,
          })
        }
      } else if (kind === BoardEffect.COMPLAINT) {
        complaintUntil.current.set(node.id, fx.ticks[at] + COMPLAINT_SEC * tps)
      } else if (kind === BoardEffect.QUEUE_FULL) {
        queueFullUntil.current.set(node.id, fx.ticks[at] + QUEUE_FULL_SEC * tps)
      }
    }
    read.current = fx.total

    // Particles: rise and shrink over their life.
    const inst = mesh.current
    if (inst !== null) {
      let n = 0
      for (const p of particles.current) {
        if (!p.alive) continue
        const t = (now - p.born) / p.life
        if (t >= 1 || t < 0) {
          p.alive = false
          continue
        }
        // Ease in: a flash holds its size before it shrinks, and sparks linger before they die.
        const r = p.r0 + (p.r1 - p.r0) * t * t
        pos.set(p.x, p.y + p.rise * t, p.z)
        scl.set(r, r, r)
        m.compose(pos, NO_ROTATION, scl)
        inst.setMatrixAt(n, m)
        inst.setColorAt(n, p.color)
        n++
      }
      inst.count = n
      inst.instanceMatrix.needsUpdate = true
      if (inst.instanceColor !== null) inst.instanceColor.needsUpdate = true
    }

    // Badges, one per node: the loudest thing that applies, kept inside the board area the HUD leaves.
    const map = registry.current
    const bounds: BadgeBounds = { left: insets.left, right: size.width - insets.right, top: insets.top, bottom: size.height - insets.bottom }
    for (const view of topology.nodes) {
      const el = map.get(view.id)
      const node = w.nodeById[view.id]
      if (el === undefined || node === undefined) continue
      let text: string | null = null
      let kind: BadgeKind = 'info'
      let rise = 0
      if ((complaintUntil.current.get(node.id) ?? -1) > w.tick) {
        text = 'Wrong answer reported'
        kind = 'alarm'
        rise = COMPLAINT_RISE_PX
      } else if ((timedOutUntil.current.get(node.id) ?? -1) > w.tick) {
        text = 'Timed out'
        kind = 'alarm'
        rise = RISE_PX
      } else if ((queueFullUntil.current.get(node.id) ?? -1) > w.tick) {
        text = 'Queue full'
        kind = 'alarm'
        rise = RISE_PX
      } else if (nodeStateIn(engine.snapshot, node.id) === 'no-route') {
        text = 'No route'
      }
      if (text === null) {
        showBadge(el, null, kind, 0, 0)
        continue
      }
      const [ax, ay, az] = anchorOf(node, topology.plazas.get(node.id))
      scratch.set(ax, ay, az).project(camera)
      showBadge(el, text, kind, (scratch.x * 0.5 + 0.5) * size.width, (-scratch.y * 0.5 + 0.5) * size.height, rise, bounds)
    }
  })

  return (
    <>
      <instancedMesh ref={mesh} args={[sphere, material, PARTICLES]} frustumCulled={false} />
      {topology.nodes
        .filter((n) => n.type === 'USERS_OUT')
        .map((n) => {
          const plaza = topology.plazas.get(n.id)
          return plaza === undefined ? null : <ComplaintFlag key={n.id} nodeId={n.id} plaza={plaza} until={complaintUntil} />
        })}
    </>
  )
}

// ---------------------------------------------------------------------------
// The red flag a complaining figure holds up (iso fig() with flag)
// ---------------------------------------------------------------------------

const poleMaterial = new MeshBasicMaterial({ color: HEX.figure })
const flagMaterial = new MeshBasicMaterial({ color: linear(HEX.alarm).multiplyScalar(GLOW.light), toneMapped: false })

function ComplaintFlag({ nodeId, plaza, until }: { nodeId: number; plaza: Rect; until: RefObject<Map<number, number>> }) {
  const engine = useEngine()
  const group = useRef<Group>(null)
  useFrame(() => {
    if (group.current === null) return
    group.current.visible = (until.current.get(nodeId) ?? -1) > engine.world.tick
  })
  // Near the crowd's front edge, where it reads in front of the other figures.
  const x = plaza.x0 + 0.55
  const z = plaza.z1 - 0.45
  const pole = 7.5 * PX_Z
  return (
    <group ref={group} position={[x, 2 * PX_Z, z]} visible={false}>
      <mesh position={[0, pole / 2 + 4 * PX_Z, 0]} material={poleMaterial}>
        <cylinderGeometry args={[0.3 * PX_XY, 0.3 * PX_XY, pole, 5]} />
      </mesh>
      <mesh position={[1.9 * PX_XY, pole + 2.6 * PX_Z, 0]} rotation={[0, Math.PI / 4, 0]} material={flagMaterial}>
        <boxGeometry args={[3.8 * PX_XY, 2.6 * PX_Z, 0.2 * PX_XY]} />
      </mesh>
    </group>
  )
}
