# Caddy DNS-01 wildcard certs via PowerDNS (verified recipe)

Stock `caddy:2` (2.11.4) has **no** `caddytls.dns.providers` — confirmed via
`caddy list-modules`. Any DNS-01 (wildcard) setup needs a custom xcaddy build.

## Versions (as of 2026-08)
- xcaddy binary module path: `github.com/caddyserver/xcaddy/cmd/xcaddy` (latest `v0.4.7`).
  Note: the **module** is `github.com/caddyserver/xcaddy` (no `/v2`), but the **binary**
  package you `go install` is `.../cmd/xcaddy`.
- PowerDNS provider: `github.com/caddy-dns/powerdns` (latest `v1.0.2`).
- Registered module after build: `dns.providers.powerdns`.

## Dockerfile
```dockerfile
FROM caddy:2.11.4 AS builder
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev \
    && go install github.com/caddyserver/xcaddy/cmd/xcaddy@v0.4.7 \
    && xcaddy build \
         --with github.com/caddy-dns/powerdns@v1.0.2 \
         --output /out/caddy
FROM caddy:2.11.4
COPY --from=builder /out/caddy /usr/bin/caddy
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
```
Build: `docker build -f caddy/Dockerfile -t local/caddy-pdns:2.11.4 .`
Verify: `docker run --rm local/caddy-pdns:2.11.4 caddy list-modules | grep powerdns`

Go module build is slow (~10+ min on a weak VM) — kick it off in the background and do other
work; the go toolchain download is the long pole.

## Caddyfile: dns powerdns block
Provider keys: `server_url`, `server_id`, `api_token`.

```caddyfile
{
  # no global `resolver` — it is not a valid caddyfile directive
}

vpn.tgr.rs, *.vpn.tgr.rs {
    tls {
        dns powerdns {
            server_url http://10.67.69.2:8081   # NON-loopback: reachable from the caddy container
            server_id localhost
            api_token {env.PDNS_API_TOKEN}
        }
    }
    reverse_proxy 172.67.69.10:8000            # route by pinned IP, not by cross-net DNS
}

ai.tgr.rs, *.ai.tgr.rs {
    tls {
        dns powerdns {
            server_url http://10.67.69.2:8081
            server_id localhost
            api_token {env.PDNS_API_TOKEN}
        }
    }
    reverse_proxy 172.67.70.10:8080
}
```
Compose must pass the env var:
```yaml
  caddy:
    environment:
      ACME_AGREE: "true"
      PDNS_API_TOKEN: ${PDNS_API_TOKEN}
```

## PowerDNS side (host)
- API must be bound to a **non-loopback** interface the caddy container can reach — the wg0 IP,
  not `127.0.0.1`. ACL it to the gateway's subnet only.
- Authoritative server for the delegated subzones (e.g. `ai.tgr.rs` / `vpn.tgr.rs`) — the
  registrar's NS delegation lets Caddy's DNS-01 insert the `_acme-challenge.<wildcard>` TXT.
- Recursor for the private net, restricted to the VPN.

## Caddyfile TLS gotchas
- `on_demand` is **JSON-only**; `tls { on_demand {...} }` fails to adapt. Use `tls internal`
  for self-signed in Caddyfile.
- A single-label wildcard `*.x` cert does NOT cover double-label `a.b.x` — handshake returns
  TLS alert `internal error`. Expected.
- Don't put `http://:PORT` and `https://:PORT` in one server block on the same port.

## Dry-run (no real ACME/DNS calls)
Swap every `tls { dns powerdns {...} }` block for `tls internal`, shift host ports, run busybox
`httpd` stubs, pin IPs + `--network-alias`, then:
```bash
curl -sk -o /dev/null -w "%{http_code}\n" --resolve vllm.vpn.tgr.rs:18443:127.0.0.1 https://vllm.vpn.tgr.rs:18443/
```
