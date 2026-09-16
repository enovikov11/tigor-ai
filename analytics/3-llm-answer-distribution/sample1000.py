import json, re, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
URL="http://127.0.0.1:8000/v1/chat/completions"
MODEL="Qwen3.8-27B-FP8"
PROMPT="Pick a number between 10 and 30"
N=1000
def one(i):
    body={"model":MODEL,"messages":[{"role":"user","content":PROMPT}],
          "max_tokens":60,"temperature":1.0,"top_p":1.0,
          "chat_template_kwargs":{"enable_thinking":False}}
    req=urllib.request.Request(URL,data=json.dumps(body).encode(),
        headers={"Content-Type":"application/json"})
    for a in range(5):
        try:
            with urllib.request.urlopen(req,timeout=120) as r: d=json.load(r)
            m=d["choices"][0]["message"]
            return m.get("reasoning") or "" + (m.get("content") or "")
        except Exception:
            if a==4: return None
            time.sleep(2*(a+1))
t0=time.time()
with ThreadPoolExecutor(8) as ex:
    texts=list(ex.map(one, range(N)))
ok=[t for t in texts if t is not None]
print("n=",len(ok),"of",N,"t=%.0fs"%(time.time()-t0))
from collections import Counter
c=Counter(); no_num=0
for t in ok:
    nums=[int(x) for x in re.findall(r"\d+",t) if 10<=int(x)<=30]
    if nums: c[nums[0]]+=1
    else: no_num+=1
print("first in-range number (n=%d):"%len(ok))
for n in range(10,31):
    if c.get(n): print("  %d: %d (%.1f%%)"%(n,c[n],c[n]/len(ok)*100))
print("no in-range number:",no_num)
json.dump({"counts":{str(k):v for k,v in sorted(c.items())},"no_number":no_num,
           "n":len(ok),"texts":ok}, open("sample1000.json","w"))
