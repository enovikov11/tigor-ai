# Markov BFS over full-vocab logprobs — recipe

Goal: approximate P(answer) for a prompt like "Pick a number between 10 and 30" without sampling, by walking the model's own token distributions. Cross-validate with real sampling always.

## Request shape — raw /v1/completions, open assistant turn, token-ID prompt (CRITICAL)

vLLM ≥ 0.29 schema: `logprobs` is a single int count. The old `logprobs: true, top_logprobs: N` form is SILENTLY ignored (returns 1–2 random tokens, non-deterministic — corrupts the walk while conservation still balances), and the `-1` sentinel is dead (0 entries). Full vocab = `logprobs: 200000` → 199,307 entries, ~6 MB, ~2 s.

```python
# Template captured ONCE as plain ints — no special-token strings in the worker:
# BASE_IDS = tok.encode(tok.apply_chat_template(
#     [{"role": "user", "content": PROMPT}],
#     add_generation_prompt=True, tokenize=False, enable_thinking=False))
# Qwen3.8-27B-FP8 + the number prompt:
# [248045, 846, 198, 35728, 264, 1324, 1881, 220, 16, 15, 321, 220, 18, 15,
#  248046, 198, 248045, 74455, 198, 248068, 271, 248069, 271]
body = {
  "model": "Qwen3.8-27B-FP8",
  "prompt": BASE_IDS + tokenize(prefix)["tokens"],   # /tokenize: plain-text prefixes only
  "max_tokens": 1,
  "logprobs": 500,    # int count (0.29). -1 is dead; full vocab = 200000 (~6 MB, ~2 s)
  "temperature": 0.0,
}
# POST http://127.0.0.1:8000/v1/completions
# response.choices[0].logprobs.top_logprobs[0]  (dict: token -> logprob)
```

`BASE_IDS + tokenize(prefix)` is byte-identical to whole-string tokenization (verified 16/16 real prefixes incl. newlines, unicode quotes, `**` — no BPE merge at the boundary). 0.29's `/tokenize` maps special tokens only at the start of a string, so it tokenizes plain generated prefixes, never the template. Preflight per server, **value-based, never list-order** (the 0.29 chat endpoint shuffles top_logprobs order between identical calls): root p('I') ≈ 0.655 (a wrong template gave 0.356) and top-token mass within 0.02 of the server's own chat/completions route for the root + 2-3 shallow prefixes. NEVER `/v1/chat/completions` for the walk itself: a closed assistant turn (`...I<im_end>`) makes the model restart instead of continue (digit-spam) while mass conservation still balances to 1.0 — the bug is caught only by the sample cross-validation.

Each call returns the top-N distribution over the next token given the prefix. With `logprobs: 500`: ~160 KB, ~2 s (GPU compute-bound — payload size barely matters), ~30–50 expansions/s at 8–16 concurrent in flight — the heap walk only needs the top-K children plus the stop token, and the residual mass `1 − p_stop − Σ p_kids` is booked as pruned. Full vocab is `logprobs: 200000` (199,307 non-zero entries, ~6 MB, ~2 s); use it only for arbitrary-token lookups. Choosing k: measure per-node coverage on real nodes — number branches are steep (top-30 ≈ 99.99%) and flat prose nodes carry the tail (top-300 ≈ 99.0%, top-500 ≈ 99.3%); 500 is the sweet spot, 300 the floor, 1000 diminishing. Concurrency: see the absorption loop below (perpetually-N-in-flight, not batched barriers).

Stop token: resolve the exact text at boot via `logprob_token_ids: [248046]` on /v1/completions (min-logprob entry = the special token; the response REPLACES the top-K list with sampled token + requested id). On Qwen3.8-27B-FP8 the decoded text is the pipe-form special token — if a local expectation is needed at all, build it via `chr(60)+chr(124)+"im_end"+chr(124)+chr(62)` (transit mangles pipes) and compare to the server-returned text, failing fast on mismatch. Never hardcode it and never scan a head distribution for it (top-K membership is not guaranteed for rare tokens).

## Absorption algorithm (fast path — walk only until the first number)

Full-walking every branch to the stop token is the slow path (see "Running long"). The fast path absorbs at the first closed number and self-limits the frontier:

```
# Frontier: Dial bucket queue (amortized O(1)), NOT heapq (log n per op — the
# user asked, and the queue buys it; within-decade order is LIFO, which is
# fine for mass accounting, cross-decade order is exact)
items: (mass, (text, phase, answer, depth, lookahead_left, open_digits))
buckets: dict decade -> list; hi = max decade pointer (monotone, only decreases)
push(mass, item): decade = min(0, floor(log10 mass)); mass < 10**FLOOR -> pruned_mass
pop(): from buckets[hi] (LIFO); empty -> hi -= 1

# Per-item state machine (phase 0 = no number yet, phase 1 = answer locked,
# counting a bounded lookahead for a SECOND number)
advance(open_digits, token) -> (closed_events, new_open_digits):
    buffer the run; a non-digit char closes the buffer as one int event

process(mass, item, dist):
    p_stop = exp(logprob of STOP); kids = top-K of dist (token != STOP)
    p_topk = sum(exp for kids)          # NOT sum of booked kids only — see conservation
    phase 0:
        stop branch: close open run -> in range: ANSWER / out of range: OUT_OF_RANGE / none: OUT_OF_RANGE (book mass*p_stop)
        each kid: closed_events empty -> push (mass*p, child, phase 0)
                  >=2 events -> MULTIPLE_NUMBERS; 1 event in range -> push (mass*p, child, phase 1, answer=event)
                             ; 1 event out of range -> OUT_OF_RANGE (all booked, mass*p)
        depth >= MAX_DEPTH -> close run: none -> LENGTH_EXCEEDED_NO_NUMBERS else as stop
    phase 1 (lookahead_left tokens to hunt a 2nd number):
        any closed event -> MULTIPLE_NUMBERS; lookahead exhausted / depth cap -> ANSWER (book mass)
        stop branch books mass*p_stop as ANSWER (or MULTIPLE if run closed)
        truncation (1 - p_stop - p_topk) -> book to ANSWER (documented approximation: a very late 2nd number in the pruned tail)
    pruned_mass += mass * (1 - p_stop - p_topk)   # phase 0 only; phase 1 truncation already booked
```

Stop by coverage: `frontier_mass + pruned_mass < TAIL_TARGET` (default 0.10). `frontier_mass` is a running scalar (add on push, subtract on pop); in-flight request mass is subtracted from the ledger on submit and re-added on completion, and the balance check includes it. No heap count cap.

Preflight BEFORE a long run (catches every bookkeeping bug this class has ever had): replicate process/advance/bucket in a standalone script, run ~300 live expansions serially, assert `Σ verdicts + pruned + frontier ≈ 1.0` at each checkpoint (drift < 1e-9). The canonical bugs: (a) truncation mass dropped instead of booked, (b) pruned = 1 − p_stop − Σ booked kids (double-counts absorbed kids — must be Σ ALL top-K), (c) per-chain rows storing prefix mass instead of booked branch mass (chains sum > 1.0 = bookkeeping, not model), (d) stopping on frontier+pruned while ignoring in-flight mass (stops early, mass unaccounted).

Report: valid answers / invalid (OUT_OF_RANGE, MULTIPLE_NUMBERS, LENGTH_EXCEEDED_NO_NUMBERS) / dropped tail (pruned) / todo (frontier) — must sum to 1 with in-flight. They don't → the bookkeeping is broken, not the model.

## Classification

Strict criteria (user spec) — a valid answer is exactly one number, in range:

```python
def classify(text):
    nums = [int(m) for m in re.findall(r"\d+", text)]
    if len(nums) >= 2:            return "MULTIPLE_NUMBERS", None
    if len(nums) == 1:
        if 10 <= nums[0] <= 30:   return "answer", nums[0]
        return "OUT_OF_RANGE", None
    return "NO_NUMBERS", None     # at stop -> OUT_OF_RANGE; at depth cap -> LENGTH_EXCEEDED_NO_NUMBERS
```

Do NOT extract "the first in-range number" and call the chain valid — multiple numbers or an out-of-range number invalidate it. Use `re.findall(r"\d+")` for the count: a `\d{1,3}` + lookaround regex silently misses 4+ digit runs ("2017 is cool" → counted as no number instead of out-of-range). Fullwidth/superscript digits won't match `\d` under re.ASCII — match digits only against the ASCII token ids.

## Reasoning-enabled walk (thinking on)

When the target distribution includes the model's reasoning ("markov with reasoning enabled"), same design, three changes:

1. **Template**: re-capture BASE_IDS with `enable_thinking=True` (Qwen3.8-27B-FP8 + number prompt: 63 IDs vs 23; the template is left OPEN at the think block, so the walk starts inside the reasoning). Re-capture per model/prompt — the no-think template is a different distribution, never reuse it. Boot self-check stays value-based against the server's own thinking-on chat root (dominant token 'We' ≈ 0.87 here).
2. **THINK phase before the absorption**: digits in the reasoning NEVER count as the answer (the model re-cites the "10 and 30" range and candidate numbers in its own reasoning). State machine: phase 0 THINK — on a close-think-token child, transition into the v7 answer phase (LOOKAHEAD, fresh open_digits — digits inside the close token itself can close a run); stop (im_end) before the close → OUT_OF_RANGE; depth cap in THINK → LENGTH_EXCEEDED_NO_NUMBERS. Keep the close-think token INSIDE kids — the transition consumes it; separating it out without booking its mass leaks mass (conservation catches it, but late). The answer phase itself is v7 unchanged. The model's answer typically lands within a few tokens after the close token (it emits a newline or repeats the choice).
3. **Depth/fetch**: think blocks run ~100–400 tokens → MAX_DEPTH 400 (100 truncates real reasoning); close/stop can sit at rank ~100–300 in mid-think nodes → FETCH_K 1000 (500 sufficed no-think).

Boot resolution of the special tokens (deterministic, no top-K luck, no hardcoded special strings):

```python
def resolve_special(tid):
    r = post("/v1/completions", {"model": MODEL, "prompt": BASE_IDS, "max_tokens": 1,
                                 "logprobs": 1, "logprob_token_ids": [tid]})
    items = r["choices"][0]["logprobs"]["top_logprobs"][0]
    items = items.items() if isinstance(items, dict) else \
            [(e["token"], e["logprob"]) for e in items]
    return min(items, key=lambda x: x[1])[0]  # special token = the low-prob entry
```

`logprob_token_ids` REPLACES the top-K list (response = sampled token + the requested id, NOT a union). The sampled token's logp is ~−1, the special token's ~−20, so min-logprob picks it deterministically — one call per id. Sanity-check substrings ('im_end' in stop, 'think' in close) and that the two texts differ; on mismatch fail fast with the received texts in meta status (this check caught a hardcoded constant missing the pipes on first launch — the worker exited before spending one expansion).

Cross-validation with thinking on: sample with `enable_thinking=True`, max_tokens ≥ 300, extract the answer from the CONTENT field ONLY (reasoning text is not the answer); with thinking off, concatenate reasoning+content as before.

Wall-clock: the frontier starts ~100% and stays high far longer than no-think (the reasoning tree branches much wider — hundreds of prose tokens before the answer), and valid mass only appears once the close token carries real mass into the answer phase. Never report per-answer mass until that happens — early "top answers" are the shallowest thinking fragment, not the distribution. The coverage target (e.g. 99%) is the right stop rule; expect a longer wall-clock than the no-think run and record ALL chains (no mass floor) when the user asks for the chain capture.

## Cross-validation (mandatory)

N real samples, same prompt, same no-reasoning setting, temperature 1.0, `max_tokens: 128`. Extract the answer by the same regex over the CONCATENATION of the `reasoning` and `content` message fields (the server's reasoning parser can put early tokens in `reasoning` even with thinking off — the number can live there). Compare: spike location, top-2 mass, invalid rate.

Noise band: sampling error ≈ 2·√(p(1−p)/n) — ±6pp at n=100, ±2pp at n=1000. If the walk-vs-sample top-1 gap exceeds the band, it is a prompt-shape/template bug, NOT noise: escalate to 10× n to confirm, then re-derive the walk's BASE. A ~30pp gap at n=1000 is a bug, full stop. Returned logprobs are identical at any requested temperature (bit-equal at temp 0 vs 1, verified), so walk-at-0 / sample-at-1 needs no normalization.

Known-good shape (this model, correct template): one value spikes (17 ≈ 55-60%), 2-3 neighbors get the rest (23 ≈ 17%, 21 ≈ 10%); a wrong template inflates bare-digit starts and swaps/deflates the prose-wrapped spike.

## Running long

Absorption + coverage stop: ~5–15 min to a 10% unexplored tail at ~45–55 exp/s (top-100, 16 in flight). A full-walk run (no absorption) converges ~30× slower — 57k expansions ≈ 22 min captured ~0.12% of mass as valid; 200k ≈ 1.2 h — and early completed chains are biased to the shallowest prefixes (bare "11", "12"); the real distribution sits in the frontier. Report the frontier share, not early per-answer shares, until mass is mostly traced.

For multi-hour runs, package as a podman worker (verified pattern):
- Image: python:3.12-slim, worker + query scripts copied in, `VOLUME /data`, `--network host` (vLLM on 127.0.0.1). Keep the worker under its canonical name (worker.py) matching the Dockerfile ENTRYPOINT — renaming between build iterations is how you ship an image whose entrypoint points at a missing file; versioning goes in the DB filename and a .bak copy on the VM, not in the copied filename. Mounting a dir into a plotting container: don't name any script there inspect.py — it shadows stdlib `inspect` and breaks matplotlib import.
- SQLite at /data on a named volume (survives restarts). Tables: `meta` (status/started_at/params), `progress` (ts, expansions, valid/invalid/not_traversed split, heap_size, elapsed, note), `chains` (ts, logp, mass, depth, stop_reason, verdict, answer, text).
- Fail fast if vLLM is unreachable at start (one probe request, exit 1 with meta status "dead").
- Log a progress row + one timestamped stdout line every 200 expansions or 60 s. Heap cap (e.g. 100k): dropped mass goes to not_traversed, and `heapq.heapify` the list after reassigning the pruned result.
- Fresh DB filename per task (e.g. markov_strict.db; rename old runs, don't reuse) — never resume a stale run's DB.
- Query CLI in the same image: `podman exec <c> python3 /app/query.py status|answers|progress|rate|chains|answer N`.
- `podman stop` may fall back to SIGKILL after 10 s; `podman rm` before reusing the container name.
- Main-loop structure: keep `submit_next()` (refill) and `log_progress()` OUTSIDE the `with lock:` block — they re-acquire the non-reentrant Lock; nesting them deadlocks the coordinator after the first batch (0 CPU, no vLLM traffic, balance intact — looks exactly like a server hang).
- Periodic user progress (15-min cadence): prebuilt plot image with matplotlib baked in + a render script that reads the DB and prints a STATUS line, driven by a cron job delivering MEDIA:<png> + the status line to the originating thread (terminal-only toolset).

Live snapshot for the user (on demand): pull the last progress row + per-answer sums, then render the user's two-panel spec — top panel: linear % of RESULTS ONLY, bars for 10..30 ascending, values as % of the valid total; bottom panel: LINEAR (user spec — never log scale), bars of every category as % of total mass (1.0) — valid total, each invalid verdict (OUT_OF_RANGE, MULTIPLE_NUMBERS, LEN_EXCEEDED), invalid total, dropped tail (pruned), todo (frontier). One uniform color per panel, % value labels (small ones rotated), title carries exp count + wall time + timestamp. The dropped-tail/todo bars are usually the biggest; that is the honest picture, don't normalize it away. Absolute numbers on request: express per 1,000,000 (x,xxx,xxx format).

Lightweight alternative: `nohup python3 markov_full.py > markov_full.log 2>&1 &` via terminal background + notify.
- Block-buffered stdout: log stays empty until exit. Not a hang. `python3 -u` or explicit flush for live logs.
- Liveness every ~2 min: `podman logs vllm 2>&1 | grep -c "Received request"` twice 20 s apart; delta > 0 = alive. Also `nvidia-smi` util.
- Status updates to the user: done?, blocker, ETA, key numbers — a few lines, no process replay.
