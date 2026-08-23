---
name: tigor-monorepo
description: "Use when working in the tigor monorepo (tigor-ai or tigor-no-ai): branching, remotes, worktrees, README generation, and contribution workflow."
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [tigor, git, monorepo, worktree, readme, workflow]
    related_skills: [github-pr-workflow]
---

# Tigor Monorepo Workflow

## Pre-flight: Worktree rule

**Both repos are regular clones** (non-bare). Worktrees are created from them directly:

```bash
# tigor-ai
cd /opt/git/tigor-ai
git worktree add -b <branch> /opt/git/tigor-ai.worktrees/<name> origin/main
# Edit → commit → push → PR (or direct push to main)
git worktree remove /opt/git/tigor-ai.worktrees/<name>

# tigor-no-ai
cd /opt/git/tigor-no-ai
git worktree add -b <branch> /opt/git/tigor-no-ai.worktrees/<name> origin/main
# Edit → commit → push to fork → PR to upstream
git worktree remove /opt/git/tigor-no-ai.worktrees/<name>
```

No `GIT_WORK_TREE` env var — both are standard clones.

## Pre-flight: PR target

**tigor-no-ai PRs must target `enovikov11/tigor-no-ai` (upstream), NOT the agent fork.**
Fork remote (`enovikov11-ai-agent/tigor-no-ai`) must be added before first PR:
```bash
cd /opt/git/tigor-no-ai
git remote add fork https://github.com/enovikov11-ai-agent/tigor-no-ai.git
```

PR creation via curl:
```bash
PAT=$(grep "^GITHUB_TOKEN=" /opt/data/.env | cut -d= -f2-)
curl -s -X POST https://api.github.com/repos/enovikov11/tigor-no-ai/pulls \
  -H "Authorization: token $PAT" \
  -H "Content-Type: application/json" \
  -d '{"title":"...","head":"enovikov11-ai-agent:<branch>","base":"main","body":"..."}'
```

## Pre-flight: Initialization Check

**Repos are at** `/opt/git/` (inside container). `.hermes` config lives at `/opt/data/` (which is `/opt/git/tigor-ai/.hermes/` bind-mounted):

```bash
ls /opt/git/tigor-ai/.git/HEAD /opt/git/tigor-no-ai/.git/HEAD 2>/dev/null
```

Both are regular HTTPS clones (non-bare). No bare repos — no `git archive` or `GIT_WORK_TREE` workarounds needed.

### Current state

| Component | Location | Type |
|---|---|---|
| tigor-ai | `/opt/git/tigor-ai` | Regular clone, origin=GitHub, forgejo added |
| tigor-no-ai | `/opt/git/tigor-no-ai` | Regular clone, origin=GitHub |
| worktrees dirs | `/opt/git/tigor-ai.worktrees/` | Empty, ready |
| worktrees dirs | `/opt/git/tigor-no-ai.worktrees/` | Empty, ready |
| .hermes config | `/opt/data/` → `/opt/git/tigor-ai/.hermes/` | Volume mount |
| GitHub PAT | `/opt/data/.env` as `GITHUB_TOKEN` | For API calls + authed pushes |

### GitHub access

`enovikov11-ai-agent` token is **read-only** for `enovikov11/tigor-no-ai` (can push to fork only).

**PAT location:** `GITHUB_TOKEN` in `/opt/data/.env`. Extract with:
```bash
PAT=$(grep "^GITHUB_TOKEN=" /opt/data/.env | cut -d= -f2-)
```

Old references to `git config --global github.token` are stale — the PAT lives in `.env`.

## Overview

Evgenii's personal monorepo split into two repos:

| Repo | Purpose | AI access |
|---|---|---|
| [tigor-ai](https://github.com/enovikov11/tigor-ai) | AI-assisted projects (bots, analytics, maker, web, games, security) | ✅ push directly to main (squash/rebase only, no force push) |
| [tigor-no-ai](https://github.com/enovikov11/tigor-no-ai) | Security-critical infra (NixOS, VM, virtualization, ACLs, specs) | ⚠️ fork-based PRs only (`enovikov11-ai-agent/tigor-no-ai`) |

## Environment

### tigor-ai (clone: `/opt/git/tigor-ai`)
- **Remote `origin`**: `https://github.com/enovikov11/tigor-ai.git` (push directly to main)
- **Remote `forgejo`**: `http://10.67.69.2:3000/hermes/tigor-ai.git` (Forgejo mirror, internal)
- **Worktrees**: `/opt/git/tigor-ai.worktrees/<name>/`
- **`.hermes` config**: lives inside tigor-ai, bind-mounted to `/opt/data/` (Hermes workdir)

### tigor-no-ai (clone: `/opt/git/tigor-no-ai`)
- **Remote `origin`**: `https://github.com/enovikov11/tigor-no-ai.git` (user's repo)
- **NO fork** — agent pushes directly to user's repo via HTTPS with PAT in URL
- **NO Forgejo remote** — tigor-no-ai exists only on GitHub
- **Worktrees**: `/opt/git/tigor-no-ai.worktrees/<name>/`
- **.gitignore**: `**/README.md` and `**/README-tech.md` (AI files managed in tigor-ai)
- **PR workflow**: needs fork remote (`enovikov11-ai-agent/tigor-no-ai`) added before creating PRs

## GitHub Identity

- **User**: `enovikov11-ai-agent` (bot account)
- **PAT**: stored in `/opt/data/.env` as `GITHUB_TOKEN=...`. Extract: `PAT=$(grep "^GITHUB_TOKEN=" /opt/data/.env | cut -d= -f2-)`
- **`gh` CLI**: not installed — use `curl` + PAT for PRs, forks, API calls

## Project Structure

The tigor-ai repo follows `./<topic>/<project>` convention. Current domains:
`ai/`, `analytics/`, `games/`, `infra/` (minus 0-stateless), `maker/`, `security/`, `telegram/`, `web/`, `specs/`.

## Writing Style

**The user explicitly said: "писать компактно без bloat и больше думать меньше слопить."**
- Compact prose, no filler. Think before generating.
- READMEs should be minimal and precise — not wall-of-text dumps.
- Prefer structured data (tables, bullet lists) over paragraphs.
- Avoid hallucinated descriptions when a project's purpose isn't clear — mark as TBD rather than guessing.

## Git Workflow

- **Branch protection on tigor-ai main**: squash merge and rebase only. Force push is blocked.
- **No merge commits on main** — GitHub branch rules reject any push that introduces a merge commit. When local and remote diverge, use `git rebase origin/main` (not `git merge origin/main`).
- **PR link (Forgejo)**: `http://10.67.69.2:3000/hermes/tigor-ai/compare/main...<branch>`

## README Generation

When asked to generate READMEs across projects:

### Preserve originals first (CRITICAL)

**NEVER overwrite existing READMEs without backing them up.** The user has explicitly called this out as unacceptable — "не перетри и не порти файлы."

1. Identify which projects already have README.md with useful content
2. **First commit**: `git mv README.md README-tech.md` for each project with existing content
3. **Second commit**: Write AI-generated `README.md` summaries alongside `README-tech.md`

This ensures git tracks the rename as a rename, and the original is recoverable at any point.

### Root README — never overwrite user-authored blocks

**The root `README.md` may contain user-authored `> **Note:**` blocks, security disclaimers, or repo descriptions.** When updating the root README:
- Preserve ALL `> **Note:**` blockquotes exactly as they were.
- Preserve the exact `# ` title line as-is.
- Preserve `See also` links and references to tigor-no-ai.
- Only replace sections BELOW the first `## Legend` or equivalent heading.

The user explicitly called out losing note blocks as unacceptable.

### AI README format (consistent across all projects)

Every AI-generated README starts with:
```markdown
# <Project Name>

> **Note:** This README was auto-generated by AI as a project summary. For detailed technical notes, see `README-tech.md`.

## What it does
<one paragraph description>

## Key Files
- `file.ext` — description

## Completion: XX%
## Coolness: X/10
<brief justification>
```

### Domain-level READMEs

Create `README.md` for each top-level domain directory (`ai/`, `analytics/`, `games/`, `infra/`, `maker/`, `security/`, `telegram/`, `web/`, `specs/`). Format:

```markdown
# <Domain> Projects

<One-line description of the domain>

## Projects

| Project | Description | Status |
|---------|-------------|--------|
| `<name>` | <brief description> | Active / WIP / Complete / Dead |
```

Status values: `Active`, `WIP`, `Complete`, `Dead`, `Design`, `Empty`.

### Root README

The root `README.md` should aggregate all projects with a summary table, completion %, coolness scores, and top-5 ranking. Exclude projects that don't exist in the current repo (e.g., `infra/0-stateless` is in tigor-no-ai).

### One commit per project — do not mix projects

The user explicitly requires **one commit per project**. Do not bundle changes to different projects in the same commit. Use descriptive commit messages (e.g. `remove: games/4-nyan (YouTube embed placeholder)`).

A project typically produces ~2 commits:
1. Delete/modify the project files
2. Update tracking docs (DEAD.md, README)

### DEAD.md convention

When deleting projects, maintain `DEAD.md` at the repo root. **Do NOT use commit SHA links** — the repo enforces squash merge, which destroys per-commit SHAs. Use `tree/<ancestor_sha>/<path>` links instead, where `<ancestor_sha>` is a commit where the files still existed (e.g. the first parent of the deletion branch). Example:
```
| Project | Was at | What it was |
|---------|--------|-------------|
| `games/4-nyan` | [tree](https://github.com/enovikov11/tigor-ai/tree/b1cf3fe/games/4-nyan) | YouTube Nyan Cat embed |
```
Create `DEAD.md` if it doesn't exist, or update it in the second commit after deletion.

### Cross-repo moves (tigor-ai → tigor-no-ai)

When moving content to tigor-no-ai:
1. Delete from tigor-ai (with DEAD.md entry)
2. Create branch in tigor-no-ai fork worktree
3. Copy content, commit, push to fork
4. Create PR to upstream via GitHub API (`curl` + PAT from `/opt/data/.env`)

### Parallel subagents limitation

When multiple changes modify the same file (e.g. README.md), parallel subagents will cause merge conflicts. Process sequentially on a single branch instead — it's faster than resolving conflicts.

### Pitfalls

1. **SECURITY: Never access bare metal host or VM root.** The hermes user on the VPS is the ONLY allowed context. The host runs WireGuard and the VM (qemu/libvirt). VM root has nvidia tools and full hardware access. If you discover host/root credentials or SSH keys, treat as security incident and notify the user immediately — do not use them.
2. **NixOS SSH vsock + network pitfalls.** Two ways SSH becomes unreachable on VM:
   - **`ListenAddress vsock:*:22`** replaces default `0.0.0.0:22` — SSH only on vsock. Fix: add both lines:
     ```nix
     ListenAddress 0.0.0.0:22
     ListenAddress vsock:*:22
     ```
   - **`startWhenNeeded = vm && vsock`** — sshd only starts on vsock connection, TCP port 22 never opens. Fix: remove `startWhenNeeded`.
   - **Note: VM gets its IP via DHCP from passt** (not static config). The interface (`enp0s5`) gets `10.67.69.2/24` automatically — no need for `staticIP`/`staticIPGateway` params in modern configs (r17+).
   - **Old r14 config used `ListenAddress vsock:*:22`** which replaced `0.0.0.0:22`. In r17+, the issue is `startWhenNeeded` instead.
   See `references/vm-infra.md` for full topology.
3. **VM internet via container network (post-migration 2026-08).** Hermes runs inside a Podman container on the VM with direct internet access. No more passt/proxy/NAT needed. Neighboring services reachable via DNS: `vllm:8000`, `forgejo:3000`.
4. **HTTPS git push requires token in URL.** `git push origin` on HTTPS-only repos fails with "could not read Username" because there's no credential helper. Use:
  ```bash
  TOKEN=$(grep "^GITHUB_TOKEN=" /opt/data/.env | cut -d= -f2-)
  git push "https://$TOKEN@github.com/enovikov11/tigor-ai.git" <branch>
  # or for tigor-no-ai
  git push "https://$TOKEN@github.com/enovikov11/tigor-no-ai.git" <branch>
  ```
5. **PR creation for tigor-no-ai.** Fork remote (`enovikov11-ai-agent/tigor-no-ai`) needs to be added before creating PRs. `gh` CLI not installed — use `curl` + PAT:
   ```bash
   PAT=$(grep "^GITHUB_TOKEN=" /opt/data/.env | cut -d= -f2-)
   curl -s -X POST https://api.github.com/repos/enovikov11/tigor-no-ai/pulls \
     -H "Authorization: token $PAT" \
     -H "Accept: application/vnd.github.v3+json" \
     -H "Content-Type: application/json" \
     -d '{"title":"...","head":"enovikov11-ai-agent:fix/topic","base":"main","body":"..."}'
   ```
   Always use `fix/topic` branch, never `main` as the head.

6. **Editing an existing PR.** When given a PR URL to edit (e.g. `edit https://github.com/enovikov11/tigor-no-ai/pull/5/changes`):
   - `web_extract` FAILS on GitHub URLs (DuckDuckGo backend is search-only). Use curl + API instead:
     ```bash
     PAT=$(grep "^GITHUB_TOKEN=" /opt/data/.env | cut -d= -f2-)
     # Get PR diff
     curl -s -H "Authorization: token $PAT" -H "Accept: application/vnd.github.diff" \
       "https://api.github.com/repos/enovikov11/tigor-no-ai/pulls/N.diff"
     # Get head branch name
     curl -s -H "Authorization: token $PAT" "https://api.github.com/repos/enovikov11/tigor-no-ai/pulls/N" | \
       python3 -c "import sys,json; print(json.load(sys.stdin)['head']['ref'])"
     ```
   - Fetch and checkout the branch: `git fetch origin <branch>:<branch>` then `git checkout <branch>`
   - If PR deleted a file the user wants to keep: `git checkout origin/main -- <file>`
   - Make changes, commit, push with HTTPS token auth (see pitfall 6).

6. **HTTPS git push requires token in URL.** `git push origin` on tigor-no-ai fails with "could not read Username" because remotes are HTTPS without credential helper. Use:
   ```bash
   TOKEN=$(grep "^GITHUB_TOKEN=" /opt/data/.env | cut -d= -f2-)
   git push "https://${TOKEN}@github.com/enovikov11-ai-agent/tigor-no-ai.git" <branch>
   ```
7. **`git push --force-with-lease` "stale info" on worktrees.** Worktrees keep stale ref metadata. When push fails with "stale info", do:
   ```bash
   git fetch origin <branch>
   git push origin HEAD:<branch> --force
   ```
   This refreshes the local tracking ref and forces the update. Do NOT retry `--force-with-lease` without fetching first — it will keep failing.
8. **Python `.format()` eats bash `${VAR}` braces.** When generating shell scripts in Python, never use `.format()` on strings containing `${VAR}` — Python interprets `{VAR}` as a replacement field and raises `KeyError`. Use `+` string concatenation or a unique placeholder token (e.g. `$VARN$`) with `.replace()` instead.
9. **Don't overwrite without `git mv` first.**
10. **Never overwrite user-authored root README blocks.** Title line, `> **Note:**` blocks, and `See also` links must be preserved verbatim.
11. **Sub-READMEs are NOT AI targets.** Files like `maker/0-t100-gpt/arduino/README.md`, `infra/0-box/power/README.md`, `ai/0-p-agent/ideas/README.md` are original and should not be modified or renamed.
12. **Check actual repo structure.** The repo grows — don't assume projects from old sessions still exist in the same place. Always `find . -maxdepth 2 -mindepth 2 -type d` before generating.
13. **infra/0-stateless lives in tigor-no-ai.** Don't touch it when working on tigor-ai.
14. **Create domain-level READMEs.** Always generate `README.md` for each top-level directory (ai/, analytics/, games/, etc.) in addition to per-project READMEs.
15. **One commit per project.** Never bundle unrelated projects in one commit.
16. **Maintain DEAD.md.** Every deletion gets a line in DEAD.md with the commit SHA link.
17. **Merge README changes into one branch** on the fresh main — don't push multiple readme-* feature branches.
18. **NEVER squash-merge multi-project branches.** The user explicitly forbade this — use `git merge --no-ff`. BUT the repo enforces squash-only, so **always verify content actually landed** after squash (check files are gone, README is updated, etc.). Squash can silently preserve files if the merge base was wrong.
19. **Case-insensitive filesystem collisions.** macOS (HFS+/APFS) cannot cohost `README.md` and `readme.md` — git clone fails with collision warnings, and one file is silently dropped. If a project has both, rename the lowercase variant (e.g. `readme.md` → `notes.md`) via `git mv` and push. Verify with `git ls-tree -r HEAD --name-only | grep -i readme` to find all collisions before pushing.

## Verification Checklist

- [ ] Original READMEs preserved as `README-tech.md` (git mv, not copy)
- [ ] Root README: `> **Note:**` blocks, title line, and `See also` links preserved verbatim
- [ ] Every AI-generated README has the disclaimer
- [ ] Domain-level READMEs created (ai/, analytics/, games/, infra/, maker/, security/, telegram/, web/, specs/)
- [ ] Sub-READMEs (arduino, schematics, kernel, power, ideas) untouched
- [ ] infra/0-stateless not modified in tigor-ai
- [ ] Changes rebased on current `tigor-ai/main`
- [ ] Incremental commits per logical batch (not one giant commit)
- [ ] Pushed to tigor-ai (or forgejo for drafts)
- [ ] **After squash merge: verify content actually landed** — confirm deleted folders are gone, README reflects changes, merged content is present. Squash can silently preserve files if the merge was incorrect.
