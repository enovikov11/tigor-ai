#!/usr/bin/env python3
"""Render a terminal-style typing demo (grid of streams) from capture JSON.
Run INSIDE a container with PIL (the `vllm` podman container; fonts at
/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf). Emits PNG frames;
encode with ffmpeg (crf 18) for the delivery MP4. Edit the config block."""
import json, math, os
from PIL import Image, ImageDraw, ImageFont

IN = "/tmp/tps_demo/stream.json"
OUTDIR = "/tmp/tps_demo/frames"
FPS = 30
HOLD_S = 2.0      # hold the final frame
COLS = 2          # streams per row

BG = (13, 13, 18)
CELL_BG = (20, 20, 28)
BORDER = (44, 46, 60)
FG = (228, 230, 238)
PROMPT_COL = (110, 205, 110)
CURSOR = (90, 200, 255)
DIM = (110, 115, 135)
ACCENT = (255, 180, 80)
FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"

# ~2x sizes keep 1920-wide output crisp after H.264
FS = 22; LH = 30; CELL_W = 960; CELL_H = 300; MARGIN = 20; PAD = 14

data = json.load(open(IN))
streams = data["streams"]
t_all = data["t_all"]
n = len(streams)
rows = math.ceil(n / COLS)
W = COLS * CELL_W + (COLS + 1) * MARGIN
HDR_H = 70
H = HDR_H + MARGIN + rows * CELL_H + (rows + 1) * MARGIN
font = ImageFont.truetype(FONT_PATH, FS)
label_font = ImageFont.truetype(FONT_PATH, 20)
hdr_font = ImageFont.truetype(FONT_PATH, 28)
MAXW = CELL_W - 2 * PAD
MAXLINES = (CELL_H - 2 * PAD - 32 - 26) // LH

def wrap(text, fnt, maxw):
    """Word wrap with hard-split for oversized words.
    PITFALL: cur MUST be reset after flushing a line, or every line is
    re-appended every tick (duplicated-line bug)."""
    limit = maxw - 10
    lines = []
    for para in text.split("\n"):
        cur = ""
        for w in para.split(" "):
            cand = w if not cur else cur + " " + w
            if fnt.getlength(cand) <= limit:
                cur = cand
                continue
            if cur:
                lines.append(cur); cur = ""
            while fnt.getlength(w) > limit and w:
                k = len(w) - 1
                while k > 0 and fnt.getlength(w[:k]) > limit:
                    k -= 1
                lines.append(w[:k]); w = w[k:]
            if w:
                cur = w
        lines.append(cur)
    return lines

def short_topic(t, fnt, maxw):
    if fnt.getlength(t) <= maxw:
        return t
    while t and fnt.getlength(t + "…") > maxw:
        t = t[:-1]
    return t.rstrip() + "…"

preps = []
for i, s in enumerate(streams):
    full = "".join(e["c"] for e in s["events"])
    prefix, acc = [], 0
    for e in s["events"]:
        acc += len(e["c"]); prefix.append(acc)
    topic = s["prompt"].split(" про ")[-1].split(", в конце")[0]
    preps.append({"full": full, "prefix": prefix, "events": s["events"],
                  "topic": short_topic(topic, label_font, CELL_W - 2 * PAD - 90),
                  "n_total": (s["usage"] or {}).get("completion_tokens", s["n"])})

def count_at(i, t):
    """Number of tokens whose arrival time <= t (binary search)."""
    evts = streams[i]["events"]
    lo, hi = 0, len(evts)
    while lo < hi:
        mid = (lo + hi) // 2
        if evts[mid]["t"] <= t:
            lo = mid + 1
        else:
            hi = mid
    return lo

total_frames = int((t_all + HOLD_S) * FPS)

def render(f, t):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    done = t > t_all + 0.1
    if done:
        s_tps = data.get("server_tps")
        label = (f"{n} parallel streams @ vllm  |  "
                 f"{data['total_visible']} visible tok / "
                 f"{int(data.get('gen_delta') or 0)} total tok / "
                 f"{t_all:.1f}s = {s_tps} tps (server)")
    else:
        nn = sum(count_at(i, t) for i in range(n))
        label = f"{n} stream{'s' if n > 1 else ''} @ vllm  |  {nn} visible tok @ {t:.1f}s"
    d.text((MARGIN, 18), label, font=hdr_font, fill=(150, 155, 175))
    for i, p in enumerate(preps):
        col, row = i % COLS, i // COLS
        x0 = MARGIN + col * (CELL_W + MARGIN)
        y0 = HDR_H + MARGIN + row * (CELL_H + MARGIN)
        d.rounded_rectangle([x0, y0, x0 + CELL_W, y0 + CELL_H], radius=10,
                            fill=CELL_BG, outline=BORDER, width=2)
        d.text((x0 + PAD, y0 + 8), f"stream {i} · {p['topic']}",
               font=label_font, fill=PROMPT_COL)
        ev = p["events"]
        t_end_i = ev[-1]["t"] if ev else 0
        fin = t_end_i <= t
        ntok = count_at(i, t)
        tx, ty = x0 + PAD, y0 + PAD + 28
        if ntok > 0:
            lines = wrap(p["full"][:p["prefix"][ntok - 1]], font, MAXW)
            if len(lines) > MAXLINES:      # window: keep the newest lines
                lines = lines[-MAXLINES:]
            for j, ln in enumerate(lines):
                d.text((tx, ty + j * LH), ln, font=font, fill=FG)
            if not fin and (f // 3) % 2 == 0:   # cursor at end of last line
                cx = tx + font.getlength(lines[-1]) if lines[-1] else tx
                cy = ty + (len(lines) - 1) * LH
                d.rectangle([cx + 4, cy + 2, cx + 4 + 15, cy + 24], fill=CURSOR)
        elif (f // 3) % 2 == 0:
            d.rectangle([tx + 4, ty + 2, tx + 4 + 15, ty + 24], fill=CURSOR)
        if fin:
            dtp = (len(ev) - 1) / (t_end_i - ev[0]["t"]) if len(ev) >= 2 else 0
            d.text((x0 + PAD, y0 + CELL_H - 26),
                   f"{p['n_total']} tok · {t_end_i:.1f}s · {dtp:.0f} tps/req",
                   font=label_font, fill=ACCENT)
        else:
            d.text((x0 + PAD, y0 + CELL_H - 26), "generating…",
                   font=label_font, fill=DIM)
    return img

os.makedirs(OUTDIR, exist_ok=True)
for f in range(total_frames):
    render(f, f / FPS).save(f"{OUTDIR}/{f:04d}.png")
print(f"canvas={W}x{H} frames={total_frames} dur={total_frames / FPS:.2f}s")
