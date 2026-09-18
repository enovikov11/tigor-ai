# Recon & CORS for single-file static web apps

## Recon a pinned CDN dependency
Read the real API before coding against it. Never guess the element name, event shape, or theming surface of a pinned dep.

```bash
# file list for an exact version
curl -sL "https://data.jsdelivr.com/v1/packages/npm/<pkg>@<ver>"
# ESM build (and any .d.ts) - read these
curl -sL "https://cdn.jsdelivr.net/npm/<pkg>@<ver>/dist/<build>.js" -o probe.js
```

For a **custom element / view layer**, grep the source for:
- Tag: `customElements.define("<tag>", ...)` - the actual registered name (often differs from the export name).
- Attributes: `static get observedAttributes()`.
- Properties/setters and their side effects (does the setter animate, cancel interaction, reset state?).
- Events: `new CustomEvent("<name>", { ..., detail: {...} })` - record each name, whether `cancelable`, and the exact `detail` fields. Note if a highlight/targets hook is a **function in `detail`** (call it) vs a property (set it).
- Theming: the bundled shadow-DOM CSS uses `var(--...)` custom properties set on `:host`. Override them from the light DOM on the host element (`host { --some-color: ...; }`) to retheme; inline `data:` SVGs need no extra CSP origin.

Confirm which methods exist by grepping the ESM build (`grep -oE 'methodName\\s*\\(' file | sort -u`) rather than trusting a doc page that may lag the pinned version.

## CORS preflight probe (the check that catches browser-only failures)
A POST with a `Content-Type: application/json` header is non-simple, so the browser sends an OPTIONS preflight. An API that returns 200 to `curl` can still block every browser whose origin it hasn't allowlisted.

```bash
# does the origin get allowed?
curl -s -D - -o /dev/null -X OPTIONS "<api-endpoint>" \
  -H "Origin: https://my-served-origin.example" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type" \
  | grep -iE '^HTTP/|access-control-allow-origin|vary'
```

Interpretation:
- `access-control-allow-origin: <your-origin>` (or `*` with no credentials) -> browser call will work.
- `Vary: Origin` with **no** `access-control-allow-origin`, often a 4xx body like "Disallowed CORS origin" -> origin allowlist; the browser blocks the call. The 200 data call you got from `curl` is irrelevant to the browser.
- Note `file://` pages send `Origin: null` - if the allowlist doesn't include `null`, opening the HTML directly from disk will also be blocked (serve over HTTP/HTTPS).

## When the API enforces an allowlist — diagnosing "what's allowed?"
The allowlist is opaque to an unauthenticated client. Probe a batch of origins in one loop (localhost/127.0.0.1 with common ports, `null`, and the provider's own origins: main site, docs, console/dashboard, app) with the preflight request above and record which return `access-control-allow-origin`.
- If even the vendor's **own dashboard/console** origin gets a 400 "Disallowed CORS origin", the dashboard must be proxying calls server-side — the allowlist is per-account, configured inside the logged-in console, and absent from public docs (check the docs `sitemap.xml` for a CORS page first; JS-SPA doc pages contain no body text to grep).
- The correct answer to "what origins are allowed?" is: nothing by default; the user registers their exact origin (scheme + host + port matter — `localhost:8000` ≠ `127.0.0.1:8000`) in their account settings, or asks the vendor's support. Never guess a public allowlist.

## Handling a blocked origin in a backend-free app
You cannot fix the allowlist from the client. Design the failure path:
- A CORS-blocked fetch rejects with a `TypeError` (`Failed to fetch`), NOT an HTTP status - so a catch-all network branch must exist separately from the HTTP-status branches.
- Show a specific message: "Network / CORS failure reaching <host> - your origin is likely not whitelisted. Serve from an allowed HTTP/HTTPS origin (no backend required)." + a Retry control.
- Never let the failed call mutate app state; never substitute a random/default value silently.

## Client-side API-key security checklist (BYO-key)
- Input `type="password"`, `autocomplete="off"`; placeholder says it's held in memory only.
- Read the key from the input only at request time; never cache it in a module-level var, `localStorage`/`sessionStorage`/`IndexedDB`/cookie.
- Never log it; never put it in the URL/query string; scrub it out of any server error body before displaying (`text.split(key).join("[key]")`).
- Store a working key for your own testing in a gitignored `.env` (`chmod 600`), and verify it is ignored (`git check-ignore -v .env`) and absent from the commit (`git grep -l <key-fragment>` -> none).
- CSP: `connect-src` limited to the API host so a compromised/extra script can't exfiltrate the key elsewhere; `script-src` limited to the CDN.
