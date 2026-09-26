#!/bin/bash
# Network TPS as seen by n1: kaspad logs "Processed N blocks ... (T transactions ...)" every 10 s; T/10 = network tx/s
# (all TN10 traffic, ours + others, including coinbase txs). Appends to logs/tps12h/nettps.jsonl until /tmp/tps-storm.HALT.
O=/workspace/tn10-break-test-2026-09-25/logs/tps12h/nettps.jsonl; L=/tmp/kaspa-logs-tn10-n0/rusty-kaspa.log; last=""
while [ ! -f /tmp/tps-storm.HALT ]; do
  l=$(grep "Processed .* blocks and .* headers in the last" $L | tail -1)
  if [ "$l" != "$last" ] && [ -n "$l" ]; then last="$l"
    echo "$l" | python3 -c '
import sys,re,json
l=sys.stdin.read(); m=re.search(r"^(\S+ \S+) .*Processed (\d+) blocks.*last ([\d.]+)s \((\d+) transactions.*?([\d.]+) TPB; mass: ([\d.]+)s/([\d.]+)c/([\d.]+)t", l)
if m: print(json.dumps({"t":m[1],"blocks":int(m[2]),"secs":float(m[3]),"txs":int(m[4]),"net_tps":round(int(m[4])/float(m[3]),1),"tpb":float(m[5]),"mass_storage":float(m[6]),"mass_compute":float(m[7]),"mass_transient":float(m[8])}))' >> $O
  fi; sleep 5; done
