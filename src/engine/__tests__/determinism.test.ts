import { describe, expect, it } from 'vitest'

import { classicCatalog } from '../catalog'
import { GameEngine, replay } from '../GameEngine'
import { attachScenario, catalogFor, scenarioById } from '../scenarios'
import type { Command, CommandResult, NodeType, TelemetrySnapshot } from '../types'
import { digest } from './helpers'

function scenario(id: string) {
  const found = scenarioById(id)
  if (found === undefined) throw new Error(id)
  return found
}

/** A run with a scripted build plus a few mid-run player commands through dispatch. */
const CLASSIC = classicCatalog()

function playedRun(seed: number): GameEngine {
  const engine = new GameEngine({ seed, catalog: CLASSIC })
  attachScenario(engine, scenario('naive-to-full'))
  for (let t = 0; t < 6000; t++) {
    if (t === 1500) engine.dispatch({ type: 'placeNode', nodeType: 'FAST_SLM', x: 14, y: 12 })
    // Node 4 is the Fast SLM dispatched at tick 1500 (1 to 3 are the starting board).
    if (t === 4000) expect(engine.dispatch({ type: 'demolish', nodeId: 4 })).toEqual({ ok: true })
    engine.tick()
  }
  return engine
}

/**
 * A run played the way the board plays it: while paused, a command applies at once and the
 * snapshot is rebuilt (uiStore's dispatch); otherwise it's queued for the next tick.
 */
function builtWhilePaused(seed: number): GameEngine {
  const engine = new GameEngine({ seed, catalog: CLASSIC })
  const send = (command: Command): CommandResult => {
    const result = engine.paused ? engine.applyNow(command) : engine.dispatch(command)
    if (!result.ok) throw new Error(`${command.type} failed: ${result.reason}`)
    if (engine.paused) engine.refreshSnapshot()
    return result
  }
  const place = (nodeType: NodeType, x: number, y: number): number => {
    const result = send({ type: 'placeNode', nodeType, x, y })
    return result.ok && result.nodeId !== undefined ? result.nodeId : -1
  }
  const [usersIn, frontier, usersOut] = engine.world.nodes.map((n) => n.id)
  let guard = -1
  let slm = -1
  let router = -1

  for (let t = 0; t < 6000; t++) {
    if (t === 0) {
      // Paused before the first tick: the full build, one step at a time.
      engine.paused = true
      router = place('PROMPT_ROUTER', 8, 9)
      send({ type: 'unlink', from: usersIn, to: frontier })
      send({ type: 'link', from: usersIn, to: router })
      slm = place('FAST_SLM', 12, 6)
      send({ type: 'link', from: router, to: slm })
      send({ type: 'link', from: router, to: frontier })
      guard = place('OUTPUT_GUARDRAIL', 17, 9)
      send({ type: 'link', from: slm, to: guard })
      send({ type: 'link', from: frontier, to: guard })
      send({ type: 'unlink', from: frontier, to: usersOut })
      send({ type: 'link', from: guard, to: usersOut })
      engine.paused = false
    }
    if (t === 1200) {
      // On a second boundary, where the economy and trust seconds begin: add the cache paused,
      // then resume and queue one more command for the same tick.
      engine.paused = true
      const cache = place('SEMANTIC_CACHE', 5, 9)
      send({ type: 'unlink', from: usersIn, to: router })
      send({ type: 'link', from: usersIn, to: cache })
      send({ type: 'link', from: cache, to: router })
      engine.paused = false
      place('FAST_SLM', 12, 3)
    }
    if (t === 2713) {
      // Off a boundary: demolish the guardrail and relink around it, paused.
      engine.paused = true
      send({ type: 'demolish', nodeId: guard })
      send({ type: 'link', from: slm, to: usersOut })
      send({ type: 'link', from: frontier, to: usersOut })
      engine.paused = false
    }
    engine.tick()
  }
  return engine
}

describe('determinism (D23)', () => {
  it('gives identical state after 6,000 ticks for the same seed and commands', () => {
    const a = playedRun(1234)
    const b = playedRun(1234)
    expect(a.world.tick).toBe(6000)
    expect(digest(a.world)).toBe(digest(b.world))
    expect(a.snapshot).toEqual(b.snapshot)
  })

  it('replays a run exactly from its seed and command log', () => {
    const original = playedRun(77)
    expect(original.commandLog.length).toBeGreaterThan(10)
    const replayed = replay(77, original.commandLog, 6000, CLASSIC)
    expect(digest(replayed.world)).toBe(digest(original.world))
    expect(replayed.snapshot).toEqual(original.snapshot)
  })

  it('replays a run built while paused exactly from its seed and command log', () => {
    const original = builtWhilePaused(99)
    expect(original.world.tick).toBe(6000)
    expect(original.world.gameOver).toBeNull()
    expect(original.commandLog.length).toBe(19)
    const replayed = replay(99, original.commandLog, 6000, CLASSIC)
    expect(digest(replayed.world)).toBe(digest(original.world))
    expect(replayed.snapshot).toEqual(original.snapshot)
  })

  it('replays a phase 2 run, director, settings and all, from its seed and command log', () => {
    const p2 = scenario('p2-upgrade')
    const original = new GameEngine({ seed: 13, catalog: catalogFor(p2) })
    attachScenario(original, p2)
    for (let t = 0; t < 6000; t++) original.tick()
    expect(original.commandLog.some((c) => c.command.type === 'setSetting')).toBe(true)
    expect(original.world.runLog.markers.some((m) => m.kind === 'EVENT')).toBe(true)
    const replayed = replay(13, original.commandLog, 6000, catalogFor(p2))
    expect(digest(replayed.world)).toBe(digest(original.world))
    expect(replayed.snapshot).toEqual(original.snapshot)
  })

  it('logs each command with the tick it applied at', () => {
    const engine = new GameEngine({ seed: 1 })
    for (let t = 0; t < 10; t++) engine.tick()
    engine.dispatch({ type: 'placeNode', nodeType: 'FAST_SLM', x: 5, y: 5 })
    engine.tick()
    expect(engine.commandLog).toEqual([{ tick: 10, command: { type: 'placeNode', nodeType: 'FAST_SLM', x: 5, y: 5 } }])
  })

  it('gives different runs for different seeds', () => {
    const a = new GameEngine({ seed: 1 })
    const b = new GameEngine({ seed: 2 })
    for (let t = 0; t < 600; t++) {
      a.tick()
      b.tick()
    }
    expect(digest(a.world)).not.toBe(digest(b.world))
  })

  it('keeps the same traffic whatever the build', () => {
    // Traffic has its own RNG stream, so two builds see the same prompts arrive.
    const naive = new GameEngine({ seed: 5 })
    const full = new GameEngine({ seed: 5 })
    attachScenario(full, scenario('full'))
    for (let t = 0; t < 2000; t++) {
      naive.tick()
      full.tick()
    }
    expect(full.world.stats.arrivals).toBe(naive.world.stats.arrivals)
    expect(full.world.rng.traffic.getState()).toBe(naive.world.rng.traffic.getState())
  })
})

describe('step() and the frame guards (D35)', () => {
  it('runs one tick per 50 ms of game time and exposes alpha', () => {
    const engine = new GameEngine({ seed: 1 })
    engine.step(120)
    expect(engine.tickCount).toBe(2)
    expect(engine.alpha).toBeCloseTo(0.4, 10)
  })

  it('scales by speed, clamps a long frame to 250 ms, and caps ticks per frame', () => {
    const engine = new GameEngine({ seed: 1 })
    engine.speed = 4
    engine.step(10_000)
    // 250 ms × 4 = 1,000 ms = 20 ticks, under the 40-tick cap.
    expect(engine.tickCount).toBe(20)
    const capped = new GameEngine({ seed: 1 })
    capped.speed = 16
    capped.step(250)
    expect(capped.tickCount).toBe(40)
    expect(capped.alpha).toBeLessThan(1)
  })

  it('does nothing while paused', () => {
    const engine = new GameEngine({ seed: 1 })
    engine.paused = true
    engine.step(200)
    expect(engine.tickCount).toBe(0)
  })

  it('pushes a snapshot four times a second', () => {
    const engine = new GameEngine({ seed: 1 })
    const seen: TelemetrySnapshot[] = []
    engine.onSnapshot = (s) => seen.push(s)
    for (let t = 0; t < 40; t++) engine.tick()
    expect(seen.map((s) => s.tick)).toEqual([0, 5, 10, 15, 20, 25, 30, 35])
  })
})
