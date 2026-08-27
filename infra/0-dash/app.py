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
REPOS = {
    "tigor-ai": "/home/nixos/tigor-ai",
    "tigor-no-ai": "/home/nixos/tigor-no-ai",
}


def _git(path, *args):
    return subprocess.run(
        ["git", "-C", path, *args], capture_output=True, text=True, timeout=30
    )


def _worktree_info(wt, head, branch):
    info = {"path": wt, "branch": branch, "head": head[:7]}
    prunable = head.startswith("-") or not os.path.isdir(wt)
    if prunable:
        info["prunable"] = True
        return info
    if branch:
        # find remote-tracking ref for this branch in ANY remote
        v = _git(wt, "for-each-ref", "refs/remotes/*/" + branch, "--format=%(refname:short) %(objectname)")
        up = None
        if v.returncode == 0 and v.stdout.strip():
            line = v.stdout.splitlines()[0]
            upref, upsha = line.rsplit(" ", 1)
            up = upsha
            info["remote"] = upref
        if up is None:
            info["fresh"] = None
        else:
            info["fresh"] = up == head
            if up != head:
                c = _git(wt, "rev-list", "--left-right", "--count", head + "...refs/" + upref)
                if c.returncode == 0:
                    a, b = c.stdout.split()
                    info["ahead"], info["behind"] = int(a), int(b)
    else:
        info["fresh"] = None
    st = _git(wt, "status", "--porcelain")
    if st.returncode == 0:
        staged = unstaged = 0
        for line in st.stdout.splitlines():
            if len(line) < 3:
                continue
            x, y = line[0], line[1]
            if x != " " and x != "?":
                staged += 1
            if y != " " or x == "?":
                unstaged += 1
        info["staged"] = staged
        info["unstaged"] = unstaged
    else:
        info["staged"] = None
        info["unstaged"] = None
    return info


@app.get("/api/repos")
def api_repos():
    out = []
    for name, path in REPOS.items():
        entry = {"name": name, "worktrees": []}
        if not os.path.isdir(path):
            entry["error"] = "not mounted"
            out.append(entry)
            continue
        r = _git(path, "worktree", "list", "--porcelain")
        if r.returncode != 0:
            entry["error"] = r.stderr.strip() or "git failed"
            out.append(entry)
            continue
        blocks = [b for b in r.stdout.split("\n\n") if b.strip()]
        for b in blocks:
            d = {}
            for ln in b.splitlines():
                if ln.startswith("worktree "):
                    d["wt"] = ln[9:]
                elif ln.startswith("HEAD "):
                    d["head"] = ln[5:]
                elif ln.startswith("branch "):
                    d["branch"] = ln[7:].removeprefix("refs/heads/")
                elif ln.strip() == "prunable":
                    d["prunable"] = True
            if "wt" not in d or "head" not in d:
                continue
            info = _worktree_info(d["wt"], d["head"], d.get("branch"))
            if d.get("prunable"):
                info["prunable"] = True
            entry["worktrees"].append(info)
        out.append(entry)
    return {"repos": out}


def quant_of(path: str) -> str:
    if not path.lower().endswith(".gguf"):
        return ""
    parts = path.split("/")
    for s in (parts[-1], parts[-2] if len(parts) > 1 else ""):
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
    # per (top, relpath) -> bytes per disk (for mismatch + presence)
    fsize = defaultdict(lambda: {"ssd": 0, "hdd": 0})
    # group by (provider, model, quant) -> byte sums + dirs per (disk, top)
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
        key = (provider, model, q)
        n = g.setdefault(key, {"ssd": 0, "hdd": 0,
                               "dirs": defaultdict(set)})
        n[disk] += int(size)
        n["dirs"][(disk, top)].add(fdir)

    def key_parts(key):
        provider, model, q = key
        return (provider + "\x00" + model + "\x00" + q,
                provider + "\x00" + model, provider)

    # file-level size mismatch: same relative file on both disks, different size
    mm = set()
    # presence discrepancy: file exists on one disk only (count per quant group)
    disc = defaultdict(int)
    for (top, rest), v in fsize.items():
        if v["ssd"] == 0 and v["hdd"] == 0:
            continue
        parts = rest.split("/", 3)
        if len(parts) < 4:
            continue
        top2, provider, model, fpath = parts
        q = quant_of(fpath)
        k3 = (provider, model, q)
        if v["ssd"] > 0 and v["hdd"] > 0 and v["ssd"] != v["hdd"]:
            mm.add(k3)
        if (v["ssd"] > 0) != (v["hdd"] > 0):
            disc[k3] += 1

    rows = []
    for key, n in g.items():
        k3, k1, k0 = key_parts(key)
        provider, model, q = key
        rows.append({"level": 2, "key": k3, "p1": k1, "p0": k0,
                     "name": provider + "/" + model + ("/" + q if q else ""),
                     "ssd": n["ssd"], "hdd": n["hdd"],
                     "mm": key in mm, "dc": disc.get(key, 0),
                     "paths": sorted(common_dir(v) for v in n["dirs"].values())})

    mods = {}
    for key, n in g.items():
        k3, k1, k0 = key_parts(key)
        provider, model, q = key
        M = mods.setdefault(k1, {"ssd": 0, "hdd": 0, "mm": 0, "dc": 0, "qs": set()})
        M["ssd"] += n["ssd"]; M["hdd"] += n["hdd"]
        M["mm"] += int(key in mm)
        M["dc"] += disc.get(key, 0)
        if q:
            M["qs"].add(q)

    provs = {}
    for k1, M in mods.items():
        provider = k1.split("\x00")[0]
        P = provs.setdefault(provider, {"ssd": 0, "hdd": 0, "mm": 0, "dc": 0})
        P["ssd"] += M["ssd"]; P["hdd"] += M["hdd"]
        P["mm"] += M["mm"]; P["dc"] += M["dc"]

    for k1, M in mods.items():
        provider, model = k1.split("\x00")
        rows.append({"level": 1, "key": k1, "p1": None, "p0": provider,
                     "name": provider + "/" + model,
                     "ssd": M["ssd"], "hdd": M["hdd"],
                     "mm": M["mm"] > 0, "dc": M["dc"],
                     "hasQ": len(M["qs"]) > 0})

    for provider, P in provs.items():
        rows.append({"level": 0, "key": provider, "p1": None, "p0": None,
                     "name": provider,
                     "ssd": P["ssd"], "hdd": P["hdd"],
                     "mm": P["mm"] > 0, "dc": P["dc"]})
    return {"entries": rows}


INDEX = Path(__file__).parent / "index.html"


@app.get("/")
def index():
    return HTMLResponse(INDEX.read_text(encoding="utf-8"),
                        headers={"Cache-Control": "no-store, max-age=0"})
