---
name: hermes-config-diagnosis
description: "Verify Hermes config keys against source before explaining."
---

# Hermes config diagnosis

When the user says "I set X in the config, why does hermes still do Y?" — do NOT trust the key name at face value. Hermes silently ignores unknown config keys, so a plausible-looking key (e.g. `agent.ask: false`) can be a no-op.

## Steps

1. Read the real config file: `~/.hermes/config.yaml` (user may call it "hermes.yaml"; the canonical name is `config.yaml`). On this machine the git-tracked copy is `/home/nixos/tigor-ai/.hermes/config.yaml` (same file).
2. **Verify the key exists** in the installed source before explaining behavior. On this VM the Hermes source is readable via the Podman container overlay (no pip install, no clone needed):
   ```
   find /home/nixos/.local/share/containers/storage/overlay -maxdepth 4 -path '*diff/opt/hermes' -type d 2>/dev/null
   ```
   The config schema with all real keys lives in `hermes_cli/config_defaults.py`. Grep the relevant section there.
3. If the key is absent from defaults → it's a dead key; tell the user it's silently ignored and find the real knob.

## Known real keys for common complaints (verified 2026-08)

| Complaint | Real knob | Not the knob |
|---|---|---|
| "Keeps asking questions on Telegram" | `clarify` tool listed in `platform_toolsets.telegram` — remove the line to disable the question tool. List is an allowlist. | `agent.ask` (does not exist) |
| "Waits too long on a clarify prompt" | `agent.clarify_timeout` (default 3600s; 0 = unlimited) | — |
| "Describes actions instead of doing them" | `agent.tool_use_enforcement`, `agent.intent_ack_continuation` | — |

## Cron model drift guard (#44585)

Unpinned cron jobs snapshot provider/model at creation. If the global `model:` default changes later, the job is SKIPPED (fail-closed, no paid call) with a drift_skip alert. Fixes:
- Pin: `hermes cron edit <id> --provider <p> --model <m>` (works from `podman exec hermes hermes ...`)
- Or make it follow the global default with NO pin: clear `provider`, `model`, `provider_snapshot`, `model_snapshot` on the job in `~/.hermes/cron/jobs.json` (scheduler re-reads storage each tick; an axis without snapshot is exempt from the guard).
- `hermes cron edit --model` cannot unpin — pass empty string only for `--model_provider`; for model, edit jobs.json directly (scheduler re-reads every tick, no restart needed).
- `cron.model_drift_guard: false` in config disables the guard globally (literal `false` only).

## Pitfalls:

- Toolset changes only apply on `/reset` / new session, never mid-conversation (prompt-caching invariant). Tell the user a session reset is needed.
- Config changes: user convention is to edit the git-tracked copy in tigor-ai and push, not hand-edit the live file in place (config has a "DO NOT EDIT without explicit user request" header).
- When in doubt about any key, `grep -rn '<key>' <hermes>/hermes_cli/ <hermes>/agent/ --include='*.py'` — a key that's never read is not a key.
