#!/usr/bin/env bash
set -Eeuo pipefail

SECRETS_DIR="$HOME/hermes-secrets"

echo "=== Hermes Init ==="

# --- Clone repos ---
git clone https://github.com/enovikov11/tigor-ai.git
git clone https://github.com/enovikov11/tigor-no-ai.git

mkdir -p tigor-ai.worktrees tigor-no-ai.worktrees
echo "✓ Cloned repos"

# --- Setup remotes ---
cd tigor-ai
git remote remove origin
git remote add forgejo-push-for-preview http://10.67.69.2:3000/hermes/tigor-ai.git
git remote add github-pull-and-push-to-main https://github.com/enovikov11/tigor-ai.git
echo "✓ tigor-ai remotes"

cd ../tigor-no-ai
git remote remove origin
git remote add github-pull https://github.com/enovikov11/tigor-no-ai.git
git remote add github-push-to-feature-branch https://github.com/enovikov11-ai-agent/tigor-no-ai.git
echo "✓ tigor-no-ai remotes"

# --- Secrets ---
mkdir -p ../tigor-ai/.hermes
cp -a "$SECRETS_DIR"/. ../tigor-ai/.hermes/
echo "✓ Secrets copied"

# --- SSH config ---
ssh-keyscan host.containers.internal >> ~/.ssh/known_hosts 2>/dev/null || true
echo "✓ SSH known_hosts"

# --- Start services ---
cd ~/tigor-ai
docker compose up -d
echo "✓ Services started"

echo "=== Done ==="
