---
name: selfhosted-llm-services
description: "Self-host LLM frameworks on the VM against local vLLM."
---

# Self-hosting LLM-backed services on the tigor VM

Deploying an OpenAI-compatible AI framework (Honcho, mem0, Letta, ...) so it runs
100% local: LLM = resident `vllm` container, embeddings = TEI sidecar. Validated
end-to-end with Honcho 2026-08-27 (see `references/honcho.md` for the worked example:
exact config, compose, teardown, E2E script).

## Core pattern (framework-agnostic)

1. **One network, names not IPs.** Attach everything to the shared
   `tigor-ai_default` podman network so `vllm:8000` resolves by container name.
   In compose: `networks: {default: {name: tigor-ai_default, external: true}}`.
2. **Global base_url is the single knob.** Most OpenAI-transport frameworks
   (pydantic-settings based, like Honcho) resolve per-module `base_url=None` →
   the GLOBAL client (`LLM.OPENAI_BASE_URL` + `OPENAI_API_KEY`). Point the global
   client at `http://vllm:8000/v1`, set a dummy key (`vllm-local`), and pin the
   served model name (`Qwen3.8-27B-FP8`) per module. Verify in-container:
   `podman exec <c> .venv/bin/python -c "from src.config import settings; print(settings.LLM.OPENAI_BASE_URL)"`.
3. **vLLM is chat-only → embeddings need a sidecar.** Many frameworks embed
   *unconditionally* (dedup, search, dedup of derived observations) even when
   "semantic search" is off in their config. Deploy the TEI sidecar BEFORE wiring
   the framework — otherwise the deriver/workers 401 against api.openai.com with
   your dummy key and you chase a ghost. See `vllm-podman-inference`
   → `references/tei-embeddings-sidecar.md`.
4. **Suppress thinking on resident Qwen.** Qwen3.8-27B-FP8 is a reasoning model:
   send `chat_template_kwargs: {"enable_thinking": false}` as a top-level body
   field (via the framework's extra_body/provider_params passthrough if it has
   one). Saves tokens + latency on agentic loops.
5. **pgvector dim is pinned by migrations, not config.** Frameworks that ship
   pgvector migrations often hardcode 1536. After choosing your embedding model's
   dim, run the vendor's configure_embeddings script (or wipe the pgdata volume)
   — the API startup validator refuses to boot on a dim mismatch.

## Build & run

- Build upstream images with podman on this VM: `RUN --mount=type=cache` works
  (buildkit layering is on); first build of a big uv/pip app can take minutes —
  warm cache makes rebuilds ~80s.
- Vendor upstream source into the tigor-ai worktree but **track only glue**:
  project `.gitignore` with `/*` + `!config.toml !docker-compose.yml !README.md`.
  AGPL upstream stays untracked; glue is reviewable.
- Hermes `write_file`/`patch` only reach `/opt/data`; edit VM files under
  `/home/nixos` via `terminal` heredocs.
- **podman-compose teardown pitfall:** compose groups ALL services into ONE pod.
  `podman rm` of a single container fails ("dependent containers") and
  `restart: unless-stopped` resurrects stopped containers. Sequence:
  `podman update --restart=no` on each → `podman pod rm -f <pod>` →
  `podman volume rm` (named volumes SURVIVE pod removal) → verify clean.
- Long-running foreground terminal commands that hit the 600s cap: run with
  `background=true` + `notify_on_complete`. A killed/timeout command leaves a
  **half-cloned/partial artifact** — clean it before re-running.

## Verification (E2E, not /health)

`/health` + container liveness prove nothing about the LLM wiring. Run the full
data path and read the actual output:

1. Create workspace/peers/session, post a few messages (framework-specific API).
2. Poll derived conclusions until non-empty (watch `podman logs` of the worker —
   it logs per-derivation LLM call durations).
3. Ask the framework a question the messages contain; the answer must reflect the
   content (proves recall → LLM → vLLM).
4. Cross-check vLLM logs show `POST /v1/chat/completions 200` with the expected
   temp params (deriver = low temp, chat = higher temp) and `nvidia-smi` at 100%.

APIs of these frameworks are often **all-POST with JSON bodies** (Honcho v3):
`/list` suffixes are separate routes; "bare" POST paths are usually CREATE.
Read the router source for exact field names before scripting (e.g. Honcho chat
takes `query`, not `question`; messages take `peer_name` aliased as `peer_id`).

## Honcho worked example

See `references/honcho.md` — full config.toml, compose, TEI dim change, v3 API
quirks, E2E scripts, and the pods-teardown sequence as actually run.
