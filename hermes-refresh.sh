#!/usr/bin/env bash
set -Eeuo pipefail

GIT_DIR="$HOME/hermes-git"
SECRETS_DIR="$HOME/hermes-secrets"
TIMESTAMP="$(date +%Y-%m-%d_%H%M%S)"
BACKUP="$HOME/hermes-git.${TIMESTAMP}.bak"

echo "=== Hermes Refresh ==="
echo "Git dir:  $GIT_DIR"
echo "Backup:   $BACKUP"

podman stop hermes 2>/dev/null || true
echo "✓ Hermes stopped"

if [ -d "$GIT_DIR" ]; then
    mv "$GIT_DIR" "$BACKUP"
    echo "✓ Old git dir moved to $BACKUP"
fi

mkdir -p "$GIT_DIR"
echo "✓ New git dir created $GIT_DIR"

cd "$GIT_DIR"
git clone https://github.com/enovikov11/tigor-ai.git
cd "$GIT_DIR/tigor-ai"
git remote remove origin
git remote add forgejo-push-for-preview http://10.67.69.2:3000/hermes/tigor-ai.git
git remote add github-pull-and-push-to-main https://github.com/enovikov11/tigor-ai.git
echo "✓ tigor-ai configured"

cd "$GIT_DIR"
mkdir -p tigor-ai.worktrees
echo "✓ tigor-ai.worktrees configured"

cd "$GIT_DIR"
git clone https://github.com/enovikov11/tigor-no-ai.git
cd "$GIT_DIR/tigor-no-ai"
git remote remove origin
git remote add github-pull https://github.com/enovikov11/tigor-no-ai.git
git remote add github-push-to-feature-branch https://github.com/enovikov11-ai-agent/tigor-no-ai.git
echo "✓ tigor-no-ai configured"

cd "$GIT_DIR"
mkdir -p tigor-no-ai.worktrees
echo "✓ tigor-no-ai.worktrees configured"

mkdir -p "$GIT_DIR/tigor-ai/.hermes"
cp -a "$SECRETS_DIR"/. "$GIT_DIR/tigor-ai/.hermes/"
echo "✓ Secrets restored from $SECRETS_DIR"

podman start hermes
echo "✓ Hermes started"

echo "=== Done ==="
