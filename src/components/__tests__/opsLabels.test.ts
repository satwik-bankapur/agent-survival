import { describe, expect, it } from 'vitest'

import { DEFAULT_CATALOG } from '../../engine'
import { coldStartCost } from '../../engine/telemetry'
import { coldStartLine } from '../NodeInspectorDrawer'
import { lowerFirst } from '../RightOpsPanels'

describe('Milestone 4 labels', () => {
  it("states a cold start's cost the way the inspector does (J-1)", () => {
    expect(coldStartLine({ coldStartCost: coldStartCost(DEFAULT_CATALOG, 2) })).toBe('Loading weights: about $1,400 of upkeep before first token')
    expect(coldStartLine({ coldStartCost: coldStartCost(DEFAULT_CATALOG, 1) })).toBe('Loading weights: about $23 of upkeep before first token')
  })

  it('keeps an acronym capitalised mid-sentence', () => {
    expect(lowerFirst('Tracer')).toBe('tracer')
    expect(lowerFirst('LLM judge')).toBe('LLM judge')
  })
})
