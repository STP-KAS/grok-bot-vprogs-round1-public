#!/usr/bin/env python3
"""Our miners' block share over a past window, from miner logs + our node monitor (network block count).
usage: minershare.py START_ISO END_ISO [color_sample_per_node=60]
Share = our 'Block submitted successfully' lines / network blocks added (blockCount delta on n1 from logs/monitor.jsonl).
Color: getCurrentBlockColor on a random sample of our found blocks in the window (asked at run time)."""
import asyncio, json, os, re, sys, random, datetime as dt, glob
import websockets
S = dt.datetime.fromisoformat(sys.argv[1]).timestamp(); E = dt.datetime.fromisoformat(sys.argv[2]).timestamp()
NS = int(sys.argv[3]) if len(sys.argv) > 3 else 60
MON = "/workspace/tn10-break-test-2026-09-25/logs/monitor.jsonl"
ts_re = re.compile(r"^\[(\S+)Z ")
PORT = {"16220": "n1", "16210": "n0"}
def pts(l):
    m = ts_re.match(l)
    return dt.datetime.fromisoformat(m.group(1)).replace(tzinfo=dt.timezone.utc).timestamp() if m else None
# map miner index -> port from the live process list (miner logs don't name the port); fallback: unknown
idx2node = {}
for p in os.listdir("/proc"):
    if not p.isdigit(): continue
    try:
        a = open(f"/proc/{p}/cmdline").read().split("\0")
        if "--user-agent-suffix" in a and a[a.index("--user-agent-suffix") + 1].startswith("gb"):
            idx2node[a[a.index("--user-agent-suffix") + 1][2:]] = PORT.get(a[a.index("-p") + 1], "?")
    except Exception: pass
found = {"n0": [], "n1": [], "?": []}; sub = {"n0": 0, "n1": 0, "?": 0}; hr = {}; errs = 0
for f in glob.glob("/tmp/relqunch-miners/logs/miner-*.log"):
    idx = f.split("-")[-1][:3]; node = idx2node.get(idx, "?")
    with open(f, "rb") as fh:
        fh.seek(0, 2); sz = fh.tell(); fh.seek(max(0, sz - 6_000_000)); lines = fh.read().decode(errors="ignore").splitlines()
    for l in lines:
        t = pts(l)
        if t is None or t < S or t > E: continue
        if "Found a block" in l: found[node].append((t, l.split()[-1]))
        elif "submitted successfully" in l: sub[node] += 1
        elif "Current hashrate is" in l:
            v, u = re.search(r"is: ([\d.]+) (\S+)", l).groups(); hr.setdefault(idx, []).append(float(v) * {"hash/s": 1, "Khash/s": 1e3, "Mhash/s": 1e6}.get(u, 1))
        elif " ERROR " in l or " WARN " in l: errs += 1
mon = [json.loads(l) for l in open(MON)]
inwin = [m for m in mon if S <= m["epoch"] <= E and m.get("n1", {}).get("ok")]
net_blocks = inwin[-1]["n1"]["blocks"] - inwin[0]["n1"]["blocks"] if len(inwin) > 1 else None
span = inwin[-1]["epoch"] - inwin[0]["epoch"] if len(inwin) > 1 else None
ours_in_span = sum(sub.values()) * (span / (E - S)) if span else None
async def color(node, port):
    cand = [h for t, h in found[node]]
    samp = random.sample(cand, min(NS, len(cand))); b = r = u = 0
    async with websockets.connect(f"ws://127.0.0.1:{port}", max_size=None, open_timeout=5) as ws:
        for i, h in enumerate(samp):
            await ws.send(json.dumps({"id": i, "method": "getCurrentBlockColor", "params": {"hash": h}}))
            x = json.loads(await asyncio.wait_for(ws.recv(), 10)); p = x.get("params") or {}
            if x.get("error") or "blue" not in p: u += 1
            elif p["blue"]: b += 1
            else: r += 1
    return {"blue": b, "red": r, "unknown": u}
colors = {}
for n, port in (("n0", 18210), ("n1", 18220)):
    try: colors[n] = asyncio.run(color(n, port))
    except Exception as e: colors[n] = {"err": str(e)[:100]}
res = {"start": sys.argv[1], "end": sys.argv[2], "window_s": E - S, "our_submitted": sub, "our_found": {k: len(v) for k, v in found.items()},
       "our_hashrate_MHs": round(sum(sum(v) / len(v) for v in hr.values()) / 1e6, 2) if hr else None,
       "net_blocks_n1_view": net_blocks, "monitor_span_s": span,
       "block_share_pct": round(100 * ours_in_span / net_blocks, 2) if net_blocks else None,
       "net_bps": round(net_blocks / span, 2) if span else None, "miner_err_warn_lines": errs, "color_sample": colors}
print(json.dumps(res))
