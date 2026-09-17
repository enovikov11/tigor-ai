#!/usr/bin/env python3
"""Jev Chess proxy: fronts api.typesafe.ai/v1/systemone for jev-chess.tgr.rs.

- The TypeSafe key comes from env (TYPESAFE_API_KEY); the client sends none.
- Requests are validated as app game requests: a POST whose JSON body has a
  model field, a questions.move choice question (1..255 ASCII-token criteria
  keys with dict values), and a state object naming a known game. Per-game
  checks:
    * "standard chess" — FEN placement shape + LAN-shaped criteria keys;
    * "sudoku" — 81-cell grid of 0-9 with no conflicts among givens, and every
      criteria key r<c1-9>c<c1-9>d<1-9> must target an empty cell with a
      non-conflicting digit;
    * the module games (connect4, othello, uttt, hex, dots, battleship) —
      must carry a grid/board array.
  Anything else (arbitrary prompts, chat, unknown games) is rejected with 400.
  This is an anti-abuse filter, not a strict validator: it keeps the app
  working while making the endpoint useless as a free LLM API.
- Per-IP limits: 1 req/s, 1000/hour, 5000/day.

Spoof-proof client IP: the proxy only listens on the Caddy gateway network
(docker-compose joins it; no published port). We trust the X-Real-IP header
ONLY when the TCP peer is inside GATEWAY_SUBNET (the Caddy network). Caddy
sets X-Real-IP from {remote_host} (the true client) and overwrites any
client-supplied value, so a direct client can neither reach us nor fake the
peer address; anything else falls back to the TCP peer itself.

Stdlib only. Crash-fast if TYPESAFE_API_KEY is missing.
"""
import http.server
import ipaddress
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request

UPSTREAM = os.environ.get("UPSTREAM", "https://api.typesafe.ai/v1/systemone")
LISTEN_PORT = int(os.environ.get("PORT", "8443"))
UPSTREAM_TIMEOUT = int(os.environ.get("UPSTREAM_TIMEOUT", "45"))
GATEWAY_SUBNET = ipaddress.ip_network(os.environ.get("GATEWAY_SUBNET", "10.89.0.0/24"))

LIMIT_PER_SEC = int(os.environ.get("LIMIT_PER_SEC", "1"))
LIMIT_PER_HOUR = int(os.environ.get("LIMIT_PER_HOUR", "1000"))
LIMIT_PER_DAY = int(os.environ.get("LIMIT_PER_DAY", "5000"))
MAX_BODY = 1_000_000  # bytes; a full 20-option chess request is ~30 KB

# --- app-game validation (anti-abuse; skews to allowing within a game) --------
LAN = re.compile(r"^[a-h][1-8][a-h][1-8][qrbn]?$")  # e2e4, g1f3, e7e8q
FEN_PLACEMENT = re.compile(r"^([pnbqkrPNBQKR1-8]{1,8}/){7}[pnbqkrPNBQKR1-8]{1,8}$")
PIECE_TYPES = {"p", "n", "b", "r", "q", "k"}
CRIT_KEY = re.compile(r"^[A-Za-z0-9_.-]{1,32}$")
SD_CELL = re.compile(r"^r([1-9])c([1-9])d([1-9])$")
# Games the app may play; anything else is rejected (new games added here).
KNOWN_GAMES = {
    "standard chess",
    "sudoku",
    "connect4", "othello", "uttt", "hex", "dots", "battleship",
}


def _sd_grid_conflict(grid, idx, d):
    r, c = divmod(idx, 9)
    for j in range(9):
        if j != c and grid[r * 9 + j] == d:   # same row, different column
            return True
        if j != r and grid[j * 9 + c] == d:   # same column, different row
            return True
    br, bc = (r // 3) * 3, (c // 3) * 3
    for j in range(9):
        if (br + j // 3) * 9 + (bc + j % 3) != idx and grid[(br + j // 3) * 9 + (bc + j % 3)] == d:
            return True
    return False


def _looks_like_sudoku(state, criteria) -> bool:
    grid = state.get("grid")
    if not isinstance(grid, list) or len(grid) != 81:
        return False
    for i, v in enumerate(grid):
        if not isinstance(v, int) or not 0 <= v <= 9:
            return False
        if v and _sd_grid_conflict(grid, i, v):  # conflicting givens
            return False
    for key in criteria:
        m = SD_CELL.match(key)
        if not m:
            return False
        r, c, d = (int(m.group(1)) - 1, int(m.group(2)) - 1, int(m.group(3)))
        idx = r * 9 + c
        if grid[idx] != 0 or _sd_grid_conflict(grid, idx, d):
            return False
    return True


def looks_like_app_game(body: bytes) -> bool:
    try:
        doc = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        return False
    if not isinstance(doc, dict):
        return False
    if not isinstance(doc.get("model"), str) or not doc.get("model"):
        return False
    questions = doc.get("questions")
    move = questions.get("move") if isinstance(questions, dict) else None
    if not isinstance(move, dict):
        return False
    if move.get("type") not in (None, "choice"):
        return False
    criteria = move.get("criteria")
    if not isinstance(criteria, dict) or not (1 <= len(criteria) <= 255):
        return False
    for key, val in criteria.items():
        if not isinstance(key, str) or not CRIT_KEY.match(key) or not isinstance(val, dict):
            return False
    state = doc.get("state")
    if isinstance(state, str) and state.lstrip().startswith("{"):
        try:
            state = json.loads(state)
        except ValueError:
            return False
    if not isinstance(state, dict):
        return False
    game = state.get("game")
    if game not in KNOWN_GAMES:
        return False
    if game == "sudoku":
        return _looks_like_sudoku(state, criteria)
    if game == "standard chess":
        for key in criteria:
            if not LAN.match(key):
                return False
        fen = state.get("fen")
        if isinstance(fen, str) and not FEN_PLACEMENT.match(fen.split(" ", 1)[0]):
            return False
        for val in criteria.values():
            piece = val.get("piece")
            if piece is not None and piece not in PIECE_TYPES:
                return False
        return True
    # module games: require a serializable grid/board array
    if not isinstance(state.get("grid", state.get("board")), list):
        return False
    return True


# --- per-IP sliding-window limits --------------------------------------------
class Limiters:
    def __init__(self):
        self._lock = threading.Lock()
        self._hits = {}  # ip -> [monotonic timestamps]

    def check(self, ip: str):
        """Returns (allowed, retry_after_seconds)."""
        now = time.monotonic()
        with self._lock:
            ts = self._hits.get(ip)
            if ts:
                ts = [t for t in ts if t > now - 86400.0]
                if ts:
                    self._hits[ip] = ts
                else:
                    self._hits.pop(ip, None)
            ts = self._hits.get(ip)
            if ts is None:
                ts = []
                self._hits[ip] = ts
            n_sec = sum(1 for t in ts if t > now - 1.0)
            n_hour = sum(1 for t in ts if t > now - 3600.0)
            n_day = len(ts)
            if n_sec >= LIMIT_PER_SEC:
                oldest = min(t for t in ts if t > now - 1.0)
                return False, max(0.0, oldest + 1.0 - now)
            if n_hour >= LIMIT_PER_HOUR:
                oldest = min(t for t in ts if t > now - 3600.0)
                return False, max(1.0, oldest + 3600.0 - now)
            if n_day >= LIMIT_PER_DAY:
                oldest = min(ts)
                return False, max(1.0, oldest + 86400.0 - now)
            # opportunistic global sweep of long-idle IPs
            if len(self._hits) > 4096:
                for i in [i for i, t in self._hits.items() if not t or now - t[-1] > 86400.0]:
                    self._hits.pop(i, None)
            ts.append(now)
            return True, 0.0


_limiters = Limiters()


# --- HTTP server ---------------------------------------------------------------
class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "jev-chess-proxy/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass  # keep stdout quiet

    # -- helpers --
    def _client_ip(self):
        peer = self.client_address[0]
        try:
            if ipaddress.ip_address(peer) in GATEWAY_SUBNET:
                real = (self.headers.get("X-Real-IP") or "").strip()
                if real:
                    ipaddress.ip_address(real)  # must parse or we fall back
                    return real
        except ValueError:
            pass
        return peer

    def _send_json(self, code, obj, extra=None):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    # -- routes --
    def do_POST(self):
        if self.path != "/v1/systemone":
            self._send_json(404, {"error": {"message": "not found"}})
            return
        ip = self._client_ip()
        allowed, wait = _limiters.check(ip)
        if not allowed:
            retry = max(1, int(wait) + 1)
            self._send_json(429, {
                "error": {
                    "message": "rate limit exceeded "
                               "(%d rps, %d/hour, %d/day); retry in %ds"
                               % (LIMIT_PER_SEC, LIMIT_PER_HOUR, LIMIT_PER_DAY, retry)
                }
            }, {"Retry-After": str(retry)})
            return
        length = self.headers.get("Content-Length")
        try:
            length = int(length)
        except (TypeError, ValueError):
            self._send_json(400, {"error": {"message": "missing Content-Length"}})
            return
        if length <= 0 or length > MAX_BODY:
            self._send_json(400, {"error": {"message": "bad or oversized body"}})
            return
        body = self.rfile.read(length)
        if not looks_like_app_game(body):
            self._send_json(400, {
                "error": {"message": "request does not look like a Jev game "
                                     "request (need model, questions.move choice "
                                     "with <=255 criteria, and a known game state)"}
            })
            return

        api_key = self.server.api_key
        req = urllib.request.Request(
            UPSTREAM,
            data=body,
            method="POST",
            headers={
                "Authorization": "Bearer " + api_key,
                "Content-Type": "application/json",
                "User-Agent": "jev-chess-proxy/1.0",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=UPSTREAM_TIMEOUT) as up:
                status, headers, resp_body = up.status, up.headers, up.read()
        except urllib.error.HTTPError as e:
            status, headers, resp_body = e.code, e.headers, e.read()
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            self._send_json(502, {"error": {"message": "upstream unreachable: %s" % type(e).__name__}})
            return

        self.send_response(status)
        self.send_header("Content-Type", headers.get("Content-Type", "application/json"))
        self.send_header("Content-Length", str(len(resp_body)))
        retry_after = headers.get("Retry-After")
        if retry_after:
            self.send_header("Retry-After", retry_after)
        self.end_headers()
        self.wfile.write(resp_body)

    def do_GET(self):
        if self.path == "/healthz":
            self._send_json(200, {"ok": True})
            return
        self._send_json(405, {"error": {"message": "POST /v1/systemone only"}})

    do_PUT = do_DELETE = do_PATCH = do_GET


def main():
    api_key = os.environ["TYPESAFE_API_KEY"]  # KeyError = crash-fast by design
    server = http.server.ThreadingHTTPServer(("0.0.0.0", LISTEN_PORT), Handler)
    server.daemon_threads = True
    server.api_key = api_key
    print("jev-chess-proxy :%d -> %s (limits %d/s, %d/h, %d/d; gateway %s)"
          % (LISTEN_PORT, UPSTREAM, LIMIT_PER_SEC, LIMIT_PER_HOUR, LIMIT_PER_DAY, GATEWAY_SUBNET),
          flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
