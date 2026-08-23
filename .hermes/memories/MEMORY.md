User prefers SHORT scripts (~20 lines) using standard tools. Code must be trivially verifiable. Fan-out audits OK. After edits: grep verify, push main. Autopilot: resolve unless megacritical. Communicates in Russian.
§
Headless generative art: NO browser on VPS. Validate algorithm in Python (math.sin/cos, check bounds/NaN) → render Pillow PNG/GIF → only then write p5.js HTML. Pillow pre-installed, Cairo not. GIF: frames[0].save('out.gif', save_all=True, append_images=frames[1:], duration=100, loop=0).
§
Кастомные скиллы хранятся только в skills/tigor/. Всё остальное в skills/ — бандловое или чужое, не трекать в git. Все новые скиллы создавать в skills/tigor/.
§
NEVER push to GitHub without explicit request. Repos at /opt/git/ (HTTPS clones, semantic remotes encode permissions).
tigor-ai: `github-pull-and-push-to-main` (direct push), `forgejo-push-for-preview` (draft). Push main there.
tigor-no-ai: `github-pull` (read user repo), `github-push-to-feature-branch` (fork). Branch→push→PR to github-pull/main.
Worktrees at /opt/git/tigor-*.worktrees/. .hermes in tigor-ai/.hermes/ mounted to /opt/data.
`hermes-refresh.sh` in tigor-ai root: clean reclone + remotes. PAT via git credential.helper from /opt/data/.env.
§
Hermes .hermes config in tigor-ai/.hermes/ on GitHub (enovikov11/tigor-ai:main). Forgejo mirror at forgejo-push-for-preview.
§
Hermes runs in a Podman container on NixOS host. Host `/home/nixos` is bind-mounted. Container has `docker` CLI (not podman), Podman socket at `/run/user/1000/podman/podman.sock`. Use `DOCKER_HOST=unix:///run/user/1000/podman/podman.sock docker ...` to run containers. Host has `/ssd` storage (NOT mounted in hermes container) — must spawn containers with `-v /ssd:/ssd` to access it.
§
Cron `script` parameter: must be a bare filename (e.g. `repo-audit.py`), auto-resolved relative to ~/./scripts/. Absolute or home-relative paths like ~/./scripts/repo-audit.py are rejected.
§
Clean service: minimal stdlib Python (http.server, hmac, subprocess). Dockerfile: distroless/alpine + COPY + CMD. Compose: named volumes. Crash-fast on missing env.