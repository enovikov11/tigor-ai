"""Conservation test: replicate worker.py process/advance/bucket logic, run
best-first against live vLLM for N expansions, assert mass ledger stays 1.0."""
import math, json, urllib.request
URL="http://127.0.0.1:8000/v1/chat/completions"; MODEL="Qwen3.8-27B-FP8"
PROMPT="Pick a number between 10 and 30"
STOP=chr(60)+chr(124)+"im_end"+chr(124)+chr(62)
MAX_DEPTH=100; LOOKAHEAD=15; TOP_K=100; FETCH_K=300; BUCKET_FLOOR=-15
N_EXP=500

BASE=(chr(60)+"im_start"+chr(62)+chr(10)+"user"+chr(10)+PROMPT+chr(10)+chr(10)
      +chr(60)+"im_end"+chr(62)+chr(10)+chr(10)
      +chr(60)+"im_start"+chr(62)+chr(10)+"assistant"+chr(10)
      +chr(60)+"think"+chr(62)+chr(10)+chr(10)+chr(60)+"/think"+chr(62)+chr(10)+chr(10))
def fetch(prefix):
    body={"model":MODEL,"prompt":BASE+prefix,"max_tokens":1,
          "logprobs":FETCH_K,"temperature":0.0}
    req=urllib.request.Request("http://127.0.0.1:8000/v1/completions",
        data=json.dumps(body).encode(),headers={"Content-Type":"application/json"})
    with urllib.request.urlopen(req,timeout=120) as r: d=json.load(r)
    tl=d["choices"][0]["logprobs"]["top_logprobs"][0]
    return [{"token":t,"logprob":lp} for t,lp in tl.items()]

buckets={}; hi=[0]; frontier=[0.0]; pruned=[0.0]; ctr=[0]
def push(mass,item):
    global hi
    if mass<10.0**BUCKET_FLOOR: pruned[0]+=mass; return
    b=min(0,math.floor(math.log10(mass))); ctr[0]+=1
    buckets.setdefault(b,[]).append((mass,item,ctr[0])); frontier[0]+=mass
    if b>hi[0]: hi[0]=b
def pop():
    while True:
        lst=buckets.get(hi[0])
        if lst:
            m,i,_=lst.pop()
            if not lst: del buckets[hi[0]]
            frontier[0]-=m; return m,i
        hi[0]-=1
        if hi[0]<BUCKET_FLOOR: return None

answers={}; vm=[0.0]; vo=[0.0]; vl=[0.0]
def acc(v,n,m):
    if v=="answer": answers[n]=answers.get(n,0.0)+m
    elif v=="MULTIPLE_NUMBERS": vm[0]+=m
    elif v=="OUT_OF_RANGE": vo[0]+=m
    else: vl[0]+=m

def advance(od,t):
    buf=od; ev=[]
    for ch in t:
        if ch.isdigit(): buf+=ch
        elif buf: ev.append(int(buf)); buf=""
    return ev,buf

def process(m,item,dist):
    text,phase,answer,depth,la,od=item
    pmap={e["token"]:math.exp(e["logprob"]) for e in dist}
    p_stop=pmap.get(STOP,0.0)
    kids=sorted(((t,p) for t,p in pmap.items() if t!=STOP),key=lambda x:-x[1])[:TOP_K]
    if phase==0:
        if depth>=MAX_DEPTH:
            nums=[int(od)] if od else []
            if len(nums)>=2: acc("MULTIPLE_NUMBERS",None,m)
            elif nums: acc(("answer" if 10<=nums[0]<=30 else "OUT_OF_RANGE"),nums[0] if 10<=nums[0]<=30 else None,m)
            else: acc("LENGTH_EXCEEDED_NO_NUMBERS",None,m)
            return []
        flush=[int(od)] if od else []
        if len(flush)>=2: acc("MULTIPLE_NUMBERS",None,m*p_stop)
        elif flush: acc(("answer" if 10<=flush[0]<=30 else "OUT_OF_RANGE"),flush[0] if 10<=flush[0]<=30 else None,m*p_stop)
        else: acc("OUT_OF_RANGE",None,m*p_stop)
        p_topk=sum(p for _,p in kids)
        out=[]
        for tok,p in kids:
            ev,buf=advance(od,tok)
            if not ev: out.append((m*p,(text+tok,0,None,depth+1,LOOKAHEAD,buf)))
            elif len(ev)>=2: acc("MULTIPLE_NUMBERS",None,m*p)
            elif 10<=ev[0]<=30: out.append((m*p,(text+tok,1,ev[0],depth+1,LOOKAHEAD,buf)))
            else: acc("OUT_OF_RANGE",None,m*p)
        pruned[0]+=m*max(0.0,1.0-p_stop-p_topk)
        return out
    if la<=0 or depth>=MAX_DEPTH:
        flush=[int(od)] if od else []
        if flush: acc("MULTIPLE_NUMBERS",None,m)
        else: acc("answer",answer,m)
        return []
    flush=[int(od)] if od else []
    if flush: acc("MULTIPLE_NUMBERS",None,m*p_stop)
    else: acc("answer",answer,m*p_stop)
    p_topk=sum(p for _,p in kids)
    out=[]
    for tok,p in kids:
        ev,buf=advance(od,tok)
        if ev: acc("MULTIPLE_NUMBERS",None,m*p)
        else: out.append((m*p,(text+tok,1,answer,depth+1,la-1,buf)))
    acc("answer",answer,m*max(0.0,1.0-p_stop-p_topk))
    return out

push(1.0,("",0,None,0,LOOKAHEAD,""))
exp=0; worst=0.0
while exp<N_EXP:
    g=pop()
    if g is None: break
    m,item=g
    dist=fetch(item[0])
    for mi in process(m,item,dist): push(mi[0],mi[1])
    exp+=1
    if exp%50==0:
        tot=sum(answers.values())+vm[0]+vo[0]+vl[0]+pruned[0]+frontier[0]
        worst=max(worst,abs(tot-1.0))
        print(f"exp={exp} total={tot:.12f} drift={tot-1.0:+.2e} "
              f"valid={sum(answers.values()):.5f} oor={vo[0]:.5f} pruned={pruned[0]:.5f} frontier={frontier[0]:.5f}")
print("max drift:", worst)
print("top answers:", sorted(answers.items(), key=lambda x:-x[1])[:8])
assert worst<1e-6, "MASS LEAK (float eps 1e-9 per 40k ops is expected)"
print("CONSERVATION OK")
