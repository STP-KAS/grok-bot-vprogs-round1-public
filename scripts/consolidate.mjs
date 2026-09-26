// Many-input transactions from the desk wallet (receive/0), whose UTXO pile is mostly ~3.2 TKAS coinbase outputs.
// mode boundary: hand-built txs with N inputs to find the node's input/mass limit.
// mode compound: let the SDK Generator batch K inputs into as many txs as it needs, submit them all.
// usage: node consolidate.mjs boundary <node> 80,200,400,...   |  node consolidate.mjs compound <node> <K> <skip>
import { readFileSync } from "node:fs";
import { kaspa, connect, deskKey, addrOf, log, NET, ensureWallets } from "./lib.mjs";
import { appendFileSync } from "node:fs";
const [mode, node = "n1", arg = "80", skipA = "0"] = process.argv.slice(2);
const key = deskKey(0); const desk = addrOf(key); const spk = kaspa.payToAddressScript(desk);
const list = JSON.parse(readFileSync("/tmp/desk-utxos.json", "utf8"))
  .filter((u) => u.utxoEntry.isCoinbase).sort((a, b) => Number(BigInt(a.utxoEntry.blockDaaScore) - BigInt(b.utxoEntry.blockDaaScore)));
let cursor = Number(skipA);
const take = (n) => { const s = list.slice(cursor, cursor + n); cursor += n; return s; };
const J = (x) => JSON.parse(JSON.stringify(x, (k, v) => (typeof v === "bigint" ? v.toString() : v)));
const rpc = await connect(node);
// optional: pay each boundary tx to a load wallet (round-robin) instead of back to the desk
const TO = process.env.TO_WALLETS ? process.env.TO_WALLETS.split(",") : null; const TW = TO ? ensureWallets(TO) : null; let k = 0;
if (mode === "boundary") {
  for (const n of arg.split(",").map(Number)) {
    const dest = TO ? TO[k++ % TO.length] : null; const destAddr = dest ? TW[dest].address : desk;
    const us = take(n);
    const entries = us.map((u) => ({ address: desk, outpoint: u.outpoint, amount: BigInt(u.utxoEntry.amount), scriptPublicKey: spk, blockDaaScore: BigInt(u.utxoEntry.blockDaaScore), isCoinbase: true }));
    const inSum = entries.reduce((a, e) => a + e.amount, 0n);
    // first pass with fee 0 to read the node's mass figure, then pay 100 sompi/gram of it (+10%)
    const mk = (fee) => { const tx = kaspa.createTransaction(entries, [{ address: destAddr, amount: inSum - fee }], 0n, null, 1); kaspa.signTransaction(tx, [key], false); return tx; };
    let r0; try { await rpc.submitTransaction({ transaction: mk(0n), allowOrphan: false }); r0 = "accepted with zero fee?"; } catch (e) { r0 = String(e.message || e); }
    const m = r0.match(/required amount of (\d+)/); const t0 = Date.now();
    let r1 = null;
    if (m) { const fee = (BigInt(m[1]) * 11n) / 10n; try { const r = await rpc.submitTransaction({ transaction: mk(fee), allowOrphan: false }); r1 = { accepted: true, txid: String(r.transactionId), fee, submit_ms: Date.now() - t0, to: dest || "desk", amount: inSum - fee }; if (dest) appendFileSync("/workspace/tn10-break-test-2026-09-25/state-funded.jsonl", JSON.stringify({ wallet: dest, txid: r1.txid, index: 0, amount: String(inSum - fee) }) + "\n"); } catch (e) { r1 = { accepted: false, fee, error: String(e.message || e).slice(0, 400), submit_ms: Date.now() - t0 }; } }
    log(J({ case: `B${n} desk tx with ${n} inputs`, inputs: n, inSum, zeroFeeReply: r0.replace(/Rejected transaction [0-9a-f]+: (transaction [0-9a-f]+ )?/, "").slice(0, 300), paid: r1 }));
  }
} else if (mode === "compound") {
  const K = Number(arg); const us = take(K);
  const entries = us.map((u) => ({ address: desk, outpoint: u.outpoint, utxoEntry: { amount: BigInt(u.utxoEntry.amount), scriptPublicKey: spk, blockDaaScore: BigInt(u.utxoEntry.blockDaaScore), isCoinbase: true } }));
  const t0 = Date.now();
  const { transactions, summary } = await kaspa.createTransactions({ entries, outputs: [], changeAddress: desk, priorityFee: 0n, networkId: NET });
  const tBuild = Date.now() - t0; let ok = 0, err = 0; const errs = {}; const masses = [];
  for (const p of transactions) { p.sign([key]); masses.push(Number(p.mass)); try { await p.submit(rpc); ok++; } catch (e) { err++; const k = String(e.message || e).replace(/[0-9a-f]{64}/g, "<h>").slice(0, 200); errs[k] = (errs[k] || 0) + 1; } }
  log(J({ case: `compound ${K} inputs via SDK Generator`, skip: skipA, txs: transactions.length, ok, err, errs, build_ms: tBuild, total_ms: Date.now() - t0, massMax: Math.max(...masses), massMin: Math.min(...masses), fees: summary.fees, finalAmount: summary.finalAmount, finalTxid: summary.finalTransactionId }));
}
await rpc.disconnect();
