---
name: podman-caddy-gateway
description: "Caddy fronting podman no-internet networks, wildcard certs."
metadata:
  hermes:
    tags: [podman, caddy, networking, acme, dns-01, wildcard, gateway, internal-network, caddyfile]
    related_skills: [container-ops, tigor-monorepo, minimal-service-pattern]
---

# Podman + Caddy no-internet gateway

Build a multi-network podman stack where some containers have **no internet egress**
(`internal: true` networks), fronted by a Caddy gateway, with **wildcard ACME certs**
via DNS-01 — and validate it **without disturbing the live host** (which in the tigor
setup is the same host the agent runs inside of).

## When to use
- "Put these containers on a network with no internet" / `internal: true` / air-gap a subset.
- A Caddy gateway serving `*.domain` on a private net with **wildcard** Let's Encrypt certs.
- You must `up -d` a compose that also drives the live host (agent, GPU model, reverse proxy) —
  you cannot recreate those containers to test.

## Core principle: never test on the live names

The root compose's `container_name`s and host ports are the LIVE stack (vllm/forgejo/hermes/caddy).
`up -d` recreates them. A second GPU model may not even fit (GPU nearly full). Instead, run a
**throwaway dry-run** that proves the topology without touching production:

- **Shifted host ports** (e.g. 18443/19143/18080) so they don't collide.
- **Stubs** for heavy services (busybox `httpd`) instead of the GPU model.
- **`tls internal`** (self-signed) in place of the real `tls { dns powerdns {...} }` block,
  so no real ACME/DNS calls fire.
- **Pinned IPs** + `--network-alias` so routing is deterministic.
- Then E2E `curl --resolve host:PORT:127.0.0.1` each route and check status codes.

Verify the *real* Caddyfile separately with `caddy validate --adapter caddyfile` (syntax,
no network) — that does NOT need the DNS provider module to be present for `on_demand`/routers,
but a `dns powerdns` block WILL fail adapt on stock caddy (see below).

## Network design: internal nets + pinned IPs

```yaml
networks:
  vpn-only:
    driver: bridge
    internal: true          # <- no internet egress (verified: container cannot reach example.com)
    ipam: { config: [ { subnet: 172.67.69.0/24, gateway: 172.67.69.1 } ] }
  public:
    driver: bridge
    internal: true
    ipam: { config: [ { subnet: 172.67.70.0/24, gateway: 172.67.70.1 } ] }
```

- `internal: true` = no egress. A container on it **cannot** reach the internet (verified).
- A container that needs internet (the gateway for ACME, or a specific service) also attaches
  to the default (routable) bridge network.
- **Cross-network name resolution is unreliable in podman.** Don't rely on Caddy resolving
  `vllm` on a different network than Caddy's primary. Instead **pin each container's IP**
  (`networks: <net>: { ipv4_address: 172.67.69.10 }`) and have the gateway `reverse_proxy`
  **by IP** (`reverse_proxy 172.67.69.10:8000`). Deterministic, no DNS dependency.
  podman-compose honors per-service `ipv4_address` (verified).
  **Exception (verified 2026-08-26):** if the gateway container is attached to EVERY network
  the upstreams live on (`networks: [default, vpn-only, public-service]`), podman's embedded
  DNS resolves each upstream's service name from the gateway just fine — `reverse_proxy
  vllm:8000` works with no pinned IPs. Pinned IPs are only needed when the gateway is NOT on
  the upstream's network.

## Wildcard certs need a CUSTOM Caddy build (the load-bearing gotcha)

**Stock `caddy:2` (2.11.4) ships with NO `caddytls.dns.providers`.** Verified:
`docker run --rm caddy:2 caddy list-modules | grep -i powerdns` → empty, and adapting a
`tls { dns powerdns {...} }` block → `module not registered: dns.providers.powerdns`.

So "Caddy requests wildcard certs via DNS-01" is impossible with the stock image. Build one:

```dockerfile
FROM caddy:2.11.4 AS builder
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev && \
    go install github.com/caddyserver/xcaddy/cmd/xcaddy@v0.4.7 && \
    xcaddy build \
      --with github.com/caddy-dns/powerdns@v1.0.2 \
      --output /out/caddy
FROM caddy:2.11.4
COPY --from=builder /out/caddy /usr/bin/caddy
```

Verify the provider is actually compiled in:
`docker run --rm <image> caddy list-modules | grep powerdns` → `dns.providers.powerdns`.

The full provider config + Caddyfile template is in **`references/caddy-dns01.md`**.

## Caddyfile gotchas (all hit + verified this session)
- **`on_demand` is JSON-only.** It is NOT a Caddyfile subdirective — `tls { on_demand {...} }`
  → `unrecognized directive: on_demand` / `unknown subdirective: {`. In Caddyfile use
  `tls internal` (self-signed CA) instead.
- **Don't mix `http://:PORT` and `https://:PORT` on the same port** in one server block.
- **Wildcard `*.domain` matches single-label only.** `sub.ai.tgr.rs` ✓, `a.b.ai.tgr.rs` ✗
  (TLS alert `internal error` on the handshake for the double-label name). Standard wildcard
  semantics — don't be surprised.
- **`resolver` is not a valid caddyfile directive** — don't try to add it.
- **Host-based routing, not path-based**, avoids one SNI's `handle /` hijacking another
  service's paths. Route each service by its own SNI host.
- **The DNS API must be reachable from the Caddy container.** Bind the PowerDNS API to a
  non-loopback interface (e.g. the wg0 IP `10.67.69.x`), **not** `127.0.0.1`, and ACL it to
  the gateway subnet — Caddy is a separate container and can't hit loopback on the host.

## Pitfalls
1. **Podman-compose groups services into a pod.** `docker rm -f <one-service>` in a compose
   pod can tear down siblings. For deterministic teardown of a test stack, drive individual
   containers with direct `docker run --network --network-alias --ip ...` (verified).
2. **`write_file`/`patch` are sandboxed to the container workdir (`/opt/data`)** and cannot
   reach `/home/nixos/...` (the SSH-terminal host paths) → permission denied. Use terminal
   heredoc / python for host-path file edits.
3. **Busybox `httpd` as a stub daemonizes and the container exits** if it's not PID-1 kept
   alive. Append `; tail -f /dev/null` (or run `httpd` as the foreground entrypoint) so the
   stub container stays up for the E2E run.
4. **`env_file` tolerates a missing file** in podman-compose (verified) — safe to reference a
   `.env` that may not exist yet at dry-run time; provide dummy values via `-e` when you need
   the Caddyfile to adapt.

## Verification (run this, don't just describe it)
- `docker compose config --quiet` — compose parses.
- `docker run --rm -v ./Caddyfile:/etc/caddy/Caddyfile:ro <image> caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`
- E2E dry-run `curl --resolve` matrix: each vpn SNI → 200 from its stub; each public name →
  static 200; 80 → 308 to 443; internal-net egress → unreachable. Report the actual status codes.

## See Also
- `container-ops` — podman image management + networking quick reference
- `tigor-monorepo` — worktrees/PRs for tigor-ai / tigor-no-ai
- `references/caddy-dns01.md` — verified xcaddy build + powerdns provider config + Caddyfile template
