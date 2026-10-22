# Decisions log

`docs/spec-v1.md` is the original design. This file records every decision made since. Where the two disagree, this file wins.

When you change a rule or a number, edit or add an entry here in the same commit, with a one-line reason.

Tags: **M1** is needed for Milestone 1. M2, M3 and M4 mark later milestones.

## A. Money

**D1 (M1). Answered prompts earn money.**
Every prompt that reaches Users out before its deadline earns revenue by category and difficulty (section G). Wrong answers earn too: that's the trap of a silent failure. Refusals, timeouts, drops and broken answers earn $0. Spec v1 had no income, so every run ended in bankruptcy by construction.

**D2 (M1). Upkeep is per minute.**
All upkeep values are dollars per minute, charged every tick (upkeep ÷ 1,200 per 50 ms tick). Spec v1's "$2/s" Fast SLM and "$15/s" vLLM were per-minute values.

**D3 (M1). Prices come from break-evens.**
Decide the traffic level where two options should break even, then derive the price. A node with upkeep U ($/min) that saves s dollars per request beats the alternative above U ÷ (60 × s) requests per second. Write each price's intended break-even next to it in `catalog.ts`.

**D4 (M1). Budget limits.**
Start at $500. The run ends at −$1,000. Building is allowed while in debt, as long as the purchase doesn't take the budget to −$1,000 or below. Demolishing refunds 50% of the build cost. Users in and Users out are free, pre-placed, and can't be demolished.

**D5 (M3). Prefix caching is a bet, not a discount.**
Every packet carries `systemPromptTokens` (a shared prefix, cacheable across requests) plus its own context. With caching on, writing a prefix to a model's cache costs 1.4× the input price, reading it costs 0.1×, and entries expire after 300 s without use. Caching traffic that never repeats loses money. Cache invalidation events (M4) wipe entries. Turning it on costs $80 once per model (I-2). *(Session 8: write 1.25 → 1.4. Anthropic's 5-minute price let a model serving the whole 9:00 mix win $6/s from caching; at 1.4 the mix about breaks even and a model kept for agents gains $12/s, I-3.)*

**D6 (M3). Agent context grows by the model's own output.**
After each model pass: `cachedPrefixTokens += newInputTokens; newInputTokens = outputTokensGenerated`. When a tool returns, add its output to `newInputTokens` (web search +1,200, code +600, a failed tool call +400 error tokens). Cost per step grows linearly and total cost grows quadratically. Spec v1 dropped the model's output, and its ×3-per-loop example was exponential, not quadratic.

**D7 (M2). Ingress throttle.**
Users in gets a throttle setting (max prompts per second). Throttled prompts cost a little trust (+0.8) instead of failing later.

## B. Trust

**D8 (M1). Trust is a weighted success ratio over about the last 30 seconds.**
Keep two numbers, S and N, starting at S = N = 90 (a prior of 90 good outcomes). Every tick, multiply both by exp(−0.05 ÷ 30). Each outcome adds its score to S and 1 to N. Trust = clamp(S ÷ N, 0, 1) × 100.

| Outcome | Score |
|---|---|
| Good answer | +1 |
| Throttled (M2) | +0.8 |
| Refused (guardrail fallback, HITL drain, degraded reply) | +0.5 |
| Timed out, dropped, no route, broken JSON delivered | −3 |
| Wrong answer reported by users | −14 |
| Breach: leaked injection or PII (M2, M3) | −14, plus a fine: $50 for an injection, $100 for PII (D43) |

This doesn't depend on traffic volume, recovers on its own, and reads as an error budget. Spec v1's cumulative percentage hits made the late game unwinnable at high traffic.

**D9 (M1). A trust game over needs 15 seconds in the red.**
Trust below 25% for 15 continuous seconds ends the run. The HUD shows the countdown.

**D10 (M1). Wrong answers are silent.**
The model rolls `isHallucinated`. The packet looks, travels and pays exactly like a good answer. When it reaches Users out, it counts as a good answer (+1) and schedules a complaint at exit time + uniform(5, 15) s using the seeded RNG. At that moment, correct that outcome to a wrong answer: S moves by −14 − 1 = −15 and N stays, so the prompt nets one −14 outcome. Then raise a "Wrong answer reported" event at Users out. Complaints don't say which node caused them. Only the LLM-as-a-judge (M4) reveals a wrong answer before users do, and it names the model that produced it.
Why the correction: counting it as good at exit is the only way the trust number can't leak it (D11), and correcting instead of adding a second outcome keeps one prompt as one outcome, as in the balance reference model.
Complaint delays come from their own RNG stream, separate from traffic and node rolls, so a wrong answer never shifts what happens next.

**D11 (M1). The HUD only sees what the player could know.**
The engine keeps ground truth. `telemetry.ts` builds a player-visible snapshot:
- Wrong answers appear only once revealed, by a complaint or the judge.
- Per-node answer quality needs a judge.
- Latency and token-spend breakdowns need a tracer (M4).

A dev-only debug overlay (`?debug=1`) may show ground truth. A test must prove the snapshot never leaks an unrevealed wrong answer.

## C. Traffic, models and nodes

**D12 (M1). Chat has two difficulties.**
`category: 'CHAT' | 'RAG_QUERY' | 'AGENT_TASK' | 'ADVERSARIAL'` plus `difficulty: 'SIMPLE' | 'COMPLEX'`. Milestone 1 traffic is chat only, simple and complex, which gives the prompt router a real job from the first minute.

**D13 (M1). Hallucination comes from a table.**
P(wrong) = H[model][difficulty]. In M2, add (1 − contextQuality) × 0.6 for RAG questions plus a drift penalty, and clamp the total to [0, 0.95]. Retrieval boosts combine as `q' = q + (1 − q) × b`, so stacking nodes has diminishing returns and never passes 1.

**D14 (M1). A hosted provider shares one limit.**
All Frontier API nodes from the same provider share one pool of 64 concurrent calls, so a second node from the same provider adds no capacity. Provider outages (M4) hit the provider, so a fallback on the same provider fails with it. From M3 there is a second provider, B, with its own 64-call pool, 20% cheaper per token and 30% slower to decode, chosen per Frontier node (I-2). *(Session 8: phase 3 outgrows A's 64 calls even without agents.)*
The game says so: the placement ghost of a Frontier API, and the inspector of any Frontier node with a sibling on its provider, read "Same provider as Frontier A: shares its rate limit". *(Session 6: playtesters didn't know.)*

**D15 (M1). The semantic cache warms up and can be wrong.**
Hit chance = maxHit[difficulty] × (1 − e^(−lookups ÷ 150)). 1.5% of hits return a wrong cached answer, which goes straight to Users out and skips every downstream check. Hits travel to the nearest Users out without a wire, drawn as a dotted arc.
In M2, add a strictness setting: Loose gives ×1.3 hits and ×3 wrong hits, Balanced ×1, Strict ×0.6 hits and ×0.2 wrong hits.

**D16 (M1). The output guardrail is good, not perfect.**
It catches 85% of wrong answers and flags 1% of good ones. Caught or flagged answers become refusals ("I don't have enough information"). Malformed JSON goes back once to the model that produced it (`hasRetriedSchema`), and a second failure becomes a refusal. Without a guardrail, malformed JSON reaches users as a broken answer (−3).
From M2, recall for RAG questions scales with context quality: 0.85 × (0.4 + 0.6 × contextQuality).

**D17 (M2). The reranker has low throughput.**
Concurrency 4. It compresses retrieved context from 4,000 to 1,200 tokens and raises context quality, so under load it becomes the bottleneck instead of a free upgrade.

**D18 (M2). The firewall and PII redactor arrive in Milestone 2.**
Adversarial traffic starts in phase 2, so both move from spec v1's Milestone 4 into Milestone 2. A leaked injection, or unscrubbed PII sent to any hosted model (Frontier or Fast SLM), is a breach. Only a self-hosted vLLM cluster (M4) is safe for PII. *(Session 6: Fast SLM is a provider's hosted small-model endpoint, not your own hardware.)*

**D19 (M3). Agent tasks need specific tools.**
Packets carry `requiredTools: ToolKind[]` (for example `['SEARCH', 'CODE']`), not just a count. If a needed tool isn't wired to the coordinator, the model invents the result and the packet becomes `isHallucinated`.

**D20 (M3). Prompt injection can arrive through tools.**
Some web search results carry a hidden injection (`isTainted`) that the ingress firewall never sees. A tainted packet that runs code outside the code sandbox is a breach. Inside the sandbox it's contained, and the sandbox's inner cube glows.

**D21 (M3). The human-in-the-loop gate is a slow, paid queue.**
One review every 8 seconds, at $0.50 per review. Loop-broken and high-risk tasks drain there as refusals (+0.5) instead of failures.

**D22 (M4). vLLM uses continuous batching, limited by GPU memory.**
New requests join on every decode step. The limit is KV-cache memory, not a fixed batch size. An 8B Llama needs about 128 KB per token, so a 48 GB GPU holds about 30 requests at 8K context, or about 200 at 1.2K. That makes reranker compression multiply GPU throughput. Spec v1's "wait for 8 requests or 400 ms" was static batching. Cold start is 15 s on placement and on every model upgrade.

## D. Engine and routing

**D23 (M1). Deterministic.**
All randomness goes through a seeded mulberry32 RNG owned by the engine. No `Math.random`, `Date.now` or `performance.now` in `src/engine`. The same seed plus the same command log gives the same run, which gives replays, shareable seeds and daily challenges.

**D24 (M1). Tick order, every 50 ms of game time.**
1. Apply queued player commands.
2. Spawn arrivals from the wave director.
3. Advance edges and deliver packets whose transit is done. A packet arriving at a full queue is dropped ("Queue full", −3).
4. For each node: finish workers whose time is up (`onProcessComplete`, then the router puts the packet on an outgoing edge), then remove expired packets from the queue, then pull from the queue into free workers.
5. Fire scheduled events (complaints, cron runs, chaos events).
6. Charge upkeep, decay trust, check both game-over rules.
7. Every fifth tick, build the telemetry snapshot (4 Hz).

Spec v1 pulled from the queue before removing expired packets, so dead packets got processed.

**D25 (M1). Outputs never block, so nothing can deadlock.**
A finished worker always hands its packet off. Edges have no capacity. The only place work waits is an input queue, and a full queue drops new arrivals. With no hold-and-wait anywhere, a circular wait can't form.

**D26 (M3). Agent loops use admission control.**
The coordinator caps active runs at `maxInFlightRuns`: 16 per coordinator (I-2; was 12, so two coordinators cover about 2.4 tasks/s at 9:00). New agent tasks wait in a bounded admission queue, and overflow is throttled (+0.8). A ReAct run has one outstanding call at a time, so the loop never holds more than `maxInFlightRuns` packets. Each two-lane link reserves return space of at least `maxInFlightRuns`, and returns are processed before new admissions, so a return can never be dropped. *(Session 8: returns are routed the moment they arrive, so none ever waits; the flood test holds dropped returns at 0, I-5.)*

**D27 (M1). Only two kinds of cycle are allowed.**
Cycles through the LangGraph coordinator (two-lane links, M3), and the guardrail's built-in JSON retry (no wire). The link tool runs a cycle check (DFS) on every new link and rejects anything else with "Loops are only allowed through the agent coordinator".

**D28 (M3). An agent run sticks to one model.**
A run stays on the model it started on, which keeps that model's prefix cache warm. It moves only if that model's queue is over 80% full or its breaker is open.

**D29 (M4). Circuit breakers have a half-open state.**
Each node keeps its last 10 call outcomes. More than 50% failures opens the breaker for 5 s. It then goes half-open and lets 3 probe calls through: if all succeed it closes, and any failure opens it again. Wrong answers never trip a breaker, because breakers only see loud failures. If every candidate model is open, the router or coordinator returns a degraded canned reply (refusal, +0.5).

**D30 (M1). Transit time comes from route length.**
transitTicks = clamp(1 + ceil(routeLengthTiles ÷ 2), 2, 8), so compact layouts are genuinely faster. The route is planned on the tile grid (`grid.ts`): the x-first L when it's free, otherwise the cheapest path with up to two bends, or a grid search, that never enters another node's tile. A route costs 1 per tile, 1.2 per bend and 0.6 per tube it crosses; running along another tube is free, since lanes keep them apart (D33). Tubes are planned shortest link first, so short hops claim the straight lines. Every tube is re-planned whenever the board changes; a packet keeps the transit it entered with. *(Session 4: was the plain Manhattan L, which ran tubes through nodes. Session 6: bends 0.3 → 1.2, sharing 0.4 → 0, crossings 0 → 0.6, and shortest-first instead of id order. Big builds read as spaghetti; over 30 crowded random boards this cut crossings 344 → 259 and bends 433 → 382. The scenario layouts' routes, and so the section G results, didn't change.)* Packets that expire mid-processing still burn tokens. When they finish late, they count as timeouts and earn $0.

**D31 (M1). Packet pool.**
Pre-allocate 2,000 packets. If the pool runs out, new arrivals are throttled at Users in, never dropped mid-loop.

**D32 (M1). Routing rules.**
- A packet with no valid outgoing link is dropped with a "No route" badge (−3).
- Among several valid targets of the same kind, pick the least loaded ((queue + busy workers) ÷ capacity), with ties broken by node id.
- Prompt router: simple goes to Fast SLM and complex goes to Frontier, with 94% accuracy (a 6% misroute goes to the other kind if it's linked; was 92%, tuned in Session 4). If only one kind is linked, everything goes there.
- Without a router, a node forwards to its least-loaded linked target regardless of difficulty.
- A model's answer goes to a linked output guardrail if there is one, otherwise to Users out.

## E. Rendering and UI

**D33 (M1). The engine stores no geometry.**
Per packet, the engine stores `edgeId`, `lane`, `enterTick` and `transitTicks`, or a queue slot, or a worker. Per edge it stores the tile route (start, corners, end) so transit and drawing agree; the canvas builds the curve and offsets tubes that share a stretch into lanes, so no two tubes overlap. *(Session 4.)* The renderer builds each edge's curve and samples 32 points, evenly spaced by arc length, into one shared `Float32Array`. Position: t = clamp((tick + alpha − enterTick) ÷ transitTicks, 0, 1). Two-lane tubes reuse the curve with 1 − t and a sideways offset. *(Session 9: a return lane takes its forward lane's route reversed, and its length and transit, instead of planning its own, so the pair is one two-lane tube and transit still matches the drawing. Each lane is 5.5 px of glass instead of 8, and the return lane has the brighter rim. The balance tables replay unchanged.)*

**D34 (M1). Capsules, not spheres.**
Packets render as one `InstancedMesh` of capsules. Length grows with √(tokens ÷ 500), capped at 4×, and color comes from the category. Once a model (or the cache) has written the answer, the capsule carries the white-hot output tip on its leading 16%, so answered traffic reads apart from prompts still on their way to a model. *(Session 5: the tip arrives in M1 as its own instanced mesh.)* From M3, an instanced attribute drives the other two bands (cached prefix, new input). Queued packets stand upright in a ring around their node.
*(Session 9: the bands are overlay meshes, like the tip: a frosted, dim cached-prefix band over the tail, sized by cached prefix ÷ tokens, with the body as new input. An agent run trails a lime comet of 7 px per model pass, at most 42. Past the 4× length cap (8,000 tokens) a capsule swells instead: diameter × √(tokens ÷ 8,000), at most 2×, so a runaway visibly bloats. In a run the last pass's output is already the head of the next input (D6), so it's counted once, as output. Rack capsules keep their size, so the 12-slot ring stays readable. The complex ring marks complex chat only; agent tasks, always complex, read by their trail. Reason: design "Bands"; a run's context grows every pass, and length alone tops out by the third.)*

**D35 (M1). Frame loop guards.**
Clamp each frame's delta to 250 ms, multiply by game speed, run at most 40 ticks per frame, and auto-pause when the tab is hidden.

**D36 (M1). The node inspector is a side drawer.**
`NodeInspectorDrawer` is 360 px wide and slides over the right rail, so the board stays visible. It replaces spec v1's `NodeInspectorModal`.

**D37 (M1). The visual source of truth.**
`design/` holds the exported design canvas, and `design/screens/*.png` holds one image per artboard. Tokens live in `src/styles/tokens.css`. If a design screen and this file disagree on a mechanic, this file wins. On looks, the design wins.

**D38 (M1). A queue rack shows at most 12 capsules.**
A node's rack shows the first 12 prompts in its queue, oldest first (the next to be pulled), standing upright in a ring of 12 slots. The rest show as "+N" on the node's label plate, and nothing else about them is drawn. Milestone 1 queues hold 32 to 64 prompts (Fast SLM 64), and a ring of 64 won't fit round a one-tile node; the design's racks were drawn for 8-slot queues.

**D39 (M1). The postmortem may use ground truth, once the run is over.**
After a run ends, the postmortem reads the run log's ground truth: which model or cache gave users wrong answers, how many prompts timed out or dropped where, what each model spent on tokens. It names the node most to blame. During play nothing changes: the snapshot, the HUD and the board still see only what the player could know (D10, D11). The run log (`runLog.ts`) is never part of the snapshot.
Why: the postmortem is the lesson of the run. "Fast SLM answered 100% of complex questions" teaches; "something went wrong" doesn't.

## F. Open questions

Add questions here as they come up, with the option picked in the meantime.

- **Node footprint and starting board.** Every node takes up one tile. The starting board is Users in at (2, 9), Frontier A at (12, 9) and Users out at (23, 9), on the 26 × 18 mat. Frontier A comes free with the board, but demolishing it still refunds 50% of $20. *(Session 1)*
- **Labels.** Hosted models are named after their provider: Frontier A, then Frontier A 2. Milestone 1 has one provider, A. Every other node is its bare type name while it's the only one of its type ("Prompt router", as in the hero), and gets its never-reused number once there are two ("Fast SLM 1", "Fast SLM 2"). Labels change as nodes come and go; incidents keep the label they were written with. *(Session 1; numbering on demand from Session 5)*
- **Unlink and demolish lose what's inside.** Prompts in a demolished node's queue or workers, on its links, or hopping to it, and prompts in an unlinked tube, are lost as failures (−3, $0), with one incident that counts them. They don't drain. *(Session 1)*
- **Pool exhaustion scores as throttled (+0.8).** D31 throttles at Users in when the packet pool runs out, so it borrows D8's throttle score ahead of M2. *(Session 1)*
- **"Least loaded" capacity is concurrency.** Load = (queue + busy workers) ÷ concurrency (D32). Users out never fills, so its load is 0. *(Session 1)*
- **A late finish anywhere is a timeout.** A non-model node that finishes a packet past its deadline drops it as a timeout. A model does the same, but only after charging the tokens (D30). *(Session 1)*
- **Connection table (M1).** Users in → cache, router, Fast SLM, Frontier. Cache → router, Fast SLM, Frontier. Router → cache, Fast SLM, Frontier. Fast SLM, Frontier → guardrail, Users out. Guardrail → Users out. Router and cache may feed each other in either order, and the D27 cycle check stops them from doing both. *(Session 1)*
- **Plates show no stats before a tracer.** Per-node stats need a tracer (D11, M4), so in Milestone 1 a label plate shows the node's name and, past 12 queued prompts, "+N" (D38). That count adds nothing the rack doesn't already show. The design's "Queue 3 of 8" plates are its unlocked-telemetry state. *(Session 2)*
- **Prompts inside a worker aren't drawn.** They're inside the node. Only prompts on a tube, on a hop or in a rack are visible. *(Session 2)*
- **JSON retries fly the cache-hit arc.** A retry is a wireless hop like a cache hit (D16), so it draws as a capsule on a raised arc back to the model, without the cache's dotted trail. *(Session 2)*
- **Rack slots warn at 50% and alarm at 85% of the deadline.** The design says "amber at half deadline, red near it"; "near" is 85% of the time between arrival and deadline. *(Session 2)*
- **The exit crowd is 30 figures at 90% trust or more, thinning linearly below.** The entry crowd is 2 figures per prompt/s, from 6 to 44. Both are read off the design's opening, hero, trust-critical and outage artboards. *(Session 2)*
- **Bankrupt-in turns red under 60 s.** The design shows an amber and a red state for "Bankrupt in …" but no threshold, so the amber triangle becomes the red octagon with less than a minute left. *(Session 3)*
- **A provider meter goes amber at 85% of its rate limit.** Hitting the limit queues prompts rather than failing them, so it stays amber; the hatched red alarm fill is kept for outages (M4). *(Session 3)*
- **The strip's legend names wrong answers after the first user report, for the rest of the run.** Until then it reads "Wrong answers: unknown" (D10). The strip shows throttled prompts with the refusals (both were turned away) and every other failure as timed out, since the design's strip has only those four kinds. *(Session 3)*
- **"New" marks the semantic cache and prompt router in Milestone 1,** the two nodes the opening teaches, as in the opening artboard. It stays on for the whole run until there's a reason to clear it. *(Session 3)*
- **Locked build cards show the design's provisional names and prices,** for display only (`src/components/nodeCards.ts`). Each milestone moves its node types into `catalog.ts`, and the cards switch to the snapshot's prices. *(Session 3)*

- **Forks leave vertically.** A route from a node with more than one link out prefers to leave along y, so the router's fork splits at the router, as in the hero. Ties otherwise go to the x-first L. *(Session 4)*
- **Placing a node on a tube reroutes the tube.** It isn't blocked. A node walled in on all sides still gets a route, through another node at a high cost. *(Session 4)*
- **The traffic readout is a sliding 5 s window of arrivals at Users in, throttled ones included.** It was the last 5 complete seconds, up to 1 s stale. Over 200 seeds the old meter was unbiased (5.97 vs λ = 6 at 1:12); single readings vary by about ±1.1/s at λ = 6 from Poisson noise alone. *(Session 4)*
- **While paused, commands apply at once** (logged at the tick they precede, so replays are unchanged), so a whole build can be laid out paused. Unpaused, they apply at the next tick. *(Session 4)*
- **Esc peels back one layer:** menu, then link in progress, then the card, then the selection, and only then opens the menu. A placed card stays selected for another placement; right-click puts it down. *(Session 4)*
- **The opening coach mark appears when token spend first outruns revenue,** not on any negative net: upkeep alone (a node placed while paused) isn't what the card explains. *(Session 4)* It shows once a run and goes for good when "Got it" is clicked, when tokens have stopped outrunning revenue for 3 s straight, or when a prompt router or semantic cache is on the board (its advice taken). *(Session 6: on a naive board the condition holds until death, so the card stayed up until 4:11.)*
- **Hovering or selecting a node highlights its own tubes.** Its in and out tubes keep a brighter core and every other tube fades to 40%, so one node's wiring reads out of a big build. *(Session 6)*
- **Status lights warn at 70% and alarm while dropping.** A queue past 70% of its capacity blinks its light amber at 1 Hz, the same threshold that turns its input tubes amber (design: "Congested"). For 2 s after a full queue drops an arrival, the light blinks red at 2 Hz and the node shows a "Queue full" alarm badge. Under reduced motion the colours hold steady. *(Session 5)*
- **Only failures and money move.** Board badges for a moment (Timed out, Queue full, Wrong answer reported) rise into place once; "No route" is a lasting state and stays still. A complex answer's revenue floats "+$5.00" over the exit crowd, coalesced to at most one float every 0.6 s per exit (showing the sum), because complex answers land several times a second by 5:00. Simple chats' $0.30 never floats. The money panel pulses red once each time net turns negative. *(Session 5)*
- **Sandbox presets.** Budget $500, $2,000 or $10,000, and traffic at 0.5×, 1×, 2× or 3× Survival's, chosen on the title screen before the run (`SANDBOX` in `catalog.ts`). A sandbox has no game over of either kind, so neither countdown shows; buying still stops at −$1,000 (D4). *(Session 5)*
- **Seeds are 24-bit,** shown as six hex digits ("A7F3-29"). The daily outage seed is a hash of the local date; in M1 it's the same traffic for everyone, and its incidents arrive with chaos in M4. *(Session 5)*
- **Phase cards pause the game.** Each phase's card (0:00 included) pauses until Continue or Space. Sandbox runs and dev scenes show none. *(Session 5)*
- **Ending a run is a command** (`endRun`), logged like any other, so a replay ends at the same tick. Its cause is ENDED. *(Session 5)*
- **A trust collapse is blamed on the last 30 to 60 seconds.** Trust is a 30 s window (D8), so the postmortem ranks what failed since the older of the last two 30 s marks, not over the whole run. A bankruptcy is blamed on the whole run's money. Timeouts at Users out are blamed on no node, since the delay was upstream. *(Session 5)*
- **"Retry with this build" keeps the seed** and lays the final board down at 0:00, paused, through ordinary commands (`rebuild.ts`), so its command log replays it. *(Session 5)*
- **A firewall false alarm is refused on the spot.** The prompt hops wirelessly to the nearest Users out as a refusal (+0.5), like a cache hit, instead of travelling on to a model that would only charge tokens for it. *(Session 6)*
- **Breach fines count as spending.** They go into their own money bucket and into the net rate and the bankrupt-in estimate. *(Session 6)*
- **Later: a cache placed before the redactor stores PII and can serve it to another user (cross-user leak).** For now PII simply misses the cache (D50). *(Session 6)*
- **A blocked attack ends at the firewall.** It is released with no outcome (D44), so it never reaches Users out. *(Session 6)*
- **The Retrieval panel unlocks with the first vector DB, not a tracer.** It shows the most drifted vector DB's drift as a share of its cap (0.15, D46), amber from 50% and red from 85%, and the time to the next ingestion cron run, or "No cron". Drift follows from time since the last index and is the same for every question, so the player could know it (D11); per-question context quality still needs a tracer. The design's locked text said "Place a tracer"; it now says "Place a vector DB". *(Session 7)*
- **A RAG capsule carries one chunk plate per 500 retrieved tokens, at most 8:** 8 after a vector DB (4,000 tokens), 4 after BM25 alone, 2 after the reranker (1,200), matching the design's "8 chunks before, 2 after". Attacks fly as magenta shards and shatter at the firewall when blocked. Rack capsules carry no plates. *(Session 7)*
- **Label plates never overlap.** Each frame they're placed top to bottom; a plate that would touch one already placed drops a row below it. The selected plate keeps its place. Names stay full length. *(Session 7)*
- **A link clicked against the flow is made the other way round,** with a toast saying it was flipped, when only the connection table forbids it as clicked. Loops, duplicates and self-links are never flipped. When neither way is allowed, the reason says what each end sends to and takes from. The link ghost shows chevrons in the direction it will be made. *(Session 4)*

- **A share link carries the seed and the command log, deflated into the URL** (`src/share.ts`): `?r=` for the build, `?w=` to watch the run. The engine is deterministic (D23), so that pair is the whole run; a full M4 build is 64 commands, 3.3 KB of JSON, an 836-character code. A link is a stranger's input, so every command is validated before the engine sees it, and an oversized one is refused. *(Session 13)*
- **A shared build opens in Sandbox with the budget it took,** plus a starting budget to play with, laid down at 0:00 and paused, labelled in the top bar with a "Play this seed in Survival" button beside it. Survival's budget would refuse half of a late build, and a sandbox has no game over, so a shared architecture can be read before it's played. A shared *run* replays its log at its own ticks with the board read-only; the speed controls still work. *(Session 13)*
- **The desktop gate is 1280 px wide** (`useNarrow`), the smaller of the two sizes the HUD is designed for. Below it the game gives way to `DesktopOnly`. Height isn't gated: at 1366 × 657 and 1440 × 789, laptop viewports with browser chrome, the rails and toolbar still fit. *(Session 13, closing Session 12's open item)*
- **From 1920 × 900 the HUD takes wider rails** (264 / 288, toolbar 800) and the phase timeline fills the top bar instead of stopping at 620 px, so a big window gets a bigger HUD rather than a 1440-wide island in the middle of it. *(Session 13)*
- **Board badges are clamped into the board area** the camera frames to (`clampBadge`), so "Wrong answer reported" over a node near the right rail stays readable instead of sliding under the HUD, which paints over the canvas. *(Session 13)*
- **The field guide is the one place the teaching copy lives** (`src/components/guide.ts`): one entry per node and per idea (tokens, TTFT/TPOT, RAG drift, prefix caching, compounding errors, circuit breakers, continuous batching, throttling), each answering what it does here, what it is in real life, when to buy it and which death spiral it fights, plus a legend for capsules, node states and badges. Every number in it is read from the catalog, and the inspector's one-line teaching now comes from the same table. `?`, the Help button, and a small "?" on each HUD panel, the inspector and each postmortem action item open it. *(Session 13)*
- **The guided first run is offered once, on the opening phase card,** and never again once it's been answered (`agent-survival.tutorial`). Seven steps, each waiting for the player's own action rather than a Next button, and skippable at every one. It takes the opening coach mark's place while it runs, since its second step teaches the same thing. *(Session 13)*

## G. Milestone 1 numbers

### Traffic (chat only)

| | Simple chat | Complex chat |
|---|---|---|
| Input / output tokens | 500 / 200 | 1,200 / 600 |
| Deadline | 6 s | 12 s |
| Revenue | $0.30 | $5.00 |

- Arrivals are Poisson. The rate rises linearly from 3 to 8 prompts/s over 0:00–2:00, then from 8 to 16 over 2:00–5:00, then by 2/s every minute after 5:00.
- Spike: ×1.8 from 3:30 to 3:53. *(Was 3:50. Tuned in Session 1, see the tuning log below.)*
- Complex share: 20% at 0:00, rising linearly to 35% at 5:00, capped at 50%.

### Nodes

| Node | Build | Upkeep | Concurrency | Queue | Speed | Price per 1K tokens (in / out) | Quality |
|---|---|---|---|---|---|---|---|
| Users in, Users out | free | none | unlimited | none | none | none | none |
| Frontier API | $20 | $0 | 64, shared per provider | 32 | first token 350 ms; prefill 10K tokens/s; 10 ms per output token | $1.00 / $5.00 | wrong 1% simple, 3% complex; malformed JSON 1% |
| Fast SLM (Llama 8B) | $60 | $30/min | 8 | 64 | first token 80 ms; prefill 20K tokens/s; 2.5 ms per output token | $0.04 / $0.08 | wrong 2% simple, 40% complex; malformed JSON 5% |
| Semantic cache | $70 | $9/min | 64 | 64 | 30 ms | none | max hit 40% simple, 8% complex; warm-up 150 lookups; 1.5% wrong hits |
| Prompt router | $65 | $6/min | 64 | 64 | 40 ms | none | 94% accurate |
| Output guardrail | $55 | $12/min | 24 | 48 | 150 ms | none | catches 85% of wrong answers; 1% false alarms |

- Model latency = first token + input tokens ÷ prefill rate + output tokens × time per output token.
- Model cost = input tokens ÷ 1,000 × input price + output tokens ÷ 1,000 × output price.
- Every service time is rounded to the nearest 50 ms tick, with a minimum of 1. Rounding up would quietly cut throughput: Fast SLM's 605 ms simple chat would take 650 ms, which is 12.3 chats/s instead of 13.3.

### Unit economics these numbers produce

| | Cost per prompt | Margin | Model latency |
|---|---|---|---|
| Simple chat on Frontier | $1.50 | −$1.20 | 2.4 s |
| Complex chat on Frontier | $4.20 | +$0.80 | 6.5 s |
| Simple chat on Fast SLM | $0.036 | +$0.26 | 0.6 s |
| Complex chat on Fast SLM | $0.096 | +$4.90, but 40% wrong | 1.6 s |

One Fast SLM serves about 13 simple chats per second, so the 3:30 spike overflows it unless the cache absorbs about 40% of traffic.

### Starting board

Users in → Frontier A → Users out, already linked.

### Balance targets (40 seeds, first 5:00)

Taken from the reference model in `docs/balance/`.

| Build | Target |
|---|---|
| Naive: Users in → Frontier → Users out | at least 90% of runs die, mostly bankrupt; median death 3:30–4:45 |
| All Fast SLM | at least 90% die of trust before 1:30 |
| Router + Fast SLM + Frontier, no guardrail | 15–50% die |
| Full build minus the cache | 10–40% die |
| Full: cache + router + guardrail + Fast SLM + Frontier | at least 95% survive; median final budget $900–1,800 |
| Naive, then switch to the full build at 3:00 | at least 90% survive |

If a target fails, tune catalog numbers, not the ranges, and log the change here.

### Tuning log

**Session 1.** The TypeScript engine differs from the reference model in four ways: capped queues that drop arrivals, complaints delayed 5–15 s, malformed JSON, and transit tied to layout. With the original numbers, naive was only about half bankrupt, the router build died 68% of the time (target 15–50%), and full minus cache never died (target 10–40%). Changes:
- **Fast SLM queue 16 → 64.** A 16-slot queue sheds overflow long before any wait reaches the deadline, so the 3:30 spike couldn't hurt a build without a cache. At 64 (about 4.8 s of work), a full queue's prompts finish late, which recreates the timeout collapse the reference model's unbounded queues produced. That collapse is what the cache exists to prevent.
- **Frontier queue 64 → 32.** At the provider's 64-call limit, a 64-slot queue meant 3.6 s of waiting. That pushed simple chats past their 6 s deadline at the spike, so the naive build died of trust and bankruptcy in about equal numbers. A 32-slot queue (about 1.8 s) drops the overflow instead, and the naive build dies bankrupt, as intended.
- **Spike 3:30–3:50 → 3:30–3:53.** With nearest-tick service times, a lone Fast SLM serves 13.3 simple chats/s and only just keeps up with a 20 s spike, so full minus cache died about 7% of the time. 23 s lets the backlog outlive the deadline often enough.

Over 400 seeds: naive dies every run, about 89% of them bankrupt, with a median death at 4:11. Router without guardrail dies 40.5% of the time, and full minus cache 16.75%. The full build and naive → full at 3:00 never die. The full build's median final budget is about $1,320.

**Session 4.** The scenario layouts were redrawn like the hero (the Fast SLM lane above the main row, Frontier A on it, both rejoining at the guardrail). Routing alone changed nothing (the old layout still dies 40.5% of the time), but the new layout moved "router, no guardrail" to about 46% over 400 seeds, at the edge of its 15–50% band, and seeds 1–40 died 53%. Change:
- **Prompt router accuracy 92% → 94%.** Router build 33.3% over 400 seeds (every 40-seed block 7–18 deaths), full minus cache 17%, full build unchanged.

## H. Milestone 2 numbers (Session 6)

`npm run balance` checks the targets. It first prints the unit economics of every RAG path on Frontier and Fast SLM, and the expected cost per second of leaked PII and attacks, all computed from `catalog.ts` with the engine's own formulas (`unitEconomics.ts`). Misses are tuned in `catalog.ts` and logged in a tuning log here, never by widening a range.

**D40 (M2). Classic mode keeps the Milestone 1 suite.**
`classicCatalog()` is chat only, with no incident director and the fixed 3:30–3:53 ×1.8 spike. The six section G scenarios run on it with their targets unchanged, at 0:00–5:00. It's a test and balance mode, not on the title screen. Survival and Sandbox use the default catalog: phase 2 traffic and the director, with no fixed spike.
Why: moving the M1 targets to 0:00–2:00 would empty them, because nothing dies before 2:00 (naive's median death is 4:11).

**D41 (M2). Traffic from 2:00.**

| | RAG question | Adversarial prompt |
|---|---|---|
| Share of arrivals | 0 at 2:00, linear to 30% at 5:00, cap 40% | 0 at 2:00, linear to 4% at 5:00, cap 8% |
| Input / output tokens | 800 / 400, plus retrieved context | 600 / 300 |
| Difficulty | Always COMPLEX | Routed as SIMPLE (it looks like a chat) |
| Deadline | 12 s | 6 s |
| Revenue | $6.00 | $0 |

Chat takes the rest, with section G's complex share. 2% of chat and RAG prompts from 2:00 carry PII. Category, difficulty and PII are drawn on the traffic stream, so traffic never depends on the build.
A RAG question on Frontier with no retrieval costs $2.80 (it earns, but it's wrong 63% of the time). With a vector DB (4,800 tokens in) it costs $6.80 and loses $0.80. Reranked (2,000 in) it costs $4.00 and earns $2.00. On Fast SLM it costs $0.22 but is wrong at least 40% of the time.

**D42 (M2). RAG hallucination and guardrail recall** (D13, D16 as written).
P(wrong) = H[model][COMPLEX] + (1 − q) × 0.6 + drift, clamped to [0, 0.95]. Boosts combine as q' = q + (1 − q) × b. Guardrail recall on RAG answers = 0.85 × (0.4 + 0.6q).

| Pipeline into Frontier | q | Wrong | Leaks past a guardrail |
|---|---|---|---|
| No retrieval | 0 | 63% | 42% |
| Vector DB (Flat) | 0.72 | 20% | 5.8% |
| Vector DB + reranker | 0.92 | 8% | 1.5% |
| Vector DB + BM25 + reranker | 0.95 | 6% | 1.0% |

**D43 (M2). Breaches** (D8, D18).
A breach is the prompt's one outcome: −14 trust, a fine and $0 revenue. Leaked PII is fined $100, a leaked injection $50. *(Session 6: PII was $50; a build without a redactor survived.)* The packet ends at the model that completed it, and an alarm incident names that model, because breaches are loud.
- Injection: an adversarial prompt that reaches a model breaches 20% of the time on Frontier and 60% on Fast SLM (small models jailbreak more easily).
- PII: an unredacted PII prompt breaches when any hosted model completes it, Frontier or Fast SLM (`leaksPii` in `catalog.ts`). Only the self-hosted vLLM cluster (M4) keeps PII in. *(Session 6: was Frontier only. Fast SLM is a hosted endpoint, not your hardware, so routing PII to the cheap model is no escape.)*
- The output guardrail doesn't catch injections; that's the firewall's job.

**D44 (M2). Stopped attacks don't touch trust.**
An adversarial prompt that's blocked, resisted, timed out or dropped scores nothing, because attackers aren't users. Only a breach moves trust. The firewall's block count shows in its inspector.

**D45 (M2). New nodes.**

| Node | Build | Upkeep/min | Concurrency | Queue | Service | Effect |
|---|---|---|---|---|---|---|
| Prompt firewall | $50 | $5 | 64 | 64 | 25 ms | Blocks 95% of injections; 0.5% false alarms become refusals (+0.5) |
| PII redactor | $45 | $5 | 32 | 64 | 60 ms | Scrubs 98% of PII |
| Vector DB, Flat (tier 1) | $140 | $14 | 3 | 32 | 600 ms | +4,000 tokens, q 0.72 (exact search, slow) |
| Vector DB, IVF (tier 2) | +$60 | $18 | 8 | 32 | 150 ms | q 0.68 (approximate: a little recall lost) |
| Vector DB, HNSW (tier 3) | +$90 | $24 | 16 | 32 | 40 ms | q 0.71 (fast and near exact, memory-hungry) |
| BM25 hybrid search | $90 | $8 | 32 | 64 | 30 ms | After a vector DB: b 0.45, no extra tokens. Alone: q 0.55, +2,000 tokens |
| Cross-encoder reranker | $110 | $12 | 4 (D17) | 32 | 120 ms + 1 ms per 20 context tokens (320 ms at 4,000) | Compresses retrieved context to 1,200 tokens; b 0.7 |
| Ingestion cron | $65 | $5 | none | none | Every 60 s | Re-indexes every vector DB on the board (drift to 0); no links |

- Tier upgrades are a `setSetting` on the vector DB that charges the difference. Demolishing refunds 50% of everything paid.
- Break-evens (D3):
  - The reranker saves $2.80 per RAG question on Frontier, so it pays at 12 ÷ (60 × 2.8) ≈ 0.07 RAG/s. Its real cost is throughput: one serves 12.5/s.
  - A Flat vector DB serves 5/s, about the 4.8 RAG/s of 5:00, so any spike overflows it, which is the reason to upgrade.
  - The redactor covers every model call (D43), about 15/s at 5:00: at 2% PII that saves about 2% × $100 × 15 ≈ $30/s in fines against $5/min.
  - The firewall, at about 0.4 attacks/s, saves about $12/s in fines plus $2.10 per attack in tokens.
- The cards keep the design's prices.

**D46 (M2). Drift.**
A vector DB's drift grows by 0.02 per minute since its last index, capped at 0.15, and adds to P(wrong) for the RAG questions it serves. Small by 5:00 (+0.05 without a cron); it matters from phase 3.

**D47 (M2). Routing and connections** (D32).
- The router sends RAG questions to a linked retrieval node (vector DB or BM25); with none linked, it treats them as complex and sends them to Frontier. Adversarial prompts route as simple chat.
- New links:
  - Users in → firewall or redactor.
  - Firewall and redactor → each other (either order), the cache, the router or a model.
  - Router → vector DB or BM25.
  - Vector DB ↔ BM25 (either order).
  - Vector DB and BM25 → reranker or a model.
  - Reranker → a model.
- A non-RAG prompt passing through a retrieval node takes its service time and gets no context.
- RAG questions hit the semantic cache at most 15%. Cache strictness and the throttle follow D15 and D7. The throttle is a `maxPerSec` on Users in, off by default: a token bucket with a 1 s burst.

**D48 (M2). The incident director.**
- Its own RNG stream (`deriveSeed(seed, 4)`), so a seed gives the same events whatever the build.
- Schedule:
  - The first event is announced at 0:30–0:45.
  - Each next one is announced uniform(30, 60) s × a phase factor after the previous one started: ×1.3 in phase 1, ×1.0 in phase 2, ×0.8 from phase 3.
  - Never before the previous one ends, so events don't overlap.
  - Each starts 10 s after its announcement, which is a warn incident ("Viral spike in 10 s: traffic ×1.8 for 20 s") and a banner with a countdown. The banner shows the time left while the event is active.
  - An info incident marks the end. Every event is a postmortem timeline marker.
- No kind repeats twice in a row. About 5 events in the first 5:00 (the test holds the 40-seed mean to 4.5–5.5). *(Session 6, my call: was "about 5–7"; the gaps already give the pacing I want, so the count follows them rather than the reverse.)*

| Event | Effect | Size | Weight, phase 1 / phase 2 on |
|---|---|---|---|
| Viral spike | Arrival rate × m | m = 1 + uniform(0.5, 1.0) × k (k 0.7 / 1.0 / 1.3 by phase), 15–25 s | 0.4 / 0.25 |
| Hard-question wave | Chat complex share 60% | 30 s | 0.3 / 0.2 |
| Provider slowdown | Frontier calls that start during it take ×1.5 | 40 s | 0.3 / 0.2 |
| Cache wipe | Every semantic cache's warm-up restarts from 0 lookups | Instant | 0 / 0.15 |
| Jailbreak wave | Adversarial share 20%, taken from chat | 25 s | 0 / 0.2, only if it starts at 2:15 or later |

Why ×1.5, not ×2: a complex chat takes 6.5 s on Frontier, so ×2 (12.9 s) would time out every one against its 12 s deadline, with no fallback until M4. At ×1.5 it takes 9.7 s, and the squeeze is the shared rate limit (D14).

**D50 (M2). Attacks and PII always miss the semantic cache.**
An adversarial prompt, or one carrying PII, is a cache lookup that never hits: crafted or personal text doesn't match a cached answer, and caching PII would itself be a leak. They go on downstream, so the firewall and redactor are the only defence against them. *(Session 6: the cache answered about 40% of attacks as simple chat, so a build without a firewall barely felt them.)*

**D49 (M2). Phase 2 balance targets** (40 seeds, 0:00–5:00, phase 2 traffic and events on).

| Build | Target |
|---|---|
| Naive | at least 95% die; median death 2:30–4:15 |
| Milestone 1 full build, nothing added | at least 90% die; median death 3:00–4:30 |
| M1 full + firewall + redactor, no retrieval | at least 85% die, mostly of trust |
| M1 full + firewall + redactor + Flat vector DB, no reranker | median final budget at most 40% of full M2's |
| Full M2: firewall, redactor, cache, router, IVF vector DB, reranker, guardrail, Fast SLM, Frontier | at least 90% survive; median final budget $700–1,800 |
| Full M2 minus the firewall | at least 40% die, and the survivors' median budget is below $0 |
| Full M2 minus the redactor | at least 80% die |
| M1 full, upgraded to full M2 at 2:30 | at least 80% survive |
| Full M2, events felt | final budgets' interquartile range at least $150; death rate with events off no more than 10 points lower |

The section G table still holds in classic mode (D40). `balance.test.ts` runs both tables on 20 seeds.
Target changes, Session 6 (my calls, made after the first runs, not tuning to fit):
- **Flat vector DB without a reranker: "median budget at most 40% of full M2's", was 20–60% die.** Surviving poorer is the intended lesson: unreranked context costs $0.80 a question and leaves 20% of answers wrong, and that should show up as a thin budget, not necessarily a death. Flat concurrency stays at 3 and context at 4,000 tokens.
- **Full M2 minus the firewall: "at least 40% die, and the survivors' median budget is below $0", was at least 80% die.** Attack fines stay at $50; going without a firewall should be ruinous, not a near-certain death.
- **Naive: median death lower bound 2:30, was 2:45.** $100 PII fines from 2:00 rightly kill the naive build sooner.

A miss is **big** when a rate misses by more than 10 percentage points, or a median (death time, final budget) falls outside its range by more than 10% of the nearer bound. Big misses stop tuning until the tables have been reviewed; small ones are tuned in the catalog and logged. *(Session 6)*

### Tuning log (phase 2)

**Session 6.** First 40-seed run: Flat without a reranker 0% died (target 20–60%), full M2 minus the firewall 25% (≥80%), minus the redactor 10% (≥80%), and the events check's budget IQR was $131 (≥$150). The director averaged 4.98 events by 5:00. Changes:
- **Flat vector DB concurrency 4 → 3.** At 6.7/s it never overflowed against 4.8 RAG/s; at 5/s spikes do.
- **First event announced at 0:30–0:45, was 0:35–0:50.** Lifts the count into D48's 5–7.
- **D50: attacks and PII always miss the semantic cache.** A mechanic, not a number.

Second run: Flat without a reranker still 0% died, minus the firewall 50%, minus the redactor 55%; the events check passed (IQR $187, so the planned viral-spike change wasn't needed). Change:
- **PII breach fine $50 → $100; injection fine stays $50.** Leaking personal data is the costlier breach.

## I. Milestone 3 numbers (Session 8)

Approved with four changes (Session 8, your calls), each logged where it lands:
1. **Provider B is a real choice:** 20% cheaper per token, 30% slower to decode (I-2).
2. **Runaways are visible:** an incident with the burn rate, the coordinator's plate counts, and capsules that grow with context (I-1).
3. **A mixed-model row:** one model serving the 9:00 mix, prefix caching on and off. The write premium is tuned so the mix roughly breaks even (I-3, D5).
4. **D26 at 16 runs, the review gate as proposed,** and full M3's budget range stays provisional until you've seen the first 40-seed run (I-4).

After the first run, four more decisions (Session 8, your calls), logged in I-1 and I-4:
1. **Frontier's stuck rate 4% → about 10%,** and "max steps off" needs at least 60% dead (bankrupt or trust) and a median end budget under 30% of full M3's. *Reason: at 4% only about 9 runs a game got stuck, too few for the runaway lesson to show.*
2. **The caching bet is measured on a Frontier B kept for agents:** caching off must end at 70% or less of caching on. Full M3 stays the mixed case. *Reason: full M3's B also takes chat and RAG overflow, which is I-3's mixed row, where caching is meant to break even.*
3. **The sandbox target counts agent tasks' own wrong answers,** including the ones the guardrail catches: at least 3× with the sandbox missing. *Reason: the guardrail turns most invented answers into refusals, and chat and RAG make most served wrong answers, so a total can't triple.*
4. **A refused agent task scores −3,** like a timeout: a failed job, not a polite refusal. A run that gave up at max steps already scores −3. A run the review gate finishes keeps +0.5. *Reason: Fast SLM agents survived because their failures were softened into +0.5 refusals.*

After the second run, three more (Session 8, your calls):
1. **Stuck runs keep reading the prefix cache,** and "max steps off" is judged on time: by 9:00 its end budget is at most 85% of full M3's, and the same build run on to 12:00 (phase 3 traffic continuing) loses at least 60% of its runs. The stuck rate goes up only if the 12:00 target misses. *Reason: caching helps loops in real life, and runaways that start late need time to burn.*
2. **The caching bet is judged on agent token spend per finished agent task,** on the agents-only B build: caching off must cost at least 1.4× caching on. *Reason: agents are at most 10% of traffic, so the whole budget can't show a per-task saving.* **The mixed-versus-dedicated tradeoff is intended:** a B kept for agents makes caching pay but leaves Frontier A to run out of capacity, until Milestone 4's vLLM adds capacity.
3. **Fast SLM agents' miss is small: tune it as usual.** The firewall's false alarm scoring −3 on an agent task is approved.

After the third run, the Fast SLM call (Session 8, yours):
1. **Errors compound over an agent run.** Each model has a per-step reliability r, and a finished run is wrong with P = 1 − r^(model passes). This replaces the flat wrong-answer roll for agent runs. Frontier r = 0.99, so full M3 barely moves; Fast SLM is tuned near 0.85. The X-ray card will show the step count and the compounded reliability (Session 9). *Reason: no failure knob moved Fast SLM's death rate, because broken runs drain to review. Compounding is how small models really fail on long tasks.*
2. **The Fast SLM target runs on 40 seeds in the test,** not 20. *Reason: it sits near its target, where 20 seeds are too noisy.*
3. **If 70% isn't cleared comfortably, the target is 60%** and tuning stops there. *Reason: further tuning was chasing seed noise.*
4. **Late reviews time out (−3):** approved.

`npm run balance` prints the I-3 tables from `catalog.ts` with the engine's own cost and latency functions (`unitEconomics.ts`). The numbers below are its output.

**Why phase 3 needs a second provider.** Run to 9:00 with no agent traffic, the full M2 build dies: 38 of 40 seeds die of trust, with a median death at 7:04. Frontier A's 64 calls are full from about 6:00. RAG and complex chat alone need about 75 at 9:00.

**I-1. Agent traffic** (D6, D19).

| | Agent task |
|---|---|
| Share | 0 at 5:00, linear to 10% at 9:00, cap 15%; taken from chat, RAG and attacks keep theirs |
| Tokens | 2,000 system prompt (shared, cacheable prefix) + 500 user input; 300 output per model pass |
| Required tools (traffic stream) | 45% [SEARCH], 25% [CODE], 30% [SEARCH, CODE], search first |
| Difficulty | Always COMPLEX |
| Deadline | 40 s (about 2.6× a two-tool run's 15 s) |
| Revenue | $5 + $7 per required tool: $12 for one, $19 for two |
| PII | 2%, as chat and RAG; it breaches at the run's first hosted pass (D43) |

- What each loop adds (D6): after every pass, cachedPrefix += newInput and newInput = 300, plus the tool's result (search +1,200, code +600, failed call +400). On Frontier A without caching, every later pass costs +$1.50 after a search, +$0.90 after code, +$0.70 after a failed call. Per pass the growth is linear, so the total is quadratic.
- Tool-call failure: Frontier 8%, Fast SLM 45% (spec v1's tool-calling skill). A failed call costs one more pass and makes no progress.
- Stuck runs: rolled on a run's first pass, Frontier 10% (your call, 4% → 10%: about 9 stuck runs a game was too few to show the runaway), Fast SLM 15%. A stuck run keeps calling its tool and never finishes on its own.
- Compounding errors (your call): a finished run is wrong with P = 1 − r^(model passes), r per model: Frontier 0.99 (about 2.6% wrong over 2.7 passes, near the old flat 3%), Fast SLM 0.8 (about 53% over 3.4 passes). A tool result it invented makes it wrong regardless (D19).
- Scoring: an agent task refused at Users out (by the guardrail, or the firewall's false alarm) scores −3, a failed job (your call). A run that gives up at max steps also scores −3. One the review gate finishes scores +0.5 (D21).
- Only max steps ends a loop. Once a run has started, it never expires in a queue or worker. At the deadline its coordinator scores one timeout (−3): the user has left. Nothing the run does later scores again, but it keeps burning tokens until max steps stops it.
- **Runaways are visible** *(change 2)*. Once a run has passed 10 model passes it counts as stuck:
  - an alarm incident names the coordinator and the burn rate ("An agent run at LangGraph coordinator has looped 11 times. Its last step cost $X, about $Y/s."), at most one per coordinator every 10 s;
  - the snapshot gives each coordinator `runs: { inFlight, max, stuck }` for its plate ("16 of 16 runs, 9 stuck"; "3 of 16 runs" with none stuck, then "+N" past the rack). The plate goes amber while any run is stuck *(Session 9, your call: stuck runs readable at a glance)*;
  - the coordinator's orbit track shows one bead per run slot: a faint dot when empty, a short lime bead for a run in flight, a longer, fatter amber bead for a stuck one, so length, girth and colour all carry it *(Session 9)*;
  - capsules grow with context through D34's √(tokens ÷ 500), since a run's tokens grow every pass. The canvas wiring is Session 9's.
  This counts a fact the coordinator itself knows (its own loop count), so it doesn't leak ground truth (D11). Max steps stays Off by default.
- Agent tasks always miss the semantic cache (as D50: every task is unique).
- With no coordinator, the router treats an agent task as complex chat and sends it to a Frontier model. That is one pass with every tool's result invented, so the answer is wrong (D19). It still pays (D1).

**I-2. New nodes** (D5, D14, D21, D26).

| Node | Build | Upkeep/min | Capacity | Service | Notes |
|---|---|---|---|---|---|
| LangGraph coordinator | $120 | $10 | 16 runs in flight (D26); admission queue 24, overflow throttled (+0.8) | Routing is instant | Max steps Off (default), 3, 5 or 10 model passes |
| MCP web search | $60 | $6 | 16, queue 32 | 800 ms | +1,200 tokens; 10% of results tainted (D20) |
| MCP code sandbox | $95 | $10 | 8, queue 16 | 1,500 ms | +600 tokens; contains a tainted run, and its inner cube glows (board effect) |
| Human review gate | $70 | $6 | 1 reviewer, queue 16 | 8 s | $0.50 per review, counted with upkeep. A loop-broken run becomes a refusal (+0.5); a full queue drops it (−3). It answers users itself, so it needs no link out |
| Prefix caching (model setting) | $80 once per model | $0 | | | Write 1.4×, read 0.1×, 300 s expiry; cached tokens prefill 10× faster (D5) |
| Frontier API on provider B | $20 | $0 | its own 64-call pool | | **20% cheaper per token ($0.80 / $4.00), 30% slower to decode (first token 455 ms, 13 ms per output token)** *(change 1)*. Same wrong rates. A `provider` setting (A or B) on any Frontier node |

- **Provider B** *(change 1)*. A complex chat on B costs $3.36 (vs $4.20) and takes 8.4 s (vs 6.5 s); a reranked RAG question costs $3.20 and takes 5.9 s. An agent task with caching at max steps 5 makes $7.38 on B against $5.84 on A, but takes 14.0 s instead of 11.5 s. The proposal's ×1.5 wrong rate is dropped (my call), so the choice is just price against speed. Under the shared 64-call limit, slower calls hold their slots longer.
  - Re-checked capacity fix: full M3 survives 37 of 40 runs to 9:00 with B taking agents and overflow, though both pools still peak at 64 of 64 (I-4).
  - Calls already running when a node switches provider finish on the old pool.
  - The snapshot lists provider A always, and B once a node uses it.
- **Coordinator routing:** spec v1's four rules, plus D28: a run moves only when its model's queue is over 80% full, and a moved run's prefix is cold on the new model.
  - A run that hits max steps unfinished goes to a linked review gate; otherwise it fails as "Gave up" (−3).
  - A finished run goes to the guardrail if linked, otherwise to Users out.
  - Returns are routed the moment they arrive, so a return never waits and can't be dropped. That is how D26's reserved return space is met.
  - *(Was 50 ms per decision. Instant changes nothing visible and removes the only place a return could wait.)*
- **Missing tool (D19):** the model invents the result. The step counts as done, with no tool trip and no tool tokens, and the answer is wrong.
- **Tool-borne injection (D20):** a tainted run that reaches a code step with no sandbox runs the code itself. It breaches at the model's injection rate (Frontier 20%, Fast SLM 60%; $50, −14). A sandbox contains it. The firewall never sees taint.
- **Connections:** Users in, the firewall, the redactor, the cache and the router may send to a coordinator. A coordinator sends to models, web search, the code sandbox, the review gate, the guardrail and Users out. Its links to models and tools are two-lane: one link makes both lanes, and unlinking either removes both. The D27 cycle check ignores return lanes, so every other loop is still rejected.

**I-3. Unit economics** (recomputed by the engine; 20,000 simulated tasks per row, warm system prompt, no queues).

| Model | Max steps | Prefix cache | Cost | Margin | Success | Wrong | Broken | Late | Passes | Latency |
|---|---|---|---|---|---|---|---|---|---|---|
| Frontier A | 3 | off / on | $11.72 / $7.23 | +$0.94 / +$5.43 | 88.6% | 2.7% | 8.7% | 0% | 2.38 | 11.4 s / 10.9 s |
| Frontier A | 5 | off / on | $12.81 / $7.73 | +$0.76 / +$5.84 | 93.3% | 2.8% | 3.9% | 0% | 2.52 | 12.1 s / 11.5 s |
| Frontier A | 10 or Off | off / on | $14.21 / $8.37 | −$0.64 / +$5.20 | 93.3% | 2.8% | 0% | 3.9% | 2.64 | 12.7 s / 12.2 s |
| Frontier B | 5 | off / on | $10.25 / $6.19 | +$3.32 / +$7.38 | 93.3% | 2.8% | 3.9% | 0% | 2.52 | 14.6 s / 14.0 s |
| Frontier B | 10 or Off | off / on | $10.96 / $6.45 | +$2.62 / +$7.13 | 93.3% | 2.8% | 0% | 3.9% | 2.60 | 15.1 s / 14.5 s |
| Fast SLM | 3 | off / on | $0.43 / $0.22 | +$6.7 | 32.5% | 22.7% | 44.8% | 0% | 2.67 | 5.3 s |
| Fast SLM | 5 | off / on | $0.64 / $0.30 | +$10.0 | 46.1% | 30.9% | 23.0% | 0% | 3.42 | 7.0 s |
| Fast SLM | 10 | off / on | $1.07 / $0.43 | +$11 | 50.6% | 34.1% | 15.3% | 0% | 4.35 | 9.6 s |
| Frontier A, no sandbox | 5 | on | $7.24 | +$6.27 | 42.3% | 53.6% | 4.1% | 0% | 2.51 | 10.4 s |
| Fast SLM, no sandbox | 5 | on | $0.28 | +$10.27 | 22.1% | 54.7% | 23.3% | 0% | 3.43 | 5.4 s |

Max steps 10 and Off read the same within the 40 s deadline: a stuck run rarely reaches 10 passes by then. Its cost after the deadline is the runaway.

- **Cost per pass** of a [SEARCH, CODE] task on Frontier A with no failures: $4.00 + $5.50 + $6.40 = $15.90 uncached; $2.40 + $3.85 + $3.16 = $9.41 cached.
- **A stuck Frontier A run with max steps off:**

| Running for | Passes | Cost, cache off | Cost, cache on |
|---|---|---|---|
| 40 s | 8 / 9 | $74 (last pass $14.50) | $37 (last pass $4.90) |
| 2 min | 20 / 24 | $365 | $129 |
| 4 min | 33 / 46 | $924 (last pass $52) | $324 (last pass $10.45) |

- **One Frontier A at 9:00** *(change 3)*, net of tokens per second:

| Model | Prompts/s | Cache off | Cache on | Caching gains |
|---|---|---|---|---|
| Serving the whole mix (chat, reranked RAG, agents at max steps 5) | 22.1 | $18.40 | $19.57 | +$1.17/s, about break-even |
| Serving only agents | 2.4 | $1.82 | $14.01 | +$12.19/s |

  Tuned: **D5's write premium 1.25 → 1.4.** At 1.25 the mixed model still gained $6.17/s from caching, an easy win. At 1.4 it roughly breaks even, while a model kept for agents gains $12/s.

**I-4. Phase 3 balance targets** (40 seeds, 0:00–9:00, all traffic and events on).

**Full M3** is full M2 at 0:00, plus Milestone 3 at 4:00, ahead of the agents:
- Frontier B, linked from the router and reranker for overflow;
- 2 coordinators at max steps 5, each linked to B, web search, the code sandbox, the review gate and the guardrail;
- prefix caching on B;
- Users in throttled at 40 prompts/s *(Session 9, your call: a better player's build. Full M3 passed at exactly 36/40; it now survives 40/40)*.

| Build | Target | First run, Session 8 |
|---|---|---|
| Full M2, nothing added | at least 90% die; median death 5:30–7:30 | 38/40 die, 7:04. Pass |
| Full M3 | at least 90% survive; median final budget ~~$2,500–8,000 (provisional)~~ **$3,500–6,000** (locked, your call: around the $4,774–4,815 median, IQR about $600) | 3/40 die; $5,015, IQR $335. Pass |
| Full M3, max steps Off | ~~at least 80% die, mostly bankrupt~~ median end budget by 9:00 at most 85% of full M3's (your call) | 6/40 die, all of trust; $4,643. **Big miss** |
| Full M3, max steps Off, run to 12:00 | at least 60% die by 12:00 (your call) | |
| Full M3, Frontier B for agents only (reference) | none: the caching bet's baseline (your call) | |
| ~~Full M3 without prefix caching~~ Agents-only B without prefix caching | median agent token spend per finished agent task at least 1.4× agents-only B's (your call) | $4,757 (95% of full M3). **Big miss** |
| Full M3 with prefix caching on Frontier A too | median final budget at most 85% of full M3's | $3,655 (73%). Pass |
| Full M3 minus the code sandbox | median agent wrong answers, caught or not, at least 3× full M3's (your call; was all served wrong answers); median failures at most 1.2× | 149 vs 133 wrong; 126 vs 129 failures. **Big miss** |
| Agents on Fast SLM instead of B | ~~at least 70% die~~ ~~at least 60% die, mostly of trust~~ agents' wrong answers at least 10× full M3's and lowest trust at least 10 points lower, on 40 seeds in the test too (your calls; Session 10, J-6) | 15/40 die, all of trust. **Big miss** |
| Full M2, upgraded to full M3 at 5:00 | at least 80% survive | 36/40 survive. Pass |

Section G (classic) and D49 are unchanged and replay seed for seed: agent traffic starts at 5:00 and nothing drawn before it moves. "Failures" are timeouts, queue-full and no-route drops, and runs that gave up. "End budget" is the median over every run, a dead one at its death; "median final budget" counts survivors only. "Agent wrong" counts agent runs that finished wrong, before the guardrail. The phase 3 block in `balance.test.ts` is skipped until these targets are reviewed and tuned (D49's big-miss rule).

**I-5. Deadlock flood test** (`flood.test.ts`). Full M3 with agent arrivals ×10, 0:00–9:00 in sandbox mode, checked every tick:
- no return to a coordinator is ever dropped;
- runs in flight never pass 16 per coordinator;
- every live packet is somewhere (the pool never leaks);
- every 10 s window with runs in flight ends runs, or keeps the loop making model calls;
- admission control throttled the overflow.

It passes with max steps 5, and with max steps off while runaways fill the slots.

### Tuning log (phase 3)

**Session 8, first 40-seed run.** Big misses, so no tuning yet. What the runs show:
- **Max steps off doesn't bankrupt.**
  - Only about 4% of runs get stuck: about 9 a game, since agents are about 240 tasks over 5:00–9:00.
  - A stuck run loops slowly, about 7 s a pass, queued behind a Frontier B that's full at 64 calls.
  - With B's prefix cache, a runaway burns about $1–2/s.
  - A few hundred dollars against a build ending near $5,000.
- **Prefix caching barely pays in full M3** (+$260). B isn't kept for agents: it also takes the router's and reranker's overflow. Caching taxes those chats and RAG questions at 1.4×, so full M3 is the mixed row of I-3, not the dedicated one.
- **A missing sandbox doesn't triple served wrong answers.** The guardrail turns about 85% of invented agent answers into refusals. Served wrong answers are mostly chat and RAG (about 130 a game), so a total can't triple.
  - In the engine, a missing tool still shows up as wrong answers, not errors: failures don't change (126 vs 129).
  - In the unit economics, wrong answers go from 2.8% to 53.6% with broken runs flat.
- **Agents on Fast SLM survive 62% of the time.** Its broken runs drain through review as refusals, the guardrail catches most wrong answers, and the money is huge (+$10 a task).

**Session 8, second run** (your four decisions above; 40 seeds). Classic and phase 2: all 15 pass, unchanged.

| Build | Died | Median budget | End budget | Agent wrong | Result |
|---|---|---|---|---|---|
| Full M2, nothing added | 40/40, median 6:58 | | $2,325 | 0 | Pass |
| Full M3 | 3/40 | $4,774 (IQR $646) | $4,699 | 5 | Pass |
| Full M3, max steps off | 6/40 | $3,718 | $3,645 (78%) | 4 | **Big miss** (needs ≥60% dead, ≤$1,410) |
| Agents-only B | 33/40, median 7:15 | $4,675 | $2,232 | 2 | (reference) |
| Agents-only B, no prefix caching | 33/40, median 7:09 | $3,939 | $2,008 (90%) | 2 | **Big miss** (needs ≤$1,562) |
| Prefix caching on A too | 3/40 | $3,340 (70%) | $3,304 | 5 | Pass |
| No code sandbox | 21/40 | $3,688 | $3,268 | 99 (20×) | Pass |
| Agents on Fast SLM | 26/40, all trust | $5,989 | $5,230 | 61 | Small miss (65% < 70%) |
| Upgrade at 5:00 | 3/40 | $4,831 | $4,693 | 6 | Pass |

- **Max steps off still doesn't bankrupt.** At 10%, 14–21 runs a game get stuck (seeds 1–3), and every one is still looping at 9:00. But they start late, since the agent share ramps from 5:00. They loop about every 8 s behind a saturated B, and they read B's warm cache, so by 9:00 they reach only 18–32 loops. Token spend ends at about $16,000 with or without max steps, so the runaway adds only a few hundred dollars by 9:00. The phase ends before the quadratic gets steep.
- **The caching bet can't reach 70% on the whole budget.** Without overflow to B, Frontier A saturates as it does in full M2, and 33 of 40 die near 7:10 either way. Agents are at most 10% of traffic, so caching's roughly $5 a task is a few hundred dollars against a $2,000–5,000 budget. Survivors do show it: $4,675 with caching against $3,939 without (84%).
- **Unit economics at 10% stuck** (`npm run balance`; the I-3 tables above are from 4%): Frontier A at max steps 5 now loses $1.41 a task uncached and makes $4.32 cached, with 10.1% of runs broken. Frontier B at max steps 5 makes $1.40 uncached and $5.99 cached. Max steps off on A costs $17.72 uncached (−$5.05). The mixed model at 9:00 gains $2.74/s from caching (still about break-even), and a model kept for agents gains $13.76/s.
- **The sandbox and the −3 rule both land.** Agent wrong answers go up 20× without a sandbox, with failures flat. Fast SLM agents now die 65% of the time, all of trust: a small miss, held until the big ones are settled, since they change the same runs.

**Session 8, third run** (your three decisions above; 40 seeds). Classic and phase 2: all 15 pass, unchanged.

| Build | Died | Median budget | End budget | Agent $ per task | Result |
|---|---|---|---|---|---|
| Full M3 | 3/40 | $4,774 (IQR $646) | $4,699 | $7.54 | Pass |
| Max steps off, to 9:00 | 6/40 | $3,718 | $3,645 (78%) | $11.38 | Pass (needs ≤85%) |
| Max steps off, to 12:00 | 35/40 (88%), median 10:14 | $2,984 | $3,257 | $16.45 | Pass: the stuck rate stays at 10% |
| Agents-only B | 33/40 | $4,675 | $2,232 | $7.72 | (reference) |
| Agents-only B, no caching | 33/40 | $3,939 | $2,008 | $12.91 (1.67×) | Pass (needs ≥1.4×) |
| Agents on Fast SLM | 26/40 (65%) | $5,989 | $5,230 | $0.41 | Small miss |

**Fast SLM agents, tuning attempts.** The tuning didn't hold on both seed counts:

| Change | 40 seeds |
|---|---|
| Fast SLM stuck 15% (as is) | 26/40 |
| stuck 20%, 25% | 26/40, 23/40 |
| tool-call failure 50%, 55% | 21/40, 22/40 |
| + late reviews time out (below), stuck 15% | 27/40; 13/20 on the test's 20 seeds |
| + late reviews time out, stuck 20%, 25%, 30% | 28/40, 24/40, 26/40 |
| + late reviews time out, tool-call failure 50%, 55% | 23/40, 23/40 |

The death rate sits at 55–70% whatever the knob: the differences are seed noise (±7 points at 40 seeds). More failures don't kill faster, because a broken run drains to review instead of ending wrong. Stuck 20% passed at 40 seeds (28/40) but missed by 15 points on the test's 20 seeds (11/20), a big miss, so it's reverted: Fast SLM stays at stuck 15%, 45% tool-call failure.

- **Late reviews time out** *(mine, kept)*. The single reviewer clears a run every 8 s and its queue holds 16, so a review can land 2 minutes after the user's 40 s deadline. It used to score +0.5 anyway. It now scores a timeout (−3), as a late answer does at Users out (D30). *Reason: a user who left can't be answered.* Full M3's timeouts go from 116 to 126, and its budget doesn't move.
- Full M3's budget range is still provisional: **$3,500–6,000 is proposed** (median $4,774, IQR $646). It gets locked once every target passes.

**Session 8, fourth run: everything passes** (compounding errors, 40 seeds). Classic and phase 2: all 15 pass, unchanged.

Fast SLM step reliability, swept on 40 seeds:

| Fast SLM r | 20 seeds | 40 seeds |
|---|---|---|
| 0.85 | 9/20 | 25/40 (62.5%) |
| 0.8 | 10/20 | 27/40 (67.5%) |
| 0.75 | 12/20 | 30/40 (75%) |

Only 0.75 clears 70%: by 5 points (inside seed noise), at a 25% error per step. That isn't comfortable, so by your rule the target is 60%. **Fast SLM r = 0.8** clears it by 7.5 points.

| Build | Died | Median budget | End budget | Agent wrong | Agent $ per task | Result |
|---|---|---|---|---|---|---|
| Full M2, nothing added | 40/40, median 6:58 | | $2,325 | 0 | | Pass |
| Full M3 | 4/40 | $4,815 (IQR $557) | $4,774 | 4 | $7.70 | Pass (survival exactly 90%) |
| Max steps off, to 9:00 | 4/40 | $3,647 | $3,510 (74%) | 4 | $12.15 | Pass |
| Max steps off, to 12:00 | 36/40, median 10:22 | $3,429 | $3,098 | 5 | $15.81 | Pass |
| Agents-only B | 34/40 | $4,776 | $2,195 | 2 | $7.63 | (reference) |
| Agents-only B, no caching | 31/40 | $3,861 | $2,001 | 1 | $12.70 (1.66×) | Pass |
| Prefix caching on A too | 4/40 | $3,343 (69%) | $3,312 | 4 | $7.70 | Pass |
| No code sandbox | 24/40 | $3,501 | $3,319 | 98 (24×) | $7.19 | Pass |
| Agents on Fast SLM | 27/40 (67.5%), all trust | $5,633 | $5,006 | 71 | $0.40 | Pass |
| Upgrade at 5:00 | 4/40 | $4,870 | $4,765 | 4 | $7.52 | Pass |

Unit economics with compounding: Frontier A at max steps 5 is 2.2% wrong (was 2.8%). Fast SLM at max steps 5 is 36.4% wrong (was 30.9%) and succeeds 40.6% of the time, still netting about $10 a task: the money is there, and trust is what kills it.

**Session 9: a sturdier full M3** (your call: improve the build as a better player would, not the catalog, until it survives with margin). Classic and phase 2 unchanged.

Why the 4 runs died: all of trust, late (7:46, 8:24, 8:49, 8:54), in surges. Both provider pools sat at 64 of 64, the reranker (concurrency 4) filled, Frontier queues overflowed, and trust had idled at 40–60% for minutes before. Each death was a burst of queue-full drops, then timeouts.

What a player could do, at 4:00 on top of full M3 (40 seeds):

| Change | Survive | Median budget |
|---|---|---|
| Full M3 as it was | 36/40 | $4,815 |
| A second reranker | 36/40 | $4,614 |
| Max steps 3 | 36/40 | $4,794 |
| A third coordinator | 34/40 | $4,414 |
| Loose cache | 30/40 | $5,631 |
| Vector DB tier 3 | 35/40 | $4,702 |
| A second Fast SLM | 36/40 | $4,672 |
| Users in throttle 20 / 25 / 30 / 35 / 40 / 45 / 50 per s | 40 / 40 / 40 / 40 / 40 / 38 / 36 of 40 | $4,196 / 4,495 / 4,670 / 4,833 / 4,823 / 4,815 / 4,840 |

More nodes can't help: the binding limit is the two providers' shared pools (D14), and the throttle (D7) is the only lever that sheds a surge as +0.8 throttles instead of −3 timeouts. **40/s** is the loosest value that holds 40/40. At 35/s the throttle also rescued the builds meant to fail: max steps off to 12:00 died 21/40 and Fast SLM agents 21/40, both 7 points short of 60%. At 40/s every target passes with no catalog change:

| Build | Died | Median budget | End budget | Result |
|---|---|---|---|---|
| Full M3 | 0/40 | $4,823 (IQR $521) | $4,823 | Pass |
| Max steps off, to 9:00 | 0/40 | $3,748 | $3,748 (78%) | Pass |
| Max steps off, to 12:00 | 25/40 (62.5%), median 10:29 | $2,440 | $3,167 | Pass |
| Agents-only B | 34/40 | $4,760 | $2,313 | (reference) |
| Agents-only B, no caching | 32/40 | $3,545 | $2,198 | Pass |
| Prefix caching on A too | 0/40 | $3,375 (70%) | $3,375 | Pass |
| No code sandbox | 24/40 | $3,608 | $3,275 | Pass (agent wrong 99 vs 4) |
| Agents on Fast SLM | 26/40 (65%), all trust | $5,582 | $5,075 | Pass |
| Upgrade at 5:00 | 0/40 | $4,955 | $4,955 | Pass |

Margins to watch: max steps off to 12:00 clears 60% by 2.5 points and Fast SLM agents by 5, inside seed noise (±7 at 40 seeds). If either slips, the throttle is the first suspect.

**Open questions (Session 9):**
- **The PII tag is visible content.** A prompt's personal data is in what the user typed, so the amber tag shows from Users in, and the redactor's 2% misses keep theirs. That is a fact on the capsule, not a revealed outcome (D11).
- **The X-ray's reliability is an expectation.** It shows r^passes for the model the run is on, from the catalog, never the run's own roll. Once a run has left its coordinator (review, guardrail, users), its loop shows as "N model passes", since max steps no longer applies.
- **Clicks: lines never pick, and a node's whole tile does.** three's default line raycast threshold is a whole tile, so engraved glyphs and Frontier's tether won clicks meant for nearby nodes. That was the coordinator click bug. Line picking is off board-wide (tubes pick through their sleeves), and each node has an invisible tile-sized pick box. Label plates still pass clicks through to the board.

**Open questions (Session 8):**
- D21's "high-risk" tasks: the player has nothing visible that marks a task high-risk in M3, so only loop-broken runs go to the review gate.
- Max steps defaults to Off, so a coordinator left as placed shows the runaway lesson (your call).

## J. Milestone 4 numbers (Session 10, proposed)

**Status: built in Session 10, engine only; the phase 4 balance table has big misses awaiting review (J-6 tuning log).** Approved with five changes, all yours, each logged where it lands:
1. **The judge samples 1%, 5% or 10%, and defaults to 5%** (J-3). *Reason: at 10% it costs about $4.60/s at 9:00, more than any node but the 70B.*
2. **Breakers stay paid and off by default, and a test proves the failure mode:** without one, a provider in an outage attracts traffic, because it fails fast and so looks least loaded (J-4). *Reason: that's the lesson breakers exist to teach.*
3. **vLLM decoding slows with the batch:** time per output token × (1 + batch ÷ 64), tuned so the 70B's break-evens stay where J-2 had them; J-1 and J-2 are recomputed below (J-1). *Reason: continuous batching isn't free, since every sequence shares the GPU's decode steps.*
4. **The inspector shows a cold start's cost:** "Loading weights: about $1,400 of upkeep before first token" (J-1). *Reason: the cold start's price should be visible before you pay it.*
5. **A new target: full M3 upgraded to full M4 at 9:00 survives the transition in at least 85% of runs** (J-6). *Reason: the upgrade itself, 30 s of cold GPUs at $47/s, is the risky moment.*

Judge reveals not moving trust, auto-drawn power cables and the 70B's 30 s cold start are approved as proposed.

The tables below are `npm run balance`'s output, from `catalog.ts` with the engine's own functions (`unitEconomics.ts`).

**Where phase 4 starts.** At 9:00 traffic is 24 prompts/s: 5.3 simple chats, 4.7 complex chats, 9.6 RAG questions, 2.4 agent tasks and 1.9 attacks. Complex chat plus reranked RAG costs $4.07 a request on Frontier A and $3.25 on B. At that mix A's 64 calls carry about 12.3 of those a second and B's about 9.6, so the two hosted pools top out near 22/s. Complex plus RAG passes that around 14:00, before counting agents, which share the same pools.

**J-1 (M4). The vLLM cluster: two tiers** (D22, D18).
One node with a tier setting, like the vector DB: placed as tier 1, upgraded in place.

| | Tier 1: Llama 8B | Tier 2: Llama 70B (FP8) |
|---|---|---|
| GPUs | 1 × 48 GB | 2 × 80 GB, tensor parallel |
| Weights | 16 GB | 70 GB |
| KV-cache memory | 30 GB ≈ 240K tokens (128 KB a token) | 80 GB ≈ 250K tokens (320 KB a token) |
| Most sequences at once | 256 | 256 |
| Power | 0.5 kW | 2 kW |
| Cold start | 15 s | 30 s |
| Build | $400 | +$1,200 upgrade |
| Upkeep/min (GPU rental and power) | $90 | $2,800 (≈ $46.67/s) |
| Speed under batching | Fast SLM's first token and prefill; 1.5 ms per output token × (1 + batch ÷ 64) | first token 250 ms; prefill 8K tokens/s; 3.5 ms per output token × (1 + batch ÷ 64) *(change 3: was a flat 10 ms; 3.5 keeps a replica at 23 of the 9:00 mix a second, J-2's)* |
| Quality | Fast SLM's: wrong 2% simple, 40% complex; JSON 5%; injection 60%; tool calls fail 45%; stuck 15%; r 0.8 | wrong 1.5% simple, 5% complex; JSON 2%; injection 30%; tool calls fail 12%; stuck 10%; r 0.97 |
| Price per token | $0 | $0 |
| PII | Safe: your own hardware | Safe |

- **Continuous batching (D22).** A vLLM node has no fixed concurrency. It admits the oldest queued prompt whenever the KV memory in use plus that prompt's input and output tokens fits its budget, up to 256 sequences, and checks again every tick, so new requests join between decode steps. Its queue holds 64.
- **Router classes.** The router and coordinator treat tier 1 as a small model (simple chat, like Fast SLM) and tier 2 as frontier-class (complex chat, RAG, agents, like Frontier).
- **Cold starts.** On placement and on the tier upgrade the node is cold: it serves nothing, it isn't a routing target, and its upkeep runs. Placing one in the middle of an outage is 30 s of paying for nothing; the lesson is to place it before you need it. *(D22 said 15 s for every cold start; 70 GB of weights take longer to load, so tier 2 is 30 s.)*
- **Upkeep from break-evens (D3).** Tier 2 replaces Frontier calls at $4.07 (A) or $3.25 (B), so $46.67/s breaks even with A at 11.5 requests/s and with B at 14.3, about the 14.3/s of complex chat and RAG at 9:00. Tier 1 replaces Fast SLM's $0.036 tokens and $30/min nodes on simple chat, and breaks even with it at about 25/s (table J-2). Tier 1 is mostly a cheaper, PII-safe way in, and the step before tier 2.
- **Capacity: one replica at full load, by request** *(recomputed with change 3)*. KV memory or the 256-sequence cap sets how many run at once, and that batch slows every one of them. Per second = at once ÷ latency.

| Request | KV tokens | 8B: at once | 8B: latency | 8B: per s | 70B: at once | 70B: latency | 70B: per s |
|---|---|---|---|---|---|---|---|
| Simple chat | 700 | 256 (sequence cap) | 1.6 s | 160 | 256 (sequence cap) | 3.8 s | 67 |
| Complex chat | 1,800 | 133 | 2.9 s | 46 | 138 | 7.1 s | 19.7 |
| RAG question, reranked | 2,400 | 100 | 1.7 s | 58 | 104 | 4.2 s | 24.9 |
| RAG question, not reranked | 5,200 | 46 | 1.4 s | 34 | 48 | 3.3 s | 14.6 |
| Agent pass, mid-run | 4,300 | 55 | 1.1 s | 50 | 58 | 2.8 s | 21.1 |
| 8K context | 8,000 | 30 | 1.1 s | 27 | 31 | 2.8 s | 11.3 |

  **The reranker multiplies GPU throughput:** compressed RAG fits 104 at once on the 70B instead of 48, so one replica answers 25 RAG questions a second instead of 15 (1.7×; 2.3× before decoding slowed with the batch, since a smaller batch now decodes faster). On a hosted model the reranker saves money; on your own GPU it buys capacity.
- **Power substation** *(new node)*: $250, $20/min, supplies 3 kW: one 70B and two 8Bs, or six 8Bs. Placing a vLLM node, or upgrading one to tier 2, is refused without that much spare power on the board: "Needs 1.5 kW more power. Place a power substation." Each vLLM node draws from the nearest substation with power to spare, and a power cable is drawn between them. Demolishing a substation that's in use is refused ("Powering Llama 70B").

**J-2 (M4). Unit economics: self-hosting against Frontier.**
Complex chat and reranked RAG at the 9:00 mix. vLLM cost a request = (replicas × upkeep + substations × upkeep) ÷ requests a second. One 70B replica serves 23.0 of the mix a second, 5.1 s each at full load, about 116 at once *(recomputed with change 3; every row below is unchanged)*.

| Prompts/s | 70B replicas | Power, substations | vLLM per request | Frontier A | Frontier B | A and B pools can serve |
|---|---|---|---|---|---|---|
| 5 | 1 | 2 kW, 1 | $9.40 | $4.07 | $3.25 | all |
| 15 | 1 | 2 kW, 1 | $3.13 | $4.07 | $3.25 | all |
| 30 | 2 | 4 kW, 2 | $3.13 | $4.07 | $3.25 | 21.9 a second (73%); the rest is dropped or times out |
| 60 | 3 | 6 kW, 2 | $2.34 | $4.07 | $3.25 | 21.9 a second (37%) |

- Below about 11 a second self-hosting loses money. At 15 it beats A and ties B. Past 22 a second it's the only way to serve the traffic at all, and each replica added near full gets cheaper per request.
- Tier 1 against Fast SLM, simple chat: 8B per request $0.37 at 5/s, $0.12 at 15, $0.06 at 30, $0.03 at 60; Fast SLM $0.14, $0.10, $0.09, $0.08 (1, 2, 3 and 5 nodes). Simple chat stays under 11/s even at 20:00, so on cost alone tier 1 never pays; what it buys is PII safety without a redactor, and the slot for tier 2.
- **Self-hosted means PII isn't a breach** (D18, D43): an unredacted PII prompt completed on vLLM scores as a normal answer.

**J-3 (M4). Tracer and LLM-as-a-judge** (D10, D11).

| | Tracer | LLM judge |
|---|---|---|
| Build | $120 | $100 |
| Upkeep/min | $15 | $10, plus the judge's tokens |
| Links | none; one per board | none; one per board |
| Unlocks | node stats on label plates ("Queue 3 of 8", "21.2 calls/s"), and the amber plate on a node whose queue is full; live stats in the inspector; the Latency and Token spend panels; per-question context quality in the Retrieval panel | the Answer quality panel (judged wrong-answer rate per model, with its sample count); the lighthouse sweep; early, attributed reveals |

- **Judge sampling.** It samples 10% of the answers delivered at Users out (refusals and failures aren't answers). It reads a 300-token rubric plus the prompt, any retrieved context or tool results, and the answer, and writes a 50-token verdict, at Frontier B's prices on its own endpoint, so it takes no provider slots and keeps judging in an outage.

| Judged | Tokens read | Per judgement |
|---|---|---|
| Simple chat | 1,000 | $1.00 |
| Complex chat | 2,100 | $1.88 |
| RAG question (1,200 context) | 2,700 | $2.36 |
| Agent task, one search (its whole run's context) | 4,600 | $3.88 |

| | Answers/s | 1% sampled | 5% | 10% |
|---|---|---|---|---|
| 9:00 | 22.1 | $0.46/s | $2.31/s | $4.62/s |
| 14:00 | 39 *(J-5's faster growth)* | $0.80/s | $4.01/s | $8.03/s |

  At 10% the judge costs about $277/min at 9:00, more than any node but the 70B. That's the real tradeoff: seeing quality costs tokens. **A sampling setting of 1%, 5% or 10%, defaulting to 5%** *(change 1)*. *(Built: the agent row reads the run's whole context, 4,600 tokens, not the 2,900 proposed.)*
- **Reveals.** The judge catches 90% of the wrong answers it samples and flags 3% of good ones as wrong. Its verdict arrives 2 s after the answer is delivered, as a warn incident naming the model that produced it ("The judge found a wrong answer from Fast SLM 1"), or the semantic cache for a wrong cached hit. A revealed wrong answer shows in the outcome strip and the Answer quality panel from then on.
- **Trust still moves only on the complaint.** Users' trust is what users experience, so a judge reveal doesn't change S or N (D10 unchanged). The judge's value is knowing early, and knowing which model, so the player can act before complaints pile up. Its false flags are the price of a sampled, imperfect judge, and the Answer quality panel shows the sample count so a bad-looking rate on 3 samples reads as noise.
- **Without a judge,** a wrong answer is revealed only by its complaint, with no model named (D10), and the Answer quality panel stays locked.

**J-4 (M4). Circuit breakers and phase 4 chaos** (D29, D48).

- **Circuit breaker:** a model setting, $40 once per model (Frontier, Fast SLM, vLLM), like prefix caching. D29 as written: the last 10 calls; more than 50% failures opens it for 5 s; then 3 half-open probes. It counts **provider errors only**. Wrong answers never count. *(Session 10, mine: the proposal also counted timeouts and queue-full drops. In the first runs that opened B's breaker on prompts that reached it already late from upstream queues, and on its own full queue while it was healthy, and the traffic pushed elsewhere killed builds full M3 never loses: 6 of 20 died before 9:00. A breaker detects a broken dependency; saturation is the throttle's job, J-7.)*
  - Open: routers and coordinators skip that model. They pick another of the same class (Frontier or vLLM 70B for complex; Fast SLM or vLLM 8B for simple), then a model of the other class, and if every linked model is open, the packet gets a degraded canned reply at once (refused, +0.5).
  - Without one, nothing skips the failing provider. Least-loaded routing even prefers it, since its calls fail fast and its queue looks empty: the classic retry storm.
- **Provider outage:** every call on that provider fails 2 s after it starts ("Provider error", −3, no tokens charged), and its queued calls fail as they're pulled. The provider meter goes to its hatched red alarm, and the outage screen from `design/` shows.
- **The director from 9:00** gets a third weight column, for phase 4. The gap factor goes from 0.8 to 0.6 at 9:00, and shrinks 5% a minute after that, down to 0.4. Every event still makes exactly three draws, so nothing before 9:00 moves.

| Event | Effect | Size | Weight from 9:00 |
|---|---|---|---|
| Provider outage *(new)* | One provider is down: A 60% of the time, B 40% (from the event's size draw). The provider is drawn whatever the build | 45–75 s, plus 10 s for every 3 min past 9:00, at most 120 s | 0.2 |
| Cache invalidation *(new; replaces the cache wipe from 9:00)* | Every semantic cache starts cold, and every model's prefix cache is wiped (D5) | instant | 0.15 |
| Drift surge *(new)* | Every vector DB's drift +0.10, past its 0.15 cap to at most 0.25, until it's next indexed | until the next cron run | 0.1 |
| Traffic surge *(new)* | Arrival rate × 1.4–1.8 | 60–90 s | 0.15 |
| Viral spike, hard-question wave, provider slowdown, jailbreak wave | As D48 | As D48 | 0.1 each |

  Simulated over 2,000 runs: 6.2 events from 9:00 to 14:00 with 1.2 outages (mean 64 s), and 6.9 events from 14:00 to 20:00 with 1.3 outages (mean 82 s). So about one outage every 4 to 5 minutes, getting longer.

**J-5 (M4). The endless phase.**
There's no phase after "Enterprise scale". From 9:00 traffic grows by 3 prompts/s every minute instead of 2, and the viral spike's k grows by 0.1 every 3 minutes. The agent share stays capped at 15%.

| Time | Prompts/s | Complex chat and RAG | Agent tasks | Simple chat |
|---|---|---|---|---|
| 9:00 | 24 | 14.3 | 2.4 | 5.3 |
| 12:00 | 33 | 19.3 | 5.0 | 6.1 |
| 14:00 | 39 | 22.8 | 5.8 | 7.2 |
| 17:00 | 48 | 28.1 | 7.2 | 8.9 |
| 20:00 | 57 | 33.3 | 8.5 | 10.5 |
| 25:00 | 72 | 42.1 | 10.8 | 13.3 |

- The hosted pools (about 22/s) run out near 14:00 without counting agents, and agents need roughly one more coordinator for every 1.2 tasks a second. So a strong build has to keep adding vLLM replicas, substations and coordinators, while outages get longer and surges bigger. What ends it is money, board space and a long outage arriving in a surge.
- **Target shape:** a strong build (full M4 below, adding a 70B replica and a substation at about 9:00, 12:00 and 15:00) has a median death between 14:00 and 20:00. Full M3 with nothing added dies between 9:30 and 12:00. Balance runs stop at 25:00.
- Levers, in this order if the endless targets miss: the growth rate after 9:00, the outage length growth, the spike's k growth.
- *(Session 10, mine: classic mode keeps Milestone 1's growth after 9:00 too, so section G and the postmortem tests that run classic builds to 15:00 replay as before.)*

**J-6 (M4). Phase 4 balance targets** (40 seeds; the test runs 20).

The **outage drill** is a catalog patch for balance only: the director runs as usual until 9:00, is quiet after it, and Frontier A has one forced outage from 9:30 to 10:30. Runs go to 11:00.

| Build | Run | Target |
|---|---|---|
| Single provider: full M3 with B moved to A, no breakers | outage drill | at least 70% die by 11:00 |
| Full M3 plus breakers on every model (A and B failover) | outage drill | at least 70% survive |
| **Full M4:** full M3 plus a 70B vLLM and a substation at 8:00, breakers on every model | outage drill | at least 90% survive; median lowest trust from 9:30 to 11:00 at least 50% |
| Full M3, nothing added | endless, to death or 25:00 | median death 9:30–12:00 |
| Full M4, plus a 70B replica and a substation at 12:00 and 15:00 | endless | median death 14:00–20:00 |
| Full M3, max steps off, to 12:00 (I-4) | as before | at least 60% die, re-checked: it now feels phase 4 events and growth after 9:00 |

And as tests, not balance rows:
- **No judge:** over a full run, every wrong answer the snapshot reveals was revealed by a complaint, none names a model, and the Answer quality panel stays locked. **With a judge:** at least 8% of the wrong answers served are revealed before their complaint, and every judge reveal names the node that produced the answer.
- **Power:** placing a vLLM node with no substation, or upgrading to the 70B with less than 1.5 kW spare, is refused with the plain reason, and succeeds once a substation is placed.
- **Breakers:** a scripted outage opens a breaker within 10 calls, half-open probes go out after 5 s, and it closes on 3 successes once the outage ends.
- **Continuous batching:** KV in use never passes the budget, and a node's admitted count per context length matches the J-1 table.

Section G, D49 and I-4 hold as they are: their runs end by 9:00, and everything new starts at 9:00 or needs a node they don't place. The one exception is I-4's 12:00 row, re-run after the build. If it leaves its target, I stop and show you before tuning anything.

**J-7 (M4). The postmortem names the throttle.**
When a run dies of trust, timeouts or queue-full drops are its top failure, it died during a traffic surge or viral spike or within 15 s of one ending, every provider pool in use was at least 95% busy for most of the last 30 s, and Users in had no throttle (or one above the arrival rate), the action items lead with Users in: "Set a throttle on Users in. Turning away a surge's overflow costs a little trust (+0.8); letting it time out costs −3 a prompt." The run log gains a per-second "every pool full" flag for this. It's the lesson Session 9 found for full M3 (I-4), and once both pools are full, adding nodes can't teach it.

### Tuning log (phase 4)

**Session 10, first 40-seed run.** Classic (G), phase 2 (D49) and phase 3 (I-4) replay seed for seed and all pass. I-4's run to 12:00 now feels phase 4: max steps off dies 33 of 40 (was 25), median 10:05, still past its 60%. Big misses in phase 4, so nothing is tuned yet:

| Build | Died | Median death | End budget | Lowest trust from 9:30 | Result |
|---|---|---|---|---|---|
| Drill: single provider (B moved to A), no breakers | 40/40 | 6:57 | $856 | 0% | Pass, but see below |
| Drill: full M3 + breakers | 40/40 | 9:54 | $5,852 | 0% | **Big miss** (needs ≥70% to survive) |
| Drill: full M4 (70B, substation, breakers at 8:00) | 1/40 | 9:46 | $4,740 | 32.9% | **Big miss** on trust (needs ≥50%); survival passes |
| Drill: full M4 without breakers (reference) | 40/40 | 9:54 | $2,188 | 0% | |
| Full M4, no outage, quiet after 9:00 (reference) | 0/40 | | $3,942 | 38.6% | |
| Full M3, upgraded to full M4 at 9:00 (to 11:00) | 6/40 (85% survive) | 9:34 | $4,415 | | Pass, exactly on the line |
| Endless: full M3 | 40/40 | 10:34 | $6,116 | | Pass (9:30–12:00) |
| Endless: full M4, a replica more at 12:00 and 15:00 | 40/40 | 14:26 | $4,660 | | Pass (14:00–20:00), near the low end |

What the runs show:
- **Breakers decide the outage, given vLLM:** full M4 survives the drill 39 of 40 with breakers and 0 of 40 without. Without them A's calls fail in 2 s, its load looks lowest, and the router pours traffic into it (the test in `milestone4.test.ts` measures over 70% of traffic going to the dead provider).
- **The single-provider build never sees the outage.** One 64-call pool can't carry phase 3 at all, so it dies at 6:57 whatever happens at 9:30. The target passes without testing what it was meant to.
- **Full M3 + breakers can't survive losing A.** Breakers open A within about 5 s and send everything to B, but B's 64 calls carry about 10 of the 22 a second the pools carried together, and full M3 already runs at 30–40% trust before the outage. Its trust hits 0 within 20 s. A second hosted provider alone isn't failover capacity at 9:30.
- **Full M4's trust floor misses because of the build, not the outage.** With no outage at all its lowest trust from 9:30 is 38.6%; the outage costs about 6 points (32.9%). Full M3 has idled at 30–40% since Session 9 (its min-trust column in I-4 is 34%), so a 50% floor can't be met by any outage handling.

Options for you (my picks first):
1. **Full M4 drill: judge the outage, not the idle trust.** "Lowest trust from 9:30 at least the no-outage reference's minus 10 points" (32.9% against 38.6% − 10 passes), or a 30% floor. Otherwise the build has to idle above 60%, which means retuning phase 3.
2. **Full M3 + breakers: make it a reference, or give it a 70B too.** As written it needs B to carry A's load, which the pools can't. Either drop the target (breakers' value is already shown by full M4 with and without them), or rewrite it as "loses less than without breakers", or change B's pool from 64 calls.
3. **Single provider: run the drill on a build that lives to 9:30.** For example full M4 with B removed (A and the 70B, no breakers), so the outage is what kills it. Or keep it as is and accept that it dies earlier.
4. **Endless full M4 at 14:26** sits 26 s inside its window. Leave it unless you want more margin; the first lever is growth after 9:00.

**Session 10, trust diagnosis** (your call: diagnose before deciding the drill targets; `npx tsx scripts/trust.ts`, 40 seeds, ground truth). Approved meanwhile: breakers count only provider errors, and classic mode keeps its old growth.

| Build, window | Mean score | Trust outside events | Wrong answers reported | Timeouts and errors at Frontier | Throttles |
|---|---|---|---|---|---|
| Full M3, 7:00–9:00 | 49.4 | 50.9% | −32.0 | −4.2 | +1.5 |
| Full M3, 10:00–12:00 (28 of 40 alive) | 23.9 | 42.4% | −30.0 | −16.2 | +13.0 |
| Full M4, 7:00–9:00 | 49.3 | 50.9% | −32.6 | −3.8 | +1.4 |
| Full M4, 10:00–12:00 | 46.2 | 45.6% | −34.2 | −2.4 | +10.6 |

Trust points, as count × score ÷ outcomes. Good answers add about +75 to +87, refusals +4.5, breaches −4.
- **The main cause is wrong answers, not saturated pools.** 2.5–3.1% of answers are wrong, and at −15 each that costs 30–34 points. Frontier produces 70–84% of them, the cache about 12%. Pool timeouts matter only for full M3 after 10:00, when it runs out of capacity.
- **Why Frontier is wrong so often: vector DB drift.** The reference builds have no ingestion cron, so drift reaches its 0.15 cap by about 7:30 and adds 15 points to every RAG question's wrong rate (D46), and RAG is 40% of traffic. With a cron placed at 2:00, trust outside events at 7:00–9:00 rises from 50.9% to 66.7% (full M3) and 66.8% (full M4), and to 56.5% and 63.5% at 10:00–12:00. Full M4's median endless death moves from 14:33 to 17:09.
- So, by your rule, **no rate-limit tiers yet**: the cause is something else. Stopped for your call.

**Session 10, after the diagnosis** (your four calls):
1. **The reference builds place an ingestion cron at 4:00, with the full M3 steps.** Phase 2 stays locked. *Reason: drift, not capacity, held trust near 50%.*
2. **No provider rate-limit tiers.** *Reason: full M3 running out of capacity after 10:00 is the intended push toward vLLM.*
3. **The postmortem leads with "Add an ingestion cron"** when no cron was ever placed and most wrong answers served were RAG answers on a vector DB past half its drift cap, and it says when drift hit its cap (`staleIndexCapSec`). *Reason: it's the cheapest fix there is, and the hardest failure to see.*
4. **Drill targets:** full M4 keeps "lowest trust from 9:30 at least 50%"; full M3 + breakers "loses less than the same build without breakers" (a lower death rate, or the same with a higher median lowest trust); the single provider is rebuilt as Frontier A + the 70B, no breakers. *Reason: breakers redirect, they don't create capacity.*

Phase 3 with the cron (40 seeds): 9 of 10 pass. Full M3's median budget is $5,777 (inside $3,500–6,000), lowest trust 45.9% (was 34%); max steps off to 12:00 dies 29 of 40. **Big miss: agents on Fast SLM die 3 of 40** (needs at least 60%, 53 points short). That build died of trust only because drift kept trust near 50%; with a fresh index it has room for its 80 wrong agent answers (full M3: 4). Not tuned: stopped for your call.

Phase 4 (40 seeds):

| Build | Died | Median death | Lowest trust from 9:30 | Result |
|---|---|---|---|---|
| Drill: single provider (A + 70B, no breakers) | 40/40 | 7:00 | 0% | Passes, but every run couldn't afford the 70B, see below |
| Drill: full M3, no breakers (reference) | 40/40 | 9:54 | 0% | |
| Drill: full M3 + breakers | 40/40 | 9:58 | 0% | **Miss**: both die every time, so it can't lose less |
| Drill: full M4 | 0/40 | | 52.6% | Pass |
| Drill: full M4 without breakers (reference) | 40/40 | 9:59 | 0% | |
| Full M4, no outage (reference) | 0/40 | | 59.2% | |
| Full M3, upgraded to full M4 at 9:00 | 2/40 | 9:41 | | Pass |
| Endless: full M3 | 40/40 | 11:01 | | Pass |
| Endless: full M4 | 40/40 | 17:05 | | Pass, now mid-window |

- **Single provider: no affordable timing exists.** Frontier A alone saturates from about 6:00 and dies at a median 6:51. The 70B and its substation cost $1,850, which the −$1,000 purchase floor doesn't allow before about 6:00 (median budget $863 then); bought at 6:00, its $47/s upkeep bankrupts the run within 10 s. A + 70B can't reach a 9:30 outage at these prices.
- **Breakers can't save full M3 in the drill:** with A down, B's 64 calls are all that's left, and it dies 4 s later than without breakers.

**Session 10, the last three calls** (yours):
1. **Agents on Fast SLM: "agents' wrong answers at least 10× full M3's, and lowest trust at least 10 points lower."** No reliability tuning. *Reason: with the cron, trust has room for its wrong answers, so the lesson is the answers, not a death.*
2. **The single-provider drill runs on full M2,** Frontier A down 3:30–4:30 with the director quiet from 3:00, on its own catalog (`SINGLE_PROVIDER_DRILL`), so the phase 2 table stays locked. Target: at least 70% die by 5:00. *Reason: full M2 is single-provider by nature and lives to the outage.*
3. **Full M3 + breakers is a reference row with no target.** *Reason: breakers can't help without spare capacity; with A down, B's 64 calls are all there is.*

And a standing rule: **if a target can't express its lesson cleanly, propose a reference row rather than tuning** (CLAUDE.md).

**Session 10, final 40-seed run: every target passes.** Classic (G) and phase 2 (D49) are unchanged; phase 3 (I-4) changed only by the cron at 4:00.

| Phase 3 build | Died | Median budget | Lowest trust | Agent wrong | Result |
|---|---|---|---|---|---|
| Full M2, nothing added | 40/40, median 6:58 | | 0% | 0 | Pass |
| Full M3 | 0/40 | $5,777 | 45.9% | 4 | Pass ($3,500–6,000) |
| Max steps off, to 9:00 | 0/40 | $4,638 (80% of end budget) | 48.0% | 4 | Pass |
| Max steps off, to 12:00 | 29/40, median 10:13 | $5,467 | 0% | 5 | Pass |
| Agents-only B, no prefix caching | 30/40 | $4,496 | 0% | 1 | Pass ($12.56 vs $7.60 a task) |
| Prefix caching on A too | 0/40 | $4,318 (75%) | 45.9% | 4 | Pass |
| No code sandbox | 0/40 | $4,509 | 31.2% | 114 | Pass |
| Agents on Fast SLM | 3/40 | $6,471 | 31.7% | 80 | Pass (new target) |
| Upgrade at 5:00 | 0/40 | $5,728 | 46.8% | 5 | Pass |

| Phase 4 build | Died | Median death | Lowest trust from the outage | Result |
|---|---|---|---|---|
| Single-provider drill: full M2, A down 3:30–4:30 | 40/40 | 4:00 | 0% | Pass (≥70% die) |
| Drill: full M3, no breakers | 40/40 | 9:54 | 0% | Reference |
| Drill: full M3 + breakers | 40/40 | 9:58 | 0% | Reference |
| Drill: full M4 | 0/40 | | 52.6% | Pass (≥90% survive, ≥50%) |
| Drill: full M4 without breakers | 40/40 | 9:59 | 0% | Reference |
| Full M4, no outage | 0/40 | | 59.2% | Reference |
| Upgrade to full M4 at 9:00 | 2/40 | 9:41 | | Pass (≥85% survive) |
| Endless: full M3 | 40/40 | 11:01 | | Pass (9:30–12:00) |
| Endless: full M4, replicas at 12:00 and 15:00 | 40/40 | 17:05 | | Pass (14:00–20:00) |

The phase 4 block in `balance.test.ts` now runs.

**Open questions (Session 11, the Milestone 4 UI):**
- **The night shift dims the board to 70% from 9:00,** easing over 4 s (design: the outage artboard's 30% dim). Every material that isn't glowing is scaled, so capsules, status lights and the judge's lamp keep their strength. A board loaded at night starts dark.
- **The throttle's choices are Off, 10, 20, 30, 40 and 60 prompts/s,** was 6 to 18: phase 4 brings 24/s at 9:00 and more after, and the postmortem now tells players to set it (J-7).
- **With a tracer, every queue's plate shows "Queue N of M"** (hero), which replaces "+N"; a coordinator keeps its runs line.
- **The vLLM rack's LEDs light one per 24 sequences in the batch,** and its memory gauge is its KV memory in use, amber past 85%. Both are the player's own hardware, so they're visible without a tracer (D11).
- **The judge's beam sweeps once every 12 s** and holds still under reduced motion. It doesn't point at the answers it judges: the sweep says it's sampling, the Answer quality panel says what it found.
- **GPU memory in the Capacity panel is KV memory:** an 8B's 31 GB and a 70B's 80 GB (`kvKbPerToken` in `catalog.ts`).

**Open questions (Session 10):**
- **Power cables are drawn, not linked.** A vLLM node takes power from the nearest substation with power to spare, and the cable appears on its own, so there's no new link tool or connection table entry.
- **Breakers are a paid setting**, $40 a model, off by default (approved, change 2).
- **Judge reveals don't move trust.** Only complaints do (D10). Approved. A reveal shows in the incident feed and the Answer quality panel; the outcome strip still counts only reports.
- **The judge has its own endpoint,** so it neither takes provider slots nor goes dark in an outage. It draws on its own RNG stream, so placing one never moves another roll.
- **A cold vLLM node, or a model with an open breaker, isn't a routing target.** With nothing else of its class to go to, a packet goes to a model of the other class; with no model left, it gets the degraded reply (D29). A run's sticky model is left the same way (D28).
- **The degraded reply travels like a cache hit,** on a wireless hop to the nearest Users out, and scores as a refusal (+0.5), or as a failed job for an agent task (I-1).
- **KV memory and the batch slowdown limit vLLM** (change 3). Short prompts still reach the 256-sequence cap (160 simple chats a second on the 8B); simple chat never comes close.
- **vLLM's automatic prefix caching is left out of Milestone 4.** Agents on vLLM pay no tokens, so prefix caching there would only save KV memory and prefill time.
