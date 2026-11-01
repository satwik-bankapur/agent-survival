/*
 * Tracer (iso D.tracer): a slim post on a small base with a camera head and a
 * dark lens looking out over the board, with a glint. It needs no links: it
 * watches everything (J-3).
 */

import { useMemo } from 'react'
import { MeshBasicMaterial, SphereGeometry } from 'three'

import { PX_XY, PX_Z } from '../iso'
import { HEX } from '../palette'
import { CHIP, NodeShell, chipboardMaterial } from './common'
import { cylinder, merge, prism, rect, square } from './geometry'
import type { NodeMeshProps } from './types'

export const TRACER_TOP_PX = 58
const lensGeometry = new SphereGeometry(2.6 * PX_XY, 12, 8)
const lensMaterial = new MeshBasicMaterial({ color: '#0c1622' })
const glintGeometry = new SphereGeometry(0.7 * PX_XY, 8, 6)
const glintMaterial = new MeshBasicMaterial({ color: '#cfe3f2' })
const rimMaterial = new MeshBasicMaterial({ color: HEX.glyph })
const rimGeometry = new SphereGeometry(2.9 * PX_XY, 12, 8)

export function Tracer({ node }: NodeMeshProps) {
  const body = useMemo(
    () => merge([prism(square(0, 0, 0.2), 0, 4), cylinder(0.045, 4, 46, undefined, { segments: 10 }), prism(rect(-0.11, -0.07, 0.22, 0.14), 50, 8)]),
    [],
  )
  return (
    <NodeShell id={node.id} type={node.type} x={node.x} y={node.y} light={[0.11, 55, 0]}>
      <mesh geometry={body} material={chipboardMaterial} userData={CHIP} castShadow />
      <mesh geometry={rimGeometry} material={rimMaterial} position={[0, 54 * PX_Z, 0.07]} />
      <mesh geometry={lensGeometry} material={lensMaterial} position={[0, 54 * PX_Z, 0.075]} />
      <mesh geometry={glintGeometry} material={glintMaterial} position={[-0.012, 54.8 * PX_Z, 0.1]} />
    </NodeShell>
  )
}
