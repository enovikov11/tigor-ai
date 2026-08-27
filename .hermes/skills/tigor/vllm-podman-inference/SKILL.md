---
name: vllm-podman-inference
description: Run vLLM/vLLM-Omni servers on the tigor VM via podman + GPU.
---

# vLLM / vLLM-Omni on tigor VM (rootless podman + Blackwell GPU)

Host: NixOS VM, user `nixos`, rootless podman, 1× NVIDIA RTX PRO 6000 Blackwell 96GB, ~251G RAM. Hermes `write_file`/`patch` tools only reach `/opt/data` — edit VM files under `/home/nixos` via `terminal` (python heredoc or `cat > file <<'EOF'`), then verify by re-reading.

## Launching the server

- GPU: pass ONLY via CDI — `--device nvidia.com/gpu=0` (CDI spec at `/var/run/cdi/nvidia-container-toolkit.json`). Raw `--device /dev/nvidia*` in rootless podman resets the GPU. Verify after any podman GPU operation with `nvidia-smi`.
- Weight loads >100GB (e.g. MiniMax-H3 = 451GB): add `--init-timeout 3600` to the vLLM entrypoint; default 600s init timeout kills the container mid-load.
- `shm_size` ≥ 16g for large diffusion models.
- Overlay live sources on the image with `-e PYTHONPATH=/vllm-omni` and bind-mount a git checkout; always `git checkout <known-commit>` before restarts — rebasing main can break the container build (e.g. vLLM 0.28 rebase broke `create_error_response` import; fixed by pinning commit `da4a08b6`).
- Model weights live on host (e.g. `/hdd/public/internet/huggingface-temp/...`) and are bind-mounted read-only into the container.

## Long generations — do NOT trust silence as a hang

- tqdm/progress bars are block-buffered in container logs: the log can be silent for 30–40 min while the GPU is at 100%/450W. H3 t2va 13s ≈ 42 min e2e (denoise 49 steps × ~50s; VAE decode is on GPU and fast — the "long CPU stage" is DiT orchestration/offload, not CPU compute).
- Liveness check BEFORE killing anything: `nvidia-smi --query-gpu=utilization.gpu,power.draw` (sample 2–3×), and `podman top <c> -o time` twice 60s apart — CPU time growing ~1:1 means real compute. `dmesg | grep -i xid` for GPU faults.
- Only restart after all three say dead. A killed request wastes the entire run (tens of minutes).

## HF model downloads

- `huggingface.co/api/models/<org>/<name>` → JSON `siblings[]` lists exact file paths; then `curl -sSL -o models/<path> https://huggingface.co/<org>/<name>/resolve/main/<path>` per file (loop, verify sizes). Don't guess a single monolithic file.
- Download into host paths that are bind-mounted into the target container (check `podman inspect <c> --format '{{json .Mounts}}'` first — container-local `/workspace` is NOT visible from host).
- `podman exec <c> python3 -c "snapshot_download(...)"` works but only writes to container-local dirs unless a host path is mounted.

## ffmpeg / media post-processing on this VM

- The NixOS host has NO ffmpeg. Options: static binaries (johnvansickle `ffmpeg-*-amd64-static.tar.xz`) in `<project>/bin/` for self-contained scripts, or `podman run --rm -v <dir>:/work docker.io/jrottenberg/ffmpeg -y -i /work/in ...` (note: `ffmpeg` must come after the image name, or it's taken as the output filename).
- PITFALL: `apad` + `-shortest` HANGS forever (infinite silence generator never hits "shortest"). Instead: `DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 in.mp4)` then `-t "$DUR"`. Mux of a 12s clip takes <1s once fixed.
- Revoice pattern (keep user video lossless): `ffmpeg -i user_video -i gen.mp4 -map 0:v:0 -map 1:a -c:v copy -c:a aac -b:a 128k -af "apad,loudnorm=I=-14:TP=-1.5:LRA=11" -t "$DUR" out.mp4`. Loudnorm needed: H3 audio lands at mean −43 dB.
- `rubberband` filter IS available in static & jrottenberg ffmpeg builds — use it for pitch-preserving time-stretch of TTS to match a target duration.
- Shell footgun: `pgrep -f "ffmpeg -y -i original..."` / `pkill` can match your own terminal wrapper's command line and kill the session (exit 255). Use bracket patterns (`orig[in]al`) or kill exact PIDs.
- Quick video QA without a browser: `ffprobe -show_entries stream=codec_type,codec_name,width,height,format=duration` + `ffmpeg -i out -af volumedetect -f null -` (mean_volume).

## VRAM cohabitation

- vLLM default `gpu_memory_utilization=0.9` claims ~87GB/96 → nothing else fits. To co-host a second model (e.g. a ~20GB TTS), cap vLLM at ≤0.68. Verify budgets in GB before promising "they fit".
- Stopping a vLLM container can take minutes (SIGTERM→SIGKILL); GPU memory frees immediately, container lingers in Stopping — just `podman rm` after `Exited`.

## Temporary download servers for user

- `podman run -d --rm --name tmp-http -p 8899:80 -v <dir>:/usr/share/nginx/html:ro docker.io/library/nginx:alpine` → user fetches via `http://10.67.69.2:8899/<file>` (VM is behind the VPN; 10.67.69.2 is the host IP the user can reach).

## Model-specific notes

See `references/minimax-h3.md` for MiniMax-H3 API quirks, timings, and t2va semantics.
See `references/qwen38-flash-next.md` for Qwen3.8-Flash-Next NVFP4 on single 96GB Blackwell (quant layout, PLE CPU offload, MTP).
