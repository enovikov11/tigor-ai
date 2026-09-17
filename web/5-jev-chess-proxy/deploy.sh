#!/usr/bin/env bash
# Usage: ./deploy.sh [prod|staging|all]
#
# NON-DISRUPTIVE by design:
#   - caddy is NEVER `up`/recreated here (that would drop the shared gateway).
#     It only receives `docker compose pull`-free graceful `reload`, and only
#     if the Caddyfile actually changed on the VPS.
#   - the proxy is rebuilt with --no-deps (never touches caddy).
#   - the page is a bind mount; new file content needs no restart, but the
#     bind mount keeps the old INODE after rsync-replaces, so caddy reloads
#     its file handle only when content changed.
set -euo pipefail
TARGET=${1:-all}
VPS=root@jev-chess.tgr.rs
SRC=$(cd "$(dirname "$0")" && pwd)

mkdir -p "$SRC/web" "$SRC/staging/web"
BEFORE=$(ssh "$VPS" "sha256sum /opt/jev-chess/Caddyfile 2>/dev/null | cut -d' ' -f1 || echo none")

rsync -az --delete --exclude .env --exclude .git --exclude __pycache__ \
  --exclude 'web' --exclude 'staging/web' "$SRC/" "$VPS:/opt/jev-chess/"
# inject the deploy rev into the served page copies
REV=$(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo unknown)
if git -C "$SRC" status --porcelain 2>/dev/null | grep -q .; then REV="${REV}-dirty"; fi
sed "s|<span id=\"rev\">—</span>|<span id=\"rev\">${REV}</span>|" "$SRC/index.html" > "$SRC/web/index.html"
sed "s|<span id=\"rev\">—</span>|<span id=\"rev\">${REV}</span>|" "$SRC/index.html" > "$SRC/staging/web/index.html"
rsync -az --delete "$SRC/web/" "$VPS:/opt/jev-chess/web/"
rsync -az --delete "$SRC/staging/web/" "$VPS:/opt/jev-chess/staging/web/"

# did the Caddyfile change on the VPS? (BEFORE was read before rsync)
AFTER=$(ssh "$VPS" "sha256sum /opt/jev-chess/Caddyfile | cut -d' ' -f1")

case "$TARGET" in
  prod)    REMOTE='cd /opt/jev-chess && docker compose up -d --no-deps --build proxy' ;;
  staging) REMOTE='cd /opt/jev-chess/staging && docker compose up -d --no-deps --build proxy' ;;
  all)     REMOTE='cd /opt/jev-chess && docker compose up -d --no-deps --build proxy && cd /opt/jev-chess/staging && docker compose up -d --no-deps --build proxy' ;;
  *) echo "unknown target: $TARGET" >&2; exit 2 ;;
esac
ssh "$VPS" "set -e; $REMOTE"

# graceful caddy reload ONLY if the Caddyfile changed (reload keeps existing
# listeners open; it does not stop the container, so prod stays up)
if [ "$BEFORE" != "$AFTER" ]; then
  echo "Caddyfile changed -> graceful reload"
  ssh "$VPS" 'cd /opt/jev-chess && docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile'
fi
echo "deployed: $TARGET"
