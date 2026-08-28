# Honcho (plastic-labs) — worked local install, 2026-08-27

Glue committed in tigor-ai worktree `ai/honcho/` (branch `honcho-selfhosted`):
`config.toml`, `docker-compose.yml`, `README.md`, `.gitignore` (tracks glue only,
upstream source untracked — re-extract from tarball to update).

## Topology

| Part | Where | Notes |
|---|---|---|
| honcho-api | `localhost/honcho:latest` :8001→8000 | image built from vendored Dockerfile (uv sync, ~80s warm) |
| honcho-deriver | same image, `python -m src.deriver` | `WORKERS=4`, `FLUSH_ENABLED=true` |
| honcho-db | `pgvector/pgvector:pg15` | volume `honcho_pgdata` |
| honcho-redis | `redis:8.2` | volume `honcho_redis-data` |
| LLM | `vllm:8000/v1` Qwen3.8-27B-FP8 | global `LLM.OPENAI_BASE_URL`, dummy key `vllm-local` |
| embeddings | `honcho-embed` TEI cpu-1.3 + bge-small-en-v1.5 (384d) :8002 | model at `/home/nixos/data-embed` |

All on `tigor-ai_default` (compose `networks.default.external.name`).
`USE_AUTH=false` (LAN/VPN).

## config.toml essentials

```toml
[app]
EMBED_MESSAGES = true

[llm]
OPENAI_BASE_URL = "http://vllm:8000/v1"
OPENAI_API_KEY  = "vllm-local"

[embedding]
VECTOR_DIMENSIONS = 384

[embedding.model_config]
transport = "openai"
model = "bge-small-en-v1.5"

[embedding.model_config.overrides]
base_url = "http://honcho-embed:80/v1"

[deriver]
ENABLED = true
WORKERS = 4
FLUSH_ENABLED = true        # bypass 512-token batch gate for short sessions
```

Every LLM module (deriver/summary/dialectic/dream/peer-card) sets
`model = "Qwen3.8-27B-FP8"` and
`provider_params.extra_body.chat_template_kwargs.enable_thinking = false`.
Modules with no base_url override reuse the global client (verified in-container:
`settings.LLM.OPENAI_BASE_URL == http://vllm:8000/v1`, module override `None`).

## Gotchas hit in this session

- **Embeddings are mandatory.** `EMBED_MESSAGES=false` does NOT remove the
  embedding dependency: `save_representation` (deriver) embeds every observation
  for pgvector + dedup. First run 401'd against openai.com → TEI sidecar
  (see `vllm-podman-inference` → `references/tei-embeddings-sidecar.md`).
- **Dim mismatch blocks boot.** Migrations pin `vector(1536)`; validator at API
  startup refuses to start when column dim ≠ `VECTOR_DIMENSIONS`. Fix with the
  bundled script, binding the SAME config.toml the containers use:
  ```bash
  podman run --rm --network tigor-ai_default \
    -v $PWD/config.toml:/app/config.toml:ro \
    localhost/honcho:latest /app/.venv/bin/python scripts/configure_embeddings.py --yes
  ```
  (it drops/recreates HNSW indexes too). Alternatively wipe `honcho_pgdata`.
  The image bakes in the build-time config.toml — a bare `podman run` without the
  bind mount silently uses the OLD config.
- **Batch gate:** `REPRESENTATION_BATCH_WORK_UNIT_TARGET_TOKENS=512` leaves short
  sessions (a few messages ≈ 150 tokens) unclaimed until the 30-min age-out.
  `FLUSH_ENABLED=true` bypasses it. Queue state: `select task_type, processed,
  left(error,300) from queue;` in honcho-db.
- **v3 API is all-POST.** Route map that actually worked:
  - `POST /v3/workspaces` `{name}`
  - `POST /v3/workspaces/{ws}/peers` `{name}`
  - `POST /v3/workspaces/{ws}/sessions` `{id, peers: {p1: {}, p2: {}}}`
  - `POST /v3/workspaces/{ws}/sessions/{id}/messages` `{messages: [{peer_id, content}]}`
  - `POST /v3/workspaces/{ws}/conclusions` `{filters: {observer}}` → create; **list is `/conclusions/list`**
  - `POST /v3/workspaces/{ws}/peers/{p}/chat` `{session_id, query}` (NOT `question`)
  - `POST /v3/workspaces/{ws}/peers/{p}/representation` `{}` (NOT `/repr`)
- **podman-compose teardown:** all 4 services share ONE pod; see main SKILL.md
  (update --restart=no → pod rm -f → volume rm). A dead API/deriver after a dim
  change does not self-restart if you'd set `restart=no` — `podman start` it.
- **Long SSH commands** (sleeps > ~5min, big waits) can drop the session
  (exit 255, no output); the VM is fine — just re-run the probe.

## E2E (proves vLLM wiring, not just /health)

Scripts (on host, urllib-only, no deps):
- `/home/nixos/honcho-e2e3.py` — fresh workspace, posts 4 alice/tutor messages
  (study habits + math anxiety), polls `/conclusions/list`, then chat + repr.
- `/home/nixos/honcho-e2e4.py <workspace>` — resume half-done workspace.

Expected (observed): deriver logs `PERFORMANCE minimal_deriver_*_alice ...
llm_call_duration=~1.8s ... observation_count=6`; 7 tutor conclusions;
dialectic chat (6s, temp>0 in vLLM logs) answers from the stored facts;
representation lists timestamped observations. vLLM log shows
`POST /v1/chat/completions 200` for both deriver (temp=0) and chat (temp=1)
traffic; `nvidia-smi` at 100% during derivation.
