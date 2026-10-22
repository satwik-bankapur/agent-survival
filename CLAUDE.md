# AGENT: Survival Protocol

A real-time survival strategy game for desktop browsers that teaches production AI engineering. The player wires models, caches, routers, guardrails, RAG, agents and ops nodes on an isometric board so prompts get correct, fast, affordable answers. One developer, portfolio project.

## Read first
1. `docs/decisions.md`: the rules and numbers. It overrides the spec.
2. `docs/build-plan.md`: what to build, session by session. Do only the session you were asked to do.
3. `docs/spec-v1.md`: the original spec (node catalog, phases, architecture).
4. `design/` and `design/screens/*.png`: the visual source of truth, exported from the design canvas. It's a static mockup format, so never copy its HTML into `src/`. Rebuild it in React and React Three Fiber.
5. `docs/balance/`: the Python reference model behind the Milestone 1 numbers.

## Stack
Vite, React, TypeScript (strict), React Three Fiber with drei and postprocessing, Tailwind CSS v4, Zustand, Vitest. There's no server until Milestone 5.

## Architecture: hard rules
Three layers, with data flowing one way.
- `src/engine/` is the pure TypeScript simulation and owns all game state. It never imports React, three, `@react-three/*`, zustand or another `src/` layer (ESLint enforces this). It never calls `Math.random`, `Date.now` or `performance.now`: all randomness comes from the engine's seeded RNG.
- `src/canvas/` is the R3F board. It reads engine state inside `useFrame` and writes instance buffers directly. It never keeps per-packet data in React state.
- `src/components/` is the HUD. It reads only the 4 Hz telemetry snapshot from `src/store/uiStore.ts`, never engine internals.
- The UI changes the game only through `engine.dispatch(command)`. Commands apply at the next tick and are logged with their tick, so seed plus command log replays a run exactly.
- Silent failures stay silent (D10, D11). The snapshot exposes only what the player could know. Never leak an unrevealed wrong answer into the HUD, a label, a color or a sound.
- Outputs never block (D25). Nothing waits anywhere except in input queues.

## Layout
- `src/engine/`: `types.ts`, `catalog.ts`, `rng.ts`, `GameEngine.ts`, `PacketPool.ts`, `nodes/` (one file per node behavior), `EdgeRouter.ts`, `WaveDirector.ts`, `economy.ts`, `trust.ts`, `events.ts`, `commands.ts`, `telemetry.ts`, `scenarios.ts`, `__tests__/`
- `src/canvas/`: `IsometricScene.tsx`, `MatBoard.tsx`, `NodeMeshes/` (one file per node type), `TubeSystem.tsx`, `CapsuleSwarm.tsx`, `Placement.tsx`, `paths.ts`
- `src/components/`: `TopControlBar`, `LeftTelemetryHUD`, `RightOpsPanels`, `IncidentFeed`, `BottomToolbar`, `NodeInspectorDrawer`, `PacketXRay`, `PhaseCard`, `PostmortemScreen`, `TitleScreen`, plus shared primitives in `components/ui/`
- `src/store/uiStore.ts` (snapshot and UI state) and `src/store/runStore.ts` (which screen is up, the run in play)
- `src/run.ts`: the run lifecycle (title, run, postmortem, retries). The postmortem is written from the engine's run log (`runLog.ts`, `postmortem.ts`, D39)
- `src/styles/`: `tokens.css` (every design token as a CSS variable, exposed to Tailwind with `@theme`) and `globals.css`
- `scripts/balance.ts`: the headless balance report

## Commands
- `npm run dev`: run the game
- `npm test`: the fast Vitest suite, once (under 10 s, default timeouts)
- `npm run test:balance`: the slow suite, `*.balance.test.ts`: the balance targets on 20–40 seeds, the director and traffic statistics over many seeds, and the deadlock flood (about 3 min)
- `npm run test:perf`: the engine timing budgets, `*.perf.test.ts`, run alone
- `npm run typecheck`: `tsc --noEmit`
- `npm run lint`: ESLint
- `npm run balance`: headless balance report, 40 seeds per build. It prints the agent and RAG unit economics and the leak costs first, then the classic (section G), phase 2 (D49) and phase 3 (I-4, 0:00–9:00) tables
- `npm run shot -- <url> <file> [WxH]`: a Playwright screenshot (1440×900 unless `WxH` is given) of a served page, saved to `screenshots/` (gitignored) after fonts load and the scene renders a few frames. Start `npm run dev` first.

## Tooling notes
Tooling lives here, not in `docs/decisions.md`, which is only for game rules and numbers.
- CI (`.github/workflows/ci.yml`) runs typecheck, lint and `npm test` on every push, and `npm run test:balance` on pull requests to `main`. `test:perf` stays local because shared runners make timings noise.
- Below 1280 px wide the app shows `DesktopOnly` instead of the game (`useNarrow` in `components/ui/useCompact.ts`). From 1920 × 900 the rails and toolbar take their wide widths (`useLayout`).
- Node 24 LTS or newer. ESLint 10 needs Node `^20.19`, `^22.13` or `>=24`.
- three is capped below 0.187 by postprocessing's peer range (`>= 0.168.0 < 0.187.0`). Check that range before bumping three.
- TypeScript 6 because it's the newest version typescript-eslint supports (`<6.1.0`); TypeScript 7, the native port, waits until it does.
- The page opens on the title screen. Any dev URL parameter skips it and starts a Survival run straight away, with no phase cards.
- `?r=<code>` and `?w=<code>` are share links and work in production builds too (`src/share.ts`): the build in a sandbox at 0:00, or the run replayed read-only.
- three.js, drei and postprocessing load after the title screen, through `canvas/LazyScene.tsx`. Keep them out of anything the title imports at module scope, or the split goes away: `npm run build` should print two chunks, roughly 480 KB and 1,100 KB.
- Dev URL parameters (ignored in production builds): `?scene=<id>` runs a scenario from `scenarios.ts`, `?scene=stress` floods a long-tubed board until the whole 2,000-packet pool is in flight, `?seed=<n>` picks the seed, and `?at=<sec>` fast-forwards the run headless before it mounts (so `?scene=full&at=215` lands on the spike). A scripted build step re-frames the camera; nothing else moves it.
- `npm run shot` renders through SwiftShader (software WebGL), so its FPS meter reads single digits, and above about 1440 × 900 it can't render 10 frames inside Playwright's timeout. Shoot bigger viewports in a real browser. Measure frame rate in a real browser, or in Playwright with `--enable-gpu --ignore-gpu-blocklist --use-angle=d3d11`.
- ESLint ignores `design/`: it's the static design export, reference only.
- B612 Mono sets `.`, `,` and `:` in a full 0.65 em cell with the ink at the left, so "0.42 s" reads "0. 42 s". Render live numbers through `components/ui/Num.tsx`, which wraps those glyphs in `.num-punct` (−0.35 em). Digits keep their width, so a value never jitters at 4 Hz. The design export's own renders still show the gap.
- To compare against the design, serve it statically (`python -m http.server 5174` in `design/`) and shoot the artboards: `npm run shot -- "http://localhost:5174/01%20Hero.dc.html" design-hero.png`. `design/screens/` is empty.

## Working rules
- Start every session with a plan. Show it, wait for my OK, then build.
- Do only the session asked for. If you spot work for a later session, add it to that session in `docs/build-plan.md` instead of building it.
- Before saying you're done, run `npm run typecheck`, `npm run lint` and `npm test`, and fix what fails. If the engine or catalog changed, run `npm run test:balance` too. A test that needs more than the default 5 s timeout belongs in a `*.balance.test.ts` file. For visual work, run the app, take a screenshot with `npm run shot`, and compare it with the matching file in `design/screens/`.
- Every engine behavior gets a Vitest test. Prefer small pure functions.
- A change to any rule or number goes into `docs/decisions.md` in the same commit, with a one-line reason. Never widen a balance test's range to make it pass. Tune the catalog instead.
- If a balance target misses by more than 10 points (the "big" misses `npm run balance` lists, defined under D49), stop and show me the unit-economics and balance tables before tuning anything. Tune and log small misses as usual.
- If a target can't express its lesson cleanly, propose a reference row (a scenario with no target, shown for comparison) rather than tuning the catalog to fit it.
- If something is ambiguous, ask me. If I'm not around, pick the simplest option consistent with `docs/decisions.md` and log it under "Open questions".
- Commit at the end of each session as `Session N: <what changed>`.

## Code style
- TypeScript strict. No `any`, and no non-null assertions in engine code.
- Every gameplay number lives in `catalog.ts`, never inline.
- Per-tick and per-packet engine code doesn't allocate. Use the packet pool and preallocated arrays.
- Name things after the domain: packet, node, edge, lane, tick, outcome, snapshot.

## Look and feel (summary; `design/` is the authority)
- An architect's study model on a Prussian-blue cutting mat under a desk lamp at night: chipboard nodes shaped like architecture-diagram symbols, glass tubes, glowing token capsules, white scale-figure users.
- Fonts: Archivo (width 125, weight 800) for display, B612 for HUD text, B612 Mono for live numbers.
- Calm model, loud traffic: only capsules, status lights and alarms glow. Red only for real failures. Healthy states have no color. Never use color as the only signal.
- Opaque HUD panels with hairline borders. No glassmorphism, blur, gradient washes, emoji or all-caps labels.
