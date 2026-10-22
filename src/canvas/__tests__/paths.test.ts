import { describe, expect, it } from 'vitest'

import { createRouteGrid, planRoute, segmentIndex, type Tile } from '../../engine'
import {
  LANE_GAP,
  SAMPLE_STRIDE,
  SAMPLES_PER_EDGE,
  arcPoint,
  assignLanes,
  edgeT,
  plazaRect,
  polylineLength,
  roundCorners,
  routePolyline,
  sampleByArcLength,
  samplePoint,
  trimEndToRect,
  trimStartToRect,
  type Pt,
} from '../paths'

function samples(points: readonly Pt[]): Float32Array {
  const out = new Float32Array(SAMPLES_PER_EDGE * SAMPLE_STRIDE)
  sampleByArcLength(points, out, 0)
  return out
}

/** A free-space L from a to b, x first, as the engine plans it on an empty board. */
function lRoute(a: Tile, b: Tile): Tile[] {
  return planRoute(createRouteGrid(26, 18, new Int32Array(26 * 18).fill(-1)), a, b)
}

describe('routes', () => {
  it('runs through tile centres, x first then y, on a free board', () => {
    expect(routePolyline(lRoute({ x: 8, y: 9 }, { x: 14, y: 8 }))).toEqual([
      { x: 8.5, z: 9.5 },
      { x: 14.5, z: 9.5 },
      { x: 14.5, z: 8.5 },
    ])
  })

  it('has no corner on a straight run', () => {
    expect(routePolyline(lRoute({ x: 2, y: 9 }, { x: 5, y: 9 }))).toHaveLength(2)
  })

  it('rounds corners without moving the ends', () => {
    const rounded = roundCorners(routePolyline(lRoute({ x: 8, y: 9 }, { x: 14, y: 4 })), 0.4)
    expect(rounded[0]).toEqual({ x: 8.5, z: 9.5 })
    expect(rounded[rounded.length - 1]).toEqual({ x: 14.5, z: 4.5 })
    const sharp = 6 + 5
    const length = polylineLength(rounded)
    expect(length).toBeLessThan(sharp)
    expect(length).toBeGreaterThan(sharp - 0.4)
  })
})

describe('lanes (D33)', () => {
  it('leaves a tube alone on its stretch in the middle of the grid line', () => {
    const lanes = assignLanes([lRoute({ x: 2, y: 9 }, { x: 12, y: 9 }), lRoute({ x: 12, y: 9 }, { x: 23, y: 9 })])
    expect(lanes).toEqual([[0], [0]])
  })

  it('puts tubes sharing a stretch in separate lanes, centred on the line', () => {
    const a = { x: 2, y: 9 }
    const routes = [lRoute(a, { x: 8, y: 9 }), lRoute(a, { x: 8, y: 5 }), lRoute(a, { x: 8, y: 13 })]
    const lanes = assignLanes(routes)
    const firstRuns = lanes.map((l) => l[0]).sort((p, q) => p - q)
    expect(firstRuns).toEqual([-LANE_GAP, 0, LANE_GAP])
    // The vertical runs at x = 8 go opposite ways from row 9, so they never share a stretch.
    expect(lanes[1][1]).toBe(0)
    expect(lanes[2][1]).toBe(0)
  })

  it('never puts two tubes on the same unit of grid at the same offset, and keeps their glass apart', () => {
    // Users in fanning out to four targets, two of them along the same column.
    const a = { x: 2, y: 9 }
    const routes = [lRoute(a, { x: 10, y: 9 }), lRoute(a, { x: 10, y: 4 }), lRoute(a, { x: 10, y: 6 }), lRoute(a, { x: 14, y: 4 })]
    const lanes = assignLanes(routes)
    const seen = new Map<number, number[]>()
    routes.forEach((route, r) => {
      for (let i = 1; i < route.length; i++) {
        const p = route[i - 1]
        const q = route[i]
        const vertical = p.x === q.x
        const lo = vertical ? Math.min(p.y, q.y) : Math.min(p.x, q.x)
        const hi = vertical ? Math.max(p.y, q.y) : Math.max(p.x, q.x)
        for (let k = lo; k < hi; k++) {
          const seg = segmentIndex(26, vertical ? p.x : k, vertical ? k : p.y, vertical)
          const list = seen.get(seg) ?? []
          list.push(lanes[r][i - 1])
          seen.set(seg, list)
        }
      }
    })
    for (const offsets of seen.values()) {
      const sorted = [...offsets].sort((p, q) => p - q)
      for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(LANE_GAP - 1e-9)
    }
    // Glass is 8 px across at 32√2 px per tile: lanes must clear it.
    expect(LANE_GAP).toBeGreaterThan(8 / (32 * Math.SQRT2))
  })

  it('shifts each run into its lane and meets lanes at the corners', () => {
    const route = lRoute({ x: 2, y: 9 }, { x: 8, y: 5 })
    const expected = [
      { x: 2.5, z: 9.74 },
      { x: 8.26, z: 9.74 },
      { x: 8.26, z: 5.5 },
    ]
    const points = routePolyline(route, [0.24, -0.24])
    expect(points).toHaveLength(3)
    points.forEach((p, i) => {
      expect(p.x).toBeCloseTo(expected[i].x, 9)
      expect(p.z).toBeCloseTo(expected[i].z, 9)
    })
  })
})

describe('arc-length samples (D33)', () => {
  it('spaces 32 points evenly along a straight run', () => {
    const points = routePolyline(lRoute({ x: 2, y: 9 }, { x: 19, y: 9 }))
    const out = samples(points)
    const step = polylineLength(points) / (SAMPLES_PER_EDGE - 1)
    for (let i = 1; i < SAMPLES_PER_EDGE; i++) {
      expect(out[i * 2] - out[i * 2 - 2]).toBeCloseTo(step, 5)
    }
  })

  it('keeps even spacing round a corner and both ends in place', () => {
    const points = roundCorners(routePolyline(lRoute({ x: 2, y: 2 }, { x: 12, y: 9 })), 0.4)
    const out = samples(points)
    const step = polylineLength(points) / (SAMPLES_PER_EDGE - 1)
    for (let i = 1; i < SAMPLES_PER_EDGE; i++) {
      const d = Math.hypot(out[i * 2] - out[i * 2 - 2], out[i * 2 + 1] - out[i * 2 - 1])
      // A chord across the 0.4-tile corner is up to ~8% shorter than the arc it spans.
      expect(d).toBeGreaterThan(step * 0.9)
      expect(d).toBeLessThan(step * 1.0001)
    }
    expect(out[0]).toBeCloseTo(2.5)
    expect(out[1]).toBeCloseTo(2.5)
    expect(out[(SAMPLES_PER_EDGE - 1) * 2]).toBeCloseTo(12.5)
    expect(out[(SAMPLES_PER_EDGE - 1) * 2 + 1]).toBeCloseTo(9.5)
  })

  it('interpolates position and tangent between samples', () => {
    const out = samples(routePolyline(lRoute({ x: 0, y: 0 }, { x: 10, y: 0 })))
    const p = { x: 0, z: 0, dx: 0, dz: 0 }
    samplePoint(out, 0, 0.5, p)
    expect(p.x).toBeCloseTo(5.5)
    expect(p.z).toBeCloseTo(0.5)
    expect(p.dx).toBeCloseTo(1)
    expect(p.dz).toBeCloseTo(0)
    samplePoint(out, 0, 1, p)
    expect(p.x).toBeCloseTo(10.5)
  })
})

describe('trimming at plazas', () => {
  it('starts a tube at the entry plaza edge and ends it at the exit plaza edge', () => {
    const into = plazaRect('in', { x: 2, y: 9 }, 26)
    const outOf = plazaRect('out', { x: 23, y: 9 }, 26)
    const route = routePolyline(lRoute({ x: 2, y: 9 }, { x: 23, y: 9 }))
    const trimmed = trimEndToRect(trimStartToRect(route, into), outOf)
    expect(trimmed[0].x).toBeCloseTo(into.x1, 5)
    expect(trimmed[trimmed.length - 1].x).toBeCloseTo(outOf.x0, 5)
    expect(trimmed[0].z).toBeCloseTo(9.5)
  })

  it('leaves a route that starts outside the rect alone', () => {
    const route = routePolyline(lRoute({ x: 8, y: 9 }, { x: 12, y: 9 }))
    expect(trimStartToRect(route, { x0: 0, x1: 3, z0: 0, z1: 18 })).toEqual(route)
  })
})

describe('edgeT', () => {
  // A packet enters on tick 100 with a 4-tick transit, so tick 104 delivers it.
  it('is 0 just after the packet enters', () => {
    expect(edgeT(101, 0, 100, 4)).toBe(0)
  })
  it('reaches 1 as the delivering tick comes due', () => {
    expect(edgeT(104, 0.999, 100, 4)).toBeCloseTo(1, 2)
    expect(edgeT(105, 0, 100, 4)).toBe(1)
  })
  it('moves smoothly with alpha', () => {
    expect(edgeT(102, 0.5, 100, 4)).toBeCloseTo(0.375)
  })
  it('clamps', () => {
    expect(edgeT(90, 0, 100, 4)).toBe(0)
    expect(edgeT(200, 0, 100, 4)).toBe(1)
  })
})

describe('virtual hop arcs', () => {
  it('starts and ends on its anchors and rises in between', () => {
    const p = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0 }
    arcPoint(0, 0.4, 0, 10, 0.2, 0, 3, 0, p)
    expect([p.x, p.y, p.z]).toEqual([0, 0.4, 0])
    arcPoint(0, 0.4, 0, 10, 0.2, 0, 3, 1, p)
    expect(p.x).toBeCloseTo(10)
    expect(p.y).toBeCloseTo(0.2)
    arcPoint(0, 0.4, 0, 10, 0.2, 0, 3, 0.5, p)
    expect(p.y).toBeGreaterThan(1.5)
    expect(Math.abs(p.dy)).toBeLessThan(0.05)
  })
})
