Code trivially verifiable. Fan-out audits OK. Never use user name abbreviations (pub/priv/sec) — always full public/private/secret in paths, image suffixes, flags.
§
Hermes core code (gateway/telegram adapter/approvals) = high-risk for autonomous AI edits: user forbade patching in practice. Patch may sit on disk dormant; never activate/reapply without explicit ask.
§
Кастомные скиллы хранятся только в skills/tigor/. Всё остальное в skills/ — бандловое или чужое, не трекать в git. Все новые скиллы создавать в skills/tigor/.
§
0-dash (infra/0-dash, :1337, IP 10.67.69.2) = FastAPI+static HF storage dashboard; ro-binds /hdd+/ssd/public/internet + tigor repos (needs git in image). Test on port 1338; write_file blocked outside /opt/data, write via terminal heredoc. UI: detail-level radios, optional ⊞ must not shift rows; ❗ size-mismatch / ⚠ one-disk file, per-file data only.
§
Hermes .hermes config in tigor-ai/.hermes/ on GitHub (enovikov11/tigor-ai:main). Forgejo mirror at forgejo-push-for-preview.
§
Cron `script` parameter: must be a bare filename (e.g. `repo-audit.py`), auto-resolved relative to ~/./scripts/. Absolute or home-relative paths like ~/./scripts/repo-audit.py are rejected.
§
Clean service: minimal stdlib Python; distroless/alpine Dockerfile; named volumes; crash-fast on missing env.
§
User's YAML config files and .gitignore should not be touched unless explicitly asked. Memory notes are OK to edit freely.
§
GitHub REST curl from VM times out (blocked). For PRs: git push to fork remote (token in URL) + give PR-new/compare link; don't retry curl.
§
tigor-no-ai vm.xsl: fix test <vm> definitions, not the template. Verify: xsltproc --nonet vm.xsl vm.xsl.
§
Model policy: NO auto-fallback — model choice must be explicit. OpenRouter providers (glm, kimi, qwen=qwen/qwen3.8-27b) only when local vLLM is temporarily off or on explicit user request for a rare smart model.
§
HF model storage: /hdd + /ssd under /public/internet (huggingface.co[-temp]), readable from VM; audit: find -printf '%s\t%p\n' + size dedupe in Python.
§
ai/honcho worktree :8001: LLM=vllm Qwen3.8-27B-FP8, embed=honcho-embed TEI bge-small 384d :8002; dim change needs configure_embeddings.py.