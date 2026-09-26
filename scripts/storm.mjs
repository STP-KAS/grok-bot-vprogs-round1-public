// Random transfer storm: 0.5 TKAS per tx between our throwaway storm wallets, as fast as the nodes accept.
// Tracks every wallet's UTXOs locally (our nodes run without --utxoindex). Spends unconfirmed change at once.
// When a wallet has no input big enough, it first compounds up to MAXC small UTXOs into one.
// Samples 1 in SAMPLE txs for confirmation latency (submit -> gone from the mempool of the node it was sent to,
// cross-checked later against the public API). Writes a stats line every 10 s.
// usage: node storm.mjs <seconds> <concurrency> [mempoolPause=150000]
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { kaspa, connect, log, sleep, NET } from "./lib.mjs";
const [secsA = "7200", concA = "48", pauseA = "150000"] = process.argv.slice(2);
const SECS = Number(secsA), CONC = Number(concA), PAUSE = Number(pauseA), SAMPLE = 100, MAXC = 80;
const PAY = 50000000n, MINSEND = PAY + 10000000n; // need at least 0.6 TKAS in one input
const DIR = "/workspace/tn10-break-test-2026-09-25";
const keys = JSON.parse(readFileSync("/home/box/secure/tn10-storm-keys.json", "utf8"));
const W = keys.map((k) => ({ i: k.i, key: new kaspa.PrivateKey(k.key), address: k.address, spk: kaspa.payToAddressScript(k.address), utxos: [], busy: false }));
const ent = (w, txid, index, amount) => ({ address: w.address, outpoint: { transactionId: txid, index }, utxoEntry: { amount: BigInt(amount), scriptPublicKey: w.spk, blockDaaScore: 0n, isCoinbase: false } });
const STATE = `${DIR}/state-storm-utxos.json`;
if (existsSync(STATE)) { const s = JSON.parse(readFileSync(STATE, "utf8")); for (const [i, list] of Object.entries(s)) W[i].utxos = list.map(([t, x, a]) => ent(W[i], t, x, a)); }
else for (const r of readFileSync(`${DIR}/state-storm-funded.jsonl`, "utf8").trim().split("\n").map(JSON.parse)) W[r.i].utxos.push(ent(W[r.i], r.txid, r.index, r.amount));
const funded = W.filter((w) => w.utxos.length).length;
const rpcs = { n0: await connect("n0"), n1: await connect("n1") };
const nodes = ["n0", "n1"];
const S = { sub: 0, ok: 0, err: 0, comp: 0, compOk: 0, errs: {}, fees: 0n, lat: [], conf: [], storageMass: [], pauses: 0 };
let mempool = { n0: 0, n1: 0 };
const bump = (e) => { const m = String(e?.message || e).replace(/[0-9a-f]{64}/g, "<h>").replace(/\d{4,}/g, "<n>").replace(/Rejected transaction <h>: /, "").slice(0, 200); S.errs[m] = (S.errs[m] || 0) + 1; S.err++; };
const t0 = Date.now(); const stop = () => Date.now() - t0 > SECS * 1000 || existsSync("/tmp/tn10-break.STOP") || existsSync("/tmp/tn10-storm.HALT");
const pending = []; // sampled {txid,node,t}
async function one() {
  // pick a random idle sender with a usable input (or compoundable dust)
  let s = null;
  for (let tries = 0; tries < 20; tries++) { const c = W[Math.floor(Math.random() * W.length)]; if (!c.busy && c.utxos.length) { s = c; break; } }
  if (!s) { await sleep(5); return; }
  s.busy = true;
  const node = nodes[Math.floor(Math.random() * 2)]; const rpc = rpcs[node];
  try {
    s.utxos.sort((a, b) => (b.utxoEntry.amount > a.utxoEntry.amount ? 1 : -1));
    const big = s.utxos[0];
    if (big.utxoEntry.amount < MINSEND || (s.utxos.length > 150)) {
      if (s.utxos.length < 2) { s.utxos = s.utxos.filter((u) => u.utxoEntry.amount >= MINSEND); return; }
      const ins = s.utxos.slice(0, MAXC);
      S.comp++;
      const { transactions, summary } = await kaspa.createTransactions({ entries: ins, outputs: [], changeAddress: s.address, priorityFee: 0n, networkId: NET });
      if (transactions.length !== 1) { S.errs["compound split into several txs"] = (S.errs["compound split into several txs"] || 0) + 1; return; }
      const p = transactions[0]; p.sign([s.key]); const id = String(await p.submit(rpc)); S.compOk++; S.fees += summary.fees;
      const used = new Set(ins.map((u) => u.outpoint.transactionId + ":" + u.outpoint.index));
      s.utxos = s.utxos.filter((u) => !used.has(u.outpoint.transactionId + ":" + u.outpoint.index));
      s.utxos.push(ent(s, id, 0, p.transaction.outputs[0].value));
      return;
    }
    let r; do { r = W[Math.floor(Math.random() * W.length)]; } while (r === s);
    const { transactions, summary } = await kaspa.createTransactions({ entries: [big], outputs: [{ address: r.address, amount: PAY }], changeAddress: s.address, priorityFee: 0n, networkId: NET });
    const p = transactions[0]; p.sign([s.key]);
    S.sub++; const ts = Date.now();
    const id = String(await p.submit(rpc));
    S.lat.push(Date.now() - ts); S.ok++; S.fees += summary.fees;
    if (S.ok % SAMPLE === 0) pending.push({ txid: id, node, t: Date.now() });
    s.utxos.shift();
    const outs = p.transaction.outputs;
    for (let j = 0; j < outs.length; j++) {
      const v = BigInt(outs[j].value);
      if (j === 0 && v === PAY) r.utxos.push(ent(r, id, 0, v)); else s.utxos.push(ent(s, id, j, v));
    }
    if (S.storageMass.length < 2000 && S.ok % 50 === 0) S.storageMass.push(Number(summary.mass ?? 0));
  } catch (e) {
    bump(e);
    const m = String(e?.message || e);
    if (/already spent|orphan|not found|does not exist/i.test(m)) s.utxos.shift();
    await sleep(100);
  } finally { s.busy = false; }
}
async function worker() { while (!stop()) { if (Math.max(mempool.n0, mempool.n1) > PAUSE) { S.pauses++; await sleep(1000); continue; } await one(); } }
// mempool poll + confirmation poll
const mp = setInterval(async () => { for (const n of nodes) { try { const i = await rpcs[n].getInfo(); mempool[n] = Number(i.mempoolSize); } catch {} } }, 2000);
const cp = setInterval(async () => {
  for (const x of pending.splice(0, pending.length)) {
    try { await rpcs[x.node].getMempoolEntry({ transactionId: x.txid, includeOrphanPool: true, filterTransactionPool: false }); pending.push(x); }
    catch (e) { S.conf.push({ txid: x.txid, ms: Date.now() - x.t }); appendFileSync(`${DIR}/logs/storm/confirm-samples.jsonl`, JSON.stringify({ txid: x.txid, node: x.node, submit_ms_epoch: x.t, left_mempool_ms: Date.now() - x.t }) + "\n"); }
  }
}, 1000);
let lastOk = 0, lastSub = 0, lastT = t0;
const rep = setInterval(() => {
  const now = Date.now(); const l = S.lat.sort((a, b) => a - b); const c = S.conf.map((x) => x.ms).sort((a, b) => a - b);
  const utxoCounts = W.map((w) => w.utxos.length).sort((a, b) => a - b);
  log({ step: "storm", elapsed_s: Math.round((now - t0) / 1000), submitted: S.sub, accepted: S.ok, rejected: S.err, compounds: S.comp, compounds_ok: S.compOk,
    tps_accepted: +((S.ok - lastOk) / ((now - lastT) / 1000)).toFixed(1), tps_submitted: +((S.sub - lastSub) / ((now - lastT) / 1000)).toFixed(1),
    submit_ms_p50: l[Math.floor(l.length / 2)] ?? null, submit_ms_p99: l[Math.floor(l.length * 0.99)] ?? null,
    confirm_ms_p50: c[Math.floor(c.length / 2)] ?? null, confirm_ms_p90: c[Math.floor(c.length * 0.9)] ?? null, confirm_n: c.length, pending_samples: pending.length,
    mempool, pauses: S.pauses, fees_sompi: S.fees, utxos_total: utxoCounts.reduce((a, b) => a + b, 0), utxos_max_wallet: utxoCounts[utxoCounts.length - 1], wallets_empty: utxoCounts.filter((x) => x === 0).length, errs: S.errs });
  S.lat = []; S.conf = []; lastOk = S.ok; lastSub = S.sub; lastT = now;
}, 10000);
const save = () => writeFileSync(STATE, JSON.stringify(Object.fromEntries(W.map((w) => [w.i, w.utxos.map((u) => [u.outpoint.transactionId, u.outpoint.index, u.utxoEntry.amount.toString()])]))));
const sv = setInterval(save, 60000);
log({ step: "storm-start", wallets: W.length, funded, concurrency: CONC, seconds: SECS });
await Promise.all(Array.from({ length: CONC }, worker));
clearInterval(mp); clearInterval(cp); clearInterval(rep); clearInterval(sv); save();
log({ step: "storm-done", submitted: S.sub, accepted: S.ok, rejected: S.err, errs: S.errs, fees_sompi: S.fees, secs: Math.round((Date.now() - t0) / 1000) });
await rpcs.n0.disconnect(); await rpcs.n1.disconnect(); process.exit(0);
