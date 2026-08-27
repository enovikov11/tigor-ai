import os
import re
import subprocess
from collections import defaultdict
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse

ROOTS = [("ssd", "/ssd/public/internet"), ("hdd", "/hdd/public/internet")]
SCAN = " ".join(r + "/huggingface*" for _, r in ROOTS)
CMD = "find " + SCAN + " -type f -exec du -b {} +"
DF = "df -B1 " + " ".join(r for _, r in ROOTS)

QUANT = re.compile(r"(?<![A-Za-z0-9])((?:UD-)?(?:MXFP4|I?Q\d+|F\d+|BF16|FP16|FP32)(?:_[A-Z0-9]+)*)", re.I)

app = FastAPI()
INDEX = Path(__file__).parent / "index.html"


def quant_of(path: str) -> str:
    if not path.lower().endswith(".gguf"):
        return ""
    parts = path.split("/")
    for s in (parts[-1], parts[-2]):
        m = QUANT.search(s)
        if m:
            return m.group(1).upper()
    return ""


@app.get("/api/disks")
def disks():
    p = subprocess.run(["sh", "-c", DF], capture_output=True, text=True, timeout=30)
    out = []
    for line in p.stdout.splitlines()[1:]:
        f = line.split()
        if len(f) < 6:
            continue
        mount = f[5]
        for name, root in ROOTS:
            if mount == root:
                out.append({"disk": name, "mount": mount,
                            "total_gb": int(f[1]) // 2**30,
                            "used_gb": int(f[2]) // 2**30})
    return {"disks": out}


def common_dir(dirs):
    dirs = sorted(dirs)
    if not dirs:
        return ""
    if len(dirs) == 1:
        return dirs[0]
    first = dirs[0].split("/")
    for d in dirs[1:]:
        parts = d.split("/")
        for i, seg in enumerate(first):
            if i >= len(parts) or parts[i] != seg:
                first = first[:i]
                break
    return "/".join(first)


@app.get("/api/sizes")
def sizes():
    p = subprocess.run(["sh", "-c", CMD], capture_output=True, text=True, timeout=600)
    # per (top, relpath) -> {ssd:bytes, hdd:bytes, q} for mismatch detection
    fsize = defaultdict(lambda: {"ssd": 0, "hdd": 0, "q": None})
    # group by (provider,model,quant) -> per (disk,top) -> dirs, and byte sums
    g = {}
    for line in p.stdout.splitlines():
        size, path = line.split("\t", 1)
        disk = "ssd" if path.startswith("/ssd/") else "hdd"
        rest = path.split("/internet/", 1)[1]
        parts = rest.split("/", 3)
        if len(parts) < 4:
            continue
        top, provider, model, fpath = parts
        q = quant_of(path)
        fdir = path.rsplit("/", 1)[0]
        fsize[(top, rest)][disk] += int(size)
        if fsize[(top, rest)]["q"] is None:
            fsize[(top, rest)]["q"] = q
        key = (provider, model, q)
        n = g.setdefault(key, {"ssd": 0, "hdd": 0,
                               "dirs": defaultdict(set),
                               "provd": set(), "modeld": set()})
        n[disk] += int(size)
        n["dirs"][(disk, top)].add(fdir)
        n["provd"].add("/" + disk + "/public/internet/" + top + "/" + provider)
        n["modeld"].add("/" + disk + "/public/internet/" + top + "/" + provider + "/" + model)

    # mismatches: same (top,rel) on both disks, different size
    mm = set()
    for (top, rest), v in fsize.items():
        if v["ssd"] > 0 and v["hdd"] > 0 and v["ssd"] != v["hdd"]:
            parts = rest.split("/", 3)
            if len(parts) >= 4:
                mm.add((parts[1], parts[2], v["q"] or ""))
    mm_model = {(a, b) for (a, b, c) in mm}
    mm_prov = {a for (a, b, c) in mm}

    provs = {}
    mods = {}
    for (provider, model, q), n in g.items():
        mk = provider + "\x00" + model
        M = mods.setdefault(mk, {"p": provider, "m": model, "ssd": 0, "hdd": 0,
                                 "qs": set(), "provd": set(), "modeld": set()})
        P = provs.setdefault(provider, {"p": provider, "ssd": 0, "hdd": 0,
                                        "nmods": set(), "provd": set()})
        M["ssd"] += n["ssd"]; M["hdd"] += n["hdd"]
        if q:
            M["qs"].add(q)
        P["ssd"] += n["ssd"]; P["hdd"] += n["hdd"]
        P["nmods"].add(mk)
        M["provd"] |= n["provd"]; M["modeld"] |= n["modeld"]
        P["provd"] |= n["provd"]

    rows = []

    def paths_of(dirmap):
        out = []
        for (disk, top), dirs in dirmap.items():
            out.append(common_dir(dirs))
        return sorted(out)

    # quant rows
    for (provider, model, q), n in g.items():
        rows.append({"level": 2, "key": provider + "\x00" + model + "\x00" + q,
                     "parent": provider + "\x00" + model,
                     "name": provider + "/" + model + ("/" + q if q else ""),
                     "ssd": n["ssd"], "hdd": n["hdd"],
                     "mm": (provider, model, q) in mm,
                     "canSplit": False, "hasQ": True,
                     "paths": paths_of(n["dirs"])})
    # model rows
    for mk, M in mods.items():
        provider, model = M["p"], M["m"]
        rows.append({"level": 1, "key": mk, "parent": provider,
                     "name": provider + "/" + model,
                     "ssd": M["ssd"], "hdd": M["hdd"],
                     "mm": (provider, model) in mm_model,
                     "canSplit": len(M["qs"]) >= 1,
                     "hasQ": len(M["qs"]) > 0,
                     "paths": sorted(M["modeld"])})
    # provider rows
    for provider, P in provs.items():
        rows.append({"level": 0, "key": provider, "parent": None,
                     "name": provider,
                     "ssd": P["ssd"], "hdd": P["hdd"],
                     "mm": provider in mm_prov,
                     "canSplit": len(P["nmods"]) >= 1,
                     "hasQ": False,
                     "paths": sorted(P["provd"])})
    return {"entries": rows}


@app.get("/")
def index():
    return HTMLResponse(INDEX.read_text(encoding="utf-8"),
                        headers={"Cache-Control": "no-store, max-age=0"})
