#!/usr/bin/env python3
"""Rebuild a tps/storm state file from the public TN10 API (confirmed UTXOs only).
usage: recover-utxos.py FROM TO OUT.json   (addresses from the storm key file; keys are not read or printed)"""
import json, sys, urllib.request
FROM, TO, OUT = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
ks = json.load(open("/home/box/secure/tn10-storm-keys.json"))[FROM:TO]
addr2i = {k["address"]: k["i"] for k in ks}
out, n = {}, 0
addrs = list(addr2i)
for j in range(0, len(addrs), 25):
    req = urllib.request.Request("https://api-tn10.kaspa.org/addresses/utxos", data=json.dumps({"addresses": addrs[j:j+25]}).encode(),
                                 headers={"content-type": "application/json", "user-agent": "curl/8.5.0", "accept": "application/json"})
    for u in json.load(urllib.request.urlopen(req, timeout=60)):
        i = addr2i[u["address"]]
        out.setdefault(str(i), []).append([u["outpoint"]["transactionId"], u["outpoint"]["index"], u["utxoEntry"]["amount"], "any"]); n += 1
json.dump(out, open(OUT, "w"))
print(json.dumps({"wallets": len(out), "utxos": n, "tkas": sum(int(x[2]) for l in out.values() for x in l) / 1e8}))
