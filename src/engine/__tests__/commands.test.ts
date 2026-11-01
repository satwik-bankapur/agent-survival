import { describe, expect, it } from 'vitest'

import { LOOP_REASON, planLink } from '../commands'
import { DEFAULT_CATALOG } from '../catalog'
import { sendOnEdge } from '../EdgeRouter'
import { transitTicksFor } from '../grid'
import { enqueue } from '../nodes/pipeline'
import { link, makePacket, nodeOfType, place, quietEngine } from './helpers'

function board() {
  const engine = quietEngine()
  const w = engine.world
  return {
    engine,
    w,
    usersIn: nodeOfType(w, 'USERS_IN'),
    usersOut: nodeOfType(w, 'USERS_OUT'),
    frontier: nodeOfType(w, 'FRONTIER_API'),
  }
}

describe('starting board', () => {
  it('is Users in → Frontier A → Users out, already linked, with $500', () => {
    const { w, usersIn, frontier, usersOut } = board()
    expect(w.nodes.map((n) => n.label)).toEqual(['Users in', 'Frontier A', 'Users out'])
    expect(w.edges.map((e) => [e.from, e.to])).toEqual([
      [usersIn.id, frontier.id],
      [frontier.id, usersOut.id],
    ])
    expect(w.budget).toBe(500)
  })
})

describe('placeNode', () => {
  it('places a node, charges its build cost and names it', () => {
    const { engine, w } = board()
    const result = engine.applyNow({ type: 'placeNode', nodeType: 'PROMPT_ROUTER', x: 8, y: 9 })
    expect(result.ok).toBe(true)
    expect(w.budget).toBe(435)
    expect(w.nodes.at(-1)?.label).toBe('Prompt router')
  })

  it('numbers a type only once there are two, and never reuses a number', () => {
    const { engine, w } = board()
    const place = (x: number, y: number) => {
      const result = engine.applyNow({ type: 'placeNode', nodeType: 'FAST_SLM', x, y })
      if (!result.ok || result.nodeId === undefined) throw new Error('not placed')
      return result.nodeId
    }
    const labels = () => w.nodes.filter((n) => n.type === 'FAST_SLM').map((n) => n.label)
    const first = place(8, 4)
    expect(labels()).toEqual(['Fast SLM'])
    place(8, 6)
    expect(labels()).toEqual(['Fast SLM 1', 'Fast SLM 2'])
    expect(engine.applyNow({ type: 'demolish', nodeId: first }).ok).toBe(true)
    expect(labels()).toEqual(['Fast SLM'])
    place(8, 12)
    expect(labels()).toEqual(['Fast SLM 2', 'Fast SLM 3'])
    expect(engine.snapshot.nodes.length).toBeGreaterThan(0)
  })

  it.each([
    [{ x: 26, y: 0 }, 'Off the mat'],
    [{ x: -1, y: 4 }, 'Off the mat'],
    [{ x: 3, y: 18 }, 'Off the mat'],
    [{ x: 2.5, y: 4 }, 'Off the mat'],
    [{ x: 2, y: 9 }, 'Tile occupied'],
  ])('rejects %o with "%s"', (tile, reason) => {
    const { engine } = board()
    expect(engine.dispatch({ type: 'placeNode', nodeType: 'FAST_SLM', ...tile })).toEqual({ ok: false, reason })
  })

  it('rejects pre-placed types', () => {
    const { engine } = board()
    expect(engine.dispatch({ type: 'placeNode', nodeType: 'USERS_OUT', x: 4, y: 4 })).toEqual({
      ok: false,
      reason: 'Users out is pre-placed',
    })
  })

  it('applies a dispatched command at the start of the next tick, not before', () => {
    const { engine, w } = board()
    expect(engine.dispatch({ type: 'placeNode', nodeType: 'FAST_SLM', x: 14, y: 8 })).toEqual({ ok: true })
    expect(w.nodes).toHaveLength(3)
    engine.tick()
    expect(w.nodes).toHaveLength(4)
  })

  it('re-validates at apply time', () => {
    const { engine, w } = board()
    engine.dispatch({ type: 'placeNode', nodeType: 'FAST_SLM', x: 14, y: 8 })
    engine.dispatch({ type: 'placeNode', nodeType: 'SEMANTIC_CACHE', x: 14, y: 8 })
    engine.tick()
    expect(w.nodes.filter((n) => n.x === 14 && n.y === 8)).toHaveLength(1)
    expect(engine.commandLog).toHaveLength(1)
  })
})

describe('demolish', () => {
  it("can't demolish Users in or Users out", () => {
    const { engine, usersIn, usersOut } = board()
    expect(engine.dispatch({ type: 'demolish', nodeId: usersIn.id })).toEqual({
      ok: false,
      reason: "Users in can't be demolished",
    })
    expect(engine.dispatch({ type: 'demolish', nodeId: usersOut.id })).toEqual({
      ok: false,
      reason: "Users out can't be demolished",
    })
    expect(engine.dispatch({ type: 'demolish', nodeId: 999 })).toEqual({ ok: false, reason: 'No such node' })
  })

  it('removes the node and its links, frees its tile, and loses what was inside', () => {
    const { engine, w, frontier } = board()
    enqueue(frontier, makePacket(w))
    sendOnEdge(w, w.edges[0], makePacket(w))
    expect(engine.applyNow({ type: 'demolish', nodeId: frontier.id })).toEqual({ ok: true })
    expect(w.nodes.map((n) => n.type)).toEqual(['USERS_IN', 'USERS_OUT'])
    expect(w.edges).toHaveLength(0)
    expect(w.stats.demolishedDrops).toBe(2)
    expect(w.pool.liveCount).toBe(0)
    expect(w.incidents.entries.at(-1)?.text).toBe('Demolished Frontier A. 2 prompts were lost.')
    expect(engine.applyNow({ type: 'placeNode', nodeType: 'FAST_SLM', x: frontier.x, y: frontier.y }).ok).toBe(true)
  })
})

describe('link and unlink', () => {
  it('links nodes the connection table allows, with D30 transit from the L-shaped route', () => {
    const { engine, w, usersIn } = board()
    const cache = place(engine, 'SEMANTIC_CACHE', 5, 3)
    const result = engine.applyNow({ type: 'link', from: usersIn.id, to: cache.id })
    expect(result.ok).toBe(true)
    // (2, 9) → (5, 3): 3 + 6 = 9 tiles, so 1 + ceil(9 ÷ 2) = 6 ticks.
    const edge = w.edges.at(-1)
    expect(edge?.lengthTiles).toBe(9)
    expect(edge?.transitTicks).toBe(6)
  })

  it('clamps transit between 2 and 8 ticks (D30)', () => {
    expect([0, 1, 2, 3, 4, 13, 14, 40].map((n) => transitTicksFor(DEFAULT_CATALOG, n))).toEqual([2, 2, 2, 3, 3, 8, 8, 8])
  })

  it.each([
    ['FAST_SLM', 'PROMPT_ROUTER', "Fast SLM can't send to Prompt router"],
    ['OUTPUT_GUARDRAIL', 'FAST_SLM', "Output guardrail can't send to Fast SLM"],
    ['PROMPT_ROUTER', 'USERS_OUT', "Prompt router can't send to Users out"],
  ] as const)('rejects %s → %s', (fromType, toType, reason) => {
    const { engine, w } = board()
    const from = fromType === 'PROMPT_ROUTER' ? place(engine, fromType, 8, 9) : place(engine, fromType, 8, 3)
    const to = toType === 'USERS_OUT' ? nodeOfType(w, 'USERS_OUT') : place(engine, toType, 10, 3)
    expect(engine.dispatch({ type: 'link', from: from.id, to: to.id })).toEqual({ ok: false, reason })
  })

  it('rejects self-links, duplicates and unknown nodes', () => {
    const { engine, usersIn, frontier } = board()
    expect(engine.dispatch({ type: 'link', from: frontier.id, to: frontier.id })).toEqual({
      ok: false,
      reason: "Can't link a node to itself",
    })
    expect(engine.dispatch({ type: 'link', from: usersIn.id, to: frontier.id })).toEqual({
      ok: false,
      reason: 'Already linked',
    })
    expect(engine.dispatch({ type: 'link', from: usersIn.id, to: 999 })).toEqual({ ok: false, reason: 'No such node' })
  })

  it('rejects a link that closes a loop (D27)', () => {
    const { engine } = board()
    const cache = place(engine, 'SEMANTIC_CACHE', 5, 9)
    const router = place(engine, 'PROMPT_ROUTER', 8, 9)
    link(engine, cache, router)
    expect(engine.dispatch({ type: 'link', from: router.id, to: cache.id })).toEqual({ ok: false, reason: LOOP_REASON })
    expect(LOOP_REASON).toBe('Loops are only allowed through the agent coordinator')
  })

  it('unlinks, losing what was in the tube', () => {
    const { engine, w, usersIn, frontier } = board()
    sendOnEdge(w, w.edges[0], makePacket(w))
    expect(engine.applyNow({ type: 'unlink', from: usersIn.id, to: frontier.id })).toEqual({ ok: true })
    expect(w.edges).toHaveLength(1)
    expect(usersIn.outEdges).toHaveLength(0)
    expect(w.stats.demolishedDrops).toBe(1)
    expect(engine.dispatch({ type: 'unlink', from: usersIn.id, to: frontier.id })).toEqual({ ok: false, reason: 'Not linked' })
  })
})

describe('planLink: the link tool', () => {
  it('keeps a link that is valid as clicked', () => {
    const { engine, w, usersIn } = board()
    const router = place(engine, 'PROMPT_ROUTER', 8, 3)
    expect(planLink(w, usersIn.id, router.id)).toEqual({ ok: true, from: usersIn.id, to: router.id, flipped: false })
  })

  it('flips a link clicked against the flow: Router → Users in becomes Users in → Router', () => {
    const { engine, w, usersIn } = board()
    const router = place(engine, 'PROMPT_ROUTER', 8, 3)
    expect(planLink(w, router.id, usersIn.id)).toEqual({ ok: true, from: usersIn.id, to: router.id, flipped: true })
  })

  it('flips Users out → Fast SLM into Fast SLM → Users out', () => {
    const { engine, w, usersOut } = board()
    const slm = place(engine, 'FAST_SLM', 8, 3)
    expect(planLink(w, usersOut.id, slm.id)).toEqual({ ok: true, from: slm.id, to: usersOut.id, flipped: true })
  })

  it('explains in plain words when neither way is allowed', () => {
    const { engine, w, usersOut } = board()
    const router = place(engine, 'PROMPT_ROUTER', 8, 3)
    const guardrail = place(engine, 'OUTPUT_GUARDRAIL', 10, 3)
    const cache = place(engine, 'SEMANTIC_CACHE', 12, 3)
    expect(planLink(w, router.id, usersOut.id)).toEqual({
      ok: false,
      reason:
        "Prompt router and Users out can't be linked either way: a router sends to a cache, a vector DB, BM25, a coordinator or a model, and Users out takes from a model, the guardrail or a coordinator.",
    })
    expect(planLink(w, guardrail.id, cache.id)).toEqual({
      ok: false,
      reason:
        "Output guardrail and Semantic cache can't be linked either way: the guardrail sends to Users out, and a cache takes from Users in, a firewall, a redactor or a router.",
    })
  })

  it('never flips a loop, a self-link or a duplicate', () => {
    const { engine, w, usersIn, frontier } = board()
    const cache = place(engine, 'SEMANTIC_CACHE', 5, 9)
    const router = place(engine, 'PROMPT_ROUTER', 8, 9)
    link(engine, cache, router)
    expect(planLink(w, router.id, cache.id)).toEqual({ ok: false, reason: LOOP_REASON })
    expect(planLink(w, frontier.id, frontier.id)).toEqual({ ok: false, reason: "Can't link a node to itself" })
    expect(planLink(w, usersIn.id, frontier.id)).toEqual({ ok: false, reason: 'Already linked' })
    expect(planLink(w, frontier.id, usersIn.id)).toEqual({ ok: false, reason: 'Already linked the other way, Users in to Frontier A' })
  })
})

describe('setSetting', () => {
  it('rejects settings no Milestone 1 node has', () => {
    const { engine, frontier } = board()
    expect(engine.dispatch({ type: 'setSetting', nodeId: frontier.id, key: 'strictness', value: 'loose' })).toEqual({
      ok: false,
      reason: 'Frontier A has no setting called "strictness"',
    })
  })
})

describe('after game over', () => {
  it('rejects every command', () => {
    const { engine, w } = board()
    w.budget = -1000
    engine.tick()
    expect(engine.dispatch({ type: 'placeNode', nodeType: 'FAST_SLM', x: 14, y: 8 })).toEqual({
      ok: false,
      reason: 'The run is over',
    })
  })
})
