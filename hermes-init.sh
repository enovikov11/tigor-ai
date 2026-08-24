#!/usr/bin/env bash
set -Eeuo pipefail

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

cp -r ~/hermes-secrets/. ~/tigor-ai/.hermes/
chmod -R 777 ~/tigor-ai/.hermes/


