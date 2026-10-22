import { describe, expect, it } from 'vitest'

import { GameEngine } from '../GameEngine'
import { buildPostmortem, firstProfitableSecond } from '../postmortem'
import { rebuildBoard } from '../rebuild'
import { RUN_LOG_SECONDS } from '../runLog'
import { classicCatalog } from '../catalog'
import { attachScenario, catalogFor, scenarioById } from '../scenarios'
import { digest } from './helpers'

/** Runs a scripted build until the run ends, or ends it at `endSec`. */
function finish(id: string, seed = 1, endSec = 15 * 60): GameEngine {
  const scenario = scenarioById(id)
  if (scenario === undefined) throw new Error(`No scenario ${id}`)
  const engine = new GameEngine({ seed, catalog: catalogFor(scenario) })
  attachScenario(engine, scenario)
  for (let t = 0; t < endSec * 20 && engine.world.gameOver === null; t++) engine.tick()
  if (engine.world.gameOver === null) engine.applyNow({ type: 'endRun' })
  return engine
}

describe('run log', () => {
  it('samples budget and trust once a second, and marks placements, the first complaint and trust going critical', () => {
    const engine = finish('naive-to-full', 2, 200)
    const log = engine.world.runLog
    expect(log.seconds).toBe(200)
    expect(log.budget[0]).toBe(500)
    expect(log.trust[0]).toBe(100)
    expect(log.markers.filter((m) => m.kind === 'PLACED').length).toBeGreaterThan(0)
    expect(log.markers.filter((m) => m.kind === 'FIRST_COMPLAINT').length).toBeLessThanOrEqual(1)
    expect(RUN_LOG_SECONDS).toBe(3600)
  })

  it('credits answers to the model that wrote them, and wrong ones only in its tally', () => {
    const engine = finish('all-slm', 1)
    const slm = engine.world.runLog.tallies.find((t) => t?.type === 'FAST_SLM')
    expect(slm).toBeDefined()
    expect((slm?.simpleServed ?? 0) + (slm?.complexServed ?? 0)).toBe(engine.world.stats.served)
    expect(slm?.wrongServed).toBe(engine.world.stats.wrongServed)
  })
})

describe('endRun', () => {
  it('ends the run as ENDED, is logged, and replays', () => {
    const engine = new GameEngine({ seed: 4 })
    for (let t = 0; t < 100; t++) engine.tick()
    expect(engine.dispatch({ type: 'endRun' }).ok).toBe(true)
    engine.tick()
    expect(engine.world.gameOver).toEqual({ cause: 'ENDED', tick: 100 })
    expect(engine.commandLog.at(-1)).toEqual({ tick: 100, command: { type: 'endRun' } })
    expect(engine.dispatch({ type: 'endRun' })).toEqual({ ok: false, reason: 'The run is over' })
  })
})

describe('postmortem rules', () => {
  it('blames the naive board on Frontier A answering simple chats at a loss', () => {
    const pm = buildPostmortem(finish('naive').world)
    expect(pm.cause).toBe('BANKRUPT')
    expect(pm.headline).toMatch(/^The budget hit −\$1,000\. The run ended at 4:\d\d, in the knowledge crisis\.$/)
    expect(pm.rootCause).toMatch(/^Frontier A answered [\d,]+ simple chats at a loss of about \$1\.20 each\./)
    expect(pm.actions.map((a) => a.nodeType)).toEqual(['FAST_SLM', 'PROMPT_ROUTER', 'OUTPUT_GUARDRAIL'])
    expect(pm.worst?.text).toMatch(/^Frontier A, −\$[\d,]+ on tokens$/)
  })

  it('blames all Fast SLM on wrong answers to complex questions, with no router or guardrail', () => {
    const pm = buildPostmortem(finish('all-slm').world)
    expect(pm.cause).toBe('TRUST')
    expect(pm.rootCause).toMatch(/^Fast SLM answered 100% of complex questions\./)
    expect(pm.factors).toContain('No prompt router, so hard questions went to the small model.')
    expect(pm.actions.map((a) => a.nodeType).slice(0, 2)).toEqual(['PROMPT_ROUTER', 'OUTPUT_GUARDRAIL'])
  })

  it('blames a trust collapse on what failed just before it, not over the whole run', () => {
    const pm = buildPostmortem(finish('full').world)
    expect(pm.cause).toBe('TRUST')
    expect(pm.rootCause).toMatch(/Frontier A/)
    expect(pm.wentWell).toContain('The semantic cache answered 41% of simple chats.')
  })

  it('ends a healthy run by choice with nothing failing', () => {
    const pm = buildPostmortem(finish('full', 1, 100).world)
    expect(pm.cause).toBe('ENDED')
    expect(pm.headline).toBe('You ended the run at 1:40, in the wrapper startup.')
    expect(pm.markers.at(-1)).toEqual({ sec: 100, text: '1:40 run ended', alarm: false })
  })

  it('draws the timeline: a sample a second plus the end, and markers in time order', () => {
    const engine = finish('naive')
    const pm = buildPostmortem(engine.world)
    expect(pm.budget.length).toBe(engine.world.runLog.seconds + 1)
    expect(pm.trust.length).toBe(pm.budget.length)
    expect(pm.markers.map((m) => m.sec)).toEqual([...pm.markers.map((m) => m.sec)].sort((a, b) => a - b))
    expect(pm.markers.some((m) => m.text === '3:30 viral spike')).toBe(true)
  })

  it('finds where the budget started climbing for good', () => {
    expect(firstProfitableSecond([500, 400, 300, 350, 420])).toBe(2)
    expect(firstProfitableSecond([500, 400, 300])).toBe(null)
  })
})

describe('retry with this build', () => {
  it('lays the final board onto a fresh run at 0:00', () => {
    const done = finish('full', 3, 60)
    const fresh = new GameEngine({ seed: 3, catalog: classicCatalog() })
    expect(rebuildBoard(fresh, done.world)).toEqual([])
    const shape = (e: GameEngine) => ({
      nodes: e.world.nodes.map((n) => [n.type, n.x, n.y, n.label]),
      edges: e.world.edges.map((x) => {
        const a = e.world.nodeById[x.from]
        const b = e.world.nodeById[x.to]
        return [a?.x, a?.y, b?.x, b?.y]
      }),
    })
    expect(shape(fresh)).toEqual(shape(done))
    expect(fresh.world.tick).toBe(0)
    // Its command log replays it like any build.
    const again = new GameEngine({ seed: 3, catalog: fresh.world.catalog })
    for (const c of fresh.commandLog) again.applyNow(c.command)
    for (let t = 0; t < 200; t++) {
      fresh.tick()
      again.tick()
    }
    expect(digest(again.world)).toBe(digest(fresh.world))
  })
})
