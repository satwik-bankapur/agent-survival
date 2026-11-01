/*
 * Frontier API: a frosted acrylic cloud tethered to an anchor pad, the only
 * non-solid thing on the board (iso D.frontier). The cloud is drawn in two
 * passes: depth first, then colour, so overlapping puffs blend once and the
 * cloud reads as one frosted shape with a bright rim.
 */

import { useMemo } from 'react'
import {
  AdditiveBlending,
  BufferGeometry,
  CapsuleGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineDashedMaterial,
  Line,
  MeshBasicMaterial,
  ShaderMaterial,
  SphereGeometry,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { PX_XY, PX_Z, cameraBasis, screenOffset } from '../iso'
import { HEX, OPACITY, linear } from '../palette'
import { CHIP, NodeShell, chipboardMaterial } from './common'
import { cylinder } from './geometry'
import type { NodeMeshProps } from './types'

/**
 * Height of the cloud's base above the mat, iso px. Low enough that the cloud sits right over its
 * pad, and its label plate right under it, so the three read as one object (iso had 42).
 */
export const CLOUD_PX = 24
/**
 * iso puffs: screen offset (px) and radius (px) from the cloud's centre, shifted 1.5 px left of
 * iso so the cloud's mass is centred over the pad and the plate below it.
 */
const PUFFS: readonly (readonly [number, number, number])[] = [
  [-13.5, -3, 8],
  [-3.5, -9, 10],
  [8.5, -5, 8],
  [15.5, 0, 5.5],
]

function cloudGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = []
  for (const [sx, sy, r] of PUFFS) {
    const o = screenOffset(sx, sy)
    const g = new SphereGeometry(r * PX_XY, 24, 16)
    g.translate(o.x, o.y, o.z)
    parts.push(g)
  }
  // The flat base: iso's 41 × 8.5 px rounded rect, as a capsule lying along the screen's x.
  const radius = 4.25 * PX_XY
  const base = new CapsuleGeometry(radius, 41 * PX_XY - 2 * radius, 6, 16)
  const { right } = cameraBasis()
  base.rotateZ(Math.PI / 2)
  base.rotateY(Math.atan2(-right.z, right.x))
  const o = screenOffset(0, 1.25)
  base.translate(o.x, o.y, o.z)
  parts.push(base)
  const merged = mergeGeometries(
    parts.map((g) => g.toNonIndexed()),
    false,
  )
  for (const g of parts) g.dispose()
  if (merged === null) throw new Error('Cloud geometry failed to merge')
  merged.translate(0, CLOUD_PX * PX_Z, 0)
  return merged
}

/* Transparent so it runs after the opaque pass: the mat and capsules behind still show through. */
const depthMaterial = new MeshBasicMaterial({ colorWrite: false, transparent: true })

/** Frosted acrylic with a 1 px bright edge (iso: fill at 55%, white edge filter at 95%). */
const acrylicMaterial = new ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: {
    uColor: { value: linear(HEX.acrylic) },
    uOpacity: { value: OPACITY.acrylic },
  },
  vertexShader: /* glsl */ `
    varying vec3 vNormal;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uOpacity;
    varying vec3 vNormal;
    void main() {
      // Orthographic: the view direction is +z in view space.
      float rim = 1.0 - abs(vNormal.z);
      float edge = smoothstep(0.82, 0.97, rim);
      gl_FragColor = vec4(mix(uColor, vec3(1.0), edge), mix(uOpacity, 0.95, edge));
    }
  `,
})

const tetherMaterial = new LineDashedMaterial({
  color: HEX.acrylic,
  transparent: true,
  opacity: 0.35,
  dashSize: 1.5 * PX_XY,
  gapSize: 2 * PX_XY,
})
const glowMaterial = new LineBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false })

/** The dashed tether from the pad up to the cloud. */
function tether(): Line {
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute([0, 3 * PX_Z, 0, 0, (CLOUD_PX - 5) * PX_Z, 0], 3))
  const line = new Line(g, tetherMaterial)
  line.computeLineDistances()
  return line
}

/** The faint line rising out of the top of the cloud into the night, fading out (iso teth gradient). */
function skyline(): Line {
  const g = new BufferGeometry()
  const base = screenOffset(2, -18)
  const y0 = CLOUD_PX * PX_Z + base.y
  const y1 = y0 + 170 * PX_Z
  g.setAttribute('position', new Float32BufferAttribute([base.x, y0, base.z, base.x, y1, base.z], 3))
  const c = linear(HEX.glassGlow)
  g.setAttribute('color', new Float32BufferAttribute([c.r * 0.45, c.g * 0.45, c.b * 0.45, 0, 0, 0], 3))
  return new Line(g, glowMaterial)
}

export function FrontierApi({ node }: NodeMeshProps) {
  const pad = useMemo(() => cylinder(0.3, 0, 3), [])
  const cloud = useMemo(() => cloudGeometry(), [])
  const lines = useMemo(() => [tether(), skyline()], [])
  return (
    <NodeShell id={node.id} type={node.type} x={node.x} y={node.y} light={[0.21, 1.6, 0.21]}>
      <mesh geometry={pad} material={chipboardMaterial} userData={CHIP} castShadow />
      <mesh geometry={cloud} material={depthMaterial} renderOrder={1} castShadow />
      <mesh geometry={cloud} material={acrylicMaterial} renderOrder={2} />
      <primitive object={lines[0]} />
      <primitive object={lines[1]} />
    </NodeShell>
  )
}
