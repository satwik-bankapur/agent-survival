/*
 * Test helpers: quiet engines with no traffic, hand-made packets, and a
 * digest of the whole world for determinism checks.
 */

import { makeCatalog, ticksPerSecond, type Catalog, type DeepPartial } from '../catalog'
import { GameEngine } from '../GameEngine'
import { attachScenario, scenarioById } from '../scenarios'
import type { Difficulty, GameNode, NodeType, Packet } from '../types'
import type { World } from '../world'

/** A catalog patched so no traffic arrives: tests feed packets by hand. */
export function quietCatalog(patch: DeepPartial<Catalog> = {}): Catalog {
  return makeCatalog({
    ...patch,
    traffic: { ...patch.traffic, ratePoints: [{ sec: 0, perSec: 0 }], growthPerMinAfter: 0, lateGrowth: { perMin: 0 } },
  })
}

export function quietEngine(patch: DeepPartial<Catalog> = {}, seed = 1): GameEngine {
  return new GameEngine({ seed, catalog: quietCatalog(patch) })
}

export function nodeOfType(world: World, type: NodeType): GameNode {
  const node = world.nodes.find((n) => n.type === type)
  if (node === undefined) throw new Error(`No ${type} on the board`)
  return node
}

/** A fresh chat packet, not yet anywhere. Deadline defaults to the catalog's. */
export function makePacket(world: World, difficulty: Difficulty = 'SIMPLE', deadlineTicks?: number): Packet {
  const index = world.pool.acquire()
  if (index < 0) throw new Error('Pool empty')
  const p = world.pool.packets[index]
  const chat = world.catalog.traffic.chat[difficulty]
  p.difficulty = difficulty
  p.createdTick = world.tick
  p.deadlineTick = world.tick + (deadlineTicks ?? Math.round(chat.deadlineSec * ticksPerSecond(world.catalog)))
  p.newInputTokens = chat.inputTokens
  p.outputTokensGenerated = chat.outputTokens
  return p
}

/** Places a node through a real command and returns it. */
export function place(engine: GameEngine, type: NodeType, x: number, y: number): GameNode {
  const result = engine.applyNow({ type: 'placeNode', nodeType: type, x, y })
  if (!result.ok || result.nodeId === undefined) throw new Error(`Couldn't place ${type}: ${result.ok ? '' : result.reason}`)
  return nodeOfId(engine.world, result.nodeId)
}

export function link(engine: GameEngine, from: GameNode, to: GameNode): void {
  const result = engine.applyNow({ type: 'link', from: from.id, to: to.id })
  if (!result.ok) throw new Error(`Couldn't link: ${result.reason}`)
}

export function unlink(engine: GameEngine, from: GameNode, to: GameNode): void {
  const result = engine.applyNow({ type: 'unlink', from: from.id, to: to.id })
  if (!result.ok) throw new Error(`Couldn't unlink: ${result.reason}`)
}

export function nodeOfId(world: World, id: number): GameNode {
  const node = world.nodeById[id]
  if (node === undefined) throw new Error(`No node ${id}`)
  return node
}

export function ticks(engine: GameEngine, n: number): void {
  for (let i = 0; i < n; i++) engine.tick()
}

/** Everything that defines a run's state, as one comparable string. */
export function digest(world: World): string {
  return JSON.stringify({
    tick: world.tick,
    budget: world.budget,
    trust: [world.trust.s, world.trust.n, world.trust.criticalTicks],
    stats: world.stats,
    rng: [world.rng.traffic.getState(), world.rng.rolls.getState(), world.rng.complaints.getState(), world.rng.director.getState(), world.rng.judge.getState()],
    director: world.director,
    nodes: world.nodes.map((n) => [n.id, n.type, n.queueLength, n.busy, n.lookups, n.processed, n.drops, n.tier, n.spent, n.blocks, Array.from(n.workers)]),
    edges: world.edges.map((e) => [e.id, e.from, e.to, e.length]),
    live: world.pool.liveCount,
    events: world.events.size,
    virtual: world.virtualLength,
    gameOver: world.gameOver,
  })
}

export interface SeenEvent {
  readonly kind: string
  readonly start: number
  readonly end: number
}

/** The director's events in a sandboxed run of a scenario, as announced. */
export function eventsOf(id: string, seed: number, ticksToRun = 6000): SeenEvent[] {
  const scenario = scenarioById(id)
  if (scenario === undefined) throw new Error(id)
  // Sandbox-like: no game over, so the director runs the whole 5:00 on every build.
  const engine = new GameEngine({ seed, catalog: makeCatalog({ sandbox: true }) })
  attachScenario(engine, scenario)
  const seen: SeenEvent[] = []
  let last = -1
  for (let t = 0; t < ticksToRun; t++) {
    engine.tick()
    // Recorded at the announcement: an instant event (a cache wipe) starts and ends in one tick.
    const d = engine.world.director
    if (d.stage === 'announced' && d.startTick !== last && d.kind !== null) {
      last = d.startTick
      seen.push({ kind: d.kind, start: d.startTick, end: d.endTick })
    }
  }
  return seen
}
