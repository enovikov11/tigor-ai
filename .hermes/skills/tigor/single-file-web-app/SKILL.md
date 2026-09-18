---
name: single-file-web-app
category: tigor
description: Use when building a single-file static web app from a spec.
tags: [web, static-site, esm, cdp, cors, verification, browser]
---

# Single-File Static Web App

Build and verify a self-contained `index.html` web app: no backend, no build step, no bundler. Dependencies load as pinned ES modules from a single CDN; a third-party API is called with the browser's native `fetch()`. Deliverable is exactly one `index.html` (+ runtime CDN/API requests).

Deliverable discipline (standing):
- The finished artifact is ONE self-contained `index.html`. No build step, no `node_modules`, no extra local files.
- Pin every CDN dependency to an exact version; use one CDN origin only (jsDelivr). No `latest` aliases, no invented SRI hashes.
- Add a restrictive CSP meta: `script-src` = the CDN + `'unsafe-inline'`; `connect-src` = the API host only; no other origins.
- If a user API key is entered in the page: `type="password"`, never hardcode it, never put it in query params, never write it to console, never persist (no localStorage/IndexedDB/cookie). Keep it in runtime memory only, and scrub it out of any displayed error text.

## Workflow (do in this order)

### 1. Recon the pinned dependencies BEFORE writing code
Do not guess the API of a pinned dep. Download the exact `dist` ESM build and any `.d.ts` and read them:
- jsDelivr file list: `curl -sL https://data.jsdelivr.com/v1/packages/npm/<pkg>@<ver>`
- ESM build + types: `curl -sL https://cdn.jsdelivr.net/npm/<pkg>@<ver>/dist/...`

For a custom-element/view-layer dep, extract from the source: the registered tag name (`customElements.define("...",...)`), the observed attributes, the properties/setters, the **event names and their `detail` shapes**, and any theming CSS custom properties (shadow-DOM CSS vars are the only way to restyle it). Confirm which event is cancelable and whether a highlight/targets callback is a **function** passed in `detail` (common in board UIs) vs a property.

### 2. Author the file on the host
- `write_file` and `patch` are sandboxed to a write-safe root on the *local* machine and are denied for SSH-host paths; `terminal` runs on the host. So author host files with `terminal` heredocs (`cat >> file <<'EOF' ... EOF`), in chunks small enough to avoid the oversized-command block.
- Prefer building the whole HTML/CSS in 1-2 chunks and the `<script type="module">` in 1-2 more, then read it back.

### 3. Verify the API contract AND its CORS posture (a static client app is CORS-bound)
`curl` proves the endpoint works to a non-browser client; it does NOT prove a browser can use it. Do both:
- Real call: `curl -sL -X POST <api> -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '<body>'` (keep the key in a gitignored `.env`, `chmod 600`, never in the repo/page).
- CORS preflight probe: `curl -s -D - -o /dev/null -X OPTIONS <api> -H "Origin: <serving-origin>" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: authorization,content-type"` - then check for `Access-Control-Allow-Origin` matching the origin (a non-allowing `Vary: Origin` + 4xx/"Disallowed CORS origin" means the API enforces an origin allowlist and the browser will block the call).
- If the origin is blocked, the app must still be backend-free: detect the fetch failure (it surfaces as a `TypeError`/network error, not an HTTP status) and show a clear "serve from a whitelisted origin" message + a Retry control. See `references/recon-and-cors.md`.

### 4. Test the app logic headlessly in Node
Node has no DOM and the view layer is a component - extract the real logic and assert it:
- Grab the `<script type="module">` body, rewrite each CDN import to a locally-downloaded copy and stub the view-layer import (it's not needed for logic).
- Provide a minimal DOM shim (`getElementById`/`createElement`/`addEventListener` with a `.listeners` map, `classList`, `style`, `textContent`, `value`) and a **programmable `globalThis.fetch`** you swap per test.
- `export` the internal functions from the extracted module and drive them with `assert`.
- Cover the risky paths: race/stale-response (abort an in-flight request, bump a serial, confirm the old response can't mutate a fresh state), every special case, each error branch (HTTP 4xx/5xx/429, timeout/abort, malformed JSON, unknown result), and invariant guards.
- Run with a Node you can obtain without installing - on the NixOS VM: `nix-shell -p nodejs --run "node run.mjs"`.

### 5. Smoke-test in a real headless browser
The stubbed logic test cannot cover the real component rendering or a real network/CORS failure - do a browser pass for those:
- The `browser_exec` tool blocks private/loopback addresses, so it can't reach the VM's `127.0.0.1`. Instead serve the dir (`python3 -m http.server 8199 --bind 127.0.0.1`, as a tracked background process) and drive **local** headless Chromium over CDP.
- Obtain Chromium without installing (NixOS VM): `nix-shell -p chromium --run "command -v chromium"` (large; background it with a `CHROMIUM=` watch).
- Use the reusable CDP probe: `node scripts/cdp_probe.mjs <chromium-path> http://127.0.0.1:8199/index.html probe.mjs` - Node's global `WebSocket` means no puppeteer. It navigates, waits, runs your `probe.mjs` (which may call `eval(...)` to read the live DOM), and prints the result plus all console messages, exceptions, and failed network requests.
- Verify: the custom element upgraded and rendered (e.g. 64 squares/32 pieces), the human-interaction event flow works and the component's move event is `preventDefault`'d (so the view never self-mutates), and a real API call from the loopback origin produces the expected friendly CORS/network message with the state unchanged.

## Standing pitfalls
- **`curl` 200 =/= browser OK.** A 200 to curl with no `Access-Control-Allow-Origin` for your origin is a browser blocker. Always probe the preflight; never infer CORS behavior from the data call.
- **Don't trust the view layer for state.** A board/component's move/click events fire before it mutates itself; `preventDefault()` and re-sync the view from the single source of truth (e.g. `game.fen()`) so special moves can't desync DOM and logic.
- **Guard against stale async responses.** Any long-lived state object must invalidate in-flight requests on reset: bump a monotonic serial, abort the `AbortController`, and check both serial and the position FEN before applying a late result. A stale result must never mutate the new state.
- **Clean up in `finally`.** Reset thinking/active-request flags in a `finally`, and set the "done" flag *before* you recompute status/interactivity, so a stale-drop path can't leave the UI stuck.
- **`setAttribute(name, null)` coerces to the string `"null"`.** To clear a boolean-attribute, use `removeAttribute`, not `setAttribute(..., null)`.
- **Recon before you write.** The single biggest time-saver: read the actual pinned source (element name, event `detail` shape, whether a target-listener is a function, theming CSS vars). Guessing a pinned API produces silent integration bugs.
- **In Node tests, the fake `fetch` must REJECT its promise on abort.** Throwing inside the `AbortSignal` listener produces an unhandled process exception, not a fetch failure, so the app's `AbortError` branch never runs. Correct shape: `new Promise((res, rej) => { signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))); /* else resolve a Response */ })`.
- **Two layers of verification.** Node tests with a view-layer stub + fake `fetch` prove the logic; a real headless-browser CDP smoke test proves the component renders, the real event flow fires, and the real CORS/network failure path degrades gracefully. Neither replaces the other.
- **A page with lazy-imported sibling modules is not "one file".** Deploys must copy every referenced `*.js` into the served dir; after deploying, verify the page AND each referenced asset returns 200 — a 200 page with 404 modules looks shipped but is broken.
- **In CDP assertions, count board state by rendered text, not helper classes.** Classes like `empty`/`legal` are only added in interactive mode; in Jev-vs-Jev (non-interactive) mode every cell lacks them and a class-based count returns the full board size, silently failing a "givens" assertion.
- **Capture initial state before asserting when auto-play is running.** AI-driven games advance within seconds; sleeping first means you count a mid-game board. Assert on the t≈0 sample, or hook `fetch` to log the request stream and inspect per-request state.
- **Do not assume who moves first in a test.** Some games start with Black (e.g. Othello). Force the human to a fixed side in the harness for determinism, and assert on both the opening AI move and the reply, not just "plies grew".
- **A non-JSON error body from a proxied API is an upstream error, not your validator.** Your proxy emits JSON; a raw HTML error page (e.g. `<title>Error response</title>`) is the upstream's. Replay the exact captured payload against the proxy — if the replay returns 200, the original failure was transient; the fix is one automatic retry for non-JSON 4xx/5xx (keeping Retry-After handling for 429), not debugging the payload.

## References & scripts
- `references/recon-and-cors.md` - dep-recon recipes and the CORS-preflight probe + client-side key security checklist.
- `scripts/cdp_probe.mjs` - reusable zero-dependency CDP smoke harness (Node global WebSocket). Usage: `node cdp_probe.mjs <chromium> <url> <probe.mjs>`.
