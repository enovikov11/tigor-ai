User prefers SHORT scripts (~20 lines) using standard tools. Code must be trivially verifiable. Fan-out audits OK. After edits: grep verify, push main. Autopilot: resolve unless megacritical. Communicates in Russian.
§
Headless generative art: NO browser on VPS. Validate algorithm in Python (math.sin/cos, check bounds/NaN) → render Pillow PNG/GIF → only then write p5.js HTML. Pillow pre-installed, Cairo not. GIF: frames[0].save('out.gif', save_all=True, append_images=frames[1:], duration=100, loop=0).
§
Кастомные скиллы хранятся только в skills/tigor/. Всё остальное в skills/ — бандловое или чужое, не трекать в git. Все новые скиллы создавать в skills/tigor/.
§
NEVER push to GitHub without explicit request. Fork main MUST mirror upstream main — no own commits.

Bare repos: use `git worktree add -b <branch> <path> remotes/origin/main` → edit → commit → push. Direct edits under bare `pages/` aren't tracked.

tigor-ai (enovikov11-ai-agent/tigor-ai): push directly to main. tigor-no-ai (enovikov11/tigor-no-ai): branch on agent-fork → PR to upstream. Bare repo at /opt/data/tigor-no-ai (origin=agent-fork, upstream=user). Work clones: tigor-no-ai-work (origin=user), tigor-no-ai-pr (origin=agent-fork).
§
Hermes .hermes config now lives in tigor-ai/.hermes/ on GitHub (enovikov11/tigor-ai:main). No more separate hermes-config repo. Forgejo tigor bare repo syncs ai/main → forgejo/main.
§
Hermes runs in a Podman container on NixOS host. Host `/home/nixos` is bind-mounted. Container has `docker` CLI (not podman), Podman socket at `/run/user/1000/podman/podman.sock`. Use `DOCKER_HOST=unix:///run/user/1000/podman/podman.sock docker ...` to run containers. Host has `/ssd` storage (NOT mounted in hermes container) — must spawn containers with `-v /ssd:/ssd` to access it.
§
Cron `script` parameter: must be a bare filename (e.g. `repo-audit.py`), auto-resolved relative to ~/./scripts/. Absolute or home-relative paths like ~/./scripts/repo-audit.py are rejected.
§
Clean service: minimal stdlib Python (http.server, hmac, subprocess). Dockerfile: distroless/alpine + COPY + CMD. Compose: named volumes. Crash-fast on missing env.