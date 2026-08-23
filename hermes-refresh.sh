#!/usr/bin/env bash
# Refresh Hermes git repos: clean clone + semantic remotes + preserve secrets
# Run on NixOS host as root/hermes user
set -Eeuo pipefail

GIT_DIR="$HOME/hermes-git"
TIMESTAMP="$(date +%Y-%m-%d_%H%M%S)"
BACKUP="$HOME/hermes-git.${TIMESTAMP}.bak"

echo "=== Hermes Refresh ==="
echo "Git dir:  $GIT_DIR"
echo "Backup:   $BACKUP"

# --- Stop Hermes ---
podman stop hermes 2>/dev/null || true
echo "✓ Hermes stopped"

# --- Move old dir to backup ---
if [ -d "$GIT_DIR" ]; then
    mv "$GIT_DIR" "$BACKUP"
    echo "✓ Old git dir moved to $BACKUP"
fi

# --- Fresh clones ---
mkdir -p "$GIT_DIR"
cd "$GIT_DIR"

git clone https://github.com/enovikov11/tigor-ai.git
git clone https://github.com/enovikov11/tigor-no-ai.git

mkdir -p tigor-ai.worktrees
mkdir -p tigor-no-ai.worktrees
echo "✓ Cloned repos, created worktrees dirs"

# --- Restore secrets from backup ---
if [ -d "$BACKUP" ]; then
    cp "$BACKUP/tigor-ai/.hermes/.env" "$GIT_DIR/tigor-ai/.hermes/" 2>/dev/null || true
    cp -a "$BACKUP/tigor-ai/.hermes/secrets/" "$GIT_DIR/tigor-ai/.hermes/" 2>/dev/null || true
    cp "$BACKUP/tigor-ai/.hermes/auth.json" "$GIT_DIR/tigor-ai/.hermes/" 2>/dev/null || true
    echo "✓ Secrets restored from $BACKUP"
fi

# --- tigor-ai remotes ---
cd "$GIT_DIR/tigor-ai"
git remote remove origin
git remote add forgejo-push-for-preview http://10.67.69.2:3000/hermes/tigor-ai.git
git remote add github-pull-and-push-to-main https://github.com/enovikov11/tigor-ai.git
echo "✓ tigor-ai remotes configured"

# --- tigor-no-ai remotes ---
cd "$GIT_DIR/tigor-no-ai"
git remote remove origin
git remote add github-pull https://github.com/enovikov11/tigor-no-ai.git
git remote add github-push-to-feature-branch https://github.com/enovikov11-ai-agent/tigor-no-ai.git
echo "✓ tigor-no-ai remotes configured"

# --- Start Hermes ---
podman start hermes
echo "✓ Hermes started"

echo "=== Done ==="
