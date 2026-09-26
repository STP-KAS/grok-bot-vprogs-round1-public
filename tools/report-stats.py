#!/usr/bin/env python3
"""Summarise storm logs for a time window. Usage: report-stats.py LOGDIR [FROM_HH:MM] [TO_HH:MM]
Reads tps12h/nettps.jsonl, tps12h/supervisor.jsonl, monitor.jsonl. Prints compact JSON."""
import json, sys, statistics as st
d = sys.argv[1]; lo = sys.argv[2] if len(sys.argv) > 2 else "00:00"; hi = sys.argv[3] if len(sys.argv) > 3 else "99:99"
def rows(p):
    for l in open(f"{d}/{p}"):
        try: yield json.loads(l)
        except Exception: pass
def hm(t): return t[11:16]
def inwin(t): return lo <= hm(t) < hi
def summ(xs):
    xs = [x for x in xs if x is not None]
    if not xs: return None
    xs.sort(); return {"n": len(xs), "min": round(xs[0],1), "p50": round(xs[len(xs)//2],1), "mean": round(st.mean(xs),1), "max": round(xs[-1],1)}
out = {"window": [lo, hi]}
n = [r for r in rows("tps12h/nettps.jsonl") if inwin(r["t"])]
out["net_tps_10s"] = summ([r["net_tps"] for r in n]); out["tx_per_block"] = summ([r["tpb"] for r in n])
out["blocks_per_s"] = summ([r["blocks"]/r["secs"] for r in n])
s = [r for r in rows("tps12h/supervisor.jsonl") if "accepted_tps" in r and inwin(r["t"])]
out["sup_accepted_tps"] = summ([r["accepted_tps"] for r in s]); out["sup_offered_tps"] = summ([r.get("offered_tps") for r in s])
out["sup_mempool_n0"] = summ([r["nodes"].get("n0", {}).get("mempool") for r in s])
if s: out["fees_tkas_first_last"] = [s[0].get("fees_tkas"), s[-1].get("fees_tkas")]; out["disk_free_first_last"] = [s[0].get("disk_free_gb"), s[-1].get("disk_free_gb")]
m = [r for r in rows("monitor.jsonl") if inwin(r["t"])]
for node in ("n0", "n1"):
    mm = [r[node] for r in m if isinstance(r.get(node), dict) and r[node].get("ok")]
    out[f"mon_{node}"] = {"mempool": summ([x.get("mempool") for x in mm]), "rss_mb": summ([x.get("rss_mb") for x in mm]),
        "unsynced_samples": sum(1 for x in mm if not x.get("synced")), "down_samples": sum(1 for r in m if isinstance(r.get(node), dict) and not r[node].get("ok"))}
out["mon_disk_free_first_last"] = [m[0].get("disk_free_gb"), m[-1].get("disk_free_gb")] if m else None
print(json.dumps(out))
