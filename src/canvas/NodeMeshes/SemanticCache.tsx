/* Semantic cache: a chipboard drum with a lightning glyph (iso D.cache). */

import { useMemo } from 'react'

import { CHIP, NodeShell, chipboardMaterial, glyphMaterial } from './common'
import { GlyphBuilder, cylinder } from './geometry'
import type { NodeMeshProps } from './types'

const HEIGHT_PX = 14

export function SemanticCache({ node }: NodeMeshProps) {
  const body = useMemo(() => cylinder(0.4, 0, HEIGHT_PX), [])
  const glyph = useMemo(
    () =>
      new GlyphBuilder(HEIGHT_PX)
        .polyline(
          [
            [0.07, -0.27],
            [-0.12, 0.03],
            [0.01, 0.03],
            [-0.06, 0.27],
            [0.14, -0.05],
            [0.01, -0.05],
          ],
          true,
        )
        .build(),
    [],
  )
  return (
    <NodeShell id={node.id} type={node.type} x={node.x} y={node.y} light={[0.28, 7, 0.28]}>
      <mesh geometry={body} material={chipboardMaterial} userData={CHIP} castShadow />
      <lineSegments geometry={glyph} material={glyphMaterial} />
    </NodeShell>
  )
}
