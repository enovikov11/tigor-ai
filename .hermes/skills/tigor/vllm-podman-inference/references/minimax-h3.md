# MiniMax-H3 via vLLM-Omni (session 2026-08-27)

Server dir: `/home/nixos/tigor-ai.worktrees/minimax-h3/ai/4-minimax-h3` (podman compose, container `minimax-h3`, host port 8100 → 8000). Image: `docker.io/vllm/vllm-omni:minimax-h3`. Live sources: `/home/nixos/vllm-omni-src` mounted at `/vllm-omni` with `PYTHONPATH=/vllm-omni`; known-good commit `da4a08b6` (vLLM 0.26.0). Weights: `/hdd/public/internet/huggingface-temp/MiniMaxAI/MiniMax-H3` (451GB) at `/MiniMax-H3`. Outputs dir: `/home/nixos/minimax-h3-output` at `/output`.

## API facts

- Endpoint: `POST /v1/videos/sync` (synchronous; long).
- `t2va` REQUIRES `extra_params: {"aspect_ratio": "16:9"}` — fails without it.
- Native output 16:9 = 1344×768@24fps regardless of request; no arbitrary resolution.
- `num_inference_steps` must be 49 or omitted (distilled checkpoint, fixed sigma schedule).
- Modes: `t2va` (text→video+audio), `fl2va` (first-frame→video+audio), `ref2va`. **t2va does NOT take the user's video as input** — the model generates its own video+audio from the text prompt; "revoice" = mux generated audio over user video with stream-copy.
- Audio refs (ref2va) require a visual reference; standalone audio refs are rejected (`standalone audio references require a Ref2VA visual reference`).
- No audio-only mode: DiT denoises video+audio tokens in one packed sequence; audio branch is not standalone. Audio VAE = `MiniMaxH3AudioVAE` (BigVGAN-style, FP32, deliberately deterministic: cudnn off, TF32 off, math-SDP) — codec only, no generation.

## Timings (RTX PRO 6000 96GB)

- Cold start: ~30+ min (451GB weight load).
- 5s clip: ~31 min e2e (denoise_step ~37.7s × 49). 11–13s clip: ~42 min (50.7s × 49).
- VRAM profile: DiT 66.3G + video VAE 10.6G in VRAM; Qwen3-VL text encoder (51.5G) offloaded to system RAM.
- Decode (video VAE + audio VAE) runs ON GPU (`_component_on_device`); the perceived long "CPU stage" is DiT steps with offload orchestration — nothing to move.

## Revoice workflow (validated)

1. Generate ~ceil(user_duration)+1s with prompt (e.g. "мяу мяу мяу"), aspect_ratio 16:9.
2. Mux: `ffmpeg -i original -i h3_raw -map 0:v:0 -map 1:a -c:v copy -c:a aac -b:a 128k -af "apad,loudnorm=I=-14:TP=-1.5:LRA=11" -t $DUR out.mp4` (DUR from ffprobe; `-shortest`+apad hangs).
3. Result: user video untouched, H3 audio loudnorm'd (raw H3 audio is mean −43 dB).
