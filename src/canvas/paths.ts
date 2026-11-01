/*
 * Board geometry that the engine doesn't store (D33): tube lanes and curves,
 * their arc-length samples, where a packet sits at a given tick, queue racks and
 * the user plazas. Pure functions with no three, so they test in node.
 *
 * Points are (x, z) on the mat in tiles: x is engine x, z is engine y.
 */

import type { Tile } from '../engine'

export const SAMPLES_PER_EDGE = 32
/** Floats per sample in the shared buffer: x, z. */
export const SAMPLE_STRIDE = 2
/** Tube corner radius, tiles (iso rounded(g, .4)). */
export const CORNER_RADIUS = 0.4

export interface Pt {
  x: number
  z: number
}

export interface Rect {
  readonly x0: number
  readonly z0: number
  readonly x1: number
  readonly z1: number
}

export function tileCentre(t: Tile): Pt {
  return { x: t.x + 0.5, z: t.y + 0.5 }
}

/** Centre-to-centre distance between neighbouring lanes, tiles: the glass is about 0.18 across. */
export const LANE_GAP = 0.24

interface Run {
  readonly route: number
  readonly run: number
  readonly lo: number
  readonly hi: number
}

/**
 * Lanes for tubes that share a stretch of grid (D33). Each straight run of each route sits on one
 * grid line; runs on the same line that overlap by at least one tile get different lanes, by
 * greedy interval colouring (optimal for intervals), so no two tubes ever overlap. A bundle of k
 * lanes is centred on the line. Returns, per route, one sideways offset per run, in tiles:
 * along +z for a run along x, along +x for a run along z. Runs alone on their stretch get 0.
 */
export function assignLanes(routes: readonly (readonly Tile[])[]): number[][] {
  const offsets = routes.map((route) => new Array<number>(Math.max(0, route.length - 1)).fill(0))
  const lines = new Map<string, Run[]>()
  routes.forEach((route, r) => {
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1]
      const b = route[i]
      const vertical = a.x === b.x
      const key = vertical ? `v${a.x}` : `h${a.y}`
      const lo = vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x)
      const hi = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x)
      let list = lines.get(key)
      if (list === undefined) lines.set(key, (list = []))
      list.push({ route: r, run: i - 1, lo, hi })
    }
  })

  for (const runs of lines.values()) {
    if (runs.length < 2) continue
    // Sorted by start, then by route order, so the colouring is deterministic.
    runs.sort((p, q) => p.lo - q.lo || p.route - q.route || p.run - q.run)
    const lanes = new Array<number>(runs.length).fill(0)
    let clusterStart = 0
    let clusterEnd = -Infinity
    const closeCluster = (end: number) => {
      let k = 0
      for (let i = clusterStart; i < end; i++) k = Math.max(k, lanes[i] + 1)
      for (let i = clusterStart; i < end; i++) offsets[runs[i].route][runs[i].run] = (lanes[i] - (k - 1) / 2) * LANE_GAP
    }
    for (let i = 0; i < runs.length; i++) {
      if (runs[i].lo >= clusterEnd && i > clusterStart) {
        closeCluster(i)
        clusterStart = i
      }
      // The lowest lane no overlapping run in this cluster already holds.
      const taken = new Set<number>()
      for (let j = clusterStart; j < i; j++) if (runs[j].hi > runs[i].lo) taken.add(lanes[j])
      let lane = 0
      while (taken.has(lane)) lane++
      lanes[i] = lane
      clusterEnd = Math.max(clusterEnd, runs[i].hi)
    }
    closeCluster(runs.length)
  }
  return offsets
}

/**
 * A tube's centreline in mat coordinates: the engine's route (tile corners) through tile centres,
 * each run shifted sideways into its lane. Corners sit where neighbouring runs' lanes cross.
 */
export function routePolyline(route: readonly Tile[], offsets?: readonly number[]): Pt[] {
  if (route.length < 2) return route.map((t) => tileCentre(t))
  const off = (i: number) => offsets?.[i] ?? 0
  const isVertical = (i: number) => route[i].x === route[i + 1].x
  // The run's line: x for a vertical run, z for a horizontal one.
  const line = (i: number) => (isVertical(i) ? route[i].x + 0.5 + off(i) : route[i].y + 0.5 + off(i))
  const runs = route.length - 1
  const points: Pt[] = []
  const start = route[0]
  points.push(isVertical(0) ? { x: line(0), z: start.y + 0.5 } : { x: start.x + 0.5, z: line(0) })
  for (let i = 1; i < runs; i++) {
    // Neighbouring runs of a simplified route always turn, so one is vertical and one horizontal.
    if (isVertical(i - 1)) points.push({ x: line(i - 1), z: line(i) })
    else points.push({ x: line(i), z: line(i - 1) })
  }
  const end = route[route.length - 1]
  points.push(isVertical(runs - 1) ? { x: line(runs - 1), z: end.y + 0.5 } : { x: end.x + 0.5, z: line(runs - 1) })
  return points
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.z - a.z)
}

/** Replaces each interior corner with a quadratic curve of the given radius (iso rounded()). */
export function roundCorners(points: readonly Pt[], radius: number, steps = 8): Pt[] {
  if (points.length < 3) return points.map((p) => ({ x: p.x, z: p.z }))
  const out: Pt[] = [{ x: points[0].x, z: points[0].z }]
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]
    const b = points[i]
    const c = points[i + 1]
    const d1 = dist(a, b)
    const d2 = dist(b, c)
    const r1 = Math.min(radius, d1 / 2)
    const r2 = Math.min(radius, d2 / 2)
    const p0 = { x: b.x + ((a.x - b.x) / d1) * r1, z: b.z + ((a.z - b.z) / d1) * r1 }
    const p2 = { x: b.x + ((c.x - b.x) / d2) * r2, z: b.z + ((c.z - b.z) / d2) * r2 }
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const u = 1 - t
      out.push({
        x: u * u * p0.x + 2 * u * t * b.x + t * t * p2.x,
        z: u * u * p0.z + 2 * u * t * b.z + t * t * p2.z,
      })
    }
  }
  const last = points[points.length - 1]
  out.push({ x: last.x, z: last.z })
  return out
}

export function polylineLength(points: readonly Pt[]): number {
  let length = 0
  for (let i = 1; i < points.length; i++) length += dist(points[i - 1], points[i])
  return length
}

function inside(p: Pt, r: Rect): boolean {
  return p.x > r.x0 && p.x < r.x1 && p.z > r.z0 && p.z < r.z1
}

/**
 * Cuts the start of a polyline off where it leaves a rectangle, so a tube
 * starts at the plaza's edge instead of running across the crowd.
 */
export function trimStartToRect(points: readonly Pt[], rect: Rect): Pt[] {
  if (points.length < 2 || !inside(points[0], rect)) return points.slice()
  for (let i = 1; i < points.length; i++) {
    if (inside(points[i], rect)) continue
    // Bisect the segment that crosses the edge.
    const a = points[i - 1]
    const b = points[i]
    let lo = 0
    let hi = 1
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2
      const p = { x: a.x + (b.x - a.x) * mid, z: a.z + (b.z - a.z) * mid }
      if (inside(p, rect)) lo = mid
      else hi = mid
    }
    const cut = { x: a.x + (b.x - a.x) * hi, z: a.z + (b.z - a.z) * hi }
    return [cut, ...points.slice(i)]
  }
  return points.slice()
}

export function trimEndToRect(points: readonly Pt[], rect: Rect): Pt[] {
  return trimStartToRect(points.slice().reverse(), rect).reverse()
}

/**
 * Writes `count` points evenly spaced by arc length into `out` at `offset`
 * (x, z pairs), first and last on the polyline's ends (D33).
 */
export function sampleByArcLength(
  points: readonly Pt[],
  out: Float32Array,
  offset: number,
  count = SAMPLES_PER_EDGE,
): void {
  const total = polylineLength(points)
  let seg = 1
  let segStart = 0
  for (let i = 0; i < count; i++) {
    const target = (total * i) / (count - 1)
    while (seg < points.length - 1 && segStart + dist(points[seg - 1], points[seg]) < target) {
      segStart += dist(points[seg - 1], points[seg])
      seg++
    }
    const a = points[seg - 1]
    const b = points[seg]
    const d = dist(a, b)
    const t = d > 0 ? Math.min(1, Math.max(0, (target - segStart) / d)) : 0
    out[offset + i * SAMPLE_STRIDE] = a.x + (b.x - a.x) * t
    out[offset + i * SAMPLE_STRIDE + 1] = a.z + (b.z - a.z) * t
  }
}

/**
 * How far along its edge a packet is, from 0 to 1 (D33). `tick` is the
 * engine's tick counter between ticks, which has already moved past the tick
 * the packet entered on, hence the − 1: t is 0 just after it enters and
 * reaches 1 as the tick that delivers it comes due.
 */
export function edgeT(tick: number, alpha: number, enterTick: number, transitTicks: number): number {
  if (transitTicks <= 0) return 1
  const t = (tick - 1 + alpha - enterTick) / transitTicks
  return t < 0 ? 0 : t > 1 ? 1 : t
}

/** Position and unit tangent at t along one edge's samples. Writes into `out`, no allocation. */
export function samplePoint(
  samples: Float32Array,
  base: number,
  t: number,
  out: { x: number; z: number; dx: number; dz: number },
  count = SAMPLES_PER_EDGE,
): void {
  const f = t * (count - 1)
  const i = Math.min(count - 2, Math.max(0, Math.floor(f)))
  const local = f - i
  const ax = samples[base + i * SAMPLE_STRIDE]
  const az = samples[base + i * SAMPLE_STRIDE + 1]
  const bx = samples[base + (i + 1) * SAMPLE_STRIDE]
  const bz = samples[base + (i + 1) * SAMPLE_STRIDE + 1]
  out.x = ax + (bx - ax) * local
  out.z = az + (bz - az) * local
  const dx = bx - ax
  const dz = bz - az
  const len = Math.hypot(dx, dz)
  if (len > 1e-9) {
    out.dx = dx / len
    out.dz = dz / len
  } else {
    out.dx = 1
    out.dz = 0
  }
}

// ---------------------------------------------------------------------------
// Queue racks (D34, D38)
// ---------------------------------------------------------------------------

/** A rack never shows more than this many upright capsules; the rest show as "+N" on the plate (D38). */
export const RACK_MAX = 12
/** Ring radius for a one-tile node: half the footprint plus 0.13 (iso drawNode). */
export const RACK_RADIUS = 0.5 + 0.13
/** A queued prompt's slot turns amber once it has used this share of its deadline, red at the second (iso node states). */
export const RACK_WARN_AT = 0.5
export const RACK_ALARM_AT = 0.85

/** Slot angle in the (x, z) plane, radians: the ring starts at the back left (−135°) and runs clockwise on screen. */
export function rackSlotAngle(i: number, slots = RACK_MAX): number {
  return ((-135 + (i * 360) / slots) * Math.PI) / 180
}

export function rackView(queueLength: number): { shown: number; overflow: number } {
  const shown = Math.min(Math.max(queueLength, 0), RACK_MAX)
  return { shown, overflow: Math.max(0, queueLength - RACK_MAX) }
}

export const Urgency = { NORMAL: 0, WARN: 1, ALARM: 2 } as const
export type UrgencyValue = (typeof Urgency)[keyof typeof Urgency]

/** How urgent a queued prompt looks, from how much of its deadline it has used. */
export function rackUrgency(tick: number, createdTick: number, deadlineTick: number): UrgencyValue {
  const span = deadlineTick - createdTick
  if (span <= 0) return Urgency.ALARM
  const used = (tick - createdTick) / span
  if (used >= RACK_ALARM_AT) return Urgency.ALARM
  if (used >= RACK_WARN_AT) return Urgency.WARN
  return Urgency.NORMAL
}

// ---------------------------------------------------------------------------
// User plazas
// ---------------------------------------------------------------------------

/** Plaza half-depth along z, tiles (iso hero plazas run r 5.6 to 9.4 around a row centre of 7.5). */
const PLAZA_HALF_DEPTH = 1.9
/** How far a plaza stops short of the grid's outer edge, tiles. */
const PLAZA_EDGE_INSET = 0.4
/** How far a plaza runs from its node's tile toward the board edge, tiles. */
const PLAZA_REACH = 2.6

/**
 * Users in sits at the left of the board and spreads toward the left edge;
 * Users out mirrors it on the right. The engine node is one tile inside it.
 */
export function plazaRect(kind: 'in' | 'out', tile: Tile, cols: number): Rect {
  const z = tile.y + 0.5
  if (kind === 'in') {
    return { x0: Math.max(PLAZA_EDGE_INSET, tile.x + 1 - PLAZA_REACH), x1: tile.x + 1, z0: z - PLAZA_HALF_DEPTH, z1: z + PLAZA_HALF_DEPTH }
  }
  return { x0: tile.x, x1: Math.min(cols - PLAZA_EDGE_INSET, tile.x + PLAZA_REACH), z0: z - PLAZA_HALF_DEPTH, z1: z + PLAZA_HALF_DEPTH }
}

/** Figures at the exit: every place is filled at 90% trust and above, thinning linearly below. */
export const PLAZA_FULL = 30
export function exitCrowd(trust: number): number {
  return Math.round(PLAZA_FULL * Math.min(1, Math.max(0, trust) / 90))
}

/** Figures at the entry grow with traffic: 2 per prompt/s, between 6 and 44 (iso opening, hero, outage). */
export const PLAZA_MAX = 44
export function entryCrowd(ratePerSec: number): number {
  return Math.min(PLAZA_MAX, Math.max(6, Math.round(2 * ratePerSec)))
}

// ---------------------------------------------------------------------------
// Virtual hops (cache hits, JSON retries)
// ---------------------------------------------------------------------------

/** Arc height for a hop of a given length, tiles; long cache-hit arcs top out near the hero's lift. */
export function hopLift(lengthTiles: number): number {
  return Math.min(3.8, 0.5 + 0.18 * lengthTiles)
}

/**
 * A point on a quadratic arc from a to b raised by `lift` at its middle.
 * Writes position and unit tangent into `out` (y is height in world units).
 */
export function arcPoint(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  lift: number,
  t: number,
  out: { x: number; y: number; z: number; dx: number; dy: number; dz: number },
): void {
  const cx = (ax + bx) / 2
  const cy = Math.max(ay, by) + lift
  const cz = (az + bz) / 2
  const u = 1 - t
  out.x = u * u * ax + 2 * u * t * cx + t * t * bx
  out.y = u * u * ay + 2 * u * t * cy + t * t * by
  out.z = u * u * az + 2 * u * t * cz + t * t * bz
  const dx = 2 * u * (cx - ax) + 2 * t * (bx - cx)
  const dy = 2 * u * (cy - ay) + 2 * t * (by - cy)
  const dz = 2 * u * (cz - az) + 2 * t * (bz - cz)
  const len = Math.hypot(dx, dy, dz)
  if (len > 1e-9) {
    out.dx = dx / len
    out.dy = dy / len
    out.dz = dz / len
  } else {
    out.dx = 1
    out.dy = 0
    out.dz = 0
  }
}
