/*
 * Trust composition: what a build's trust is made of. For each build and time window it counts
 * every outcome over 40 seeds (while each run is alive), and shows each source's share of
 * outcomes and its contribution to the trust ratio: count × score ÷ outcomes, so the rows add up
 * to the window's mean score, which is what trust tracks (D8). Reported wrong answers add −15 to
 * S without adding an outcome (D10). Then the wrong answers served, by the node that produced
 * them and by kind of prompt, and the mean trust outside director events. Ground truth (D39).
 *
 *   npx tsx scripts/trust.ts [seeds]
 */

import {
  GameEngine,
  NODE_TYPES,
  PHASE4_SCENARIOS,
  TRUST_COLUMNS,
  TRUST_SOURCES,
  attachScenario,
  catalogFor,
  formatClock,
  trustValue,
  type Scenario,
  type World,
} from '../src/engine/index'

const seeds = Number(process.argv[2] ?? 40)
const WINDOWS: readonly (readonly [number, number])[] = [
  [420, 540],
  [600, 720],
]
const BUILDS = ['p4-m3-endless', 'p4-m4-endless']

const SCORE: Readonly<Record<string, number>> = {
  GOOD: 1,
  REFUSED: 0.5,
  REVIEWED: 0.5,
  THROTTLED_IN: 0.8,
  THROTTLED_AGENT: 0.8,
  AGENT_REFUSED: -3,
  BREACH: -14,
  WRONG_REPORTED: -15,
}
const scoreOf = (source: string): number => SCORE[source] ?? -3

interface Window {
  readonly counts: Float64Array
  /** Wrong answers served, by producer label's type, and served answers in all. */
  readonly wrongBy: Map<string, number>
  served: number
  quietTrust: number
  quietSeconds: number
  runsAlive: number
}

/** Wrong answers served so far by producer type, from the run log's tallies. */
function wrongByType(world: World): Map<string, number> {
  const out = new Map<string, number>()
  for (const t of world.runLog.tallies) if (t !== undefined && t.wrongServed > 0) out.set(t.type, (out.get(t.type) ?? 0) + t.wrongServed)
  return out
}

function run(scenario: Scenario): Window[] {
  const windows: Window[] = WINDOWS.map(() => ({ counts: new Float64Array(TRUST_SOURCES.length * TRUST_COLUMNS), wrongBy: new Map(), served: 0, quietTrust: 0, quietSeconds: 0, runsAlive: 0 }))
  const end = WINDOWS[WINDOWS.length - 1][1]
  for (let seed = 1; seed <= seeds; seed++) {
    const engine = new GameEngine({ seed, catalog: catalogFor(scenario) })
    attachScenario(engine, scenario)
    const w = engine.world
    const starts = WINDOWS.map(() => ({ tally: new Float64Array(w.runLog.trustTally.length), wrong: new Map<string, number>(), served: 0 }))
    for (let t = 0; t <= end * 20 && w.gameOver === null; t++) {
      const sec = t / 20
      WINDOWS.forEach(([from, to], i) => {
        if (t === from * 20) {
          starts[i].tally.set(w.runLog.trustTally)
          starts[i].wrong = wrongByType(w)
          starts[i].served = w.stats.served
          windows[i].runsAlive++
        }
        if (sec >= from && sec < to && t % 20 === 0 && w.director.stage !== 'active') {
          windows[i].quietTrust += trustValue(w.trust)
          windows[i].quietSeconds++
        }
      })
      engine.tick()
      WINDOWS.forEach(([from, to], i) => {
        if (!(t + 1 === to * 20 || (w.gameOver !== null && sec >= from && sec < to))) return
        for (let k = 0; k < starts[i].tally.length; k++) windows[i].counts[k] += w.runLog.trustTally[k] - starts[i].tally[k]
        for (const [type, n] of wrongByType(w)) windows[i].wrongBy.set(type, (windows[i].wrongBy.get(type) ?? 0) + n - (starts[i].wrong.get(type) ?? 0))
        windows[i].served += w.stats.served - starts[i].served
      })
    }
  }
  return windows
}

for (const id of BUILDS) {
  const scenario = PHASE4_SCENARIOS.find((s) => s.id === id)
  if (scenario === undefined) continue
  run(scenario).forEach((win, i) => {
    const [from, to] = WINDOWS[i]
    const rows: { label: string; count: number; source: string }[] = []
    for (let s = 0; s < TRUST_SOURCES.length; s++) {
      const source = TRUST_SOURCES[s]
      const perNode = scoreOf(source) === -3 && source !== 'AGENT_REFUSED'
      if (!perNode) {
        let count = 0
        for (let c = 0; c < TRUST_COLUMNS; c++) count += win.counts[s * TRUST_COLUMNS + c]
        if (count > 0) rows.push({ label: source, count, source })
        continue
      }
      for (let c = 0; c < TRUST_COLUMNS; c++) {
        const count = win.counts[s * TRUST_COLUMNS + c]
        if (count > 0) rows.push({ label: `${source} at ${c < NODE_TYPES.length ? NODE_TYPES[c] : 'none'}`, count, source })
      }
    }
    const outcomes = rows.filter((r) => r.source !== 'WRONG_REPORTED').reduce((n, r) => n + r.count, 0)
    rows.sort((a, b) => Math.abs(b.count * scoreOf(b.source)) - Math.abs(a.count * scoreOf(a.source)))
    const mean = rows.reduce((m, r) => m + (r.count * scoreOf(r.source)) / outcomes, 0)
    console.log(`\n${scenario.label}, ${formatClock(from)}–${formatClock(to)}: ${win.runsAlive} of ${seeds} runs alive at the start, ${Math.round(outcomes / Math.max(1, win.runsAlive))} outcomes a run.`)
    console.log(`Mean score ${(mean * 100).toFixed(1)}; mean trust outside events ${(win.quietTrust / Math.max(1, win.quietSeconds)).toFixed(1)}%.\n`)
    console.log(`${'Source'.padEnd(36)} ${'Share'.padStart(7)} ${'Contribution'.padStart(13)}`)
    for (const r of rows) {
      const share = r.source === 'WRONG_REPORTED' ? '(no N)' : `${((100 * r.count) / outcomes).toFixed(1)}%`
      console.log(`${r.label.padEnd(36)} ${share.padStart(7)} ${((100 * r.count * scoreOf(r.source)) / outcomes).toFixed(1).padStart(13)}`)
    }
    const wrong = [...win.wrongBy.values()].reduce((a, b) => a + b, 0)
    console.log(`\nWrong answers served: ${((100 * wrong) / Math.max(1, win.served)).toFixed(2)}% of answers. By producer:`)
    for (const [type, n] of [...win.wrongBy].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type.padEnd(20)} ${((100 * n) / wrong).toFixed(1).padStart(5)}% of wrong answers, ${((100 * 15 * n) / outcomes).toFixed(1)} trust points`)
    }
  })
}
