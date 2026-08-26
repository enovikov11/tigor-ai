# Caddy with the PowerDNS DNS-01 provider.
#
# Stock caddy:2 ships no ACME DNS-01 providers at all, and wildcard certs
# (*.ai.tgr.rs / *.vpn.tgr.rs) cannot be issued over HTTP-01. This build adds
# github.com/caddy-dns/powerdns so Caddy can create the _acme-challenge TXT
# records through the VPS-hosted PowerDNS API (see vpn-host-setup.sh).
FROM golang:1.25 AS build
RUN go install github.com/caddyserver/xcaddy/cmd/xcaddy@v0.4.7 \
 && xcaddy build \
      --with github.com/caddy-dns/powerdns@v1.0.2 \
      --output /out/caddy
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/caddy /usr/bin/caddy
EXPOSE 80 443 1433
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
