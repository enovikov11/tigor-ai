# Provider & fallback verification playbook (2026-08, this VM)

Use when the user asks "which models/keys do we have, are they alive, is failover set up".

## 1. Inventory from config

- `~/.hermes/config.yaml` on the VM: `model.default` + `model.provider` = primary; `custom_providers:` = named endpoints.
- **`custom_providers` ≠ fallback.** A provider listed there is only reachable via explicit `provider:<name>` — it is NOT in the failover chain. The real knob is top-level `fallback_providers`: a list of `{provider, model, base_url?, api_mode?}` dicts, tried in order on rate-limit/overload/connection errors. CLI: `hermes fallback add/list/remove/clear` (legacy `fallback_model` single-dict auto-migrates on first add). For fast failover set `agent.api_max_retries: 1` (default 3 = slower handoff).

## 2. Key liveness

- Secrets: `~/.hermes/.env`. Display masked: `sed -E 's/(=.{4}).*/\1****/' ~/.hermes/.env`.
- OpenRouter key:
  `source ~/.hermes/.env; curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $OPENROUTER_API_KEY" https://openrouter.ai/api/v1/models` → 200 = alive.

## 3. Local vLLM liveness

- The config hostname (e.g. `http://vllm:8000/v1`) resolves only inside the Podman network — NOT from the SSH VM (`Could not resolve host`).
- Probe the published port on the host instead:
  `podman ps --format '{{.Names}} {{.Ports}}'` → `curl -sS http://127.0.0.1:8000/v1/models`
  The model list's `data[].id` is the canonical model name; compare with config.

## 4. Verify config keys against source (overlay)

```
find /home/nixos/.local/share/containers/storage/overlay -maxdepth 6 -name "config_defaults.py" 2>/dev/null
```

Pitfall: `find ... -maxdepth 4 -path '*diff/opt/hermes' -type d` can return a stale/empty overlay layer — the first hit may not contain the real files. Find the schema file by name, then grep. `fallback_cmd.py` docstring documents the fallback format.
