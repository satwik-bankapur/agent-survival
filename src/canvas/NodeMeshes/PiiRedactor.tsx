/* PII redactor: a block with an intake slot and a black redaction bar on its face (iso D.pii). */

import { useMemo } from 'react'

import { CHIP, NodeShell, chipboardMaterial, glyphMaterial } from './common'
import { GlyphBuilder, flat, frontPanel, merge, prism, square } from './geometry'
import type { NodeMeshProps } from './types'

const HEIGHT_PX = 22
const SLOT = flat('#2b261e')
const BAR = flat('#070708')

export function PiiRedactor({ node }: NodeMeshProps) {
  const body = useMemo(
    () =>
      merge([
        prism(square(0, 0, 0.38), 0, HEIGHT_PX),
        frontPanel(-0.28, 0.28, 0.38, 12.5, 14.5, SLOT),
        frontPanel(-0.24, 0.1, 0.38, 5, 8.5, BAR),
      ]),
    [],
  )
  const glyph = useMemo(() => new GlyphBuilder(HEIGHT_PX).rect(-0.2, -0.07, 0.4, 0.14).build(), [])
  return (
    <NodeShell id={node.id} type={node.type} x={node.x} y={node.y} light={[0.38, 18, 0.15]}>
      <mesh geometry={body} material={chipboardMaterial} userData={CHIP} castShadow />
      <lineSegments geometry={glyph} material={glyphMaterial} />
    </NodeShell>
  )
}
