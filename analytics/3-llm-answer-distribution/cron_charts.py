"""v7 walk progress -> two bar charts (answers 10-30; outcomes+progress).
Reads markov_v7.db, writes /home/nixos/markov_worker/v7_progress.png.
Prints a one-line status. Deterministic except for the elapsed label."""
import sqlite3, sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

import os
DB = sys.argv[1] if len(sys.argv) > 1 else "/datav/markov_v7.db"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/work/v7_progress.png"

d = sqlite3.connect(DB)
row = d.execute("SELECT expansions, valid, v_mult, v_oor, v_len, pruned_tail, "
                "frontier_mass, elapsed, ts FROM progress ORDER BY id DESC LIMIT 1").fetchone()
ans = {a: m for a, m in d.execute(
    "SELECT answer, SUM(mass) FROM chains WHERE verdict='answer' GROUP BY answer")}
exp, valid, vmult, voor, vlen, pruned, frontier, elapsed, ts = row
not_cov = pruned + frontier
status = d.execute("SELECT value FROM meta WHERE key='status'").fetchone()

nums = list(range(10, 31))
vals = [ans.get(n, 0.0) / valid * 100 if valid > 0 else 0.0 for n in nums]

fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 8), dpi=110)
fig.suptitle("Markov v7 - 'Pick a number between 10 and 30'  -  %s  -  exp=%d  t=%.0fs"
             % (ts, exp, elapsed), fontsize=13)

# --- chart 1: answer distribution (linear % of valid) ---
bars1 = ax1.bar([str(n) for n in nums], vals, color="#4a7ab5")
ax1.set_title("Answer distribution (% of valid, linear)")
ax1.set_ylabel("% of valid")
mx = max(vals) or 1.0
for i, v in enumerate(vals):
    if v >= 0.1:
        ax1.text(i, v + mx * 0.01, "%.1f%%" % v, ha="center", fontsize=7)
ax1.set_ylim(0, mx * 1.15)
ax1.tick_params(axis="x", labelsize=8)

# --- chart 2: outcomes + progress (linear % of all mass) ---
labels = ["valid\nanswers", "multiple\nnumbers", "out of\nrange", "length\nexceeded",
          "pruned\ntail", "frontier\n(unexpanded)"]
vals2 = [valid, vmult, voor, vlen, pruned, frontier]
bars2 = ax2.bar(labels, [v * 100 for v in vals2], color=["#4a7ab5"] * 6)
ax2.set_title("Outcome + progress distribution (% of all mass, linear)")
ax2.set_ylabel("% of all mass")
mx2 = max(v * 100 for v in vals2) or 1.0
for i, v in enumerate(vals2):
    ax2.text(i, v * 100 + mx2 * 0.01, "%.2f%%" % (v * 100), ha="center", fontsize=7)
ax2.set_ylim(0, mx2 * 1.18)
ax2.tick_params(axis="x", labelsize=8)

plt.tight_layout(rect=[0, 0, 1, 0.96])
plt.savefig(OUT)
print("saved %s" % OUT)
print("STATUS: status=%s | exp=%d | valid=%.1f%% | not_covered=%.1f%% (frontier %.2f%% + pruned %.2f%%) | "
      "top3=%s | balance_check: sum=%.4f"
      % (status[0] if status else "?", exp, valid * 100, not_cov * 100,
         frontier * 100, pruned * 100,
         ", ".join("%d=%.1f%%" % (n, ans.get(n, 0) / valid * 100) for n in
                   sorted(ans, key=lambda x: -ans.get(x, 0))[:3]),
         sum(vals2)))
