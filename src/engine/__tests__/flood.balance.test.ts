import { describe, expect, it } from 'vitest'

import { makeCatalog, ticksPerSecond } from '../catalog'
import { GameEngine } from '../GameEngine'
import { attachScenario, scenarioById } from '../scenarios'
import { Loc } from '../types'

/*
 * The deadlock flood (I-5): the full Milestone 3 build with agent arrivals ×10 from 5:00 to 9:00.
 * Outputs never block (D25) and returns never wait (D26), so nothing can deadlock and no return
 * is ever dropped, however hard the loop is pushed. Checked every tick.
 */

// A sandbox has no game over, so the flood runs to 9:00 whatever it costs.
const FLOOD = makeCatalog({ sandbox: true, traffic: { agent: { share: { fromSec: 300, atSec: 540, reaches: 1, cap: 1 } } } })

function flood(maxStepsOff: boolean): void {
  const scenario = scenarioById(maxStepsOff ? 'p3-no-max-steps' : 'p3-full')
  if (scenario === undefined) throw new Error('No phase 3 scenario')
  const engine = new GameEngine({ seed: 1, catalog: FLOOD })
  attachScenario(engine, scenario)
  const w = engine.world
  const tps = ticksPerSecond(FLOOD)
  const window = 10 * tps
  let windowStartEnded = 0
  let windowStartCalls = 0
  let windowHadRuns = false
  let peakInFlight = 0
  for (let t = 0; t < 540 * tps; t++) {
    engine.tick()
    let inFlight = 0
    for (const node of w.nodes) {
      if (node.type !== 'LANGGRAPH_COORDINATOR') continue
      expect(node.busy).toBeLessThanOrEqual(node.concurrency)
      expect(node.busy).toBeGreaterThanOrEqual(0)
      inFlight += node.busy
    }
    peakInFlight = Math.max(peakInFlight, inFlight)
    // Every live packet is somewhere: nothing leaks out of the pool.
    let placed = 0
    for (const p of w.pool.packets) if (p.loc !== Loc.FREE) placed++
    expect(placed).toBe(w.pool.liveCount)
    expect(w.stats.returnDrops).toBe(0)

    if (t % window === window - 1) {
      const ended = w.stats.agentRuns - inFlight
      // Liveness: while runs were in flight, runs kept ending, or (runaways holding every slot)
      // the loop kept making model calls. A deadlock would do neither.
      if (windowHadRuns) expect(ended > windowStartEnded || w.stats.modelCalls > windowStartCalls).toBe(true)
      if (!maxStepsOff && windowHadRuns) expect(ended).toBeGreaterThan(windowStartEnded)
      windowStartEnded = ended
      windowStartCalls = w.stats.modelCalls
      windowHadRuns = inFlight > 0
    }
  }
  // The 1× phase 3 build runs about 240 tasks by 9:00. With max steps off, runaways end up
  // holding both coordinators' 32 slots, so fewer runs get in: the point is that they filled.
  if (maxStepsOff) expect(peakInFlight).toBe(32)
  else expect(w.stats.agentRuns).toBeGreaterThan(300)
  // Admission control did its job: the overflow was turned away, not dropped.
  expect(w.stats.throttled).toBeGreaterThan(0)
}

describe('agent loop flood, ×10 agent traffic (I-5)', () => {
  it('max steps 5: no deadlock, no dropped return, runs never past the cap', { timeout: 120_000 }, () => flood(false))
  it('max steps off, runaways filling every slot: still no dropped return, the loop stays live', { timeout: 120_000 }, () => flood(true))
})
