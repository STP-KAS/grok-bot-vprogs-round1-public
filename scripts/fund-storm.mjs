// Fund the storm wallets from the desk wallet: each tx spends ~430 desk coinbase UTXOs (near the 500k compute-mass
// cap) and pays 8 storm wallets. Fee = the node's own required amount (read from a zero-fee attempt) + 10%.
// usage: node fund-storm.mjs <node> <firstWallet> <count> <tkasEach> <skipUtxos>
import { readFileSync, appendFileSync } from "node:fs";
import { kaspa, connect, deskKey, addrOf, log, NET } from "./lib.mjs";
const [node = "n1", firstA = "0", countA = "240", eachA = "160", skipA = "9000"] = process.argv.slice(2);
const keys = JSON.parse(readFileSync("/home/box/secure/tn10-storm-keys.json", "utf8"));
const key = deskKey(0); const desk = addrOf(key); const spk = kaspa.payToAddressScript(desk);
const list = JSON.parse(readFileSync(process.env.UTXO_FILE || "/tmp/desk-utxos.json", "utf8")).filter((u) => u.utxoEntry.isCoinbase)
  .sort((a, b) => Number(BigInt(a.utxoEntry.blockDaaScore) - BigInt(b.utxoEntry.blockDaaScore)));
let cur = Number(skipA); const each = BigInt(Math.round(Number(eachA) * 1e8)); const PER = 8, NIN = 430;
const rpc = await connect(node);
const first = Number(firstA), count = Number(countA);
for (let w = first; w < first + count; w += PER) {
  const dests = keys.slice(w, Math.min(w + PER, first + count));
  // the public API can list outpoints our nodes no longer have; probe each input with a zero-fee 1-in-1-out tx:
  // "under the required amount" = input exists, "orphan" = missing -> skip it
  const us = []; let skipped = 0;
  while (us.length < NIN && cur < list.length) { const u = list[cur++]; const e1 = { address: desk, outpoint: u.outpoint, amount: BigInt(u.utxoEntry.amount), scriptPublicKey: spk, blockDaaScore: BigInt(u.utxoEntry.blockDaaScore), isCoinbase: true };
    const t1 = kaspa.createTransaction([e1], [{ address: desk, amount: e1.amount }], 0n, null, 1); kaspa.signTransaction(t1, [key], false);
    try { await rpc.submitTransaction({ transaction: t1, allowOrphan: false }); } catch (e) { if (/orphan/.test(String(e))) { skipped++; appendFileSync("/workspace/tn10-break-test-2026-09-25/logs/storm/api-listed-but-missing.jsonl", JSON.stringify({ outpoint: u.outpoint, daa: u.utxoEntry.blockDaaScore }) + "\n"); continue; } }
    us.push(u); }
  const entries = us.map((u) => ({ address: desk, outpoint: u.outpoint, amount: BigInt(u.utxoEntry.amount), scriptPublicKey: spk, blockDaaScore: BigInt(u.utxoEntry.blockDaaScore), isCoinbase: true }));
  const inSum = entries.reduce((a, e) => a + e.amount, 0n);
  const mk = (fee) => { const outs = dests.map((d) => ({ address: d.address, amount: each })); outs.push({ address: desk, amount: inSum - each * BigInt(dests.length) - fee }); const tx = kaspa.createTransaction(entries, outs, 0n, null, 1); kaspa.signTransaction(tx, [key], false); return tx; };
  let msg = ""; try { await rpc.submitTransaction({ transaction: mk(0n), allowOrphan: false }); } catch (e) { msg = String(e.message || e); }
  const m = msg.match(/required amount of (\d+)/);
  if (!m) { log({ step: "fund-storm", ok: false, wallets: [w, w + dests.length - 1], error: msg.slice(0, 300) }); continue; }
  const fee = (BigInt(m[1]) * 11n) / 10n;
  try { const r = await rpc.submitTransaction({ transaction: mk(fee), allowOrphan: false }); const txid = String(r.transactionId);
    dests.forEach((d, j) => appendFileSync("/workspace/tn10-break-test-2026-09-25/state-storm-funded.jsonl", JSON.stringify({ i: d.i, txid, index: j, amount: String(each) }) + "\n"));
    log({ step: "fund-storm", ok: true, wallets: [w, w + dests.length - 1], txid, inputs: us.length, skippedMissing: skipped, fee: String(fee) });
  } catch (e) { log({ step: "fund-storm", ok: false, wallets: [w, w + dests.length - 1], error: String(e.message || e).slice(0, 300) }); }
}
log({ step: "fund-storm-done", nextSkip: cur });
await rpc.disconnect();
