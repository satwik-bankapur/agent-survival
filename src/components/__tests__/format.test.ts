import { describe, expect, it } from 'vitest'

import {
  MINUS,
  formatClock,
  formatDuration,
  formatMoney,
  formatPhaseStart,
  formatRate,
  formatShare,
  formatSeed,
  formatTokens,
  trafficMix,
  formatRunNumber,
  parseSeed,
  formatTrust,
  formatWholeMoney,
  sharedProviderNote,
  splitNumberText,
} from '../format'

describe('HUD number formats', () => {
  it('writes budgets with thousands separators and a true minus', () => {
    expect(formatMoney(1284.5)).toBe('$1,284.50')
    expect(formatMoney(237.4)).toBe('$237.40')
    expect(formatMoney(-12)).toBe(`${MINUS}$12.00`)
    expect(formatMoney(-0.001)).toBe('$0.00')
    expect(formatWholeMoney(-1000)).toBe(`${MINUS}$1,000`)
    expect(formatWholeMoney(55)).toBe('$55')
  })

  it('signs money rates, and drops the sign at zero', () => {
    expect(formatRate(2.1)).toBe('+$2.10/s')
    expect(formatRate(-12.82)).toBe(`${MINUS}$12.82/s`)
    expect(formatRate(0)).toBe('$0.00/s')
    expect(formatRate(-0.004)).toBe('$0.00/s')
  })

  it('writes countdowns in seconds, minutes or hours', () => {
    expect(formatDuration(43.9)).toBe('43s')
    expect(formatDuration(283)).toBe('4m 43s')
    expect(formatDuration(3900)).toBe('1h 5m')
    expect(formatDuration(-3)).toBe('0s')
  })

  it('writes trust to one decimal, with 100% at the top', () => {
    expect(formatTrust(87.44)).toBe('87.4%')
    expect(formatTrust(21.4)).toBe('21.4%')
    expect(formatTrust(99.97)).toBe('100%')
    expect(formatTrust(100)).toBe('100%')
  })

  it('writes shares, the clock and phase starts', () => {
    expect(formatShare(0.756)).toBe('76%')
    expect(formatClock(372.9)).toBe('6:12')
    expect(formatClock(0)).toBe('0:00')
    expect(formatPhaseStart(120, false)).toBe('2:00')
    expect(formatPhaseStart(540, true)).toBe('9:00 on')
  })
})

describe('splitNumberText (the B612 Mono punctuation fix)', () => {
  it('splits out every ".", "," and ":" and keeps everything else together', () => {
    expect(splitNumberText('$1,284.50')).toEqual([
      { text: '$1', punct: false },
      { text: ',', punct: true },
      { text: '284', punct: false },
      { text: '.', punct: true },
      { text: '50', punct: false },
    ])
    expect(splitNumberText('0.42 s')).toEqual([
      { text: '0', punct: false },
      { text: '.', punct: true },
      { text: '42 s', punct: false },
    ])
    expect(splitNumberText('6:12')).toEqual([
      { text: '6', punct: false },
      { text: ':', punct: true },
      { text: '12', punct: false },
    ])
    expect(splitNumberText('87%')).toEqual([{ text: '87%', punct: false }])
    expect(splitNumberText('')).toEqual([])
  })

  it('gives values of the same format the same run structure, so their width never changes', () => {
    const shape = (t: string) => splitNumberText(t).map((r) => (r.punct ? r.text : r.text.length))
    expect(shape(formatMoney(1284.5))).toEqual(shape(formatMoney(1279.1)))
    expect(shape(formatRate(-12.82))).toEqual(shape(formatRate(-10.05)))
  })
})

describe('seeds', () => {
  it('prints a 24-bit seed as six hex digits and reads it back', () => {
    expect(formatSeed(0xa7f329)).toBe('A7F3-29')
    expect(formatSeed(1)).toBe('0000-01')
    expect(parseSeed('A7F3-29')).toBe(0xa7f329)
    expect(parseSeed('a7f329')).toBe(0xa7f329)
    expect(parseSeed('A7F3-2')).toBe(null)
  })
})

describe('postmortem numbers', () => {
  it('shortens token counts and pads run numbers', () => {
    expect(formatTokens(940)).toBe('940')
    expect(formatTokens(4820)).toBe('4.82K')
    expect(formatTokens(48_200)).toBe('48.2K')
    expect(formatTokens(3_210_000)).toBe('3.2M')
    expect(formatRunNumber(42)).toBe('0042')
  })
})

describe('shared provider note (D14)', () => {
  const frontier = (id: number, label: string) => ({ id, label, provider: 'A' })
  const router = { id: 9, label: 'Prompt router', provider: null }

  it('says nothing for a lone Frontier, or for a node with no provider', () => {
    expect(sharedProviderNote([frontier(2, 'Frontier A'), router], 'A', 2)).toBeNull()
    expect(sharedProviderNote([frontier(2, 'Frontier A')], null, 9)).toBeNull()
  })

  it('names the other node on the provider', () => {
    const nodes = [frontier(2, 'Frontier A'), frontier(5, 'Frontier A 2'), router]
    expect(sharedProviderNote(nodes, 'A', 5)).toBe('Same provider as Frontier A: shares its rate limit')
    expect(sharedProviderNote(nodes, 'A', 2)).toBe('Same provider as Frontier A 2: shares its rate limit')
  })

  it('warns a ghost about to join a provider already on the board', () => {
    expect(sharedProviderNote([router], 'A', null)).toBeNull()
    expect(sharedProviderNote([frontier(5, 'Frontier A 2'), frontier(2, 'Frontier A')], 'A', null)).toBe(
      'Same provider as Frontier A: shares its rate limit',
    )
  })
})

describe('trafficMix', () => {
  it('splits arrivals into simple chat, complex chat, RAG, agents and attacks that sum to 1', () => {
    // 100 arrivals: 40 simple chats + 5 attacks (simple), 15 complex chats + 30 RAG + 10 agent tasks (complex).
    const mix = trafficMix({ simpleShare: 0.45, complexShare: 0.55, categoryShare: { RAG_QUERY: 0.3, AGENT_TASK: 0.1, ADVERSARIAL: 0.05 } })
    expect(mix.map((m) => m.category)).toEqual(['chat', 'complex', 'rag', 'agent', 'adv'])
    expect(mix.map((m) => m.share)).toEqual([0.4, 0.15, 0.3, 0.1, 0.05].map((v) => expect.closeTo(v) as number))
    expect(mix.reduce((sum, m) => sum + m.share, 0)).toBeCloseTo(1)
  })

  it('is all chat in phase 1, and empty before any arrival', () => {
    expect(trafficMix({ simpleShare: 0.8, complexShare: 0.2, categoryShare: { RAG_QUERY: 0, AGENT_TASK: 0, ADVERSARIAL: 0 } }).map((m) => m.share)).toEqual([0.8, 0.2, 0, 0, 0])
    expect(trafficMix({ simpleShare: 0, complexShare: 0, categoryShare: { RAG_QUERY: 0, AGENT_TASK: 0, ADVERSARIAL: 0 } }).every((m) => m.share === 0)).toBe(true)
  })
})
