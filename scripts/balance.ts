/*
 * The headless balance report. First the unit economics, computed from the
 * catalog before anything runs: one agent task by path, its runaway, and one
 * model serving the 9:00 mix with and without prefix caching (I-3); every
 * RAG path on Frontier and on Fast SLM; and what leaked PII and attacks cost
 * per second at phase 2 traffic; and Milestone 4's: vLLM capacity by context,
 * self-hosting against Frontier, and the judge's costs (J-1 to J-3). Then
 * every scenario across 40 seeds: the classic table (decisions section G,
 * D40) and the phase 2 table (D49) for 5:00, the phase 3 table (I-4) for
 * 9:00, and the phase 4 table (J-6): the outage drill and the endless phase.
 *
 * A big miss (over 10 points, D49) means stop and review the tables before
 * tuning anything.
 *
 *   npm run balance            40 seeds
 *   npm run balance -- 20      another seed count
 */

import {
  CLASSIC_SCENARIOS,
  DEFAULT_CATALOG,
  PHASE2_SCENARIOS,
  PHASE3_SCENARIOS,
  PHASE4_SCENARIOS,
  agentPassCosts,
  capacityShapes,
  judgeCosts,
  judgeSpendPerSec,
  selfHostEconomics,
  vllmCapacity,
  agentPaths,
  catalogFor,
  checkTarget,
  formatClock,
  leakCosts,
  modelMixEconomics,
  ragPaths,
  referenceIdOf,
  runawayCosts,
  runScenario,
  scenarioById,
  summarize,
  type RunResult,
  type Scenario,
} from '../src/engine/index'

const seeds = Number(process.argv[2] ?? 40)

function printTable(header: readonly string[], rows: readonly string[][], right: ReadonlySet<number> = new Set()): void {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))
  const cell = (c: string, i: number): string => (right.has(i) ? c.padStart(widths[i]) : c.padEnd(widths[i]))
  console.log(header.map(cell).join('  '))
  console.log(widths.map((w) => '-'.repeat(w)).join('  '))
  for (const row of rows) console.log(row.map(cell).join('  '))
}

const dollars = (x: number): string => `${x < 0 ? '−' : ''}$${Math.abs(x).toFixed(2)}`
const wholeDollars = (x: number): string => `${x < 0 ? '−' : ''}$${Math.round(Math.abs(x)).toLocaleString('en-US')}`
const percent = (x: number): string => `${(x * 100).toFixed(1)}%`

// ---------------------------------------------------------------------------
// Unit economics
// ---------------------------------------------------------------------------

const catalog = DEFAULT_CATALOG
const agent = catalog.traffic.agent
const steps = (n: number): string => (n === 0 ? 'Off' : String(n))
console.log(
  `Agent unit economics (I-3): one task, means over the tool mix. Revenue $${agent.revenue} + $${agent.revenuePerTool} a tool, only for answers by the ${agent.deadlineSec} s`,
)
console.log('deadline. Broken: hit max steps unfinished. Late: still running at the deadline (with max steps off, the runaways). No queues.\n')
printTable(
  ['Model', 'Max steps', 'Prefix cache', 'Cost', 'Revenue', 'Margin', 'Success', 'Wrong', 'Broken', 'Late', 'Passes', 'Latency'],
  agentPaths(catalog).map((r) => [
    r.label,
    steps(r.maxSteps),
    r.prefixCache ? 'on' : 'off',
    dollars(r.cost),
    dollars(r.revenue),
    dollars(r.margin),
    percent(r.success),
    percent(r.wrong),
    percent(r.broken),
    percent(r.late),
    r.passes.toFixed(2),
    `${(r.latencyMs / 1000).toFixed(1)} s`,
  ]),
  new Set([3, 4, 5, 6, 7, 8, 9, 10, 11]),
)

console.log('\nCost per pass of a [SEARCH, CODE] task with no failures: the quadratic growth.\n')
const passModels = [
  { label: 'Frontier A', spec: catalog.nodes.FRONTIER_API },
  { label: 'Fast SLM', spec: catalog.nodes.FAST_SLM },
]
const passRows: string[][] = []
for (const m of passModels) {
  for (const cache of [false, true]) {
    const costs = agentPassCosts(catalog, m.spec, cache)
    passRows.push([m.label, cache ? 'on' : 'off', costs.map(dollars).join(' + '), dollars(costs.reduce((a, b) => a + b, 0))])
  }
}
printTable(['Model', 'Prefix cache', 'Passes', 'Total'], passRows, new Set([3]))

console.log('\nA stuck [SEARCH] run on Frontier A with max steps off: what it has burned by each time.\n')
const RUNAWAY_TIMES = [40, 120, 240]
const runawayRows: string[][] = []
for (const cache of [false, true]) {
  for (const r of runawayCosts(catalog, cache, RUNAWAY_TIMES)) {
    runawayRows.push([cache ? 'on' : 'off', `${r.sec} s`, String(r.passes), dollars(r.cost), dollars(r.lastPass)])
  }
}
printTable(['Prefix cache', 'Running for', 'Passes', 'Cost', 'Last pass'], runawayRows, new Set([1, 2, 3, 4]))

console.log('\nOne Frontier A at 9:00, net of tokens per second (no upkeep): the whole mix, or only agents.\n')
printTable(
  ['Model', 'Prompts/s', 'Net/s, cache off', 'Net/s, cache on', 'Caching gains/s'],
  modelMixEconomics(catalog, 540).map((r) => [r.label, r.perSec.toFixed(1), dollars(r.netOff), dollars(r.netOn), dollars(r.netOn - r.netOff)]),
  new Set([1, 2, 3, 4]),
)

const ragRevenue = catalog.traffic.rag.revenue
console.log(`\nRAG unit economics: one question, $${ragRevenue.toFixed(2)} revenue. Cost is tokens only (no upkeep); wrong rate`)
console.log('with no drift; latency is retrieval plus the model call, with no queues or transit.\n')
printTable(
  ['Model', 'Path', 'q', 'Tokens in', 'Cost', 'Margin', 'Wrong', 'Latency'],
  ragPaths(catalog).map((r) => [
    catalog.nodes[r.model].name,
    r.path,
    r.quality.toFixed(2),
    r.inputTokens.toLocaleString('en-US'),
    dollars(r.cost),
    dollars(r.margin),
    percent(r.wrongRate),
    `${(r.latencyMs / 1000).toFixed(2)} s`,
  ]),
  new Set([2, 3, 4, 5, 6, 7]),
)

const LEAK_TIMES = [180, 240, 300]
console.log('\nExpected cost of leaks per second at phase 2 traffic (no director event, nothing cached).')
console.log('Other: revenue the leaked PII prompts would have earned, or tokens spent on attacks.\n')
const leakRows: string[][] = []
for (const sec of LEAK_TIMES) {
  for (const l of leakCosts(catalog, sec)) {
    leakRows.push([
      formatClock(sec),
      l.label,
      l.breachesPerSec.toFixed(3),
      dollars(l.finesPerSec),
      dollars(l.otherPerSec),
      dollars(l.totalPerSec),
      l.trustPerSec.toFixed(2),
    ])
  }
}
printTable(['At', 'Leak', 'Breaches/s', 'Fines/s', 'Other/s', 'Total/s', 'Trust pts/s'], leakRows, new Set([2, 3, 4, 5, 6]))

console.log('\nvLLM capacity (J-1): one replica at full load on one kind of request. Only KV memory and the')
console.log(`${catalog.nodes.VLLM_CLUSTER.concurrency}-sequence cap limit the batch; each sequence slows decoding by 1/${catalog.nodes.VLLM_CLUSTER.batchSlowdownSeqs}.\n`)
const capRows: string[][] = []
for (const shape of capacityShapes(catalog)) {
  for (const tier of [1, 2]) {
    const c = vllmCapacity(catalog, tier, [shape])
    capRows.push([
      catalog.nodes.VLLM_CLUSTER.tiers[tier - 1].name,
      shape.label,
      (shape.inputTokens + shape.outputTokens).toLocaleString('en-US'),
      String(Math.floor(c.batch)),
      `${(c.latencyMs / 1000).toFixed(1)} s`,
      c.perSec.toFixed(1),
    ])
  }
}
printTable(['Tier', 'Request', 'KV tokens', 'At once', 'Latency', 'Per s'], capRows, new Set([2, 3, 4, 5]))

const RATES = [5, 15, 30, 60]
const host = selfHostEconomics(catalog, RATES)
console.log(`\nSelf-hosting (J-2): the 70B against Frontier on complex chat and reranked RAG at the 9:00 mix. One replica serves`)
console.log(`${host.replicaPerSec.toFixed(1)}/s (${(host.latencyMs / 1000).toFixed(1)} s each at full load) for ${dollars(host.upkeepPerSec)}/s; it breaks even with A at ${host.breakEvenA.toFixed(1)}/s and with B at ${host.breakEvenB.toFixed(1)}/s.\n`)
printTable(
  ['Prompts/s', 'Replicas', 'Power', 'Substations', 'vLLM per request', 'Frontier A', 'Frontier B', 'A and B pools serve'],
  host.rows.map((r) => [
    String(r.perSec),
    String(r.replicas),
    `${r.kw} kW`,
    String(r.substations),
    dollars(r.vllmPerRequest),
    dollars(r.frontierA),
    dollars(r.frontierB),
    r.hostedPerSec >= r.perSec ? 'all' : `${r.hostedPerSec.toFixed(1)}/s (${Math.round((100 * r.hostedPerSec) / r.perSec)}%)`,
  ]),
  new Set([0, 1, 2, 3, 4, 5, 6]),
)

console.log('\nThe LLM judge (J-3): what one verdict costs, and its spend at each sampling rate.\n')
printTable(['Judged', 'Tokens read', 'Per verdict'], judgeCosts(catalog).map((j) => [j.label, j.tokensRead.toLocaleString('en-US'), dollars(j.cost)]), new Set([1, 2]))
console.log('')
printTable(
  ['At', ...judgeSpendPerSec(catalog, 540).map((j) => `${j.sample * 100}% sampled`)],
  [540, 840].map((sec) => [formatClock(sec), ...judgeSpendPerSec(catalog, sec).map((j) => `${dollars(j.perSec)}/s`)]),
  new Set([1, 2, 3]),
)

// ---------------------------------------------------------------------------
// Balance runs
// ---------------------------------------------------------------------------

const header = ['Build', 'Died', 'Causes', 'Median death', 'Median budget', 'End budget', 'Budget IQR', 'Min trust', 'Trust from',  'Timeouts', 'Failures', 'Wrong', 'Agent wrong', 'Agent $/task', 'Breaches', 'Served', 'Target']
const misses: string[] = []
const bigMisses: string[] = []
const notes: string[] = []
const started = performance.now()

function runAll(scenario: Scenario, eventsOff: boolean): RunResult[] {
  const results: RunResult[] = []
  for (let seed = 1; seed <= seeds; seed++) results.push(runScenario(scenario, seed, undefined, catalogFor(scenario, eventsOff)))
  return results
}

function balanceTable(title: string, scenarios: readonly Scenario[]): void {
  const rows: string[][] = []
  for (const scenario of scenarios) {
    const results = runAll(scenario, false)
    const off = scenario.target.maxDeathDropWithoutEvents !== undefined ? runAll(scenario, true) : undefined
    const refId = referenceIdOf(scenario.target)
    const refScenario = refId === undefined ? undefined : scenarioById(refId)
    const reference = refScenario === undefined ? undefined : runAll(refScenario, false)
    const s = summarize(results)
    const missed = checkTarget(scenario.target, results, off, reference)
    const causes = [s.causes.BANKRUPT > 0 ? `${s.causes.BANKRUPT} bankrupt` : '', s.causes.TRUST > 0 ? `${s.causes.TRUST} trust` : '']
      .filter(Boolean)
      .join(', ')
    rows.push([
      scenario.label,
      `${s.deaths}/${s.runs}`,
      causes || '-',
      s.medianDeathSec === null ? '-' : formatClock(s.medianDeathSec),
      s.medianFinalBudget === null ? '-' : wholeDollars(s.medianFinalBudget),
      wholeDollars(s.medianEndBudget),
      s.budgetIqr === null ? '-' : wholeDollars(s.budgetIqr),
      `${s.medianMinTrust.toFixed(1)}%`,
      scenario.trustFromSec === undefined ? '-' : `${s.medianMinTrustFrom.toFixed(1)}%`,
      String(Math.round(s.medianTimeouts)),
      String(Math.round(s.medianFailures)),
      String(Math.round(s.medianWrongAnswers)),
      String(Math.round(s.medianAgentWrong)),
      s.medianAgentCostPerTask > 0 ? `$${s.medianAgentCostPerTask.toFixed(2)}` : '-',
      String(Math.round(s.medianBreaches)),
      String(Math.round(s.medianServed)),
      missed.length === 0 ? 'PASS' : missed.some((m) => m.big) ? 'BIG MISS' : 'MISS',
    ])
    if (off !== undefined) {
      const o = summarize(off)
      rows.push([`  same, events off`, `${o.deaths}/${o.runs}`, '-', '-', o.medianFinalBudget === null ? '-' : wholeDollars(o.medianFinalBudget), '-', '-', `${o.medianMinTrust.toFixed(1)}%`, '-', '-', '-', '-', '-', '-', '-', '-', ''])
    }
    const short = results.filter((r) => r.cutShort > 0).length
    if (short > 0) notes.push(`${scenario.label}: ${short}/${results.length} runs couldn't afford a scripted step and skipped the rest of it.`)
    for (const m of missed) (m.big ? bigMisses : misses).push(`${scenario.label}: ${m.text} (target: ${scenario.targetText})`)
  }
  console.log(`\n${title}\n`)
  printTable(header, rows)
}

console.log(`\n${seeds} seeds per build. Medians are over all runs, except the median budget (survivors only; end budget counts every run at its end).`)
balanceTable('Classic mode (decisions section G, D40), 0:00–5:00', CLASSIC_SCENARIOS)
balanceTable('Phase 2 (D49): RAG and attacks from 2:00, incident director on, 0:00–5:00', PHASE2_SCENARIOS)
balanceTable('Phase 3 (I-4): agents from 5:00, all traffic and events on, 0:00–9:00 (one build to 12:00)', PHASE3_SCENARIOS)
balanceTable('Phase 4 (J-6): the outage drill (Frontier A down 9:30–10:30, to 11:00) and the endless phase (to 25:00)', PHASE4_SCENARIOS)
console.log(`\n${((performance.now() - started) / 1000).toFixed(1)} s`)
for (const n of notes) console.log(`Note: ${n}`)
if (bigMisses.length > 0) {
  console.log('\nBig misses (over 10 points): stop and review the tables before tuning.')
  for (const m of bigMisses) console.log(`- ${m}`)
}
if (misses.length > 0) {
  console.log('\nSmall misses: tune catalog.ts and log it in decisions.')
  for (const m of misses) console.log(`- ${m}`)
}
if (bigMisses.length + misses.length > 0) process.exitCode = 1
