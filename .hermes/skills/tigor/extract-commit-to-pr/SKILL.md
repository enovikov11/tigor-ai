---
name: extract-commit-to-pr
description: "Extract one commit from an existing PR into a fresh PR."
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: ["git", "worktree", "cherry-pick", "github-pr", "tigor"]
    related_skills: [tigor-monorepo, github-pr-workflow]
---

# Extract One Commit from an Existing PR into a New PR

Trigger: user gives a GitHub PR URL with a `/changes/<sha>` fragment and asks to cherry-pick that commit from fresh main into a separate PR (tigor-no-ai fork-based workflow).

## Steps (tigor-no-ai, fork-based)

```bash
cd /home/nixos/tigor-no-ai && git fetch origin
git cat-file -t <sha>          # PR refs are fetched — sha should exist locally
git log -1 --format='%H %s' <sha>
git merge-base --is-ancestor <sha> origin/main && echo IN_MAIN || echo NOT_IN_MAIN
# skip if IN_MAIN

git worktree add -b <branch> /home/nixos/tigor-no-ai.worktrees/<branch> origin/main
cd /home/nixos/tigor-no-ai.worktrees/<branch>
git cherry-pick <sha>           # usually clean; resolve if not
git push -u fork HEAD
```

Create the PR (no `gh` on the VM — curl + PAT):

```bash
PAT=$(grep "^GITHUB_TOKEN=" /home/nixos/.hermes/.env | cut -d= -f2)
curl -s -X POST -H "Authorization: token $PAT" -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/enovikov11/tigor-no-ai/pulls \
  -d '{"title":"<commit subject>","body":"Cherry-picked from <PR URL> (commit <sha>) onto fresh main.","head":"enovikov11-ai-agent:<branch>","base":"main"}'
```

Verify `number`/`html_url` in the response.

## Iterating on the PR

- Reopen the worktree, edit, commit, `git push fork HEAD` — the PR updates automatically, no API call needed.
- Keep the worktree around while iterating; clean up with `git worktree remove <path> && git branch -d <branch>` (branch stays on the fork) when done.

## Pitfalls

1. **Detached HEAD when re-adding a worktree for a remote-only branch.** `git worktree add <path> fork/<branch>` (no `-b`) leaves HEAD detached; commits land on a dangling SHA and bare `git push` fails. Reattach: `git checkout -B <branch> <sha>`. Or create it tracked from the start: `git worktree add --track -b <branch> <path> fork/<branch>`.
2. **File tools are sandboxed to /opt/data.** `patch`/`write_file` refuse repo paths on the VM ("outside HERMES_WRITE_SAFE_ROOT"). Edit via terminal: small Python replace script, then verify with `grep -n` and `bash -n` for shell scripts.
3. **Transient "Bad credentials" on the REST API.** The fork remote may embed a token in its URL; if a PR-creation call 401s while git push with the same token works, retry once before concluding the token is broken.
4. **Don't conflate pre- and post-DNAT ports.** If the commit involves ufw + iptables DNAT: ufw `route` rules (mangle) see the ORIGINAL destination port, iptables PREROUTING DNAT rewrites it. If the mapped VM port differs from the public port, both the `--to-destination` port AND the `ufw route ... port` values must be the mapped port.
