import subprocess

from fastapi import FastAPI
from fastapi.responses import HTMLResponse, JSONResponse

ROOTS = {
    "hdd": "/hdd/public/internet",
    "ssd": "/ssd/public/internet",
}

CMD = "find ./huggingface* -mindepth 2 -maxdepth 2 -type d -exec du -s {} +"

app = FastAPI()


@app.get("/api/{disk}")
def sizes(disk: str):
    root = ROOTS.get(disk)
    if root is None:
        return JSONResponse({"error": "unknown disk, use hdd or ssd"}, status_code=404)
    p = subprocess.run(
        ["sh", "-c", CMD], cwd=root, capture_output=True, text=True, timeout=600
    )
    rows = []
    for line in p.stdout.splitlines():
        parts = line.split("\t", 1)
        if len(parts) == 2:
            rows.append({"size_kb": int(parts[0]), "path": parts[1].lstrip("./")})
    rows.sort(key=lambda r: r["size_kb"], reverse=True)
    return {"disk": disk, "root": root, "entries": rows}


@app.get("/", response_class=HTMLResponse)
def index():
    return HTML


HTML = """<!doctype html>
<html><head><meta charset="utf-8"><title>HF sizes</title>
<style>
body{font-family:monospace;background:#111;color:#eee;padding:2rem}
button{margin-right:1em;padding:.4em 1em;font-family:inherit}
table{border-collapse:collapse;width:100%}
td,th{padding:.35em .8em;border-bottom:1px solid #333;text-align:right}
td:first-child,th:first-child{text-align:left}
tr:hover{background:#1e1e1e}
</style></head><body>
<h1>huggingface* sizes</h1>
<button onclick="load('hdd')">/hdd</button>
<button onclick="load('ssd')">/ssd</button>
<p id="err"></p>
<table><thead><tr><th>path</th><th>size</th><th>GB</th></tr></thead>
<tbody id="rows"></tbody></table>
<script>
async function load(disk){
  document.getElementById('err').textContent = 'loading ' + disk + '...';
  try{
    const r = await fetch('/api/' + disk);
    const d = await r.json();
    if(d.error){document.getElementById('err').textContent = d.error;return;}
    document.getElementById('err').textContent = d.root + ' (' + d.entries.length + ' dirs)';
    const gb = 1024*1024;
    document.getElementById('rows').innerHTML = d.entries.map(e =>
      '<tr><td>' + e.path + '</td><td>' + e.size_kb + ' KB</td><td>' +
      (e.size_kb/gb).toFixed(2) + '</td></tr>').join('');
  }catch(e){document.getElementById('err').textContent = String(e);}
}
</script>
</body></html>"""
