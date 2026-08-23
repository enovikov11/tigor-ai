---
name: sandboxed-relay-service
description: "Use when building a one-way data relay with nginx serving."
---

# Sandboxed Relay Service

One-way data export relay: validate command → run in isolated dir → compress → serve as download-only files. Zero-code-execution serving via nginx.

## Architecture

- **Python worker** (stdlib only, `http.server`) on `127.0.0.1:9999`
- **nginx** on `:8080` — reverse-proxy for API, file serving for everything else
- Shared volume: `/data/{temp,out}/`

## Command Validation (No Injection)

Three layers — ALL must pass:

1. **Shell metacharacter rejection** (deny list):
   ```python
   SHELL_META = re.compile(r'[;|&$`(){}\[\]<>`\n\r]')
   ```

2. **Known-good pattern matching** (allow list — regex per command type):
   ```python
   # git clone
   r'^git\s+clone\s+(?:--depth\s+\d+\s+|--single-branch\s+)*https://github\.com/[a-zA-Z0-9._/-]+/[a-zA-Z0-9._/-]+\s+[a-zA-Z0-9._/-]+$',
   # npm
   r'^npm\s+(?:pack|install)\s+[a-zA-Z0-9@_.-]+$',
   # pip download
   r'^pip\s+download\s+(?:--dest\s+\S+\s+)?[a-zA-Z0-9@_.-]+$',
   # podman save
   r'^podman\s+save\s+[a-zA-Z0-9._/:@-]+$',
   # curl/wget with URL check
   r'^curl\s+-fSL\s+-o\s+\S+\s+https://github\.com/.+$',
   ```

3. **URL origin whitelist** (every URL in the command checked):
   ```python
   ALLOWED_URLS = (
       "https://github.com/", "https://gitlab.com/",
       "https://codeload.github.com/",
       "https://registry.npmjs.org/", "https://files.pythonhosted.org/",
       "https://pypi.org/", "https://cache.nixos.org/",
       "https://registry-1.docker.io/", "https://ghcr.io/",
   )
   ```

## API Endpoints

| Endpoint | Response |
|---|---|
| `/add?command=...` | `202 {id, status: "running", log: "/temp/{id}/download.log"}` |
| `/remove?id=...` | `200 {removed: true}` — kills proc, deletes temp+out |
| `/status` | `200 {"{id}": {status: "done|running|failed", sha: "abc123"}}` |
| `/health` | `200 {ok: true}` |

## File Layout

```
/data/
  temp/
    {unixtime_ms}/
      download.log      # timestamped stdout/stderr stream
      ...               # command output files
  out/
    {id}-{sha256[:12]}.tag.gz   # compressed result
```

## Lifecycle

1. `/add` → validate command → `tid = str(int(time.time() * 1000))`
2. Spawn thread: `mkdir /data/temp/{tid}/` → `subprocess.Popen(cmd, cwd=tdir)`
3. Stream stdout to `download.log` with `[YYYY-MM-DDTHH:MM:SSZ]` prefixes
4. On success: `tar.gz(temp/{tid}/)` → SHA256 → `out/{tid}-{sha}.tag.gz`
5. On `/remove`: kill proc, `shutil.rmtree(temp/{tid})`, delete `out/{tid}-*`

## Nginx Config (Download-Only)

```nginx
worker { listen 9999; }

server {
    listen 8080 default_server;
    add_header Content-Security-Policy "default-src 'none'" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    root /data;

    location ~ ^/(add|remove|status|health)$ {
        proxy_pass http://worker;
    }

    location / {
        types { }
        default_type application/octet-stream;
        add_header Content-Disposition "attachment";
        add_header Cache-Control "no-store, no-cache" always;
        location ~ /\. { deny all; }
    }
}
```

## Dockerfile

```dockerfile
FROM python:3.13-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl wget nginx tar && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /data/temp /data/out
COPY worker.py /usr/local/bin/relay-worker
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 8080
CMD ["/bin/sh", "-c", "relay-worker & nginx -g 'daemon off;'"]
```

## Pitfalls

1. **`shell=True` is intentional** — commands like `git clone --depth=1` need shell for argument parsing. The triple-layer validation (metachar reject + pattern match + URL whitelist) makes this safe.
2. **Startup must wipe temp/** — leftover dirs from killed processes accumulate. `shutil.rmtree(temp, ignore_errors=True)` on startup.
3. **Purge stale out/ files** — anything > 1 week old should be deleted on startup to prevent unbounded disk usage.
4. **All files served as `application/octet-stream`** — never let nginx auto-detect content type for user-provided files. A `.html` or `.js` file would render in browser, bypassing CSP.
5. **XML listings also forced as `application/octet-stream`** — even directory listings should download as attachments, not render in browser.
6. **`python:3.13-slim` not `alpine`** — alpine's musl libc causes issues with some Python stdlib modules; slim (Debian) is more reliable for long-running workers.