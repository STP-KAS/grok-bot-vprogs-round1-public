// TN10 load generator v2. Tracks its own UTXOs (our nodes run without --utxoindex) and submits to one local node.
// Funding UTXOs for the wallet are read from state-funded.jsonl. Each is split into LANES self-outputs, then every
// lane submits chained 1-in-1-out self-transfers (unconfirmed parents are spent immediately).
// Rate is read each second from /tmp/tn10-gen.rate (tx/s per generator), so a ramp needs no restart.
// usage: node gen2.mjs <wallet> <node> <lanesPerFunding> <seconds>
import { kaspa, connect, walletKey, loadWallets, log, sleep, NET } from "./lib.mjs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const [wname, node, lanesA, secsA] = process.argv.slice(2);
const LPF = Number(lanesA), SECS = Number(secsA);
const W = loadWallets(); const key = walletKey(wname); const me = W[wname].address; const spk = kaspa.payToAddressScript(me);
const ent = (txid, index, amount) => ({ address: me, outpoint: { transactionId: txid, index }, utxoEntry: { amount, scriptPublicKey: spk, blockDaaScore: 0n, isCoinbase: false } });
const funded = readFileSync("/workspace/tn10-break-test-2026-09-25/state-funded.jsonl", "utf8").trim().split("\n").map(JSON.parse).filter((r) => r.wallet === wname);
const rpc = await connect(node);
const stats = { ok: 0, err: 0, errs: {}, lat: [], fees: 0n };
const bump = (e) => { const m = String(e?.message || e).replace(/[0-9a-f]{64}/g, "<h>").replace(/\d{4,}/g, "<n>").slice(0, 180); stats.errs[m] = (stats.errs[m] || 0) + 1; stats.err++; };
let lanes = [];
for (const f of funded) {
  const amt = BigInt(f.amount); const per = (amt - 10n ** 8n) / BigInt(LPF);
  const { transactions } = await kaspa.createTransactions({ entries: [ent(f.txid, f.index, amt)], outputs: Array.from({ length: LPF }, () => ({ address: me, amount: per })), changeAddress: me, priorityFee: 0n, networkId: NET });
  if (transactions.length !== 1) { log({ step: "split", error: "generator made " + transactions.length + " txs" }); process.exit(2); }
  const p = transactions[0]; p.sign([key]);
  try { const id = String(await p.submit(rpc)); for (let i = 0; i < LPF; i++) lanes.push(ent(id, i, per)); log({ step: "split", wallet: wname, node, txid: id, lanes: LPF, perSompi: per }); }
  catch (e) { log({ step: "split", wallet: wname, error: String(e.message || e).slice(0, 200) }); }
}
const rateNow = () => { try { return Number(readFileSync("/tmp/tn10-gen.rate", "utf8").trim()) || 0; } catch { return 1; } };
let rate = rateNow(); let tokens = 0; let lastRefill = Date.now();
setInterval(() => { rate = rateNow(); }, 1000);
const t0 = Date.now();
const stop = () => Date.now() - t0 > SECS * 1000 || existsSync("/tmp/tn10-break.STOP") || existsSync("/tmp/tn10-gen.HALT");
async function take() { for (;;) { const now = Date.now(); tokens = Math.min(rate, tokens + ((now - lastRefill) / 1000) * rate); lastRefill = now; if (tokens >= 1) { tokens -= 1; return true; } if (stop()) return false; await sleep(Math.max(2, 1000 / Math.max(rate, 1) / 2)); } }
async function laneLoop(i) {
  while (!stop() && lanes[i]) {
    if (!(await take())) return;
    try {
      const { transactions, summary } = await kaspa.createTransactions({ entries: [lanes[i]], outputs: [], changeAddress: me, priorityFee: 0n, networkId: NET });
      const p = transactions[0]; p.sign([key]);
      const ts = Date.now(); const id = String(await p.submit(rpc)); stats.lat.push(Date.now() - ts); stats.ok++; stats.fees += summary.fees;
      lanes[i] = ent(id, 0, BigInt(p.transaction.outputs[0].value));
    } catch (e) { bump(e); await sleep(500); if (/orphan|already spent|double|not found|Insufficient/i.test(String(e))) { lanes[i] = null; } }
  }
}
let lastOk = 0, lastT = t0;
const rep = setInterval(() => { const now = Date.now(); const l = stats.lat.sort((a, b) => a - b);
  log({ step: "load", wallet: wname, node, elapsed_s: Math.round((now - t0) / 1000), rate_target: rate, ok: stats.ok, err: stats.err, tps: +((stats.ok - lastOk) / ((now - lastT) / 1000)).toFixed(1), lat_p50: l[Math.floor(l.length * 0.5)] ?? null, lat_p99: l[Math.floor(l.length * 0.99)] ?? null, lat_max: l[l.length - 1] ?? null, live_lanes: lanes.filter(Boolean).length, fees: stats.fees, errs: stats.errs });
  stats.lat = []; lastOk = stats.ok; lastT = now; }, 10000);
await Promise.all(lanes.map((_, i) => laneLoop(i)));
clearInterval(rep);
log({ step: "done", wallet: wname, node, ok: stats.ok, err: stats.err, errs: stats.errs, fees: stats.fees, secs: Math.round((Date.now() - t0) / 1000) });
writeFileSync(`/workspace/tn10-break-test-2026-09-25/state-lanes-${wname}.json`, JSON.stringify(lanes.filter(Boolean).map((e) => [e.outpoint.transactionId, e.outpoint.index, e.utxoEntry.amount.toString()])));
await rpc.disconnect(); process.exit(0);
