"""Markov worker v8 - v7 design + reasoning ENABLED (walk through
the think block). vLLM 0.29.0 stable API.

Design (no hand-crafted template, no special-token strings in the hot path):
  - Template = 63 hardcoded token IDs (captured once from the tokenizer's own
    apply_chat_template(enable_thinking=True); plain integers, nothing to mangle;
    template left open at the think block).
  - Prefix = /tokenize(prefix_text) appended to the 63 IDs (boundary property proven in v7: no BPE
    merge at the template/prefix boundary).
    to tokenizer.encode(template + prefix) for 16/16 real prefixes (newlines,
    unicode quotes, ** included - no BPE merge at the boundary).
  - Next-token distribution = /v1/completions(prompt=<ids>, max_tokens=1,
    logprobs=FETCH_K) - v0.29.0 schema: logprobs is a single int, top_logprobs
    field is gone. top_logprobs[0] is {token_text: logprob}.
  - THINK phase (new): digits in reasoning are ignored; the close-think
    token switches to the ANSWER phase (v7 absorption) -> LOOKAHEAD phase.
    im_end before the close -> OUT_OF_RANGE. ALL chains recorded (no mass floor).
  - Startup self-check: completions root (our 63 IDs) must match the server's
    own chat/completions root (enable_thinking=True). Drift fails in seconds.
  - Dial decade-bucket queue (amortized O(1)), first-number absorption,
    LOOKAHEAD window for a 2nd number, coverage stop:
    stop when frontier + inflight + pruned_tail < TAIL_TARGET.
  - Runs until stopped; MAX_EXPANSIONS only labels termination. Verdicts:
      answer (exactly one number in 10..30) | MULTIPLE_NUMBERS | OUT_OF_RANGE
      | LENGTH_EXCEEDED_NO_NUMBERS.
"""
import json, math, os, sys, time, sqlite3, urllib.request, threading
from concurrent.futures import ThreadPoolExecutor, wait as cf_wait, FIRST_COMPLETED
from datetime import datetime, timezone

BASE = "http://127.0.0.1:8000"
URL = BASE + "/v1/chat/completions"
COMP_URL = BASE + "/v1/completions"
TOK_URL = BASE + "/tokenize"
MODEL = "Qwen3.8-27B-FP8"
PROMPT = "Pick a number between 10 and 30"

DB = os.environ.get("DB_PATH", "/data/markov_v8.db")
WORKERS = int(os.environ.get("WORKERS", "8"))
TOP_K = int(os.environ.get("TOP_K", "100"))
FETCH_K = int(os.environ.get("FETCH_K", "1000"))
MAX_DEPTH = int(os.environ.get("MAX_DEPTH", "400"))
LOOKAHEAD = int(os.environ.get("LOOKAHEAD", "15"))
BUCKET_FLOOR = float(os.environ.get("BUCKET_FLOOR", "-7"))
TAIL_TARGET = float(os.environ.get("TAIL_TARGET", "0.01"))
MAX_EXPANSIONS = int(os.environ.get("MAX_EXPANSIONS", "300000"))
LOG_EVERY = int(os.environ.get("LOG_EVERY", "200"))

# 63 token IDs of apply_chat_template([user: PROMPT], add_generation_prompt=True,
# enable_thinking=True) for Qwen3.8-27B-FP8 — template left OPEN at the think
# block. Captured once from the tokenizer; oracle-verified to reproduce the
# server's own thinking-on chat root exactly (worst mass diff 0.0000).
BASE_IDS = [248045, 8678, 198, 24342, 286, 4879, 369, 716, 310, 830, 11553, 13,
            5044, 1683, 15060, 1472, 279, 3274, 11, 9307, 1328, 30800, 11, 2814,
            47675, 25605, 11, 321, 60445, 55404, 11, 27224, 11, 321, 30246, 303,
            279, 1534, 4087, 13, 248046, 198, 248045, 846, 198, 35728, 264, 1324,
            1881, 220, 16, 15, 321, 220, 18, 15, 248046, 198, 248045, 74455, 198,
            248068, 198]
STOP_ID = 248046   # end-of-message special token (captured from the no-think template)
CLOSE_ID = 248069  # close-think special token (model emits it before the answer)
# Decoded texts of the two ids (captured via tokenizer.decode; both re-encode
# to exactly one id). Pipes built with chr() so nothing can be mangled.

d = datetime.now(timezone.utc).isoformat()
db = sqlite3.connect(DB)
db.execute("PRAGMA journal_mode=WAL")
db.execute("PRAGMA synchronous=NORMAL")
db.execute("""CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT)""")
db.execute("""CREATE TABLE IF NOT EXISTS progress(
    id INTEGER PRIMARY KEY, ts TEXT, expansions INTEGER, valid REAL,
    v_mult REAL, v_oor REAL, v_len REAL, pruned_tail REAL, frontier_mass REAL,
    buckets INTEGER, chains INTEGER, elapsed REAL, note TEXT)""")
db.execute("""CREATE TABLE IF NOT EXISTS chains(
    id INTEGER PRIMARY KEY, ts TEXT, logp REAL, mass REAL, depth INTEGER,
    stop_reason TEXT, verdict TEXT, answer INTEGER, text TEXT)""")
db.commit()

def set_meta(k, v):
    db.execute("INSERT INTO meta(key, value) VALUES(?, ?) "
               "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (k, str(v)))
    db.commit()

def http_json(url, body, timeout=180):
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())

def api_tokenize(t):
    return http_json(TOK_URL, {"model": MODEL, "prompt": t})["tokens"]

def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")

# Boot-time special-token resolution: ask the server for the logprob of one
# specific id via logprob_token_ids; the response = sampled token + requested
# id. The special token's logprob is ~e-20 vs ~e-1 for the sampled one, so
# min(logprob) deterministically picks the requested token's EXACT text.
# No hand-crafted special-token strings anywhere in the worker.
def _resolve_special(tid):
    r = http_json(COMP_URL, {"model": MODEL, "prompt": BASE_IDS,
                             "max_tokens": 1, "logprobs": 1,
                             "logprob_token_ids": [tid]}, timeout=120)
    tl = r["choices"][0]["logprobs"]["top_logprobs"][0]
    items = tl.items() if isinstance(tl, dict) else \
            [(e["token"], e["logprob"]) for e in tl]
    t, v = min(items, key=lambda x: x[1])
    if v > -10:
        raise RuntimeError("special-token resolve: id %d not found as "
                           "low-prob entry (best logprob %.3f)" % (tid, v))
    return t

set_meta("status", "checking")

def self_check():
    a = http_json(COMP_URL, {"model": MODEL, "prompt": BASE_IDS,
                             "max_tokens": 1, "logprobs": 30})
    ta = a["choices"][0]["logprobs"]["top_logprobs"][0]
    da = {t: math.exp(v) for t, v in
          (ta.items() if isinstance(ta, dict)
           else [(e["token"], e["logprob"]) for e in ta])}
    b = http_json(URL, {"model": MODEL,
                        "messages": [{"role": "user", "content": PROMPT}],
                        "max_tokens": 1, "logprobs": True, "top_logprobs": 30,
                        "chat_template_kwargs": {"enable_thinking": True}})
    tb = b["choices"][0]["logprobs"]["content"][0]["top_logprobs"]
    db_ = {e["token"]: math.exp(e["logprob"]) for e in tb}
    # ORDER-INVARIANT, value-based checks. The v0.29 chat endpoint shuffles the
    # top_logprobs order/subset between identical calls (verified), so never
    # compare lists element-wise. The *values* are stable (p(I)=0.6554 every
    # run) and the wrong template gives p(I)=0.356, so value checks catch drift.
    top_a = [t for t, _ in sorted(da.items(), key=lambda x: -x[1])[:5]]
    set_a = set(top_a)
    if not set_a.issubset(set(db_)):
        raise RuntimeError("self-check: completions top5 %s not all in chat top30 %s"
                           % (sorted(set_a), sorted(set(db_))))
    pW = da.get("We", 0.0)
    if not (0.6 < pW < 0.95):
        raise RuntimeError("self-check: p(We)=%.4f outside sane band (0.6,0.95) - "
                           "thinking-on template likely wrong" % pW)
    worst = max((abs(da[t] - db_[t]) for t in set_a if t in db_), default=0.0)
    if worst > 0.02:
        raise RuntimeError("self-check: top-token mass drift %.4f > 0.02" % worst)
    print("self-check OK: top5set=%s p(We)=%.4f worst_drift=%.4f mass=%.4f"
          % (sorted(set_a), pW, worst, sum(da.values())),
          file=sys.stderr, flush=True)

try:
    self_check()
except Exception as e:
    set_meta("status", "dead: " + str(e))
    print("self-check FAILED: " + str(e), file=sys.stderr, flush=True)
    sys.exit(1)

set_meta("status", "running")
set_meta("started_at", now())
set_meta("params", json.dumps({
    "prompt": PROMPT, "model": MODEL, "base_ids": BASE_IDS, "stop_id": STOP_ID,
    "top_k": TOP_K, "fetch_k": FETCH_K, "max_depth": MAX_DEPTH,
    "lookahead": LOOKAHEAD, "tail_target": TAIL_TARGET, "workers": WORKERS,
    "bucket_floor": BUCKET_FLOOR, "max_expansions": MAX_EXPANSIONS,
    "vllm": "0.29.0 stable", "thinking": True,
    "criteria": "exactly one number in 10..30 => answer; >=2 => MULTIPLE_NUMBERS; "
                "one number out of range at stop => OUT_OF_RANGE; "
                "0 numbers at depth cap => LENGTH_EXCEEDED_NO_NUMBERS",
    "algorithm": "Dial bucket queue, first-number absorption, coverage stop",
    "api": "prompt=<ids>, max_tokens=1, logprobs=<int> (v0.29 schema)"}))

lock = threading.Lock()
buckets = {}
hi = [0]
frontier = [0.0]
pruned_tail = [0.0]
ctr = [0]
expansions = [0]
chains_n = [0]
answers = {}
v_mult = [0.0]
v_oor = [0.0]
v_len = [0.0]
inflight_mass = [0.0]

def push_item(mass, item):
    global hi
    if mass < 10.0 ** BUCKET_FLOOR:
        pruned_tail[0] += mass
        return
    b = min(0, math.floor(math.log10(mass)))
    ctr[0] += 1
    buckets.setdefault(b, []).append((mass, item, ctr[0]))
    frontier[0] += mass
    if b > hi[0]:
        hi[0] = b

def pop_item():
    while True:
        lst = buckets.get(hi[0])
        if lst:
            mass, item, _ = lst.pop()
            if not lst:
                del buckets[hi[0]]
            frontier[0] -= mass
            return mass, item
        hi[0] -= 1
        if hi[0] < BUCKET_FLOOR:
            return None

def acc(verdict, n, mass, text, depth, reason, record=True):
    global chains_n
    if verdict == "answer":
        answers[n] = answers.get(n, 0.0) + mass
    elif verdict == "MULTIPLE_NUMBERS":
        v_mult[0] += mass
    elif verdict == "OUT_OF_RANGE":
        v_oor[0] += mass
    elif verdict == "LENGTH_EXCEEDED_NO_NUMBERS":
        v_len[0] += mass
    if record:  # v8: record ALL chains (no mass floor)
        chains_n[0] += 1
        db.execute("INSERT INTO chains(ts, logp, mass, depth, stop_reason, verdict, "
                   "answer, text) VALUES(?,?,?,?,?,?,?,?)",
                   (now(), math.log(max(mass, 1e-300)), mass, depth, reason,
                    verdict, n, text[:500]))

_ASCII_DIGITS = set("0123456789")

def advance(open_digits, t):
    buf = open_digits
    events = []
    for ch in t:
        if ch in _ASCII_DIGITS:
            buf += ch
        elif buf:
            events.append(int(buf))
            buf = ""
    return events, buf

def fetch(prefix):
    prompt = BASE_IDS + (api_tokenize(prefix) if prefix else [])
    body = {"model": MODEL, "prompt": prompt, "max_tokens": 1,
            "logprobs": FETCH_K, "temperature": 0.0}
    req = urllib.request.Request(COMP_URL, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    for a in range(6):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                d = json.loads(r.read())
            if "error" in d:
                raise RuntimeError(d["error"])
            tl = d["choices"][0]["logprobs"]["top_logprobs"][0]
            items = tl.items() if isinstance(tl, dict) else \
                    [(e["token"], e["logprob"]) for e in tl]
            out = [(t, math.exp(v)) for t, v in items]
            out.sort(key=lambda x: -x[1])
            return out
        except Exception:
            if a == 5:
                raise
            time.sleep(2 * (a + 1))

# Stop / close-think tokens: exact texts resolved from the server (see
# _resolve_special). Drift guard: the substrings are stable model properties.
STOP_TOKEN = _resolve_special(STOP_ID)
CLOSE_TOKEN = _resolve_special(CLOSE_ID)
if "im_end" not in STOP_TOKEN or "think" not in CLOSE_TOKEN         or STOP_TOKEN == CLOSE_TOKEN:
    set_meta("status", "dead: special-token resolution gave unexpected "
                       "texts (stop=%r close=%r)" % (STOP_TOKEN, CLOSE_TOKEN))
    sys.exit(1)
print("stop token: %r  close token: %r (resolved via logprob_token_ids)"
      % (STOP_TOKEN, CLOSE_TOKEN), file=sys.stderr, flush=True)

def process(m, item, dist):
    global expansions
    text, phase, answer, depth, la, open_digits = item
    expansions[0] += 1
    p_stop = 0.0
    p_close = 0.0
    kids = []
    p_close = 0.0
    for t, p in dist:
        if t == STOP_TOKEN:
            p_stop = p
        else:
            kids.append((t, p))
            if t == CLOSE_TOKEN:
                p_close = p  # informational; close stays in kids so its
                             # mass transitions THINK -> ANSWER below
    kids = kids[:TOP_K]
    if phase == 0:
        # THINK phase: walk reasoning; digits in it are ignored (the answer
        # is what comes after the close-think token, which switches to phase 1).
        if depth >= MAX_DEPTH:
            acc("LENGTH_EXCEEDED_NO_NUMBERS", None, m, text, depth, "depth_cap")
            return []
        # stopping before the close-think token: no answer part
        acc("OUT_OF_RANGE", None, m * p_stop, text, depth, "stop_in_think")
        p_topk = sum(p for _, p in kids)
        new_items = []
        for tok, p in kids:
            if tok == CLOSE_TOKEN:
                new_items.append((m * p, (text + tok, 1, None, depth + 1, LOOKAHEAD, "")))
            else:
                new_items.append((m * p, (text + tok, 0, None, depth + 1, la, "")))
        pruned_tail[0] += m * max(0.0, 1.0 - p_stop - p_topk)
        return new_items
    if phase == 1:
        # ANSWER phase (== v7 phase 0)
        if depth >= MAX_DEPTH:
            nums = [int(open_digits)] if open_digits else []
            if len(nums) >= 2:
                acc("MULTIPLE_NUMBERS", None, m, text, depth, "depth_cap")
            elif nums:
                acc(("answer" if 10 <= nums[0] <= 30 else "OUT_OF_RANGE"),
                    nums[0] if 10 <= nums[0] <= 30 else None, m, text, depth, "depth_cap")
            else:
                acc("LENGTH_EXCEEDED_NO_NUMBERS", None, m, text, depth, "depth_cap")
            return []
        flush = [int(open_digits)] if open_digits else []
        if len(flush) >= 2:
            acc("MULTIPLE_NUMBERS", None, m * p_stop, text, depth, "stop")
        elif flush:
            acc(("answer" if 10 <= flush[0] <= 30 else "OUT_OF_RANGE"),
                flush[0] if 10 <= flush[0] <= 30 else None, m * p_stop, text, depth, "stop")
        else:
            acc("OUT_OF_RANGE", None, m * p_stop, text, depth, "stop")
        p_topk = sum(p for _, p in kids)
        new_items = []
        for tok, p in kids:
            ev, buf = advance(open_digits, tok)
            if not ev:
                new_items.append((m * p, (text + tok, 1, None, depth + 1, LOOKAHEAD, buf)))
            elif len(ev) >= 2:
                acc("MULTIPLE_NUMBERS", None, m * p, text + tok, depth + 1, "child")
            elif 10 <= ev[0] <= 30:
                new_items.append((m * p, (text + tok, 2, ev[0], depth + 1, LOOKAHEAD, buf)))
            else:
                acc("OUT_OF_RANGE", None, m * p, text + tok, depth + 1, "child")
        pruned_tail[0] += m * max(0.0, 1.0 - p_stop - p_topk)
        return new_items
    # phase 2: LOOKAHEAD for a 2nd number (== v7 phase 1)
    if la <= 0 or depth >= MAX_DEPTH:
        flush = [int(open_digits)] if open_digits else []
        if flush:
            acc("MULTIPLE_NUMBERS", None, m, text, depth, "lookahead_end")
        else:
            acc("answer", answer, m, text, depth, "lookahead_end")
        return []
    flush = [int(open_digits)] if open_digits else []
    if flush:
        acc("MULTIPLE_NUMBERS", None, m * p_stop, text, depth, "stop")
    else:
        acc("answer", answer, m * p_stop, text, depth, "stop")
    p_topk = sum(p for _, p in kids)
    new_items = []
    for tok, p in kids:
        ev, buf = advance(open_digits, tok)
        if ev:
            acc("MULTIPLE_NUMBERS", None, m * p, text + tok, depth + 1, "child")
        else:
            new_items.append((m * p, (text + tok, 2, answer, depth + 1, la - 1, buf)))
    acc("answer", answer, m * max(0.0, 1.0 - p_stop - p_topk),
        text, depth, "trunc", record=False)
    return new_items

t0 = time.time()
last_log = t0

def log_progress(note):
    global last_log
    with lock:
        top = math.exp(hi[0]) if buckets else 0.0
        row = (now(), expansions[0], sum(answers.values()), v_mult[0], v_oor[0],
               v_len[0], pruned_tail[0], frontier[0] + inflight_mass[0],
               len(buckets), chains_n[0], time.time() - t0, note)
        db.execute("INSERT INTO progress(ts, expansions, valid, v_mult, v_oor, v_len, "
                   "pruned_tail, frontier_mass, buckets, chains, elapsed, note) "
                   "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", row)
        db.commit()
    top5 = sorted(answers.items(), key=lambda x: -x[1])[:5]
    balance = 1.0 - (row[2] + row[3] + row[4] + row[5] + row[6] + row[7])
    print("[%s] exp=%d valid=%.5f mult=%.5f oor=%.5f len=%.5f pruned=%.5f "
          "frontier=%.5f balance=%+.2e buckets=%d chains=%d top=%s t=%.0fs :: %s"
          % (now(), row[1], row[2], row[3], row[4], row[5], row[6], row[7],
             balance, row[8], row[9], top5, row[10], note), flush=True)
    last_log = time.time()

push_item(1.0, ("", 0, None, 0, LOOKAHEAD, ""))
log_progress("start")
inflight = {}
with ThreadPoolExecutor(WORKERS) as ex:
    def submit_next():
        with lock:
            got = pop_item()
        if got is None:
            return False
        inflight[ex.submit(fetch, got[1][0])] = got
        inflight_mass[0] += got[0]
        return True
    for _ in range(WORKERS):
        if not submit_next():
            break
    while inflight:
        done, _ = cf_wait(list(inflight), timeout=60, return_when=FIRST_COMPLETED)
        for fut in done:
            got = inflight.pop(fut)
            m, item = got
            inflight_mass[0] -= m
            try:
                dist = fut.result()
            except Exception as e:
                with lock:
                    pruned_tail[0] += m
                print("[%s] fetch failed len=%d: %s; mass -> pruned_tail"
                      % (now(), len(item[0]), e), flush=True)
                continue
            with lock:
                new_items = process(m, item, dist)
                for mi in new_items:
                    push_item(mi[0], mi[1])
                unexplored = frontier[0] + inflight_mass[0] + pruned_tail[0]
                stop_submit = (unexplored < TAIL_TARGET
                               or expansions[0] >= MAX_EXPANSIONS)
                do_log = expansions[0] % LOG_EVERY < WORKERS
            # REFILL OUTSIDE THE LOCK: submit_next()/log_progress() re-acquire
            # it (non-reentrant Lock -> self-deadlock, the v7 stall bug).
            if do_log:
                log_progress("batch")
            while len(inflight) < WORKERS and not stop_submit:
                if not submit_next():
                    break

unexplored = frontier[0] + pruned_tail[0]
reason = ("coverage" if unexplored < TAIL_TARGET
          else "expansion_cap" if expansions[0] >= MAX_EXPANSIONS else "heap_empty")
log_progress("final:" + reason)
set_meta("status", "done:" + reason)
set_meta("finished_at", now())
print("final:", reason, "valid=", sum(answers.values()),
      "pruned=", pruned_tail[0], "frontier=", frontier[0], flush=True)
