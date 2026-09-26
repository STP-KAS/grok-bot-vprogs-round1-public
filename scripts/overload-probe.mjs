// Fee-tier overload probe (TN10 only). Every CYCLE ms sends one tiny 1-in-1-out self-transfer per fee tier
// (feerate = MULT x node min relay feerate MINRATE=100 sompi/gram; 1.2x = what the storm pays) to n0, then tracks acceptance into the virtual chain
// (getVirtualChainFromBlock acceptedTransactionIds, polled every 1 s) and mempool presence (getMempoolEntry).
// Wallets: storm keys 400-799 (NOT used by the live rwstorm fleet: P0-P7 use P2SH tag wallets, H uses keys 0-399).
// UTXOs seeded from the public TN10 API via recover-utxos.py 400 800 -> logs/overload/probe-seed-400-800.json. Keys are never printed.
// Phase label read from /tmp/overload.phase. Stops on /tmp/overload-probe.STOP. Log: logs/overload/probes.jsonl
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { kaspa, connect, sleep, NET } from "./lib.mjs";
const D = "/workspace/tn10-break-test-2026-09-25", LOG = `${D}/logs/overload/probes.jsonl`, ST = `${D}/logs/overload/probe-state.json`;
const TIERS = (process.env.TIERS || "1,1.2,2,5,10,100").split(",").map(Number);
const MINRATE = Number(process.env.MINRATE || 100); // node min relay feerate, sompi/gram (measured: 10 rejected "not standard", 100 accepted; rwstorm base = 100)
const CYCLE = Number(process.env.CYCLE || 30000), EVICT_GRACE = 20000;
const keys = JSON.parse(readFileSync("/home/box/secure/tn10-storm-keys.json", "utf8")).filter((k) => k.i >= 400 && k.i < 800);
const W = new Map(keys.map((k) => [k.i, { i: k.i, key: new kaspa.PrivateKey(k.key), address: k.address, spk: kaspa.payToAddressScript(k.address) }]));
const out = (o) => appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), phase: phase(), ...o }, (k, v) => typeof v === "bigint" ? v.toString() : v) + "\n");
const phase = () => { try { return readFileSync("/tmp/overload.phase", "utf8").trim(); } catch { return "none"; } };
// pool: [walletIndex, txid, index, amountString]
let pool = [];
if (existsSync(ST)) pool = JSON.parse(readFileSync(ST, "utf8")).pool;
else for (const f of [`${D}/logs/overload/probe-seed-400-800.json`]) { const s = JSON.parse(readFileSync(f, "utf8")); for (const [i, us] of Object.entries(s)) for (const u of us) if (W.has(+i)) pool.push([+i, u[0], u[1], String(u[2])]); }
pool.sort(() => Math.random() - 0.5);
const save = () => writeFileSync(ST + ".tmp", JSON.stringify({ pool })) || writeFileSync(ST, JSON.stringify({ pool }));
const rpc = await connect("n0");
const pend = new Map(); // txid -> {id, tier, t0, w, amt, miss}
let seq = 0, vstart = (await rpc.getBlockDagInfo({})).sink, cyc = 0;
function build(u, mult) {
  const w = W.get(u[0]); const amount = BigInt(u[3]);
  const e = { address: w.address, outpoint: { transactionId: u[1], index: u[2] }, utxoEntry: { amount, scriptPublicKey: w.spk, blockDaaScore: 0n, isCoinbase: false } };
  const mk = (fee) => { const tx = kaspa.createTransaction([e], [{ address: w.address, amount: amount - fee }], 0n, null, 1); kaspa.signTransaction(tx, [w.key], false); return tx; };
  const mass = BigInt(kaspa.calculateTransactionMass(NET, mk(20000n)));
  const fee = BigInt(Math.ceil(Number(mass) * mult * MINRATE)); return { tx: mk(fee), fee, mass, w, amt: amount - fee };
}
async function probe(mult) {
  const u = pool.shift(); if (!u) { out({ ev: "no-utxo", mult }); return; }
  const id = ++seq; let b;
  try { b = build(u, mult); } catch (e) { out({ ev: "build-err", id, mult, err: String(e).slice(0, 120) }); return; }
  const t0 = Date.now();
  try {
    const r = await rpc.submitTransaction({ transaction: b.tx, allowOrphan: false });
    const txid = r.transactionId; pend.set(txid, { id, mult, t0, w: b.w.i, amt: b.amt, miss: 0 });
    out({ ev: "submit", id, mult, ok: true, txid, fee: b.fee, mass: b.mass, rpc_ms: Date.now() - t0 });
  } catch (e) {
    const err = String(e).replace(/[0-9a-f]{64}/g, "<h>").slice(0, 320);
    out({ ev: "submit", id, mult, ok: false, err, fee: b.fee, mass: b.mass, rpc_ms: Date.now() - t0 });
    if (!/spent|not found|missing|orphan|double/i.test(err)) pool.push(u); // UTXO still good (e.g. fee/mempool-full reject) -> reuse
  }
}
// acceptance watcher
(async () => { for (;;) { try {
  const v = await rpc.getVirtualChainFromBlock({ startHash: vstart, includeAcceptedTransactionIds: true });
  const now = Date.now();
  for (const a of v.acceptedTransactionIds) for (const txid of a.acceptedTransactionIds) { const p = pend.get(txid); if (p) {
    pend.delete(txid); out({ ev: "accepted", id: p.id, mult: p.mult, txid, lat_s: (now - p.t0) / 1000, was_evicted: !!p.evicted });
    pool.push([p.w, txid, 0, String(p.amt)]); } }
  if (v.addedChainBlockHashes.length) vstart = v.addedChainBlockHashes[v.addedChainBlockHashes.length - 1];
} catch (e) { out({ ev: "vc-err", err: String(e).slice(0, 120) }); try { vstart = (await rpc.getBlockDagInfo({})).sink; } catch {} } await sleep(1000); } })();
// mempool presence check (eviction)
(async () => { for (;;) { await sleep(5000); for (const [txid, p] of pend) { if (Date.now() - p.t0 < 5000) continue; try {
  await rpc.getMempoolEntry({ transactionId: txid, includeOrphanPool: false, filterTransactionPool: false }); p.miss = 0;
} catch { p.miss++; if (p.miss >= 3 && !p.evicted && Date.now() - p.t0 > EVICT_GRACE) { p.evicted = true; out({ ev: "evicted", id: p.id, mult: p.mult, txid, age_s: (Date.now() - p.t0) / 1000 }); } } } } })();
while (!existsSync("/tmp/overload-probe.STOP")) {
  const t = Date.now(); cyc++;
  let mp = null; try { mp = (await rpc.getInfo({})).mempoolSize; } catch {}
  await Promise.all([...TIERS].sort(() => Math.random() - 0.5).map(probe));
  out({ ev: "cycle", cyc, mempool: mp, pending: pend.size, pool: pool.length });
  // drop long-evicted entries after 30 min (keep watching until then)
  for (const [txid, p] of pend) if (p.evicted && Date.now() - p.t0 > 1800000) pend.delete(txid);
  save(); await sleep(Math.max(1000, CYCLE - (Date.now() - t)));
}
save(); out({ ev: "stop", pending: pend.size }); process.exit(0);
