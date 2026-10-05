---
name: jev-chess-site
description: "Deploy/extend the jev-chess TypeSafe site (staging-first)."
tags: [jev, typesafe, deploy, staging, proxy, cdp, games]
---

# Jev-chess site (TypeSafe Jev games, Hetzner VPS)

Project: `web/5-jev-chess-proxy/` in tigor-ai (public repo — secret-scan the staged diff before push). One-page app (chess + sudoku + `games/*.js` module games) behind a self-hosted stdlib Python proxy that holds the TypeSafe key server-side. Live on `root@jev-chess.tgr.rs`: prod `https://jev-chess.tgr.rs/`, staging `https://jev-chess-staging.tgr.rs/`, docker compose, shared Caddy (JSON access logs to stdout, stats via `/opt/jev-chess/caddy-stats.sh`).

## Standing rules (user mandates)
- **Never deploy to prod without explicit user authorization.** Staging is the test bed; every increment = commit → push → `deploy.sh staging`. Prod only when the user authorizes, via the guard var below.
- **The TypeSafe key lives only in the server-side `.env`** (chmod 600, piped via stdin, never in repo/page/logs/commits).
- **New games default to Jev-vs-Jev auto-play** (auto-solves the game like JvJ chess); prepopulate initial state (sudoku: 30 givens); the user can explicitly pick a side to join.
- **The proxy must format-validate payloads** (known game, 1–255 choice criteria, per-game shape) so the site is unusable as a free API, while staying permissive for the real app. Abuse → 400.

## Deploy
```bash
bash deploy.sh staging                      # staging only — must never touch prod paths
I_UNDERSTAND_THIS_TOUCHES_PROD=1 bash deploy.sh prod   # ONLY with user authorization
```
- `deploy.sh` renders deploy-time feature flags (`FEATURES.sudoku`, `FEATURES.games`) into the generated page AND strips the corresponding `<option>` from raw HTML when a flag is off. Generated page copies are gitignored deploy artifacts, not source.
- **The deploy must copy every static asset the page references** (incl. lazily-imported `games/*.js`) into the served web dir. After EVERY deploy verify: page 200, `/healthz`, each `games/<id>.js` 200, rev footer present. A 200 page with 404 modules is a broken deploy.
- Staging and prod paths must stay physically separated (prior incident: a "staging" rsync wrote the prod bind-mounted web dir and silently changed prod). Never reintroduce shared target dirs or env-ungated syncs.
- Prod deploys must be non-disruptive (recreate only the staging/prod proxy container for that env; never take shared Caddy down).

## Static path under an existing domain (no proxy)
Used when the user wants a browser-only project on the jev-chess VPS/domain without TypeSafe or a backend (e.g. long-chess → `https://jev-chess.tgr.rs/long-chess/`):
1. Caddyfile: add `handle /<name>* { uri strip_prefix /<name>; root * /srv/<name>; file_server }` inside the prod site, BEFORE the default `handle`.
2. compose: add the caddy volume `./<name>:/srv/<name>:ro`.
3. Deploy by hand: rsync static dir → `/opt/jev-chess/<name>/`, rsync Caddyfile + docker-compose.yml, then `docker compose up -d caddy` — **recreate, not reload**: reload applies config but never new volume mounts.
4. **Do NOT run `deploy.sh prod` for a static-only change** — it re-renders `web/index.html` with default flags (`PROD_SUDOKU`/`PROD_GAMES` default false) and silently resets prod feature state.
5. Verify: `curl -s https://jev-chess.tgr.rs/<name>/` 200 + each referenced asset 200.

## Proxy contract
- `POST /v1/systemone` → upstream `https://api.typesafe.ai/v1/systemone`, key injected server-side. Body: `{model, state:{game, ...}, questions:{move:{type:"choice", instructions, criteria:{<key>:{label}}}}}`; answer is `answers.move.choice` = a criterion key (chess: SAN/LAN moves; modules: game keys). Send ALL legal moves as criteria; max 255 (assert in app).
- Limits (in-memory sliding window, per IP): 1 rps / 1000 h / 5000 d. `X-Real-IP` trusted only from the gateway subnet (spoof-proof).
- **Error triage: the proxy emits JSON; upstream errors are forwarded verbatim as raw HTML** (e.g. transient 400 error pages). If an error body isn't our JSON, it's upstream — replay the exact captured payload at the proxy; 200 replay means transient. The app auto-retries non-JSON 4xx/5xx once (429 honors Retry-After).

## Verification order
1. Node unit suites: `timeout 180 nix-shell -p nodejs --run "node tests/<id>.test.mjs"` for every game — all must pass before deploy.
2. Deploy staging, run the asset check above.
3. CDP smoke against staging: fresh chromium profile, hard `timeout` on the whole run. Live-Jev tests are budgeted ~1 request/s per IP — never run two live-API tests in parallel from the same IP (they 429 each other and produce misleading failures).
4. CDP assertion discipline: force the human to a fixed side (don't assume who moves first — Othello is Black-first); capture initial state at t≈0 before auto-play advances it; count board cells by rendered text, not interactive-only classes.

## Module game contract (`games/<id>.js`, default export)
`id, name, newGame(), legalMoves(state, side), applyMove(state, move, side), promptState(state, side), promptInstructions(state, side), moveLabel(move), render(view, state)`.
- State is plain JSON (undo/replay works via snapshots) — no functions/DOM/cycles.
- `legalMoves`: all legal moves; if side has none but game not over → single `{key:'pass', label:'Pass'}`; game over → `[]`. Max 255.
- `promptState` must return an OBJECT with the metadata the proxy validates (e.g. `game`, grid fields) — never a bare string.
- `render(view, state)`: clear + rebuild `view.mount`; user clicks call `view.commitMove(move)`; unique-id style tag, dark theme, no inline `style=` attributes; guard `document` so Node can import the module for unit tests.
- `tests/<id>.test.mjs` runs headless in Node with no DOM.

## Games status
Implemented + unit-tested: connect4, othello, uttt, hex, dots, battleship (battleship: hidden-info state — each side only sees its own fleet + shot results; placement supports `rand` key). Further games come from the queued TypeSafe eval list in memory.

Static (NOT module contract, no proxy — served at `/long-chess/`): long-chess in `games/5-long-chess/` — 10×10 capture race, 10 rooks + 10 pawns per side, pawn capture promotes to crown (rook + 1 step any dir), blockade = loss, local negamax (depths 1/3/5; depth 6 ≈ 3s mid-game, too slow). UMD engine.js, Node headless tests.