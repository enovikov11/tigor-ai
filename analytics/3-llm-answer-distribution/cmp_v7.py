import sqlite3, json, math, sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

DB = sys.argv[1] if len(sys.argv) > 1 else "/datav/markov_v7.db"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/work/markov_v7_cmp.png"
SAMPLE = "/work/sample1000.json"

d = sqlite3.connect(DB)
tot = d.execute("SELECT SUM(mass) FROM chains WHERE verdict='answer'").fetchone()[0]
markov = {n: m / tot * 100 for n, m in d.execute(
    "SELECT answer, SUM(mass) FROM chains WHERE verdict='answer' GROUP BY answer")}
sample_raw = json.load(open(SAMPLE))
nsamp = sum(sample_raw.values())
sample = {int(k): v / nsamp * 100 for k, v in sample_raw.items()}

nums = list(range(10, 31))
mv = [markov.get(n, 0.0) for n in nums]
sv = [sample.get(n, 0.0) for n in nums]
diff = [a - b for a, b in zip(mv, sv)]
ns = nsamp
half = 0.38

fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(11, 8.5), dpi=110,
                               gridspec_kw={"height_ratios": [1.4, 1]})
fig.suptitle("Markov v7 (logprobs walk, 186k exp) vs random sample (n=%d)  -  "
             "'Pick a number between 10 and 30'" % ns, fontsize=13)

x = range(len(nums))
ax1.bar([i - half for i in x], mv, width=0.38, color="#4a7ab5", label="Markov (logprobs)")
ax1.bar([i + half for i in x], sv, width=0.38, color="#e8a13a", label="Sample n=%d" % ns)
ax1.set_title("Distribution over answers 10-30 (%% of valid, linear)")
ax1.set_ylabel("% of valid")
ax1.set_xticks(list(x)); ax1.set_xticklabels(nums, fontsize=8)
mx = max(mv + sv) or 1.0
for i in range(len(nums)):
    if mv[i] >= 0.4: ax1.text(i - half, mv[i] + mx*0.01, "%.1f" % mv[i], ha="center", fontsize=7, color="#2c517d")
    if sv[i] >= 0.4: ax1.text(i + half, sv[i] + mx*0.01, "%.1f" % sv[i], ha="center", fontsize=7, color="#a56a15")
ax1.set_ylim(0, mx * 1.15)
ax1.legend(fontsize=9, loc="upper right")

ax2.bar(list(x), diff, width=0.6,
        color=["#2e9e4f" if v >= 0 else "#d64545" for v in diff])
ax2.axhline(0, color="black", lw=0.8)
ax2.set_title("Markov minus sample (percentage points)")
ax2.set_ylabel("pp")
ax2.set_xticks(list(x)); ax2.set_xticklabels(nums, fontsize=8)
md = max(abs(v) for v in diff) or 1.0
ax2.set_ylim(-md * 1.35, md * 1.35)
for i, v in enumerate(diff):
    if abs(v) >= 0.15:
        ax2.text(i, v + (md*0.12 if v >= 0 else -md*0.12), "%+.1f" % v, ha="center",
                 fontsize=7, color="#2e9e4f" if v >= 0 else "#d64545",
                 va="bottom" if v >= 0 else "top")

plt.tight_layout(rect=[0, 0, 1, 0.96])
plt.savefig(OUT)
print("saved", OUT)
print("SAMPLE (n=%d):" % ns, ", ".join("%d=%.2f" % (n, sample.get(n,0)) for n in nums if sample.get(n,0) >= 0.3))
print("MARKOV:        ", ", ".join("%d=%.2f" % (n, markov.get(n,0)) for n in nums if markov.get(n,0) >= 0.3))
print("MAX|diff| = %.2fpp at %d" % (md, nums[diff.index(max(diff, key=abs))]))
