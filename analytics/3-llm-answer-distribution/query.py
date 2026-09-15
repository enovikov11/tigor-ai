"""Query tool for markov worker v4 DB.

  python3 query_v4.py status
  python3 query_v4.py progress [N]
  python3 query_v4.py answers [N]        # verdict breakdown + per-number
  python3 query_v4.py chains [N] [verdict]
  python3 query_v4.py answer N [k]
  python3 query_v4.py rate
Append a .db path to query a different database.
"""
import sqlite3, sys, json
from datetime import datetime, timezone

DB = "/data/markov_v4.db"
for a in sys.argv[1:]:
    if a.endswith(".db"):
        DB = a
        break
db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row
cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
n = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else 10

def now_local():
    return datetime.now(timezone.utc).strftime("%H:%M:%SZ")

def fmt_row(p):
    invalid = p["v_mult"] + p["v_oor"] + p["v_len"]
    return (f"{p['ts']}  exp={p['expansions']}  valid={p['valid']:.5f} "
            f"invalid={invalid:.5f} (mult={p['v_mult']:.5f} oor={p['v_oor']:.5f} "
            f"len={p['v_len']:.5f})  dropped_tail={p['pruned_tail']:.5f}  "
            f"todo_frontier={p['frontier_mass']:.5f}  buckets={p['buckets']}  "
            f"chains={p['chains']}  {p['elapsed']:.0f}s  {p['note']}")

if cmd == "status":
    meta = {r["key"]: r["value"] for r in db.execute("SELECT key, value FROM meta")}
    print("now: " + now_local())
    for k in ("status", "started_at", "finished_at"):
        if k in meta:
            print(k + ": " + meta[k])
    if "history_v3" in meta:
        print("history_v3: " + meta["history_v3"])
    if "params" in meta:
        p = json.loads(meta["params"])
        p.pop("criteria", None); p.pop("algorithm", None)
        print("params: " + json.dumps(p, separators=(", ", ": ")))
    last = db.execute("SELECT * FROM progress ORDER BY id DESC LIMIT 1").fetchone()
    print("last log: " + fmt_row(dict(last)) if last else "last log: (none)")
elif cmd == "progress":
    for r in db.execute("SELECT * FROM progress ORDER BY id DESC LIMIT ?", (n,)):
        print(fmt_row(dict(r)))
elif cmd == "answers":
    last = db.execute("SELECT * FROM progress ORDER BY id DESC LIMIT 1").fetchone()
    if not last:
        print("(no progress rows)"); sys.exit(0)
    p = dict(last)
    invalid = p["v_mult"] + p["v_oor"] + p["v_len"]
    print(f"as of {now_local()}")
    print(f"  results:  valid={p['valid']:.5f}")
    print(f"  invalid:  total={invalid:.5f}")
    print(f"    OUT_OF_RANGE           = {p['v_oor']:.5f}")
    print(f"    MULTIPLE_NUMBERS       = {p['v_mult']:.5f}")
    print(f"    LEN_EXCEEDED_NO_NUMBERS= {p['v_len']:.5f}")
    print(f"  dropped tail (pruning)   = {p['pruned_tail']:.5f}")
    print(f"  todo (frontier)          = {p['frontier_mass']:.5f}")
    rows = db.execute("SELECT answer, SUM(mass) m, COUNT(*) c FROM chains "
                      "WHERE verdict='answer' GROUP BY answer ORDER BY m DESC LIMIT ?",
                      (n,)).fetchall()
    print("top answers by captured mass:")
    for r in rows:
        share = r["m"] / p["valid"] * 100 if p["valid"] else 0
        print(f"  {r['answer']:>2}: mass={r['m']:.5f}  {share:6.2f}% of valid  chains={r['c']}")
elif cmd == "chains":
    verdict = None
    for a in sys.argv[1:]:
        if a != "chains" and a.replace("_","").isalpha() and not a.endswith(".db"):
            verdict = a
    q = "SELECT ts, mass, depth, stop_reason, verdict, answer, text FROM chains"
    args = []
    if verdict:
        q += " WHERE verdict=?"
        args.append(verdict)
    q += " ORDER BY mass DESC LIMIT ?"
    args.append(n)
    for r in db.execute(q, tuple(args)):
        t = r["text"].replace("\n", "\\n")[:90]
        print(f"{r['ts']}  mass={r['mass']:.5f}  d={r['depth']:>2} "
              f"{r['stop_reason']:<12} {r['verdict']:<26} n={str(r['answer']):>2}  {t}")
elif cmd == "answer":
    num = int(sys.argv[2])
    k = int(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3].isdigit() else 10
    tot = db.execute("SELECT COALESCE(SUM(mass),0) FROM chains WHERE answer=?", (num,)).fetchone()[0]
    print(f"answer={num}  total_captured_mass={tot:.5f}")
    for r in db.execute("SELECT ts, mass, depth, stop_reason, text FROM chains "
                        "WHERE answer=? ORDER BY mass DESC LIMIT ?", (num, k)):
        t = r["text"].replace("\n", "\\n")[:90]
        print(f"  {r['ts']}  mass={r['mass']:.5f}  d={r['depth']:>2}  {t}")
elif cmd == "rate":
    rows = [dict(r) for r in db.execute("SELECT ts, expansions, elapsed FROM progress "
                                        "WHERE note='batch' ORDER BY id")]
    if len(rows) >= 2:
        a, b = rows[0], rows[-1]
        dt = b["elapsed"] - a["elapsed"]
        de = b["expansions"] - a["expansions"]
        if dt > 0 and de > 0:
            print(f"throughput: {de/dt:.1f} expansions/s  "
                  f"(exp {a['expansions']}@{a['elapsed']:.0f}s -> "
                  f"{b['expansions']}@{b['elapsed']:.0f}s)")
    else:
        print("not enough progress rows yet")
else:
    print(__doc__)
