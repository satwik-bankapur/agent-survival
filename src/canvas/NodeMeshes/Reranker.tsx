/* Cross-encoder reranker: a funnel on a short stem, wide at the top where context pours in (iso D.rerank). */

import { useMemo } from 'react'

import { CHIP, NodeShell, chipboardMaterial } from './common'
import { cylinder, flat, merge } from './geometry'
import type { NodeMeshProps } from './types'

const TOP_PX = 24

export function Reranker({ node }: NodeMeshProps) {
  const body = useMemo(
    () =>
      merge([
        cylinder(0.12, 0, 7),
        cylinder(0.13, 7, TOP_PX - 7, undefined, { topRadius: 0.44 }),
        cylinder(0.32, TOP_PX, 0.2, flat('#6a604e')),
      ]),
    [],
  )
  return (
    <NodeShell id={node.id} type={node.type} x={node.x} y={node.y} light={[0.09, 3.5, 0.09]}>
      <mesh geometry={body} material={chipboardMaterial} userData={CHIP} castShadow />
    </NodeShell>
  )
}
