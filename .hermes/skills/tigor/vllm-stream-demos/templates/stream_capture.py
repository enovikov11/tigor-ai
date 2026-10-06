#!/usr/bin/env python3
"""Capture N parallel streams from vLLM with per-token arrival times + honest tps.
Run on the VM host (plain python3, stdlib only). Edit the config block, run,
then feed the JSON to templates/render_terminal.py inside the vllm container."""
import json, threading, time, urllib.request

URL = "http://localhost:8000/v1/chat/completions"
METRICS_URL = "http://localhost:8000/metrics"
MODEL = "Qwen3.8-27B-FP8"
N = 8
OUT = "/tmp/tps_demo/stream.json"      # container path; mkdir -p inside container first
ENABLE_THINKING = False                # False -> visible-prose demos
# Date prefix defeats the prefix cache — keep it for multi-stream runs.
DATE = time.strftime("%Y-%m-%d", time.gmtime())
TOPICS = ["гравитацию", "борщ", "рекурсию в программировании", "Марс",
          "тому, почему коты мурлычут", "числу пи", "том, как появился интернет", "джазе"]
PROMPT_FMT = ("Сегодня {date}. Напиши связный абзац из 5 предложений про "
              "{topic}, в конце добавь один неожиданный факт.")
MAX_TOKENS = 600

def get_gen_tokens():
    """Server-side total from vllm:generation_tokens_total (/metrics)."""
    try:
        with urllib.request.urlopen(METRICS_URL, timeout=10) as r:
            for line in r:
                s = line.decode("utf-8", "replace")
                if s.startswith("vllm:generation_tokens_total"):
                    return float(s.split()[-1])
    except Exception:
        pass
    return None

def stream_one(idx, results, lock):
    prompt = PROMPT_FMT.format(date=DATE, topic=TOPICS[idx])
    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": MAX_TOKENS,
        "temperature": 0.7,
        "stream": True,
        "stream_options": {"include_usage": True},
        "chat_template_kwargs": {"enable_thinking": ENABLE_THINKING},
    }
    req = urllib.request.Request(URL, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    t0 = T0
    events, usage, error = [], None, None
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            for raw in r:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                obj = json.loads(data)
                if obj.get("usage"):
                    usage = obj["usage"]
                for ch in obj.get("choices", []):
                    tok = ch.get("delta", {}).get("content")
                    if tok:
                        events.append({"t": round(time.monotonic() - t0, 4), "c": tok})
    except Exception as e:
        error = str(e)
    with lock:
        results[idx] = {"prompt": prompt, "events": events, "error": error,
                        "usage": usage}

T0 = time.monotonic()
gen_start = get_gen_tokens()
results, lock = [None] * N, threading.Lock()
threads = [threading.Thread(target=stream_one, args=(i, results, lock))
           for i in range(N)]
for t in threads:
    t.start()
t_start = time.monotonic()
for t in threads:
    t.join()
t_all = time.monotonic() - t_start
gen_end = get_gen_tokens()

out = {"t_all": round(t_all, 2), "streams": []}
for i, r in enumerate(results):
    ev = r["events"]
    ttft = ev[0]["t"] if ev else None
    t_end = ev[-1]["t"] if ev else 0
    # honest decode tps: first->last token span, excludes prefill
    dtps = ((len(ev) - 1) / (t_end - ev[0]["t"])
            if len(ev) >= 2 and t_end > ev[0]["t"] else None)
    out["streams"].append({
        "idx": i, "prompt": r["prompt"], "events": ev,
        "ttft": round(ttft, 3) if ttft is not None else None,
        "t_end": round(t_end, 3), "n": len(ev),
        "decode_tps": round(dtps, 1) if dtps else None,
        "error": r["error"], "usage": r["usage"],
    })
total_vis = sum(s["n"] for s in out["streams"])
total_comp = sum((s["usage"] or {}).get("completion_tokens", s["n"])
                 for s in out["streams"])
firsts = [s["events"][0]["t"] for s in out["streams"] if s["events"]]
lasts = [s["events"][-1]["t"] for s in out["streams"] if s["events"]]
agg_first, agg_last = min(firsts), max(lasts)
out["agg_vis_tps"] = round((total_vis - len(firsts)) / (agg_last - agg_first), 1)
gen_delta = (gen_end - gen_start) if (gen_start is not None and gen_end is not None) else None
out["gen_delta"] = gen_delta
out["server_tps"] = round(gen_delta / t_all, 1) if gen_delta else None
out["total_visible"] = total_vis
out["total_completion"] = total_comp
json.dump(out, open(OUT, "w"), ensure_ascii=False)
for s in out["streams"]:
    ct = (s["usage"] or {}).get("completion_tokens", s["n"])
    print(f"[{s['idx']}] visible={s['n']} tok (total={ct}), ttft={s['ttft']}s, "
          f"last={s['t_end']}s, decode={s['decode_tps']} tps, err={s['error']}")
print(f"aggregate: visible={total_vis}, total(incl thinking)={total_comp}, "
      f"decode window {agg_first:.2f}s -> {agg_last:.2f}s = {out['agg_vis_tps']} vis tps, "
      f"server={out['server_tps']} tps, wall {t_all:.1f}s")
