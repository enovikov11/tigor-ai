#!/usr/bin/env bash
# Refresh Hermes git repos: clean clone + semantic remotes
# Run on NixOS host as root/hermes user
set -Eeuo pipefail

GIT_DIR="$HOME/hermes-git"
TIMESTAMP="$(date +%Y-%m-%d_%H%M%S)"
BACKUP="$HOME/hermes-git.${TIMESTAMP}.bak"
BACKUPS="$HOME/backups"

echo "=== Hermes Refresh ==="
echo "Git dir:  $GIT_DIR"
echo "Backup:   $BACKUP"

# --- Stop Hermes ---
podman stop hermes 2>/dev/null || true
echo "✓ Hermes stopped"

# --- Backup old git dir ---
if [ -d "$GIT_DIR" ]; then
    mv "$GIT_DIR" "$BACKUP"
    echo "✓ Old git dir backed up to $BACKUP"
fi

# --- Backup secrets (survive reinstall) ---
mkdir -p "$BACKUPS/hermes"
if [ -d "$BACKUP" ]; then
    cp -a "$BACKUP/tigor-ai/.hermes/.env" "$BACKUPS/hermes/" 2>/dev/null || true
    cp -a "$BACKUP/tigor-ai/.hermes/secrets/" "$BACKUPS/hermes/" 2>/dev/null || true
    cp -a "$BACKUP/tigor-ai/.hermes/auth.json" "$BACKUPS/hermes/" 2>/dev/null || true
    echo "✓ Secrets backed up to $BACKUPS/hermes/"
fi

# --- Fresh clones ---
mkdir -p "$GIT_DIR"
cd "$GIT_DIR"

git clone https://github.com/enovikov11/tigor-ai.git
git clone https://github.com/enovikov11/tigor-no-ai.git

mkdir -p tigor-ai.worktrees
mkdir -p tigor-no-ai.worktrees
echo "✓ Cloned repos, created worktrees dirs"

# --- Restore secrets ---
cp -a "$BACKUPS/hermes/.env" "$GIT_DIR/tigor-ai/.hermes/" 2>/dev/null || true
cp -a "$BACKUPS/hermes/secrets/" "$GIT_DIR/tigor-ai/.hermes/" 2>/dev/null || true
cp -a "$BACKUPS/hermes/auth.json" "$GIT_DIR/tigor-ai/.hermes/" 2>/dev/null || true
echo "✓ Secrets restored from $BACKUPS/hermes/"

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
