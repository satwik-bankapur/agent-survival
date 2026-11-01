/* Prompt router: a hexagonal prism with four port blocks and a fan-out glyph (iso D.router). */

import { useMemo } from 'react'

import { CHIP, NodeShell, chipboardMaterial, glyphMaterial } from './common'
import { GlyphBuilder, merge, ngon, prism, square } from './geometry'
import type { NodeMeshProps } from './types'

const HEIGHT_PX = 16
const PORT_ANGLES_DEG = [-55, -18, 18, 55]

export function PromptRouter({ node }: NodeMeshProps) {
  const body = useMemo(() => {
    const parts = [prism(ngon(0, 0, 0.44, 6, Math.PI / 6), 0, HEIGHT_PX)]
    for (const deg of PORT_ANGLES_DEG) {
      const a = (deg * Math.PI) / 180
      parts.push(prism(square(0.47 * Math.cos(a), 0.47 * Math.sin(a), 0.06), 5, 6))
    }
    return merge(parts)
  }, [])
  const glyph = useMemo(
    () =>
      new GlyphBuilder(HEIGHT_PX)
        .circle(0, 0, 0.05, 10)
        .line(0, 0, 0.22, -0.2)
        .line(0, 0, 0.26, -0.06)
        .line(0, 0, 0.26, 0.08)
        .line(0, 0, 0.2, 0.22)
        .circle(0.27, -0.25, 0.04, 10)
        .circle(0.32, -0.07, 0.05, 10)
        .rect(0.29, 0.06, 0.07, 0.07)
        .polyline([
          [0.22, 0.23],
          [0.28, 0.29],
          [0.22, 0.33],
        ])
        .build(),
    [],
  )
  return (
    <NodeShell id={node.id} type={node.type} x={node.x} y={node.y} light={[-0.22, 10, 0.38]}>
      <mesh geometry={body} material={chipboardMaterial} userData={CHIP} castShadow />
      <lineSegments geometry={glyph} material={glyphMaterial} />
    </NodeShell>
  )
}
