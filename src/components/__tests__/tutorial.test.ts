/*
 * The guided first run: each step waits for the thing it asked for, and the
 * card sits beside what it points at.
 */

import { describe, expect, it } from 'vitest'

import type { NodeType } from '../../engine'
import { cardSpot, linkKey, nextStep, TUTORIAL, type TutorialBoard, type TutorialEvent } from '../tutorial'

const EMPTY: TutorialBoard = { types: new Set(), links: new Set() }

function boardWith(types: NodeType[], links: [NodeType, NodeType][]): TutorialBoard {
  return { types: new Set(types), links: new Set(links.map(([a, b]) => linkKey(a, b))) }
}

/** The event that gets past each step, in order. */
const PASSES: readonly TutorialEvent[] = [
  { kind: 'speed', speed: 'paused' },
  { kind: 'ack' },
  { kind: 'command', command: { type: 'placeNode', nodeType: 'SEMANTIC_CACHE', x: 1, y: 1 } },
  { kind: 'command', command: { type: 'unlink', from: 1, to: 2 }, from: 'USERS_IN', to: 'FRONTIER_API' },
  { kind: 'command', command: { type: 'link', from: 1, to: 3 }, from: 'USERS_IN', to: 'SEMANTIC_CACHE' },
  { kind: 'command', command: { type: 'link', from: 4, to: 2 }, from: 'PROMPT_ROUTER', to: 'FRONTIER_API' },
  { kind: 'speed', speed: 1 },
]

/** The board each step needs, for the two steps that ask for more than one action. */
const BOARDS: readonly TutorialBoard[] = TUTORIAL.map((step) => {
  if (step.id === 'link') {
    return boardWith(['SEMANTIC_CACHE'], [
      ['USERS_IN', 'SEMANTIC_CACHE'],
      ['SEMANTIC_CACHE', 'FRONTIER_API'],
    ])
  }
  if (step.id === 'router') {
    return boardWith(
      ['SEMANTIC_CACHE', 'FAST_SLM', 'PROMPT_ROUTER'],
      [
        ['SEMANTIC_CACHE', 'PROMPT_ROUTER'],
        ['PROMPT_ROUTER', 'FAST_SLM'],
        ['PROMPT_ROUTER', 'FRONTIER_API'],
      ],
    )
  }
  return EMPTY
})

describe('the tutorial', () => {
  it('has seven steps, each skippable and each with somewhere to point', () => {
    expect(TUTORIAL).toHaveLength(7)
    for (const step of TUTORIAL) {
      expect(step.anchor.startsWith('[aria-label=')).toBe(true)
      expect(step.body.length).toBeGreaterThan(40)
    }
  })

  it('moves on when the player does what the step asked', () => {
    let step = 0
    for (let i = 0; i < TUTORIAL.length; i++) {
      step = nextStep(step, PASSES[i], BOARDS[i])
      expect(step).toBe(i + 1)
    }
    expect(step).toBe(TUTORIAL.length)
  })

  it('waits on anything else', () => {
    // Pausing isn't placing a cache, and placing the wrong node isn't either.
    expect(nextStep(2, { kind: 'speed', speed: 'paused' }, EMPTY)).toBe(2)
    expect(nextStep(2, { kind: 'command', command: { type: 'placeNode', nodeType: 'FAST_SLM', x: 1, y: 1 } }, EMPTY)).toBe(2)
    // Unlinking some other tube isn't unlinking the direct one.
    expect(nextStep(3, { kind: 'command', command: { type: 'unlink', from: 1, to: 2 }, from: 'USERS_IN', to: 'SEMANTIC_CACHE' }, EMPTY)).toBe(3)
    // One of the two links isn't both.
    expect(nextStep(4, PASSES[4], boardWith(['SEMANTIC_CACHE'], [['USERS_IN', 'SEMANTIC_CACHE']]))).toBe(4)
  })
})

describe('cardSpot', () => {
  const screen = { width: 1440, height: 900 }
  const card = { width: 320, height: 200 }

  it('sits to the right of a left-rail panel', () => {
    const spot = cardSpot({ left: 16, top: 72, width: 232, height: 120 }, card, screen)
    expect(spot.left).toBeGreaterThanOrEqual(248)
    expect(spot.top).toBe(72)
  })

  it('sits to the left of a right-rail panel', () => {
    const spot = cardSpot({ left: 1168, top: 300, width: 256, height: 120 }, card, screen)
    expect(spot.left + card.width).toBeLessThanOrEqual(1168)
  })

  it('sits above the toolbar, which is too wide to sit beside', () => {
    const spot = cardSpot({ left: 360, top: 748, width: 720, height: 136 }, card, screen)
    expect(spot.top + card.height).toBeLessThanOrEqual(748)
    expect(spot.left).toBe(360 + 360 - 160)
  })

  it('sits above the toolbar on a wide screen too, where it is less than half the width', () => {
    const wide = { width: 1920, height: 1080 }
    const spot = cardSpot({ left: 560, top: 928, width: 800, height: 136 }, card, wide)
    expect(spot.top + card.height).toBeLessThanOrEqual(928)
    expect(spot.left).toBe(560 + 400 - 160)
  })

  it('stays on screen whatever it is pointing at', () => {
    for (const anchor of [
      { left: -200, top: -200, width: 100, height: 50 },
      { left: 1430, top: 880, width: 100, height: 50 },
    ]) {
      const spot = cardSpot(anchor, card, screen)
      expect(spot.left).toBeGreaterThanOrEqual(16)
      expect(spot.left + card.width).toBeLessThanOrEqual(screen.width - 16)
      expect(spot.top).toBeGreaterThanOrEqual(72)
      expect(spot.top + card.height).toBeLessThanOrEqual(screen.height - 16)
    }
  })
})
