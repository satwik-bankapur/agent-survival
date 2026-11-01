# Balance reference model

`reference_sim.py` is the small Python model used to pick the Milestone 1 numbers in `docs/decisions.md`. It's a reference, not a spec. The TypeScript engine doesn't have to match it run for run; it only has to land inside the balance targets in decisions section G.

Run it with Python 3 (no dependencies). It takes about 15 seconds:

```text
python3 docs/balance/reference_sim.py
```

## What it models
- Poisson chat traffic, simple and complex
- Queues with deadlines, with expired packets removed before the queue is pulled
- A semantic cache with warm-up and wrong hits
- A prompt router with 92% accuracy
- Frontier API (64 concurrent) and Fast SLM (8 concurrent), with token costs and latency
- An output guardrail
- The trust ratio (D8) and both game-over rules

## What it skips
- Queue capacity limits and drops
- Delayed complaints (D10)
- Malformed JSON
- Transit times tied to layout (it uses a flat 150 ms per hop)

Expect the TypeScript engine to differ a little because of these.

## Reference results (40 seeds, first 5:00)

| Build | Died | Median death | Median budget at 5:00 |
|---|---|---|---|
| Naive: Users in → Frontier → Users out | 40/40 (37 bankrupt) | 4:04 | dead |
| All Fast SLM | 40/40 (trust) | 0:40 | dead, though richest of all |
| Router + Fast SLM + Frontier | 13/40 (trust) | 4:08 | $1,419 |
| Full minus cache | 8/40 (trust) | 4:10 | $1,026 |
| Full build | 0/40 | none | $1,352 |
| Full build with a second Fast SLM | 0/40 | none | $1,139 |
| Naive, then the full build at 1:00 | 0/40 | none | $1,112 |
| Naive, then the full build at 3:00 | 0/40 | none | $106 |
