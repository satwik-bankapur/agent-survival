/* Prompt firewall: a low slab carrying six upright fins, a grille that attacks shatter against (iso D.firewall). */

import { useMemo } from 'react'

import { CHIP, NodeShell, chipboardMaterial } from './common'
import { merge, prism, rect, square } from './geometry'
import type { NodeMeshProps } from './types'

export function PromptFirewall({ node }: NodeMeshProps) {
  const body = useMemo(() => {
    const parts = [prism(square(0, 0, 0.42, 0.46), 0, 4)]
    for (let i = 0; i < 6; i++) parts.push(prism(rect(-0.15, -0.4 + i * 0.155, 0.3, 0.06), 4, 16))
    return merge(parts)
  }, [])
  return (
    <NodeShell id={node.id} type={node.type} x={node.x} y={node.y} light={[0.42, 2.5, 0.3]}>
      <mesh geometry={body} material={chipboardMaterial} userData={CHIP} castShadow />
    </NodeShell>
  )
}
