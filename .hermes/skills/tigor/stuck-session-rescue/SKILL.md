---
name: stuck-session-rescue
description: Use when a Hermes session is stuck on a hung tool call.
---

# Stuck session / orphaned process rescue

A Hermes session (often a previously delegated one) stops replying because a terminal/browser tool call is blocked on a process that never exits — typical culprit: a headless chromium CDP test script whose CDP port stops responding, wrapped in nix-shell. The tool call never returns, so the session looks dead.

## Procedure

1. `process_manage action=list` first — but it only tracks processes spawned by THIS session. An empty list does NOT mean the VM is clean; another session's tool calls are invisible here.
2. Find what the stuck session's last tool call was: `session_search query=<topic>` (sort=newest). Its last tool call reveals the markers: script path (`/tmp/cdp-*.mjs`), `--remote-debugging-port=N`, `--user-data-dir=/tmp/...`.
3. Locate the full process tree by those markers:
   ```
   ps aux | grep -E "<script>|remote-debugging-port=<N>|cdp-<n>" | grep -v grep
   ```
   Expect a `bash -c` / nix-shell wrapper, the node/python driver, and spawned children (chromium spawns many helper PIDs).
4. Kill by explicit PIDs from the ps output, wrapper first, then driver, then children.
5. Clean the /tmp state: user-data-dir and test script.
6. Verify BOTH sides: `ps aux | grep` shows nothing left, and the service under test is still healthy (curl 200). Once the process tree is gone, the stuck session's tool call returns/times out and the session unblocks — don't re-run the test unless the user wants its result.

## Pitfalls

- NEVER `pkill -f <pattern>` from the terminal tool: the pattern string appears in your own wrapper shell's command line, so pkill matches and SIGTERMs the shell that is running the command — SSH drops, the call comes back with empty output and exit 255 (the kills themselves usually DID land; verify with a fresh `ps` before assuming total failure). If a pattern kill is unavoidable, use the bracket trick `pkill -f "[c]dp-4"` so the regex can't self-match.
- Kill the wrapper before the children, by explicit PID: killing only the driver leaves children reparented to init still running and still holding ports.
- A `timeout N` around a driver is no guarantee of cleanup: signal delivery through nix-shell wrappers and to child processes (chromium) can be lost, so the tree survives past the timeout. Always sweep with ps afterward.
