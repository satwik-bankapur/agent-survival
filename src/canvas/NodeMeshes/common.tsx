/*
 * What every node shares: the chipboard material, the status light, the
 * queue rack's empty slots and the no-route outline
 * (design/02 Board Language, "Node states").
 *
 * State comes from the 4 Hz snapshot, which is what the player could know
 * (D11). Nothing here re-renders React per frame: lights and outlines are
 * updated in place from useFrame. Label plates live in ../LabelPlates.tsx.
 */

import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type ReactNode } from 'react'
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  LineDashedMaterial,
  LineLoop,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
  type Material,
} from 'three'

import type { NodeState, NodeType, TelemetrySnapshot } from '../../engine'
import { NODE_TOP_PX } from '../board'
import { useEngine } from '../engineContext'
import { PX_XY, PX_Z, cameraDirection } from '../iso'
import { GLOW, HEX, linear } from '../palette'
import { RACK_MAX, RACK_RADIUS, rackSlotAngle } from '../paths'
import { nodePickHandlers } from '../pointer'
import { BLINK_HZ, blinkOn, congested } from '../thresholds'
import { reducedMotion } from '../../store/uiStore'

// ---------------------------------------------------------------------------
// Shared materials
// ---------------------------------------------------------------------------

/** Unlit, painted by normal (geometry.ts). Shared by every chipboard part. */
export const chipboardMaterial = new MeshBasicMaterial({ vertexColors: true })
/** The same at 50%, for a node with no route out (iso noroute). */
export const chipboardDimMaterial = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5 })
export const glyphMaterial = new LineBasicMaterial({ color: HEX.glyph })

/** Marks a mesh as chipboard, so a no-route node can swap it to the dim material. */
export const CHIP = { chip: true } as const

// ---------------------------------------------------------------------------
// Node state lookup
// ---------------------------------------------------------------------------

export function nodeStateIn(snapshot: TelemetrySnapshot, id: number): NodeState {
  const nodes = snapshot.nodes
  for (let i = 0; i < nodes.length; i++) if (nodes[i].id === id) return nodes[i].state
  return 'idle'
}

/** Node types with an input queue, and so a rack. */
export const HAS_QUEUE: Readonly<Record<NodeType, boolean>> = {
  USERS_IN: false,
  USERS_OUT: false,
  FRONTIER_API: true,
  FAST_SLM: true,
  SEMANTIC_CACHE: true,
  PROMPT_ROUTER: true,
  OUTPUT_GUARDRAIL: true,
  PROMPT_FIREWALL: true,
  PII_REDACTOR: true,
  VECTOR_DB: true,
  BM25_SEARCH: true,
  RERANKER: true,
  INGESTION_CRON: false,
  LANGGRAPH_COORDINATOR: true,
  MCP_WEB_SEARCH: true,
  MCP_CODE_SANDBOX: true,
  HITL_GATE: true,
  VLLM_CLUSTER: true,
  POWER_SUBSTATION: false,
  TRACER: false,
  LLM_JUDGE: false,
}

// ---------------------------------------------------------------------------
// Status light (iso light()): a dark bezel and a dot. Healthy has no colour.
// ---------------------------------------------------------------------------

const bezelGeometry = new SphereGeometry(2.7 * PX_XY, 12, 8)
const dotGeometry = new SphereGeometry(1.8 * PX_XY, 12, 8)
const bezelMaterial = new MeshBasicMaterial({ color: HEX.bezel })
const toCamera = (() => {
  const d = cameraDirection()
  return new Vector3(d.x, d.y, d.z)
})()

const LIGHT_COLOR = {
  faint: linear(HEX.inkFaint),
  busy: linear(HEX.ink).multiplyScalar(GLOW.light),
  warn: linear(HEX.warn).multiplyScalar(GLOW.light),
  alarm: linear(HEX.alarm).multiplyScalar(GLOW.light),
} as const

type LightLook = 'faint' | 'busy' | 'warn' | 'alarm'

/**
 * Dropping arrivals is an alarm; a queue past 70% is a warning; busy is bright ink; anything else
 * is faint. Warnings and alarms blink (design: "Node states").
 */
export function lightLook(state: NodeState, queueLength: number, queueCapacity: number): LightLook {
  if (state === 'queue-full') return 'alarm'
  if (congested(queueLength, queueCapacity)) return 'warn'
  if (state === 'busy') return 'busy'
  return 'faint'
}

function StatusLight({ nodeId, at }: { nodeId: number; at: readonly [number, number, number] }) {
  const engine = useEngine()
  const material = useMemo(() => new MeshBasicMaterial({ color: LIGHT_COLOR.faint, toneMapped: false }), [])
  const last = useRef<Color | null>(null)
  useFrame(({ clock }) => {
    const node = engine.world.nodeById[nodeId]
    const look = lightLook(nodeStateIn(engine.snapshot, nodeId), node?.queueLength ?? 0, node?.queueCapacity ?? 0)
    const hz = look === 'alarm' ? BLINK_HZ.alarm : look === 'warn' ? BLINK_HZ.warn : 0
    // Blink on the real clock, so a light keeps its rhythm at any game speed and while paused.
    const lit = hz === 0 || blinkOn(clock.elapsedTime, hz, reducedMotion())
    const color = lit ? LIGHT_COLOR[look] : LIGHT_COLOR.faint
    if (color === last.current) return
    last.current = color
    material.color.copy(color)
  })
  const [x, yPx, z] = at
  const y = yPx * PX_Z
  // The dot sits a little toward the camera, inside its bezel.
  const lift = 1.2 * PX_XY
  return (
    <group position={[x, y, z]}>
      <mesh geometry={bezelGeometry} material={bezelMaterial} />
      <mesh geometry={dotGeometry} material={material} position={toCamera.clone().multiplyScalar(lift)} />
    </group>
  )
}

// ---------------------------------------------------------------------------
// Rack slots: faint rings on the mat where queued prompts stand (iso rackCap).
// ---------------------------------------------------------------------------

const slotGeometry = (() => {
  const values: number[] = []
  const rx = 1.4 * PX_XY
  const segments = 12
  for (let s = 0; s < RACK_MAX; s++) {
    const a = rackSlotAngle(s)
    const cx = RACK_RADIUS * Math.cos(a)
    const cz = RACK_RADIUS * Math.sin(a)
    for (let i = 0; i < segments; i++) {
      const t0 = (i / segments) * Math.PI * 2
      const t1 = ((i + 1) / segments) * Math.PI * 2
      values.push(cx + rx * Math.cos(t0), 0.003, cz + rx * Math.sin(t0), cx + rx * Math.cos(t1), 0.003, cz + rx * Math.sin(t1))
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(values, 3))
  return g
})()
const slotMaterial = new LineBasicMaterial({ color: HEX.inkFaint, transparent: true, opacity: 0.8 })

// ---------------------------------------------------------------------------
// The shell every node type renders inside.
// ---------------------------------------------------------------------------

const footprintMaterial = new LineDashedMaterial({
  color: HEX.inkDim,
  dashSize: 4 * PX_XY,
  gapSize: 3 * PX_XY,
})

/** The dashed square round a one-tile footprint (iso noroute). */
const footprintGeometry = (() => {
  const e = 0.5 + 0.06
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute([-e, 0.004, -e, e, 0.004, -e, e, 0.004, e, -e, 0.004, e], 3))
  // Dashes need per-vertex distances; a throwaway loop computes them onto the shared geometry.
  new LineLoop(g, footprintMaterial).computeLineDistances()
  return g
})()

export interface NodeShellProps {
  readonly id: number
  readonly type: NodeType
  readonly x: number
  readonly y: number
  /** Status light position: x, height (iso px), z, relative to the node's centre. */
  readonly light: readonly [number, number, number] | null
  readonly children: ReactNode
}

/** Raycast, never drawn: the tile-sized pick box. Its height comes from the node's top, set per mesh by scale. */
const pickMaterial = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false })
const pickGeometry = (() => {
  const g = new BoxGeometry(0.96, 1, 0.96)
  g.translate(0, 0.5, 0)
  return g
})()

/** A placement ghost renders a real node mesh with this id: no status, no picking. */
export const GHOST_ID = -1

export function NodeShell({ id, type, x, y, light, children }: NodeShellProps) {
  const engine = useEngine()
  const group = useRef<Group>(null)
  const outline = useRef<LineLoop>(null)
  const dimmed = useRef(false)
  const queue = HAS_QUEUE[type]

  useFrame(() => {
    const g = group.current
    if (g === null || outline.current === null) return
    const noRoute = nodeStateIn(engine.snapshot, id) === 'no-route'
    if (noRoute === dimmed.current) return
    dimmed.current = noRoute
    outline.current.visible = noRoute
    const material: Material = noRoute ? chipboardDimMaterial : chipboardMaterial
    g.traverse((o) => {
      if (o instanceof Mesh && o.userData.chip === true) o.material = material
    })
  })

  // Every mesh of the node points the pointer at it; a ghost takes no pointer events at all.
  const pick = id === GHOST_ID ? {} : nodePickHandlers(id, x, y)
  return (
    <group position={[x + 0.5, 0, y + 0.5]}>
      <group ref={group} {...pick}>
        {children}
        {/* The whole tile picks the node, so a slim mesh or a label plate over it never makes a click miss. */}
        {id !== GHOST_ID && <mesh geometry={pickGeometry} material={pickMaterial} scale={[1, NODE_TOP_PX[type] * PX_Z, 1]} />}
      </group>
      {light !== null && id !== GHOST_ID && <StatusLight nodeId={id} at={light} />}
      {queue && <lineSegments geometry={slotGeometry} material={slotMaterial} />}
      <lineLoop ref={outline} geometry={footprintGeometry} material={footprintMaterial} visible={false} />
    </group>
  )
}
