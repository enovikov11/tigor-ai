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