#!/bin/bash
# Caddy access-log stats. Args: [since] e.g. 24h, 30m, 1h (default all)
SINCE="${1:-}"
if [ -n "$SINCE" ]; then
  LOG=$(docker logs --since "$SINCE" caddy 2>&1)
else
  LOG=$(docker logs caddy 2>&1)
fi
echo "$LOG" | grep http.log.access | python3 -c "
import json,sys
from collections import Counter
tot=0; ips=Counter(); host=Counter(); status=Counter(); api=0; apiips=Counter()
for line in sys.stdin:
    try:
        d=json.loads(line)
        r=d['request']
        tot+=1
        ips[r['client_ip']]+=1
        host[r['host']]+=1
        status[d.get('status','?')]+=1
        if r['uri'].startswith('/v1/systemone'):
            api+=1; apiips[r['client_ip']]+=1
    except Exception: pass
print('total requests : %d'%tot)
print('unique clients : %d'%len(ips))
print('API calls      : %d  (unique: %d)'%(api,len(apiips)))
print('by site        : '+' , '.join('%s=%d'%(h,n) for h,n in host.most_common()))
print('top statuses   : '+' , '.join('%s=%d'%(s,n) for s,n in status.most_common(6)))
print('top clients    :')
for ip,n in ips.most_common(5): print('   %-16s %d'%(ip,n))
"
