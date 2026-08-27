import re
import subprocess

from fastapi import FastAPI
from fastapi.responses import HTMLResponse

ROOTS = [
    ("ssd", "/ssd/public/internet"),
    ("hdd", "/hdd/public/internet"),
]
SCAN = " ".join(r + "/huggingface*" for _, r in ROOTS)
CMD = "find " + SCAN + " -type f -exec du -b {} +"
DF = "df -B1 " + " ".join(r for _, r in ROOTS)

QUANT = re.compile(r"(?<![A-Za-z0-9])((?:UD-)?(?:MXFP4|I?Q\d+|F\d+|BF16|FP16|FP32)(?:_[A-Z0-9]+)*)", re.I)

app = FastAPI()


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


@app.get("/api/sizes")
def sizes():
    p = subprocess.run(["sh", "-c", CMD], capture_output=True, text=True, timeout=600)
    rows = []
    for line in p.stdout.splitlines():
        size, path = line.split("\t", 1)
        disk = "ssd" if path.startswith("/ssd/") else "hdd"
        rest = path.split("/internet/", 1)[1].split("/", 3)
        rows.append({"disk": disk,
                     "provider": rest[1] if len(rest) >= 3 else "",
                     "model": rest[2] if len(rest) >= 3 else rest[-1],
                     "quant": quant_of(path),
                     "rel": rest[2] if len(rest) >= 3 else rest[-1],
                     "bytes": int(size)})
    return {"entries": rows}


@app.get("/")
def index():
    return HTMLResponse(INDEX.read_text(encoding="utf-8"),
                       headers={"Cache-Control": "no-store, max-age=0"})


from pathlib import Path

INDEX = Path(__file__).parent / "index.html"


