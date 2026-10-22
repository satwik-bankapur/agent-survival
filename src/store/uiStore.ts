/*
 * The HUD's one source of truth: the latest telemetry snapshot plus UI state
 * (tool, tab, card, selected node, link in progress, toasts, speed, menu).
 * Components subscribe with narrow selectors and never touch the engine; they
 * change the game only through `dispatch`, which hands a command to the engine
 * and turns a rejection into a toast with the engine's own reason.
 *
 * The engine builds a snapshot every 4 Hz of game time, which at 4× speed is
 * 16 a real second. `connectEngine` publishes at most one per 250 ms of real
 * time (always including the latest), so no component re-renders more than
 * 4 times a second at any speed.
 */

import { create } from 'zustand'

import { linkKey, markTutorialSeen, nextStep, TUTORIAL, type TutorialBoard, type TutorialEvent } from '../components/tutorial'
import type { Command, CommandResult, GameEngine, NodeType, PacketView, TelemetrySnapshot } from '../engine'

export type Tool = 'select' | 'link' | 'unlink' | 'demolish'
export type Speed = 'paused' | 1 | 2 | 4
export type Tab = 1 | 2 | 3 | 4 | 5

/** A build-menu card: a Milestone 1 node type, or a later one shown locked. */
export type CardId = NodeType | (string & {})

/** Real milliseconds between published snapshots. */
export const PUBLISH_INTERVAL_MS = 250
/** How long a toast stays up, real milliseconds. */
export const TOAST_MS = 3000
/** At most this many toasts at once; the oldest goes first. */
export const MAX_TOASTS = 3

export interface Toast {
  readonly id: number
  readonly text: string
  /** A rejected action is an alarm; anything else is plain. */
  readonly tone: 'info' | 'alarm'
}

const SPEEDS: readonly Speed[] = ['paused', 1, 2, 4]

/** Player settings, kept across page loads. */
export interface Settings {
  /** 0 to 1. A placeholder until there's sound. */
  readonly volume: number
  /** No blinking, pulsing or drifting, and the spinning parts stop. */
  readonly reducedMotion: boolean
  readonly showFps: boolean
}

const SETTINGS_KEY = 'agent-survival.settings'

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

function loadSettings(): Settings {
  const defaults: Settings = { volume: 0.8, reducedMotion: prefersReducedMotion(), showFps: false }
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(SETTINGS_KEY)
    if (raw === null) return defaults
    const saved = JSON.parse(raw) as Partial<Settings>
    return {
      volume: typeof saved.volume === 'number' ? Math.min(1, Math.max(0, saved.volume)) : defaults.volume,
      reducedMotion: typeof saved.reducedMotion === 'boolean' ? saved.reducedMotion : defaults.reducedMotion,
      showFps: typeof saved.showFps === 'boolean' ? saved.showFps : defaults.showFps,
    }
  } catch {
    return defaults
  }
}

function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Private windows and blocked storage: the settings just don't persist.
  }
}

/** CSS animations check `:root[data-reduced-motion]`. */
function applyMotionAttribute(settings: Settings): void {
  if (typeof document === 'undefined') return
  document.documentElement.toggleAttribute('data-reduced-motion', settings.reducedMotion)
}

/** Read from useFrame without subscribing: the canvas checks it every frame. */
export function reducedMotion(): boolean {
  return useUiStore.getState().settings.reducedMotion
}

export interface UiState {
  readonly snapshot: TelemetrySnapshot
  /** Sticky for the run: true once users have reported a wrong answer, so the legend can name them (D10). */
  readonly wrongAnswersSeen: boolean
  readonly tool: Tool
  readonly tab: Tab
  readonly selectedCard: CardId | null
  readonly hoveredCard: CardId | null
  readonly speed: Speed
  readonly menuOpen: boolean
  /** The node the inspector shows, or null. */
  readonly selectedNodeId: number | null
  /** The link tool's source once it's been clicked, or null. */
  readonly linkFrom: number | null
  readonly toasts: readonly Toast[]
  /**
   * The opening coach mark: 'waiting' until token spend first outruns revenue, then 'shown' until
   * it's dismissed, its condition clears or its advice is taken, then 'done' for the rest of the run.
   */
  readonly coach: 'waiting' | 'shown' | 'done'
  readonly settings: Settings
  readonly settingsOpen: boolean
  /** The packet X-ray on a paused board: the packet as the player sees it, and where it was clicked. */
  readonly xray: { readonly view: PacketView; readonly x: number; readonly y: number } | null
  /** The phase whose card is up (the game is paused under it), or null. */
  readonly phaseCard: number | null
  /** The field guide entry the Help panel is showing, or null when it's closed. */
  readonly help: string | null
  /** The guided first run: the step the player is on, or null when it isn't running. */
  readonly tutorial: number | null

  setTool(tool: Tool): void
  setTab(tab: Tab): void
  selectCard(card: CardId | null): void
  hoverCard(card: CardId | null): void
  setSpeed(speed: Speed): void
  /** One step slower (−1) or faster (+1) along paused, 1×, 2×, 4×. */
  stepSpeed(direction: -1 | 1): void
  togglePause(): void
  setMenuOpen(open: boolean): void
  selectNode(id: number | null): void
  setLinkFrom(id: number | null): void
  /**
   * Sends a command to the engine. A rejection toasts the engine's reason; `success`, if given, is
   * toasted when it's accepted. The command applies at the next tick, or at once while paused.
   */
  dispatch(command: Command, success?: string): CommandResult
  toast(text: string, tone?: Toast['tone']): void
  dismissToast(id: number): void
  dismissCoach(): void
  setSettings(patch: Partial<Settings>): void
  setSettingsOpen(open: boolean): void
  setXray(xray: UiState['xray']): void
  /** Opens the field guide at an entry, or closes it with null. */
  openHelp(id: string | null): void
  /** The guided first run: start it, close it for good, or answer a step that's only to be read. */
  startTutorial(): void
  skipTutorial(): void
  ackTutorial(): void
  /** Esc: closes the menu, else drops the link in progress, else the card, else the selection, else opens the menu. */
  escape(): void
}

let engineRef: GameEngine | null = null
/** Phase cards for this run (off in sandbox and dev scenes), and the last phase announced. */
let phaseCards = false
/** A shared run being watched: the log builds the board, so the player's own commands are refused. */
let watching = false
let lastPhaseAnnounced = -1
let nextToastId = 1
/** Snapshots in a row in which the coach mark's condition has been clear. */
let coachClearFor = 0

/** The coach mark retires once its condition has been clear this many snapshots in a row: 3 s at 4 Hz. */
export const COACH_CLEAR_SNAPSHOTS = 12

function anyWrongReported(snapshot: TelemetrySnapshot): boolean {
  return snapshot.trust.strip.some((bucket) => bucket.wrongReported > 0)
}

export const useUiStore = create<UiState>()((set, get) => ({
  // Replaced by connectEngine before the HUD mounts.
  snapshot: null as unknown as TelemetrySnapshot,
  wrongAnswersSeen: false,
  tool: 'select',
  tab: 1,
  selectedCard: null,
  hoveredCard: null,
  speed: 1,
  menuOpen: false,
  selectedNodeId: null,
  linkFrom: null,
  toasts: [],
  coach: 'waiting',
  settings: loadSettings(),
  settingsOpen: false,
  xray: null,
  phaseCard: null,
  help: null,
  tutorial: null,

  // Picking a tool puts the card down; picking a card leaves the tool as it was.
  setTool: (tool) => set({ tool, selectedCard: null, linkFrom: null }),
  setTab: (tab) => set({ tab, selectedCard: null }),
  selectCard: (selectedCard) => set({ selectedCard, linkFrom: null }),
  hoverCard: (hoveredCard) => set({ hoveredCard }),
  setSpeed: (speed) => {
    // Speed isn't game state: it never enters the command log, so a replay is the same at any speed.
    if (engineRef !== null) {
      engineRef.paused = speed === 'paused'
      if (speed !== 'paused') engineRef.speed = speed
    }
    // The X-ray and the phase card belong to a paused board: resuming closes them.
    set(speed === 'paused' ? { speed } : { speed, xray: null, phaseCard: null })
    noteTutorial({ kind: 'speed', speed })
  },
  stepSpeed: (direction) => {
    const i = SPEEDS.indexOf(get().speed)
    get().setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, i + direction))])
  },
  togglePause: () => {
    const { speed, setSpeed } = get()
    setSpeed(speed === 'paused' ? (engineRef === null ? 1 : (engineRef.speed as 1 | 2 | 4)) : 'paused')
  },
  setMenuOpen: (menuOpen) => set({ menuOpen }),
  selectNode: (selectedNodeId) => set({ selectedNodeId }),
  setLinkFrom: (linkFrom) => set({ linkFrom }),
  dispatch: (command, success) => {
    // Paused, a command applies at once, so a whole build can be laid out before resuming. It's
    // logged at the tick it precedes and nothing runs in between, so a replay is the same.
    const result: CommandResult =
      engineRef === null
        ? { ok: false, reason: "The game isn't running" }
        : watching
          ? { ok: false, reason: "You're watching a shared run. Play the seed yourself to build." }
            : engineRef.paused
              ? engineRef.applyNow(command)
              : engineRef.dispatch(command)
    if (result.ok && engineRef?.paused === true) engineRef.refreshSnapshot()
    if (result.ok) noteTutorial(commandEvent(command))
    if (!result.ok) get().toast(result.reason, 'alarm')
    else if (success !== undefined) get().toast(success)
    return result
  },
  toast: (text, tone = 'info') => {
    const id = nextToastId++
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }].slice(-MAX_TOASTS) }))
    setTimeout(() => get().dismissToast(id), TOAST_MS)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  dismissCoach: () => set({ coach: 'done' }),
  setSettings: (patch) => {
    const settings = { ...get().settings, ...patch }
    saveSettings(settings)
    applyMotionAttribute(settings)
    set({ settings })
  },
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setXray: (xray) => set({ xray }),
  openHelp: (help) => set({ help }),
  startTutorial: () => {
    tutorialLinks.clear()
    markTutorialSeen()
    // The opening coach mark teaches the tutorial's second step: one of them is enough.
    set({ tutorial: 0, coach: 'done' })
  },
  skipTutorial: () => {
    markTutorialSeen()
    set({ tutorial: null })
  },
  ackTutorial: () => noteTutorial({ kind: 'ack' }),
  escape: () => {
    const s = get()
    if (s.settingsOpen) set({ settingsOpen: false })
    else if (s.help !== null) set({ help: null })
    else if (s.xray !== null) set({ xray: null })
    else if (s.menuOpen) set({ menuOpen: false })
    else if (s.linkFrom !== null) set({ linkFrom: null })
    else if (s.selectedCard !== null) set({ selectedCard: null })
    else if (s.selectedNodeId !== null) set({ selectedNodeId: null })
    else set({ menuOpen: true })
  },
}))

applyMotionAttribute(useUiStore.getState().settings)

// ---------------------------------------------------------------------------
// The guided first run (components/tutorial.ts). The store is where every
// player action already passes, so it's where the steps are checked.
// ---------------------------------------------------------------------------

/** Links made since the tutorial started, as "FROM>TO" of node types. */
const tutorialLinks = new Set<string>()

/** A command as the tutorial sees it: a link's ends are its node types, not ids. */
function commandEvent(command: Command): TutorialEvent {
  if (command.type !== 'link' && command.type !== 'unlink') return { kind: 'command', command }
  // The engine's own snapshot, not the throttled copy in the store: this command just landed.
  const nodes = engineRef?.snapshot.nodes ?? []
  const from = nodes.find((n) => n.id === command.from)?.type
  const to = nodes.find((n) => n.id === command.to)?.type
  if (command.type === 'link' && from !== undefined && to !== undefined) tutorialLinks.add(linkKey(from, to))
  return { kind: 'command', command, from, to }
}

function noteTutorial(event: TutorialEvent): void {
  const state = useUiStore.getState()
  const step = state.tutorial
  if (step === null) return
  const board: TutorialBoard = { types: new Set(state.snapshot.nodes.map((n) => n.type)), links: tutorialLinks }
  const next = nextStep(step, event, board)
  if (next === step) return
  useUiStore.setState({ tutorial: next >= TUTORIAL.length ? null : next })
  if (next >= TUTORIAL.length) state.toast("That's the tour. The field guide (?) has the rest.")
}

/** A phase not yet announced: pause under its card. */
function announcePhase(snapshot: TelemetrySnapshot): void {
  if (!phaseCards || snapshot.gameOver !== null || snapshot.phase.index <= lastPhaseAnnounced) return
  lastPhaseAnnounced = snapshot.phase.index
  useUiStore.getState().setSpeed('paused')
  useUiStore.setState({ phaseCard: snapshot.phase.index })
}

function publish(snapshot: TelemetrySnapshot): void {
  useUiStore.setState((s) => ({
    snapshot,
    wrongAnswersSeen: s.wrongAnswersSeen || anyWrongReported(snapshot),
    coach: nextCoach(s.coach, snapshot),
    // A demolished node can't stay selected or be a link's source.
    selectedNodeId: s.selectedNodeId !== null && !hasNode(snapshot, s.selectedNodeId) ? null : s.selectedNodeId,
    linkFrom: s.linkFrom !== null && !hasNode(snapshot, s.linkFrom) ? null : s.linkFrom,
  }))
  announcePhase(snapshot)
}

/**
 * The opening coach mark's moment: the board is losing money because tokens cost more than the
 * answers earn, which is what the card explains. Upkeep alone (a node placed while paused) isn't it.
 */
function tokensOutrunRevenue(snapshot: TelemetrySnapshot): boolean {
  const m = snapshot.money
  return m.netPerSec < 0 && m.tokenSpendPerSec > m.revenuePerSec
}

/**
 * The coach mark shows once a run. It goes for good when dismissed (dismissCoach), when tokens
 * have stopped outrunning revenue for COACH_CLEAR_SNAPSHOTS in a row, or when the board has what
 * it advises: a prompt router or a semantic cache.
 */
function nextCoach(coach: UiState['coach'], snapshot: TelemetrySnapshot): UiState['coach'] {
  if (coach === 'done') return coach
  const advised = snapshot.nodes.some((n) => n.type === 'PROMPT_ROUTER' || n.type === 'SEMANTIC_CACHE')
  if (coach === 'waiting') return tokensOutrunRevenue(snapshot) && !advised ? 'shown' : 'waiting'
  if (advised) return 'done'
  coachClearFor = tokensOutrunRevenue(snapshot) ? 0 : coachClearFor + 1
  return coachClearFor >= COACH_CLEAR_SNAPSHOTS ? 'done' : 'shown'
}

function hasNode(snapshot: TelemetrySnapshot, id: number): boolean {
  return snapshot.nodes.some((n) => n.id === id)
}

/**
 * Seeds the store from the engine's current snapshot (so `?at=` lands where
 * it should) and publishes new ones, throttled to real time. Returns a
 * disconnect function.
 */
export function connectEngine(engine: GameEngine, options: { readonly phaseCards?: boolean; readonly watching?: boolean } = {}): () => void {
  engineRef = engine
  phaseCards = options.phaseCards ?? false
  watching = options.watching ?? false
  lastPhaseAnnounced = -1
  coachClearFor = 0
  useUiStore.setState({
    snapshot: engine.snapshot,
    wrongAnswersSeen: anyWrongReported(engine.snapshot),
    coach: nextCoach('waiting', engine.snapshot),
    selectedNodeId: null,
    selectedCard: null,
    linkFrom: null,
    toasts: [],
    menuOpen: false,
    xray: null,
    phaseCard: null,
    help: null,
    tutorial: null,
    speed: engine.paused ? 'paused' : (engine.speed as 1 | 2 | 4),
  })

  announcePhase(engine.snapshot)

  let lastPublish = -Infinity
  let pending: TelemetrySnapshot | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    timer = null
    if (pending === null) return
    lastPublish = performance.now()
    publish(pending)
    pending = null
  }
  engine.onSnapshot = (snapshot) => {
    pending = snapshot
    const wait = lastPublish + PUBLISH_INTERVAL_MS - performance.now()
    if (wait <= 0) flush()
    else if (timer === null) timer = setTimeout(flush, wait)
  }

  return () => {
    if (timer !== null) clearTimeout(timer)
    if (engine.onSnapshot !== null) engine.onSnapshot = null
    if (engineRef === engine) engineRef = null
  }
}
