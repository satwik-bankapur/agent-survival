# AGENT: Survival Protocol

**A real-time survival strategy game that teaches production AI engineering.** Wire models, caches, routers, guardrails, RAG and agents on an isometric board so prompts get answers that are correct, fast and affordable, before your budget, your latency or your users' trust collapses.

<!-- TODO: record a 10–15 s loop of a run going from naive to full build, save as docs/media/demo.gif -->
![A run in progress: prompts flow through a semantic cache, router and guardrail as traffic grows](docs/media/demo.gif)

**[Play it in your browser](https://agentsurvival.runs-on.dev/)** · desktop browser, 1280 px or wider · no install, no account

[![CI](https://github.com/satwik-bankapur/agent-survival/actions/workflows/ci.yml/badge.svg)](https://github.com/satwik-bankapur/agent-survival/actions/workflows/ci.yml) [![Pages](https://github.com/satwik-bankapur/agent-survival/actions/workflows/pages.yml/badge.svg)](https://github.com/satwik-bankapur/agent-survival/actions/workflows/pages.yml)

---

## What it teaches

Most server-building games have one way to lose: the queue fills up. AI systems fail in three ways at once, and every fix for one feeds another.

| Death spiral | How it kills you | What the game makes you learn |
|---|---|---|
| **Token bankruptcy** | Every prompt to a frontier API costs real tokens. An agent loop re-reads its growing context on every step. Budget hits −$1,000 and the run ends. | Semantic caching, routing easy prompts to a small model, prefix caching, max-step limits on agents, and when self-hosting on GPUs beats paying per token. |
| **The silent wrong answer** | A wrong answer looks exactly like a right one. It even earns revenue. You find out 5–15 s later when users complain, and trust below 25% for 15 s ends the run. | Output guardrails, retrieval quality (vector DB, reranker, drift), LLM-as-judge evals, and why you can't fix what you can't measure. |
| **The latency choke** | Bloated RAG context slows prefill, agent loops multiply calls, rate limits bite. Prompts miss their deadlines and users get nothing. | Capacity planning, rate limits, throttling, circuit breakers and fallback providers. |

The run escalates through four phases, each adding the next real-world problem:

1. **Wrapper startup** (0:00–2:00): chat traffic straight to a frontier API. Learn caching and routing before API fees eat your $500.
2. **Knowledge crisis** (2:00–5:00): RAG questions, prompt injections and PII arrive. Learn retrieval, rerankers, firewalls and redaction.
3. **Rise of the agents** (5:00–9:00): multi-step tool-calling tasks. One agent task becomes several model calls with growing context. Learn coordinators, tool servers, loop limits and prefix caching.
4. **Enterprise scale** (9:00 onward): traffic keeps growing, with provider outages, vector drift and cache invalidations. Learn self-hosted vLLM clusters, power, circuit breakers, tracing and evals.

When a run ends, a postmortem reads the run's log and tells you what actually killed you, and what would have prevented it.

## How to play

- **Goal:** survive as long as you can. Keep the budget above −$1,000 and trust out of the red.
- **Build:** pick a node from the toolbar (tabs `1`–`5`, cards `Q`–`T`) and click the mat to place it. Use the link tool (`C`) to connect nodes with tubes. Prompts flow from *Users in* to *Users out* along your links.
- **Inspect:** select a node (`V`) to open its inspector: settings, tiers, upkeep. Pause (`Space`) any time; building works while paused.
- **Other keys:** `[` / `]` change speed, `U` unlinks, `X` or `Delete` demolishes (50% refund), `Esc` backs out or opens the menu.
- **Modes:** *Survival*, *Sandbox* (pick a budget and traffic level, with no game over), and *Daily outage* (the same seed for everyone today).

## Architecture

```
 src/engine/      pure TypeScript simulation: owns all state, seeded RNG, 20 ticks/s
      │  4 Hz telemetry snapshot (only what the player could know)
      ▼
 src/store/       Zustand UI store
      │
      ├──▶ src/canvas/      React Three Fiber board: reads engine state per frame into instance buffers
      └──▶ src/components/  React HUD: reads only the snapshot

 UI ──engine.dispatch(command)──▶ engine   (applied at the next tick, logged with its tick)
```

- **Three layers, one-way data flow, enforced by the linter.** ESLint rules stop `src/engine/` importing React, three.js, Zustand or any layer above it, and ban `Math.random`, `Date.now` and `performance.now` inside it.
- **A deterministic engine.** All randomness comes from one seeded RNG, and the UI changes the game only through logged commands. Seed plus command log replays a run exactly, which is what makes the balance suite, the daily seed and the postmortem possible. A test runs 6,000 ticks twice and compares a digest of the whole world.
- **Information hiding as a game mechanic.** The HUD snapshot exposes only what a real operator could see. An unrevealed wrong answer never leaks into a label, color or sound until you build the eval that catches it.
- **Deadlock-free agent loops.** Agents cycle between a coordinator, models and tool servers, a graph with cycles in it. Outputs never block: nothing waits anywhere except in input queues. A flood test drives agent traffic at 10× for 9 minutes and checks every tick that no return is dropped and the loop stays live.
- **No allocation in the hot path.** Packets live in a fixed 2,000-slot pool, and per-tick code uses preallocated arrays, so the board can carry its whole pool in flight at a steady frame rate.
- **A balance suite, not vibes.** Every number lives in one catalog. Each phase has written targets (for example, "the naive build dies in at least 90% of runs, mostly bankrupt; the full build survives in at least 95%"), checked across 40 seeds per build by `npm run balance` and in CI. A Python reference model in `docs/balance/` derived the first numbers.

**Stack:** Vite, React 19, TypeScript (strict), React Three Fiber with drei and postprocessing, Tailwind CSS v4, Zustand, Vitest. No server: it's a static site.

## Design decisions

Every rule and number is logged with its reason in **[docs/decisions.md](docs/decisions.md)**. A few that shape the game:

- **Silent failures stay silent.** Wrong answers earn money and look healthy, as they do in production. You see them only through complaints or the evals you build.
- **Outputs never block,** so a graph with cycles can't deadlock. Backpressure lives in input queues, where the player can see it.
- **Prices come from break-evens.** Each node's price is set so it beats its alternative above a stated traffic level, and that level is written next to the number.
- **Never widen a test to make it pass.** A missed balance target means retuning the catalog. A target that can't express its lesson becomes a reference row instead.
- **The postmortem reads the run log,** not a canned tip list, so it names what actually happened.

## Run it locally

Needs Node 24 or newer.

```sh
npm ci
npm run dev            # play at http://localhost:5173
npm test               # fast tests (under 10 s)
npm run test:balance   # 40-seed balance targets, director statistics, deadlock flood (~3 min)
npm run test:perf      # engine timing budgets, run alone
npm run balance        # print the full balance and unit-economics report
npm run build          # typecheck and build a static site into dist/
```

Any static host works: build command `npm run build`, publish directory `dist`.

## How it was built

One developer, built in planned sessions with [Claude Code](https://claude.com/claude-code). The process is in the repo:

- [`docs/spec-v1.md`](docs/spec-v1.md): the original game spec.
- [`docs/build-plan.md`](docs/build-plan.md): the session-by-session plan, one milestone at a time.
- [`CLAUDE.md`](CLAUDE.md): the standing rules: architecture, code style, and the stop-and-ask rule when a balance target misses badly.
- [`docs/decisions.md`](docs/decisions.md): every rule and number, with the reason and the tuning history.
