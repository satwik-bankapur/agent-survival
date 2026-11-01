/*
 * Share links: what goes in comes out, a hostile link doesn't, and a decoded
 * log lays the same board down on a fresh engine (which is the whole promise).
 */

import { describe, expect, it } from 'vitest'

import { applyCommands, GameEngine, type Command, type LoggedCommand } from '../engine'
import { decodeShare, encodeShare } from '../share'

/** A free tile for a 1×1 node, so the test doesn't depend on the starting board's layout. */
function freeTile(engine: GameEngine): { x: number; y: number } {
  const { cols, rows } = engine.world.catalog.board
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (engine.check({ type: 'placeNode', nodeType: 'SEMANTIC_CACHE', x, y }).ok) return { x, y }
    }
  }
  throw new Error('no free tile')
}

function buildLog(): LoggedCommand[] {
  const engine = new GameEngine({ seed: 7 })
  const { x, y } = freeTile(engine)
  engine.applyNow({ type: 'placeNode', nodeType: 'SEMANTIC_CACHE', x, y })
  const users = engine.world.nodes.find((n) => n.type === 'USERS_IN')
  const cache = engine.world.nodes.find((n) => n.type === 'SEMANTIC_CACHE')
  if (users === undefined || cache === undefined) throw new Error('no board')
  engine.applyNow({ type: 'link', from: users.id, to: cache.id })
  engine.applyNow({ type: 'setSetting', nodeId: cache.id, key: 'strictness', value: 'STRICT' })
  return [...engine.commandLog]
}

describe('share links', () => {
  it('round-trips a seed and its command log', async () => {
    const run = { seed: 0xabcdef, log: buildLog() }
    const back = await decodeShare(await encodeShare(run))
    expect(back).toEqual(run)
  })

  it('lays the same board down on a fresh engine', async () => {
    const log = buildLog()
    const back = await decodeShare(await encodeShare({ seed: 7, log }))
    expect(back).not.toBeNull()
    const engine = new GameEngine({ seed: 7 })
    const problems = applyCommands(
      engine,
      (back?.log ?? []).map((e) => e.command),
    )
    expect(problems).toEqual([])
    expect(board(engine)).toEqual(board(applyBoard(log)))
  })

  it('refuses a link that isn\'t one', async () => {
    expect(await decodeShare('')).toBeNull()
    expect(await decodeShare('not base64url!')).toBeNull()
    expect(await decodeShare('AAAA')).toBeNull()
  })

  it('refuses a log with a command the game has no name for', async () => {
    const code = await encodeShare({ seed: 1, log: [{ tick: 0, command: { type: 'drop-the-database' } as unknown as Command }] })
    expect(await decodeShare(code)).toBeNull()
  })

  it('refuses a seed outside the engine\'s range', async () => {
    const code = await encodeShare({ seed: 2 ** 30, log: [] })
    expect(await decodeShare(code)).toBeNull()
  })
})

/** A fresh engine with the original log applied, for comparison. */
function applyBoard(log: readonly LoggedCommand[]): GameEngine {
  const engine = new GameEngine({ seed: 7 })
  applyCommands(
    engine,
    log.map((e) => e.command),
  )
  return engine
}

/** What a board is, for the purposes of "the same board": its nodes and its links. */
function board(engine: GameEngine) {
  return {
    nodes: engine.world.nodes.map((n) => [n.type, n.x, n.y]),
    edges: engine.world.edges.map((e) => [engine.world.nodeById[e.from]?.type, engine.world.nodeById[e.to]?.type]),
  }
}
