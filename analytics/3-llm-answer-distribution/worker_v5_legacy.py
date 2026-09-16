"""Markov worker v4: bucket queue (Dial) + first-number absorption + coverage stop.

Termination: stop when (frontier_mass + pruned_tail) < TAIL_TARGET (default 10%).
  - frontier_mass = mass of unexpanded prefixes (running sum, O(1) updates)
  - pruned_tail   = per-node top-K truncation + sub-floor drops
No fixed heap count cap. Verdicts (strict):
  answer (exactly one number in 10..30) | MULTIPLE_NUMBERS | OUT_OF_RANGE
  | LENGTH_EXCEEDED_NO_NUMBERS.
Absorption: first closed number ends the walk; a LOOKAHEAD-token window then
checks for a 2nd number (reclassifies to MULTIPLE_NUMBERS). Lookahead truncation
is attributed to the answer (documented approximation).
"""
import json, math, os, sys, time, sqlite3, urllib.request, threading
from concurrent.futures import ThreadPoolExecutor, wait as cf_wait, FIRST_COMPLETED
from datetime import datetime, timezone

URL = os.environ.get("VLLM_URL", "http://127.0.0.1:8000/v1/chat/completions")
COMP_URL = os.environ.get("VLLM_COMPLETIONS_URL", "http://127.0.0.1:8000/v1/completions")
MODEL = os.environ.get("VLLM_MODEL", "Qwen3.8-27B-FP8")
PROMPT = os.environ.get("PROMPT", "Pick a number between 10 and 30")
STOP = chr(60) + chr(124) + "im_end" + chr(124) + chr(62)
BASE = (chr(60) + "im_start" + chr(62) + chr(10) + "user" + chr(10) + PROMPT
        + chr(10) + chr(10)
        + chr(60) + "im_end" + chr(62) + chr(10) + chr(10)
        + chr(60) + "im_start" + chr(62) + chr(10) + "assistant" + chr(10)
        + chr(60) + "think" + chr(62) + chr(10) + chr(10)
        + chr(60) + "/think" + chr(62) + chr(10) + chr(10))
MAX_DEPTH = int(os.environ.get("MAX_DEPTH", "100"))
LOOKAHEAD = int(os.environ.get("LOOKAHEAD", "15"))
TOP_K = int(os.environ.get("TOP_K", "100"))
FETCH_K = int(os.environ.get("FETCH_K", "300"))
WORKERS = int(os.environ.get("WORKERS", "16"))
TAIL_TARGET = float(os.environ.get("TAIL_TARGET", "0.10"))
BUCKET_FLOOR = int(os.environ.get("BUCKET_FLOOR", "-15"))
MAX_EXPANSIONS = int(os.environ.get("MAX_EXPANSIONS", "500000"))
LOG_EVERY = float(os.environ.get("LOG_EVERY", "60"))
DB = os.environ.get("DB_PATH", "/data/markov_v4.db")

os.makedirs(os.path.dirname(DB) or ".", exist_ok=True)
db = sqlite3.connect(DB)
db.executescript(
    "CREATE TABLE IF NOT EXISTS progress("
    " id INTEGER PRIMARY KEY, ts TEXT, expansions INTEGER,"
    " valid REAL, v_mult REAL, v_oor REAL, v_len REAL,"
    " pruned_tail REAL, frontier_mass REAL, buckets INTEGER,"
    " chains INTEGER, elapsed REAL, note TEXT);"
    "CREATE TABLE IF NOT EXISTS chains("
    " id INTEGER PRIMARY KEY, ts TEXT, logp REAL, mass REAL,"
    " depth INTEGER, stop_reason TEXT, verdict TEXT, answer INTEGER, text TEXT);"
    "CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);")
db.commit()

def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")

def set_meta(k, v):
    db.execute("INSERT INTO meta(key, value) VALUES(?, ?) "
               "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (k, str(v)))
    db.commit()

# history of superseded runs (migration: aggregate snapshots, not chain rows —
# v3 stop-branch masses are subsumed by v4 absorption masses; counting both
# would double-count). Raw v3 data stays in markov_v3.db.
def migrate_history():
    src = "/data/markov_v3.db"
    if not os.path.exists(src):
        return
    try:
        s = sqlite3.connect(src)
        row = s.execute("SELECT ts, expansions, valid, invalid, not_traversed, "
                        "v_mult, v_oor, v_len, chains, elapsed FROM progress "
                        "ORDER BY id DESC LIMIT 1").fetchone()
        if row:
            set_meta("history_v3", json.dumps({
                "note": "superseded by v4 (absorption+coverage); raw data in markov_v3.db",
                "last_ts": row[0], "expansions": row[1], "valid": row[2],
                "invalid": row[3], "not_traversed": row[4], "v_mult": row[5],
                "v_oor": row[6], "v_len": row[7], "chains": row[8],
                "elapsed_s": row[9]}))
    except Exception as e:
        set_meta("history_v3", "migration failed: " + str(e))

migrate_history()

def fetch(prefix):
    # RAW /v1/completions with the assistant turn LEFT OPEN.
    # (chat/completions + assistant message renders prefix as a CLOSED turn
    #  "I\u003c/im_end\u003e" -> model restarts instead of continuing; verified bug.)
    body = {"model": MODEL, "prompt": BASE + prefix,
            "max_tokens": 1, "logprobs": FETCH_K, "temperature": 0.0}
    req = urllib.request.Request(COMP_URL, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    for a in range(6):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                d = json.load(r)
            if "error" in d:
                raise RuntimeError(d["error"])
            tl = d["choices"][0]["logprobs"]["top_logprobs"][0]
            return [{"token": t, "logprob": lp} for t, lp in tl.items()]
        except Exception:
            if a == 5:
                raise
            time.sleep(2 * (a + 1))

try:
    fetch("")
except Exception as e:
    set_meta("status", "dead: " + str(e))
    print("vLLM unreachable: " + str(e), file=sys.stderr)
    sys.exit(1)

set_meta("status", "running")
set_meta("started_at", now())
set_meta("params", json.dumps({"prompt": PROMPT, "model": MODEL,
    "max_depth": MAX_DEPTH, "lookahead": LOOKAHEAD, "top_k": TOP_K,
    "fetch_k": FETCH_K, "workers": WORKERS, "tail_target": TAIL_TARGET,
    "bucket_floor": BUCKET_FLOOR, "max_expansions": MAX_EXPANSIONS,
    "criteria": "exactly one number in 10..30 => answer; >=2 numbers => MULTIPLE_NUMBERS; "
                "else at stop => OUT_OF_RANGE; 0 numbers at depth cap => LENGTH_EXCEEDED_NO_NUMBERS",
    "algorithm": "Dial bucket queue, first-number absorption, coverage stop "
                 "(frontier+pruned < TAIL_TARGET)"}))

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

def push_item(mass, item):
    """item = (mass, text, phase, answer, depth, la, open_digits)"""
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
    if record and mass > 1e-6:
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

def process(m, item, dist):
    global expansions
    text, phase, answer, depth, la, open_digits = item
    expansions[0] += 1
    pmap = {e["token"]: math.exp(e["logprob"]) for e in dist}
    p_stop = pmap.get(STOP, 0.0)
    kids = sorted(((t, p) for t, p in pmap.items() if t != STOP),
                  key=lambda x: -x[1])[:TOP_K]
    if phase == 0:
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
                new_items.append((m * p, (text + tok, 0, None, depth + 1, LOOKAHEAD, buf)))
            elif len(ev) >= 2:
                acc("MULTIPLE_NUMBERS", None, m * p, text + tok, depth + 1, "child")
            elif 10 <= ev[0] <= 30:
                new_items.append((m * p, (text + tok, 1, ev[0], depth + 1, LOOKAHEAD, buf)))
            else:
                acc("OUT_OF_RANGE", None, m * p, text + tok, depth + 1, "child")
        pruned_tail[0] += m * max(0.0, 1.0 - p_stop - p_topk)
        return new_items
    # phase 1: lookahead for a 2nd number
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
            new_items.append((m * p, (text + tok, 1, answer, depth + 1, la - 1, buf)))
    # continuations beyond top-K can't change the answer except a very late 2nd
    # number; attribute to the answer (documented approximation)
    acc("answer", answer, m * max(0.0, 1.0 - p_stop - p_topk),
        text, depth, "trunc", record=False)
    return new_items

def log_progress(note):
    with lock:
        top = math.exp(hi[0]) if buckets else 0.0
        row = (now(), expansions[0], sum(answers.values()), v_mult[0], v_oor[0],
               v_len[0], pruned_tail[0], frontier[0], len(buckets), chains_n[0],
               time.time() - t0, note)
        db.execute("INSERT INTO progress(ts, expansions, valid, v_mult, v_oor, v_len, "
                   "pruned_tail, frontier_mass, buckets, chains, elapsed, note) "
                   "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", row)
        db.commit()
    top5 = sorted(answers.items(), key=lambda x: -x[1])[:5]
    infl = inflight_mass[0] if 'inflight_mass' in globals() else 0.0
    balance = 1.0 - (row[2] + row[3] + row[4] + row[5] + row[6] + row[7] + infl)
    print(f"[{now()}] exp={row[1]} valid={row[2]:.5f} mult={row[3]:.5f} "
          f"oor={row[4]:.5f} len={row[5]:.5f} pruned={row[6]:.5f} "
          f"frontier={row[7]:.5f} inflight={inflight_mass[0] if 'inflight_mass' in globals() else 0:.5f} "
          f"balance={balance:+.2e} buckets={row[8]} chains={row[9]} "
          f"top={top5} t={row[10]:.0f}s :: {note}", flush=True)

t0 = time.time()
push_item(1.0, ("", 0, None, 0, LOOKAHEAD, ""))
log_progress("start")
last_log = t0
inflight = {}
inflight_mass = [0.0]
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
                print(f"[{now()}] fetch failed len={len(item[0])}: {e}; "
                      f"mass -> pruned_tail", flush=True)
                continue
            with lock:
                new_items = process(m, item, dist)
                for mi in new_items:
                    push_item(mi[0], mi[1])
        unexplored = frontier[0] + inflight_mass[0] + pruned_tail[0]
        if unexplored < TAIL_TARGET:
            break  # stop submitting; let the remainder drain
        while len(inflight) < WORKERS:
            if not submit_next():
                break
        if time.time() - last_log >= LOG_EVERY:
            log_progress("batch")
            last_log = time.time()

unexplored = frontier[0] + pruned_tail[0]
reason = ("coverage" if unexplored < TAIL_TARGET
          else "expansion_cap" if expansions[0] >= MAX_EXPANSIONS else "heap_empty")
log_progress("final:" + reason)
set_meta("status", "done:" + reason)
set_meta("finished_at", now())
print("final:", reason, "valid=", sum(answers.values()),
      "pruned=", pruned_tail[0], "frontier=", frontier[0], flush=True)
