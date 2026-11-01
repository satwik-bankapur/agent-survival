/* MCP web search (iso D.web): a chipboard plinth with a mast and a dish tilted toward the sky, its feed arm reaching out of the bowl. */

import { useMemo } from 'react'

import { PX_Z } from '../iso'
import { HEX } from '../palette'
import { CHIP, NodeShell, chipboardMaterial, glyphMaterial } from './common'
import { GlyphBuilder, cylinder, merge, prism, square, type Faces } from './geometry'
import type { NodeMeshProps } from './types'

const PLINTH_PX = 16
const MAST_TOP_PX = 25
/** iso: the dish's rim in the plinth's right-face tone, its bowl in the top tone. */
const DISH: Faces = { top: HEX.chipTop, left: HEX.chipRight, right: HEX.chipRight }
/** The dish leans back 28° (iso rotate(−28)). */
const TILT = (28 * Math.PI) / 180

export function McpWebSearch({ node }: NodeMeshProps) {
  const body = useMemo(
    () => merge([prism(square(0, 0, 0.34), 0, PLINTH_PX), cylinder(0.025, PLINTH_PX, MAST_TOP_PX - PLINTH_PX, undefined, { segments: 8 })]),
    [],
  )
  const dish = useMemo(
    () => merge([cylinder(0.11, 0, 1.2, DISH, { topRadius: 0.25, segments: 32 }), cylinder(0.012, 1.2, 6, undefined, { segments: 6 })]),
    [],
  )
  const ring = useMemo(() => new GlyphBuilder(1.25).circle(0, 0, 0.16, 24).build(), [])
  return (
    <NodeShell id={node.id} type={node.type} x={node.x} y={node.y} light={[0.34, 12, 0.15]}>
      <mesh geometry={body} material={chipboardMaterial} userData={CHIP} castShadow />
      <group position={[0, MAST_TOP_PX * PX_Z, 0]} rotation={[TILT, 0, -TILT]}>
        <mesh geometry={dish} material={chipboardMaterial} userData={CHIP} castShadow />
        <lineSegments geometry={ring} material={glyphMaterial} />
      </group>
    </NodeShell>
  )
}
