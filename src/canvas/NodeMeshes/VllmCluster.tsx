/*
 * vLLM cluster (iso D.vllm): a tall obsidian GPU rack with copper cooling
 * fins down its right face, a GPU-memory gauge in a slot on its front, and a
 * row of LEDs, one lit per slice of the batch. While it loads its weights a
 * warm band climbs the rack (design: "Loading weights"). All of it is the
 * player's own hardware, read from the node every frame (D11, D22).
 */

import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { BoxGeometry, LineBasicMaterial, Mesh, MeshBasicMaterial, SphereGeometry } from 'three'

import { useEngine } from '../engineContext'
import { PX_XY, PX_Z } from '../iso'
import { GLOW, HEX, linear } from '../palette'
import { NodeShell } from './common'
import { GlyphBuilder, flat, frontPanel, merge, prism, sidePanel, square, type Faces } from './geometry'
import type { NodeMeshProps } from './types'

export const VLLM_TOP_PX = 50
const HALF = 0.44
/** iso OB: the rack's obsidian. */
const OBSIDIAN: Faces = { top: '#2a2b31', left: '#1c1d21', right: '#131417' }
const COPPER: Faces = { top: '#c27a45', left: '#a5683b', right: '#8c5832' }
const FINS = 7
const GAUGE = { x0: -0.36, x1: -0.26, z0Px: 6, z1Px: 44 } as const
const LEDS = 7
/** The memory gauge turns amber past this share of KV memory (iso: mem > .85). */
const GAUGE_WARN = 0.85
/** Sequences each LED stands for. */
const SEQS_PER_LED = 24

const darkMaterial = new MeshBasicMaterial({ vertexColors: true })
const rackGlyphMaterial = new LineBasicMaterial({ color: '#3e4049' })
const gaugeOk = linear(HEX.glassGlow).multiplyScalar(GLOW.capsule)
const gaugeWarn = linear(HEX.warn).multiplyScalar(GLOW.capsule)
const gaugeMaterial = new MeshBasicMaterial({ color: gaugeOk.clone(), toneMapped: false })
const gaugeGeometry = (() => {
  const g = new BoxGeometry(GAUGE.x1 - GAUGE.x0 - 0.02, 1, 0.01)
  g.translate(0, 0.5, 0)
  return g
})()
const ledGeometry = new SphereGeometry(0.9 * PX_XY * 1.6, 8, 6)
const ledOn = new MeshBasicMaterial({ color: linear(HEX.glassGlow).multiplyScalar(GLOW.capsule), toneMapped: false })
const ledOff = new MeshBasicMaterial({ color: '#2b3138' })
const bandMaterial = new MeshBasicMaterial({ color: linear(HEX.pktChat).multiplyScalar(GLOW.capsule), transparent: true, opacity: 0.85, toneMapped: false })
const bandGeometry = new BoxGeometry(HALF * 2 + 0.03, 1.6 * PX_Z * 2, HALF * 2 + 0.03)

export function VllmCluster({ node }: NodeMeshProps) {
  const engine = useEngine()
  const body = useMemo(() => {
    const parts = [prism(square(0, 0, HALF), 0, VLLM_TOP_PX, OBSIDIAN)]
    for (let i = 0; i < FINS; i++) {
      const z = -HALF + 0.08 + i * ((2 * HALF - 0.16) / (FINS - 1))
      parts.push(sidePanel(z - 0.018, z + 0.018, HALF, 6, VLLM_TOP_PX - 6, COPPER))
    }
    parts.push(frontPanel(GAUGE.x0, GAUGE.x1, HALF, GAUGE.z0Px, GAUGE.z1Px, flat('#0a0b0d')))
    return merge(parts)
  }, [])
  const glyph = useMemo(
    () =>
      new GlyphBuilder(VLLM_TOP_PX)
        .rect(-0.25, -0.25, 0.2, 0.2)
        .rect(0.05, -0.25, 0.2, 0.2)
        .rect(-0.25, 0.05, 0.2, 0.2)
        .rect(0.05, 0.05, 0.2, 0.2)
        .build(),
    [],
  )
  const gauge = useRef<Mesh>(null)
  const band = useRef<Mesh>(null)
  const leds = useRef<(Mesh | null)[]>([])
  const lit = useRef(-1)

  useFrame(() => {
    const w = engine.world
    const n = w.nodeById[node.id]
    const memory = n === undefined || n.kvBudget === 0 ? 0 : n.kvInUse / n.kvBudget
    if (gauge.current !== null) {
      gauge.current.scale.y = Math.max(0.0001, memory * (GAUGE.z1Px - GAUGE.z0Px - 1) * PX_Z)
      gaugeMaterial.color.copy(memory > GAUGE_WARN ? gaugeWarn : gaugeOk)
    }
    const on = n === undefined ? 0 : Math.min(LEDS, Math.ceil(n.busy / SEQS_PER_LED))
    if (on !== lit.current) {
      lit.current = on
      leds.current.forEach((led, i) => {
        if (led !== null) led.material = i < on ? ledOn : ledOff
      })
    }
    if (band.current !== null) {
      const cold = n !== undefined && n.coldUntilTick > w.tick
      band.current.visible = cold
      if (cold && n !== undefined) {
        const total = w.catalog.nodes.VLLM_CLUSTER.tiers[n.tier - 1].coldStartSec * (1000 / w.catalog.tickMs)
        const progress = 1 - (n.coldUntilTick - w.tick) / total
        band.current.position.y = Math.min(1, Math.max(0, progress)) * VLLM_TOP_PX * PX_Z
      }
    }
  })

  return (
    <NodeShell id={node.id} type={node.type} x={node.x} y={node.y} light={[0.3, 54, HALF]}>
      <mesh geometry={body} material={darkMaterial} castShadow />
      <lineSegments geometry={glyph} material={rackGlyphMaterial} />
      <mesh ref={gauge} geometry={gaugeGeometry} material={gaugeMaterial} position={[(GAUGE.x0 + GAUGE.x1) / 2, (GAUGE.z0Px + 0.5) * PX_Z, HALF + 0.012]} />
      {Array.from({ length: LEDS }, (_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            leds.current[i] = m
          }}
          geometry={ledGeometry}
          material={ledOff}
          position={[-0.2 + i * 0.085, 46 * PX_Z, HALF + 0.01]}
        />
      ))}
      <mesh ref={band} geometry={bandGeometry} material={bandMaterial} visible={false} />
    </NodeShell>
  )
}
