# PowerDNS DNS-01 architecture (wildcard certs) — 2026-08 tigr.rs

Goal: Let's Encrypt wildcard certs for `*.ai.tgr.rs` + `*.vpn.tgr.rs` on a
VM that has no public A record it can control for HTTP-01. Strategy: the
registrar (unlimited.rs) hosts the `tgr.rs` apex zone; the two subdomains
are **delegated (NS records)** to a PowerDNS on the VPN VPS (10.67.69.1),
which Caddy edits through its API for `_acme-challenge` TXT records.

## Division of labor

- **USER creates at the registrar**: NS `ai.tgr.rs` → VPS, NS `vpn.tgr.rs`
  → VPS, plus public A/AAAA for the wildcards → VPS public IP.
  **Never create these records from the agent** — the user owns registrar
  state.
- **`vpn-host-setup.sh` (tigor-no-ai)**: installs and configures PowerDNS
  on the VPS, writes `/root/pdns-api-token.env`.
- **Caddy (tigor-ai)**: requests the wildcards at first start, renews
  in-process.

## Host-side config (what the script must produce)

```
# /etc/powerdns/powerdns.conf
local-address=127.0.0.1
local-port=5300                  # recursor owns :53
setuid=pdns
launch=sqlite3
sqlite3-ds=/var/lib/powerdns/powerdns.db
webserver=yes
webserver-address=10.67.69.1     # wg0 IP — NOT 127.0.0.1: the caddy
                                 # container reaches the API over the VPN
webserver-port=8081
webserver-allow-from=10.67.69.2  # only the gateway VM
api=yes
api-key=<token>                  # generated with wg genkey
```

```
# /etc/powerdns-recursor/recursor.conf
local-address=10.67.69.1
allow-from=10.67.69.0/24
forward-zones=ai.tgr.rs=127.0.0.1#5300, vpn.tgr.rs=127.0.0.1#5300
max-cache-size=1000
```

Zone setup:
```bash
pdns-util create-zone ai.tgr.rs --nameserver ns1.tgr.rs. --soa-serial 1
pdns-util create-zone vpn.tgr.rs --nameserver ns1.tgr.rs. --soa-serial 1
pdns-util change-record ai.tgr.rs  <PUBLIC_IP>  A
pdns-util change-record vpn.tgr.rs <PUBLIC_IP>  A
```

ufw ACL (before.rules — a named chain so the deny is explicit):
```
*filter
:PDNSAPI - [0:0]
-A PDNSAPI -s 10.67.69.2 -p tcp --dport 8081 -j ACCEPT
-A PDNSAPI -j DROP
-I INPUT 1 -j PDNSAPI
COMMIT
```
Plus `ufw allow in on wg0 from 10.67.69.0/24 to 10.67.69.1 proto udp port 53`.

## Why these choices

- **API on the wg0 IP, not loopback**: the caddy container's traffic to
  127.0.0.1 hits the container's own loopback, never the host's. The wg0
  address is reachable across the VPN and the ACL makes the blast radius
  one machine.
- **Recursor owns :53, authoritative on 5300**: avoids the classic
  recursor/authoritative port conflict on a box that also recurses for the
  VPN.
- **Only delegated subzones local**: the rest of `tgr.rs` (and everything
  else) still resolves upstream, so a botched delegation can't brick the
  VPN's DNS.

## Deploy order (wildcard DNS-01 stack)

1. `vpn-host-setup.sh` on the VPS (PowerDNS + ACLs + token file)
2. USER: NS delegation + wildcard A/AAAA at the registrar
3. `docker build -f caddy/Dockerfile -t local/caddy-pdns:2.11.4 caddy/`
4. `PDNS_API_TOKEN=...` in the compose `.env` (gitignored)
5. `up -d` — check caddy logs for `certificate obtained successfully`
   (issuer `lets-encrypt` in production, `local` in dry runs)

## Dry-run substitute

Replace the `tls { dns powerdns {...} }` block with `tls internal` — the
local CA instant-issues the wildcard so the full SNI/routing matrix can be
tested with zero external dependencies.
