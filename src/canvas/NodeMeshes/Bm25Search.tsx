/* BM25 hybrid search: a card cabinet, drawers on both faces and lines of text on top (iso D.bm25). */

import { useMemo } from 'react'

import { CHIP, NodeShell, chipboardMaterial, glyphMaterial } from './common'
import { GlyphBuilder, flat, frontPanel, merge, prism, sidePanel, square } from './geometry'
import type { NodeMeshProps } from './types'

const HEIGHT_PX = 22
// iso: mix(C.left, C.glyph, .35) and mix(C.right, C.glyph, .35), the drawer fronts a shade darker than their face.
const DRAWER_LEFT = flat('#8f8470')
const DRAWER_RIGHT = flat('#786d5a')
const KNOB = flat('#3b352b')

export function Bm25Search({ node }: NodeMeshProps) {
  const body = useMemo(() => {
    const parts = [prism(square(0, 0, 0.4, 0.36), 0, HEIGHT_PX)]
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 2; j++) {
        const x0 = -0.34 + i * 0.235
        const z0 = 3 + j * 9
        parts.push(frontPanel(x0, x0 + 0.2, 0.36, z0, z0 + 7, DRAWER_LEFT))
        parts.push(frontPanel(x0 + 0.08, x0 + 0.12, 0.36 + 0.008, z0 + 2.8, z0 + 4.2, KNOB))
      }
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++) {
        const r0 = -0.3 + i * 0.32
        const z0 = 3 + j * 9
        parts.push(sidePanel(r0, r0 + 0.26, 0.4, z0, z0 + 7, DRAWER_RIGHT))
      }
    return merge(parts)
  }, [])
  const glyph = useMemo(
    () => new GlyphBuilder(HEIGHT_PX).line(-0.25, -0.15, 0.2, -0.15).line(-0.25, 0, 0.25, 0).line(-0.25, 0.15, 0.1, 0.15).build(),
    [],
  )
  return (
    <NodeShell id={node.id} type={node.type} x={node.x} y={node.y} light={[0.4, 20, 0.25]}>
      <mesh geometry={body} material={chipboardMaterial} userData={CHIP} castShadow />
      <lineSegments geometry={glyph} material={glyphMaterial} />
    </NodeShell>
  )
}
