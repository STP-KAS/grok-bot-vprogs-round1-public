#!/usr/bin/env python3
"""Rebuild storm wallet UTXO lists from the public TN10 API (our nodes have no utxoindex).
usage: rebuild-storm-state.py FROM TO OUT.json"""
import json, sys, urllib.request, concurrent.futures as cf
a, b, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
addrs = [l.split() for l in open("/workspace/tn10-break-test-2026-09-25/storm-addresses.txt")][a:b]
def get(ia):
    i, ad = ia
    for _ in range(3):
        try:
            u = json.load(urllib.request.urlopen(urllib.request.Request(f"https://api-tn10.kaspa.org/addresses/{ad}/utxos", headers={"User-Agent": "curl/8"}), timeout=20))
            return i, [[x["outpoint"]["transactionId"], x["outpoint"]["index"], x["utxoEntry"]["amount"], "any"] for x in u]
        except Exception: pass
    return i, None
res = {}
with cf.ThreadPoolExecutor(8) as ex:
    for i, v in ex.map(get, addrs):
        if v is not None: res[i] = v
json.dump(res, open(out, "w"))
print(json.dumps({"wallets": len(res), "utxos": sum(len(v) for v in res.values()), "sompi": sum(int(x[2]) for v in res.values() for x in v)}))
