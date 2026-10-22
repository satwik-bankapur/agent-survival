/*
 * MCP code sandbox (iso D.sandbox): a small chipboard cube engraved with
 * code brackets, inside a box of clear acrylic with white edges. When it
 * contains a tainted run (D20) its inner cube glows magenta for a moment,
 * driven by the engine's TAINT_CONTAINED board effect, the one moment the
 * player is shown a tool-borne injection.
 */

import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { BoxGeometry, EdgesGeometry, LineBasicMaterial, Mesh, MeshBasicMaterial } from 'three'

import { BOARD_EFFECTS_SIZE, BoardEffect } from '../../engine'
import { useEngine } from '../engineContext'
import { PX_Z } from '../iso'
import { GLOW, HEX, OPACITY, linear } from '../palette'
import { CHIP, NodeShell, chipboardMaterial, glyphMaterial } from './common'
import { GlyphBuilder, prism, square } from './geometry'
import type { NodeMeshProps } from './types'

const CUBE_PX = 14
const CUBE_Z0_PX = 2
const BOX_PX = 28
const BOX_HALF = 0.4
/** How long the inner cube glows after containing a tainted run, seconds of game time. */
const GLOW_SEC = 2

const acrylicMaterial = new MeshBasicMaterial({ color: HEX.glass, transparent: true, opacity: OPACITY.acrylic * 0.3, depthWrite: false })
const edgeMaterial = new LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.65 })
const glowMaterial = new MeshBasicMaterial({ color: linear(HEX.pktAdv).multiplyScalar(GLOW.capsule), transparent: true, opacity: 0.85, toneMapped: false })

const boxGeometry = (() => {
  const g = new BoxGeometry(BOX_HALF * 2, BOX_PX * PX_Z, BOX_HALF * 2)
  g.translate(0, (BOX_PX * PX_Z) / 2, 0)
  return g
})()
const edgesGeometry = new EdgesGeometry(boxGeometry)
const glowGeometry = (() => {
  const g = new BoxGeometry(0.44, CUBE_PX * PX_Z * 1.04, 0.44)
  g.translate(0, (CUBE_Z0_PX + CUBE_PX / 2) * PX_Z, 0)
  return g
})()

export function McpCodeSandbox({ node }: NodeMeshProps) {
  const engine = useEngine()
  const cube = useMemo(() => prism(square(0, 0, 0.2), CUBE_Z0_PX, CUBE_PX), [])
  const glyph = useMemo(
    () =>
      new GlyphBuilder(CUBE_Z0_PX + CUBE_PX)
        .polyline([
          [-0.06, -0.12],
          [-0.12, 0],
          [-0.06, 0.12],
        ])
        .polyline([
          [0.06, -0.12],
          [0.12, 0],
          [0.06, 0.12],
        ])
        .build(),
    [],
  )
  const glow = useRef<Mesh>(null)
  const until = useRef(-1)
  const read = useRef(engine.world.effects.total)

  useFrame(() => {
    const w = engine.world
    const fx = w.effects
    for (let i = Math.max(read.current, fx.total - BOARD_EFFECTS_SIZE); i < fx.total; i++) {
      const at = i % BOARD_EFFECTS_SIZE
      if (fx.kinds[at] === BoardEffect.TAINT_CONTAINED && fx.nodeIds[at] === node.id) until.current = fx.ticks[at] + GLOW_SEC * (1000 / w.catalog.tickMs)
    }
    read.current = fx.total
    if (glow.current !== null) glow.current.visible = w.tick < until.current
  })

  return (
    <NodeShell id={node.id} type={node.type} x={node.x} y={node.y} light={[0.4, 2, 0.25]}>
      <mesh geometry={cube} material={chipboardMaterial} userData={CHIP} castShadow />
      <lineSegments geometry={glyph} material={glyphMaterial} />
      <mesh ref={glow} geometry={glowGeometry} material={glowMaterial} visible={false} />
      <mesh geometry={boxGeometry} material={acrylicMaterial} />
      <lineSegments geometry={edgesGeometry} material={edgeMaterial} />
    </NodeShell>
  )
}
