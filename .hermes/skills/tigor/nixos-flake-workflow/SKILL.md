---
name: nixos-flake-workflow
description: "Edit and verify NixOS flake.nix changes (tigor-no-ai)."
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [nixos, nix, flake, tigor, verification]
    related_skills: [tigor-monorepo]
---

# NixOS flake workflow (tigor-no-ai)

Use when editing `flake.nix` (or any NixOS module) in the tigor-no-ai worktree and it must actually build/eval before push.

## Editing repo files from the container

`patch` / `write_file` / `search_files` are confined to the container's write-safe root (/opt/data); repos live on the SSH VM at /home/nixos/. Read with `read_file` (works), edit via `terminal` with a python heredoc:

```bash
python3 - <<'EOF'
s = open('flake.nix').read()
old = '...'   # exact text, unique in file
new = '...'
assert s.count(old) == 1
s = s.replace(old, new)
open('flake.nix','w').write(s)
print('ok')
EOF
```

Assert-on-unique-match is the guardrail replacing the patch tool. `git diff` after every edit.

## Verifying with nix eval

- First eval in a worktree fetches nixpkgs: takes 2–5 min. Run in BACKGROUND (`terminal background=true`, notify_on_complete) and batch ALL attribute checks into one loop — never one eval per call.
- Verify BOTH configurations (`. #nixosConfigurations.vm` and `. #nixosConfigurations.host`) — a change that breaks only one config will not show up in a single-config check.
- `users.users.<u>.gid` is NOT a valid option (user attrs: `uid`, `group`, ...). gid belongs on the group: `users.groups.<g>.gid`. Setting `gid` on a user fails the whole module eval.
- gids/uids eval as integers → plain `nix eval` (prints `1000`), NOT `--raw` (fails with "cannot coerce an integer to a string").
- Check both sides: `users.users.<u>.uid` + `users.users.<u>.group` and `users.groups.<g>.gid`.

Example verified loop (vm + host, 5 users):

```bash
for c in vm host; do for u in root nixos public private secret; do
  echo "$c $u uid=$(nix eval ".#nixosConfigurations.$c.config.users.users.$u.uid" 2>/dev/null | tail -1)"
done; done
```

## flake.lock hygiene

`nix eval` in a worktree auto-generates an untracked (sometimes empty) `flake.lock`. The tigor-no-ai repo does NOT track it. `rm flake.lock` after eval and check `git status --short` before committing — a stray flake.lock in the commit is a defect.

## Conventions (user's tigor-no-ai style)

- Users: explicit uid AND explicit `group` (own user group), gids explicit on `users.groups`. Layout used in flake.nix r74: root 0, nixos 1000, then public/private/secret at 2000/2001/2002 with matching gids.
- No AI-written comments in committed config files. Keep diffs minimal — only the hunk that changes behavior.

## Pitfalls

1. Don't `git add -A` in a worktree — untracked test files from the main clone session and auto-generated flake.lock will get swept in. Stage by name.
2. `nix eval` piped through `tail` can mask errors — read the output, not just the exit code.
3. PAT for PRs: `/home/nixos/.hermes/.env` from the SSH terminal (NOT `/opt/data/.env` — that path only exists in the container).
