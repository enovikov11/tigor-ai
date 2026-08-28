# vllm-omni compose service (2026-08-27)

vLLM-Omni launched from tigor-ai root `docker-compose.yml` as service `vllm-omni` (commit 4b0a0af).

- Image `vllm/vllm-omni:minimax-h3`, port 8100→8000, `profiles: ["omni"]`, NO `restart:` — never autostarts. Supersedes the compose file in the unmerged `minimax-h3` worktree/branch.
- Start: `cd /home/nixos/tigor-ai && podman compose --profile omni up -d vllm-omni`. VRAM: main `vllm` (Qwen3.8-27B, ~87/96GB) must be stopped first.
- All production containers run from the main clone `/home/nixos/tigor-ai` (`com.docker.compose.project.working_dir` label in `podman inspect`). Worktree edits only take effect after push to main + `git pull --ff-only` in the clone.
- Verify profile gating: plain `podman compose config` must NOT list `vllm-omni`. NixOS `docker compose` delegates to python podman-compose, whose `config --profile <p>` prints nothing on error (stderr swallowed) — don't trust an empty `--profile` config as "works".
