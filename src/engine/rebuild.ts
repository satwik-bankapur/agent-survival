/*
 * "Retry with this build": lays a finished run's final board onto a fresh
 * engine at 0:00, through ordinary commands, so the new run's command log
 * replays it like any build (D23).
 *
 * Nodes are matched by tile and type. Starting nodes the final board kept
 * stay as they are; starting links and nodes it dropped are removed first;
 * everything else is placed and linked in id order, which keeps routing ties
 * the same as in the original run.
 */

import type { GameEngine } from './GameEngine'
import type { Command } from './types'
import type { World } from './world'

/** Applies `commands` in order, at once. Returns the reason for each one it couldn't apply. */
export function applyCommands(engine: GameEngine, commands: readonly Command[]): string[] {
  const problems: string[] = []
  for (const command of commands) {
    const result = engine.applyNow(command)
    if (!result.ok) problems.push(result.reason)
  }
  return problems
}

/** Applies the final board of `from` to `engine`. Returns the reason for each command it couldn't apply. */
export function rebuildBoard(engine: GameEngine, from: World): string[] {
  const to = engine.world
  const problems: string[] = []
  const apply = (command: Command): number | undefined => {
    const result = engine.applyNow(command)
    if (!result.ok) {
      problems.push(result.reason)
      return undefined
    }
    return result.nodeId
  }
  const sameAt = (x: number, y: number, type: string) => from.nodes.some((n) => n.x === x && n.y === y && n.type === type)
  const idAt = (world: World, x: number, y: number) => world.occupancy[y * world.catalog.board.cols + x]

  // 1. Starting links the final board doesn't have.
  for (const edge of [...to.edges]) {
    const a = to.nodeById[edge.from]
    const b = to.nodeById[edge.to]
    if (a === undefined || b === undefined) continue
    const fa = idAt(from, a.x, a.y)
    const fb = idAt(from, b.x, b.y)
    const kept = from.edges.some((e) => e.from === fa && e.to === fb) && sameAt(a.x, a.y, a.type) && sameAt(b.x, b.y, b.type)
    if (!kept) apply({ type: 'unlink', from: edge.from, to: edge.to })
  }
  // 2. Starting nodes the final board doesn't have.
  for (const node of [...to.nodes]) {
    if (!sameAt(node.x, node.y, node.type)) apply({ type: 'demolish', nodeId: node.id })
  }
  // 3. The final board's other nodes, in the order they were placed.
  const idOf = new Map<number, number>()
  for (const node of from.nodes) {
    const existing = to.nodeById[idAt(to, node.x, node.y)]
    if (existing !== undefined && existing.type === node.type) {
      idOf.set(node.id, existing.id)
      continue
    }
    const id = apply({ type: 'placeNode', nodeType: node.type, x: node.x, y: node.y })
    if (id !== undefined) idOf.set(node.id, id)
  }
  // 4. Its links, in the order they were made.
  for (const edge of from.edges) {
    const a = idOf.get(edge.from)
    const b = idOf.get(edge.to)
    if (a === undefined || b === undefined) continue
    if (to.edges.some((e) => e.from === a && e.to === b)) continue
    apply({ type: 'link', from: a, to: b })
  }
  return problems
}
