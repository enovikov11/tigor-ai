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
.btn{cursor:pointer;background:#222;color:#8f8;border:none;border-radius:3px;font-family:inherit;padding:0 .5em;margin-left:.5em}
</style></head><body>
<h1>model sizes</h1>
<p class="legend">⚡ ssd &#183; 🐢 hdd &#183; 🐘 = 100 GB &#183; 🐭 = 10 GB &#183; 🧊 = quant &#183; round up &#183; ⊞ = split</p>
<table><thead><tr><th>path</th><th>GB</th><th></th><th></th></tr></thead>
<tbody id="rows"></tbody></table>
<script>
const DISK = {ssd: '⚡', hdd: '🐢'}, Q = '🧊';
let leaves = [], expP = new Set(), expM = new Set();
const pkey = (d,p)=>d+'/'+p, mkey=(d,p,m)=>d+'/'+p+'/'+m;
function icons(gb){const b=Math.ceil(gb/10);return '🐘'.repeat(Math.floor(b/10))+'🐭'.repeat(b%10);}
function copy(el){
  const p = el.dataset.p;
  const done = () => { el.textContent='✓'; setTimeout(()=>el.textContent='⧉',1000); };
  const fb = () => { const t=document.createElement('textarea'); t.value=p; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); done(); };
  if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(p).then(done).catch(fb); } else { fb(); }
}
function toggle(path){
  const parts = path.split('/');
  const s = parts.length===2 ? expP : expM;
  s.has(path) ? s.delete(path) : s.add(path);
  build();
}
function build(){
  const provs = {}, models = {};
  for(const l of leaves){
    const pk = pkey(l.disk, l.provider);
    (provs[pk] = provs[pk] || {bytes:0, disk:l.disk}).bytes += l.bytes;
    const mk = mkey(l.disk, l.provider, l.model);
    const m = models[mk] = models[mk] || {bytes:0, disk:l.disk, provider:l.provider, model:l.model, quants:[]};
    m.bytes += l.bytes;
    if(l.quant) m.quants.push({...l, key: mk+'/'+l.quant});
  }
  const out = [];
  for(const [pk, p] of Object.entries(provs)){
    if(!expP.has(pk)){ out.push({bytes:p.bytes, disk:p.disk, path:pk, quant:false, split:true}); continue; }
    for(const [mk, m] of Object.entries(models)){
      if(mkey(m.disk, m.provider, m.model) !== mk) continue;
      if(m.disk+'/'+m.provider !== pk) continue;
      if(expM.has(mk) && m.quants.length>1){
        for(const q of m.quants) out.push({bytes:q.bytes, disk:q.disk, path:q.key, quant:true, split:false});
      } else {
        out.push({bytes:m.bytes, disk:m.disk, path:mk, quant:m.quants.length>0, split:m.quants.length>1});
      }
    }
  }
  out.sort((a,b)=>b.bytes-a.bytes);
  document.getElementById('rows').innerHTML = out.map(e=>{
    const gb = e.bytes/1073741824;
    return '<tr><td>'+DISK[e.disk]+' '+e.path+(e.quant?' '+Q:'')+'</td><td>'+gb.toFixed(2)+'</td><td>'+
      icons(gb)+'</td><td>'+(e.split?'<button class="btn" onclick="toggle(\''+e.path+'\')">⊞</button>':'') +
      '<button class="btn" data-p="'+e.path+'" onclick="copy(this)">⧉</button></td></tr>';
  }).join('');
}
fetch('/api/sizes').then(r=>r.json()).then(d=>{leaves=d.entries; build();})
  .catch(e=>document.getElementById('rows').innerHTML='<tr><td>'+e+'</td></tr>');
</script>
</body></html>"""
