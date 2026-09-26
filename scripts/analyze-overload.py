#!/usr/bin/env python3
"""Analyse the fee-tier overload probes. usage: analyze-overload.py  -> logs/overload/analysis.json (+ short stdout)
Windows come from logs/storm/ramp.log lines 'PHASE*' ; probes grouped by the phase label they were submitted in."""
import json, statistics as st, datetime as dt, collections, re, sys
D = "/workspace/tn10-break-test-2026-09-25"
def ts(s):
    s = s.replace("Z", "+00:00")
    if re.search(r"[+-]\d{4}$", s): s = s[:-2] + ":" + s[-2:]
    return dt.datetime.fromisoformat(s.replace(" ", "T")).timestamp()
def pct(a, p):
    if not a: return None
    a = sorted(a); k = (len(a) - 1) * p / 100; f = int(k); c = min(f + 1, len(a) - 1)
    return round(a[f] + (a[c] - a[f]) * (k - f), 2)
P = [json.loads(l) for l in open(f"{D}/logs/overload/probes.jsonl")]
sub = {}; acc = {}; ev = set()
for r in P:
    if r["ev"] == "submit": sub[r["id"]] = r
    elif r["ev"] == "accepted": acc[r["id"]] = r
    elif r["ev"] == "evicted": ev.add(r["id"])
now = ts(P[-1]["t"])
def summarise(ids):
    out = {}
    tiers = sorted({sub[i]["mult"] for i in ids})
    for m in tiers:
        s = [sub[i] for i in ids if sub[i]["mult"] == m]; ok = [x for x in s if x["ok"]]
        lat = [acc[x["id"]]["lat_s"] for x in ok if x["id"] in acc]
        pend = [x for x in ok if x["id"] not in acc and x["id"] not in ev]
        rej = collections.Counter(re.sub(r".*?(not standard: [a-z ]+|orphan|mempool is full|[a-z ]{0,40}full[a-z ]{0,20}|already|double).*", r"\1", x["err"])[:60] for x in s if not x["ok"])
        out[str(m)] = {"sent": len(s), "rejected": len(s) - len(ok), "reject_reasons": dict(rej), "included": len(lat),
                       "evicted_never_included": len([x for x in ok if x["id"] in ev and x["id"] not in acc]),
                       "evicted_then_included": len([x for x in ok if x["id"] in ev and x["id"] in acc]),
                       "pending": len(pend), "pending_oldest_s": round(max([now - ts(x["t"]) for x in pend] or [0]), 1),
                       "p50_s": pct(lat, 50), "p90_s": pct(lat, 90), "max_s": max(lat) if lat else None, "mean_s": round(st.mean(lat), 2) if lat else None,
                       "fee_sompi": int(s[0]["fee"]) if s else None, "mass": int(s[0]["mass"]) if s else None}
    return out
phases = collections.defaultdict(list)
for i, r in sub.items(): phases[r["phase"]].append(i)
res = {"phases": {ph: summarise(ids) for ph, ids in phases.items()}}
# 5-min buckets for P1 (by submit time)
p1 = sorted(phases.get("P1-overload", []), key=lambda i: ts(sub[i]["t"]))
if p1:
    t0 = ts(sub[p1[0]]["t"]); b = collections.defaultdict(list)
    for i in p1: b[int((ts(sub[i]["t"]) - t0) // 300)].append(i)
    res["p1_buckets_5min"] = {f"{k*5:02d}-{k*5+5:02d}min": summarise(v) for k, v in sorted(b.items())}
# ramp windows
ramp = [l.split(" ", 2) for l in open(f"{D}/logs/storm/ramp.log") if " PHASE" in l]
W = {}
for t, tag, *_ in ramp: W[tag] = ts(t)
res["ramp_marks"] = {k: dt.datetime.fromtimestamp(v).strftime("%H:%M:%S") for k, v in W.items()}
# mempool / tps / fee per window
mon = []
for l in open(f"{D}/logs/monitor.jsonl"):
    try: r = json.loads(l); mon.append((r["epoch"], r["n0"].get("mempool")))
    except Exception: pass
sup = []
for l in open(f"{D}/logs/tps12h/supervisor.jsonl"):
    try:
        r = json.loads(l)
        if "accepted_tps" in r: sup.append((ts(r["t"]), r["accepted_tps"], r["fees_tkas"], r.get("rate_cap")))
    except Exception: pass
net = []
for l in open(f"{D}/logs/tps12h/nettps.jsonl"):
    try: r = json.loads(l); net.append((ts(r["t"]), r["net_tps"], r.get("mass_compute")))
    except Exception: pass
def win(a, b, bucket=300):
    m = [x for t, x in mon if a <= t < b and x is not None]; n = [x for t, x, _ in net if a <= t < b]
    s = [x for x in sup if a <= x[0] < b]
    burn = sum(max(0, s[k + 1][2] - s[k][2]) for k in range(len(s) - 1))
    mins = (b - a) / 60
    curve = []
    for k in range(int((b - a) // bucket) + 1):
        mm = [x for t, x in mon if a + k * bucket <= t < min(b, a + (k + 1) * bucket) and x is not None]
        nn = [x for t, x, _ in net if a + k * bucket <= t < min(b, a + (k + 1) * bucket)]
        if mm or nn: curve.append({"from_min": k * bucket // 60, "mp_min": min(mm) if mm else None, "mp_p50": pct(mm, 50), "mp_max": max(mm) if mm else None, "net_tps_avg": round(st.mean(nn), 0) if nn else None})
    return {"minutes": round(mins, 1), "mempool_min": min(m) if m else None, "mempool_p50": pct(m, 50), "mempool_max": max(m) if m else None,
            "net_tps_avg": round(st.mean(n), 1) if n else None, "net_tps_p10": pct(n, 10), "net_tps_p90": pct(n, 90),
            "storm_fee_tkas": round(burn, 2), "storm_fee_tkas_per_10min": round(burn / mins * 10, 2) if mins else None, "curve": curve}
marks = sorted(W.items(), key=lambda x: x[1])
res["windows"] = {}
for k, (tag, t) in enumerate(marks):
    end = marks[k + 1][1] if k + 1 < len(marks) else now
    if end - t > 60: res["windows"][tag] = win(t, end)
json.dump(res, open(f"{D}/logs/overload/analysis.json", "w"), indent=1)
for ph, tiers in res["phases"].items():
    print(ph, " | ".join(f"{m}x n={v['sent']} rej={v['rejected']} inc={v['included']} ev={v['evicted_never_included']} pend={v['pending']} p50={v['p50_s']} p90={v['p90_s']} max={v['max_s']}" for m, v in tiers.items()))
