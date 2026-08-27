import re
import subprocess

from fastapi import FastAPI
from fastapi.responses import HTMLResponse

ROOTS = [
    ("ssd", "/ssd/public/internet/huggingface*"),
    ("hdd", "/hdd/public/internet/huggingface*"),
]

CMD = "find " + " ".join(r for _, r in ROOTS) + " -type f -exec du -b {} +"

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


@app.get("/api/sizes")
def sizes():
    p = subprocess.run(["sh", "-c", CMD], capture_output=True, text=True, timeout=600)
    total = {}
    for line in p.stdout.splitlines():
        size, path = line.split("\t", 1)
        disk = "ssd" if path.startswith("/ssd/") else "hdd"
        parts = path.split("/internet/", 1)[1].split("/", 3)
        model = "/".join(parts[1:3]) if len(parts) >= 3 else parts[-1]
        key = (disk, model, quant_of(path))
        total[key] = total.get(key, 0) + int(size)
    rows = []
    for (disk, model, q), b in total.items():
        rows.append({"path": disk + "/" + model + ("/" + q if q else ""), "bytes": b})
    rows.sort(key=lambda r: r["bytes"], reverse=True)
    return {"entries": rows}


@app.get("/", response_class=HTMLResponse)
def index():
    return HTML


HTML = """<!doctype html>
<html><head><meta charset="utf-8"><title>sizes</title>
<style>
body{font-family:monospace;background:#111;color:#eee;padding:2rem}
table{border-collapse:collapse;width:100%}
td,th{padding:.35em .8em;border-bottom:1px solid #333}
td:nth-child(2),th:nth-child(2){text-align:right}
td:nth-child(3){white-space:nowrap}
tr:hover{background:#1e1e1e}
.legend{color:#999}
</style></head><body>
<h1>model sizes</h1>
<p class="legend" id="legend"></p>
<table><thead><tr><th>path</th><th>GB</th><th></th></tr></thead>
<tbody id="rows"></tbody></table>
<script>
const BIG = '\\u{1F7E5}', SMALL = '\\u{1F534}';
document.getElementById('legend').innerHTML = BIG+' = 100 GB &#183; '+SMALL+' = 10 GB &#183; round up';
fetch('/api/sizes').then(r=>r.json()).then(d=>{
  document.getElementById('rows').innerHTML = d.entries.map(e=>{
    const gb = e.bytes/1073741824;
    return '<tr><td>'+e.path+'</td><td>'+gb.toFixed(2)+'</td><td>'+
      BIG.repeat(Math.ceil(gb/100))+SMALL.repeat(Math.ceil(gb/10))+'</td></tr>';
  }).join('');
}).catch(e=>document.getElementById('rows').innerHTML='<tr><td>'+e+'</td></tr>');
</script>
</body></html>"""