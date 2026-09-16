# LLM Answer Distribution (Markov over full-vocab logprobs)

Computes the **exact probability distribution** of a local LLM's answer over a
prompt — not sampling. The canonical task: "Pick a number between 10 and 30"
on Qwen3.8-27B-FP8 (vLLM, port 8000). The walk reads the model's own next-token
probabilities as a best-first Markov search over prefixes, absorbs each branch
at its first number, and books every gram of probability mass into exactly one
bucket: a valid number, an error verdict, a pruned tail, or the unexplored
frontier. The result is cross-validated against real sampling.

## Result (v7, settled, 187k expansions, mass conserved to 1e-8, matches n=1000 sample)

- **96.4%** of total mass is a valid single in-range number. Within the valid:
  **17 = 55.2%, 23 = 16.5%, 21 = 13.7%, 24 = 4.9%, 27 = 3.3%, 25 = 2.3%,
  20 = 2.2%, 22 = 0.9%, 15 = 0.8%**, rest <0.05% each.
- 0.45% MULTIPLE_NUMBERS, 0.33% OUT_OF_RANGE, 0% length-exceeded,
  1.45% pruned tail, 1.35% unexplored frontier.
- **Answer: the model picks 17 ~55% of the time.** The n=1000 temp-1.0 sample
  independently gives 17 = 56.0% — the two estimators agree to within the
  ±2.4pp sampling noise band at every value (max gap 3.4pp, at 21).
  See `markov_v7_cmp.png` (walk vs sample, paired bars + ±diff),
  `markov_v7_decay.png` (the 6 mass buckets over 100 min),
  `markov_v7_progress.png` (live snapshot).

### Why v5 was wrong (two independent bugs, both found via the sample cross-check)

The earlier v5 run reported "23 = 29.8%, 17 = 24.0%" and called 23/17 near-twins.
A 1000-sample cross-check exposed that this was **wrong by ~30pp on the top
answer** — one estimator was systematically broken. Two root causes, both in
the v5 worker, both fixed in v7:

1. **Hand-rolled chat template.** v5 built the base prompt as a literal string
   with an explicit empty-think block. Its newline count / special-token
   spelling differed from the server's own `apply_chat_template(...,
   enable_thinking=False)` by a few bytes — enough to inflate the bare-digit
   start probability ~3× and swap the 23/17 mass. v7 instead captures the
   template **once as 23 plain integer token IDs** and builds every request as
   `BASE_IDS + /tokenize(prefix)` (proven byte-identical to whole-string
   tokenization for 16/16 real prefixes — no special-token string anywhere in
   the worker, nothing to mangle).
2. **vLLM 0.29 logprobs schema change.** On the pinned 0.29 stable build,
   `/v1/completions` takes `logprobs` as a **single int count**. v5's old form
   `logprobs: true, top_logprobs: N` is **silently ignored** and returns 1–2
   tokens non-deterministically — corrupting the whole walk while mass
   conservation still balanced to 1.0 (a trap: conservation validates
   bookkeeping, not the distribution you fed it). v7 uses `logprobs: 500`.

Both bugs are invisible to the argmax preflight and to mass conservation —
only the **value-based distributional preflight** (p('I') ≈ 0.655, not 0.356)
and the **sampling cross-check** catch them. See the skill.

## Key files

- `worker_v7.py` — the podman worker (current). Token-ID prompt, Dial bucket
  queue (decade buckets, monotonic pointer, amortized O(1); LIFO within a
  decade is the bounded-precision trade-off), first-number absorption with a
  15-token lookahead for a second number, coverage-based stop
  (`frontier + pruned < TAIL_TARGET`), perpetual-N-in-flight producer-consumer.
  Stdlib only. Self-checks the template against the server's own chat route at
  boot (value-based). Persists to SQLite: `progress`, `chains`, `meta`.
- `worker_v5_legacy.py` — the earlier worker, kept only as the record of the
  two bugs above. Do not run it.
- `query.py` — on-demand CLI: `status | progress [N] | answers [N] |
  chains [N] [VERDICT] | answer N [k] | rate` (append a `.db` path).
- `test_conservation.py` — preflight: replicates the process logic, runs ~500
  live expansions, asserts the ledger stays ≈1.0. (Written for the v5 request
  shape — update its `fetch()` to `logprobs: <int>` before reusing on 0.29.)
- `sample100.py` / `sample1000.py` — cross-validation samplers (temp 1.0, same
  no-reasoning flag). `sample1000.json` is the settled n=1000 result.
- `cron_charts.py` / `cmp_v7.py` / `decay_plot.py` — the three report charts
  (live progress, walk-vs-sample ±diff, mass decay over time), rendered in a
  prebuilt `markov-plots:v7` image (matplotlib baked in; host has none).
- `Dockerfile` — v5 image (kept). `Dockerfile.v7` — v7 worker image.
  `Dockerfile.plot` — matplotlib render image.
- `project.json` — metadata.

## Run (v7)

```sh
# host has vLLM v0.29.x on 127.0.0.1:8000, model served as Qwen3.8-27B-FP8
podman build -f Dockerfile.v7 -t markov-worker:v7 .
podman volume create markov-worker-data
podman run -d --name markov-worker-v7 --network host \
  -v markov-worker-data:/data \
  -e DB_PATH=/data/markov_<task>.db \
  -e WORKERS=8 -e FETCH_K=500 -e TOP_K=100 \
  -e TAIL_TARGET=0.01 -e MAX_EXPANSIONS=300000 -e LOG_EVERY=200 \
  markov-worker:v7

podman logs -f markov-worker-v7          # self-check line + balance rows
podman exec markov-worker-v7 python3 /app/query.py status /data/markov_<task>.db
```

Tunables (env): `PROMPT`, `MODEL`, `MAX_DEPTH=100`, `LOOKAHEAD=15`,
`TOP_K=100` (children kept/node), `FETCH_K=500` (logprobs count — 0.29 int
form; 300 is the coverage floor, full vocab = 200000), `WORKERS` (in-flight),
`TAIL_TARGET` (stop when unexplored < this), `MAX_EXPANSIONS` (safety cap),
`LOG_EVERY`.

**Fresh DB filename per task** — schema is append-per-run; mixing runs
double-counts mass. **Re-verify the schema + a 5× identical-call determinism
probe after any vLLM image bump** (0.29 changed `logprobs` to an int and the
chat endpoint shuffles top_logprobs order between identical calls).

## Verdicts (strict criteria)

- `answer` — exactly one number in 10..30 in the branch text
- `MULTIPLE_NUMBERS` — two or more numbers (incl. re-quoted prompt range)
- `OUT_OF_RANGE` — exactly one number out of range; or none at the stop token
- `LENGTH_EXCEEDED_NO_NUMBERS` — no number at the 100-token depth cap
- ledger extras: `pruned` (top-K truncation + sub-floor drops),
  `frontier` (unexpanded, in progress)

## Critical pitfalls (all hit in this task, all in the skill)

1. **Two-level preflight, value-based, never list-order.** (a) greedy step-1
   token at the top of the prefix feed (catches closed-turn restart); (b) the
   top-token *set* + per-token mass of root + 2–3 shallow prefixes agree
   within 0.02 with the server's own chat/completions route. A wrong-but-
   plausible template keeps the argmax and still skews every mass you book
   (here: p('I') 0.356 vs the correct 0.655). An order check fails randomly on
   0.29 and killed one launch.
2. **Token-ID prompt, not a hand-rolled string.** Capture the template once as
   plain ints; build requests as `BASE_IDS + /tokenize(prefix)`. 0.29
   `/tokenize` maps special tokens only at the *start* of a string — never
   tokenize the template, only plain generated prefixes.
3. **vLLM 0.29 `logprobs` is an int.** Old `logprobs: true, top_logprobs: N`
   is silently ignored (1–2 random tokens, non-deterministic, conservation
   still balances). `-1` is dead (0 entries); full vocab = `logprobs: 200000`
   (199,307 entries, ~6 MB, ~2 s). Walk at `logprobs: 500` (~99.3% worst-node
   coverage). The GPU computes the full softmax regardless of N — N saves only
   JSON transfer.
4. **Mass conserved AND verified.** Preflight before long runs; log
   `balance` (≈1e-8) in every progress row; book every discarded mass into
   exactly one bucket (a dropped lookahead truncation is the classic leak).
5. **Producer-consumer, not lockstep; and no nested lock.** Perpetual-N-
   in-flight (not pop-N/wait-N) for vLLM continuous batching. Keep
   `submit_next()` and `log_progress()` OUTSIDE `with lock:` — they re-acquire
   the non-reentrant Lock and self-deadlock the coordinator (0 CPU, no vLLM
   traffic, balance intact — looks exactly like a server hang).
6. **Digits: exact set `0123456789`.** `str.isdigit()` accepts `²`, `０`, etc.
   and crashed a 62-min run at exp 225k on `23²`.
7. Stop token on Qwen3.8-27B-FP8 is `<|im_end|>` (pipes, not `<im_end>`);
   build via `chr()` — terminal heredocs mangle escapes. `enable_thinking:
   false` (never `include_reasoning: false`). The full rendered base is:
   `<|im_start|>user\nPick a number between 10 and 30\n<|im_end|>\n<|im_start|>assistant\n<|think|>\n\n<|/think|>\n\n` (23 tokens).

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
