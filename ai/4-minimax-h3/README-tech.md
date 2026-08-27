# MiniMax-H3 — technical notes

## Hardware reality
- 1× RTX PRO 6000 Blackwell 96GB, 251GB RAM, 64 cores
- GPU often busy with Qwen3.8-27B vLLM (:8000) — H3 needs the GPU free
- GPU passthrough via **CDI**: `--device nvidia.com/gpu=0` (spec at /var/run/cdi/nvidia-container-toolkit.json).
  Raw `--device /dev/nvidia*` SILENTLY DROPS in this podman setup (devices=[] in inspect) — use CDI.

## Profile: fast single-GPU
- DiT 66.3G + VAE ~10.6G resident in VRAM; Qwen3-VL encoder (51.5G) CPU-offloaded
  (runs once per request, ~0.2s of 87s — no gen-speed impact)
- No --enforce-eager: regional compile active (~+9.5%)
- CUDNN_ATTN: correct backend for RTX PRO Blackwell per recipe
- vllm/vllm-omni:minimax-h3 image tag predates vLLM-Omni #5720 modular merge →
  source checkout at /home/nixos/vllm-omni-src bound at /vllm-omni, PYTHONPATH prepended
- --task-type NOT set: both DiTs (FL2VA+Ref2VA) load — 2×66G in 96G VRAM is tight;
  if OOM at startup, add --task-type fl2va (T2VA/FL2VA only, Ref2VA needs restart)

## Start
    cd ai/4-minimax-h3 && podman compose up -d
    # or: podman start minimax-h3 (already created)

## Generate (sync, MP4 in response)
    curl -X POST http://localhost:8010/v1/videos/sync \
      -F 'prompt=A cat playing a trumpet on a rooftop at dusk' \
      -F width=1344 -F height=768 -F fps=24 \
      -F num_inference_steps=50 -F flow_shift=12 -F seed=1101 \
      -F 'extra_params={"task":"t2va","duration":5.0,"audio_flow_shift":3.0}' \
      -o /home/nixos/minimax-h3-output/out.mp4
- shapes: short edge 768 (fast) or 1440 (2K); 1344×768 is the documented 16:9
- task: t2va | fl2va (1-2 images) | ref2va (1 image + 1 audio ref, current serving limit)
- async variant: POST /v1/videos + poll

## Model
- /hdd/public/internet/huggingface-temp/MiniMaxAI/MiniMax-H3 — 464G, complete
  (104 safetensors, verified 2026-08-27)

## Pitfalls
- /dev/shm: recipe warns 5s 1024×576 clip needs ~0.9GiB — set shm 16g
- first request = compile warmup
- 24 FPS fixed; 4–15s duration; seed makes output deterministic
