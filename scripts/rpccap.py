#!/usr/bin/env python3
"""Open many RPC clients against one node and hold them, then release and check recovery.
gRPC: each client is its own channel (local subchannel pool => own TCP connection) with one MessageStream,
sending getInfoRequest. wRPC: plain websocket connections to the JSON port, sending getInfo.
usage: rpccap.py grpc|wrpc HOST:PORT N HOLD_S"""
import sys, time, json, threading, queue, asyncio
sys.path.insert(0, "/workspace/tn10-break-test-2026-09-25/scripts/grpc_stubs")
kind, target, N, HOLD = sys.argv[1], sys.argv[2], int(sys.argv[3]), float(sys.argv[4])
def now(): return time.strftime("%Y-%m-%dT%H:%M:%S%z")
def out(**k): print(json.dumps({"t": now(), **k}), flush=True)
if kind == "grpc":
    import grpc, messages_pb2 as mm, rpc_pb2 as rp, messages_pb2_grpc as mg
    class Client:
        def __init__(s, i):
            s.i = i; s.q = queue.Queue(); s.ch = grpc.insecure_channel(target, options=[("grpc.use_local_subchannel_pool", 1)])
            s.stub = mg.RPCStub(s.ch); s.stream = None; s.alive = True
        def gen(s):
            while s.alive:
                try: r = s.q.get(timeout=0.5)
                except queue.Empty: continue
                if r is None: return
                yield r
        def ask(s, timeout=5):
            t0 = time.time()
            try:
                if s.stream is None: s.stream = s.stub.MessageStream(s.gen())
                s.q.put(mm.KaspadRequest(id=1, getInfoRequest=rp.GetInfoRequestMessage()))
                resp = next(s.stream)
                return {"ok": True, "ms": round((time.time() - t0) * 1000), "mempool": resp.getInfoResponse.mempoolSize}
            except grpc.RpcError as e:
                return {"ok": False, "ms": round((time.time() - t0) * 1000), "code": str(e.code()), "detail": (e.details() or "")[:160]}
            except Exception as e:
                return {"ok": False, "ms": round((time.time() - t0) * 1000), "err": f"{type(e).__name__}:{str(e)[:160]}"}
        def close(s):
            s.alive = False; s.q.put(None)
            try: s.ch.close()
            except Exception: pass
    clients = []; res = []
    for i in range(N):
        c = Client(i); r = [None]
        th = threading.Thread(target=lambda: r.__setitem__(0, c.ask()), daemon=True); th.start(); th.join(8)
        rr = r[0] or {"ok": False, "err": "timeout 8s"}; res.append(rr); clients.append(c)
        if i < 3 or not rr["ok"] or i % 10 == 9: out(phase="open", i=i + 1, **rr)
    okc = sum(1 for r in res if r["ok"]); out(phase="opened", n=N, ok=okc, failed=N - okc)
    t_end = time.time() + HOLD
    while time.time() < t_end:
        time.sleep(10)
        alive = 0
        for c, r in zip(clients, res):
            if r["ok"]:
                x = [None]; th = threading.Thread(target=lambda: x.__setitem__(0, c.ask(3)), daemon=True); th.start(); th.join(4)
                if x[0] and x[0]["ok"]: alive += 1
        p = Client(-1); x = [None]; th = threading.Thread(target=lambda: x.__setitem__(0, p.ask()), daemon=True); th.start(); th.join(8); p.close()
        out(phase="hold", held_alive=alive, fresh_probe=x[0] or {"ok": False, "err": "timeout"})
    t0 = time.time()
    for c in clients: c.close()
    out(phase="released", n=len(clients))
    for k in range(30):
        p = Client(-2); x = [None]; th = threading.Thread(target=lambda: x.__setitem__(0, p.ask()), daemon=True); th.start(); th.join(8); p.close()
        if x[0] and x[0]["ok"]: out(phase="recovered", after_s=round(time.time() - t0, 1), **x[0]); break
        out(phase="not yet", after_s=round(time.time() - t0, 1), probe=x[0]); time.sleep(2)
else:
    import websockets
    async def one(i):
        t0 = time.time()
        try:
            ws = await websockets.connect(f"ws://{target}", open_timeout=8, max_size=2**22)
            await ws.send(json.dumps({"id": 1, "method": "getInfo", "params": {}}))
            r = json.loads(await asyncio.wait_for(ws.recv(), 8))
            return ws, {"ok": "params" in r, "ms": round((time.time() - t0) * 1000), "err": str(r.get("error"))[:120] if "error" in r else None}
        except Exception as e:
            return None, {"ok": False, "ms": round((time.time() - t0) * 1000), "err": f"{type(e).__name__}:{str(e)[:160]}"}
    async def main():
        conns = []; res = []
        for i in range(N):
            ws, r = await one(i); conns.append(ws); res.append(r)
            if i < 3 or not r["ok"] or i % 25 == 24: out(phase="open", i=i + 1, **r)
        okc = sum(1 for r in res if r["ok"]); out(phase="opened", n=N, ok=okc, failed=N - okc)
        t_end = time.time() + HOLD
        while time.time() < t_end:
            await asyncio.sleep(10)
            alive = 0
            for ws in conns:
                if ws is None: continue
                try:
                    await ws.send(json.dumps({"id": 2, "method": "getInfo", "params": {}})); await asyncio.wait_for(ws.recv(), 3); alive += 1
                except Exception: pass
            ws, r = await one(-1)
            if ws: await ws.close()
            out(phase="hold", held_alive=alive, fresh_probe=r)
        t0 = time.time()
        for ws in conns:
            if ws:
                try: await ws.close()
                except Exception: pass
        out(phase="released", n=N)
        ws, r = await one(-2)
        if ws: await ws.close()
        out(phase="after release", after_s=round(time.time() - t0, 1), **r)
    asyncio.run(main())
