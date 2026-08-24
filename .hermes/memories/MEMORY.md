User prefers SHORT scripts (~20 lines) using standard tools. Code must be trivially verifiable. Fan-out audits OK. After edits: grep verify, push main. Autopilot: resolve unless megacritical. Communicates in Russian.
§
Headless generative art: NO browser on VPS. Validate algorithm in Python (math.sin/cos, check bounds/NaN) → render Pillow PNG/GIF → only then write p5.js HTML. Pillow pre-installed, Cairo not. GIF: frames[0].save('out.gif', save_all=True, append_images=frames[1:], duration=100, loop=0).
§
Скиллы тигора: `~/.hermes/skills/tigor` → симлинк на `~/tigor-ai/.hermes/skills/tigor/` (git-трек). `skill_manage` пишет в `~/./skills/` → симлинк обеспечивает персистентность. Бандловые скиллы в `skills/` не трекать. Симлинк прописан в `tigor-no-ai/hermes-init.sh`.
§
Repos at /home/nixos/ on VM (SSH terminal). Hermes in Podman container, .hermes bind-mounted as /opt/data/. Worktrees at /home/nixos/tigor-*.worktrees/.
§
Hermes .hermes config in tigor-ai/.hermes/ on GitHub (enovikov11/tigor-ai:main). Forgejo mirror at forgejo-push-for-preview.
§
Hermes runs in a Podman container on NixOS host. Terminal connects via SSH to the VM (host). Repos live at /home/nixos/. .hermes bind-mounted to /opt/data in container. Container has `docker` CLI, Podman socket at `/run/user/1000/podman/podman.sock`. Use `DOCKER_HOST=unix:///run/user/1000/podman/podman.sock docker ...`. Host /ssd not mounted — spawn containers with `-v /ssd:/ssd`.
§
Cron `script` parameter: must be a bare filename (e.g. `repo-audit.py`), auto-resolved relative to ~/./scripts/. Absolute or home-relative paths like ~/./scripts/repo-audit.py are rejected.
§
Clean service: minimal stdlib Python (http.server, hmac, subprocess). Dockerfile: distroless/alpine + COPY + CMD. Compose: named volumes. Crash-fast on missing env.