// Edge cases, round 2: a real bad signature, many outputs, the node's compute-mass view of big payloads,
// the max-mass boundary, a future lock time. Wallet W3 (funding output index 2).
import { kaspa, connect, walletKey, loadWallets, log, NET } from "./lib.mjs";
const node = process.argv[2] || "n1";
const W = loadWallets(); const key = walletKey("W3"); const me = W.W3.address; const spk = kaspa.payToAddressScript(me);
const ent = (txid, index, amount) => ({ address: me, outpoint: { transactionId: txid, index }, amount: BigInt(amount), scriptPublicKey: spk, blockDaaScore: 0n, isCoinbase: false });
const rpc = await connect(node);
const J = (x) => JSON.parse(JSON.stringify(x, (k, v) => (typeof v === "bigint" ? v.toString() : v)));
async function submitTx(tx) { try { const r = await rpc.submitTransaction({ transaction: tx, allowOrphan: false }); return { accepted: true, txid: String(r.transactionId) }; } catch (e) { return { accepted: false, error: String(e.message || e).slice(0, 300) }; } }
function build(entries, outputs, { payload = null, lockTime = null, sign = true } = {}) {
  const tx = kaspa.createTransaction(entries, outputs, 0n, payload, 1);
  if (lockTime !== null) tx.lockTime = lockTime;
  if (sign) kaspa.signTransaction(tx, [key], false);
  const inSum = entries.reduce((a, e) => a + e.amount, 0n); const outSum = outputs.reduce((a, o) => a + o.amount, 0n);
  let sdkMass; try { sdkMass = kaspa.calculateTransactionMass(NET, tx); } catch (e) { sdkMass = "err:" + e; }
  return { tx, info: { inputs: entries.length, outputs: outputs.length, fee: inSum - outSum, sdkMass } };
}
async function run(name, fn) { const t = new Date().toISOString(); let r; try { r = await fn(); } catch (e) { r = { threw: String(e.message || e).slice(0, 300) }; } const rec = J({ t, case: name, ...r }); log(rec); return rec; }
const F = ent("bd9eb65903cc4c6379334a4c0d0a5ffd679bf449a115eb3ad49cff4c01d14265", 2, 150000000000n);
const S = 10000000000n; const N = 14;
const outs = Array.from({ length: N }, () => ({ address: me, amount: S })); outs.push({ address: me, amount: F.amount - S * BigInt(N) - 2000000n });
const sp = build([F], outs); const spr = await submitTx(sp.tx); log({ case: "split", ...J(sp.info), ...spr });
const U = Array.from({ length: N }, (_, i) => ent(spr.txid, i, S)); let u = 0; const next = () => U[u++];

await run("E8b bad signature (right key, one signature byte flipped)", async () => {
  const e = next(); const b = build([e], [{ address: me, amount: e.amount - 1000000n }]);
  const inp = b.tx.inputs[0]; const sig = inp.signatureScript; const h = typeof sig === "string" ? sig : Buffer.from(sig).toString("hex");
  const pos = 10; const flipped = h.slice(0, pos) + ((parseInt(h[pos], 16) ^ 1).toString(16)) + h.slice(pos + 1);
  inp.signatureScript = flipped; return { sigLenHex: h.length, ...(await submitTx(b.tx)) };
});
for (const kb of [20, 100, 200, 240, 300, 480]) {
  await run(`E13 payload ${kb} KB with 0 fee (node reports its compute mass)`, async () => { const e = next(); const b = build([e], [{ address: me, amount: e.amount }], { payload: new Uint8Array(kb * 1024).fill(0x62) }); return { ...b.info, ...(await submitTx(b.tx)) }; });
}
await run("E14 payload 240 KB paying 100 sompi/gram of the reported mass", async () => { const e = next(); const pl = new Uint8Array(240 * 1024).fill(0x63); const b = build([e], [{ address: me, amount: e.amount - 30000000n }], { payload: pl }); return { ...b.info, ...(await submitTx(b.tx)) }; });
for (const n of [100, 250, 500, 1000]) {
  await run(`E12 one input, ${n} outputs of 0.05 TKAS each (5000000 sompi; label corrected), fee 1 TKAS`, async () => { const e = next(); const o = Array.from({ length: n }, () => ({ address: me, amount: 5000000n })); o.push({ address: me, amount: e.amount - 5000000n * BigInt(n) - 100000000n }); const b = build([e], o); return { ...b.info, ...(await submitTx(b.tx)) }; });
}
await run("E15 lock time far in the future (DAA 900000000)", async () => { const e = next(); const b = build([e], [{ address: me, amount: e.amount - 1000000n }], { lockTime: 900000000n }); return { ...b.info, ...(await submitTx(b.tx)) }; });
await run("E16 unsigned tx", async () => { const e = next(); const b = build([e], [{ address: me, amount: e.amount - 1000000n }], { sign: false }); return { ...(await submitTx(b.tx)) }; });
await rpc.disconnect();
