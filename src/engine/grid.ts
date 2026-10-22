/*
 * Grid routes. Every link runs along a route on the tile grid that never
 * passes through another node's tile. The engine keeps each route's corners
 * and times transit by its length (D30); the canvas builds the curve and
 * offsets tubes that share a stretch into lanes (D33).
 *
 * Routing runs only when the board changes, never per tick, so it may
 * allocate. It's deterministic: the same board always gets the same routes.
 */

import type { Catalog } from './catalog'
import type { Tile } from './types'

/** Manhattan distance: how far a wireless hop is timed (cache hits, JSON retries) and how "nearest" is judged. */
export function routeLength(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(bx - ax) + Math.abs(by - ay)
}

/** transitTicks = clamp(1 + ceil(routeLengthTiles ÷ 2), min, max) (D30). */
export function transitTicksFor(catalog: Catalog, lengthTiles: number): number {
  const ticks = 1 + Math.ceil(lengthTiles / 2)
  return Math.min(catalog.transit.maxTicks, Math.max(catalog.transit.minTicks, ticks))
}

/** Route costs, in tenths of a tile. */
export const ROUTE_COST = {
  /** One tile of tube. */
  step: 10,
  /** Each bend: more than a tile of detour, so a route takes one corner where it can, not a zigzag. */
  bend: 12,
  /**
   * Each unit of grid another tube already runs along. Free: the canvas offsets tubes that share a
   * stretch into lanes (D33), and a bundle reads cleaner than strands spread out to dodge it.
   */
  shared: 0,
  /** Each tile where the route crosses another tube running the other way. */
  cross: 6,
  /** Each tile of another node the route crosses: only when a node is walled in and nothing else reaches it. */
  blocked: 10_000,
} as const

/** What a route has to steer around. */
export interface RouteGrid {
  readonly cols: number
  readonly rows: number
  /** Node id per tile, or −1 (World.occupancy). */
  readonly occupancy: Int32Array
  /** Tubes already planned along each unit segment: index segmentIndex(). */
  readonly used: Int32Array
}

export function createRouteGrid(cols: number, rows: number, occupancy: Int32Array): RouteGrid {
  return { cols, rows, occupancy, used: new Int32Array(cols * rows * 2) }
}

/** The unit segment leaving tile (x, y) to the right (horizontal) or downward (vertical). */
export function segmentIndex(cols: number, x: number, y: number, vertical: boolean): number {
  return (y * cols + x) * 2 + (vertical ? 1 : 0)
}

/** Calls `visit` for every unit segment along a route of corners. */
export function forEachSegment(
  cols: number,
  route: readonly Tile[],
  visit: (segment: number, x: number, y: number, vertical: boolean) => void,
): void {
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]
    const b = route[i]
    const vertical = a.x === b.x
    const from = vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x)
    const to = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x)
    for (let k = from; k < to; k++) {
      const x = vertical ? a.x : k
      const y = vertical ? k : a.y
      visit(segmentIndex(cols, x, y, vertical), x, y, vertical)
    }
  }
}

export function routeTiles(route: readonly Tile[]): number {
  let length = 0
  for (let i = 1; i < route.length; i++) length += routeLength(route[i - 1].x, route[i - 1].y, route[i].x, route[i].y)
  return length
}

/** Drops repeated points and points in the middle of a straight run, leaving the start, the corners and the end. */
export function simplifyRoute(points: readonly Tile[]): Tile[] {
  const out: Tile[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (last !== undefined && last.x === p.x && last.y === p.y) continue
    const prev = out[out.length - 2]
    if (prev !== undefined && last !== undefined && ((prev.x === last.x && last.x === p.x) || (prev.y === last.y && last.y === p.y))) {
      out[out.length - 1] = { x: p.x, y: p.y }
      continue
    }
    out.push({ x: p.x, y: p.y })
  }
  return out
}

/**
 * Does another tube run across tile (x, y) at right angles to a step that is `vertical`? A tube
 * crosses a tile when it uses a unit segment on either side of it in the other direction.
 */
export function crossesAt(grid: RouteGrid, x: number, y: number, vertical: boolean): boolean {
  const { cols, rows, used } = grid
  if (vertical) return (x > 0 && used[segmentIndex(cols, x - 1, y, false)] > 0) || (x < cols - 1 && used[segmentIndex(cols, x, y, false)] > 0)
  return (y > 0 && used[segmentIndex(cols, x, y - 1, true)] > 0) || (y < rows - 1 && used[segmentIndex(cols, x, y, true)] > 0)
}

function isBlocked(grid: RouteGrid, x: number, y: number, from: Tile, to: Tile): boolean {
  if ((x === from.x && y === from.y) || (x === to.x && y === to.y)) return false
  return grid.occupancy[y * grid.cols + x] >= 0
}

/** A route's cost: length, bends, shared grid and blocked tiles (ROUTE_COST). */
export function routeCost(grid: RouteGrid, route: readonly Tile[]): number {
  const from = route[0]
  const to = route[route.length - 1]
  let cost = Math.max(0, route.length - 2) * ROUTE_COST.bend
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]
    const b = route[i]
    const dx = Math.sign(b.x - a.x)
    const dy = Math.sign(b.y - a.y)
    let x = a.x
    let y = a.y
    while (x !== b.x || y !== b.y) {
      const vertical = dy !== 0
      const segment = segmentIndex(grid.cols, vertical ? x : Math.min(x, x + dx), vertical ? Math.min(y, y + dy) : y, vertical)
      x += dx
      y += dy
      cost += ROUTE_COST.step + ROUTE_COST.shared * grid.used[segment]
      if (isBlocked(grid, x, y, from, to)) cost += ROUTE_COST.blocked
      else if (!(x === to.x && y === to.y) && crossesAt(grid, x, y, vertical)) cost += ROUTE_COST.cross
    }
  }
  return cost
}

/**
 * Every route with at most two bends: along x to some column, along y, along x again; or along y
 * to some row, along x, along y again. Both one-bend L's come first, in the preferred order, so
 * they win every tie.
 */
function candidates(grid: RouteGrid, a: Tile, b: Tile, preferVerticalStart: boolean): Tile[][] {
  const xFirst = simplifyRoute([a, { x: b.x, y: a.y }, b])
  const yFirst = simplifyRoute([a, { x: a.x, y: b.y }, b])
  const out = preferVerticalStart ? [yFirst, xFirst] : [xFirst, yFirst]
  for (let c = 0; c < grid.cols; c++) out.push(simplifyRoute([a, { x: c, y: a.y }, { x: c, y: b.y }, b]))
  for (let r = 0; r < grid.rows; r++) out.push(simplifyRoute([a, { x: a.x, y: r }, { x: b.x, y: r }, b]))
  return out
}

/**
 * Cheapest path over the tile grid for boards where no route of two bends or fewer gets around
 * the nodes: Dijkstra over (tile, heading), so bends cost what they cost above.
 */
function searchRoute(grid: RouteGrid, a: Tile, b: Tile): Tile[] {
  const { cols, rows } = grid
  const DX = [1, -1, 0, 0]
  const DY = [0, 0, 1, -1]
  const states = cols * rows * 4
  const best = new Float64Array(states).fill(Infinity)
  const prev = new Int32Array(states).fill(-1)
  const done = new Uint8Array(states)
  // A small binary heap of [cost, state], ties broken by state so the search is deterministic.
  const heap: number[][] = []
  const push = (cost: number, state: number) => {
    heap.push([cost, state])
    let i = heap.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (heap[parent][0] < cost || (heap[parent][0] === cost && heap[parent][1] <= state)) break
      ;[heap[parent], heap[i]] = [heap[i], heap[parent]]
      i = parent
    }
  }
  const pop = (): number[] | undefined => {
    const top = heap[0]
    const last = heap.pop()
    if (heap.length > 0 && last !== undefined) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        const less = (p: number, q: number) => heap[p][0] < heap[q][0] || (heap[p][0] === heap[q][0] && heap[p][1] < heap[q][1])
        if (l < heap.length && less(l, m)) m = l
        if (r < heap.length && less(r, m)) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }

  const start = a.y * cols + a.x
  for (let d = 0; d < 4; d++) {
    const nx = a.x + DX[d]
    const ny = a.y + DY[d]
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
    const vertical = d >= 2
    const segment = segmentIndex(cols, vertical ? nx : Math.min(a.x, nx), vertical ? Math.min(a.y, ny) : ny, vertical)
    const cost = ROUTE_COST.step + ROUTE_COST.shared * grid.used[segment] + (isBlocked(grid, nx, ny, a, b) ? ROUTE_COST.blocked : 0)
    const state = (ny * cols + nx) * 4 + d
    if (cost < best[state]) {
      best[state] = cost
      prev[state] = -1 - start
      push(cost, state)
    }
  }

  let end = -1
  for (let top = pop(); top !== undefined; top = pop()) {
    const [cost, state] = top
    if (done[state] === 1) continue
    done[state] = 1
    const tile = state >> 2
    const heading = state & 3
    const x = tile % cols
    const y = (tile - x) / cols
    if (x === b.x && y === b.y) {
      end = state
      break
    }
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d]
      const ny = y + DY[d]
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
      if ((heading ^ d) === 1 && (heading >> 1) === (d >> 1)) continue // no U-turns
      const vertical = d >= 2
      const segment = segmentIndex(cols, vertical ? nx : Math.min(x, nx), vertical ? Math.min(y, ny) : ny, vertical)
      const step =
        ROUTE_COST.step +
        ROUTE_COST.shared * grid.used[segment] +
        (d !== heading ? ROUTE_COST.bend : 0) +
        (isBlocked(grid, nx, ny, a, b) ? ROUTE_COST.blocked : nx === b.x && ny === b.y ? 0 : crossesAt(grid, nx, ny, vertical) ? ROUTE_COST.cross : 0)
      const next = (ny * cols + nx) * 4 + d
      if (cost + step < best[next]) {
        best[next] = cost + step
        prev[next] = state
        push(cost + step, next)
      }
    }
  }

  if (end < 0) return [a, b]
  const tiles: Tile[] = []
  for (let s = end; ; s = prev[s]) {
    const tile = s >> 2
    tiles.push({ x: tile % cols, y: Math.floor(tile / cols) })
    if (prev[s] < 0) break
  }
  tiles.push(a)
  return simplifyRoute(tiles.reverse())
}

/**
 * The route from a to b, as corners from start to end. Free space gives the classic L along x
 * first, then y; `preferVerticalStart` (a source with several links out) leaves along y first,
 * so a fork splits at the node, as in the hero. Never enters another node's tile unless the
 * target is walled in.
 */
export function planRoute(grid: RouteGrid, a: Tile, b: Tile, preferVerticalStart = false): Tile[] {
  if (a.x === b.x && a.y === b.y) return [{ x: a.x, y: a.y }]
  let best: Tile[] = []
  let bestCost = Infinity
  for (const route of candidates(grid, a, b, preferVerticalStart)) {
    const cost = routeCost(grid, route)
    if (cost < bestCost) {
      best = route
      bestCost = cost
    }
  }
  if (bestCost >= ROUTE_COST.blocked) {
    const searched = searchRoute(grid, a, b)
    if (routeCost(grid, searched) < bestCost) best = searched
  }
  return best
}

/** Marks a planned route's segments as used, so routes planned after it steer clear where they cheaply can. */
export function markRoute(grid: RouteGrid, route: readonly Tile[]): void {
  forEachSegment(grid.cols, route, (segment) => {
    grid.used[segment]++
  })
}
