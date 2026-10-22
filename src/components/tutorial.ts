/*
 * The guided first run: seven steps on the opening board, each waiting for
 * the player to do the thing rather than for a Next button. It's offered on
 * the 0:00 phase card of a first Survival run, and skippable at every step.
 *
 * The steps are pure data plus a predicate over what just happened, so the
 * store only has to say "this command was accepted" or "the speed changed"
 * (uiStore.noteTutorial). Prices come from the catalog.
 */

import { DEFAULT_CATALOG, type Command, type NodeType } from '../engine'
import type { Speed } from '../store/uiStore'
import { formatPrice as money } from './format'

const C = DEFAULT_CATALOG

/** What a simple chat earns, and what answering it on Frontier costs in tokens. */
const SIMPLE = C.traffic.chat.SIMPLE
const FRONTIER_COST = (SIMPLE.inputTokens / 1000) * C.nodes.FRONTIER_API.inputPricePer1k + (SIMPLE.outputTokens / 1000) * C.nodes.FRONTIER_API.outputPricePer1k

export type TutorialEvent =
  /** A command the engine accepted. For a link or unlink, the two ends' types. */
  | { readonly kind: 'command'; readonly command: Command; readonly from?: NodeType; readonly to?: NodeType }
  | { readonly kind: 'speed'; readonly speed: Speed }
  /** The card's own button, for a step that's only to be read. */
  | { readonly kind: 'ack' }

/** The board as the tutorial needs it: what's on it, and the links made since it started. */
export interface TutorialBoard {
  readonly types: ReadonlySet<NodeType>
  readonly links: ReadonlySet<string>
}

export function linkKey(from: NodeType, to: NodeType): string {
  return `${from}>${to}`
}

export interface TutorialStep {
  readonly id: string
  readonly title: string
  readonly body: string
  /** The thing on screen the card points at, as a selector over the labels the HUD already has. */
  readonly anchor: string
  /** A step with nothing to do but read ends with this button. */
  readonly ack?: string
  readonly done: (event: TutorialEvent, board: TutorialBoard) => boolean
}

function placed(event: TutorialEvent, type: NodeType): boolean {
  return event.kind === 'command' && event.command.type === 'placeNode' && event.command.nodeType === type
}

export const TUTORIAL: readonly TutorialStep[] = [
  {
    id: 'pause',
    title: 'Stop the clock',
    body: "The board runs in real time, but it waits while you think. Press Space to pause. You can place, link and read everything while it's paused, and nothing moves until you let it.",
    anchor: '[aria-label="Game speed"]',
    done: (e) => e.kind === 'speed' && e.speed === 'paused',
  },
  {
    id: 'money',
    title: 'Where the money goes',
    body: `Every prompt goes straight to Frontier A, which bills per token. A simple chat earns ${money(SIMPLE.revenue)} and costs about ${money(FRONTIER_COST)} to answer there, so the net line is red and the budget is draining. The run ends at ${money(C.budget.gameOverAt)}.`,
    anchor: '[aria-label="Money"]',
    ack: 'Got it',
    done: (e) => e.kind === 'ack',
  },
  {
    id: 'cache',
    title: 'Answer the repeats for nothing',
    body: `Tab 1, the semantic cache (${money(C.nodes.SEMANTIC_CACHE.build)}). Click the card, then click a free tile between Users in and Frontier A. A cached answer costs no tokens at all.`,
    anchor: '[aria-label="Build"]',
    done: (e) => placed(e, 'SEMANTIC_CACHE'),
  },
  {
    id: 'unlink',
    title: 'Unplug the direct line',
    body: 'The cache is on the board, but nothing reaches it: Users in still runs straight to Frontier A. Press U for the unlink tool and click that tube.',
    anchor: '[aria-label="Build"]',
    done: (e) => e.kind === 'command' && e.command.type === 'unlink' && e.from === 'USERS_IN' && e.to === 'FRONTIER_API',
  },
  {
    id: 'link',
    title: 'Wire it back, in order',
    body: 'Press C for the link tool. Click Users in first, then the cache: a link runs from the node you click first to the one you click second. Then link the cache to Frontier A.',
    anchor: '[aria-label="Build"]',
    done: (_e, board) => board.links.has(linkKey('USERS_IN', 'SEMANTIC_CACHE')) && board.links.has(linkKey('SEMANTIC_CACHE', 'FRONTIER_API')),
  },
  {
    id: 'router',
    title: 'Send the easy ones somewhere cheap',
    body: `A Fast SLM (tab 2, ${money(C.nodes.FAST_SLM.build)}) answers simple chat for pennies, but it gets hard questions wrong. A prompt router (tab 1, ${money(C.nodes.PROMPT_ROUTER.build)}) decides which goes where. Place both, then link cache → router, router → Fast SLM and router → Frontier A. Unlink cache → Frontier A afterwards, or half the traffic still goes the expensive way.`,
    anchor: '[aria-label="Build"]',
    done: (_e, board) =>
      board.types.has('FAST_SLM') &&
      board.types.has('PROMPT_ROUTER') &&
      board.links.has(linkKey('SEMANTIC_CACHE', 'PROMPT_ROUTER')) &&
      board.links.has(linkKey('PROMPT_ROUTER', 'FAST_SLM')) &&
      board.links.has(linkKey('PROMPT_ROUTER', 'FRONTIER_API')),
  },
  {
    id: 'run',
    title: 'Let it run, and watch Trust',
    body: `Press Space and keep an eye on the trust strip. Wrong answers pay like right ones until users notice and complain, ${C.trust.complaintDelaySec.min} to ${C.trust.complaintDelaySec.max} seconds later — nothing else on the board will tell you. An output guardrail turns most wrong answers into refusals, which cost a fraction of the trust: that's the next thing to try.`,
    anchor: '[aria-label="Trust"]',
    done: (e) => e.kind === 'speed' && e.speed !== 'paused',
  },
]

/** The step after this one, or the length of the tutorial when it's finished. */
export function nextStep(step: number, event: TutorialEvent, board: TutorialBoard): number {
  const current = TUTORIAL[step]
  if (current === undefined) return step
  return current.done(event, board) ? step + 1 : step
}

// ---------------------------------------------------------------------------
// Offered once: the first Survival run that reaches 0:00 without having seen it
// ---------------------------------------------------------------------------

const KEY = 'agent-survival.tutorial'

export function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(KEY) !== null
  } catch {
    // Blocked storage: offer it, once per page load at worst.
    return false
  }
}

export function markTutorialSeen(): void {
  try {
    localStorage.setItem(KEY, 'seen')
  } catch {
    // As above.
  }
}

// ---------------------------------------------------------------------------
// Where the card sits
// ---------------------------------------------------------------------------

export interface Box {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** The screen edge the card keeps clear, px. */
const MARGIN = 16

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi))
}

/** A band at the bottom of the screen: an anchor reaching into it is a bar, so the card goes above it. */
const BOTTOM_BAND = 120

/**
 * Puts the card beside what it points at: above a wide or bottom-edge anchor like the toolbar,
 * otherwise on whichever side has room, and always inside the screen below the top bar.
 */
export function cardSpot(anchor: Box, card: { readonly width: number; readonly height: number }, screen: { readonly width: number; readonly height: number }, gap = 12): { readonly left: number; readonly top: number } {
  const x = (v: number) => clamp(v, MARGIN, screen.width - card.width - MARGIN)
  const y = (v: number) => clamp(v, 72, screen.height - card.height - MARGIN)
  if (anchor.width >= screen.width / 2 || anchor.top + anchor.height > screen.height - BOTTOM_BAND) {
    return { left: x(anchor.left + anchor.width / 2 - card.width / 2), top: y(anchor.top - gap - card.height) }
  }
  const right = anchor.left + anchor.width + gap
  const fitsRight = right + card.width <= screen.width - MARGIN
  return { left: x(fitsRight ? right : anchor.left - gap - card.width), top: y(anchor.top) }
}
