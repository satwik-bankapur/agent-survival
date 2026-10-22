/*
 * Human-in-the-loop gate (iso D.hitl): a low floor with two walls in an L,
 * a white scale figure at a desk, a desk lamp that glows, and an in-tray.
 * Runs waiting for review stand in the rack round it, like any queue (D38).
 */

import { useMemo } from 'react'
import { MeshBasicMaterial, SphereGeometry } from 'three'

import { PX_XY, PX_Z } from '../iso'
import { HEX } from '../palette'
import { CHIP, NodeShell, chipboardMaterial } from './common'
import { cylinder, merge, prism, rect, square, type Faces } from './geometry'
import type { NodeMeshProps } from './types'
import { figureGeometry, figureMaterial } from './UserPlaza'

const FLOOR_PX = 3
const WALL_PX = 22
/** iso: the in-tray's lighter top. */
const TRAY: Faces = { top: '#a69a83', left: HEX.chipLeft, right: HEX.chipRight }
const LAMP_PX = 15
const lampGeometry = new SphereGeometry(1.6 * PX_XY, 10, 8)
/** The lamp's warm light: the one lit thing on a calm node, kept below the bloom threshold. */
const lampMaterial = new MeshBasicMaterial({ color: '#ffe2b8', toneMapped: false })

export function HitlGate({ node }: NodeMeshProps) {
  const body = useMemo(
    () =>
      merge([
        prism(square(0, 0, 0.44), 0, FLOOR_PX),
        prism(rect(-0.44, -0.44, 0.88, 0.06), FLOOR_PX, WALL_PX),
        prism(rect(-0.44, -0.44, 0.06, 0.88), FLOOR_PX, WALL_PX),
        prism(rect(-0.05, -0.28, 0.26, 0.24), FLOOR_PX, 7),
        cylinder(0.012, FLOOR_PX + 7, LAMP_PX - FLOOR_PX - 7, undefined, { x: 0.14, z: -0.22, segments: 6 }),
        prism(rect(0.1, 0.12, 0.28, 0.24), FLOOR_PX, 2, TRAY),
      ]),
    [],
  )
  return (
    <NodeShell id={node.id} type={node.type} x={node.x} y={node.y} light={[0.44, 1.5, 0.3]}>
      <mesh geometry={body} material={chipboardMaterial} userData={CHIP} castShadow />
      <mesh geometry={figureGeometry} material={figureMaterial} position={[-0.2, FLOOR_PX * PX_Z, -0.12]} scale={0.9} castShadow />
      <mesh geometry={lampGeometry} material={lampMaterial} position={[0.16, LAMP_PX * PX_Z, -0.24]} />
    </NodeShell>
  )
}
