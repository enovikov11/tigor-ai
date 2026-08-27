---
name: caddy-gateway
description: Configure Caddy gateways with ACME DNS-01 certs and podman.
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [caddy, acme, dns-01, reverse-proxy, podman, gateway]
    related_skills: [minimal-service-pattern, container-ops, tigor-monorepo]
---

# Caddy Gateway (tigr.rs)

Building and operating Caddy as the reverse-proxy gateway: custom xcaddy
builds with ACME DNS-01 providers, wildcard certs, podman network isolation,
and non-disruptive dry-run verification.

## Hard facts (verified 2026-08, Caddy 2.11.4)

- **Stock `caddy:2` has NO ACME DNS-01 providers** — no cloudflare, powerdns,
  or acmedns. `caddy list-modules | grep dns` is empty. DNS-01 needs an
  xcaddy build.
- **`on_demand` is JSON-only** — not a valid Caddyfile directive. Use
  `tls internal` for a fallback listener without a real cert.
- **Wildcards are single-label**: `*.ai.tgr.rs` covers `x.ai.tgr.rs`, NOT
  `x.y.ai.tgr.rs` (same as Let's Encrypt).
- No `resolver` directive and podman cross-network DNS is unreliable → use
  **pinned IPs** as upstreams.
- Caddy does not hot-watch external cert files; auto-HTTPS/DNS-01 renews
  in-process.

## Custom build (DNS-01 provider)

Known-good build in `templates/Dockerfile`. Pitfalls (each cost an iteration):
1. xcaddy's main package is `github.com/caddyserver/xcaddy/cmd/xcaddy`, not
   the module root → "not a main package" otherwise.
2. Pin versions — `@latest` resolves wrong: xcaddy `v0.4.7`,
   `caddy-dns/powerdns` `v1.0.2`.
3. Pin the base image to the same Caddy version as the built binary.
4. Verify: `docker run --rm <img> caddy list-modules | grep dns.providers.powerdns`,
   then `caddy validate` the real Caddyfile *inside the custom image*.

## PowerDNS DNS-01 (wildcard certs)

Full host-side config + Caddy block in `references/powerdns-dns01.md`. The
short version: authoritative `pdns` on 127.0.0.1:5300 (recursor owns :53),
delegated subzones `ai.tgr.rs`/`vpn.tgr.rs`, API on the **wg0 IP** (not
127.0.0.1) so the caddy container reaches it over the VPN, source-restricted
+ token. The USER creates the NS delegation at the registrar — never create
DNS records for them.

## Caddyfile patterns

- Path-based routing under one SNI with `strip_prefix` (upstream must carry
  the prefix in its own URL, e.g. forgejo `ROOT_URL=https://vpn.tgr.rs/forgejo/`):
```
vpn.tgr.rs, *.vpn.tgr.rs {
	tls { dns powerdns { ... } }
	handle /forgejo* {
		uri strip_prefix /forgejo
		reverse_proxy 172.67.69.20:3000
	}
}
```
- Multiple HTTPS ports sharing one cert:
  `https://ai.tgr.rs:1080, https://*.ai.tgr.rs:1080, https://ai.tgr.rs:1433, https://*.ai.tgr.rs:1433 { ... }`
- Redirect to another port: `redir https://{host}:1080{uri} 301`
- Plain HTTP listener: `:81 { reverse_proxy ... }`
- Named matchers need their own `handle @name` block — a named matcher does
  NOT work nested inside another `handle`.

## Compose / networks (podman)

- No-egress net: `driver: bridge, internal: true` + pinned IPAM
  (`ipam: config: [{subnet: 172.67.69.0/24, gateway: 172.67.69.1}]`).
- podman-compose honors per-service pinned `ipv4_address` → use those IPs as
  Caddy upstreams.
- **PITFALL:** a service's `networks:` must be a **pure mapping** — mixing
  `- default` (sequence item) with `vpn-only: {...}` (mapping key) breaks
  podman-compose's strict YAML parse.
- podman-compose tolerates a missing `env_file` (safe to `config` before
  `.env` exists).
- Hardening: `cap_drop: [ALL]`, `cap_add: [NET_BIND_SERVICE]`,
  `no-new-privileges:true`.

## Dry-run verification (non-disruptive)

1. Swap every `tls { dns powerdns {...} }` block for `tls internal` (local
   CA issues the wildcard instantly — perfect for routing tests).
2. Shift listener ports to free ones (80→280, 443→2443, 81–83→2081–2083).
3. Pinned-IP stub containers on the same nets; keep them alive with a
   foreground loop (busybox httpd daemonizes and dies as non-PID1 → 502s).
4. Run caddy with `-p 280:280 ...` host mappings; test from the host with
   `curl --resolve host:port:127.0.0.1`.
5. **`docker rm -f` + recreate changes the bridge IP** — re-inspect before
   any IP-based test.
6. `caddy validate --config ... --adapter caddyfile` first (inside the
   custom image so the powerdns module is registered).
7. Clean up: `docker rm -f` stubs, `docker network rm`, delete the sandbox
   dir — the user wants bloat cut after the job.

## Pitfalls

- Curl `000`s in a dry run are usually (a) missing `-p` host mappings or
  (b) a stale container IP after recreate — check those before blaming
  config.
- Multi-label `x.y.ai.tgr.rs` → TLS handshake failure is EXPECTED
  (single-label wildcard), not a bug.
- The agent IS the `hermes` container on the live host — a full `up -d` of
  the worktree compose clobbers live containers (name collisions) and
  restarts the agent. Test on shifted ports with throwaway `ttest-*`
  containers only; the user deploys for real.
