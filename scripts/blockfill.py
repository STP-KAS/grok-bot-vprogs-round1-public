#!/usr/bin/env python3
"""Every ~5 s: read the sink block and its mergeset-blue parents from n1, record tx count and summed mass.
Gives a rough view of how full blocks get under load. usage: blockfill.py OUT.jsonl"""
import asyncio, json, sys, time, websockets
OUT = sys.argv[1]
async def call(ws, i, m, p):
    await ws.send(json.dumps({"id": i, "method": m, "params": p}))
    while True:
        r = json.loads(await asyncio.wait_for(ws.recv(), 15))
        if r.get("id") == i: return r.get("params") or {}
async def main():
    seen = set()
    async with websockets.connect("ws://127.0.0.1:18220", max_size=2**26) as ws:
        i = 0
        while True:
            i += 1
            dag = await call(ws, i, "getBlockDagInfo", {})
            b = await call(ws, i + 100000, "getBlock", {"hash": dag["sink"], "includeTransactions": True})
            blk = b.get("block", {}); vd = blk.get("verboseData", {})
            rec = {"t": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "sink": dag["sink"][:16], "daa": int(blk["header"]["daaScore"]),
                   "txs": len(blk.get("transactions", [])), "mass_sum": sum(int(t.get("mass", 0) or 0) for t in blk.get("transactions", [])),
                   "merge_blues": len(vd.get("mergeSetBluesHashes", [])), "merge_reds": len(vd.get("mergeSetRedsHashes", []))}
            with open(OUT, "a") as f: f.write(json.dumps(rec) + "\n")
            await asyncio.sleep(5)
asyncio.run(main())
