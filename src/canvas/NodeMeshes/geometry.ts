/*
 * Chipboard geometry. Every form in design/iso.js is an extrusion, cylinder
 * or frustum, so each node is a few of these merged into one geometry.
 *
 * Faces are painted by their normal exactly as iso.js shades them (top,
 * left and right colours, blended round curves), into vertex colours on an
 * unlit material, so the board reads the design's values to the digit. The
 * desk lamp shows up as the shadows it casts, not as shading on the faces.
 *
 * Footprints are (x, z) offsets from the node's centre in tiles; heights are
 * iso.js px, converted with PX_Z.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Shape,
  Vector2,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { PX_Z, sideShade } from '../iso'
import { HEX } from '../palette'
import type { Pt } from '../paths'

export interface Faces {
  readonly top: string
  readonly left: string
  readonly right: string
}

export const CHIPBOARD: Faces = { top: HEX.chipTop, left: HEX.chipLeft, right: HEX.chipRight }
export const SLM_RING: Faces = { top: HEX.ringTop, left: HEX.ringLeft, right: HEX.ringRight }
export const PLAZA: Faces = { top: HEX.plazaTop, left: HEX.plazaLeft, right: HEX.plazaRight }
export const FIGURE: Faces = { top: HEX.figure, left: HEX.figure, right: HEX.figureShade }

/** One colour on every face: inset panels, slots and dials. */
export function flat(color: string): Faces {
  return { top: color, left: color, right: color }
}

/** Bevel on extruded edges, iso px. Small: it catches a highlight, it doesn't round the form. */
const BEVEL_PX = 0.7

const scratchTop = new Color()
const scratchLeft = new Color()
const scratchRight = new Color()
const scratchSide = new Color()

/** Writes a vertex colour per vertex from its normal, the way iso.js solid() shades faces. */
export function paint(geometry: BufferGeometry, faces: Faces): BufferGeometry {
  const normals = geometry.getAttribute('normal')
  const count = normals.count
  const colors = new Float32Array(count * 3)
  scratchTop.set(faces.top)
  scratchLeft.set(faces.left)
  scratchRight.set(faces.right)
  for (let i = 0; i < count; i++) {
    const nx = normals.getX(i)
    const ny = normals.getY(i)
    const nz = normals.getZ(i)
    scratchSide.copy(scratchLeft).lerp(scratchRight, sideShade(nx, nz))
    // Bevels and slanted faces blend toward the top colour as they turn up.
    const up = Math.min(1, Math.max(0, (ny - 0.3) / 0.6))
    scratchSide.lerp(scratchTop, up)
    colors[i * 3] = scratchSide.r
    colors[i * 3 + 1] = scratchSide.g
    colors[i * 3 + 2] = scratchSide.b
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  return geometry
}

/** A polygon footprint extruded from z0 to z0 + h (px), with a small bevel. */
export function prism(footprint: readonly Pt[], z0Px: number, hPx: number, faces: Faces = CHIPBOARD): BufferGeometry {
  const bevel = Math.min(BEVEL_PX, hPx / 3) * PX_Z
  const shape = new Shape(footprint.map((p) => new Vector2(p.x, -p.z)))
  const geometry = new ExtrudeGeometry(shape, {
    depth: Math.max(hPx * PX_Z - 2 * bevel, 1e-4),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: 1,
    curveSegments: 1,
  })
  // Shape (x, y) lies in the XZ plane with y → −z, and the extrusion runs up +Y.
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, z0Px * PX_Z + bevel, 0)
  return paint(geometry, faces)
}

/** A cylinder (or frustum) from z0 to z0 + h (px), centred at (x, z). */
export function cylinder(
  radius: number,
  z0Px: number,
  hPx: number,
  faces: Faces = CHIPBOARD,
  options: { readonly topRadius?: number; readonly segments?: number; readonly x?: number; readonly z?: number } = {},
): BufferGeometry {
  const h = hPx * PX_Z
  const geometry = new CylinderGeometry(options.topRadius ?? radius, radius, h, options.segments ?? 32)
  geometry.translate(options.x ?? 0, z0Px * PX_Z + h / 2, options.z ?? 0)
  return paint(geometry, faces)
}

/** How far an inset panel stands proud of its face, tiles. */
const PANEL_DEPTH = 0.008

/** A square frustum (iso solid(sq, sq)) with flat faces and axis-aligned edges. */
export function squareFrustum(halfBottom: number, halfTop: number, z0Px: number, hPx: number, faces: Faces = CHIPBOARD): BufferGeometry {
  const h = hPx * PX_Z
  const indexed = new CylinderGeometry(halfTop * Math.SQRT2, halfBottom * Math.SQRT2, h, 4, 1)
  indexed.rotateY(Math.PI / 4)
  const geometry = indexed.toNonIndexed()
  indexed.dispose()
  geometry.computeVertexNormals()
  geometry.translate(0, z0Px * PX_Z + h / 2, 0)
  return paint(geometry, faces)
}

/** A thin panel on a node's +z face (iso faceL), from x0 to x1 and z0 to z1 px. */
export function frontPanel(x0: number, x1: number, faceZ: number, z0Px: number, z1Px: number, faces: Faces): BufferGeometry {
  return prism(rect(x0, faceZ, x1 - x0, PANEL_DEPTH), z0Px, z1Px - z0Px, faces)
}

/** A thin panel on a node's +x face (iso faceR), from z0 to z1 along the face. */
export function sidePanel(z0: number, z1: number, faceX: number, z0Px: number, z1Px: number, faces: Faces): BufferGeometry {
  return prism(rect(faceX, z0, PANEL_DEPTH, z1 - z0), z0Px, z1Px - z0Px, faces)
}

/** Merges node parts into one geometry, so each node is one draw call. */
export function merge(parts: readonly BufferGeometry[]): BufferGeometry {
  const flat = parts.map((g) => (g.index === null ? g : g.toNonIndexed()))
  for (const g of flat) {
    if (!g.getAttribute('uv')) g.setAttribute('uv', new BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2))
  }
  const merged = mergeGeometries(flat, false)
  if (merged === null) throw new Error('Node geometry parts have mismatched attributes')
  for (const g of parts) g.dispose()
  return merged
}

// ---------------------------------------------------------------------------
// Footprints
// ---------------------------------------------------------------------------

/** Axis-aligned rectangle from (x0, z0), w by d tiles (iso rect()). */
export function rect(x0: number, z0: number, w: number, d: number): Pt[] {
  return [
    { x: x0, z: z0 },
    { x: x0 + w, z: z0 },
    { x: x0 + w, z: z0 + d },
    { x: x0, z: z0 + d },
  ]
}

/** Square of half-width hw (and half-depth hd) around (x, z) (iso sq()). */
export function square(x: number, z: number, hw: number, hd = hw): Pt[] {
  return rect(x - hw, z - hd, 2 * hw, 2 * hd)
}

/** Regular polygon around (x, z) (iso circ()). */
export function ngon(x: number, z: number, radius: number, sides: number, rotation = 0): Pt[] {
  const points: Pt[] = []
  for (let i = 0; i < sides; i++) {
    const t = rotation + (i / sides) * Math.PI * 2
    points.push({ x: x + radius * Math.cos(t), z: z + radius * Math.sin(t) })
  }
  return points
}

// ---------------------------------------------------------------------------
// Engraved glyphs: line segments lying on a top face (iso tg())
// ---------------------------------------------------------------------------

export class GlyphBuilder {
  private readonly values: number[] = []

  constructor(private readonly yPx: number) {}

  private y(): number {
    // A hair above the face so it never z-fights.
    return this.yPx * PX_Z + 0.004
  }

  line(x1: number, z1: number, x2: number, z2: number): this {
    const y = this.y()
    this.values.push(x1, y, z1, x2, y, z2)
    return this
  }

  polyline(points: readonly (readonly [number, number])[], closed = false): this {
    for (let i = 1; i < points.length; i++) this.line(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1])
    if (closed && points.length > 2) {
      const a = points[points.length - 1]
      this.line(a[0], a[1], points[0][0], points[0][1])
    }
    return this
  }

  circle(x: number, z: number, radius: number, segments = 16): this {
    const points: [number, number][] = []
    for (let i = 0; i < segments; i++) {
      const t = (i / segments) * Math.PI * 2
      points.push([x + radius * Math.cos(t), z + radius * Math.sin(t)])
    }
    return this.polyline(points, true)
  }

  rect(x: number, z: number, w: number, d: number): this {
    return this.polyline(
      [
        [x, z],
        [x + w, z],
        [x + w, z + d],
        [x, z + d],
      ],
      true,
    )
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(this.values, 3))
    return geometry
  }
}
