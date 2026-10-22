/*
 * The field guide: one entry per node and per idea the game teaches, each
 * answering the same four questions. The Help panel shows them, and the small
 * "?" on an inspector, a HUD panel or a postmortem action item opens the one
 * it belongs to.
 *
 * Every number comes from the catalog, so the guide can't drift from the game.
 * The "what it does here" lines are the ones the inspector already showed
 * (TEACHING), kept here so there's one copy of each.
 */

import { DEFAULT_CATALOG, type NodeType } from '../engine'
import { formatPrice as money } from './format'
import type { ThumbKind } from './ui/nodeThumbs'

const C = DEFAULT_CATALOG
const N = C.nodes

function pct(share: number): string {
  return `${Math.round(share * 100)}%`
}

/** "$70 to build, $9/min" — or "per token" for a hosted model, which has no upkeep. */
function price(type: NodeType): string {
  const spec = N[type]
  return `${money(spec.build)} to build, ${spec.upkeepPerMin > 0 ? `${money(spec.upkeepPerMin)}/min` : 'nothing to keep'}`
}

/** One thing each node teaches, in the inspector and the guide. Nothing here reveals a hidden number (D11). */
export const TEACHING: Readonly<Record<NodeType, string>> = {
  USERS_IN: 'Every prompt needs a way to an answer before its deadline. Traffic grows all run.',
  USERS_OUT: 'Wrong answers pay like right ones, until users notice and complain 5 to 15 seconds later.',
  FRONTIER_API: 'Hosted models cost nothing to keep, but they charge for every token.',
  FAST_SLM: 'Cheap per token and quick, but it gets hard questions wrong more often, and a wrong answer looks right.',
  SEMANTIC_CACHE: 'Answers repeats without calling a model. It warms up as it sees traffic, and a few cached answers are stale.',
  PROMPT_ROUTER: 'Sends simple chats to Fast SLM and complex ones to Frontier. Now and then it guesses wrong.',
  OUTPUT_GUARDRAIL:
    'Checks answers before users see them, and turns most wrong ones into refusals, which cost far less trust. It can only check a RAG answer as well as its context lets it.',
  PROMPT_FIREWALL: 'Blocks prompt injections before they reach a model. Put it first: a jailbroken model is a breach, a fine and a hit to trust.',
  PII_REDACTOR: 'Scrubs personal data before a model sees it. Every hosted model, Fast SLM included, leaks what it is sent.',
  VECTOR_DB: 'Grounds RAG questions in your documents. More context costs more tokens, and its index goes stale without a cron.',
  BM25_SEARCH: 'Keyword search beside a vector DB sharpens what it finds for free. On its own it finds less.',
  RERANKER: 'Keeps only the best 1,200 tokens of retrieved context: better answers for fewer tokens, but only 4 at a time.',
  INGESTION_CRON: 'Re-indexes every vector DB once a minute, so their answers never go stale.',
  LANGGRAPH_COORDINATOR:
    'Loops a task between a model and its tools. Every loop re-reads everything so far, so cost grows fast, and only max steps stops a run that never finishes.',
  MCP_WEB_SEARCH: 'Gives agents real search results. Without it they invent them, and the answer is quietly wrong.',
  MCP_CODE_SANDBOX: 'Runs agent code where it can do no harm. Without it the model makes the results up, and injected instructions run unchecked.',
  HITL_GATE: 'A person reviews runs that hit max steps, so users get a polite refusal instead of nothing. One review every 8 seconds.',
  VLLM_CLUSTER:
    'Your own GPUs: no price per token and no data leaving the building, but you pay by the minute, busy or not. Shorter contexts fit more requests at once.',
  POWER_SUBSTATION: 'GPUs need power. Each substation feeds 3 kW of vLLM.',
  TRACER: "Shows where time and tokens go: every node's live stats, latency and token spend.",
  LLM_JUDGE: 'Grades a sample of answers as users get them, and names the model behind a wrong one before users complain. Its tokens cost money.',
}

/** The three ways a run ends, named so each entry can say which one it fights. */
export const SPIRALS = {
  money: 'Token bankruptcy',
  wrong: 'Silent wrong answers',
  slow: 'Latency choke',
} as const

export type GuideGroup = 'Nodes' | 'Ideas'

export interface GuideEntry {
  readonly id: string
  readonly name: string
  readonly group: GuideGroup
  readonly thumb?: ThumbKind
  /** What it does here: the line the inspector shows. */
  readonly here: string
  readonly real: string
  readonly buy: string
  readonly spiral: string
}

function node(id: NodeType, thumb: ThumbKind | undefined, real: string, buy: string, spiral: string): GuideEntry {
  return { id, name: N[id].name, group: 'Nodes', thumb, here: TEACHING[id], real, buy, spiral }
}

const NODE_ENTRIES: readonly GuideEntry[] = [
  node(
    'USERS_IN',
    undefined,
    'The front door of a production service: a stream of requests you do not control, growing as the product catches on.',
    `Always on the board. Its throttle is the one dial you have on arrivals: it turns prompts away with a polite "too busy" (${pct(C.trust.score.THROTTLED)} of a good answer's trust) instead of letting queues fill and time out.`,
    `${SPIRALS.slow}: turning traffic away beats dropping it after it has waited.`,
  ),
  node(
    'USERS_OUT',
    undefined,
    'Users, and the only judge that counts. In production you learn an answer was wrong from a support ticket, not from your own logs.',
    `Always on the board. Watch the trust strip here: a wrong answer costs ${Math.abs(C.trust.score.WRONG)} where a refusal costs ${Math.abs(C.trust.score.REFUSED)}, and the complaint lands ${C.trust.complaintDelaySec.min} to ${C.trust.complaintDelaySec.max} seconds after the answer.`,
    `${SPIRALS.wrong}: the complaints here are the only proof it is happening.`,
  ),
  node(
    'FRONTIER_API',
    'frontier',
    'A hosted frontier model, billed per token: no servers to run, a hard concurrency limit at the provider, and a bill that scales with every prompt you send it.',
    `${price('FRONTIER_API')}, then ${money(N.FRONTIER_API.inputPricePer1k)} per 1K in and ${money(N.FRONTIER_API.outputPricePer1k)} per 1K out. Worth it for complex and RAG questions, ruinous for simple chat: a simple chat earns ${money(C.traffic.chat.SIMPLE.revenue)} and costs about $1.50 here.`,
    `${SPIRALS.wrong}: it is the most accurate model you can buy. It is also how the ${SPIRALS.money.toLowerCase()} starts.`,
  ),
  node(
    'FAST_SLM',
    'slm',
    'A small hosted model, the 8B class: fast, cheap, and good enough for easy work, which is most work.',
    `${price('FAST_SLM')}, and tokens at ${money(N.FAST_SLM.inputPricePer1k)}/${money(N.FAST_SLM.outputPricePer1k)} per 1K. Buy it with a router in the first two minutes. Never let it take complex questions alone: it is wrong ${pct(N.FAST_SLM.wrongRate.COMPLEX)} of the time on them, against ${pct(N.FRONTIER_API.wrongRate.COMPLEX)} on Frontier.`,
    `${SPIRALS.money}, as long as a router keeps hard questions away from it.`,
  ),
  node(
    'VLLM_CLUSTER',
    'vllm',
    'Your own GPUs running vLLM. You rent the hardware by the minute and serve as many tokens as it can batch, and nothing leaves your network.',
    `${price('VLLM_CLUSTER')} and ${N.VLLM_CLUSTER.tiers[0].kw} kW of power. It only pays once hosted token bills are bigger than the rental: late, at heavy traffic. Its KV cache, not its queue, is the real ceiling.`,
    `${SPIRALS.money} at scale, and it is the only model that doesn't leak what you send it.`,
  ),
  node(
    'SEMANTIC_CACHE',
    'cache',
    'A cache keyed by meaning, not by exact text: the same question in other words still hits. Real ones sit in front of chat assistants, where repeats are most of the traffic.',
    `${price('SEMANTIC_CACHE')}. Buy it early. It needs about ${N.SEMANTIC_CACHE.warmupLookups} lookups to warm up, then answers up to ${pct(N.SEMANTIC_CACHE.maxHitRate.SIMPLE)} of simple chat for nothing. Strict matching trades hits for stale answers.`,
    `${SPIRALS.money} and ${SPIRALS.slow.toLowerCase()}: a hit costs no tokens and comes back in ${N.SEMANTIC_CACHE.serviceMs} ms.`,
  ),
  node(
    'PROMPT_ROUTER',
    'router',
    'A classifier in front of your models that sends each request to the cheapest one that can handle it. The standard first cost cut in production.',
    `${price('PROMPT_ROUTER')}. Buy it as soon as you have two models. It picks right ${pct(N.PROMPT_ROUTER.accuracy)} of the time, so the ${pct(1 - N.PROMPT_ROUTER.accuracy)} it gets wrong is the price of the saving.`,
    `${SPIRALS.money}. Its mistakes feed ${SPIRALS.wrong.toLowerCase()}, which is why a guardrail belongs behind it.`,
  ),
  node(
    'OUTPUT_GUARDRAIL',
    'guard',
    "A grounding and safety check between the model and the user. It cannot make an answer right; it can refuse to show one it can't support.",
    `${price('OUTPUT_GUARDRAIL')}. Buy it before traffic gets hard. It catches ${pct(N.OUTPUT_GUARDRAIL.catchRate)} of wrong answers and turns them into refusals, which cost ${Math.abs(C.trust.score.REFUSED)} of trust instead of ${Math.abs(C.trust.score.WRONG)}. On RAG answers it can only be as good as the context it was given.`,
    `${SPIRALS.wrong}: this is the node that fights it.`,
  ),
  node(
    'PROMPT_FIREWALL',
    'firewall',
    'An input filter for prompt injection and jailbreaks. In production it sits at the edge, before anything with a system prompt sees the text.',
    `${price('PROMPT_FIREWALL')}. Buy it before adversarial traffic appears, and wire it first. It blocks ${pct(N.PROMPT_FIREWALL.blockRate)} of injections; each one that lands is a ${money(C.breachFine.INJECTION)} fine and a breach.`,
    `${SPIRALS.wrong}: a breach costs the same trust as a wrong answer, plus the fine.`,
  ),
  node(
    'PII_REDACTOR',
    'pii',
    'Scrubs names, numbers and addresses out of a prompt before it leaves your systems. Every hosted model is a third party, and about 2% of real traffic carries personal data.',
    `${price('PII_REDACTOR')}. Buy it before any hosted model takes real traffic. It scrubs ${pct(N.PII_REDACTOR.scrubRate)}; each leak is a ${money(C.breachFine.PII)} fine. Only your own vLLM is safe without it.`,
    `${SPIRALS.money} by way of fines, and the trust a breach costs.`,
  ),
  node(
    'VECTOR_DB',
    'vdb',
    'The retrieval half of RAG: your documents as embeddings, searched by meaning. Index choice (flat, IVF, HNSW) trades recall for speed, exactly as it does here.',
    `${price('VECTOR_DB')}. Buy it when RAG questions appear: without one they go to a model that has never seen your documents. Flat is accurate and slow (${N.VECTOR_DB.tiers[0].serviceMs} ms, ${N.VECTOR_DB.tiers[0].concurrency} at a time); HNSW is ${N.VECTOR_DB.tiers[2].serviceMs} ms and ${N.VECTOR_DB.tiers[2].concurrency} at a time.`,
    `${SPIRALS.wrong} on RAG traffic, at the cost of the tokens its context adds.`,
  ),
  node(
    'BM25_SEARCH',
    'bm25',
    'Classic keyword search. Hybrid retrieval — BM25 beside a vector index — is the standard production setup, because exact terms and names are what embeddings miss.',
    `${price('BM25_SEARCH')}. Buy it beside a vector DB, never instead of one: together they retrieve better for no extra context tokens; alone it finds less (q ${N.BM25_SEARCH.aloneQuality}).`,
    `${SPIRALS.wrong}: better context, same token bill.`,
  ),
  node(
    'RERANKER',
    'rerank',
    'A cross-encoder that re-scores retrieved passages and keeps the best few. It is how production RAG stops paying for context nobody reads.',
    `${price('RERANKER')}. Buy it with the vector DB, not after: it trims context to ${N.RERANKER.compressTo.toLocaleString('en-US')} tokens, which is what makes a RAG question pay. It handles ${N.RERANKER.concurrency} at a time, so it chokes before anything else.`,
    `${SPIRALS.money} and ${SPIRALS.wrong.toLowerCase()} at once. Watch it for ${SPIRALS.slow.toLowerCase()}.`,
  ),
  node(
    'INGESTION_CRON',
    'cron',
    "The job that keeps an index current. Nobody notices it until retrieval quietly starts answering from last week's documents.",
    `${price('INGESTION_CRON')}, re-indexing every vector DB every ${N.INGESTION_CRON.intervalSec} s. Buy it once RAG is a real share of traffic: drift costs ${pct(N.VECTOR_DB.driftPerMin)} of quality a minute, up to ${pct(N.VECTOR_DB.driftCap)}.`,
    `${SPIRALS.wrong}, the slowest version of it.`,
  ),
  node(
    'LANGGRAPH_COORDINATOR',
    'coord',
    'The agent loop: a graph that calls a model, calls a tool, feeds the result back, and repeats. Every production agent framework is some version of this, and so is every runaway bill.',
    `${price('LANGGRAPH_COORDINATOR')}. Buy it when agent tasks arrive, and set max steps the same minute — the choices are ${N.LANGGRAPH_COORDINATOR.maxStepsChoices.slice(1).join(', ')}, and 0 means nothing stops a stuck run.`,
    `${SPIRALS.money}: without max steps this node is the fastest way to lose a run.`,
  ),
  node(
    'MCP_WEB_SEARCH',
    'web',
    'A tool server that gives the model real search results over MCP. The alternative is a model answering from memory and sounding just as sure.',
    `${price('MCP_WEB_SEARCH')}. Buy it with the coordinator. Its results add about ${N.MCP_WEB_SEARCH.outputTokens.toLocaleString('en-US')} tokens to the next pass, and about ${pct(N.MCP_WEB_SEARCH.taintRate)} of them carry an injection, so a firewall still matters.`,
    `${SPIRALS.wrong}: an agent without its tools invents their output.`,
  ),
  node(
    'MCP_CODE_SANDBOX',
    'sandbox',
    'An isolated runtime where agent-written code can execute without reaching anything that matters. Running model output anywhere else is the whole reason sandboxes exist.',
    `${price('MCP_CODE_SANDBOX')}. Buy it for tasks that need code. It is slow (${(N.MCP_CODE_SANDBOX.serviceMs / 1000).toFixed(1)} s) and only ${N.MCP_CODE_SANDBOX.concurrency} run at once, so size it against agent traffic.`,
    `${SPIRALS.wrong}, and the breaches an unsandboxed tool invites.`,
  ),
  node(
    'HITL_GATE',
    'hitl',
    'A human reviewer on the hard cases. Real deployments route low-confidence or high-stakes work to people, and the queue is always the bottleneck.',
    `${price('HITL_GATE')} plus ${money(N.HITL_GATE.reviewCost)} a review. Buy it once agent runs are hitting max steps: a reviewed run ends in a refusal instead of nothing. One person, ${(N.HITL_GATE.serviceMs / 1000).toFixed(0)} s each, so the queue fills fast.`,
    `${SPIRALS.wrong}: a refusal costs a fraction of a failure.`,
  ),
  node(
    'POWER_SUBSTATION',
    'sub',
    'Power and cooling, the constraint every GPU buildout actually hits. Capacity plans are written in megawatts before they are written in cards.',
    `${price('POWER_SUBSTATION')} for ${N.POWER_SUBSTATION.kw} kW. Buy it with, or just before, the vLLM cluster it feeds. Under-powered GPUs don't run.`,
    'None directly: it is what the vLLM cluster needs to fight any of them.',
  ),
  node(
    'TRACER',
    'tracer',
    'Distributed tracing for an AI stack: spans per call, token counts, p50 and p95 latency. You cannot tune what you cannot see.',
    `${price('TRACER')}. Buy it when the board gets complicated and you are guessing which node is slow. It unlocks the Latency and Token spend panels and every node's live stats.`,
    `${SPIRALS.slow}: it is the only way to find where the time goes.`,
  ),
  node(
    'LLM_JUDGE',
    'judge',
    'LLM-as-a-judge: a second model grading a sample of production answers against a rubric. It is how teams measure quality without waiting for complaints.',
    `${price('LLM_JUDGE')} plus its own tokens. Buy it once wrong answers are costing trust and you can't tell which model is producing them. It samples ${pct(N.LLM_JUDGE.sampleChoices[0])} by default and catches ${pct(N.LLM_JUDGE.recall)} of what it looks at.`,
    `${SPIRALS.wrong}: it turns a silent failure into a number, ${N.LLM_JUDGE.delaySec} s after the answer.`,
  ),
]

const IDEA_ENTRIES: readonly GuideEntry[] = [
  {
    id: 'tokens',
    name: 'Tokens',
    group: 'Ideas',
    here: `Every prompt carries input tokens and comes back with output tokens, and hosted models bill both. A simple chat is ${C.traffic.chat.SIMPLE.inputTokens} in and ${C.traffic.chat.SIMPLE.outputTokens} out; a RAG question adds its retrieved context on top.`,
    real: 'Tokens are the unit of everything: price, context limits, and the time a model takes. Output tokens cost several times input tokens, because they are generated one at a time.',
    buy: `Nothing to buy — it is the meter behind the Token spend panel. The lever is sending fewer tokens: a cache hit sends none, a reranker cuts RAG context to ${N.RERANKER.compressTo.toLocaleString('en-US')}.`,
    spiral: `${SPIRALS.money}: this is the spiral, measured.`,
  },
  {
    id: 'ttft-tpot',
    name: 'TTFT and TPOT',
    group: 'Ideas',
    here: `A call's time is time to first token plus time per output token × tokens. Frontier starts in ${N.FRONTIER_API.firstTokenMs} ms and writes at ${N.FRONTIER_API.msPerOutputToken} ms a token; Fast SLM starts in ${N.FAST_SLM.firstTokenMs} ms. Queueing is added on top, and a prompt past its deadline is lost.`,
    real: 'The two numbers every serving team watches. TTFT is dominated by prefill, so it grows with input length; TPOT is decode, so it grows with the answer and with how many requests share the GPU.',
    buy: 'Nothing to buy. Fight it with a cache (no call at all), more concurrency, a faster vector DB tier, or fewer context tokens.',
    spiral: `${SPIRALS.slow}: long context chokes TTFT, long answers choke TPOT.`,
  },
  {
    id: 'rag-drift',
    name: 'RAG drift',
    group: 'Ideas',
    here: `A vector DB's quality falls ${pct(N.VECTOR_DB.driftPerMin)} a minute since its last index, up to ${pct(N.VECTOR_DB.driftCap)}. Nothing on the board turns red: the answers just get worse.`,
    real: "Indexes go stale the moment the documents move on. The failure is invisible in every dashboard except answer quality, which is why ingestion is a first-class job and not a cron somebody's laptop runs.",
    buy: `An ingestion cron, ${money(N.INGESTION_CRON.build)}, which re-indexes every vector DB every ${N.INGESTION_CRON.intervalSec} s.`,
    spiral: `${SPIRALS.wrong}, arriving slowly enough that you blame the model.`,
  },
  {
    id: 'prefix-caching',
    name: 'Prefix caching',
    group: 'Ideas',
    here: `A paid setting on a model, ${money(C.prefixCache.build)}. Cached input tokens cost ${C.prefixCache.readMultiplier}× instead of 1× and prefill ${C.prefixCache.prefillSpeedup}× faster; writing the cache costs ${C.prefixCache.writeMultiplier}× once, and it expires ${C.prefixCache.expirySec} s after its last use.`,
    real: "Providers cache the KV state of a prompt's shared prefix, so the same system prompt isn't re-processed every call. Agent loops, which resend the whole conversation every pass, are where it pays for itself.",
    buy: `Once a coordinator is looping: an agent's ${C.traffic.agent.systemPromptTokens.toLocaleString('en-US')}-token system prompt is re-read on every pass.`,
    spiral: `${SPIRALS.money}, and ${SPIRALS.slow.toLowerCase()} with it, since cached prefix prefills ${C.prefixCache.prefillSpeedup}× faster.`,
  },
  {
    id: 'compounding-errors',
    name: 'Compounding errors',
    group: 'Ideas',
    here: `An agent run is right only if every pass is. With per-step reliability r, a run of n model passes ends wrong with P = 1 − rⁿ. Frontier is r ${N.FRONTIER_API.stepReliability}; Fast SLM is r ${N.FAST_SLM.stepReliability}, so a four-pass task is wrong about ${pct(1 - N.FAST_SLM.stepReliability ** 4)} of the time.`,
    real: 'The arithmetic behind "the demo worked, the agent doesn\'t". A 95%-reliable step is a coin flip over fourteen steps, which is why production agents stay short and are checked at the end.',
    buy: 'A better model for the loop, fewer steps, and an output guardrail to catch what still comes out wrong.',
    spiral: `${SPIRALS.wrong}, multiplied by the number of passes.`,
  },
  {
    id: 'circuit-breakers',
    name: 'Circuit breakers',
    group: 'Ideas',
    here: `A ${money(C.breaker.build)} model setting. When more than ${pct(C.breaker.failShare)} of its last ${C.breaker.window} calls fail, it opens for ${C.breaker.openSec} s and sends everything away at once instead of queueing it, then lets ${C.breaker.probes} probes through to test the water.`,
    real: 'Standard resilience: when a dependency is sick, failing fast is kinder than piling work on it. The alternative is a queue of requests that will all time out anyway.',
    buy: "Before a provider slowdown, on any model you can't afford to have everything waiting behind.",
    spiral: `${SPIRALS.slow}: it stops a stalled provider from taking the deadline of every prompt behind it.`,
  },
  {
    id: 'continuous-batching',
    name: 'Continuous batching',
    group: 'Ideas',
    here: `A vLLM cluster runs up to ${N.VLLM_CLUSTER.concurrency} sequences at once, limited by KV-cache tokens (${N.VLLM_CLUSTER.tiers[0].kvTokens.toLocaleString('en-US')} at tier 1), not by a queue. Each sequence in the batch slows the others: time per token × (1 + sequences ÷ ${N.VLLM_CLUSTER.batchSlowdownSeqs}).`,
    real: "How modern inference servers keep GPUs busy: finished sequences leave the batch and new ones join mid-flight, instead of waiting for a whole batch to finish. The memory for each sequence's keys and values is the real capacity limit.",
    buy: `It comes with the vLLM cluster (${money(N.VLLM_CLUSTER.build)}). Short contexts fit more sequences, so retrieval trimming pays twice.`,
    spiral: `${SPIRALS.money} at scale; watch it for ${SPIRALS.slow.toLowerCase()} as the batch fills.`,
  },
  {
    id: 'throttling',
    name: 'Throttling',
    group: 'Ideas',
    here: `Users in can turn a share of arrivals away. A throttled prompt scores ${C.trust.score.THROTTLED} where a good answer scores ${C.trust.score.GOOD} and a timeout scores ${C.trust.score.FAILED}: saying no early is much cheaper than failing late.`,
    real: 'Admission control, or load shedding. Every system with a queue needs it, because a queue that grows past its deadline is doing work nobody will be there to receive.',
    buy: "Nothing to buy: it is a setting on Users in. Reach for it in a spike you can't serve, and turn it back down after.",
    spiral: `${SPIRALS.slow}: it is the only lever that reduces work instead of adding capacity.`,
  },
]

export const GUIDE: readonly GuideEntry[] = [...NODE_ENTRIES, ...IDEA_ENTRIES]

const BY_ID = new Map(GUIDE.map((e) => [e.id, e]))

export function guideEntry(id: string): GuideEntry | undefined {
  return BY_ID.get(id)
}
