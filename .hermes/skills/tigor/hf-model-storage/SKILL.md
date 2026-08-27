---
name: hf-model-storage
description: "Check/estimate/clean HF model downloads on the VM."
---

# HF Model Storage Ops (VM)

Class: large HF model downloads parked on VM storage. Covers: is the download
complete, how long until it is, and what can actually be deleted.

## Where things live

- `/hdd/public/internet/huggingface-temp/<org>/<model>` — active downloads (47T virtiofs)
- `/ssd/public/vm/hermes/data/huggingface.co/<org>/<model>` — finished model library (5.3T virtiofs)
- `/home/nixos` — VM's own disk (491G ext4), don't park models here

## Check if a download is complete

```bash
D=/hdd/public/internet/huggingface-temp/MiniMaxAI/MiniMax-H3
find $D/.cache/huggingface/download -name '*.incomplete'   # >0 = mid-download
du -sb $D | cut -f1                                        # bytes on disk
curl -s https://huggingface.co/api/models/MiniMaxAI/MiniMax-H3 | python3 -c "import json,sys; print(json.load(sys.stdin)['usedStorage'])"
```

Complete = zero `.incomplete` AND on-disk bytes ≈ API `usedStorage`
(plus a few hundred MB of cache overhead). Also cross-check that root-level
components (transformer/, text_encoder/, vae/…) exist, not just submodules.

## Estimate ETA of a running download

Two `du -sb` snapshots 15s apart:

```bash
s1=$(du -sb $D | cut -f1); sleep 15; s2=$(du -sb $D | cut -f1)
echo "rate MB/s: $(( (s2-s1)/15/1000000 ))"
echo "left GB: $(( (total_bytes - s2)/1073741824 ))"   # total_bytes from API usedStorage
```

ETA minutes = (total_bytes - s2) / ((s2-s1)/15) / 60. Report the measured rate,
not the nominal link speed.

## Resume a broken download

```bash
hf download <org>/<model> --local-dir $D
```

Resumes from `.cache/huggingface/download` partials; no need to re-download.

## Deletion: permission reality (pitfall)

- VM user is `nixos` uid 1000, **no sudo in the container**.
- Files on the virtiofs mounts are often owned by a **host uid (e.g. 165533)**
  — the account that ran the download on the host. `rm` gives Permission
  denied; half the tree (dirs) may delete, files will not.
- Don't retry variants or escalate blindly: `stat -c '%U %u %a %n' <file>`
  first, confirm the owner mismatch, then tell the user to run the `rm -rf`
  **on the NixOS host** (with sudo if owned by root/other user).
- Report exactly what got deleted vs what is stuck, with sizes.
