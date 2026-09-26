// Deploy the DeskFloor covenant (silverc v1.0.0 artifact, floor=1) as P2SH outputs on TN10 and try to spend them.
// DeskFloor has no signature check: anyone who knows the script can spend with n >= floor. Amounts are tiny.
// Wallet W6 funds it (funding output index 5 of the first desk funding tx).
import { readFileSync } from "node:fs";
import { kaspa, connect, walletKey, loadWallets, log, sleep, NET } from "./lib.mjs";
const art = JSON.parse(readFileSync("/workspace/tn10-break-test-2026-09-25/silverscript/l1-floor.recompiled.json", "utf8"));
const redeem = Buffer.from(art.contracts.DeskFloor.compiled.bytecode).toString("hex");
const tag = art.contracts.DeskFloor.entries.check.dispatch_tag;
const p2sh = kaspa.payToScriptHashScript(redeem);
const covAddr = kaspa.addressFromScriptPublicKey(p2sh, NET).toString();
const W = loadWallets(); const key = walletKey("W6"); const me = W.W6.address; const spk = kaspa.payToAddressScript(me);
const rpc = await connect(process.argv[2] || "n1");
const J = (x) => JSON.parse(JSON.stringify(x, (k, v) => (typeof v === "bigint" ? v.toString() : v)));
async function submit(tx) { try { const r = await rpc.submitTransaction({ transaction: tx, allowOrphan: false }); return { accepted: true, txid: String(r.transactionId) }; } catch (e) { return { accepted: false, error: String(e.message || e).replace(/Rejected transaction [0-9a-f]+: /, "").slice(0, 300) }; } }
log({ step: "artifact", redeemHex: redeem, tag, covAddr });
// fund 6 covenant outputs of 1 TKAS each from W6's 1500 TKAS output
const F = { address: me, outpoint: { transactionId: "bd9eb65903cc4c6379334a4c0d0a5ffd679bf449a115eb3ad49cff4c01d14265", index: 5 }, amount: 150000000000n, scriptPublicKey: spk, blockDaaScore: 0n, isCoinbase: false };
const K = 6, V = 100000000n;
const outs = Array.from({ length: K }, () => ({ address: covAddr, amount: V })); outs.push({ address: me, amount: F.amount - V * BigInt(K) - 2000000n });
const ftx = kaspa.createTransaction([F], outs, 0n, null, 1); kaspa.signTransaction(ftx, [key], false);
const fr = await submit(ftx); log({ step: "fund covenant outputs", ...fr, outputs: K, eachSompi: V });
if (!fr.accepted) process.exit(1);
// spend attempts: each builds a 1-in-1-out tx from one covenant output back to W6 with a hand-made signature script
const cases = [
  ["n=0 (below floor)", (b) => b.addI64(0n)],
  ["n=-1 (negative)", (b) => b.addI64(-1n)],
  ["n=1 but wrong dispatch tag", (b) => b.addI64(1n), "00000000"],
  ["n as 9-byte number (over size check)", (b) => b.addData("010000000000000000")],
  ["n=1 (at floor)", (b) => b.addI64(1n)],
  ["n=2^63-1 (huge)", (b) => b.addI64(9223372036854775807n)],
  ["n=5 (above floor)", (b) => b.addI64(5n)],
];
let slot = 0; const used = new Set();
for (const [name, pushN, tagOverride] of cases) {
  // failing cases reuse slot 0 until it is spent; passing cases take the next unspent slot
  const idx = slot;
  const e = { address: covAddr, outpoint: { transactionId: fr.txid, index: idx }, amount: V, scriptPublicKey: p2sh, blockDaaScore: 0n, isCoinbase: false };
  const tx = kaspa.createTransaction([e], [{ address: me, amount: V - 5000000n }], 0n, null, 1);
  const sb = pushN(new kaspa.ScriptBuilder()); sb.addData(tagOverride || tag); sb.addData(redeem);
  tx.inputs[0].signatureScript = sb.drain();
  const r = await submit(tx);
  log(J({ case: name, slot: idx, ...r }));
  if (r.accepted) { used.add(idx); slot++; }
}
await rpc.disconnect();
