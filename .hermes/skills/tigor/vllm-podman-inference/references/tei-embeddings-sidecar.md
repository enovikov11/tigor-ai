# TEI embeddings sidecar (local CPU, OpenAI-compatible)

Use when a service needs an OpenAI-compatible `/v1/embeddings` endpoint and vLLM is
chat-only (it does NOT serve embeddings). Deployed 2026-08-27 for Honcho.

## Why

Honcho's deriver `save_representation` **always** embeds every derived observation
(pgvector + semantic dedup), regardless of `EMBED_MESSAGES`. With no working
embedding endpoint the deriver 401s against api.openai.com (it reuses the global
`OPENAI_API_KEY`), and the API itself refuses to start (embedding dimension
validator) if the DB dim doesn't match `EMBEDDING.VECTOR_DIMENSIONS`.

## Stack

- Image: `ghcr.io/huggingface/text-embeddings-inference:cpu-1.3`
- Model: `BAAI/bge-small-en-v1.5` (384 dims, ~133 MB) downloaded to a host dir.
- Container on the shared network so consumers reach it by name (`honcho-embed:80`).

## Run

```bash
mkdir -p /home/nixos/data-embed && cd /home/nixos/data-embed
# model.safetensors config.json tokenizer.json tokenizer_config.json vocab.txt
# special_tokens_map.json  +  1_Pooling/config.json  (URL-encode the slash: 1_Pooling%2Fconfig.json)
#  + config_sentence_transformers.json sentence_bert_config.json modules.json
podman run -d --name honcho-embed --network tigor-ai_default -p 8002:80 \
  -v /home/nixos/data-embed:/data:ro \
  ghcr.io/huggingface/text-embeddings-inference:cpu-1.3 \
  --model-id /data --auto-truncate
```

Verify:
```bash
curl -s http://127.0.0.1:8002/health
curl -s -X POST http://127.0.0.1:8002/v1/embeddings -H 'Content-Type: application/json' \
  -d '{"input":["hello","world"],"model":"bge"}'   # expect 384-dim vectors
```

## Pitfalls (all hit on 2026-08-27)

- **Flag name**: newer TEI tags use `--model-id` for a local path; the old
  `--model-name` made it try to *download* the path from HF. If the container
  crashes in a restart loop, `podman logs` — a missing local file shows as a
  download attempt.
- **Missing `1_Pooling/config.json`** (sentence-transformers layout) also crashes
  startup with a model-not-found error even though the weights are present.
  `curl` the path with the slash URL-encoded (`1_Pooling%2Fconfig.json`).
- **OpenAI SDK compatibility**: TEI serves `/v1/embeddings`, so any OpenAI-transport
  client works with `base_url="http://honcho-embed:80/v1"` + a dummy `api_key`.
  The `model` field is ignored by TEI.

## Consumer wiring (Honcho example)

```toml
[app]
EMBED_MESSAGES = true

[embedding]
VECTOR_DIMENSIONS = 384          # must equal the model output dim

[embedding.model_config]
transport = "openai"
model = "bge-small-en-v1.5"      # cosmetic; TEI ignores it

[embedding.model_config.overrides]
base_url = "http://honcho-embed:80/v1"
```

Changing dims on an existing DB: run the vendor's
`scripts/configure_embeddings.py --yes` (bind-mount the same config.toml into the
app image) to ALTER the pgvector columns + recreate HNSW indexes — or wipe the
pgdata volume and re-init.
