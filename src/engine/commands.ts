/*
 * Player commands. Each one validates first and returns ok or a plain reason
 * the HUD can show as is. GameEngine validates on dispatch, then applies at
 * the start of the next tick, when it validates again.
 */

import { addEdge, addNode, assignPower, powerBalance, powerDraw, recomputeUpkeep, relabel, removeEdge, removeNode } from './board'
import { resetBreaker } from './breaker'
import { ticksPerSecond } from './catalog'
import { purchaseShortfall, refundFor } from './economy'
import { pushIncident } from './events'
import { STRICTNESS_LEVELS, type Command, type CommandResult, type Edge, type GameNode, type NodeType, type SettingValue, type Strictness } from './types'
import { nodeAt, type World } from './world'

const MODELS: readonly NodeType[] = ['FAST_SLM', 'FRONTIER_API', 'VLLM_CLUSTER']
const COORDINATOR: NodeType = 'LANGGRAPH_COORDINATOR'

/**
 * Which node types may send to which (Milestone 1, D47, I-2). Pairs that may feed each other in
 * either order (router and cache, firewall and redactor, vector DB and BM25) give the D27 cycle
 * check real work to do. A coordinator's links to models and tools are two-lane: the way back is
 * made with them, so models and tools never link to a coordinator themselves.
 */
export const CAN_SEND_TO: Readonly<Record<NodeType, readonly NodeType[]>> = {
  USERS_IN: ['PROMPT_FIREWALL', 'PII_REDACTOR', 'SEMANTIC_CACHE', 'PROMPT_ROUTER', COORDINATOR, ...MODELS],
  PROMPT_FIREWALL: ['PII_REDACTOR', 'SEMANTIC_CACHE', 'PROMPT_ROUTER', COORDINATOR, ...MODELS],
  PII_REDACTOR: ['PROMPT_FIREWALL', 'SEMANTIC_CACHE', 'PROMPT_ROUTER', COORDINATOR, ...MODELS],
  SEMANTIC_CACHE: ['PROMPT_ROUTER', COORDINATOR, ...MODELS],
  PROMPT_ROUTER: ['SEMANTIC_CACHE', 'VECTOR_DB', 'BM25_SEARCH', COORDINATOR, ...MODELS],
  VECTOR_DB: ['BM25_SEARCH', 'RERANKER', ...MODELS],
  BM25_SEARCH: ['VECTOR_DB', 'RERANKER', ...MODELS],
  RERANKER: MODELS,
  FAST_SLM: ['OUTPUT_GUARDRAIL', 'USERS_OUT'],
  FRONTIER_API: ['OUTPUT_GUARDRAIL', 'USERS_OUT'],
  VLLM_CLUSTER: ['OUTPUT_GUARDRAIL', 'USERS_OUT'],
  OUTPUT_GUARDRAIL: ['USERS_OUT'],
  USERS_OUT: [],
  // It re-indexes every vector DB on the board, so it needs no links (D45).
  INGESTION_CRON: [],
  LANGGRAPH_COORDINATOR: [...MODELS, 'MCP_WEB_SEARCH', 'MCP_CODE_SANDBOX', 'HITL_GATE', 'OUTPUT_GUARDRAIL', 'USERS_OUT'],
  // They answer their coordinator over the same two-lane link.
  MCP_WEB_SEARCH: [],
  MCP_CODE_SANDBOX: [],
  // The reviewer answers users directly (D21).
  HITL_GATE: [],
  // Power runs on cables drawn for you; the tracer and judge watch the whole board (J-1, J-3).
  POWER_SUBSTATION: [],
  TRACER: [],
  LLM_JUDGE: [],
}

/** Node types that need no links at all. */
const UNLINKED: readonly NodeType[] = ['INGESTION_CRON', 'POWER_SUBSTATION', 'TRACER', 'LLM_JUDGE']

/** Only one of these per board: a second would see nothing the first doesn't. */
const ONE_PER_BOARD: readonly NodeType[] = ['TRACER', 'LLM_JUDGE']

function kw(value: number): string {
  return `${Number(value.toFixed(1))} kW`
}

/** Spare power on the board, in kW: substations' supply less what vLLM draws (J-1). */
export function sparePower(world: World): number {
  const { supplyKw, drawKw } = powerBalance(world)
  return supplyKw - drawKw
}

/** A coordinator's link to a model or tool comes with its way back (D27). */
export function isTwoLane(from: NodeType, to: NodeType): boolean {
  return from === COORDINATOR && (MODELS.includes(to) || to === 'MCP_WEB_SEARCH' || to === 'MCP_CODE_SANDBOX')
}

export const LOOP_REASON = 'Loops are only allowed through the agent coordinator'

const OK: CommandResult = { ok: true }

function reject(reason: string): CommandResult {
  return { ok: false, reason }
}

function isPreplaced(type: NodeType): boolean {
  return type === 'USERS_IN' || type === 'USERS_OUT'
}

export function findEdge(world: World, from: number, to: number): Edge | undefined {
  const node = world.nodeById[from]
  if (node === undefined) return undefined
  for (const edgeId of node.outEdges) {
    const edge = world.edgeById[edgeId]
    if (edge !== undefined && edge.to === to) return edge
  }
  return undefined
}

/**
 * Would a link from → to close a cycle? Depth-first search from `to` along outgoing links,
 * looking for `from`. The only loops allowed are a coordinator's two-lane links (D27), so their
 * return lanes are left out of the search.
 */
export function wouldCreateCycle(world: World, from: number, to: number): boolean {
  if (from === to) return true
  const seen = new Set<number>()
  const stack = [to]
  while (stack.length > 0) {
    const id = stack.pop()
    if (id === undefined || seen.has(id)) continue
    if (id === from) return true
    seen.add(id)
    const node = world.nodeById[id]
    if (node === undefined) continue
    for (const edgeId of node.outEdges) {
      const edge = world.edgeById[edgeId]
      if (edge !== undefined && !edge.returnLane) stack.push(edge.to)
    }
  }
  return false
}

function validatePlace(world: World, nodeType: NodeType, x: number, y: number): CommandResult {
  const { cols, rows } = world.catalog.board
  const spec = world.catalog.nodes[nodeType]
  if (isPreplaced(nodeType)) return reject(`${spec.name} is pre-placed`)
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= cols || y >= rows) {
    return reject('Off the mat')
  }
  if (nodeAt(world, x, y) !== undefined) return reject('Tile occupied')
  if (ONE_PER_BOARD.includes(nodeType) && world.nodes.some((n) => n.type === nodeType)) return reject(`There's already a ${spec.name.toLowerCase()} on the board`)
  const shortfall = purchaseShortfall(world, spec.build)
  if (shortfall > 0) return reject(`Needs $${shortfall} more`)
  if (nodeType === 'VLLM_CLUSTER') {
    const short = world.catalog.nodes.VLLM_CLUSTER.tiers[0].kw - sparePower(world)
    if (short > 1e-9) return reject(`Needs ${kw(short)} more power. Place a power substation`)
  }
  return OK
}

function validateDemolish(world: World, nodeId: number): CommandResult {
  const node = world.nodeById[nodeId]
  if (node === undefined) return reject('No such node')
  if (isPreplaced(node.type)) return reject(`${node.label} can't be demolished`)
  if (node.type === 'POWER_SUBSTATION' && sparePower(world) + 1e-9 < world.catalog.nodes.POWER_SUBSTATION.kw) {
    const powered = world.nodes.find((n) => n.type === 'VLLM_CLUSTER' && n.powerFromId === node.id)
    return reject(`Powering ${powered === undefined ? 'a vLLM cluster' : world.catalog.nodes.VLLM_CLUSTER.tiers[powered.tier - 1].name}`)
  }
  return OK
}

function validateLink(world: World, from: number, to: number): CommandResult {
  const source = world.nodeById[from]
  const target = world.nodeById[to]
  if (source === undefined || target === undefined) return reject('No such node')
  if (from === to) return reject("Can't link a node to itself")
  if (findEdge(world, from, to) !== undefined) return reject('Already linked')
  if (!CAN_SEND_TO[source.type].includes(target.type)) {
    return reject(`${world.catalog.nodes[source.type].name} can't send to ${world.catalog.nodes[target.type].name}`)
  }
  if (wouldCreateCycle(world, from, to)) return reject(LOOP_REASON)
  return OK
}

/** How the link tool's reasons name each node type: "a router sends to a cache or a model". */
const KIND_PHRASE: Readonly<Record<NodeType, string>> = {
  USERS_IN: 'Users in',
  PROMPT_FIREWALL: 'a firewall',
  PII_REDACTOR: 'a redactor',
  SEMANTIC_CACHE: 'a cache',
  PROMPT_ROUTER: 'a router',
  VECTOR_DB: 'a vector DB',
  BM25_SEARCH: 'BM25',
  RERANKER: 'a reranker',
  FAST_SLM: 'a model',
  FRONTIER_API: 'a model',
  OUTPUT_GUARDRAIL: 'the guardrail',
  USERS_OUT: 'Users out',
  INGESTION_CRON: 'the ingestion cron',
  LANGGRAPH_COORDINATOR: 'a coordinator',
  MCP_WEB_SEARCH: 'web search',
  MCP_CODE_SANDBOX: 'the code sandbox',
  HITL_GATE: 'human review',
  VLLM_CLUSTER: 'a model',
  POWER_SUBSTATION: 'a substation',
  TRACER: 'the tracer',
  LLM_JUDGE: 'the judge',
}

function phraseList(types: readonly NodeType[]): string {
  const phrases = [...new Set(types.map((t) => KIND_PHRASE[t]))]
  if (phrases.length <= 1) return phrases.join('')
  return `${phrases.slice(0, -1).join(', ')} or ${phrases[phrases.length - 1]}`
}

/** What a node type passes on, in plain words, from the connection table. */
function sendsClause(type: NodeType): string {
  const to = CAN_SEND_TO[type]
  if (UNLINKED.includes(type)) return `${KIND_PHRASE[type]} needs no links`
  if (type === 'HITL_GATE') return 'human review answers users itself'
  if (type === 'MCP_WEB_SEARCH' || type === 'MCP_CODE_SANDBOX') return `${KIND_PHRASE[type]} answers its coordinator over the same link`
  if (to.length === 0) return `${KIND_PHRASE[type]} only receives answers`
  return `${KIND_PHRASE[type]} sends to ${phraseList(to)}`
}

/** Where a node type takes its input from, in plain words, from the connection table. */
function takesClause(type: NodeType): string {
  const from = (Object.keys(CAN_SEND_TO) as NodeType[]).filter((t) => CAN_SEND_TO[t].includes(type))
  if (UNLINKED.includes(type)) return `${KIND_PHRASE[type]} needs no links`
  if (from.length === 0) return `${KIND_PHRASE[type]} only sends prompts`
  return `${KIND_PHRASE[type]} takes from ${phraseList(from)}`
}

export type LinkPlan =
  | { readonly ok: true; readonly from: number; readonly to: number; readonly flipped: boolean }
  | { readonly ok: false; readonly reason: string }

/**
 * What the link tool does with a click from one node to another. Prompts flow one way, so a link
 * the connection table only allows the other way round is made that way round (`flipped`). Loops,
 * duplicates and self-links are never flipped. When neither way is allowed, the reason says in
 * plain words what each end connects to. Read-only: the link itself still goes through dispatch.
 */
export function planLink(world: World, from: number, to: number): LinkPlan {
  const forward = validateCommand(world, { type: 'link', from, to })
  if (forward.ok) return { ok: true, from, to, flipped: false }
  const source = world.nodeById[from]
  const target = world.nodeById[to]
  if (source === undefined || target === undefined || from === to || CAN_SEND_TO[source.type].includes(target.type)) {
    return forward
  }
  if (CAN_SEND_TO[target.type].includes(source.type)) {
    const reverse = validateCommand(world, { type: 'link', from: to, to: from })
    if (reverse.ok) return { ok: true, from: to, to: from, flipped: true }
    if (findEdge(world, to, from) !== undefined) {
      return { ok: false, reason: `Already linked the other way, ${target.label} to ${source.label}` }
    }
    return reverse
  }
  return {
    ok: false,
    reason: `${source.label} and ${target.label} can't be linked either way: ${sendsClause(source.type)}, and ${takesClause(target.type)}.`,
  }
}

function validateUnlink(world: World, from: number, to: number): CommandResult {
  if (world.nodeById[from] === undefined || world.nodeById[to] === undefined) return reject('No such node')
  if (findEdge(world, from, to) === undefined) return reject('Not linked')
  return OK
}

/** A tiered node's tiers: a vector DB's (D45) or a vLLM cluster's (J-1). */
function tiersOf(world: World, node: GameNode): readonly { readonly name: string; readonly upgrade: number }[] {
  return node.type === 'VLLM_CLUSTER' ? world.catalog.nodes.VLLM_CLUSTER.tiers : world.catalog.nodes.VECTOR_DB.tiers
}

/** What raising a tiered node to a tier costs: every tier's upgrade price above its current one (D45, J-1). */
export function tierUpgradeCost(world: World, node: GameNode, tier: number): number {
  const tiers = tiersOf(world, node)
  let cost = 0
  for (let t = node.tier; t < tier; t++) cost += tiers[t].upgrade
  return cost
}

/** Models that can take prefix caching: the hosted ones (vLLM's own is out of Milestone 4). */
function isModelNode(node: GameNode): boolean {
  return node.type === 'FAST_SLM' || node.type === 'FRONTIER_API'
}

function takesBreaker(node: GameNode): boolean {
  return node.type === 'FAST_SLM' || node.type === 'FRONTIER_API' || node.type === 'VLLM_CLUSTER'
}

function isStrictness(value: SettingValue): value is Strictness {
  return typeof value === 'string' && (STRICTNESS_LEVELS as readonly string[]).includes(value)
}

/**
 * The settings (D7, D15, D45, I-2): Users in's `maxPerSec` throttle (0 is off), a semantic cache's
 * `strictness`, a vector DB's `tier`, which only goes up and charges the difference, a
 * coordinator's `maxSteps` (0 is off), a model's `prefixCache` (paid once, then free to toggle),
 * and a Frontier node's `provider`.
 */
function validateSetting(world: World, nodeId: number, key: string, value: SettingValue): CommandResult {
  const node = world.nodeById[nodeId]
  if (node === undefined) return reject('No such node')
  if (node.type === 'USERS_IN' && key === 'maxPerSec') {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? OK : reject('The throttle needs 0 or more prompts per second')
  }
  if (node.type === 'SEMANTIC_CACHE' && key === 'strictness') {
    return isStrictness(value) ? OK : reject('Strictness is Loose, Balanced or Strict')
  }
  if ((node.type === 'VECTOR_DB' || node.type === 'VLLM_CLUSTER') && key === 'tier') {
    const tiers = tiersOf(world, node)
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > tiers.length) return reject(`Tiers run from 1 to ${tiers.length}`)
    if (value <= node.tier) return reject(`${node.label} is already ${tiers[node.tier - 1].name}. Tiers only go up`)
    const shortfall = purchaseShortfall(world, tierUpgradeCost(world, node, value))
    if (shortfall > 0) return reject(`Needs $${shortfall} more`)
    if (node.type === 'VLLM_CLUSTER') {
      const short = world.catalog.nodes.VLLM_CLUSTER.tiers[value - 1].kw - powerDraw(world, node) - sparePower(world)
      if (short > 1e-9) return reject(`Needs ${kw(short)} more power. Place a power substation`)
    }
    return OK
  }
  if (takesBreaker(node) && key === 'breaker') {
    if (typeof value !== 'boolean') return reject('The circuit breaker is on or off')
    if (!value || node.breakerBought) return OK
    const shortfall = purchaseShortfall(world, world.catalog.breaker.build)
    return shortfall > 0 ? reject(`Needs $${shortfall} more`) : OK
  }
  if (node.type === 'LLM_JUDGE' && key === 'sampleRate') {
    const choices = world.catalog.nodes.LLM_JUDGE.sampleChoices
    return typeof value === 'number' && choices.includes(value) ? OK : reject(`The judge samples ${[...choices].sort((a, b) => a - b).map((c) => `${c * 100}%`).join(', ')}`)
  }
  if (node.type === 'LANGGRAPH_COORDINATOR' && key === 'maxSteps') {
    const choices = world.catalog.nodes.LANGGRAPH_COORDINATOR.maxStepsChoices
    return typeof value === 'number' && choices.includes(value) ? OK : reject(`Max steps is ${choices.map((c) => (c === 0 ? 'Off' : c)).join(', ')}`)
  }
  if (isModelNode(node) && key === 'prefixCache') {
    if (typeof value !== 'boolean') return reject('Prefix caching is on or off')
    if (!value || node.prefixCacheBought) return OK
    const shortfall = purchaseShortfall(world, world.catalog.prefixCache.build)
    return shortfall > 0 ? reject(`Needs $${shortfall} more`) : OK
  }
  if (node.type === 'FRONTIER_API' && key === 'provider') {
    return typeof value === 'string' && world.providers.some((p) => p.name === value) ? OK : reject(`Providers are ${world.providers.map((p) => p.name).join(' and ')}`)
  }
  return reject(`${node.label} has no setting called "${key}"`)
}

function applySetting(world: World, node: GameNode, key: string, value: SettingValue): void {
  if (key === 'maxPerSec' && typeof value === 'number') {
    node.throttlePerSec = value
    // A new throttle starts with a full second of burst.
    node.bucket = value
  } else if (key === 'strictness' && isStrictness(value)) {
    node.strictness = value
  } else if (key === 'tier' && typeof value === 'number') {
    const cost = tierUpgradeCost(world, node, value)
    world.budget -= cost
    world.stats.buildSpend += cost
    node.spent += cost
    node.tier = value
    if (node.type === 'VLLM_CLUSTER') {
      // A new model means loading new weights: cold again, upkeep running (J-1).
      const tier = world.catalog.nodes.VLLM_CLUSTER.tiers[value - 1]
      node.kvBudget = tier.kvTokens
      node.coldUntilTick = world.tick + Math.round(tier.coldStartSec * ticksPerSecond(world.catalog))
      assignPower(world)
    } else {
      node.concurrency = world.catalog.nodes.VECTOR_DB.tiers[value - 1].concurrency
    }
    recomputeUpkeep(world)
    pushIncident(world, 'info', `Upgraded ${node.label} to ${tiersOf(world, node)[value - 1].name}.`, node.id)
  } else if (key === 'maxSteps' && typeof value === 'number') {
    node.maxSteps = value
  } else if (key === 'prefixCache' && typeof value === 'boolean') {
    if (value && !node.prefixCacheBought) {
      const cost = world.catalog.prefixCache.build
      world.budget -= cost
      world.stats.buildSpend += cost
      node.spent += cost
      node.prefixCacheBought = true
    }
    node.prefixCache = value
  } else if (key === 'breaker' && typeof value === 'boolean') {
    if (value && !node.breakerBought) {
      const cost = world.catalog.breaker.build
      world.budget -= cost
      world.stats.buildSpend += cost
      node.spent += cost
      node.breakerBought = true
    }
    node.breakerOn = value
    if (!value) resetBreaker(node)
  } else if (key === 'sampleRate' && typeof value === 'number') {
    node.sampleRate = value
  } else if (key === 'provider' && typeof value === 'string') {
    // Calls already running finish on the old provider's pool (pipeline.ts).
    node.providerIndex = world.providers.findIndex((p) => p.name === value)
    relabel(world, node.type)
  }
}

export function validateCommand(world: World, command: Command): CommandResult {
  if (world.gameOver !== null) return reject('The run is over')
  switch (command.type) {
    case 'placeNode':
      return validatePlace(world, command.nodeType, command.x, command.y)
    case 'demolish':
      return validateDemolish(world, command.nodeId)
    case 'link':
      return validateLink(world, command.from, command.to)
    case 'unlink':
      return validateUnlink(world, command.from, command.to)
    case 'setSetting':
      return validateSetting(world, command.nodeId, command.key, command.value)
    case 'endRun':
      return OK
  }
}

function lostSentence(count: number): string {
  return count === 1 ? '1 prompt was lost.' : `${count} prompts were lost.`
}

/** Validates and, if valid, applies a command now. */
export function applyCommand(world: World, command: Command): CommandResult {
  const valid = validateCommand(world, command)
  if (!valid.ok) return valid

  switch (command.type) {
    case 'placeNode': {
      const build = world.catalog.nodes[command.nodeType].build
      world.budget -= build
      world.stats.buildSpend += build
      const node = addNode(world, command.nodeType, command.x, command.y)
      return { ok: true, nodeId: node.id }
    }
    case 'demolish': {
      const node = world.nodeById[command.nodeId] as GameNode
      // Half of everything paid for it, upgrades included (D4, D45).
      world.budget += refundFor(world.catalog, node.spent)
      const lost = removeNode(world, node)
      if (lost > 0) pushIncident(world, 'info', `Demolished ${node.label}. ${lostSentence(lost)}`, null)
      return OK
    }
    case 'link': {
      const from = world.nodeById[command.from] as GameNode
      const to = world.nodeById[command.to] as GameNode
      const edge = addEdge(world, from, to)
      if (isTwoLane(from.type, to.type)) addEdge(world, to, from, true)
      return { ok: true, edgeId: edge.id }
    }
    case 'unlink': {
      const edge = findEdge(world, command.from, command.to) as Edge
      // A two-lane link goes as one, whichever lane was picked.
      const partner = findEdge(world, command.to, command.from)
      let lost = removeEdge(world, edge)
      if (partner !== undefined && (partner.returnLane || edge.returnLane)) lost += removeEdge(world, partner)
      if (lost > 0) {
        const from = world.nodeById[command.from] as GameNode
        const to = world.nodeById[command.to] as GameNode
        pushIncident(world, 'info', `Unlinked ${from.label} from ${to.label}. ${lostSentence(lost)}`, null)
      }
      return OK
    }
    case 'setSetting':
      applySetting(world, world.nodeById[command.nodeId] as GameNode, command.key, command.value)
      return OK
    case 'endRun':
      world.gameOver = { cause: 'ENDED', tick: world.tick }
      pushIncident(world, 'info', 'You ended the run.', null)
      return OK
  }
}
