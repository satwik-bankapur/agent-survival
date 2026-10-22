/*
 * The postmortem: what happened in a finished run, written from the run log
 * by simple rules, like an incident review.
 *
 * It reads ground truth (D39): which model gave users wrong answers, how many
 * prompts timed out where. That's allowed only because the run is over. The
 * HUD and the board never see any of it during play (D10, D11).
 *
 * Every sentence names domain things the player can act on, and every
 * action item points at a node type they can place.
 */

import { ticksPerSecond } from './catalog'
import { formatClock } from './scenarios'
import { trustValue } from './trust'
import { arrivalRate } from './WaveDirector'
import { recentFailures, type FailureKey, type NodeTally } from './runLog'
import type { GameOverCause, NodeType } from './types'
import type { World } from './world'

export interface PostmortemMarker {
  readonly sec: number
  readonly text: string
  /** Failures read in red: users reporting wrong answers, trust going critical, the end. */
  readonly alarm: boolean
}

export interface PostmortemAction {
  readonly text: string
  readonly nodeType: NodeType
}

export interface Postmortem {
  readonly cause: GameOverCause
  readonly endSec: number
  readonly seed: number
  readonly headline: string
  readonly facts: {
    readonly survivedSec: number
    readonly finalBudget: number
    readonly answered: number
    readonly wrongSeen: number
    readonly timeouts: number
    readonly tokens: number
  }
  /** Budget and trust at the start of each second, then once more at the end. */
  readonly budget: readonly number[]
  readonly trust: readonly number[]
  readonly phases: readonly { readonly name: string; readonly startSec: number }[]
  readonly markers: readonly PostmortemMarker[]
  readonly rootCause: string
  readonly factors: readonly string[]
  readonly wentWell: readonly string[]
  readonly actions: readonly PostmortemAction[]
  /** The node most to blame that's still on the board, for the tag on the final board. */
  readonly worst: { readonly nodeId: number; readonly text: string } | null
}

/** Placements shown on the timeline: the first few, so the labels don't pile up. */
const MAX_PLACED_MARKERS = 3
const MAX_FACTORS = 3
const MAX_WENT_WELL = 2
const MAX_ACTIONS = 3
/** A finding is a contributing factor only past this weight: five loud failures, or about one wrong answer, or $15. */
const MIN_FACTOR_WEIGHT = 14

function money(value: number): string {
  const abs = Math.abs(value)
  const text = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return value < 0 ? `−$${text}` : `$${text}`
}

function wholeMoney(value: number): string {
  const text = Math.round(Math.abs(value)).toLocaleString('en-US')
  return value < 0 ? `−$${text}` : `$${text}`
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

/** What one prompt costs on a model, by difficulty, from the catalog. */
function lossPerSimpleChat(world: World, type: 'FRONTIER_API' | 'FAST_SLM'): number {
  const spec = world.catalog.nodes[type]
  const chat = world.catalog.traffic.chat.SIMPLE
  const cost = (chat.inputTokens / 1000) * spec.inputPricePer1k + (chat.outputTokens / 1000) * spec.outputPricePer1k
  return cost - chat.revenue
}

interface Analysis {
  readonly tallies: readonly NodeTally[]
  readonly models: readonly NodeTally[]
  readonly onBoard: (type: NodeType) => boolean
  readonly complexServed: number
  readonly simpleServed: number
}

function analyse(world: World): Analysis {
  const tallies = world.runLog.tallies.filter((t): t is NodeTally => t !== undefined)
  const models = tallies.filter((t) => t.type === 'FAST_SLM' || t.type === 'FRONTIER_API')
  return {
    tallies,
    models,
    onBoard: (type) => world.nodes.some((n) => n.type === type),
    complexServed: tallies.reduce((s, t) => s + t.complexServed, 0),
    simpleServed: tallies.reduce((s, t) => s + t.simpleServed, 0),
  }
}

function most(tallies: readonly NodeTally[], key: (t: NodeTally) => number): NodeTally | null {
  let best: NodeTally | null = null
  for (const t of tallies) if (key(t) > 0 && (best === null || key(t) > key(best))) best = t
  return best
}

/** One problem the run had, with how much trust or money it cost, for ranking. */
interface Finding {
  readonly id: 'loss' | 'upkeep' | 'wrong' | 'timeouts' | 'queueFull' | 'noRoute' | 'breach'
  readonly weight: number
  readonly sentence: string
  readonly node: NodeTally | null
  readonly tag: string
}

/**
 * How failures are counted: over the whole run, or over the last 30 to 60 seconds. Trust is a
 * 30 s window (D8), so a trust collapse is blamed on what failed just before it, not on wrong
 * answers spread over ten minutes.
 */
type Count = (t: NodeTally, key: FailureKey) => number
const wholeRun: Count = (t, key) => t[key]
const recently: Count = (t, key) => recentFailures(t, key)

/** Users in and out don't do the work, so a prompt that arrives late there is blamed on the nodes before them. */
function doesWork(t: NodeTally): boolean {
  return t.type !== 'USERS_IN' && t.type !== 'USERS_OUT'
}

function findings(world: World, a: Analysis, count: Count): Finding[] {
  const out: Finding[] = []
  const score = world.catalog.trust.score
  const stats = world.stats

  // Money: the model that lost the most on tokens.
  const loser = most(a.models, (t) => t.tokenSpend - t.revenue)
  if (loser !== null) {
    const loss = loser.tokenSpend - loser.revenue
    const perChat = loser.type === 'FRONTIER_API' ? lossPerSimpleChat(world, 'FRONTIER_API') : 0
    const sentence =
      perChat > 0 && loser.simpleServed > loser.complexServed
        ? `${loser.label} answered ${plural(loser.simpleServed, 'simple chat', 'simple chats')} at a loss of about ${money(perChat)} each. Its tokens cost ${wholeMoney(loss)} more than its answers earned.`
        : `${loser.label}'s tokens cost ${wholeMoney(loss)} more than its answers earned.`
    out.push({ id: 'loss', weight: loss, sentence, node: loser, tag: `${loser.label}, ${wholeMoney(-loss)} on tokens` })
  }
  if (stats.upkeep > stats.revenue && stats.upkeep > 0) {
    out.push({
      id: 'upkeep',
      weight: stats.upkeep - stats.revenue,
      sentence: `Upkeep cost ${wholeMoney(stats.upkeep)}, more than the ${wholeMoney(stats.revenue)} the answers earned.`,
      node: null,
      tag: '',
    })
  }

  // Trust: what each kind of failure cost, in D8 outcome points.
  const wrong = most(a.tallies, (t) => count(t, 'wrongServed'))
  if (wrong !== null) {
    const n = count(wrong, 'wrongServed')
    const complexShare = pct(wrong.complexServed, a.complexServed)
    const them = n === 1 ? 'it' : 'them'
    const checked = a.onBoard('OUTPUT_GUARDRAIL') ? `and the guardrail missed ${them}` : `and nothing checked ${them} before users saw ${them}`
    const what =
      wrong.type === 'SEMANTIC_CACHE'
        ? `${wrong.label} served ${plural(n, 'wrong cached answer', 'wrong cached answers')} straight to users, past every check.`
        : wrong.type === 'FAST_SLM' && complexShare >= 25
          ? `${wrong.label} answered ${complexShare}% of complex questions. ${plural(n, 'answer', 'answers')} users got from it were wrong, ${checked}.`
          : `${wrong.label} gave users ${plural(n, 'wrong answer', 'wrong answers')}, ${checked}.`
    out.push({ id: 'wrong', weight: -score.WRONG * n, sentence: what, node: wrong, tag: `${wrong.label}, ${plural(wrong.wrongServed, 'wrong answer', 'wrong answers')}` })
  }
  // Breaches cost both money and trust (D43), so they can lead either kind of collapse.
  const leaker = most(a.models, (t) => count(t, 'breaches'))
  if (leaker !== null) {
    const n = count(leaker, 'breaches')
    const pii = leaker.piiBreaches
    const injections = leaker.breaches - pii
    const kinds =
      pii > 0 && injections > 0
        ? `${plural(pii, 'prompt', 'prompts')} with users' personal data reached it unredacted, and ${plural(injections, 'prompt injection', 'prompt injections')} took it over`
        : pii > 0
          ? 'prompts with users\' personal data reached it unredacted'
          : 'prompt injections took it over'
    out.push({
      id: 'breach',
      weight: pii * world.catalog.breachFine.PII + injections * world.catalog.breachFine.INJECTION,
      sentence: `${leaker.label} had ${plural(n, 'breach', 'breaches')}: ${kinds}. Each cost a fine and a hit to trust.`,
      node: leaker,
      tag: `${leaker.label}, ${plural(leaker.breaches, 'breach', 'breaches')}`,
    })
  }
  const workers = a.tallies.filter(doesWork)
  const slow = most(workers, (t) => count(t, 'timeouts'))
  if (slow !== null) {
    const n = count(slow, 'timeouts')
    out.push({
      id: 'timeouts',
      weight: -score.FAILED * n,
      sentence: `${plural(n, 'prompt', 'prompts')} ran past ${n === 1 ? 'its' : 'their'} deadline at ${slow.label}, too slow upstream or stuck in its queue.`,
      node: slow,
      tag: `${slow.label}, ${plural(slow.timeouts, 'timeout', 'timeouts')}`,
    })
  }
  const full = most(workers, (t) => count(t, 'queueFullDrops'))
  if (full !== null) {
    const n = count(full, 'queueFullDrops')
    out.push({
      id: 'queueFull',
      weight: -score.FAILED * n,
      sentence: `${full.label}'s queue filled up and dropped ${plural(n, 'prompt', 'prompts')}.`,
      node: full,
      tag: `${full.label}, ${plural(full.queueFullDrops, 'drop', 'drops')}`,
    })
  }
  const stuck = most(a.tallies, (t) => count(t, 'noRouteDrops'))
  if (stuck !== null) {
    const n = count(stuck, 'noRouteDrops')
    out.push({
      id: 'noRoute',
      weight: -score.FAILED * n,
      sentence: `${stuck.label} had no route out, so ${plural(n, 'prompt was', 'prompts were')} dropped.`,
      node: stuck,
      tag: `${stuck.label}, no route`,
    })
  }
  return out
}

/**
 * Did a stale index cause most wrong answers (J-7)? No ingestion cron was ever placed, and most
 * wrong answers served were RAG answers whose vector DB had drifted past half its cap. Returns
 * when drift hit its cap, in seconds, or null if the rule doesn't apply.
 */
export function staleIndexCapSec(world: World): number | null {
  const stats = world.stats
  if (stats.wrongServed === 0 || stats.wrongDrifted * 2 <= stats.wrongServed) return null
  if (world.runLog.tallies.some((t) => t?.type === 'INGESTION_CRON')) return null
  const at = world.runLog.driftCapTick
  return at < 0 ? null : at / ticksPerSecond(world.catalog)
}

/** A surge counts for this long after it ends (J-7). */
const SURGE_GRACE_SEC = 15
/** Seconds before the end that the provider pools are checked over (J-7). */
const POOLS_WINDOW_SEC = 30

/**
 * Did surge timeouts kill a run that only the throttle could have saved (J-7)? It died of trust,
 * with timeouts or queue-full drops the main failure, during a viral spike or traffic surge or
 * within 15 s of one, with every provider pool in use full for most of the last 30 s, and with no
 * throttle on Users in, or one looser than the arrivals it should shed.
 */
export function surgeNeededThrottle(world: World, primaryId: string | null): boolean {
  const over = world.gameOver
  if (over === null || over.cause !== 'TRUST') return false
  if (primaryId !== 'timeouts' && primaryId !== 'queueFull') return false
  const tps = ticksPerSecond(world.catalog)
  const grace = SURGE_GRACE_SEC * tps
  if (!world.runLog.surges.some((s) => over.tick >= s.startTick && over.tick <= s.endTick + grace)) return false
  const log = world.runLog
  const from = Math.max(0, log.seconds - POOLS_WINDOW_SEC)
  let full = 0
  for (let s = from; s < log.seconds; s++) full += log.poolsFull[s]
  if (log.seconds === from || full * 2 < log.seconds - from) return false
  const usersIn = world.nodeById[world.usersInId]
  const throttle = usersIn?.throttlePerSec ?? 0
  return throttle === 0 || throttle > arrivalRate(world.catalog, over.tick / tps)
}

export function buildPostmortem(world: World): Postmortem {
  const tps = ticksPerSecond(world.catalog)
  const catalog = world.catalog
  const over = world.gameOver
  const endTick = over?.tick ?? world.tick
  const endSec = endTick / tps
  const cause: GameOverCause = over?.cause ?? 'ENDED'
  const stats = world.stats
  const a = analyse(world)

  const phases = catalog.phases.filter((p) => p.startSec <= endSec)
  const phase = phases[phases.length - 1]
  const when = `${formatClock(endSec)}, in the ${lowerFirst(phase.name)}`
  const headline =
    cause === 'BANKRUPT'
      ? `The budget hit ${wholeMoney(catalog.budget.gameOverAt)}. The run ended at ${when}.`
      : cause === 'TRUST'
        ? `Trust stayed below ${catalog.trust.criticalBelow}% for ${catalog.trust.criticalSec} seconds. The run ended at ${when}.`
        : `You ended the run at ${when}.`

  // Rank what went wrong: money problems lead a bankruptcy, trust problems a trust collapse.
  const all = findings(world, a, cause === 'BANKRUPT' ? wholeRun : recently)
  const moneyIds = new Set(['loss', 'upkeep', 'breach'])
  const trustIds = new Set(['wrong', 'timeouts', 'queueFull', 'noRoute', 'breach'])
  const ranked = [...all].sort((x, y) => y.weight - x.weight)
  const primaryPool =
    cause === 'BANKRUPT' ? ranked.filter((f) => moneyIds.has(f.id)) : cause === 'TRUST' ? ranked.filter((f) => trustIds.has(f.id)) : ranked
  const primary = primaryPool[0] ?? ranked[0] ?? null

  const rootCause =
    primary !== null
      ? primary.sentence
      : cause === 'ENDED'
        ? `Nothing was failing. The run ended by choice with ${money(world.budget)} in the bank.`
        : 'The run ended before any one node stood out.'

  // Contributing factors: missing pieces first, then the other findings.
  const factors: string[] = []
  const slm = a.models.filter((t) => t.type === 'FAST_SLM')
  const frontier = a.models.filter((t) => t.type === 'FRONTIER_API')
  const slmComplex = slm.reduce((s, t) => s + t.complexServed, 0)
  const frontierSimple = frontier.reduce((s, t) => s + t.simpleServed, 0)
  if (!a.onBoard('PROMPT_ROUTER') && slmComplex > 0) factors.push('No prompt router, so hard questions went to the small model.')
  else if (!a.onBoard('PROMPT_ROUTER') && frontierSimple > 0 && primary?.id !== 'loss')
    factors.push('No prompt router, so simple chats went to the expensive frontier model.')
  if (!a.onBoard('PII_REDACTOR') && stats.piiBreaches > 0)
    factors.push('No PII redactor, so users\' personal data went to hosted models, and every hosted model leaks it.')
  if (!a.onBoard('PROMPT_FIREWALL') && stats.injectionBreaches > 0) factors.push('No prompt firewall, so attacks reached the models.')
  if (!a.onBoard('OUTPUT_GUARDRAIL') && stats.wrongServed > 0)
    factors.push('No output guardrail, so wrong answers stayed invisible until users reported them.')
  const spike = catalog.traffic.spike
  const slow = all.find((f) => f.id === 'timeouts')
  const spikeRecent = spike !== null && endSec >= spike.startSec && endSec <= spike.endSec + 60
  if (spike !== null && slow !== undefined && slow !== primary && spikeRecent && slow.node !== null)
    factors.push(`The ${formatClock(spike.startSec)} spike filled ${slow.node.label}'s queue and caused ${plural(slow.node.timeouts, 'timeout', 'timeouts')}.`)
  const busyFrom = spike === null ? 0 : spike.startSec
  if (!a.onBoard('SEMANTIC_CACHE') && endSec >= busyFrom && endSec >= 180) factors.push('No semantic cache, so every repeated question still went to a model.')
  for (const f of ranked) if (f !== primary && f.id !== 'timeouts' && f.weight >= MIN_FACTOR_WEIGHT) factors.push(f.sentence)
  const uniqueFactors = [...new Set(factors)].slice(0, MAX_FACTORS)

  // What went well.
  const wentWell: string[] = []
  const budget = Array.from(world.runLog.budget.subarray(0, world.runLog.seconds))
  budget.push(world.budget)
  const profitableFrom = firstProfitableSecond(budget)
  if (profitableFrom !== null && budget.length - profitableFrom >= 60) wentWell.push(`Profitable from ${formatClock(profitableFrom)} onward.`)
  const caches = a.tallies.filter((t) => t.type === 'SEMANTIC_CACHE')
  const cacheSimple = caches.reduce((s, t) => s + t.simpleServed, 0)
  if (cacheSimple > 0) wentWell.push(`The semantic cache answered ${pct(cacheSimple, a.simpleServed)}% of simple chats.`)
  if (a.onBoard('OUTPUT_GUARDRAIL') && stats.refused > 0)
    wentWell.push(`The output guardrail stopped ${plural(stats.refused, 'answer', 'answers')} before users saw them.`)
  if (stats.minTrust >= 60) wentWell.push(`Trust never fell below ${Math.floor(stats.minTrust)}%.`)
  if (wentWell.length === 0) wentWell.push(`Users got ${plural(stats.served, 'answer', 'answers')} in time.`)

  // Action items: the nodes that would have fixed what went wrong.
  const actions: PostmortemAction[] = []
  const add = (nodeType: NodeType, text: string) => {
    if (!actions.some((x) => x.nodeType === nodeType)) actions.push({ nodeType, text })
  }
  // A stale index behind most wrong answers: the cheapest fix there is, so it leads (J-7).
  const capSec = staleIndexCapSec(world)
  if (capSec !== null)
    add(
      'INGESTION_CRON',
      `Add an ingestion cron. Your vector DB's drift hit its cap at ${formatClock(capSec)}, and most wrong answers came from RAG questions answered on its stale index.`,
    )
  // Both pools full in a surge: more nodes can't help, shedding can (J-7).
  if (surgeNeededThrottle(world, primary?.id ?? null))
    add('USERS_IN', 'Set a throttle on Users in. Turning away a surge\'s overflow costs a little trust (+0.8); letting it time out costs −3 a prompt.')
  if (stats.piiBreaches > 0 && !a.onBoard('PII_REDACTOR'))
    add('PII_REDACTOR', 'Put a PII redactor in front of the models. Every hosted model, Fast SLM included, leaks the personal data it receives.')
  if (stats.injectionBreaches > 0 && !a.onBoard('PROMPT_FIREWALL')) add('PROMPT_FIREWALL', 'Put a prompt firewall right after Users in to block prompt injections.')
  if (endSec > catalog.traffic.mixFromSec && stats.wrongServed > 0 && !a.onBoard('VECTOR_DB'))
    add('VECTOR_DB', 'Place a vector DB behind the router. Without retrieved context, most RAG answers are wrong.')
  const frontierLoss = all.find((f) => f.id === 'loss' && f.node?.type === 'FRONTIER_API')
  if (frontierLoss !== undefined && slm.length === 0) add('FAST_SLM', 'Place a Fast SLM to answer simple chats for a few cents each.')
  if (!a.onBoard('PROMPT_ROUTER') && (slmComplex > 0 || frontierSimple > 0) && (slm.length > 0 || frontierLoss !== undefined))
    add('PROMPT_ROUTER', 'Add a prompt router and send complex questions to a frontier model.')
  if (!a.onBoard('OUTPUT_GUARDRAIL') && stats.wrongServed > 0) add('OUTPUT_GUARDRAIL', 'Place an output guardrail before the exit.')
  if (!a.onBoard('SEMANTIC_CACHE')) add('SEMANTIC_CACHE', 'Put a semantic cache in front of the models to absorb repeated questions.')
  const busiest = most(a.tallies.filter(doesWork), (t) => t.timeouts + t.queueFullDrops)
  if (busiest !== null && busiest.type === 'FRONTIER_API')
    add('FAST_SLM', `Add another Fast SLM to take load off ${busiest.label}. A second Frontier on the same provider adds no capacity.`)
  else if (busiest !== null && busiest.type !== 'USERS_IN' && busiest.type !== 'USERS_OUT')
    add(busiest.type, `Add a second ${lowerFirst(catalog.nodes[busiest.type].name)} so one queue doesn't take the whole load.`)

  // The tag on the final board: the primary finding's node, if it's still there.
  const blamed = [primary, ...ranked].find((f) => f !== null && f.node !== null && world.nodeById[f.node.nodeId] !== undefined) ?? null
  const worst = blamed === null || blamed.node === null ? null : { nodeId: blamed.node.nodeId, text: blamed.tag }

  return {
    cause,
    endSec,
    seed: world.seed,
    headline,
    facts: {
      survivedSec: endSec,
      finalBudget: world.budget,
      answered: stats.served,
      wrongSeen: stats.wrongServed,
      timeouts: stats.timeouts,
      tokens: stats.tokens,
    },
    budget,
    trust: [...Array.from(world.runLog.trust.subarray(0, world.runLog.seconds)), trustValue(world.trust)],
    phases,
    markers: markersOf(world, endSec, cause),
    rootCause,
    factors: uniqueFactors,
    wentWell: wentWell.slice(0, MAX_WENT_WELL),
    actions: actions.slice(0, MAX_ACTIONS),
    worst,
  }
}

/** The earliest second after which the budget never dipped below where it stood, or null. */
export function firstProfitableSecond(budget: readonly number[]): number | null {
  if (budget.length < 2) return null
  let floor = Infinity
  let from: number | null = null
  for (let s = budget.length - 1; s >= 0; s--) {
    if (budget[s] <= floor) {
      floor = budget[s]
      from = s
    }
  }
  // Only meaningful if the budget actually grew after it.
  if (from === null || budget[budget.length - 1] <= budget[from]) return null
  return from
}

function markersOf(world: World, endSec: number, cause: GameOverCause): PostmortemMarker[] {
  const tps = ticksPerSecond(world.catalog)
  const markers: PostmortemMarker[] = []
  for (const p of world.catalog.phases) {
    if (p.startSec > 0 && p.startSec <= endSec) markers.push({ sec: p.startSec, text: `${formatClock(p.startSec)} ${lowerFirst(p.name)} starts`, alarm: false })
  }
  const spike = world.catalog.traffic.spike
  if (spike !== null && spike.multiplier > 1 && spike.startSec <= endSec) markers.push({ sec: spike.startSec, text: `${formatClock(spike.startSec)} viral spike`, alarm: false })
  let placed = 0
  let critical = false
  for (const m of world.runLog.markers) {
    const sec = m.tick / tps
    if (m.kind === 'PLACED') {
      if (placed++ < MAX_PLACED_MARKERS) markers.push({ sec, text: `${formatClock(sec)} ${m.text}`, alarm: false })
    } else if (m.kind === 'EVENT') {
      markers.push({ sec, text: `${formatClock(sec)} ${m.text}`, alarm: false })
    } else if (m.kind === 'TRUST_CRITICAL') {
      if (!critical) markers.push({ sec, text: `${formatClock(sec)} ${m.text}`, alarm: true })
      critical = true
    } else {
      markers.push({ sec, text: `${formatClock(sec)} ${m.text}`, alarm: true })
    }
  }
  markers.push({ sec: endSec, text: `${formatClock(endSec)} ${cause === 'ENDED' ? 'run ended' : 'run over'}`, alarm: cause !== 'ENDED' })
  return markers.sort((x, y) => x.sec - y.sec)
}
