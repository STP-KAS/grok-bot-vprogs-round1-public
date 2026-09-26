// TPS lane: maximise transaction COUNT on TN10 from throwaway storm wallets [FROM,TO).
// 1) split: every UTXO >= 2*PIECE_MIN is split 1-in-N (N<=200, equal parts) to itself -> deep pools of independent inputs.
// 2) spray: each worker takes the oldest cooled-down UTXO from the global pool and sends a 1-in-1-out tx (amount-fee)
//    to a random wallet of the lane. KIP-9 relaxed storage mass for 1-in-1-out is C*(1/out-1/in) ~ 0, so only the
//    compute mass (~1.6k grams) counts against the 500k block limit. The new output goes back into the pool with
//    readyAt = now + COOL ms and node affinity (spent next via the node that got its parent).
// Hand-built txs (createTransaction + signTransaction) skip the SDK Generator. Fee = 100 sompi/gram * compute mass
// (TN10 kaspad 2.1.0 minimum measured earlier); FEE_MULT env scales it.
// Concurrency from /tmp/tn10-tps.conc; stop with /tmp/tn10-tps.HALT or /tmp/tn10-break.STOP.
// usage: node tps.mjs <tag> <from> <to> <seconds> <stateIn.json|->   state saved to state-tps-<tag>.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { kaspa, connect, log, sleep, NET, deskKey, addrOf } from "./lib.mjs";
const [TAG, FROM, TO, secsA, stateIn = "-"] = process.argv.slice(2);
const SECS = Number(secsA), COOL = Number(process.env.COOL || 15000), FEE_MULT = Number(process.env.FEE_MULT || 1);
const PIECE_MIN = 500000000n, MAXN = 200; // 5 TKAS pieces minimum
const DIR = "/workspace/tn10-break-test-2026-09-25";
const keys = JSON.parse(readFileSync("/home/box/secure/tn10-storm-keys.json", "utf8")).slice(Number(FROM), Number(TO));
const W = keys.map((k) => ({ i: k.i, key: new kaspa.PrivateKey(k.key), address: k.address, spk: kaspa.payToAddressScript(k.address) }));
const byI = new Map(W.map((w) => [w.i, w]));
const ent = (w, txid, index, amount) => ({ address: w.address, outpoint: { transactionId: txid, index }, utxoEntry: { amount: BigInt(amount), scriptPublicKey: w.spk, blockDaaScore: 0n, isCoinbase: false } });
const STATE = `${DIR}/state-tps-${TAG}.json`;
const P2x = () => { const spk = kaspa.payToScriptHashScript("51"); return { i: -2, key: null, p2sh: true, address: kaspa.addressFromScriptPublicKey(spk, NET).toString(), spk }; };
let pool = []; // {w, e, node, readyAt}
const src = existsSync(STATE) ? STATE : stateIn;
if (src !== "-") { const s = JSON.parse(readFileSync(src, "utf8")); for (const [i, list] of Object.entries(s)) { const w = i === "p2sh" ? P2x() : byI.get(Number(i)); if (w) for (const [t, x, a, n] of list) pool.push({ w, e: ent(w, t, x, a), node: n && n !== "any" ? n : null, readyAt: 0 }); } }
// DESK=a:b env: also feed desk (faucet) coinbase UTXOs [a,b) of the daa-sorted list (/tmp/desk-utxos.json) into the
// pool. Each is ~3 TKAS, confirmed and independent, so every one is a 1-in-1-out tx with no chaining; its output lands
// in a lane wallet and is re-spent from there. The faucet key only signs locally, as in fund-storm.mjs.
if (process.env.DESK) { const [a, b] = process.env.DESK.split(":").map(Number); const dk = deskKey(0); const da = addrOf(dk);
  const dw = { i: -1, key: dk, address: da, spk: kaspa.payToAddressScript(da) };
  const list = JSON.parse(readFileSync("/tmp/desk-utxos.json", "utf8")).filter((u) => u.utxoEntry.isCoinbase).sort((x, y) => Number(BigInt(x.utxoEntry.blockDaaScore) - BigInt(y.utxoEntry.blockDaaScore))).slice(a, b);
  const d = list.map((u) => ({ w: dw, desk: true, e: { address: da, outpoint: u.outpoint, utxoEntry: { amount: BigInt(u.utxoEntry.amount), scriptPublicKey: dw.spk, blockDaaScore: BigInt(u.utxoEntry.blockDaaScore), isCoinbase: true } }, node: null, readyAt: 0 }));
  // interleave desk items with lane items
  const mix = []; let x = 0, y = 0; while (x < pool.length || y < d.length) { if (y < d.length) mix.push(d[y++]); if (y < d.length) mix.push(d[y++]); if (x < pool.length) mix.push(pool[x++]); } pool = mix; }
// P2SH=1: lane outputs go to P2SH(OP_TRUE) (anyone-can-spend, TESTNET ONLY). Spending one needs no signature
// (signatureScript = push(0x51), sigOpCount 0): compute mass 571 instead of 1624 (node-reported), so ~875 txs fit a
// 500k-mass block instead of ~307. First spend of a normal lane UTXO converts it (signed, 1624 mass).
const P2SH = process.env.P2SH === "1";
const P2 = (() => { const spk = kaspa.payToScriptHashScript("51"); return { i: -2, key: null, p2sh: true, address: kaspa.addressFromScriptPublicKey(spk, NET).toString(), spk }; })();
const P2FEE = BigInt(Math.ceil(571 * 100 * FEE_MULT));
const nodes = ["n0", "n1"];
const rpcs = {}; for (const n of nodes) rpcs[n] = await connect(n);
const S = { sub: 0, ok: 0, err: 0, errs: {}, fees: 0n, lat: [], split: 0, splitOk: 0, orphan: 0 };
let CONC = 0; const readConc = () => { try { CONC = Number(readFileSync("/tmp/tn10-tps.conc", "utf8").trim()) || 0; } catch {} }; readConc();
const bump = (e) => { const m = String(e?.message || e).replace(/[0-9a-f]{64}/g, "<h>").replace(/\d{4,}/g, "<n>").slice(0, 160); S.errs[m] = (S.errs[m] || 0) + 1; S.err++; };
const t0 = Date.now(); const stop = () => Date.now() - t0 > SECS * 1000 || existsSync("/tmp/tn10-break.STOP") || existsSync("/tmp/tn10-tps.HALT");
let MASS1 = null;
const feeFor = (tx) => { const m = BigInt(kaspa.calculateTransactionMass(NET, tx)); return { m, fee: (m * 100n * BigInt(Math.round(FEE_MULT * 100))) / 100n }; };
// PREF env (n0|n1|any) picks the node for inputs without affinity. A node whose mempool is full of RPC-submitted
// (Priority::High, never evicted) txs rejects everything, so on "mempool is full" the input is re-queued for the other node.
const PREF = process.env.PREF || "any";
// AFFINITY=0 ignores which node got the parent (after COOL the parent has normally been relayed to both nodes);
// an orphan reply then just re-queues the input.
const AFF = process.env.AFFINITY !== "0";
const pickNode = (it) => (AFF && it.node) || (PREF === "any" ? nodes[(Math.random() * 2) | 0] : PREF);
async function submit(node, tx) { const t = Date.now(); const r = await rpcs[node].submitTransaction({ transaction: tx, allowOrphan: false }); S.lat.push(Date.now() - t); return r.transactionId; }
// phase 1: split
async function splitOne(it) {
  const amt = it.e.utxoEntry.amount; const n = Number(amt / PIECE_MIN) >= MAXN ? MAXN : Number(amt / PIECE_MIN);
  if (n < 2) return [it];
  const part = (amt - 100000000n) / BigInt(n); // reserve 1 TKAS, fee adjusted below
  const outs = Array.from({ length: n }, () => ({ address: it.w.address, amount: part }));
  let tx = kaspa.createTransaction([it.e], outs, 0n, null, 1);
  const { fee } = feeFor(tx); outs[n - 1] = { address: it.w.address, amount: part + (amt - part * BigInt(n)) - fee - 1000n };
  tx = kaspa.createTransaction([it.e], outs, 0n, null, 1); kaspa.signTransaction(tx, [it.w.key], false);
  const node = pickNode(it); S.split++;
  try { const id = await submit(node, tx); S.splitOk++; S.fees += fee; return outs.map((o, x) => ({ w: it.w, e: ent(it.w, id, x, o.amount), node, readyAt: 0 })); }
  catch (e) { bump(e); return /orphan/.test(String(e)) ? [it] : []; }
}
{ const big = pool.filter((p) => p.e.utxoEntry.amount >= 2n * PIECE_MIN); const small = pool.filter((p) => p.e.utxoEntry.amount < 2n * PIECE_MIN);
  const res = []; for (let k = 0; k < big.length; k += 16) res.push(...(await Promise.all(big.slice(k, k + 16).map(splitOne))).flat());
  pool = small.concat(res); log({ step: "tps-split", tag: TAG, splitTx: S.split, splitOk: S.splitOk, pool: pool.length, errs: S.errs }); }
// phase 2: spray. pool is a FIFO; items not yet cool are re-queued.
let head = 0; const q = pool; pool = null;
function take() { const now = Date.now(); for (let t = 0; t < 64 && head < q.length; t++) { const it = q[head++]; if (it.readyAt <= now) return it; q.push(it); } return null; }
async function one() {
  const it = take(); if (!it) { await sleep(20); return; }
  const to = P2SH ? P2 : W[(Math.random() * W.length) | 0];
  let tx, fee;
  if (it.w.p2sh) {
    fee = P2FEE; const amt = it.e.utxoEntry.amount - fee; if (amt < 10000000n) return;
    tx = kaspa.createTransaction([it.e], [{ address: to.address, amount: amt }], 0n, null, 0); tx.inputs[0].signatureScript = "0151";
  } else {
    tx = kaspa.createTransaction([it.e], [{ address: to.address, amount: it.e.utxoEntry.amount - 1n }], 0n, null, 1);
    if (!MASS1) MASS1 = feeFor(tx);
    fee = MASS1.fee; const amt = it.e.utxoEntry.amount - fee; if (amt < 10000000n) return; // drop leftovers < 0.1 TKAS
    tx = kaspa.createTransaction([it.e], [{ address: to.address, amount: amt }], 0n, null, 1); kaspa.signTransaction(tx, [it.w.key], false);
  }
  const amt = tx.outputs[0].value;
  const node = pickNode(it); S.sub++;
  try { const id = await submit(node, tx); S.ok++; S.fees += fee; if (it.desk) S.desk = (S.desk || 0) + 1; if (it.w.p2sh) S.p2 = (S.p2 || 0) + 1; q.push({ w: to, e: ent(to, id, 0, amt), node, readyAt: Date.now() + COOL }); }
  catch (e) { bump(e); const m = String(e);
    if (/orphan/.test(m)) { S.orphan++; it.tries = (it.tries || 0) + 1; if (!it.desk && it.tries < 4) { it.readyAt = Date.now() + 1000; q.push(it); } else S.dropped = (S.dropped || 0) + 1; }
    else if (/mempool because it's full/.test(m)) { S.full = (S.full || 0) + 1; it.node = node === "n0" ? "n1" : "n0"; it.readyAt = Date.now() + 1000; q.push(it); } }
}
async function worker(k) { while (!stop()) { if (k >= CONC) { await sleep(500); continue; } await one(); } }
const cc = setInterval(readConc, 2000);
const cmp = setInterval(() => { if (head > 200000) { q.splice(0, head); head = 0; } }, 5000);
let last = { t: Date.now(), ok: 0, sub: 0 };
const rep = setInterval(async () => {
  const now = Date.now(), dt = (now - last.t) / 1000; const l = S.lat.sort((a, b) => a - b); const mp = {};
  for (const n of nodes) { try { mp[n] = (await rpcs[n].getInfo()).mempoolSize; } catch { mp[n] = null; } }
  log({ step: "tps", tag: TAG, conc: CONC, elapsed_s: Math.round((now - t0) / 1000), submitted: S.sub, accepted: S.ok, rejected: S.err, tps_submitted: +((S.sub - last.sub) / dt).toFixed(1), tps_accepted: +((S.ok - last.ok) / dt).toFixed(1), submit_ms_p50: l[l.length >> 1] ?? null, submit_ms_p99: l[Math.floor(l.length * 0.99)] ?? null, mempool: mp, pool: q.length - head, orphan_retries: S.orphan, full_requeues: S.full || 0, dropped_missing: S.dropped || 0, desk_spent: S.desk || 0, p2sh_spends: S.p2 || 0, mass1: MASS1 && String(MASS1.m), fee1: MASS1 && String(MASS1.fee), fees_sompi: String(S.fees), errs: S.errs });
  S.lat = []; last = { t: now, ok: S.ok, sub: S.sub };
}, 10000);
const save = () => { const o = {}; for (let k = head; k < q.length; k++) { const it = q[k]; if (it.desk) continue; (o[it.w.p2sh ? "p2sh" : it.w.i] ||= []).push([it.e.outpoint.transactionId, it.e.outpoint.index, it.e.utxoEntry.amount.toString(), it.node || "any"]); } writeFileSync(STATE, JSON.stringify(o)); };
const sv = setInterval(save, 30000);
await Promise.all(Array.from({ length: 512 }, (_, k) => worker(k)));
[cc, cmp, rep, sv].forEach(clearInterval); save();
log({ step: "tps-done", tag: TAG, submitted: S.sub, accepted: S.ok, rejected: S.err, errs: S.errs, fees_sompi: String(S.fees), secs: Math.round((Date.now() - t0) / 1000) });
process.exit(0);
