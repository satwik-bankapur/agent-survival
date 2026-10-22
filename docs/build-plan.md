# Build plan

Each session is one Claude Code conversation. For each one:
1. Run `/clear`, so the session starts fresh. CLAUDE.md loads automatically.
2. Type `/plan`, then paste the session's prompt after it, so Claude Code plans before it touches anything.
3. Read the plan, push back on anything that's off, and approve it.
4. When it's done, play with the result, check the "Done when" list, and commit.

Milestone 1 (sessions 0 to 5) is the playable core: chat traffic, six nodes and the full HUD. Milestones 2 to 4 add RAG and security, then agents, then LLMOps and GPUs. Milestone 5, a real backend, is optional.

**Why this order:** the engine is the game, and balance is the riskiest part, so it's built and tested headless first. The board and HUD then draw real engine data instead of mockup numbers, and every milestone ends playable.

---

## Session 0: Scaffold

Paste this:

```text
Read CLAUDE.md, then do Session 0 in docs/build-plan.md. Plan first and wait for my OK.
```

Build:
- Vite + React + TypeScript (strict) in this folder, not a subfolder. Use current stable versions of react, three, @react-three/fiber, @react-three/drei, @react-three/postprocessing, zustand, tailwindcss with @tailwindcss/vite, vitest, eslint with typescript-eslint, and tsx. Check that the R3F, drei and postprocessing versions match the React major version, then pin exact versions.
- The folder layout from CLAUDE.md, with a placeholder `index.ts` in each engine folder.
- ESLint: files under `src/engine/` may not import react, react-dom, three, `@react-three/*`, zustand, or anything from `src/canvas`, `src/components` or `src/store`. They also may not use `Math.random`, `Date.now` or `performance.now`.
- `src/styles/tokens.css`: every color, type style, spacing, radius and stroke token from the HUD language artboard in `design/`, as CSS custom properties exposed to Tailwind through `@theme`. Keep the artboard's names (`--mat`, `--ink`, `--pkt-agent` and so on). Where the export and `docs/` disagree on a value, the export wins.
- Fonts from Google Fonts in `index.html`: Archivo (wdth 125, wght 800), B612 (400, 700) and B612 Mono (400, 700), with `display=swap`.
- A placeholder screen: the full viewport in the mat color, the wordmark, and one sample panel built from the tokens.
- Scripts: `dev`, `build`, `test` (vitest run), `test:watch`, `typecheck`, `lint`, and `balance` (`tsx scripts/balance.ts`, printing "not implemented yet" for now).
- Vitest runs engine tests in the node environment.
- `git init`, a `.gitignore`, and a first commit.

Done when:
- `npm run dev` shows the placeholder with the right fonts and colors.
- `npm run typecheck`, `npm run lint` and `npm test` pass.
- A throwaway file in `src/engine/` that imports `react` or calls `Math.random()` makes lint fail. Show it failing, then delete the file.

---

## Session 1: Engine core, headless (Milestone 1)

Paste this:

```text
Read CLAUDE.md and docs/decisions.md, then do Session 1 in docs/build-plan.md. The engine stays pure TypeScript with no UI. Plan first and wait for my OK.
```

Build in `src/engine/`:
- `rng.ts`: seeded mulberry32 with helpers (float, int, chance, uniform, poisson).
- `types.ts`: Packet (spec v1's PromptPacket plus `difficulty`, a location, `revealed`, `producedByModelId`, `cacheHit` and `refused`), Node, Edge, Outcome, Command and TelemetrySnapshot.
- `catalog.ts`: the Milestone 1 node and traffic numbers from decisions section G, with each price's intended break-even in a comment.
- `PacketPool.ts`: 2,000 preallocated packets with a free list.
- `GameEngine.ts`: a fixed 50 ms tick in the D24 order. `tick()` for tests, `step(ms)` with the accumulator and the D35 guards for the canvas, and `alpha` for interpolation.
- `nodes/`: one behavior per node type: Users in, Users out, Fast SLM, Frontier API (shared provider pool, D14), semantic cache (D15), prompt router (D32) and output guardrail (D16, including the JSON retry). Every node uses the same queue and worker pipeline.
- `EdgeRouter.ts`: the D32 routing rules, no-route drops, and cache hits sent to the nearest Users out as a virtual transit.
- `WaveDirector.ts`: Milestone 1 traffic from section G.
- `economy.ts`, `trust.ts` (D8, D9) and `events.ts` (complaint scheduling for D10, plus incidents).
- `commands.ts`: placeNode, demolish, link, unlink and setSetting. Each returns ok or a plain reason ("Tile occupied", "Needs $55 more", "Loops are only allowed through the agent coordinator"). Link validation uses a per-type connection table plus the D27 cycle check. Transit time follows D30, using an L-shaped grid route.
- `telemetry.ts`: the player-visible snapshot (D11):
  - budget; revenue, token spend and upkeep per second; net; and the bankrupt-in estimate
  - trust and a 30-bucket outcome strip
  - traffic rate and mix
  - per-node stats: queue, busy, utilization, drops and state
  - provider usage
  - incidents as plain sentences
- `scenarios.ts`: scripted builds as command lists: naive, all Fast SLM, router without guardrail, full minus cache, full, and naive switching to full at 3:00.
- `scripts/balance.ts`: runs every scenario across 40 seeds for 5:00 and prints a table: deaths, causes, median death time, median final budget, minimum trust, timeouts, wrong answers and answers served.

Tests in `src/engine/__tests__/`:
- RNG determinism, and the same seed plus the same commands giving identical state after 6,000 ticks.
- Tick order: expired packets leave the queue before it's pulled, and packets that expire mid-processing still cost tokens.
- Full queues drop arrivals, and a finished worker never waits.
- Router accuracy, cache warm-up and wrong hits, and guardrail recall and false alarms (statistical tests with tolerances).
- Economy: revenue at exit, cost at model completion, upkeep per tick, refunds, and no purchase past −$1,000.
- Trust: it matches the closed-form decay, the 15-second critical countdown works, and complaints land 5 to 15 s after exit.
- Command validation, including cycle rejection.
- The snapshot never contains an unrevealed wrong answer.
- `balance.test.ts`: the section G targets, with 20 seeds to keep it fast.

Done when:
- All tests pass and `npm run balance` prints a table inside the targets. If a target misses, tune `catalog.ts`, log the change in decisions, and tell me what you changed.
- One 6,000-tick run takes under 200 ms.
- You can explain, tick by tick, how a packet moves through the full build.

---

## Session 2: The board (Milestone 1)

Paste this:

```text
Read CLAUDE.md, section E of docs/decisions.md, and the board language and hero screens in design/. Then do Session 2 in docs/build-plan.md. Plan first and wait for my OK.
```

Build in `src/canvas/`:
- `IsometricScene.tsx`: an orthographic camera at 30° elevation and 45° yaw; MapControls with rotation off, zoom from 0.5× to 2×, and panning limited to the mat. The engine steps from `useFrame`.
- `MatBoard.tsx`: a 26 × 18 tile mat with a procedural canvas texture:
  - a fine grid, with a heavier line every 4 tiles
  - ruler ticks, A–Z and 1–18 grid references, and angle guides
  - a soft lamp falloff from the top left
  - Draw the text after `document.fonts.ready`.
- Lighting: one warm directional key light (#FFE2B8) from the top left with soft shadows, plus a low, cool fill. Tune it so the chipboard faces read close to the design's top, left and right values.
- `NodeMeshes/`: the Milestone 1 nodes as low-poly forms with small bevels:
  - Fast SLM tower with a spinning ring
  - Frontier frosted cloud with its tether and anchor pad
  - cache drum
  - hexagonal router
  - guardrail arch with a moving scan plane
  - both user plazas with instanced scale figures
  - a status light and a label plate (drei `Html`) on every node
- `TubeSystem.tsx`: glass tubes along each edge's grid route, with rounded corners, standoffs and a faint inner core. Congested tubes tint amber. `paths.ts` builds the 32-point arc-length samples (D33).
- `CapsuleSwarm.tsx`: one `InstancedMesh` of capsules for every live packet:
  - interpolated along tubes and oriented to the tangent
  - length from tokens, color from category
  - upright in queue racks around nodes
  - cache hits on a dotted arc; refusals hollow
  - Use emissive colors above 1.0 with tone mapping off on that material, so bloom stays selective.
- Bloom through postprocessing, with a high luminance threshold.
- A dev-only `?scene=<name>` loader that runs a scenario from `scenarios.ts`, so the full build runs before the build tools exist. Session 1 left the hooks: `scenarioById(id)` plus `attachScenario(engine, scenario)`, with ids `naive`, `all-slm`, `router`, `full-minus-cache`, `full` and `naive-to-full`. Tubes and virtual hops follow the L-shaped route from `routeCorner(a, b)` in `src/engine/grid.ts` (x first, then y), so the canvas matches the transit times the engine uses.
- The Users out figures thin out as trust falls.

Done when:
- `?scene=full` shows the full build running smoothly at 60 fps: packets moving, queues filling during the 3:30 spike, and complex chats visibly longer.
- A stress scene with 2,000 live packets holds 60 fps.
- `npm run shot -- "http://localhost:5173/?scene=full" board.png` reads like the board area of the hero artboard in `design/screens/`. List the differences that remain.

---

## Session 3: The HUD (Milestone 1)

Paste this:

```text
Read CLAUDE.md and the HUD language, hero, opening and trust-critical screens in design/. Then do Session 3 in docs/build-plan.md. Plan first and wait for my OK.
```

Build in `src/components/` and `src/store/`:
- `uiStore.ts`: the latest snapshot plus UI state (tool, tab, selection, hover, speed). The engine pushes a snapshot 4 times a second, and components subscribe with selectors.
- `TopControlBar`:
  - the wordmark with its capsule colon
  - the phase timeline with a playhead and a next-up marker
  - the clock, pause/1×/2×/4×, and a menu button
- `LeftTelemetryHUD`:
  - Money: budget, revenue, tokens, upkeep and net; a 60 s sparkline with the −$1,000 line; "Bankrupt in …"
  - Trust: the big number, the 30-bar outcome strip, the "Wrong answers: unknown" legend, and the critical countdown ring with the red edge glow
  - Traffic: rate, mix bar with shape cues, and what's next
  - Capacity: Frontier A's rate limit, with power and GPU memory hidden until GPUs exist
- `RightOpsPanels`:
  - `IncidentFeed` live
  - Latency, Answer quality, Retrieval and Token spend in their locked "No telemetry" states, with their place-node buttons disabled and labeled "Arrives in a later milestone"
- `BottomToolbar`: tools with key hints, the five tabs, and node cards with cost, upkeep, hotkey and every card state. Only the Milestone 1 cards are enabled.
- Shared primitives in `components/ui/` (panel, cell, meter, sparkline, badge, segmented control), built from the tokens.
- Numbers in B612 Mono with tabular figures, so nothing jitters at 4 Hz.

Done when:
- The HUD matches the hero, opening and trust-critical screens in `design/screens/`: take each with `npm run shot -- <url> <file>` and list what's left. It still fits at 1280×720 (check that one in the browser; `shot` is fixed at 1440×900).
- On the starting board, the money drains, the bankrupt-in time counts down and trust reacts, all from real engine data.
- No component re-renders more than 4 times a second during play. Check with the React profiler.

---

## Session 4: Build tools and inspector (Milestone 1)

Paste this:

```text
Read CLAUDE.md, then do Session 4 in docs/build-plan.md. Plan first and wait for my OK.
```

Build:
- Placement: raycast to the mat, snap to tiles, and show the placement ghost with its price. Invalid tiles show red with the reason. Click to place.
- Link tool: click a source to see a dashed ghost tube following the grid route to the cursor, then click a target. Invalid targets show red with the engine's reason.
- Unlink (click a tube) and demolish (click a node, 50% refund), each with a short toast.
- Select: crop-mark corners on the node, and the `NodeInspectorDrawer` with its header, live stats and a demolish button. Milestone 1 nodes have no settings yet, so show the stats and one teaching line per node type. The selected node's label plate goes reverse video (design: "Selected"); plates are DOM elements in `src/canvas/LabelPlates.tsx`, keyed by node id.
- Board badges from the design's node states, anchored above the node: "No route" on a node with no way out, the "Timed out" badge with its fizzle when a queued prompt expires, and "Wrong answer reported" with a red flag in the exit crowd when a complaint lands. *(Deferred from Session 2.)*
- A brief white flash at the cache on each hit, before the capsule leaves on its dotted arc (design: "Semantic cache hit"). *(Deferred from Session 2.)*
- Keyboard:
  - V, C, U and X for tools; 1 to 5 for tabs
  - Space to pause; [ and ] for speed
  - Delete demolishes the selection; Esc opens the menu (the top bar's Menu button and dropdown exist from Session 3, with Save and Share as disabled placeholders; Esc should toggle the same `menuOpen` in `uiStore`, and close it on a click outside)
  - Q to T pick the open tab's cards (the cards already show the keys and set `selectedCard` in `uiStore`)
- The opening coach mark on Frontier A, shown the first time net money goes negative.

Done when:
- Starting from the naive board, I can build the full Milestone 1 architecture with the mouse alone and survive to 5:00.
- Every rejected action explains itself in plain words.
- Engine tests still pass, with new tests for any new commands.

---

## Session 5: Run lifecycle and polish (Milestone 1 complete)

Paste this:

```text
Read CLAUDE.md and the postmortem and title screens in design/. Then do Session 5 in docs/build-plan.md. Plan first and wait for my OK.
```

Build:
- `TitleScreen` with three modes:
  - Survival
  - Sandbox: no game over, adjustable budget and traffic
  - Daily outage: seed from today's date
- `PhaseCard` at the start of each phase. Milestone 1 is chat-only, so the 2:00 card says traffic is growing and questions are getting harder.
- The game-over flow into `PostmortemScreen`:
  - cause and time, and a facts row
  - a budget-and-trust timeline with markers
  - root cause, contributing factors, what went well and action items, all generated from the run log by simple rules
  - buttons: Retry this seed, Retry with this build, New run
- The paused state (board desaturated 20%, "Paused" in the speed control) and the `PacketXRay` card for a clicked capsule.
- Settings: a master volume placeholder, reduced motion (no blinking or pulsing), and an FPS counter. Reduced motion also stops the Fast SLM ring and the guardrail's scan plane (both in `src/canvas/NodeMeshes/`), and status lights blink at 1 Hz for warnings and 2 Hz for alarms only when it's off (design: "Node states"). The board's dev FPS meter is drei `<Stats>` in `IsometricScene`; reuse or replace it.
- Label plates name a lone node without a number ("Prompt router", "Output guardrail", as in the hero) and number them only once there are two of a type ("Fast SLM 1", "Fast SLM 2"). The labels come from the engine (`board.ts`), so its naming tests change with it. *(Deferred from Session 4.)*
- The opening coach mark covers a label plate when it opens on a built board (`?scene=naive-to-full&at=185` hides "Fast SLM 1"). Keep the card clear of plates, or anchor it on the side away from them. *(Deferred from Session 4.)*

Done when:
- The full loop works: title, run, death, postmortem, retry.
- "Retry this seed" with the same moves gives the same run.
- Playtest: the naive board dies around 4:00, the full build survives, and the postmortem names the right root cause for both.
- The title and postmortem screens match their files in `design/screens/`: take each with `npm run shot -- <url> <file>` and list what's left.

---

## Milestone 2: RAG and security (sessions 6 and 7)

Paste this for session 6, and again for session 7 to finish the rest:

```text
Read CLAUDE.md and docs/decisions.md, then do Milestone 2 in docs/build-plan.md, engine and tests first. Propose any new numbers in docs/decisions.md and wait for my OK before building.
```

Scope:
- RAG_QUERY and ADVERSARIAL traffic from 2:00
- Vector DB with three tiers and drift; BM25 hybrid search; reranker (D17); ingestion cron
- Prompt firewall and PII redactor (D18), and breaches
- Ingress throttle (D7) and cache strictness (D15)
- Guardrail recall tied to context quality (D16)
- RAG chunk plates on capsules; the Retrieval panel unlocks once a vector DB is placed

Session 6 (planned): the playtest fixes (shared rate limit shown, coach mark retires, tidier tubes with highlighting), the incident director with its banner, every Milestone 2 engine rule and number (decisions section H) with tests and both balance tables, and enough UI to play phase 2: live cards on placeholder meshes, the event banner, and inspector settings (vector DB tier, cache strictness, throttle).

Session 7: real meshes for the six new nodes from the design, RAG chunk plates on capsules, the Retrieval panel unlocking once a vector DB is placed, adversarial capsule styling, and matching the board and inspector to the design screens. Also from Session 6: the Traffic panel's mix bar still shows only simple and complex, so add the RAG and attack shares (the snapshot's `categoryShare` already has them); label plates of nodes on neighbouring tiles crowd each other (the M2 scenarios put the firewall, redactor and cache side by side); and the inspector settings (throttle, strictness, tier) haven't been screenshot-checked against the design.

*Session 7 done:* real meshes for the six nodes (vector DB tiers and drift, cron pulse), chunk plates that the reranker strips, adversarial shards that shatter at the firewall, the Retrieval panel unlocking with a vector DB, the four-kind traffic mix, non-overlapping label plates, and the inspector's strictness and tier ladder matched to the HUD language sheet. Deferred to Milestone 3 (Session 8): the PII tag and the redactor's black bar on capsules (design: "Contains personal data", "Redacted").

Done when: new phase 2 balance scenarios pass (a router-to-model build without retrieval dies; vector DB plus reranker survives), and the board and inspector match the design.

## Milestone 3: Agents (sessions 8 and 9)

Paste this:

```text
Read CLAUDE.md and docs/decisions.md, then do Milestone 3 in docs/build-plan.md, engine and tests first. Propose any new numbers in docs/decisions.md and wait for my OK before building.
```

Scope:
- AGENT_TASK traffic from 5:00
- LangGraph coordinator: spec v1's four routing rules, plus admission control (D26), sticky models (D28) and the max-steps setting
- MCP web search and code sandbox with required tools (D19), and tool-borne injection (D20)
- Human-in-the-loop gate (D21)
- Quadratic context growth (D6) and prefix caching as a bet (D5)
- Visuals: two-lane tubes, capsule bands, comet trails, and the coordinator's orbit track. Also the M2 capsule modifiers left from Session 7: a small amber PII tag riding on prompts with personal data, popped by the redactor into a black bar (design: "Modifiers"). The white-hot output tip already exists from Session 5 (its own instanced mesh on answered capsules); the band attribute adds the other two bands, the frosted cached prefix and the new input, and can take the tip over (D34).

*Session 8 done:* the Milestone 3 engine (agent traffic from 5:00, coordinator with D26 admission and two-lane returns, MCP web search and code sandbox, human review gate, D5 prefix caching, a second Frontier provider, compounding per-step errors), its tests and the flood test; phase 3's targets tuned with you and locked (decisions section I), full M3 at $3,500–6,000. Playable UI: placeholder meshes for the four new nodes, live Agents and MCP cards plus the prefix caching card, inspector settings for max steps, prefix caching and provider, coordinator runs and stuck runs in the inspector, agents in the traffic mix, and the X-ray naming every packet's kind. Session 9: real meshes, two-lane tubes, capsule bands, the coordinator's plate ("16 of 16 runs, 9 stuck"), capsules growing with context, the X-ray's step count and compounded reliability for agent tasks (your call), and, carried over from Session 7, the PII tag and the redactor's black bar on capsules. A coordinator's label plate sits over its own mesh, so clicking it misses the node; plate layout should leave the mesh clickable.

*Session 9 done:* real meshes for the coordinator (glass orbit track with a bead per run slot, stuck runs as fat amber beads), web search, code sandbox (its inner cube glows on a contained taint) and review gate; two-lane tubes, the return lane on its forward lane's route; capsule bands (frosted cached prefix, new input, output tip), comet trails per loop, swelling past the length cap, the PII tag and the redactor's black bar; the X-ray's three bands, loop, tool steps and compounded reliability; the coordinator plate ("16 of 16 runs, 9 stuck", amber while any are stuck); clicks no longer stolen by engraved lines, and a tile-sized pick box per node. Full M3 now throttles Users in at 40/s and survives 40 of 40 (decisions I-4).

Done when:
- A test floods the agent loop at 10× traffic, and nothing deadlocks or drops a return.
- An agent build without max steps goes bankrupt.
- The X-ray card shows bands that match the packet's tokens.

## Milestone 4: LLMOps, GPUs and chaos (sessions 10 and 11)

Paste this:

```text
Read CLAUDE.md and docs/decisions.md, then do Milestone 4 in docs/build-plan.md, engine and tests first. Propose any new numbers in docs/decisions.md and wait for my OK before building.
```

Scope:
- Tracer: unlocks node stats and the Latency and Token spend panels. With it, label plates gain their stats line (hero: "Queue 3 of 8", "21.2 calls/s") and the amber plate on a node whose queue is full. *(Deferred from Session 4.)*
- LLM-as-a-judge: 10% sampling, the lighthouse sweep, and attributed reveals
- vLLM cluster with continuous batching and KV memory (D22) and cold starts; power substation and power cables
- Circuit breakers with half-open probes (D29)
- Chaos from 9:00: provider outages, cache invalidation, drift surges and traffic surges
- Visuals: the night-shift lighting change, and the provider outage screen from `design/`

*Session 11 done:* meshes for the vLLM rack (memory gauge, batch LEDs, a warm band climbing it while it loads weights), the power substation, the tracer and the judge's lighthouse with its sweeping beam; power cables on the mat; live build cards for all four, the vLLM card blocked with "Needs N kW" until a substation has power to spare; inspector settings for the vLLM tier with each tier's cold-start cost, a circuit breaker on every model and the judge's sampling; the Latency, Answer quality and Token spend panels unlocking with a tracer and a judge; plate stats ("Queue 3 of 32") with a tracer; the outage banner, the provider meter's "Outage" alarm, and Power and GPU memory meters in the Capacity panel; the night shift from 9:00; and the Retrieval drift meter past its cap. Dev only: `?scene=<id>+ops` adds a tracer and a judge to a scenario.

*Session 10 done (engine only):* every Milestone 4 rule and number in decisions section J, with tests and the J-1 to J-3 tables in `npm run balance`; the phase 4 table runs, and its big misses wait for review (J-6). Session 11, the UI, also owes:
- meshes for the vLLM cluster, power substation, tracer and judge (they render nothing yet), power cables drawn from `vllm.powerFromId`, and live build cards for all four;
- inspector settings: vLLM tier with the cold-start line ("Loading weights: about $1,400 of upkeep before first token", from `vllm.coldStartCost` and `coldSecondsLeft`), the circuit breaker on every model, the judge's 1/5/10% sampling;
- the Latency, Token spend and Answer quality panels from `snapshot.tracing` and `snapshot.answerQuality`, and plate stats with a tracer;
- the provider meter's hatched red alarm from `providers[].down`, and the outage screen;
- the Retrieval panel's drift meter can now pass 100% during a drift surge (up to 0.25 against the 0.15 cap);
- the new events' banner texts already come from the engine (`eventEffectText`).

Done when:
- An outage on Frontier A fails over to a second provider or to vLLM without a trust collapse.
- A single-provider build loses heavily during the same outage.
- A build without a judge only learns about wrong answers from complaints.

## Session 12: Ship prep (no new mechanics)

- `npm test` is the fast suite (about 5 s at default timeouts, from 216 s). The 20/40-seed balance targets, the director and traffic statistics, and the deadlock flood moved to `*.balance.test.ts` (`npm run test:balance`).
- CI: typecheck, lint and fast tests on every push. The balance suite runs on PRs to `main`.
- Desktop gate below 1024 px. The host is still open: any static host, `npm run build` to `dist/`.
- README draft (demo GIF, deploy URL and repo path are placeholders).
- ~~Public-repo check: strip the design tool files (`design/support.js`, `iso.js`, `*.dc.html`, `.thumbnail`) from history with `git filter-repo` before publishing, then rename `master` to `main`.~~ Done in Session 14.
- ~~Open: between 1024 and 1279 px wide (and under 900 px tall), the HUD is cramped.~~ Closed in Session 13: the gate is 1280 px.
- ~~Open: the production bundle is one 1.5 MB chunk (437 KB gzipped), mostly three.js.~~ Closed in Session 13: the board is its own chunk.

## Session 13: Help, onboarding and ship-blocking fixes (no new mechanics)

- **Share links** (`src/share.ts`): the menu's Share copies a link holding the seed and the command log, deflated and base64url'd. `?r=` opens the build in a Sandbox with the budget it took, at 0:00 and paused; `?w=` replays the run at its own ticks with the board read-only. A full M4 build is an 836-character code (879-character URL). Save is gone from the menu, and so is the postmortem's disabled "Save as image".
- **Bugs:** board badges are clamped inside the board area, so none hides under a rail; the phase timeline and the rails grow with the window (wide widths from 1920 × 900).
- **Desktop gate raised to 1280 px.** Checked at 1366 × 657 and 1440 × 789, the laptop viewports with browser chrome: the HUD fits without a tighter layout.
- **The board loads after the title screen.** `canvas/LazyScene.tsx` splits three.js, drei and postprocessing into their own chunk: the initial bundle is **477 KB (149 KB gzipped), from 1,547 KB (437 KB)**, with the board's 1,107 KB (301 KB) arriving behind the title.
- **Guided first run** (`tutorial.ts`, `TutorialCard.tsx`): seven steps on the opening board, each waiting for the player's action, offered once on the 0:00 phase card and skippable at every step.
- **Field guide** (`guide.ts`, `HelpPanel.tsx`): `?` or the Help button; an entry per node and per idea with four fields each, a legend, and every number read from the catalog. A small "?" on each HUD panel, on the inspector and on each postmortem action item opens the matching entry.
- Open: the guide's entries are written for Milestone 4's catalog. Any new node type needs its entry, which `guide.test.ts` enforces.

## Session 14: Publish (no new mechanics)

- **The flaky test was `engine.perf.test.ts > performance > runs 6,000 ticks of the {full,p2-full} build in under 200 ms`.** It budgeted `performance.now()`, which counts the milliseconds the process sat descheduled while something else held the cores: with the balance suite alongside, the unchanged engine measured 216 ms and 291 ms against the 200 ms cap, where idle it measures 32 ms. It now budgets `process.cpuUsage()`, the work actually done, which moved only 63 ms -> 79 ms under the same load. The cap stayed at 200 ms. `npm test` itself never flaked: 38 runs, all green.
- **History cleaned.** `git filter-repo --invert-paths` dropped `design/support.js`, `design/iso.js`, `design/*.dc.html` and `design/.thumbnail` from all 17 commits, and `.gitignore` keeps them out from here. `design/README.md` and `design/screens/*.png` stay tracked. The repo went from 5.05 MiB of loose objects to a 585 KiB pack. The pre-rewrite mirror is kept outside the repo at `../agent-survival-backup-2026-10-22.git`.
- **`master` renamed to `main`.** The outer wrapper repo (two commits, both pointer bumps of the `agent-survival` gitlink, no remote) is retired: `agent-survival` is the repo that ships.
- **GitHub Pages** on `agent-survival.runs-on.dev`: Vite's `base` stays `/`, `public/CNAME` ships the domain into `dist/`, and `.github/workflows/pages.yml` runs the fast suite, builds and publishes `dist/` on every push to `main`.

## Milestone 5 (optional): real prompts

A Python FastAPI + LangGraph backend lets a player send a real prompt through their simulated topology and see real tokens, latency and cost next to the simulated ones. Plan it separately once Milestone 4 ships. The game must keep working fully offline without it.
