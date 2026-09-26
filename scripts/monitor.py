#!/usr/bin/env python3
"""Sample both TN10 nodes and the box every N seconds into JSONL.
Writes /tmp/tn10-break.STOP when a safety limit trips (disk<8G, mem<1G, tip age>180s).
usage: monitor.py OUT.jsonl [interval_s]"""
import asyncio, json, os, sys, time, shutil, subprocess
import websockets
OUT = sys.argv[1]; IV = float(sys.argv[2]) if len(sys.argv) > 2 else 10
NODES = {"n0": (18210, "/tmp/kaspa-data-tn10-n0"), "n1": (18220, "/tmp/kaspa-data-tn10-n1")}
STOP = "/tmp/tn10-break.STOP"
HZ = os.sysconf("SC_CLK_TCK")
prev_cpu = {}

def kaspad_pids():
    out = {}
    for p in os.listdir("/proc"):
        if not p.isdigit(): continue
        try:
            a = open(f"/proc/{p}/cmdline").read().split("\0")
            if a and a[0].endswith("/kaspad"):
                for n, (jp, d) in NODES.items():
                    if f"--appdir={d}" in a: out[n] = int(p)
        except Exception: pass
    return out

def proc_stats(pid):
    try:
        st = open(f"/proc/{pid}/stat").read().rsplit(")", 1)[1].split()
        cpu = (int(st[11]) + int(st[12])) / HZ
        rss = int(open(f"/proc/{pid}/statm").read().split()[1]) * 4096 / 2**20
        fds = len(os.listdir(f"/proc/{pid}/fd"))
        return cpu, rss, fds
    except Exception: return None, None, None

async def call(ws, i, m, params=None):
    await ws.send(json.dumps({"id": i, "method": m, "params": params or {}}))
    while True:
        r = json.loads(await asyncio.wait_for(ws.recv(), timeout=8))
        if r.get("id") == i: return r.get("params") or {}

async def node_sample(n, port):
    t0 = time.time()
    try:
        async with websockets.connect(f"ws://127.0.0.1:{port}", open_timeout=5, close_timeout=2, max_size=2**24) as ws:
            s = await call(ws, 1, "getSyncStatus")
            dag = await call(ws, 2, "getBlockDagInfo")
            info = await call(ws, 3, "getInfo")
            blk = await call(ws, 4, "getBlock", {"hash": dag["sink"], "includeTransactions": False})
            ts = int(blk["block"]["header"]["timestamp"])
            conn = await call(ws, 5, "getConnections", {"includeProfileData": False}) if False else {}
            return {"ok": True, "synced": s.get("isSynced"), "daa": int(dag["virtualDaaScore"]),
                    "blocks": int(dag["blockCount"]), "sink_age_s": round(time.time() - ts / 1000, 1),
                    "mempool": int(info.get("mempoolSize", -1)), "rpc_ms": round((time.time() - t0) * 1000)}
    except Exception as e:
        return {"ok": False, "err": f"{type(e).__name__}:{str(e)[:120]}", "rpc_ms": round((time.time() - t0) * 1000)}

def du(d):
    try: return int(subprocess.run(["du", "-sm", d], capture_output=True, text=True, timeout=60).stdout.split()[0])
    except Exception: return None

async def main():
    k = 0
    while True:
        t = time.time(); rec = {"t": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "epoch": round(t, 1)}
        pids = kaspad_pids()
        res = await asyncio.gather(*[node_sample(n, jp) for n, (jp, _) in NODES.items()])
        for (n, (jp, d)), r in zip(NODES.items(), res):
            pid = pids.get(n); r["pid"] = pid
            if pid:
                cpu, rss, fds = proc_stats(pid)
                if cpu is not None:
                    pc = prev_cpu.get(pid)
                    r["cpu_pct"] = round((cpu - pc[0]) / (t - pc[1]) * 100, 1) if pc else None
                    prev_cpu[pid] = (cpu, t)
                r["rss_mb"] = round(rss) if rss else None; r["fds"] = fds
            if k % 6 == 0: r["appdir_mb"] = du(d)
            rec[n] = r
        rec["load1"] = float(open("/proc/loadavg").read().split()[0])
        rec["mem_avail_mb"] = int(next(l for l in open("/proc/meminfo") if l.startswith("MemAvailable")).split()[1]) // 1024
        rec["disk_free_gb"] = round(shutil.disk_usage("/").free / 2**30, 2)
        reasons = []
        if rec["disk_free_gb"] < 8: reasons.append("disk")
        if rec["mem_avail_mb"] < 1000: reasons.append("mem")
        for n in NODES:
            r = rec[n]
            if r.get("ok") and r.get("sink_age_s", 0) > 180: reasons.append(f"{n}_tip_age")
        if reasons:
            rec["STOP"] = reasons
            open(STOP, "w").write(json.dumps(rec))
        with open(OUT, "a") as f: f.write(json.dumps(rec) + "\n")
        k += 1
        await asyncio.sleep(max(0.5, IV - (time.time() - t)))
asyncio.run(main())
