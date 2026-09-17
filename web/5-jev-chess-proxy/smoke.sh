#!/usr/bin/env bash
# Usage: ./smoke.sh [prod|staging|all]
# End-to-end smoke test from the VM.
set -uo pipefail
TARGET=${1:-all}
PASS=0; FAIL=0
chk() { # name expected actual
  if [ "$2" = "$3" ]; then echo "PASS  $1 ($3)"; PASS=$((PASS+1));
  else echo "FAIL  $1 (want $2, got $3)"; FAIL=$((FAIL+1)); fi
}
# chess request body (valid shape -> 200; also exercises rate limit timing)
REQ=$(cat <<'JSON'
{"model":"jev-latest","state":{"game":"standard chess","side_to_move":"white","fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1","board_ascii":"| w |","pgn":"","move_number":1},"questions":{"move":{"type":"choice","instructions":"pick strongest","criteria":{"e2e4":{"san":"e4","from":"e2","to":"e4","piece":"p","captured":null,"promotion":null,"is_capture":false,"is_check":false,"is_checkmate":false,"is_castle":false},"g1f3":{"san":"Nf3","from":"g1","to":"f3","piece":"n","captured":null,"promotion":null,"is_capture":false,"is_check":false,"is_checkmate":false,"is_castle":false}}}}}
JSON
)
test_env() { # name base_url [extra curl args...]
  local name=$1 url=$2; shift 2
  echo "=== $name ($url) ==="
  chk "$name page"        200 "$(curl -s "$@" -o /dev/null -w "%{http_code}" "$url/")"
  chk "$name proxy.py"    404 "$(curl -s "$@" -o /dev/null -w "%{http_code}" "$url/proxy.py")"
  chk "$name .env"        404 "$(curl -s "$@" -o /dev/null -w "%{http_code}" "$url/.env")"
  sleep 1.1
  chk "$name non-chess"   400 "$(curl -s "$@" -o /dev/null -w "%{http_code}" -X POST "$url/v1/systemone" -H "Content-Type: application/json" -d '{"state":"hi"}')"
  sleep 1.1
  local code; code=$(curl -s "$@" -o /tmp/smoke-ai.json -w "%{http_code}" -X POST "$url/v1/systemone" -H "Content-Type: application/json" --data "$REQ")
  chk "$name ai 200"      200 "$code"
  if grep -q '"choice"' /tmp/smoke-ai.json 2>/dev/null; then
    echo "PASS  $name ai response has choice: $(grep -oE '"choice":"[a-z0-9]+"' /tmp/smoke-ai.json | head -1)"
    PASS=$((PASS+1))
  else
    echo "FAIL  $name ai response missing choice: $(head -c 200 /tmp/smoke-ai.json)"; FAIL=$((FAIL+1))
  fi
}
[ "$TARGET" = "prod" ] || [ "$TARGET" = "all" ]  && test_env prod  https://jev-chess.tgr.rs
[ "$TARGET" = "staging" ] || [ "$TARGET" = "all" ] && test_env staging https://jev-chess-staging.tgr.rs
echo "=== $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
