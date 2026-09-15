# LLM Answer Distribution (Markov over full-vocab logprobs)

Computes the **exact probability distribution** of a local LLM's answer over a
prompt — not sampling. The canonical task: "Pick a number between 10 and 30"
on Qwen3.8-27B-FP8 (vLLM, port 8000). Walks the model's own next-token
probabilities as a best-first Markov search over prefixes, absorbs each branch
at its first number, and books every gram of probability mass into exactly one
bucket: a valid number, an error verdict, a pruned tail, or the unexplored
frontier.

## Result (settled, 225k expansions, mass conserved to 1e-8)

- 49.9% of total mass is a valid single in-range number; within that:
  **23 = 29.8%, 17 = 24.0%, 21 = 10.5%, 22 = 6.3%, 20 = 5.2%, 25 = 5.1%,
  24 = 3.1%, 27 = 1.4%, 15 = 1.0%**, rest <0.2% each.
- 21.7% MULTIPLE_NUMBERS (dominated by the model re-quoting "10 and 30"),
  3.1% OUT_OF_RANGE, 0.8% dropped tail.
- 100 samples at temp 1.0 put 17 at 61% — that is sampling noise (±8pp at
  n=100); the full distribution splits 23/17 as near-twins.
- See `markov_final.png` (two panels: answer distribution summing to 100%,
  and the full mass ledger).

## Key files

- `worker.py` — the podman worker. Best-first walk, Dial bucket queue
  (decade buckets, monotonic pointer, amortized O(1) push/pop; LIFO within a
  decade is the bounded-precision trade-off), first-number absorption with a
  15-token lookahead for a second number, coverage-based stop
  (`frontier + pruned < TAIL_TARGET`), perpetual 16-request in-flight
  producer-consumer loop. Stdlib only. Persists to SQLite: `progress`
  (ledger snapshot every 60s incl. mass balance), `chains` (every booked
  branch with verdict/answer/text), `meta` (params, status, timestamps).
- `query.py` — on-demand CLI against the DB:
  `status | progress [N] | answers [N] | chains [N] [VERDICT] | answer N [k] | rate`
  (append a `.db` path to query a different run).
- `test_conservation.py` — preflight: replicates the exact process logic,
  runs ~500 live expansions, asserts the mass ledger stays ≈1.0 (drift < 1e-6;
  ~1e-9 float eps is expected) and prints the emerging answer ranking.
  Run this before any long run.
- `plot_final.py` — two-panel report (matplotlib, run in a python:3.12-slim
  container; host has no matplotlib).
- `Dockerfile` — python:3.12-slim + worker + query, `/data` volume for the DB.
- `project.json` — metadata.

## Run

```sh
# from a host with vLLM on 127.0.0.1:8000 and the model served as Qwen3.8-27B-FP8
podman build -t markov-worker:latest .
podman volume create markov-worker-data
podman run -d --name markov-worker --network host \
  -e VLLM_COMPLETIONS_URL=http://127.0.0.1:8000/v1/completions \
  -e DB_PATH=/data/markov_<task>.db \
  -e TOP_K=100 -e FETCH_K=300 -e WORKERS=16 -e TAIL_TARGET=0.10 \
  -v markov-worker-data:/data markov-worker:latest

podman logs -f markov-worker                        # progress + balance lines
podman exec markov-worker python3 /app/query.py status /data/markov_<task>.db
```

Tunables (env): `PROMPT`, `VLLM_MODEL`, `MAX_DEPTH=100`, `LOOKAHEAD=15`,
`TOP_K=100` (children kept per node), `FETCH_K=300` (logprobs requested),
`TAIL_TARGET` (stop when unexplored mass drops below this),
`MAX_EXPANSIONS=500000` (safety cap), `LOG_EVERY=60`s.

**Fresh DB filename per task** — the schema is append-per-run and mixing runs
in one DB double-counts mass.

## Verdicts (strict criteria)

- `answer` — exactly one number in 10..30 in the branch text
- `MULTIPLE_NUMBERS` — two or more numbers (incl. re-quoted prompt range)
- `OUT_OF_RANGE` — exactly one number, out of range; or none at the stop token
- `LENGTH_EXCEEDED_NO_NUMBERS` — no number at the 100-token depth cap
- ledger extras: `pruned` (top-K truncation + sub-floor bucket drops),
  `frontier` (unexpanded, in progress)

## Critical pitfalls (all hit in this task, all in the skill)

1. **Prefix condition via RAW `/v1/completions` with the assistant turn left
   OPEN.** Never `/v1/chat/completions` with an assistant message: it renders
   as a CLOSED turn (`...I<im_end>`), so the model treats every prefix as a
   finished answer and restarts — the walk then explores a degenerate
   digit-spam distribution ("I1I", "II1I") with ~60% OUT_OF_RANGE while mass
   conservation still balances to 1.0. Verify before any walk: the greedy
   temp=0 step-1 token must sit at the top of the prefix feed.
2. **vLLM has no coverage-based logprob mode.** `top_logprobs` is a count or
   -1; the GPU computes the full 248k softmax regardless, so top-K is already
   the coverage lever (top-100 ≈ 99.5% per node).
3. **Absorption is what makes it tractable.** Full-walk-to-stop captured ~0.05%
   of mass at 11k expansions; absorb at the first number and the frontier
   self-limits to no-number-yet prefixes (~15 min to a 10% tail at ~50 exp/s).
4. **Mass must be conserved and verified.** Preflight `test_conservation.py`
   before long runs; the worker logs `balance` (≈1e-8) in every progress row.
   Book every discarded mass into exactly one bucket — a dropped lookahead
   truncation is the classic silent leak.
5. **Producer-consumer, not lockstep batches.** A pop-8/wait-8 barrier caps
   vLLM continuous batching at 8 in flight (~16 exp/s); perpetual 16-in-flight
   gives ~45-58 exp/s.
6. **Digits: exact set `0123456789`.** `str.isdigit()` accepts `²`, `０` etc.
   and crashed a 62-minute run at exp 225k on `23²`.
7. Stop token on Qwen3.8-27B-FP8 is `
`
   (pipes, not `<im_end>`); build via `chr()` — terminal heredocs mangle
   escapes. `enable_thinking: false` (never `include_reasoning: false`).

Full procedure, script skeletons and the complete pitfall list: skill
`llm-answer-distribution` in `.hermes/skills/tigor/` (reference
`references/markov-bfs-recipe.md`).

## DB schema

- `meta(key, value)` — status, started_at, finished_at, params (JSON),
  history_<prev> (migrated aggregate snapshot of superseded runs)
- `progress(id, ts, expansions, valid, v_mult, v_oor, v_len, pruned_tail,
  frontier_mass, buckets, chains, elapsed, note)`
- `chains(id, ts, logp, mass, depth, stop_reason, verdict, answer, text)` —
  `mass` is the branch mass actually booked (×p_stop or ×p_child), never the
  raw prefix mass
