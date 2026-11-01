import { describe, expect, it } from 'vitest'

import { DEFAULT_CATALOG } from '../../engine'
import {
  PLAZA_FULL,
  RACK_MAX,
  RACK_RADIUS,
  Urgency,
  entryCrowd,
  exitCrowd,
  rackSlotAngle,
  rackUrgency,
  rackView,
} from '../paths'

describe('queue racks (D38)', () => {
  it('caps the visible rack at 12 and counts the rest', () => {
    expect(RACK_MAX).toBe(12)
    expect(rackView(64)).toEqual({ shown: 12, overflow: 52 })
    expect(rackView(13)).toEqual({ shown: 12, overflow: 1 })
    expect(rackView(12)).toEqual({ shown: 12, overflow: 0 })
    expect(rackView(5)).toEqual({ shown: 5, overflow: 0 })
    expect(rackView(0)).toEqual({ shown: 0, overflow: 0 })
  })

  it('overflows on every Milestone 1 queue once it is full', () => {
    for (const type of ['FAST_SLM', 'FRONTIER_API', 'SEMANTIC_CACHE', 'PROMPT_ROUTER', 'OUTPUT_GUARDRAIL'] as const) {
      const capacity = DEFAULT_CATALOG.nodes[type].queueCapacity
      expect(rackView(capacity).overflow).toBe(capacity - RACK_MAX)
    }
    expect(rackView(DEFAULT_CATALOG.nodes.FAST_SLM.queueCapacity)).toEqual({ shown: 12, overflow: 52 })
  })

  it('lays the ring out from the back left, evenly, just outside the footprint', () => {
    expect(RACK_RADIUS).toBeCloseTo(0.63)
    expect(rackSlotAngle(0)).toBeCloseTo((-135 * Math.PI) / 180)
    expect(rackSlotAngle(3) - rackSlotAngle(2)).toBeCloseTo(Math.PI / 6)
    expect(rackSlotAngle(12) - rackSlotAngle(0)).toBeCloseTo(2 * Math.PI)
  })

  it('turns a slot amber at half its deadline and red near it', () => {
    // Created at tick 0 with a 120-tick (6 s) deadline.
    expect(rackUrgency(59, 0, 120)).toBe(Urgency.NORMAL)
    expect(rackUrgency(60, 0, 120)).toBe(Urgency.WARN)
    expect(rackUrgency(101, 0, 120)).toBe(Urgency.WARN)
    expect(rackUrgency(102, 0, 120)).toBe(Urgency.ALARM)
    expect(rackUrgency(500, 0, 120)).toBe(Urgency.ALARM)
  })
})

describe('plaza crowds', () => {
  it('fills the exit at high trust and thins as trust falls', () => {
    expect(exitCrowd(100)).toBe(PLAZA_FULL)
    expect(exitCrowd(90)).toBe(PLAZA_FULL)
    expect(exitCrowd(45)).toBe(15)
    expect(exitCrowd(24)).toBe(8)
    expect(exitCrowd(0)).toBe(0)
  })

  it('grows the entry with traffic', () => {
    expect(entryCrowd(0)).toBe(6)
    expect(entryCrowd(6)).toBe(12)
    expect(entryCrowd(16)).toBe(32)
    expect(entryCrowd(100)).toBe(44)
  })
})
