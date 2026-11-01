/*
 * The field guide covers every node and every idea, answers all four
 * questions for each, and takes its numbers from the catalog.
 */

import { describe, expect, it } from 'vitest'

import { DEFAULT_CATALOG, NODE_TYPES } from '../../engine'
import { GUIDE, guideEntry, TEACHING } from '../guide'

const IDEAS = ['tokens', 'ttft-tpot', 'rag-drift', 'prefix-caching', 'compounding-errors', 'circuit-breakers', 'continuous-batching', 'throttling']

describe('the field guide', () => {
  it('has an entry for every node type', () => {
    for (const type of NODE_TYPES) {
      const entry = guideEntry(type)
      expect(entry, type).toBeDefined()
      expect(entry?.name).toBe(DEFAULT_CATALOG.nodes[type].name)
      expect(entry?.here).toBe(TEACHING[type])
    }
  })

  it('has an entry for every idea the game teaches', () => {
    for (const id of IDEAS) expect(guideEntry(id), id).toBeDefined()
  })

  it('answers all four questions, every time', () => {
    for (const entry of GUIDE) {
      for (const field of [entry.here, entry.real, entry.buy, entry.spiral]) {
        expect(field.length, `${entry.id}: ${field}`).toBeGreaterThan(30)
      }
    }
  })

  it('takes its prices from the catalog', () => {
    // If the catalog moves, the guide moves with it.
    expect(guideEntry('SEMANTIC_CACHE')?.buy).toContain(`$${DEFAULT_CATALOG.nodes.SEMANTIC_CACHE.build}`)
    expect(guideEntry('prefix-caching')?.here).toContain(`$${DEFAULT_CATALOG.prefixCache.build}`)
    expect(guideEntry('circuit-breakers')?.here).toContain(`${DEFAULT_CATALOG.breaker.openSec} s`)
  })
})
