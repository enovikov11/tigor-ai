# HF inventory: sizes per model/quant (2026-08)

## Layout (current)

- `/ssd/public/internet/huggingface.co` + `huggingface.co-temp` — SSD library
- `/hdd/public/internet/huggingface.co` + `huggingface.co-temp` — HDD bulk (mirrors SSD, holds extras)
- `/public/internet/` also has non-HF trees (`kiwix/`, `wikipedia/`, `*.zim`) — **always scope `find` to `huggingface*`** or the inventory picks up ZIM dumps.

## Inventory command

```bash
find /ssd/public/internet/huggingface* /hdd/public/internet/huggingface* -type f -exec du -b {} +
```

~2.9k files, seconds warm. Group in Python: disk from path prefix, model = 2 segments after the `huggingface*` dir.

## GGUF quant autodetect

`.gguf` files only; search **filename first, then parent dir** (layouts: `<model>/<Q4_K_M>/*.gguf`, `<model>/<name>-UD-Q8_K_XL.gguf`, `<model>/gguf/`):

```python
QUANT = re.compile(r'(?<![A-Za-z0-9])((?:UD-)?(?:MXFP4|I?Q\d+|F\d+|BF16|FP16|FP32)(?:_[A-Z0-9]+)*)', re.I)
```

Lookbehind is required — `SIQ-1` in a filename otherwise yields a fake `Q1`. Verified: all 200 gguf on both disks, zero misses/false positives. Tokens seen: `UD-Q*_XL/M/S`, `IQ*_NL/XS/S/XXS`, `Q*_K_*`, `Q4_0/1`, `Q8_0`, `BF16`, `F16`, `F32` (mmproj), `MXFP4_MOE`.

## Service

`infra/0-dash` in tigor-ai: FastAPI + one static page, `:1337`, `GET /api/sizes` runs the find once for both disks, returns `ssd|hdd/user/model[/quant]` + bytes. Emoji scale in JS: one big glyph per 100 GB, one small per 10 GB, always `Math.ceil` up, legend at top.
