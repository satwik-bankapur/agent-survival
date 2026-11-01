/*
 * Preallocated packets with a free list (D31). Nothing allocates per packet:
 * acquire() hands out a reset slot, release() puts it back.
 */

import { AgentStep, Loc, type Packet } from './types'

function blankPacket(index: number): Packet {
  return {
    index,
    serial: 0,
    category: 'CHAT',
    difficulty: 'SIMPLE',
    createdTick: 0,
    deadlineTick: 0,
    newInputTokens: 0,
    cachedPrefixTokens: 0,
    outputTokensGenerated: 0,
    contextQuality: 0,
    contextTokens: 0,
    drift: 0,
    retrievalMask: 0,
    systemPromptTokens: 0,
    requiredToolSteps: 0,
    completedToolSteps: 0,
    loopCount: 0,
    lastVisitedNodeType: null,
    toolPlan: 0,
    agentStep: AgentStep.NEXT_MODEL,
    coordinatorId: -1,
    cacheModelId: -1,
    stuck: false,
    tainted: false,
    fabricated: false,
    lateScored: false,
    runaway: false,
    lastPassCost: 0,
    passTick: 0,
    cachedAtTick: 0,
    callFails: false,
    containsPII: false,
    redacted: false,
    isMaliciousInjection: false,
    isHallucinated: false,
    isMalformedJson: false,
    hasRetriedSchema: false,
    revealed: false,
    producedByModelId: -1,
    cacheHit: false,
    refused: false,
    loc: Loc.FREE,
    edgeId: -1,
    lane: 0,
    enterTick: 0,
    transitTicks: 0,
    nodeId: -1,
    fromNodeId: -1,
    slot: -1,
  }
}

function resetPacket(p: Packet): void {
  p.serial = 0
  p.category = 'CHAT'
  p.difficulty = 'SIMPLE'
  p.createdTick = 0
  p.deadlineTick = 0
  p.newInputTokens = 0
  p.cachedPrefixTokens = 0
  p.outputTokensGenerated = 0
  p.contextQuality = 0
  p.contextTokens = 0
  p.drift = 0
  p.retrievalMask = 0
  p.systemPromptTokens = 0
  p.requiredToolSteps = 0
  p.completedToolSteps = 0
  p.loopCount = 0
  p.lastVisitedNodeType = null
  p.toolPlan = 0
  p.agentStep = AgentStep.NEXT_MODEL
  p.coordinatorId = -1
  p.cacheModelId = -1
  p.stuck = false
  p.tainted = false
  p.fabricated = false
  p.lateScored = false
  p.runaway = false
  p.lastPassCost = 0
  p.passTick = 0
  p.cachedAtTick = 0
  p.callFails = false
  p.containsPII = false
  p.redacted = false
  p.isMaliciousInjection = false
  p.isHallucinated = false
  p.isMalformedJson = false
  p.hasRetriedSchema = false
  p.revealed = false
  p.producedByModelId = -1
  p.cacheHit = false
  p.refused = false
  p.loc = Loc.FREE
  p.edgeId = -1
  p.lane = 0
  p.enterTick = 0
  p.transitTicks = 0
  p.nodeId = -1
  p.fromNodeId = -1
  p.slot = -1
}

export class PacketPool {
  readonly packets: readonly Packet[]
  private readonly free: Int32Array
  private freeTop: number
  private nextSerial = 1

  constructor(size: number) {
    const packets: Packet[] = []
    for (let i = 0; i < size; i++) packets.push(blankPacket(i))
    this.packets = packets
    this.free = new Int32Array(size)
    // Hand out low indices first, so runs read naturally in a debugger.
    for (let i = 0; i < size; i++) this.free[i] = size - 1 - i
    this.freeTop = size
  }

  get size(): number {
    return this.packets.length
  }

  get liveCount(): number {
    return this.packets.length - this.freeTop
  }

  /** A reset packet's index, or -1 when the pool is empty (the caller throttles, D31). */
  acquire(): number {
    if (this.freeTop === 0) return -1
    this.freeTop--
    const index = this.free[this.freeTop]
    this.packets[index].serial = this.nextSerial++
    return index
  }

  release(index: number): void {
    resetPacket(this.packets[index])
    this.free[this.freeTop] = index
    this.freeTop++
  }
}
