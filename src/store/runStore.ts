/*
 * Which screen is up (title, run or postmortem), and the run in play. The
 * run controller in src/run.ts changes it; App renders from it.
 */

import { create } from 'zustand'

import type { Postmortem } from '../engine'
import type { BoardSetup } from '../canvas/devScenes'
import type { ShareKind } from '../share'

export type RunMode = 'survival' | 'sandbox' | 'daily'

export interface RunConfig {
  readonly mode: RunMode
  readonly seed: number
  /** Sandbox only: the starting budget and traffic multiplier. */
  readonly sandbox: { readonly budget: number; readonly traffic: number }
  /** Dev only: a scripted scene from scenarios.ts, and how far to fast-forward. */
  readonly scene: string | null
  readonly at: number
}

/** The final board, grabbed from the canvas as the run ended. */
export interface FinalBoard {
  readonly image: string
  readonly width: number
  readonly height: number
  /** Where the postmortem's worst node sits in the image, px, or null. */
  readonly tag: { readonly x: number; readonly y: number } | null
}

export type Screen = 'title' | 'run' | 'postmortem'

export interface RunState {
  readonly screen: Screen
  /** Bumped for every run, so the board remounts cleanly. */
  readonly runId: number
  /** The player's run count, shown on the postmortem ("run 0042"). */
  readonly runNumber: number
  readonly config: RunConfig | null
  readonly setup: BoardSetup | null
  readonly postmortem: Postmortem | null
  readonly finalBoard: FinalBoard | null
  /** Set when this run came from a share link: the top bar says so and offers the seed in Survival. */
  readonly shared: { readonly kind: ShareKind; readonly seed: number } | null
}

export const useRunStore = create<RunState>()(() => ({
  screen: 'title',
  runId: 0,
  runNumber: 0,
  config: null,
  setup: null,
  postmortem: null,
  finalBoard: null,
  shared: null,
}))
