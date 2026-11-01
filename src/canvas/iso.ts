/*
 * The isometric frame, ported from design/iso.js. Pure numbers, no three.
 *
 * iso.js draws P(c, r, z) = ((c − r)·32, (c + r)·16 − z) px at zoom 1: a tile
 * is 32 px across and 16 px down per step, and z is screen pixels of height.
 * An orthographic camera at 30° elevation and 45° yaw reproduces that exactly
 * at 32·√2 px per world unit, so every iso.js measurement converts with the
 * constants below. World X is engine x (iso c), world Z is engine y (iso r),
 * and Y is up.
 */

export const ELEVATION_RAD = (30 * Math.PI) / 180
export const YAW_RAD = (45 * Math.PI) / 180

/** Screen px per world unit at zoom 1, measured across the screen. */
export const PX_PER_UNIT = 32 * Math.SQRT2
/** World units per iso.js px of height (z). */
export const PX_Z = 1 / (PX_PER_UNIT * Math.cos(ELEVATION_RAD))
/** World units per screen px, for widths and radii drawn across the view. */
export const PX_XY = 1 / PX_PER_UNIT
/** World units per screen px along a tile axis (one tile spans √(32² + 16²) px). */
export const PX_ALONG = 1 / Math.hypot(32, 16)

/** The hero artboard's camera: zoom 0.95, mat point (13, 9) at (656, 418) of 1440 × 900. */
export const HERO_VIEW = { zoom: 0.95, at: { x: 13, z: 9 }, screen: { fx: 656 / 1440, fy: 418 / 900 } } as const
/** MapControls zoom range, relative to the start view. */
export const ZOOM_RANGE = { min: 0.5, max: 2 } as const

/** Mat margin around the 26 × 18 grid, in tiles (iso mat(), margin 1.3). */
export const MAT_MARGIN = 1.3
/** Mat thickness, iso px. */
export const MAT_THICKNESS_PX = 3

/** Unit vector from the target toward the camera. */
export function cameraDirection(): { x: number; y: number; z: number } {
  const h = Math.cos(ELEVATION_RAD)
  return { x: h * Math.sin(YAW_RAD), y: Math.sin(ELEVATION_RAD), z: h * Math.cos(YAW_RAD) }
}

type Vec = { readonly x: number; readonly y: number; readonly z: number }

/** The screen's right and up directions in world space, as three builds them for this camera. */
export function cameraBasis(): { right: Vec; up: Vec } {
  const d = cameraDirection()
  // right = forward × up with forward = −d, up = +Y.
  const rl = Math.hypot(d.z, d.x)
  const rx = d.z / rl
  const rz = -d.x / rl
  // camera up = right × forward, with forward = −d and right.y = 0.
  return {
    right: { x: rx, y: 0, z: rz },
    up: { x: rz * d.y, y: rx * d.z - rz * d.x, z: -rx * d.y },
  }
}

/** Projects a world offset to screen px at zoom 1 (x right, y down). */
export function projectPx(x: number, y: number, z: number): { sx: number; sy: number } {
  const { right, up } = cameraBasis()
  return {
    sx: (x * right.x + y * right.y + z * right.z) * PX_PER_UNIT,
    sy: -(x * up.x + y * up.y + z * up.z) * PX_PER_UNIT,
  }
}

/** A world offset that moves a point by (sx, sy) screen px at zoom 1 (x right, y down). */
export function screenOffset(sx: number, sy: number): { x: number; y: number; z: number } {
  const { right, up } = cameraBasis()
  const a = sx / PX_PER_UNIT
  const b = -sy / PX_PER_UNIT
  return { x: right.x * a + up.x * b, y: right.y * a + up.y * b, z: right.z * a + up.z * b }
}

/**
 * Capsule length in px (D34, iso capLen): 14 px at 500 tokens, growing with
 * √(tokens ÷ 500), capped at 4× (56 px). Short packets bottom out at 7 px.
 */
export function capsuleLengthPx(tokens: number): number {
  const length = 14 * Math.sqrt(Math.max(tokens, 0) / 500)
  return Math.min(56, Math.max(7, length))
}

/**
 * Past the length cap a capsule swells instead (D34, Session 9): its diameter grows with
 * √(tokens ÷ 8,000), the tokens where length tops out, capped at 2×. An agent run's context grows
 * every pass (D6), so a runaway visibly bloats.
 */
export function capsuleSwell(tokens: number): number {
  return Math.min(2, Math.max(1, Math.sqrt(Math.max(tokens, 0) / 8000)))
}

/** An agent task's comet trail, px: 7 per model pass, at most 42 (iso capsule(), loops). */
export function cometLengthPx(passes: number): number {
  return Math.min(Math.max(passes, 0) * 7, 42)
}

/** A RAG capsule's chunk plates: one per 500 retrieved tokens, at most 8 (design: "Reranker", 8 chunks before, 2 after). */
export const MAX_CHUNKS = 8
export function chunkCount(contextTokens: number): number {
  return Math.min(MAX_CHUNKS, Math.round(Math.max(contextTokens, 0) / 500))
}

/** Capsule diameter, px (iso capsule d = 5). */
export const CAPSULE_DIAMETER_PX = 5

/**
 * iso.js shades a side face by its normal's angle in the (c, r) plane:
 * facing +r (screen lower left) is the left colour, facing +c (lower right)
 * the right colour, blended in between. Returns the right colour's weight.
 */
export function sideShade(normalX: number, normalZ: number): number {
  const deg = (Math.atan2(normalZ, normalX) * 180) / Math.PI
  return Math.min(1, Math.max(0, (90 - deg) / 90))
}

/** The screen area the board shows through: the canvas size, less the HUD round its edges, px. */
export interface FrameView {
  readonly width: number
  readonly height: number
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

/**
 * The camera that fits a set of world points into the view's open area, `marginPx` clear of its
 * edges: the ground point to look at and the zoom (screen px per world unit), clamped to
 * [minZoom, maxZoom]. The points' box is centred in the open area, not on the screen.
 */
export function frameBounds(
  points: readonly Vec[],
  view: FrameView,
  marginPx: number,
  minZoom: number,
  maxZoom: number,
): { x: number; z: number; zoom: number } {
  const { right, up } = cameraBasis()
  let u0 = Infinity
  let u1 = -Infinity
  let v0 = Infinity
  let v1 = -Infinity
  for (const p of points) {
    const u = p.x * right.x + p.y * right.y + p.z * right.z
    const v = p.x * up.x + p.y * up.y + p.z * up.z
    u0 = Math.min(u0, u)
    u1 = Math.max(u1, u)
    v0 = Math.min(v0, v)
    v1 = Math.max(v1, v)
  }
  const openW = Math.max(1, view.width - view.left - view.right - 2 * marginPx)
  const openH = Math.max(1, view.height - view.top - view.bottom - 2 * marginPx)
  const fit = Math.min(openW / Math.max(u1 - u0, 1e-6), openH / Math.max(v1 - v0, 1e-6))
  const zoom = Math.min(maxZoom, Math.max(minZoom, fit))
  // The open area's centre sits this far right of and below the screen's centre, px.
  const dx = (view.left - view.right) / 2
  const dy = (view.top - view.bottom) / 2
  const u = (u0 + u1) / 2 - dx / zoom
  const v = (v0 + v1) / 2 + dy / zoom
  // The ground point (y = 0) whose screen coordinates are (u, v): right.y is 0, so solve the 2 × 2.
  const det = right.x * up.z - right.z * up.x
  return { x: (u * up.z - right.z * v) / det, z: (right.x * v - u * up.x) / det, zoom }
}
