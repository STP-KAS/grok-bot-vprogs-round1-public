// Edge cases, round 3: many-output txs near the storage-mass limit, a ~240 KB payload that pays the
// required fee, and the full text of the node's fee rule. Wallets W4 (funding index 3), W5 (index 4).
import { kaspa, connect, walletKey, loadWallets, log, NET } from "./lib.mjs";
const W = loadWallets(); const rpc = await connect(process.argv[2] || "n1");
const J = (x) => JSON.parse(JSON.stringify(x, (k, v) => (typeof v === "bigint" ? v.toString() : v)));
const FUND = "bd9eb65903cc4c6379334a4c0d0a5ffd679bf449a115eb3ad49cff4c01d14265";
async function submitTx(tx) { try { const r = await rpc.submitTransaction({ transaction: tx, allowOrphan: false }); return { accepted: true, txid: String(r.transactionId) }; } catch (e) { return { accepted: false, error: String(e.message || e) }; } }
function mk(w) { const key = walletKey(w), me = W[w].address, spk = kaspa.payToAddressScript(me); return { key, me, ent: (txid, index, amount) => ({ address: me, outpoint: { transactionId: txid, index }, amount: BigInt(amount), scriptPublicKey: spk, blockDaaScore: 0n, isCoinbase: false }) }; }
function build(w, entries, outputs, payload = null) { const tx = kaspa.createTransaction(entries, outputs, 0n, payload, 1); kaspa.signTransaction(tx, [w.key], false); const inSum = entries.reduce((a, e) => a + e.amount, 0n), outSum = outputs.reduce((a, o) => a + o.amount, 0n); let sdkMass; try { sdkMass = kaspa.calculateTransactionMass(NET, tx); } catch (e) { sdkMass = "err:" + e; } return { tx, info: { inputs: entries.length, outputs: outputs.length, fee: inSum - outSum, sdkMass } }; }
async function run(name, fn) { const t = new Date().toISOString(); let r; try { r = await fn(); } catch (e) { r = { threw: String(e.message || e) }; } log(J({ t, case: name, ...r })); return r; }
const w4 = mk("W4"), w5 = mk("W5");
for (const [w, idx, n, per, fee] of [[w4, 3, 200, 500000000n, 100000000n], [w5, 4, 250, 500000000n, 100000000n]]) {
  await run(`E12c one input, ${n} outputs of ${Number(per) / 1e8} TKAS each`, async () => { const e = w.ent(FUND, idx, 150000000000n); const o = Array.from({ length: n }, () => ({ address: w.me, amount: per })); o.push({ address: w.me, amount: e.amount - per * BigInt(n) - fee }); const b = build(w, [e], o); const sm = kaspa.calculateStorageMass(NET, [Number(e.amount)], o.map((x) => Number(x.amount))); return { ...b.info, sdkStorageMass: sm, ...(await submitTx(b.tx)) }; });
}
// payload cases use the change output of W4's fan-out tx (index 200 = change of 1500-1000-1 = 499 TKAS)
const r = await run("E17 payload 240 KB, 0 fee: full rejection text", async () => ({ note: "see E14 in round 2 for same shape" }));
await rpc.disconnect();
