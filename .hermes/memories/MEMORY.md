User prefers SHORT scripts (~20 lines), standard tools, plain loopless one-liners. Code trivially verifiable. Fan-out audits OK. After edits: grep verify, push main. Autopilot: resolve unless megacritical. Communicates in Russian.
§
Headless generative art: NO browser on VPS. Validate algorithm in Python (math.sin/cos, check bounds/NaN) → render Pillow PNG/GIF → only then write p5.js HTML. Pillow pre-installed, Cairo not. GIF: frames[0].save('out.gif', save_all=True, append_images=frames[1:], duration=100, loop=0).
§
Кастомные скиллы хранятся только в skills/tigor/. Всё остальное в skills/ — бандловое или чужое, не трекать в git. Все новые скиллы создавать в skills/tigor/.
§
Repos at /home/nixos/ on VM (SSH terminal). Hermes in Podman container, .hermes bind-mounted as /opt/data/. Worktrees at /home/nixos/tigor-*.worktrees/.
§
Hermes .hermes config in tigor-ai/.hermes/ on GitHub (enovikov11/tigor-ai:main). Forgejo mirror at forgejo-push-for-preview.
§
Cron `script` parameter: must be a bare filename (e.g. `repo-audit.py`), auto-resolved relative to ~/./scripts/. Absolute or home-relative paths like ~/./scripts/repo-audit.py are rejected.
§
Clean service: minimal stdlib Python (http.server, hmac, subprocess). Dockerfile: distroless/alpine + COPY + CMD. Compose: named volumes. Crash-fast on missing env.
§
User's YAML config files and .gitignore should not be touched unless explicitly asked. Memory notes are OK to edit freely.
§
GitHub REST curl from SSH VM terminal times out (blocked). For PRs: git push to fork remote (token in URL) + give the GitHub PR-new/compare link; don't retry curl.
§
tigor-no-ai vm.xsl: fix test <vm> definitions, not the template (user: template change = noop, not fix). vhostuser/virtiofs need <access mode="shared"/> in memoryBacking; template emits it only when a mount exists; SEV <locked/> memory is host-encrypted, incompatible with virtiofs. Verify: xsltproc --nonet vm.xsl vm.xsl.
§
Model policy: NO auto-fallback — model choice must be explicit. OpenRouter providers (glm, kimi, qwen=qwen/qwen3.8-27b) only when local vLLM is temporarily off or on explicit user request for a rare smart model.