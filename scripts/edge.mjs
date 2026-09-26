// Edge-case transactions against a local TN10 node. Each case records what the SDK and the node said.
// Hand-built txs use createTransaction (no SDK mass/amount policy) so the node's own rules are exercised.
import { kaspa, connect, walletKey, loadWallets, deskKey, addrOf, log, sleep, NET } from "./lib.mjs";
const node = process.argv[2] || "n1";
const W = loadWallets(); const key = walletKey("W2"); const me = W.W2.address; const spk = kaspa.payToAddressScript(me);
const other = walletKey("W3");
const ent = (txid, index, amount) => ({ address: me, outpoint: { transactionId: txid, index }, amount: BigInt(amount), scriptPublicKey: spk, blockDaaScore: 0n, isCoinbase: false });
const rpc = await connect(node);
const J = (x) => JSON.parse(JSON.stringify(x, (k, v) => (typeof v === "bigint" ? v.toString() : v)));
async function submitTx(tx) { try { const r = await rpc.submitTransaction({ transaction: tx, allowOrphan: false }); return { accepted: true, txid: String(r.transactionId) }; } catch (e) { return { accepted: false, error: String(e.message || e).slice(0, 400) }; } }
function build(entries, outputs, { payload = null, signKey = key, fee = null } = {}) {
  const tx = kaspa.createTransaction(entries, outputs, 0n, payload, 1);
  const inSum = entries.reduce((a, e) => a + e.amount, 0n); const outSum = outputs.reduce((a, o) => a + o.amount, 0n);
  kaspa.signTransaction(tx, [signKey], false);
  const mass = (() => { try { return kaspa.calculateTransactionMass(NET, tx); } catch (e) { return "err:" + e; } })();
  const minFee = (() => { try { return kaspa.calculateTransactionFee(NET, tx); } catch (e) { return "err:" + e; } })();
  return { tx, info: { inputs: entries.length, outputs: outputs.length, inSum, outSum, fee: inSum - outSum, sdkMass: mass, sdkMinFee: minFee } };
}
const cases = [];
async function run(name, fn) { const t = new Date().toISOString(); let r; try { r = await fn(); } catch (e) { r = { threw: String(e.message || e).slice(0, 400) }; } const rec = J({ t, case: name, ...r }); cases.push(rec); log(rec); return rec; }

// 0) split W2's 1500 TKAS funding UTXO into 12 x 100 TKAS inputs for the cases (explicit fee 0.01 TKAS)
const F = ent("bd9eb65903cc4c6379334a4c0d0a5ffd679bf449a115eb3ad49cff4c01d14265", 1, 150000000000n);
const S = 10000000000n; const N = 12;
const outs = Array.from({ length: N }, () => ({ address: me, amount: S }));
outs.push({ address: me, amount: F.amount - S * BigInt(N) - 2000000n });
const sp = build([F], outs); const spr = await submitTx(sp.tx); log({ case: "split", ...J(sp.info), ...spr });
const U = Array.from({ length: N }, (_, i) => ent(spr.txid, i, S));
let u = 0; const next = () => U[u++];

await run("E1 zero-value output via SDK createTransactions", async () => {
  try { const r = await kaspa.createTransactions({ entries: [{ address: me, outpoint: U[0].outpoint, utxoEntry: { amount: S, scriptPublicKey: spk, blockDaaScore: 0n, isCoinbase: false } }], outputs: [{ address: me, amount: 0n }], changeAddress: me, priorityFee: 0n, networkId: NET }); return { sdk: "built " + r.transactions.length + " tx(s)" }; }
  catch (e) { return { sdk: "refused", error: String(e.message || e) }; }
});
await run("E2 zero-value output hand-built (bypass SDK policy)", async () => { const e = next(); const b = build([e], [{ address: other.toAddress(NET).toString(), amount: 0n }, { address: me, amount: e.amount - 10000000n }]); return { ...b.info, ...(await submitTx(b.tx)) }; });
await run("E3 dust output 1 sompi", async () => { const e = next(); const b = build([e], [{ address: me, amount: 1n }, { address: me, amount: e.amount - 1n - 10000000n }]); return { ...b.info, ...(await submitTx(b.tx)) }; });
for (const small of [1000000n, 5000000n, 10000000n, 20000000n]) {
  await run(`E4 small output ${small} sompi (storage-mass boundary)`, async () => { const e = next(); const b = build([e], [{ address: me, amount: small }, { address: me, amount: e.amount - small - 20000000n }]); const sm = kaspa.calculateStorageMass(NET, [Number(e.amount)], [Number(small), Number(e.amount - small - 20000000n)]); return { ...b.info, sdkStorageMass: sm, ...(await submitTx(b.tx)) }; });
}
// fee floor: same 1-in-1-out shape, rising fee
{
  const e = next(); let done = false;
  for (const fee of [0n, 100n, 1000n, 2000n, 10000n, 100000n, 1000000n]) {
    if (done) break;
    const r = await run(`E5 fee floor, fee=${fee} sompi`, async () => { const b = build([e], [{ address: me, amount: e.amount - fee }]); return { ...b.info, ...(await submitTx(b.tx)) }; });
    if (r.accepted) { done = true; U.push(ent(r.txid, 0, e.amount - fee)); }
  }
}
await run("E6 double spend (two txs, same input)", async () => { const e = next(); const a = build([e], [{ address: me, amount: e.amount - 1000000n }]); const b = build([e], [{ address: me, amount: e.amount - 2000000n }]); return { first: await submitTx(a.tx), second: await submitTx(b.tx) }; });
await run("E7 orphan (input outpoint does not exist)", async () => { const e = ent("11".repeat(32), 0, S); const b = build([e], [{ address: me, amount: S - 1000000n }]); return { ...(await submitTx(b.tx)) }; });
await run("E8 invalid signature (signed by a different key)", async () => { const e = next(); const b = build([e], [{ address: me, amount: e.amount - 1000000n }], { signKey: other }); return { ...(await submitTx(b.tx)) }; });
await run("E9 duplicate submission of the same tx", async () => { const e = next(); const b = build([e], [{ address: me, amount: e.amount - 1000000n }]); const first = await submitTx(b.tx); const again = await submitTx(b.tx); if (first.accepted) U.push(ent(first.txid, 0, e.amount - 1000000n)); return { first, again }; });
for (const kb of [20, 90, 200]) {
  await run(`E10 payload ${kb} KB`, async () => { const e = next(); const pl = new Uint8Array(kb * 1024).fill(0x61); const fee = 100000000n; const b = build([e], [{ address: me, amount: e.amount - fee }], { payload: pl }); return { ...b.info, ...(await submitTx(b.tx)) }; });
}
await run("E11 outputs exceed inputs", async () => { const e = next(); const b = build([e], [{ address: me, amount: e.amount + 1n }]); return { ...b.info, ...(await submitTx(b.tx)) }; });
for (const n of [100, 250, 400]) {
  await run(`E12 one input, ${n} outputs of 0.2 TKAS each`, async () => { const e = U[u] ? next() : null; if (!e) return { skipped: "no input left" }; const o = Array.from({ length: n }, () => ({ address: me, amount: 20000000n })); o.push({ address: me, amount: e.amount - 20000000n * BigInt(n) - 50000000n }); const b = build([e], o); return { ...b.info, ...(await submitTx(b.tx)) }; });
}
log({ case: "summary", cases: cases.length, maxStdMass: String(kaspa.maximumStandardTransactionMass()) });
await rpc.disconnect();
