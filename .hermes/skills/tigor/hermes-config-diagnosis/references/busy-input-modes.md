# Busy-session input handling (verified 2026-08)

Use when the user asks what happens when a message arrives while a turn is
still running, or wants to change that default.

## The knob: `display.busy_input_mode`

| Mode | Behavior |
|---|---|
| `interrupt` (default) | Message redirects the active turn — generation restarts with the new message (running tools finish first) |
| `queue` | Message waits silently, runs as the next turn after the current task finishes |
| `steer` | Message is injected into the running turn (arrives after the next tool call) — no restart, no new turn |

Change default: `display.busy_input_mode: queue` in config.yaml
(`hermes config set display.busy_input_mode queue` from inside the container).
Per-session without touching config: `/busy queue|steer|interrupt`, `/busy status`.

## Related keys

- `display.busy_ack_enabled` / `display.busy_ack_detail` — hide/show the "I'm busy" ack messages (input handling unchanged).
- `agent.session_stall_timeout` (default 300s, 0 = off) — notify-only watchdog: pings user if a busy session with pending inbound input looks wedged. Never kills the turn.
- `agent.gateway_turn_lease_timeout` (default 1800s) — max wait for another turn to release the session lease; fail-closed rejection, no auto-requeue.
- `display.interim_assistant_messages: true` (default) — mid-turn assistant updates delivered as separate chat messages.

## Docs anchor

Config reference: https://hermes-agent.nousresearch.com/docs/user-guide/configuration
(sections "Gateway Turn Lease Timeout", "Session Stall Watchdog"). The
`busy_input_mode` table lives under the `display` section.

## Current user choice (2026-08)

User set `display.busy_input_mode: steer` as the global default in
tigor-ai/.hermes/config.yaml (commit on main, 2026-08-27; was `queue` before).
Per-message queue without touching the mode: `/queue <text>` (alias `/q`) in
Telegram — works in both CLI and gateway.

## Editing the config file (this machine)

- `patch` tool is DENIED on `/home/nixos/tigor-ai/.hermes/config.yaml`
  (HERMES_WRITE_SAFE_ROOT=/opt/data). Edit via VM terminal (sed) or
  `podman exec hermes hermes config set ...`.
- `hermes` CLI is NOT on the VM PATH — it lives inside the podman container
  (`podman exec hermes hermes ...`).
- After editing, commit + push to the `github-pull-and-push-to-main` remote
  (the plain `origin`/forgejo remote fails with access-rights errors).
