# Honcho (self-hosted, vLLM-backed)

Honcho (plastic-labs, AGPL-3.0) — memory layer for agents: stores conversations,
derives conclusions in the background, answers natural-language queries over peer
representations.

Upstream: https://github.com/plastic-labs/honcho (source vendored here, untracked —
re-extract from tarball / clone to update).

## Wiring

| Honcho part        | Runs on                                                        |
|--------------------|----------------------------------------------------------------|
| api (FastAPI :8001)| `localhost/honcho:latest` (built from vendored Dockerfile)     |
| deriver (4 workers)| same image, `python -m src.deriver`                            |
| database           | pgvector/pg15, volume `honcho_pgdata`                          |
| redis              | redis 8.2, volume `honcho_redis-data`                          |
| LLM (all modules)  | `vllm` container (Qwen3.8-27B-FP8, OpenAI-compatible)          |
| embeddings         | `honcho-embed` (TEI cpu-1.3 + BAAI/bge-small-en-v1.5, :8002)    |

The stack attaches to the shared `tigor-ai_default` network (compose network
`default`), so `vllm`, `forgejo`, `hermes`, `caddy` resolve by container name.

## Config (config.toml)

- Global `[llm] OPENAI_BASE_URL=http://vllm:8000/v1` — every module without a
  per-module override reuses this client; model pinned per-module to
  `Qwen3.8-27B-FP8`.
- `chat_template_kwargs.enable_thinking=false` passed via
  `provider_params.extra_body` on every module — Qwen3.8 is a reasoning model;
  thinking burns tokens and slows the deriver/dialectic.
- `EMBED_MESSAGES=true` + `[embedding] VECTOR_DIMENSIONS=384`,
  `[embedding.model_config] transport="openai"`,
  `[embedding.model_config.overrides] base_url="http://honcho-embed:80/v1"`.
  vLLM serves chat only, so embeddings come from a separate local TEI container
  (BAAI/bge-small-en-v1.5, 384 dims) on the same network. Semantic search and
  deriver observation dedup depend on it.
  - If you ever change the embedding model/dim, run the bundled
    `scripts/configure_embeddings.py --yes` (bind the same `config.toml`) to
    re-ALTER the pgvector columns, or wipe the `honcho_pgdata` volume.
- `[deriver] WORKERS=4` — deriver is LLM-bound, not CPU-bound.
- `USE_AUTH=false` — LAN-only (VM behind VPN).

## Operations

```bash
cd /home/nixos/tigor-ai.worktrees/honcho-selfhosted/ai/honcho
podman build -t localhost/honcho:latest .          # rebuild after source update
podman-compose up -d                               # start stack
podman logs -f honcho-deriver                      # watch derivation

# embeddings sidecar (separate, not part of compose)
podman run -d --name honcho-embed --network tigor-ai_default -p 8002:80 \
  -v /home/nixos/data-embed:/data:ro \
  ghcr.io/huggingface/text-embeddings-inference:cpu-1.3 \
  --model-id /data --auto-truncate
```

API: `http://127.0.0.1:8001` (v3, POST-based routes).
E2E: `/home/nixos/honcho-e2e3.py` (creates a fresh workspace) and
`/home/nixos/honcho-e2e4.py <workspace>` (resume: conclusions -> chat -> repr).

## Verified (2026-08-27)

- vLLM: json_schema strict structured output OK, tool calling OK (qwen3_coder parser).
- E2E green: workspace -> peers -> session -> messages -> deriver conclusions
  (vLLM + TEI embeddings) -> dialectic chat (vLLM tool loop) -> representation.
