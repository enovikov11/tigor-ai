import sqlite3, sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

DB = sys.argv[1] if len(sys.argv) > 1 else "/datav/markov_v7.db"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/work/markov_v7_decay.png"
d = sqlite3.connect(DB)
rows = d.execute("SELECT elapsed, valid, v_mult, v_oor, v_len, pruned_tail, frontier_mass, "
                 "expansions FROM progress ORDER BY id").fetchall()
t = [r[0] / 60 for r in rows]  # minutes
series = {
    "valid":          ([r[1] for r in rows], "#4a7ab5", "-"),
    "multiple":       ([r[2] for r in rows], "#e8a13a", "-"),
    "out_of_range":   ([r[3] for r in rows], "#d64545", "-"),
    "pruned_tail":    ([r[5] for r in rows], "#8a6fb5", "--"),
    "frontier":       ([r[6] for r in rows], "#2e9e4f", "-"),
}
final = rows[-1]

fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 8), dpi=110,
                               gridspec_kw={"height_ratios": [1.3, 1]})
fig.suptitle("Markov v7 - mass bookkeeping over time  (total = 1.0)  -  "
             "last: %.1f min, %d expansions" % (t[-1], rows[-1][7]), fontsize=13)

for name, (vals, c, ls) in series.items():
    ax1.plot(t, [v * 100 for v in vals], color=c, ls=ls, lw=1.6, label=name)
for name in ("valid", "frontier"):  # end-labels only where they don't collide
    vals, c, ls = series[name]
    ax1.text(t[-1], vals[-1] * 100, " %.2f%%" % (vals[-1] * 100),
             color=c, fontsize=8, va="center")
small = " ".join("%.2f%%" % (series[n][0][-1] * 100) for n in ("multiple", "out_of_range", "pruned_tail"))
ax1.text(0.01, 0.98, "final: multiple %.2f%% | oor %.2f%% | pruned %.2f%% | len_exc 0.00%%" % (
    series["multiple"][0][-1] * 100, series["out_of_range"][0][-1] * 100,
    series["pruned_tail"][0][-1] * 100),
         transform=ax1.transAxes, fontsize=7.5, va="top",
         bbox=dict(boxstyle="round", fc="white", ec="none", alpha=0.8))
ax1.set_title("Mass buckets over time (linear, % of total; length_exceeded is 0 and omitted)")
ax1.set_ylabel("% of total mass")
ax1.set_xlabel("minutes")
ax1.set_xlim(0, t[-1])
ax1.set_ylim(0, 102)
ax1.legend(fontsize=8, loc="center right")
ax1.grid(alpha=0.25)

# log-scale decay of the two unexplored buckets
for name in ("frontier", "pruned_tail"):
    vals, c, ls = series[name]
    tp, vp = ([a for a, b in zip(t, vals) if b > 1e-9],
              [b for a, b in zip(t, vals) if b > 1e-9])
    ax2.semilogy(tp, vp, color=c, ls=ls, lw=1.8,
                 label="%s (final %.3f%%)" % (name, vp[-1] * 100))
ax2.set_title("Decay of unexplored mass (log scale)")
ax2.set_ylabel("mass (log)")
ax2.set_xlabel("minutes")
ax2.set_xlim(0, t[-1])
ax2.grid(alpha=0.25, which="both")
ax2.legend(fontsize=8)

plt.tight_layout(rect=[0, 0, 1, 0.96])
plt.savefig(OUT)
print("saved", OUT)
print("final min values: frontier=%.5f pruned=%.5f valid=%.5f mult=%.5f oor=%.5f len=%.5f" % tuple(final[1:]))
