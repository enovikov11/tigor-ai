---
name: data-chart
description: Use when asked to render data as a chart image to send.
---

# Data chart rendering (tigor VM)

Goal: a clean chart PNG sent as an image, meeting the user's standing style spec, verified legible before sending.

## Rendering (no pip on host, no matplotlib in the vllm image)

1. One-off charts: write the plot script to a HOST file first (e.g. `/home/nixos/plot_<topic>.py` via terminal heredoc), then run it in a throwaway container:
   ```
   podman run --rm -v /home/nixos:/work:z docker.io/library/python:3.12-slim \
     sh -c "pip install --quiet --no-cache-dir matplotlib; python3 /work/plot_<topic>.py"
   ```
   - The mount root IS `/work`: host `/home/nixos/x` is `/work/x` inside — using host paths inside the container gives FileNotFoundError.
   - Long multi-line Python heredocs passed inline through `podman run sh -c` get mangled in transit (SyntaxError, broken strings) — the host-file-first pattern avoids this.
   - Output PNGs go under `/home/nixos/` so they're readable for the `MEDIA:` path.
2. Repeated/periodic charts (e.g. a 15-min progress cron): don't pip-install every tick — prebuild a small plot image with matplotlib baked in (`FROM python:3.12-slim; RUN pip install --no-cache-dir matplotlib`) and keep the render script on the host. The cron job runs one `podman run --rm -v <data-volume>:/datav:ro -v /home/nixos/<dir>:/work <plot-image> python3 /work/render.py <db> /work/out.png`; the script prints a one-line STATUS and the job replies `MEDIA:<png>` + that line (terminal-only toolset). DBs on a podman volume are host-readable at `~/.local/share/containers/storage/volumes/<name>/_data/` — the render can read them directly.

2. Dark theme (matplotlib): `fig.patch.set_facecolor('#0e1117')`, grid `#21262d`, text `#c9d1d9`/`#8b949e`, bars `#3fb950`.

## User's standing chart spec (applies to every chart sent)

- Linear scale with `%` labels — NOT log scale.
- Categorical x-axis in natural ascending order (e.g. 10–30), extras like `invalid` appended last — do NOT sort bars by value.
- Single uniform bar color — no per-bar highlight coloring.
- Keep image text to a high-level title + one-line description. Full methodology goes as message text sent alongside the image, never embedded in the figure.

## Label legibility rules

- Values ≥ ~1%: horizontal label above the bar.
- Tiny values on near-zero bars: rotate 90°, pin to the bar's right edge, short format (`%.2e` or `%.2e%%`) — horizontal labels collide on short adjacent bars.
- QA every rendered PNG with `vision_analyze` before sending, asking specifically about label overlap and edge clipping; re-render until it passes. Two rounds is normal: first pass catches caption clipping, second catches tail-label collisions.

## Reporting the numbers

When the chart shows a distribution, state the dropped/capped items explicitly in the message (which entry fell out of the cap and why) and give the top few values inline — the user asks follow-ups on exactly these.
