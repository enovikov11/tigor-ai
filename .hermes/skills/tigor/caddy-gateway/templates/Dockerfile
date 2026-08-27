# Known-good xcaddy build for Caddy + PowerDNS DNS-01 (2026-08)

Base version must match the built binary (Caddy 2.11.4 here). Build on the
VM via podman/docker; no local Go toolchain exists on the host.

```dockerfile
# Stage 1: build caddy with the PowerDNS DNS-01 provider
FROM golang:1.25 AS build
RUN go install github.com/caddyserver/xcaddy/cmd/xcaddy@v0.4.7
RUN xcaddy build \
    --with github.com/caddy-dns/powerdns@v1.0.2 \
    --output /out/caddy

# Stage 2: drop the binary into the stock base
FROM caddy:2.11.4
COPY --from=build /out/caddy /usr/bin/caddy
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
```

```bash
docker build -f caddy/Dockerfile -t local/caddy-pdns:2.11.4 caddy/
```

## Verification (both must pass)

```bash
# 1. provider registered
docker run --rm local/caddy-pdns:2.11.4 caddy list-modules | grep dns.providers.powerdns
#    → dns.providers.powerdns

# 2. the real Caddyfile (with live `tls { dns powerdns {...} }` blocks) adapts
docker run --rm -v $PWD/Caddyfile:/etc/caddy/Caddyfile:ro \
  local/caddy-pdns:2.11.4 \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
#    → Valid configuration
```

## Build error → fix table (each of these actually happened)

| Error | Cause | Fix |
|---|---|---|
| `package github.com/caddyserver/xcaddy is not a main package` | module root has no main | use `xcaddy/cmd/xcaddy` |
| `module ... : not found` / wrong version | `@latest` resolves to a non-main or wrong path | pin `@v0.4.7` |
| provider "module not registered" in validate | validating with stock `caddy:2`, not the custom image | always validate inside the custom image |

## PowerDNS provider config (Caddyfile)

```
tls {
	dns powerdns {
		server_url http://10.67.69.1:8081
		server_id localhost
		api_token {env.PDNS_API_TOKEN}
	}
}
```

Env-var equivalents: `PDNS_URL`, `PDNS_SERVER_ID`, `PDNS_API_TOKEN`
(provider reads env when fields are omitted). `PDNS_API_TOKEN` is injected
via compose `env_file: [.env]` (gitignored).
