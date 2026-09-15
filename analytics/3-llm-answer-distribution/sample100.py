import json, re, time, urllib.request
from collections import Counter

URL = "http://127.0.0.1:8000/v1/chat/completions"
N = 100
count = Counter()
texts = []
t0 = time.time()
for i in range(N):
    body = {"model":"Qwen3.8-27B-FP8",
            "messages":[{"role":"user","content":"Pick a number between 10 and 30"}],
            "max_tokens":24, "temperature":1.0, "top_p":1.0,
            "chat_template_kwargs":{"enable_thinking":False}}
    req = urllib.request.Request(URL, data=json.dumps(body).encode(),
                                 headers={"Content-Type":"application/json"})
    for a in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                d = json.load(r)
            break
        except Exception as e:
            if a == 2: raise
            time.sleep(2)
    txt = (d["choices"][0]["message"].get("content") or "").strip()
    texts.append(txt)
    m = re.fullmatch(r"\s*(\d+)\s*[.!]? ?", txt)
    if m and 10 <= int(m.group(1)) <= 30:
        count[int(m.group(1))] += 1
    else:
        count["invalid"] += 1
    if (i+1) % 20 == 0:
        print(f"{i+1}/{N} ({time.time()-t0:.0f}s)", flush=True)

print(f"\ntotal {N}, {time.time()-t0:.0f}s")
print(f"{'ans':>8} {'count':>6} {'pct':>8}   markov-share-among-valid")
mv = json.load(open("markov_numbers.json"))
mv = {d["number"]: math.exp(d["logp"]) for d in mv} if False else None
import math
mv = {d["number"]: math.exp(d["logp"]) for d in json.load(open("markov_numbers.json"))}
mv[30] = math.exp(json.load(open("logp30.json"))["logp30"])
mtot = sum(mv.values())
valid_total = N - count["invalid"]
for n in sorted(count):
    c = count[n]
    pct = c / N * 100
    if n == "invalid":
        print(f"{'invalid':>8} {c:>6} {pct:>7.2f}%")
    else:
        mvpct = mv[n] / mtot * 100
        print(f"{n:>8} {c:>6} {pct:>7.2f}%   {mvpct:>8.3f}%")
print("\nsample texts (first 25):")
for t in texts[:25]:
    print("  ", repr(t[:60]))
json.dump({"counts": dict(count), "texts": texts}, open("sample100.json","w"), indent=1)
