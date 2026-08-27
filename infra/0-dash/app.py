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
        mount, dev = f[5], f[0]
        for name, root in ROOTS:
            if mount == root:
                out.append({"disk": name, "mount": mount,
                            "total_gb": int(f[1]) // 2**30,
                            "used_gb": int(f[2]) // 2**30})
    return {"disks": out}


@app.get("/api/sizes")
def sizes():
    p = subprocess.run(["sh", "-c", CMD], capture_output=True, text=True, timeout=600)
    total = {}
    for line in p.stdout.splitlines():
        size, path = line.split("\t", 1)
        disk = "ssd" if path.startswith("/ssd/") else "hdd"
        parts = path.split("/internet/", 1)[1].split("/", 3)
        provider = parts[1] if len(parts) >= 3 else ""
        model = parts[2] if len(parts) >= 3 else parts[-1]
        key = (disk, provider, model, quant_of(path))
        total[key] = total.get(key, 0) + int(size)
    rows = []
    for (disk, provider, model, q), b in total.items():
        rows.append({"disk": disk, "provider": provider, "model": model,
                     "quant": q, "bytes": b})
    return {"entries": rows}


@app.get("/", response_class=HTMLResponse)
def index():
    resp = HTMLResponse(HTML)
    resp.headers["Cache-Control"] = "no-store, max-age=0"
    return resp


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
h2{margin:2em 0 .5em}
.bar{background:#333;border-radius:3px;height:.9em;overflow:hidden;display:inline-block;width:20em;vertical-align:middle}
.bar i{display:block;height:100%;background:#4a4}
.btn{cursor:pointer;background:#222;color:#8f8;border:none;border-radius:3px;font-family:inherit;padding:0 .5em;margin-left:.5em}
</style></head><body>
<h1>model sizes</h1>
<p class="legend" id="legend">&#183; 🐘 = 100 GB &#183; 🐭 = 10 GB &#183; 🧊 = quant &#183; round up &#183; ⊞ = split</p>
<div id="disks"></div>
<div id="sections"></div>
<script>
const DISK = {ssd: '⚡', hdd: '🐢'}, Q = '🧊';
let leaves = [], state = {ssd:{p:new Set(),m:new Set()}, hdd:{p:new Set(),m:new Set()}};
function icons(gb){const b=Math.ceil(gb/10);return '🐘'.repeat(Math.floor(b/10))+'🐭'.repeat(b%10);}
function copy(el){
  const p = el.dataset.p;
  const done = () => { el.textContent='✓'; setTimeout(()=>el.textContent='⧉',1000); };
  const fb = () => { const t=document.createElement('textarea'); t.value=p; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); done(); };
  if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(p).then(done).catch(fb); } else { fb(); }
}
function build(disk, el){
  const st = state[disk];
  const rows = leaves.filter(l=>l.disk===disk);
  const provs = {}, models = {};
  for(const l of rows){
    const pk = l.provider;
    provs[pk] = (provs[pk]||0) + l.bytes;
    const mk = l.provider + '/' + l.model;
    const m = models[mk] = models[mk] || {bytes:0, provider:l.provider, model:l.model, quants:[]};
    m.bytes += l.bytes;
    if(l.quant) m.quants.push({...l, key: mk + '/' + l.quant});
  }
  const out = [];
  for(const [pk, pb] of Object.entries(provs)){
    if(!st.p.has(pk)){ out.push({bytes:pb, path:disk+'/'+pk, quant:false, split:true}); continue; }
    for(const [mk, m] of Object.entries(models)){
      if(m.provider !== pk) continue;
      if(st.m.has(mk) && m.quants.length>1){
        for(const q of m.quants) out.push({bytes:q.bytes, path:disk+'/'+q.key, quant:true, split:false});
      } else {
        out.push({bytes:m.bytes, path:disk+'/'+mk, quant:m.quants.length>0, split:m.quants.length>1});
      }
    }
  }
  out.sort((a,b)=>b.bytes-a.bytes);
  el.innerHTML = '<table><thead><tr><th>path</th><th>GB</th><th></th><th></th></tr></thead><tbody>' +
    out.map(e=>{
      const gb = e.bytes/1073741824;
      return '<tr><td data-path="'+e.path+'">'+e.path+(e.quant?' '+Q:'')+'</td><td>'+gb.toFixed(2)+'</td><td>'+icons(gb)+'</td><td>'+
        (e.split?'<button class="btn" data-d="'+disk+'" onclick="toggle(this)">⊞</button>':'') +
        '<button class="btn" data-p="'+e.path+'" onclick="copy(this)">⧉</button></td></tr>';
    }).join('') + '</tbody></table>';
}
function toggle(el){
  const disk = el.dataset.d, st = state[disk];
  const path = el.closest('tr').querySelector('td[data-path]').dataset.path;
  if(path.indexOf('/') === disk.length && path.slice(disk.length+1).indexOf('/') === -1) st.p[path] ? st.p.delete(path) : st.p.add(path);
  else st.m[path] ? st.m.delete(path) : st.m.add(path);
  build(disk, document.getElementById('tbl-'+disk));
}
function buildAll(){
  for(const d of ['ssd','hdd']) build(d, document.getElementById('tbl-'+d));
}
Promise.all([
  fetch('/api/disks').then(r=>r.json()),
  fetch('/api/sizes').then(r=>r.json())
]).then(([dk, sz])=>{
  leaves = sz.entries;
  document.getElementById('disks').innerHTML = dk.disks.map(d=>{
    const pct = Math.round(d.used_gb/d.total_gb*100);
    return '<p>'+DISK[d.disk]+' '+d.mount+': '+d.used_gb+' / '+d.total_gb+' GB ('+pct+'%)'+
      ' <span class="bar"><i style="width:'+pct+'%"></i></span></p>';
  }).join('');
  document.getElementById('sections').innerHTML = ['ssd','hdd'].map(d=>
    '<h2>'+DISK[d]+' '+d.toUpperCase()+'</h2><div id="tbl-'+d+'"></div>').join('');
  buildAll();
}).catch(e=>document.body.innerHTML += '<pre>'+e+'</pre>');
</script>
</body></html>"""
