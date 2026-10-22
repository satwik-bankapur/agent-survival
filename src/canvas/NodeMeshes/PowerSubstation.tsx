/*
 * Power substation (iso D.sub): a low chipboard block with cooling fins down
 * its right face and three stacked insulators on top, with a lightning bolt
 * engraved beside them. Its cables to the vLLM nodes it powers are drawn by
 * ../PowerCables.tsx (J-1).
 */

import { useMemo } from 'react'

import { CHIP, NodeShell, chipboardMaterial, glyphMaterial } from './common'
import { CHIPBOARD, GlyphBuilder, cylinder, merge, prism, sidePanel, square, type Faces } from './geometry'
import type { NodeMeshProps } from './types'

export const SUBSTATION_TOP_PX = 28
const BLOCK_PX = 14
const FIN: Faces = { top: '#756b58', left: '#756b58', right: '#756b58' }
const ROD: Faces = { top: '#6b6b6b', left: '#4a4a4a', right: '#333333' }

export function PowerSubstation({ node }: NodeMeshProps) {
  const body = useMemo(() => {
    const parts = [prism(square(0, 0, 0.42, 0.36), 0, BLOCK_PX)]
    for (let i = 0; i < 5; i++) {
      const z = -0.28 + i * 0.14
      parts.push(sidePanel(z - 0.025, z + 0.025, 0.42, 2, 12, FIN))
    }
    for (const x of [-0.24, 0, 0.24]) {
      for (let j = 0; j < 3; j++) parts.push(cylinder(0.075 - j * 0.008, BLOCK_PX + j * 3.4, 2.6, CHIPBOARD, { x, z: -0.08, segments: 12 }))
      parts.push(cylinder(0.03, 24.2, 3, ROD, { x, z: -0.08, segments: 8 }))
    }
    return merge(parts)
  }, [])
  const glyph = useMemo(
    () =>
      new GlyphBuilder(BLOCK_PX)
        .polyline([
          [0.14, 0.1],
          [0.06, 0.2],
          [0.13, 0.2],
          [0.07, 0.3],
        ])
        .build(),
    [],
  )
  return (
    <NodeShell id={node.id} type={node.type} x={node.x} y={node.y} light={[-0.2, 10, 0.36]}>
      <mesh geometry={body} material={chipboardMaterial} userData={CHIP} castShadow />
      <lineSegments geometry={glyph} material={glyphMaterial} />
    </NodeShell>
  )
}
