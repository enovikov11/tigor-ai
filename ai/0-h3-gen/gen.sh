#!/usr/bin/env bash
# MiniMax-H3 cat-meow revoice. Self-contained: run from any shell.
# Offline-capable: local podman image, local model dir, static ffmpeg in ./bin.
# SKIP_GEN=1 ./gen.sh  -> skip H3 generation, re-mux from existing h3_raw.mp4
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IN="$DIR/original.mov"
H3_RAW="$DIR/h3_raw.mp4"
OUT="$DIR/output.mp4"
FF="$DIR/bin/ffmpeg"
FP="$DIR/bin/ffprobe"
SERVER_DIR="/home/nixos/tigor-ai.worktrees/minimax-h3/ai/4-minimax-h3"
API="http://localhost:8100"

# ---- prompt input (edit freely) ----
PROMPT='A fluffy cat meowing contentedly, meow meow meow, soft cozy indoor room, gentle sunlight'
SEED=7
STEPS=50
WIDTH=1344
HEIGHT=768

# ---- 1. duration: match original (H3 accepts 4..15 s), ceil so audio covers it ----
DUR_FULL="$("$FP" -v error -show_entries format=duration -of csv=p=0 "$IN")"
DUR="$(awk "BEGIN{d=int($DUR_FULL); if ($DUR_FULL > d) d++; if (d < 4) d = 4; if (d > 15) d = 15; print d}")"
echo "[gen] original=${DUR_FULL}s -> H3 duration=${DUR}s"

# ---- 2. H3 server (start + wait for load, model ~451G => ~30 min cold) ----
if [ "${SKIP_GEN:-0}" != "1" ]; then
  if ! curl -sf "$API/health" >/dev/null 2>&1; then
    echo "[gen] starting minimax-h3 server (cold load ~30 min)..."
    (cd "$SERVER_DIR" && podman compose up -d)
    for i in $(seq 1 180); do
      sleep 20
      curl -sf "$API/health" >/dev/null 2>&1 && break
    done
  fi
  curl -sf "$API/health" >/dev/null || { echo "[gen] server failed to come up"; exit 1; }

  # ---- 3. generate (raw H3 video+audio kept as h3_raw.mp4) ----
  echo "[gen] generating meow track (${DUR}s, first run incl. compile ~45 min)..."
  curl -sS --max-time 7200 -X POST "$API/v1/videos/sync" \
    -F "prompt=$PROMPT" \
    -F width="$WIDTH" -F height="$HEIGHT" -F fps=24 \
    -F num_inference_steps="$STEPS" -F flow_shift=12 -F seed="$SEED" \
    -F "extra_params={\"task\":\"t2va\",\"duration\":${DUR}.0,\"audio_flow_shift\":3.0,\"aspect_ratio\":\"16:9\"}" \
    -o "$H3_RAW"
fi
[ -f "$H3_RAW" ] || { echo "[gen] missing $H3_RAW"; exit 1; }

# ---- 4. mux: original video (stream copy, AR/size intact) + H3 audio, trimmed ----
echo "[gen] muxing -> $OUT"
"$FF" -y -v error -i "$IN" -i "$H3_RAW" \
  -map 0:v:0 -map 1:a -c:v copy -c:a aac -b:a 128k \
  -af "apad,loudnorm=I=-14:TP=-1.5:LRA=11" -t "$DUR_FULL" "$OUT"
echo "[gen] done: $OUT"
