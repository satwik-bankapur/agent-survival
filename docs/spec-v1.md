# AGENT: Survival Protocol, original design spec (v1)

> Historical document. `docs/decisions.md` overrides anything here that it contradicts, and `docs/build-plan.md` decides what gets built when. Keep this file for the full node catalog, phases and architecture. Its old instructions to an AI reviewer have been removed.

## 1. Context
I am a solo developer building an interactive 3D real-time architecture survival game called **"AGENT: Survival Protocol"** (inspired by the cloud architecture game `pshenok/server-survival`). 

Instead of traditional cloud infrastructure (Load Balancers, SQL DBs, CDNs), this game teaches and simulates **Production AI, GenAI, RAG, Agentic Workflows (LangGraph/ReAct), Model Context Protocol (MCP), Guardrails, and LLMOps**. 


## 2. Core Game Loop & Survival Mechanics

### 2.1 The Premise
The player is an AI Platform Architect starting with a small budget ($500), 100% Trust Score (Reputation), and an incoming stream of User Prompts. They must place 3D nodes on an isometric grid and wire them together to process prompts before SLA deadlines expire.

### 2.2 The 3 Competing Death Spirals (How Players Lose)
Unlike traditional server games where failure is just "Queue Full -> Request Dropped", AI architectures face three orthogonal threats simultaneously:

1. **The Token Bankruptcy Spiral (Budget hits -$1,000):**
   * *Cause:* Sending simple chat queries to expensive Frontier LLM APIs, or wiring Agentic workflows (`LangGraph ⇄ LLM ⇄ MCP Tool`) without a `Max-Steps Loop Breaker` or `Prefix/Prompt Caching`.
   * *Quadratic Token Burn:* In an agent loop, every tool output appends tokens to the context window. Loop 1 costs $0.01, Loop 2 costs $0.03, Loop 3 costs $0.09. If an agent gets stuck in a reasoning loop, budget drains exponentially.
2. **The Silent Hallucination Bleed (Trust Score hits 0%):**
   * *Cause:* AI fails silently. A hallucinated response (`isHallucinated: true`) looks like a normal completed request leaving the LLM unless intercepted.
   * *Trigger:* Routing `RAG_QUERY` traffic directly to an LLM without a `Vector DB`, skipping a `Cross-Encoder Reranker` when context gets noisy, or using a cheap `SLM (Llama-8B)` for complex reasoning.
   * *Defense:* Placing an `Output Guardrail` (Grounding Check) or `LLM-as-a-Judge Eval` node before the user exit to catch hallucinations and convert a catastrophic `-5.0%` Trust hit into a safe `-0.2%` fallback refusal ("I don't have enough information").
3. **The TTFT / TPOT Latency Choke (SLA Timeout Breach):**
   * *Cause:* Bloated RAG context windows (`inputTokens > 8,000`) choke **TTFT (Time to First Token / Prefill)**, while long Chain-of-Thought agent outputs choke **TPOT (Time Per Output Token / Decode)**. If a packet's total transit + queue time exceeds `sloDeadlineTick`, it dies in the queue (`-1.0%` Trust).

### 2.3 The 4 Escalating Survival Phases
1. **Phase 1: The Wrapper Startup (0:00 – 2:00)**
   * *Traffic:* 100% `CHAT` (low tokens, simple queries).
   * *Goal:* Transition from raw `User Ingress ➔ Frontier LLM API` to `Semantic Cache + Prompt Router ➔ Fast SLM (Llama-8B)` before per-token API fees eat the starting $500.
2. **Phase 2: The Knowledge Crisis (2:00 – 5:00)**
   * *Traffic:* `RAG_QUERY` + `ADVERSARIAL` (Prompt Injections / PII leaks) begin.
   * *Goal:* Place `Input Guardrail (Prompt Firewall + PII Redactor)` at Ingress. Branch the Router to `Embedding + FAISS Vector DB ➔ Cross-Encoder Reranker ➔ LLM`.
3. **Phase 3: Rise of the Agents (5:00 – 9:00)**
   * *Traffic:* `AGENT_TASK` (multi-step tool-calling queries) arrive.
   * *Goal:* Wire `LangGraph Coordinator ⇄ Frontier LLM` and `LangGraph Coordinator ⇄ MCP Servers (Web Search, SQL, Code Sandbox)` + `Loop Breaker`. Manage cyclic load amplification (10 req/s of Agent traffic = 30–50 req/s of internal LLM hits!).
4. **Phase 4: Enterprise Scale & LLMOps Chaos (9:00+)**
   * *Traffic:* High-TPS surges + Chaos Events (**HTTP 429 Provider Outages**, **Embedding/Vector Drift**, **System Prompt Cache Invalidation**).
   * *Goal:* Transition from Hosted APIs to **Self-Hosted vLLM GPU Clusters** (continuous batching + kW power substations), wire multi-provider **Fallback Model Chains** (Circuit Breakers), and add an **Ingestion Cron** to re-index drifted vectors.

### 2.4 Economic Foils (Preventing a Single "Overpowered" Node)
For LLM Inference, three node types act as economic foils to each other across different traffic curves:
* **Hosted Frontier API (Claude/GPT):** Low build cost ($20), $0 upkeep, 0 VRAM, highest reasoning & tool-calling accuracy (95%), **HIGH per-token cost**, vulnerable to external **HTTP 429 Rate Limit** events.
* **Hosted Fast SLM / Groq Node (Llama-8B):** Medium build cost ($60), low upkeep ($2/s), tiny per-token cost, ultra-fast TPOT (decode speed), **HIGH Hallucination & Tool-Misuse rate (35%+)** if fed complex RAG or Agent tasks.
* **Self-Hosted vLLM GPU Cluster:** High build cost ($300), high upkeep ($15/s) + requires **6 kW Power / 48GB VRAM** (via Substation nodes), **$0.00 per-token cost**, uses **Continuous Batching**. Suffers a **15-second cold-start weight loading blackout** on placement or model tier upgrade. Loses money at low RPS; dominates at high sustained RPS.

---

## 3. Complete Node Catalog (5 Toolbar Tabs)

1. **TAB 1: INGRESS & GUARD**
   * `Prompt Firewall ($50)`: Blocks `isMaliciousInjection` (Jailbreaks). Adds +25ms latency.
   * `PII Redactor ($45)`: Scrubs `containsPII` before external APIs. Prevents GDPR/PII fines.
   * `Semantic Cache ($70)`: Cosine-similarity vector cache. Instant completion on cache hit (35–60% hit rate for `CHAT` and `RAG_QUERY`).
   * `Prompt Router ($65)`: Inspects packet category (`CHAT`, `RAG_QUERY`, `AGENT_TASK`) and routes to appropriate downstream pipeline.

2. **TAB 2: MODELS & GPU**
   * `Fast SLM: Llama-8B ($60)`: Fast TTFT/TPOT, cheap, poor at complex agent loops.
   * `Frontier LLM API ($20 + $/tok)`: High accuracy, expensive per token, subject to 429 outages.
   * `Self-Hosted vLLM Cluster ($300)`: Continuous batching GPU node; zero token fee; requires VRAM/Power.
   * `Output Schema Guardrail / Pydantic ($55)`: Sits before User Exit. Validates JSON schema (auto-retries `isMalformedJson` once back to LLM) and runs grounding check to block `isHallucinated` responses.
   * *(Node Upgrade Toggle)* `Prefix / Prompt Caching ($80)`: Discounts `cachedPrefixTokens` by 90% in both cost and TTFT prefill latency during multi-turn Agent loops. *(Note: Temperature/Sampling sliders are intentionally excluded to avoid micro-management fatigue).*

3. **TAB 3: RAG & MEMORY**
   * `Embedding + FAISS Vector DB ($140)`: Appends retrieved chunks to packet (`newInputTokens += 4000`), boosts `contextQuality`. Upgradeable across 3 tiers: **Tier 1 (Flat Index)** ➔ **Tier 2 (IVF)** ➔ **Tier 3 (HNSW)** (faster search, higher recall, higher upkeep).
   * `BM25 Hybrid Search ($90)`: Combines sparse keyword + dense retrieval to boost `contextQuality`.
   * `Cross-Encoder Reranker ($110)`: Adds +120ms latency, **compresses retrieved context from 4,000 tokens down to 1,200 high-signal tokens** (saving downstream LLM TTFT & token cost!), and boosts `contextQuality` to 0.95.
   * `Episodic Memory / Postgres ($100)`: Persists multi-turn state and LangGraph checkpoints.

4. **TAB 4: AGENTS & MCP**
   * `LangGraph Coordinator ($120)`: Central supervisor hub for cyclic routing between LLMs and MCP tools. Includes configurable `Max-Steps Loop Breaker` (e.g., kills loops at <= 5 steps).
   * `MCP Server: Web Search ($60)`: Executes live search tool step; appends 1,200 tokens of scraped context.
   * `MCP Server: Code Sandbox ($95)`: Executes Python code tool step; isolates RCE risks.
   * `Human-in-the-Loop (HITL) Gate ($70)`: Catches failed/loop-broken agent tasks or high-risk actions, draining them safely over time to recover Trust Score (acts like an AI Dead-Letter Queue).

5. **TAB 5: LLMOps & EVAL**
   * `LangSmith / Langfuse Tracer ($75)`: Standalone observability node. Unlocks real-time Token Burn breakdown, TTFT/TPOT latency waterfall, and loop-kill telemetry in the HUD.
   * `LLM-as-a-Judge Eval ($90)`: Passively samples 10% of completed traffic to detect silent model drift and hallucinations.
   * `Chunking & Ingestion Cron ($65)`: Periodically re-indexes the Vector DB to clear **Embedding Drift** penalties.
   * `VRAM / Power Substation ($150)`: Standalone infrastructure node; adds +48GB VRAM / +6kW power capacity for local vLLM GPUs.

---

## 4. Module 1: The Simulation Engine & Mathematical Model

### 4.1 Deterministic Fixed-Timestep Accumulator
The simulation logic is 100% decoupled from the rendering frame rate so the game behaves identically on a 60Hz laptop and a 144Hz desktop, and can be unit-tested headlessly in `Vitest`:
* **Simulation Tick (`TICK_RATE_MS = 50ms` / 20 ticks per sec):** Advances worker timers, processes queues, deducts token costs, and routes packets.
* **Render Loop (`requestAnimationFrame`):** Interpolates 3D packet positions along wires using `alpha = accumulator / TICK_RATE_MS`.
* **Fast-Forward / Pause:** Controlled simply by multiplying `frameDelta * gameSpeed` (`0`, `1`, `2`, `4`).

### 4.2 The Stateful `PromptPacket` Interface
Unlike dumb packets in standard tower defense games, a `PromptPacket` mutates as it traverses the graph:

```typescript
export type TrafficCategory = 'CHAT' | 'RAG_QUERY' | 'AGENT_TASK' | 'ADVERSARIAL';

export interface PromptPacket {
  id: string;
  category: TrafficCategory;
  createdAtTick: number;
  sloDeadlineTick: number;

  // --- Token & Prompt Caching State ---
  newInputTokens: number;         // Fresh tokens added this step (pays 100% TTFT & API cost)
  cachedPrefixTokens: number;     // Prior loop/system tokens (pays 10% if Prompt Cache ON)
  outputTokensGenerated: number;  // Determines Decode latency (TPOT) & output cost

  // --- RAG & Grounding State ---
  contextQuality: number;         // 0.0 (ungrounded) to 1.0 (Hybrid + Reranked)

  // --- Agentic Loop State ---
  requiredToolSteps: number;      // e.g., 1 to 3 MCP tool calls required
  completedToolSteps: number;     // Increments upon successful MCP tool execution
  loopCount: number;              // Total cyclic bounces; triggers Loop Breaker if excessive
  lastVisitedNodeType: string | null;

  // --- Guardrail & Safety Flags ---
  containsPII: boolean;           // Scrubbed by Input PII Redactor
  isMaliciousInjection: boolean;  // Blocked by Input Prompt Firewall
  isHallucinated: boolean;        // Silent failure! Rolled at LLM; caught by Output Guardrail
  isMalformedJson: boolean;       // Rolled at LLM; caught & retried once by Output Guardrail
  hasRetriedSchema: boolean;      // Prevents infinite retry storms on broken JSON
}
```

### 4.3 The 4 Core Engine Equations

**Effective Input Tokens (with Prefix Caching):**
$$\text{EffectiveInput} = \text{newInputTokens} + (\text{cachedPrefixTokens} \times \text{cacheDiscountFactor})$$(where cacheDiscountFactor is 0.10 if Prefix Caching is enabled on the LLM node, else 1.0). After an LLM pass completes, cachedPrefixTokens += newInputTokens and newInputTokens = 0.

**LLM Inference Latency (TTFT Prefill + TPOT Decode):**
$$T_{\text{inference}} = \text{TTFT}_{\text{base}} + \left(\frac{\text{EffectiveInput}}{R_{\text{prefill}}}\right) + \left(\text{outputTokensGenerated} \times \text{TPOT}_{\text{model}}\right)$$

**Step Token Cost Burn (Hosted APIs):**
$$\text{Cost}_{\text{step}} = \left(\text{EffectiveInput} \times P_{\text{in}}\right) + \left(\text{outputTokensGenerated} \times P_{\text{out}}\right)$$

**Hallucination Probability Roll (Evaluated on LLM Completion):**
$$P(\text{Hallucination}) = H_{\text{base\_model}} + \underbrace{(1 - \text{contextQuality}) \times 0.60}_{\text{If category == RAG\_QUERY}} + \text{vectorDriftPenalty}$$

**Agent Tool-Call Success Roll (Evaluated in ReAct Loop):**
Each LLM has a toolCallingCapability (SLM = 0.55, Frontier = 0.92).
On each cycle, if Math.random() < model.toolCallingCapability, completedToolSteps++. Otherwise, the tool call fails, completedToolSteps does not advance, loopCount++, and error tokens (+400) are appended to newInputTokens for retry.

## 5. Module 2: The Node & Graph Engine (Queues, Batching & Cyclic Routing)

### 5.1 Uniform Queue-Worker State Machine
Every GameNode avoids giant switch/case blocks by running an identical 4-step pipeline every 50ms tick:
1. Decrement remainingTimeMs by 50ms on all activeWorkers.
2. For finished workers (remainingTimeMs <= 0), invoke node.onProcessComplete(packet) (mutating packet state/budget) and pass the packet to EdgeRouter.
3. Pull waiting packets from inputQueue (FIFO) into free activeWorkers slots (activeWorkers.length < maxConcurrency).
   - Special Case — Continuous Batching (vLLM GPU Cluster): Waits until inputQueue.length >= batchSize (e.g., 8) OR oldest packet wait time >= 400ms before pulling the entire batch into parallel execution simultaneously.
4. Kill any packet in inputQueue where currentTick > packet.sloDeadlineTick (Head-of-Line Blocking SLA failure).

### 5.2 Hub-and-Spoke Cyclic Routing (LangGraph Coordinator)
To prevent infinite zero-tick loops, every wire (Edge) enforces a mandatory transit time (e.g., 150ms / 3 ticks).

To simplify UX and reduce visual clutter, when a player links LangGraph Coordinator ➔ LLM or LangGraph Coordinator ➔ MCP Tool, the engine automatically creates a single bi-directional (two-lane) visual pipe that handles both the forward call and the return loop.

routePacketFromLangGraph(packet, outgoingNodes) executes 4 deterministic rules:
1. Loop Breaker Check: If packet.loopCount >= maxAllowedLoops, route to HITL_GATE (if wired) or OUTPUT_GUARDRAIL / EXIT.
2. Needs Reasoning: If packet.lastVisitedNodeType !== 'LLM_MODEL', route to the least-loaded connected LLM (SLM, FRONTIER_API, or VLLM_GPU).
3. Needs Tool Execution: If packet.lastVisitedNodeType === 'LLM_MODEL' AND packet.completedToolSteps < packet.requiredToolSteps, route to connected MCP_SERVER node.
4. Task Complete: If completedToolSteps >= requiredToolSteps, route to OUTPUT_GUARDRAIL or USER_EXIT.

### 5.3 Automatic Circuit Breakers & Fallback Chains
Every node tracks recentOutcomes: boolean[] (rolling window of 10). If failure rate exceeds 50% (e.g., during an HTTP 429 Provider Outage on a Hosted LLM API), its Circuit Breaker trips to TRIPPED_OPEN for 5 seconds. The router's findLeastLoadedNode() automatically skips TRIPPED_OPEN nodes, failing traffic over to any secondary LLM node wired by the player.

## 6. Module 3: Tech Stack, Zero-Lag Rendering & Folder Structure

### 6.1 The 3-Layer Decoupled Architecture
To prevent React Virtual DOM reconciliation from choking at 60 FPS with hundreds of moving packets:

**Layer 1: Pure TypeScript Simulation Engine (src/engine/)**
- Owns mutable game state (nodes, edges, PacketPool).
- Uses Object Pooling (PacketPool pre-allocates 1,000 PromptPacket slots at startup—zero Garbage Collection pauses during surges).

**Layer 2: 3D Isometric Canvas (src/canvas/ — React Three Fiber + Three.js)**
- Reads packet coordinates directly from GameEngine inside R3F's useFrame() hook at 60–144 FPS.
- Renders all active packets using a single THREE.InstancedMesh (1 GPU draw call for 1,000 spheres; sphere scale dynamically grows as inputTokens bloats!).
- Uses ground-plane Raycasting (Math.round(hit.x / TILE_SIZE)) for grid tile snapping.

**Layer 3: 2D React HUD Overlay (src/components/ — React + TailwindCSS + Zustand)**
- GameEngine pushes a lightweight telemetry snapshot to the Zustand store (uiStore.ts) every 250ms (4 times/sec) or on user click events. React never re-renders on simulation ticks.

### 6.2 Proposed Folder Structure

```text
agent-survival-protocol/
├── src/
│   ├── engine/                  # Pure TS (Zero React/Three imports — 100% Vitest testable)
│   │   ├── types.ts             # PromptPacket, GameNode, Edge interfaces
│   │   ├── catalog.ts           # Stats, costs, latency & accuracy curves for all nodes
│   │   ├── GameEngine.ts        # 50ms Fixed-Timestep accumulator & master loop
│   │   ├── PacketPool.ts        # Pre-allocated pool of 1,000 PromptPackets
│   │   ├── NodeProcessor.ts     # TTFT/TPOT math, Token burn, Hallucination & Tool rolls
│   │   ├── EdgeRouter.ts        # Conditional routing, LangGraph cycles, Circuit Breakers
│   │   └── WaveDirector.ts      # Escalating traffic waves & Chaos Events (429s, Drift)
│   ├── canvas/                  # React Three Fiber (60 FPS 3D Isometric World)
│   │   ├── IsometricScene.tsx   # Orthographic/Isometric Camera, MapControls, Bloom
│   │   ├── GridBoard.tsx        # Raycasting ground plane & placement preview
│   │   ├── NodeMeshes.tsx       # 3D procedural geometries + Drei <Html> labels
│   │   ├── WireSystem.tsx       # Glowing neon tubes (uni- & bi-directional lanes)
│   │   └── PacketSwarm.tsx      # THREE.InstancedMesh rendering all moving packets
│   ├── components/              # React 2D HUD Overlay (Updated at 4Hz via Zustand)
│   │   ├── TopControlBar.tsx    # Pause, 1x, 2x, Save/Share Sandbox
│   │   ├── LeftTelemetryHUD.tsx # Budget, Token Burn/s, VRAM, Trust Score, Traffic Mix
│   │   ├── RightOpsPanels.tsx   # Goodput/Evals, Vector Drift Alert, TTFT/TPOT Metrics
│   │   ├── BottomToolbar.tsx    # Select/Link/Demolish tools + 5 Node Category Tabs
│   │   └── NodeInspectorModal.tsx # Tier upgrades (Flat->IVF->HNSW) & Prefix Cache toggle
│   └── store/
│       └── uiStore.ts           # Throttled Zustand bridge between Engine and HUD
```

### 6.3 Vertical Slice Execution Plan (4 Milestones)

- Milestone 1 (Core Playable Loop — 6 Nodes): Grid placement, wiring, InstancedMesh packet movement, User Ingress, Prompt Router, Semantic Cache, Fast SLM, Frontier LLM API, Output Schema Guardrail.
- Milestone 2 (RAG & Hallucinations — +4 Nodes): Embedding + FAISS (Tier 1–3 upgrades), BM25 Hybrid, Cross-Encoder Reranker, Ingestion Cron, and Vector Drift mechanics.
- Milestone 3 (Agentic Cycles — +4 Nodes): LangGraph Coordinator, bi-directional MCP: Search & MCP: CodeBox pipes, HITL Gate, and quadratic loop token burn.
- Milestone 4 (LLMOps, Security & vLLM GPUs — +6 Nodes): Prompt Firewall, PII Redactor, Self-Hosted vLLM Cluster (continuous batching), Power Substation, LangSmith Tracer, and LLM-as-a-Judge.
- (Optional Future Milestone 5 — Hybrid Real AI Sandbox): Connect a Python FastAPI + LangGraph backend so players can optionally send real live prompts through their simulated topology.
