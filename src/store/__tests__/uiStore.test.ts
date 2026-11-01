import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GameEngine, replay } from '../../engine'
import { PUBLISH_INTERVAL_MS, connectEngine, useUiStore } from '../uiStore'

describe('uiStore', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('seeds from the engine, then publishes at most once per 250 ms of real time, always ending on the latest', () => {
    const engine = new GameEngine({ seed: 3 })
    for (let t = 0; t < 40; t++) engine.tick()
    const disconnect = connectEngine(engine)
    expect(useUiStore.getState().snapshot.tick).toBe(engine.snapshot.tick)

    let publishes = 0
    const unsubscribe = useUiStore.subscribe(() => publishes++)
    // 4× speed: 16 snapshots in one real second, 62.5 ms apart.
    vi.advanceTimersByTime(PUBLISH_INTERVAL_MS)
    for (let i = 0; i < 16; i++) {
      for (let t = 0; t < 5; t++) engine.tick()
      vi.advanceTimersByTime(62.5)
    }
    vi.advanceTimersByTime(PUBLISH_INTERVAL_MS)
    expect(publishes).toBeGreaterThanOrEqual(4)
    expect(publishes).toBeLessThanOrEqual(5)
    expect(useUiStore.getState().snapshot.tick).toBe(engine.snapshot.tick)

    unsubscribe()
    disconnect()
    expect(engine.onSnapshot).toBeNull()
  })

  it('keeps the "wrong answers seen" flag for the rest of the run once users report one', () => {
    const engine = new GameEngine({ seed: 3 })
    connectEngine(engine)
    expect(useUiStore.getState().wrongAnswersSeen).toBe(false)
    const reported = { ...engine.snapshot.trust.strip[0], wrongReported: 1 }
    const strip = engine.snapshot.trust.strip.map((b, i) => (i === 29 ? reported : b))
    engine.onSnapshot?.({ ...engine.snapshot, trust: { ...engine.snapshot.trust, strip } })
    expect(useUiStore.getState().wrongAnswersSeen).toBe(true)
    vi.advanceTimersByTime(PUBLISH_INTERVAL_MS)
    // Thirty seconds later the report has scrolled off the strip, but the player still knows.
    engine.onSnapshot?.(engine.snapshot)
    vi.advanceTimersByTime(PUBLISH_INTERVAL_MS)
    expect(useUiStore.getState().snapshot).toBe(engine.snapshot)
    expect(useUiStore.getState().wrongAnswersSeen).toBe(true)
  })

  it('sets the engine speed and pause without logging a command', () => {
    const engine = new GameEngine({ seed: 3 })
    connectEngine(engine)
    const { setSpeed } = useUiStore.getState()
    setSpeed(4)
    expect(engine.speed).toBe(4)
    expect(engine.paused).toBe(false)
    setSpeed('paused')
    expect(engine.paused).toBe(true)
    expect(engine.speed).toBe(4)
    setSpeed(1)
    expect(engine.paused).toBe(false)
    expect(engine.speed).toBe(1)
    expect(engine.commandLog).toHaveLength(0)
  })
})

describe('uiStore actions', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    useUiStore.setState({ toasts: [], menuOpen: false, linkFrom: null, selectedCard: null, selectedNodeId: null, tool: 'select' })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("toasts a rejected command with the engine's reason, and an accepted one only when asked", () => {
    const engine = new GameEngine({ seed: 3 })
    const disconnect = connectEngine(engine)
    const usersIn = engine.world.nodes[0]
    const result = useUiStore.getState().dispatch({ type: 'demolish', nodeId: usersIn.id })
    expect(result.ok).toBe(false)
    expect(useUiStore.getState().toasts.map((t) => [t.text, t.tone])).toEqual([["Users in can't be demolished", 'alarm']])

    useUiStore.getState().dispatch({ type: 'placeNode', nodeType: 'SEMANTIC_CACHE', x: 5, y: 3 }, 'Placed.')
    expect(useUiStore.getState().toasts.at(-1)).toMatchObject({ text: 'Placed.', tone: 'info' })
    // The command waits for the next tick, like every command.
    expect(engine.world.nodes).toHaveLength(3)
    engine.tick()
    expect(engine.world.nodes).toHaveLength(4)

    vi.advanceTimersByTime(3000)
    expect(useUiStore.getState().toasts).toEqual([])
    disconnect()
  })

  it('applies commands at once while paused, so a build can be laid out step by step, and replays the same', () => {
    const engine = new GameEngine({ seed: 3 })
    const disconnect = connectEngine(engine)
    for (let t = 0; t < 40; t++) engine.tick()
    const s = () => useUiStore.getState()
    s().setSpeed('paused')
    const placed = s().dispatch({ type: 'placeNode', nodeType: 'SEMANTIC_CACHE', x: 5, y: 3 })
    expect(placed.ok).toBe(true)
    const cache = placed.ok ? placed.nodeId : undefined
    // The next step can use the node at once, and the HUD sees it without a tick.
    const usersIn = engine.world.nodes[0].id
    expect(s().dispatch({ type: 'link', from: usersIn, to: cache ?? -1 }).ok).toBe(true)
    vi.advanceTimersByTime(250)
    expect(s().snapshot.nodes.some((n) => n.id === cache)).toBe(true)
    expect(s().snapshot.money.budget).toBe(500 - 70)
    s().setSpeed(1)
    for (let t = 0; t < 200; t++) engine.tick()
    const again = replay(3, engine.commandLog, engine.tickCount)
    expect(again.world.budget).toBe(engine.world.budget)
    expect(again.world.stats).toEqual(engine.world.stats)
    disconnect()
  })

  it('peels Esc back one layer at a time: menu, link, card, selection, then opens the menu', () => {
    useUiStore.setState({ menuOpen: true, linkFrom: 4, selectedCard: 'cache', selectedNodeId: 2 })
    const esc = () => useUiStore.getState().escape()
    const state = () => {
      const s = useUiStore.getState()
      return [s.menuOpen, s.linkFrom, s.selectedCard, s.selectedNodeId]
    }
    esc()
    expect(state()).toEqual([false, 4, 'cache', 2])
    esc()
    expect(state()).toEqual([false, null, 'cache', 2])
    esc()
    expect(state()).toEqual([false, null, null, 2])
    esc()
    expect(state()).toEqual([false, null, null, null])
    esc()
    expect(state()).toEqual([true, null, null, null])
  })

  it('steps speed through paused, 1×, 2× and 4×, and Space resumes at the last speed', () => {
    const engine = new GameEngine({ seed: 3 })
    const disconnect = connectEngine(engine)
    const s = () => useUiStore.getState()
    s().setSpeed(2)
    s().stepSpeed(1)
    expect(s().speed).toBe(4)
    s().stepSpeed(1)
    expect(s().speed).toBe(4)
    s().togglePause()
    expect(s().speed).toBe('paused')
    expect(engine.paused).toBe(true)
    s().togglePause()
    expect(s().speed).toBe(4)
    s().stepSpeed(-1)
    s().stepSpeed(-1)
    s().stepSpeed(-1)
    expect(s().speed).toBe('paused')
    s().setSpeed(1)
    disconnect()
  })

  /** Runs the engine a snapshot (5 ticks) at a time, publishing each, until `until` holds or `max` snapshots pass. */
  function runSnapshots(engine: GameEngine, max: number, until: () => boolean = () => false): void {
    for (let i = 0; i < max && !until(); i++) {
      for (let t = 0; t < 5; t++) engine.tick()
      vi.advanceTimersByTime(PUBLISH_INTERVAL_MS)
    }
  }

  function showCoach(engine: GameEngine): void {
    runSnapshots(engine, 240, () => useUiStore.getState().coach !== 'waiting')
    expect(useUiStore.getState().coach).toBe('shown')
  }

  it('shows the opening coach mark the first time token spend outruns revenue, and Got it retires it for the run', () => {
    const engine = new GameEngine({ seed: 3 })
    const disconnect = connectEngine(engine)
    expect(useUiStore.getState().coach).toBe('waiting')
    showCoach(engine)
    useUiStore.getState().dismissCoach()
    // The naive board keeps losing money to tokens, but the card never comes back.
    runSnapshots(engine, 40)
    expect(useUiStore.getState().coach).toBe('done')
    disconnect()
  })

  it('retires the coach mark once its advice is taken: a router or cache is on the board', () => {
    const engine = new GameEngine({ seed: 3 })
    const disconnect = connectEngine(engine)
    showCoach(engine)
    expect(engine.applyNow({ type: 'placeNode', nodeType: 'PROMPT_ROUTER', x: 6, y: 4 }).ok).toBe(true)
    runSnapshots(engine, 1)
    expect(useUiStore.getState().coach).toBe('done')
    disconnect()
  })

  it('retires the coach mark once tokens stop outrunning revenue for 3 s, not on one quiet snapshot', () => {
    const engine = new GameEngine({ seed: 3 })
    const disconnect = connectEngine(engine)
    showCoach(engine)
    const frontier = engine.world.nodes.find((n) => n.type === 'FRONTIER_API')
    expect(frontier).toBeDefined()
    // No model, no token spend: the condition clears.
    engine.applyNow({ type: 'demolish', nodeId: frontier?.id ?? -1 })
    runSnapshots(engine, 4)
    expect(useUiStore.getState().coach).toBe('shown')
    // The money rates average 10 s (telemetry), then the condition must hold clear for 3 s more.
    runSnapshots(engine, 80, () => useUiStore.getState().coach === 'done')
    expect(useUiStore.getState().coach).toBe('done')
    disconnect()
  })
})
