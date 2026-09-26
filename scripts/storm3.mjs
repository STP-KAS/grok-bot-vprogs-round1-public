// Random transfer storm v3 (TPS-optimized): 0.5 TKAS per tx between our throwaway storm wallets [FROM,TO), as fast as the nodes accept.
// - Local UTXO tracking (our nodes run without --utxoindex); unconfirmed change is spent at once.
// - Node affinity: an output created by a tx sent to node X is next spent through node X, so its parent is always
//   already in that node's mempool (v1 sent children to the other node before P2P relay and got "orphan" rejects).
// - v3: when the sender holds a 0.5 TKAS UTXO next to a big one, it sends 2-in-2-out (0.5 + big -> 0.5 to receiver
//   + change). KIP-9's relaxed storage-mass rule (|O| <= |I| <= 2) then makes the storage mass ~0 instead of ~20000,
//   so ~180 such txs fit a block's 500k mass budget instead of 25. Without a 0.5 input it falls back to 1-in-2-out.
// - Compounding: when a wallet has no input >= 0.6 TKAS, or holds > 150 UTXOs, it merges up to 80 of them into one.
// - Concurrency is read every 2 s from /tmp/tn10-storm.conc (a ramp needs no restart); workers above it idle.
// - 1 in 100 accepted txs is sampled for confirmation latency (submit -> no longer in that node's mempool).
// usage: node storm2.mjs <tag> <from> <to> <seconds> <stateIn.json|-> [mempoolPause=200000]
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { kaspa, connect, log, sleep, NET } from "./lib.mjs";
const [TAG, FROM, TO, secsA, stateIn = "-", pauseA = "200000"] = process.argv.slice(2);
const SECS = Number(secsA), PAUSE = Number(pauseA), SAMPLE = 100, MAXC = 80, MAXW = 1024;
const PAY = 50000000n, MINSEND = PAY + 10000000n;
const DIR = "/workspace/tn10-break-test-2026-09-25";
const keys = JSON.parse(readFileSync("/home/box/secure/tn10-storm-keys.json", "utf8")).slice(Number(FROM), Number(TO));
const W = keys.map((k) => ({ i: k.i, key: new kaspa.PrivateKey(k.key), address: k.address, spk: kaspa.payToAddressScript(k.address), utxos: [], busy: false }));
const byI = new Map(W.map((w) => [w.i, w]));
const ent = (w, txid, index, amount, node) => ({ address: w.address, outpoint: { transactionId: txid, index }, utxoEntry: { amount: BigInt(amount), scriptPublicKey: w.spk, blockDaaScore: 0n, isCoinbase: false }, node });
const STATE = `${DIR}/state-storm2-${TAG}.json`; // shared with v2 so v3 continues from v2's UTXO view
const src = existsSync(STATE) ? STATE : stateIn;
if (src !== "-") { const s = JSON.parse(readFileSync(src, "utf8")); for (const [i, list] of Object.entries(s)) { const w = byI.get(Number(i)); if (w) w.utxos = list.map(([t, x, a, n]) => ent(w, t, x, a, n || "any")); } }
const nodes = ["n0", "n1"];
const rpcs = { n0: await connect("n0"), n1: await connect("n1") };
const S = { sub: 0, ok: 0, err: 0, comp: 0, compOk: 0, errs: {}, fees: 0n, lat: [], conf: [], pauses: 0, orphanRetry: 0, one: 0, two: 0 };
let mempool = { n0: 0, n1: 0 }; let CONC = 8;
const readConc = () => { try { CONC = Math.min(MAXW, Number(readFileSync("/tmp/tn10-storm.conc", "utf8").trim()) || 0); } catch {} };
readConc();
const bump = (e) => { const m = String(e?.message || e).replace(/[0-9a-f]{64}/g, "<h>").replace(/\d{4,}/g, "<n>").replace(/Rejected transaction <h>: /, "").slice(0, 200); S.errs[m] = (S.errs[m] || 0) + 1; S.err++; };
const t0 = Date.now(); const stop = () => Date.now() - t0 > SECS * 1000 || existsSync("/tmp/tn10-break.STOP") || existsSync("/tmp/tn10-storm.HALT");
const pending = [];
const key = (u) => u.outpoint.transactionId + ":" + u.outpoint.index;
async function one() {
  let s = null;
  for (let t = 0; t < 30; t++) { const c = W[Math.floor(Math.random() * W.length)]; if (!c.busy && c.utxos.length) { s = c; break; } }
  if (!s) { await sleep(10); return; }
  s.busy = true;
  try {
    s.utxos.sort((a, b) => (b.utxoEntry.amount > a.utxoEntry.amount ? 1 : -1));
    const big = s.utxos[0];
    if (big.utxoEntry.amount < MINSEND || s.utxos.length > 150) {
      if (s.utxos.length < 2) return;
      // pick the node holding most of this wallet's unconfirmed UTXOs; confirmed ("any") inputs can go anywhere
      const cnt = { n0: 0, n1: 0 }; for (const u of s.utxos) if (u.node !== "any") cnt[u.node]++;
      const node = cnt.n0 === cnt.n1 ? nodes[Math.floor(Math.random() * 2)] : cnt.n0 > cnt.n1 ? "n0" : "n1";
      const ins = s.utxos.filter((u) => u.node === "any" || u.node === node).slice(0, MAXC);
      if (ins.length < 2) return;
      S.comp++;
      const { transactions, summary } = await kaspa.createTransactions({ entries: ins, outputs: [], changeAddress: s.address, priorityFee: 0n, networkId: NET });
      if (transactions.length !== 1) { S.errs["compound needs >1 tx"] = (S.errs["compound needs >1 tx"] || 0) + 1; return; }
      const p = transactions[0]; p.sign([s.key]); const id = String(await p.submit(rpcs[node])); S.compOk++; S.fees += summary.fees;
      const used = new Set(ins.map(key)); s.utxos = s.utxos.filter((u) => !used.has(key(u)));
      s.utxos.push(ent(s, id, 0, p.transaction.outputs[0].value, node));
      return;
    }
    let node = big.node === "any" ? nodes[Math.floor(Math.random() * 2)] : big.node;
    const small = s.utxos.find((u) => u !== big && u.utxoEntry.amount === PAY && (u.node === "any" || big.node === "any" || u.node === big.node));
    if (small && big.node === "any" && small.node !== "any") node = small.node;
    let r; do { r = W[Math.floor(Math.random() * W.length)]; } while (r === s && W.length > 1);
    const ins = small ? [small, big] : [big];
    const { transactions, summary } = await kaspa.createTransactions({ entries: ins, outputs: [{ address: r.address, amount: PAY }], changeAddress: s.address, priorityFee: 0n, networkId: NET });
    const p = transactions[0]; p.sign([s.key]);
    if (small) S.two++; else S.one++;
    S.sub++; const ts = Date.now();
    const id = String(await p.submit(rpcs[node]));
    S.lat.push(Date.now() - ts); S.ok++; S.fees += summary.fees; if (S.ok % 500 === 1) S.massSample = { kind: small ? "2in2out" : "1in2out", fee: String(summary.fees), sdkMass: String(p.mass) };
    if (S.ok % SAMPLE === 0) pending.push({ txid: id, node, t: Date.now() });
    { const used = new Set(ins.map(key)); s.utxos = s.utxos.filter((u) => !used.has(key(u))); }
    const outs = p.transaction.outputs;
    for (let j = 0; j < outs.length; j++) {
      const v = BigInt(outs[j].value); const spk = outs[j].scriptPublicKey;
      const toR = (j === 0 && v === PAY);
      (toR ? r : s).utxos.push(ent(toR ? r : s, id, j, v, node));
    }
  } catch (e) {
    bump(e); const m = String(e?.message || e);
    if (/already spent|double spend|not found|does not exist|already accepted/i.test(m)) s.utxos.shift();
    else if (/orphan/i.test(m)) { S.orphanRetry++; }
    await sleep(200);
  } finally { s.busy = false; }
}
async function worker(k) { while (!stop()) { if (k >= CONC) { await sleep(500); continue; } if (Math.max(mempool.n0, mempool.n1) > PAUSE) { S.pauses++; await sleep(1000); continue; } await one(); } }
const tc = setInterval(readConc, 2000);
const mp = setInterval(async () => { for (const n of nodes) { try { mempool[n] = Number((await rpcs[n].getInfo()).mempoolSize); } catch {} } }, 2000);
const cp = setInterval(async () => {
  for (const x of pending.splice(0, pending.length)) {
    try { await rpcs[x.node].getMempoolEntry({ transactionId: x.txid, includeOrphanPool: true, filterTransactionPool: false }); pending.push(x); }
    catch { S.conf.push(Date.now() - x.t); appendFileSync(`${DIR}/logs/storm/confirm-samples-${TAG}.jsonl`, JSON.stringify({ txid: x.txid, node: x.node, submitted_at: new Date(x.t).toISOString(), left_mempool_ms: Date.now() - x.t }) + "\n"); }
  }
}, 1000);
let lastOk = 0, lastSub = 0, lastT = t0;
const rep = setInterval(() => {
  const now = Date.now(); const l = S.lat.sort((a, b) => a - b); const c = S.conf.sort((a, b) => a - b);
  const uc = W.map((w) => w.utxos.length).sort((a, b) => a - b);
  log({ step: "storm", tag: TAG, conc: CONC, elapsed_s: Math.round((now - t0) / 1000), submitted: S.sub, accepted: S.ok, rejected: S.err, compounds: S.comp, compounds_ok: S.compOk,
    tps_accepted: +((S.ok - lastOk) / ((now - lastT) / 1000)).toFixed(1), tps_submitted: +((S.sub - lastSub) / ((now - lastT) / 1000)).toFixed(1),
    submit_ms_p50: l[Math.floor(l.length / 2)] ?? null, submit_ms_p99: l[Math.floor(l.length * 0.99)] ?? null,
    confirm_ms_p50: c[Math.floor(c.length / 2)] ?? null, confirm_ms_p90: c[Math.floor(c.length * 0.9)] ?? null, confirm_n: c.length, pending_samples: pending.length,
    mempool, pauses: S.pauses, orphan_retries: S.orphanRetry, tx_1in2out: S.one, tx_2in2out: S.two, mass_sample: S.massSample, fees_sompi: S.fees, utxos_total: uc.reduce((a, b) => a + b, 0), utxos_max_wallet: uc[uc.length - 1], wallets_empty: uc.filter((x) => x === 0).length, errs: S.errs });
  S.lat = []; S.conf = []; lastOk = S.ok; lastSub = S.sub; lastT = now;
}, 10000);
const save = () => writeFileSync(STATE, JSON.stringify(Object.fromEntries(W.map((w) => [w.i, w.utxos.map((u) => [u.outpoint.transactionId, u.outpoint.index, u.utxoEntry.amount.toString(), u.node])]))));
const sv = setInterval(save, 30000);
log({ step: "storm-start", tag: TAG, wallets: W.length, funded: W.filter((w) => w.utxos.length).length, seconds: SECS });
await Promise.all(Array.from({ length: MAXW }, (_, k) => worker(k)));
[tc, mp, cp, rep, sv].forEach(clearInterval); save();
log({ step: "storm-done", tag: TAG, submitted: S.sub, accepted: S.ok, rejected: S.err, errs: S.errs, fees_sompi: S.fees, secs: Math.round((Date.now() - t0) / 1000) });
await rpcs.n0.disconnect(); await rpcs.n1.disconnect(); process.exit(0);
