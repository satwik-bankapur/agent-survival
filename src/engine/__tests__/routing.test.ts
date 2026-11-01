import { describe, expect, it } from 'vitest'

import { sendOnEdge } from '../EdgeRouter'
import { createRouteGrid, planRoute, routeTiles, transitTicksFor } from '../grid'
import { Rng } from '../rng'
import type { GameEngine } from '../GameEngine'
import type { Edge, NodeType, Tile } from '../types'
import type { World } from '../world'
import { link, makePacket, nodeOfType, place, quietEngine, ticks } from './helpers'

const RICH = { budget: { start: 1_000_000 } }

function emptyGrid(cols = 26, rows = 18) {
  return createRouteGrid(cols, rows, new Int32Array(cols * rows).fill(-1))
}

/** Every tile a route steps on after leaving its start, in order. */
function tilesOf(route: readonly Tile[]): Tile[] {
  const out: Tile[] = []
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]
    const b = route[i]
    const dx = Math.sign(b.x - a.x)
    const dy = Math.sign(b.y - a.y)
    for (let x = a.x, y = a.y; x !== b.x || y !== b.y; ) {
      x += dx
      y += dy
      out.push({ x, y })
    }
  }
  return out
}

/** Node ids a tube passes through, other than the two it links. */
function nodesCrossed(world: World, edge: Edge): number[] {
  const cols = world.catalog.board.cols
  return tilesOf(edge.route)
    .map((t) => world.occupancy[t.y * cols + t.x])
    .filter((id) => id >= 0 && id !== edge.from && id !== edge.to)
}

function edgeBetween(world: World, from: number, to: number): Edge {
  const edge = world.edges.find((e) => e.from === from && e.to === to)
  if (edge === undefined) throw new Error('No such edge')
  return edge
}

/** A crowded board: 14 random nodes, then 40 random link attempts (the valid ones stick). */
function randomBoard(seed: number): World {
  const types: NodeType[] = ['SEMANTIC_CACHE', 'PROMPT_ROUTER', 'FAST_SLM', 'OUTPUT_GUARDRAIL', 'FRONTIER_API']
  const rng = new Rng(seed)
  const engine = quietEngine(RICH, seed)
  const w = engine.world
  const { cols, rows } = w.catalog.board
  for (let i = 0; i < 14; i++) {
    engine.applyNow({ type: 'placeNode', nodeType: types[rng.int(0, types.length - 1)], x: rng.int(0, cols - 1), y: rng.int(0, rows - 1) })
  }
  for (let i = 0; i < 40; i++) {
    const from = w.nodes[rng.int(0, w.nodes.length - 1)]
    const to = w.nodes[rng.int(0, w.nodes.length - 1)]
    engine.applyNow({ type: 'link', from: from.id, to: to.id })
  }
  return w
}

/** How tangled a board's tubes are: bends, tiles of detour past the straight-line distance, and crossings. */
function tangle(w: World): { bends: number; detour: number; worstDetour: number; crossings: number } {
  const cols = w.catalog.board.cols
  const across = new Map<number, number[]>()
  const along = new Map<number, number[]>()
  let bends = 0
  let detour = 0
  let worstDetour = 0
  for (const edge of w.edges) {
    const from = w.nodeById[edge.from]
    const to = w.nodeById[edge.to]
    if (from === undefined || to === undefined) continue
    bends += Math.max(0, edge.route.length - 2)
    const extra = edge.lengthTiles - (Math.abs(to.x - from.x) + Math.abs(to.y - from.y))
    detour += extra
    worstDetour = Math.max(worstDetour, extra)
    // Tiles the tube passes straight through, by direction (its corners and ends don't count).
    for (let i = 1; i < edge.route.length; i++) {
      const a = edge.route[i - 1]
      const b = edge.route[i]
      const map = a.x === b.x ? along : across
      const dx = Math.sign(b.x - a.x)
      const dy = Math.sign(b.y - a.y)
      for (let x = a.x + dx, y = a.y + dy; x !== b.x || y !== b.y; x += dx, y += dy) {
        const key = y * cols + x
        map.set(key, [...(map.get(key) ?? []), edge.id])
      }
    }
  }
  let crossings = 0
  for (const [key, h] of across) for (const a of h) for (const b of along.get(key) ?? []) if (a !== b) crossings++
  return { bends, detour, worstDetour, crossings }
}

describe('route planning (D30)', () => {
  it('is the classic L, x first then y, on a free board', () => {
    expect(planRoute(emptyGrid(), { x: 2, y: 9 }, { x: 5, y: 3 })).toEqual([
      { x: 2, y: 9 },
      { x: 5, y: 9 },
      { x: 5, y: 3 },
    ])
    expect(planRoute(emptyGrid(), { x: 2, y: 9 }, { x: 12, y: 9 })).toEqual([
      { x: 2, y: 9 },
      { x: 12, y: 9 },
    ])
  })

  it('leaves along y first from a node that forks', () => {
    expect(planRoute(emptyGrid(), { x: 8, y: 9 }, { x: 12, y: 6 }, true)).toEqual([
      { x: 8, y: 9 },
      { x: 8, y: 6 },
      { x: 12, y: 6 },
    ])
  })

  it('keeps the L, and its transit, when nothing is in the way', () => {
    const engine = quietEngine(RICH)
    const w = engine.world
    const usersIn = nodeOfType(w, 'USERS_IN')
    const cache = place(engine, 'SEMANTIC_CACHE', 5, 3)
    link(engine, usersIn, cache)
    const edge = edgeBetween(w, usersIn.id, cache.id)
    expect(edge.lengthTiles).toBe(9)
    expect(edge.transitTicks).toBe(transitTicksFor(w.catalog, 9))
  })

  it('steps around a node in the way instead of through it', () => {
    const engine = quietEngine(RICH)
    const w = engine.world
    const usersIn = nodeOfType(w, 'USERS_IN')
    const frontier = nodeOfType(w, 'FRONTIER_API')
    // Straight along row 9 would cross Frontier A at (12, 9).
    const guard = place(engine, 'OUTPUT_GUARDRAIL', 18, 9)
    const slm = place(engine, 'FAST_SLM', 8, 9)
    link(engine, usersIn, slm)
    link(engine, slm, guard)
    const edge = edgeBetween(w, slm.id, guard.id)
    expect(nodesCrossed(w, edge)).toEqual([])
    expect(tilesOf(edge.route)).not.toContainEqual({ x: frontier.x, y: frontier.y })
    // One tile up, across and back down: two tiles longer than the straight run.
    expect(edge.lengthTiles).toBe(12)
  })

  it('reroutes an existing tube when a node is placed on its path', () => {
    const engine = quietEngine(RICH)
    const w = engine.world
    const frontier = nodeOfType(w, 'FRONTIER_API')
    const usersOut = nodeOfType(w, 'USERS_OUT')
    const edge = edgeBetween(w, frontier.id, usersOut.id)
    expect(edge.lengthTiles).toBe(11)
    place(engine, 'SEMANTIC_CACHE', 17, 9)
    expect(nodesCrossed(w, edge)).toEqual([])
    expect(edge.lengthTiles).toBe(13)
    expect(edge.transitTicks).toBe(transitTicksFor(w.catalog, 13))
  })

  it('never passes through a node on random boards', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const w = randomBoard(seed)
      for (const edge of w.edges) {
        const from = w.nodeById[edge.from]
        const to = w.nodeById[edge.to]
        expect(edge.route[0]).toEqual({ x: from?.x, y: from?.y })
        expect(edge.route[edge.route.length - 1]).toEqual({ x: to?.x, y: to?.y })
        expect(nodesCrossed(w, edge), `seed ${seed}, edge ${edge.id}`).toEqual([])
        expect(edge.lengthTiles).toBe(routeTiles(edge.route))
      }
    }
  })

  it('keeps crowded boards tidy: few bends, few crossings, little detour', () => {
    const total = { bends: 0, detour: 0, worstDetour: 0, crossings: 0 }
    for (let seed = 1; seed <= 30; seed++) {
      const t = tangle(randomBoard(seed))
      total.bends += t.bends
      total.detour += t.detour
      total.crossings += t.crossings
      total.worstDetour = Math.max(total.worstDetour, t.worstDetour)
    }
    // Session 6 measured 382 bends and 259 crossings here; the old costs (bend 3, shared 4, no
    // crossing cost) gave 433 and 344 on the same boards, so both bounds catch a regression.
    expect(total.bends).toBeLessThanOrEqual(400)
    expect(total.crossings).toBeLessThanOrEqual(290)
    expect(total.worstDetour).toBeLessThanOrEqual(4)
  })

  it('finds a way into a node behind a wall of nodes', () => {
    const engine = quietEngine(RICH)
    const w = engine.world
    const usersIn = nodeOfType(w, 'USERS_IN')
    // (14, 6) is walled in except from above, and (14, 5) above it only from the right:
    // the way in needs three bends or more, so the grid search finds it.
    for (const [x, y] of [[13, 6], [15, 6], [14, 7], [13, 5], [14, 4]]) place(engine, 'FAST_SLM', x, y)
    const cache = place(engine, 'SEMANTIC_CACHE', 14, 6)
    link(engine, usersIn, cache)
    const edge = edgeBetween(w, usersIn.id, cache.id)
    expect(nodesCrossed(w, edge)).toEqual([])
    expect(edge.route.length).toBeGreaterThan(4)
  })

  it('plans the same routes for the same board', () => {
    const build = (engine: GameEngine) => {
      const w = engine.world
      const usersIn = nodeOfType(w, 'USERS_IN')
      const a = place(engine, 'SEMANTIC_CACHE', 5, 9)
      const b = place(engine, 'PROMPT_ROUTER', 8, 9)
      const c = place(engine, 'FAST_SLM', 12, 6)
      link(engine, usersIn, a)
      link(engine, a, b)
      link(engine, b, c)
      return w.edges.map((e) => e.route)
    }
    expect(build(quietEngine(RICH))).toEqual(build(quietEngine(RICH)))
  })

  it("keeps a packet's transit when its tube is rerouted", () => {
    const engine = quietEngine(RICH)
    const w = engine.world
    const frontier = nodeOfType(w, 'FRONTIER_API')
    const usersOut = nodeOfType(w, 'USERS_OUT')
    const edge = edgeBetween(w, frontier.id, usersOut.id)
    const p = makePacket(w)
    sendOnEdge(w, edge, p)
    const entered = p.transitTicks
    place(engine, 'SEMANTIC_CACHE', 17, 9)
    expect(edge.transitTicks).toBeGreaterThan(entered)
    expect(p.transitTicks).toBe(entered)
    ticks(engine, entered)
    expect(w.stats.served).toBe(0)
    ticks(engine, 1)
    expect(w.stats.served).toBe(1)
  })
})
