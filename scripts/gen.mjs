// TN10 load generator. Tracks its own UTXOs (our nodes have no --utxoindex), submits to a local node.
// Phase 1 (split): one funded UTXO -> LANES outputs to self. Phase 2 (spray): each lane sends a chained
// 1-in-2-out tx (small payment to a peer wallet + change to self) as fast as the rate limit allows.
// usage: node gen.mjs <wallet> <node> <fundTxid> <fundIndex> <fundSompi> <lanes> <tps> <seconds> <peerWallet> [payTkas]
import { kaspa, connect, walletKey, loadWallets, log, sleep, NET } from "./lib.mjs";
import { existsSync, writeFileSync } from "node:fs";
const [wname, node, ftx, fidx, fsompi, lanesA, tpsA, secsA, peer, payA = "1"] = process.argv.slice(2);
const LANES = Number(lanesA), TPS = Number(tpsA), SECS = Number(secsA);
const W = loadWallets(); const key = walletKey(wname); const me = W[wname].address; const to = W[peer].address;
const spk = kaspa.payToAddressScript(me);
const pay = BigInt(Math.round(Number(payA) * 1e8));
const ent = (txid, index, amount) => ({ address: me, outpoint: { transactionId: txid, index }, utxoEntry: { amount, scriptPublicKey: spk, blockDaaScore: 0n, isCoinbase: false } });
const rpc = await connect(node);
const stats = { ok: 0, err: 0, errs: {}, lat: [] };
const bump = (e) => { const m = String(e?.message || e).replace(/[0-9a-f]{64}/g, "<hash>").replace(/\d{3,}/g, "<n>").slice(0, 160); stats.errs[m] = (stats.errs[m] || 0) + 1; stats.err++; };
// split
const fund = ent(ftx, Number(fidx), BigInt(fsompi));
const per = (BigInt(fsompi) - 10n ** 8n) / BigInt(LANES);
let lanes = [];
{
  const { transactions, summary } = await kaspa.createTransactions({ entries: [fund], outputs: Array.from({ length: LANES }, () => ({ address: me, amount: per })), changeAddress: me, priorityFee: 0n, networkId: NET });
  if (transactions.length !== 1) { log({ step: "split", error: "sdk split into " + transactions.length + " txs; reduce lanes" }); process.exit(2); }
  const p = transactions[0]; p.sign([key]);
  const id = String(await p.submit(rpc));
  lanes = Array.from({ length: LANES }, (_, i) => ent(id, i, per));
  log({ step: "split", wallet: wname, node, txid: id, lanes: LANES, perSompi: per, mass: p.mass, fee: summary.fees });
}
const t0 = Date.now(); let sent = 0; let lastRep = t0; let lastOk = 0;
const interval = 1000 / TPS;
async function laneLoop(i) {
  while (Date.now() - t0 < SECS * 1000 && !existsSync("/tmp/tn10-break.STOP") && !existsSync("/tmp/tn10-gen.HALT")) {
    const due = t0 + sent * interval; const now = Date.now();
    if (due > now) { await sleep(due - now); continue; }
    sent++;
    const cur = lanes[i];
    if (!cur) return;
    try {
      const { transactions } = await kaspa.createTransactions({ entries: [cur], outputs: [{ address: to, amount: pay }], changeAddress: me, priorityFee: 0n, networkId: NET });
      const p = transactions[0]; p.sign([key]);
      const ts = Date.now();
      const id = String(await p.submit(rpc));
      stats.lat.push(Date.now() - ts); stats.ok++;
      // change is the last output
      const outs = p.transaction.outputs; const ci = outs.length - 1;
      lanes[i] = ent(id, ci, BigInt(outs[ci].value));
      if (lanes[i].utxoEntry.amount < pay * 3n) { lanes[i] = null; return; }
    } catch (e) { bump(e); await sleep(200); if (/orphan|already spent|double|not found/i.test(String(e))) { lanes[i] = null; return; } }
  }
}
const rep = setInterval(() => {
  const now = Date.now(); const l = stats.lat.sort((a, b) => a - b);
  log({ step: "spray", wallet: wname, node, elapsed_s: Math.round((now - t0) / 1000), ok: stats.ok, err: stats.err, tps_window: +((stats.ok - lastOk) / ((now - lastRep) / 1000)).toFixed(1),
    lat_p50: l[Math.floor(l.length * 0.5)] ?? null, lat_p99: l[Math.floor(l.length * 0.99)] ?? null, live_lanes: lanes.filter(Boolean).length, errs: stats.errs });
  stats.lat = []; lastOk = stats.ok; lastRep = now;
}, 10000);
await Promise.all(lanes.map((_, i) => laneLoop(i)));
clearInterval(rep);
log({ step: "done", wallet: wname, node, ok: stats.ok, err: stats.err, errs: stats.errs, secs: Math.round((Date.now() - t0) / 1000) });
// save lane tips so a later run can continue from them
writeFileSync(`/workspace/tn10-break-test-2026-09-25/state-${wname}.json`, JSON.stringify(lanes.filter(Boolean).map((e) => [e.outpoint.transactionId, e.outpoint.index, e.utxoEntry.amount.toString()])));
await rpc.disconnect();
