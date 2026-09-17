#!/usr/bin/env bash
# Usage: ./deploy.sh [staging|prod|all]
#
# STRUCTURE (post-incident hardening — a "staging" deploy once leaked the
# page to prod because it rsync'd the whole tree into /opt/jev-chess/):
#   staging  -> writes ONLY /opt/jev-chess/staging/{proxy.py,Dockerfile,
#               docker-compose.yml,web} + the SHARED gateway Caddyfile
#               (/opt/jev-chess/Caddyfile, which defines both sites).
#               Never touches /opt/jev-chess/web, the prod proxy code, or the
#               prod proxy container.
#   prod     -> REFUSES unless I_UNDERSTAND_THIS_TOUCHES_PROD=1. Writes
#               /opt/jev-chess/{proxy.py,Dockerfile,docker-compose.yml,web},
#               the shared Caddyfile, and rebuilds the prod proxy.
#   all      -> staging, then prod (same guard).
#
# Non-disruptive: pages are bind mounts (no caddy restart to change a page);
# the proxy rebuilds with --no-deps (never touches caddy); caddy gets a
# graceful `reload` only when the Caddyfile content actually changed.
#
# Feature flags: rendered into the page at deploy time.
#   prod:    sudoku=${PROD_SUDOKU:-false}  games=${PROD_GAMES:-false}
#   staging: sudoku=${STAGING_SUDOKU:-true}  games=${STAGING_GAMES:-true}
# Promote a feature to prod: PROD_SUDOKU=true PROD_GAMES=true ./deploy.sh prod
set -euo pipefail
TARGET=${1:-all}
VPS=root@jev-chess.tgr.rs
SRC=$(cd "$(dirname "$0")" && pwd)

REV=$(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo unknown)
if git -C "$SRC" status --porcelain 2>/dev/null | grep -q .; then REV="${REV}-dirty"; fi

render_page() { # $1=dest  $2=sudoku-flag  $3=games-flag
  sed -e "s|<span id=\"rev\">—</span>|<span id=\"rev\">${REV}</span>|" \
      -e "s/__FEATURE_SUDOKU__/${2}/" \
      -e "s/__FEATURE_GAMES__/${3}/" "$SRC/index.html" > "$1"
  # When a feature is off for this env, strip its <option> from the served HTML
  # too (init() also removes it at runtime as defense-in-depth).
  if [ "$2" = "false" ]; then
    sed -i '/<option value="sudoku">/d' "$1"
  fi
  if [ "$3" = "false" ]; then
    sed -i '/data-games/d' "$1"
  fi
}

BEFORE=$(ssh "$VPS" "sha256sum /opt/jev-chess/Caddyfile 2>/dev/null | cut -d' ' -f1 || echo none")

deploy_staging() {
  # self-contained staging build context: staging/proxy.py + staging/Dockerfile
  # are copies of the canonical files (generated here, not committed).
  cp "$SRC/proxy.py" "$SRC/staging/proxy.py"
  cp "$SRC/Dockerfile" "$SRC/staging/Dockerfile"
  mkdir -p "$SRC/staging/web"
  render_page "$SRC/staging/web/index.html" "${STAGING_SUDOKU:-true}" "${STAGING_GAMES:-true}"
  if [ -d "$SRC/games" ]; then
    mkdir -p "$SRC/staging/web/games"
    cp -f "$SRC"/games/*.js "$SRC/staging/web/games/" 2>/dev/null || true
  fi
  rsync -az --delete \
    --exclude web --exclude proxy.py --exclude Dockerfile --exclude docker-compose.yml \
    "$SRC/staging/" "$VPS:/opt/jev-chess/staging/"   # Caddyfile reference copy
  rsync -az "$SRC/staging/proxy.py" "$SRC/staging/Dockerfile" "$SRC/staging/docker-compose.yml" \
    "$VPS:/opt/jev-chess/staging/"
  rsync -az --delete "$SRC/staging/web/" "$VPS:/opt/jev-chess/staging/web/"
  # shared gateway (single caddy for both sites)
  rsync -az "$SRC/Caddyfile" "$VPS:/opt/jev-chess/Caddyfile"
  ssh "$VPS" "cd /opt/jev-chess/staging && docker compose up -d --no-deps --build proxy"
}

deploy_prod() {
  : "${I_UNDERSTAND_THIS_TOUCHES_PROD:?deploy.sh: refusing to touch prod. Set I_UNDERSTAND_THIS_TOUCHES_PROD=1 to proceed.}"
  mkdir -p "$SRC/web"
  render_page "$SRC/web/index.html" "${PROD_SUDOKU:-false}" "${PROD_GAMES:-false}"
  if [ -d "$SRC/games" ]; then
    mkdir -p "$SRC/web/games"
    cp -f "$SRC"/games/*.js "$SRC/web/games/" 2>/dev/null || true
  fi
  rsync -az --delete "$SRC/web/" "$VPS:/opt/jev-chess/web/"
  rsync -az "$SRC/proxy.py" "$SRC/Dockerfile" "$SRC/docker-compose.yml" \
    "$VPS:/opt/jev-chess/"
  rsync -az "$SRC/Caddyfile" "$VPS:/opt/jev-chess/Caddyfile"
  ssh "$VPS" "cd /opt/jev-chess && docker compose up -d --no-deps --build proxy"
}

case "$TARGET" in
  staging) deploy_staging ;;
  prod)    deploy_prod ;;
  all)     deploy_staging; deploy_prod ;;
  *) echo "unknown target: $TARGET (use staging|prod|all)" >&2; exit 2 ;;
esac

# graceful caddy reload ONLY if the shared Caddyfile changed
AFTER=$(ssh "$VPS" "sha256sum /opt/jev-chess/Caddyfile | cut -d' ' -f1")
if [ "$BEFORE" != "$AFTER" ]; then
  echo "Caddyfile changed -> graceful reload (listeners stay up)"
  ssh "$VPS" 'cd /opt/jev-chess && docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile'
fi
echo "deployed: $TARGET"
