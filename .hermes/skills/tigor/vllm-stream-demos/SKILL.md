---
name: vllm-stream-demos
description: "Use when recording vLLM streaming demos (typing, tps)."
version: 1.0.0
---

# vLLM stream demos (typing GIF/MP4, throughput)

Class: capture REAL token streams from the local vLLM (VM :8000) and render them as typing / parallel-stream videos for Telegram. Standing user requirements: real server speed (never simulate or throttle a rate), honest tps accounting, delivery as a file, good quality (MP4 over lossy GIF when quality is asked for).

## 1. Capture (VM host, plain python3 + urllib — no openai dep needed)

Template: `templates/stream_capture.py` (copy, set URL/MODEL/N/topics, run on the VM host).

- POST /v1/chat/completions with `stream: true` and `stream_options: {include_usage: true}`; record `time.monotonic()` per content delta; save per-stream `{events:[{t,c}], usage}` to JSON.
- Add `chat_template_kwargs: {"enable_thinking": false}` when the demo should show visible prose — with thinking on, completion_tokens >> visible tokens and visible output is slow/thin.
- For multi-stream runs: prepend the current date to every prompt to defeat the prefix cache (user explicitly asks for this); verify via /metrics `vllm:prompt_tokens_by_source_total{source="local_cache_hit"}` not growing.
- Parallel: one thread per request sharing one `T0 = time.monotonic()`; this server decodes 8 concurrent requests fine (≈33-34 tps per request, ≈450 tps aggregate observed).

## 2. Honest tps (user corrected "strange counting" — do not repeat the mistake)

- Never headline `total_tokens / wall_time` as tps: prefill inflates wall time, thinking inflates the count, and the two mislead in opposite directions.
- Report: TTFT (first token), per-stream decode tps = `(n-1)/(t_last - t_first)`, aggregate over the decode window (min first-token → max last-token), and the SERVER-side delta of `vllm:generation_tokens_total` from /metrics over wall time — that is the true aggregate and the honest headline.
- In demo headers, show visible tokens and total completion tokens separately; a count that doesn't match the visible text reads as a bug.

## 3. Render (VM host has NO PIL/ffmpeg — render inside the `vllm` podman container)

The `vllm` container has python3 + PIL + ffmpeg + DejaVuSansMono (`/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf`).

Template: `templates/render_terminal.py` (terminal-grid renderer; reads the capture JSON).

- write_file is refused outside /opt/data, which does not exist on the VM → create scripts via terminal heredoc under /home/nixos/<task>/, then `podman cp` to the container.
- `podman cp` fails both ways if the destination dir is missing: `mkdir -p` the container path AND the host target dir first.
- Looked-good style (verified with user): dark bg (13,13,18), cell panels per stream, green topic header, light body, cyan block cursor, amber per-stream footer `N tok · T s · X tps/req`, global live header `visible tok @ t` → final `visible/total tok / wall = server tps`.
- Word-wrap: AFTER flushing a full line you MUST reset the current-line buffer — the classic bug re-appends the same line every tick and duplicates every line. After patching wrap(), print its output for the actual texts before re-rendering all frames.
- The grid windows each stream to the last MAXLINES (long text scrolls); for single-stream demos size the canvas so the full text fits — no scrolling.
- Verify with vision_analyze on a MIDDLE frame and the FINAL frame (not file size): wrap/duplication/cursor position/overflow. PNG frames + ffprobe for counts.

Encoding:
- High quality (user's default preference when quality is asked): PNG frames at ~2x font size, then in the container: `ffmpeg -y -framerate 30 -i frames/%04d.png -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p out.mp4`. ~2MB for 5s at 1980x1370 — well under Telegram's 20MB bot cap.
- GIF (only if explicitly asked for GIF): PIL `save(save_all=True, duration=1000//30)` — lossy and 300KB-6MB; the user has asked for the non-compressed version before.

## 4. Delivery to Telegram

- `MEDIA:` paths are resolved by the GATEWAY process (hermes podman container), not the VM: it mounts /home/nixos from the VM, so save final files under /home/nixos/... and emit that absolute path. Paths the gateway can't see are sent as literal text.
- Put `[[as_document]]` on its own line in the reply to force send_document — the user saying "пришли файлом" or any need for unmodified bytes requires it; image-extension files otherwise go through sendPhoto (re-encoded) or animation.

## Pitfalls
- Don't re-verify by re-rendering what vision already approved; re-render only after code changes.
- `time.strftime` date must come from the run time (cache-busting), not a hardcoded constant.
- vLLM stream deltas may be multi-char; count events as token UNITS, but also carry usage.completion_tokens — they differ and both are needed for honest stats.
