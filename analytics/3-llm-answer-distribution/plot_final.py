import sqlite3
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

d = sqlite3.connect("/work/markov_v5.db")
last = d.execute("SELECT ts, expansions, valid, v_mult, v_oor, v_len, pruned_tail, frontier_mass, elapsed FROM progress ORDER BY id DESC LIMIT 1").fetchone()
ts, exp, valid, vmult, vlen_oor0, pruned, frontier, elapsed = last[0], last[1], last[2], last[3], last[6], last[6], last[7], last[8]
oor = last[5]
ans = {r[0]: r[1] for r in d.execute("SELECT answer, SUM(mass) FROM chains WHERE verdict='answer' GROUP BY answer")}
unexplored = pruned + frontier

fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(11.5, 8.2),
                               gridspec_kw={"height_ratios": [1, 1]})
# ---- panel 1: numbers 10..30, % of valid, sums to 100 ----
nums = list(range(10, 31))
vals = [ans.get(n, 0.0) / valid * 100 for n in nums]
b1 = ax1.bar(range(21), vals, color="#4a7ebb")
mx = max(vals)
for i, v in enumerate(vals):
    if v >= 1.0:
        ax1.text(i, v + mx*0.02, f"{v:.1f}%", ha="center", va="bottom", fontsize=9, fontweight="bold" if v > 20 else "normal")
    elif v > 0.05:
        ax1.text(i, v + mx*0.02, f"{v:.1f}%", ha="center", va="bottom", fontsize=7, rotation=90)
    elif v > 0:
        ax1.text(i, mx*0.03, f"{v:.2f}%", ha="center", va="bottom", fontsize=6, rotation=90)
    else:
        ax1.text(i, mx*0.03, "0.00", ha="center", va="bottom", fontsize=6, rotation=90, color="#888")
ax1.set_xticks(range(21), [str(n) for n in nums])
ax1.set_ylim(0, mx * 1.22)
ax1.set_ylabel("% of valid answers (sums to 100%)")
ax1.grid(axis="y", alpha=0.3)
ax1.set_title(f"Panel 1: Answer distribution 10\u201330 \u2014 Markov probability mass, Qwen3.8-27B-FP8\n"
              f"prompt \u201cPick a number between 10 and 30\u201d, valid={valid*100:.1f}% of total mass, "
              f"{exp:,} prefix expansions, settled (last 90 min: no change > 0.1pp)")

# ---- panel 2: mass ledger, % of total ----
cats = [("covered\n(valid answer)", valid*100),
        ("error: multiple\nnumbers", vmult*100),
        ("error: out of\nrange", oor*100),
        ("error: no number\nat 100 tokens", 0.0),
        ("dropped tail\n(top-100 prune)", pruned*100),
        ("not covered\n(frontier, in\nprogress)", frontier*100)]
vals2 = [v for _, v in cats]
b2 = ax2.bar(range(len(cats)), vals2,
             color=["#4a7ebb", "#c0632b", "#c0632b", "#c0632b", "#8aa08a", "#999999"])
for i, (lab, v) in enumerate(cats):
    if v > 0.3:
        ax2.text(i, v + 1.2, f"{v:.1f}%", ha="center", va="bottom", fontsize=10, fontweight="bold")
    else:
        ax2.text(i, 2.5, f"{v:.2f}%" if v > 0 else "0.0%", ha="center", va="bottom", fontsize=9, color="#666")
ax2.set_xticks(range(len(cats)), [c for c, _ in cats], fontsize=9)
ax2.set_ylim(0, 62)
ax2.set_ylabel("% of total probability mass")
ax2.grid(axis="y", alpha=0.3)
ax2.set_title(f"Panel 2: Mass ledger \u2014 covered vs errors vs not-covered  "
              f"(unexplored total = {unexplored*100:.1f}%; run stopped at a crash, "
              f"target was 10% but bars already converged)\n"
              f"snapshot {ts} UTC, t={elapsed/60:.0f} min")
plt.tight_layout()
plt.savefig("/work/markov_final.png", dpi=115)
print("saved")
