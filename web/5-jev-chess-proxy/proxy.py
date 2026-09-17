#!/usr/bin/env python3
"""Jev Chess proxy: fronts api.typesafe.ai/v1/systemone for jev-chess.tgr.rs.

- The TypeSafe key comes from env (TYPESAFE_API_KEY); the client sends none.
- Requests are validated as chess (biased to ALLOWING): a POST whose JSON body
  has a questions.move choice question with LAN-shaped criteria keys, plus a
  chess-looking state when a FEN is present. Non-conforming bodies are
  rejected, but the bar is deliberately low so the app keeps working. This is
  an anti-abuse filter, not a strict validator.
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

# --- chess-shaped validation (permissive; skews to allowing) ------------------
LAN = re.compile(r"^[a-h][1-8][a-h][1-8][qrbn]?$")  # e2e4, g1f3, e7e8q
FEN_PLACEMENT = re.compile(r"^([pnbqkrPNBQKR1-8]{1,8}/){7}[pnbqkrPNBQKR1-8]{1,8}$")
PIECE_TYPES = {"p", "n", "b", "r", "q", "k"}


def looks_like_chess(body: bytes) -> bool:
    try:
        doc = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        return False
    if not isinstance(doc, dict):
        return False
    questions = doc.get("questions")
    move = questions.get("move") if isinstance(questions, dict) else None
    if not isinstance(move, dict):
        return False
    criteria = move.get("criteria")
    if not isinstance(criteria, dict) or not criteria:
        return False
    for key, val in criteria.items():
        if not isinstance(key, str) or not LAN.match(key):
            return False
        if isinstance(val, dict):
            piece = val.get("piece")
            if piece is not None and piece not in PIECE_TYPES:
                return False
    state = doc.get("state")
    if isinstance(state, str) and state.lstrip().startswith("{"):
        try:
            state = json.loads(state)
        except ValueError:
            return False
    if isinstance(state, dict):
        fen = state.get("fen")
        if isinstance(fen, str):
            placement = fen.split(" ", 1)[0]
            if not FEN_PLACEMENT.match(placement):
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
        if not looks_like_chess(body):
            self._send_json(400, {
                "error": {"message": "request does not look like a chess move "
                                     "request (need questions.move choice with "
                                     "LAN criteria and a chess state)"}
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
