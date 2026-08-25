---
name: container-ops
description: Container image management — pull, save, transfer, load, inspect, and clean up images on podman.
---
# Container Operations

Pull, build, save, transfer, load, inspect, and remove container images. Runtime is **podman** on the host; `docker` CLI is pre-installed on the Hermes container and bridges to the podman socket.

## Architecture (post-migration, 2026-08)

Hermes Agent now runs **inside a rootless Podman container on the VM** (Debian 13 trixie). Neighboring containers on the same host:

| Container | Service | DNS name | Port |
|-----------|---------|----------|------|
| `vllm` | Qwen3.6-27B-FP8 (GPU) | `vllm` | 8000 |
| `forgejo` | Git server | `forgejo` | 3000 |
| `hermes` | Hermes Agent gateway | — | — |

All reachable via **container DNS** (e.g. `http://vllm:8000/v1`), not IP addresses.

Hermes container:
- Runs as `hermes:hermes` user (uid/gid 10000, no root, no --privileged, no sudo)
- Hermes home: `/home/nixos/.hermes` mounted to `/opt/data`
- Terminal backend: `local` (commands run inside the container)

## Triggers

- Pulling or pushing container images
- Transferring images between hosts
- Inspecting or cleaning container images
- Running containers on VM
- "No internet" / air-gapped container setup
- Managing services from inside Hermes container

## Quick reference

| Task | Command |
|------|---------|
| Pull image | `podman pull docker.io/library/<name>:<tag>` |
| Save to tar | `podman save -o /tmp/<name>.tar docker.io/library/<name>:<tag>` |
| Load from tar | `podman load -i /tmp/<name>.tar` |
| List images | `podman images` |
| Run and discard | `podman run --rm <image> <command>` |
| Remove image | `podman rmi <image>` |
| List containers | `docker ps` (via DOCKER_HOST env) |
| Stop container | `docker stop <name>` |
| Exec in container | `docker exec <name> <cmd>` |

## Transfer image to air-gapped VM

VM has no outbound internet. Pull on VPS, transfer via scp:

```bash
# On VPS
podman save -o /tmp/<image>.tar docker.io/library/<name>:<tag>
scp /tmp/<image>.tar nixos@10.67.69.2:/tmp/<image>.tar

# Via ssh
ssh nixos@10.67.69.2 "podman load -i /tmp/<image>.tar && podman images <name>"

# Cleanup
rm /tmp/<image>.tar && ssh nixos@10.67.69.2 "rm /tmp/<image>.tar"
```

## See Also

- `infrastructure/dockerize-python-service` — building Python service images
- `infrastructure/tigor-monorepo` — git workflow for the tigor repos (bare repo permissions)
