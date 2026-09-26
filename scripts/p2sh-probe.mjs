// Probe: can a 1-in-1-out tx spending a P2SH(OP_TRUE) output (no signature, sigOpCount 0) be accepted, and what is
// its compute mass? Lower mass per tx = more txs per 500k-mass block. Testnet-10 only; outputs are anyone-can-spend.
import { readFileSync } from "node:fs";
import { kaspa, connect, log, NET } from "./lib.mjs";
const keys = JSON.parse(readFileSync("/home/box/secure/tn10-storm-keys.json", "utf8"));
const st = JSON.parse(readFileSync("/workspace/tn10-break-test-2026-09-25/state-tps-T7.json", "utf8"));
const [wi, list] = Object.entries(st).find(([i, l]) => l.length > 5);
const k = keys.find((x) => x.i === Number(wi)); const key = new kaspa.PrivateKey(k.key); const spkW = kaspa.payToAddressScript(k.address);
const [txid, idx, amt] = list[list.length - 1];
const redeem = "51"; // OP_TRUE
const spk = kaspa.payToScriptHashScript(redeem); const p2sh = kaspa.addressFromScriptPublicKey(spk, NET).toString();
const rpc = await connect("n0");
const e0 = { address: k.address, outpoint: { transactionId: txid, index: idx }, utxoEntry: { amount: BigInt(amt), scriptPublicKey: spkW, blockDaaScore: 0n, isCoinbase: false } };
let fee = 300000n; const a1 = BigInt(amt) - fee;
const t1 = kaspa.createTransaction([e0], [{ address: p2sh, amount: a1 }], 0n, null, 1); kaspa.signTransaction(t1, [key], false);
const r1 = await rpc.submitTransaction({ transaction: t1, allowOrphan: false }); log({ step: "p2sh-fund", p2sh, txid: String(r1.transactionId) });
const e1 = { address: p2sh, outpoint: { transactionId: String(r1.transactionId), index: 0 }, utxoEntry: { amount: a1, scriptPublicKey: spk, blockDaaScore: 0n, isCoinbase: false } };
const mk = (f) => { const t = kaspa.createTransaction([e1], [{ address: p2sh, amount: a1 - f }], 0n, null, 0); t.inputs[0].signatureScript = "0151"; return t; };
const t2 = mk(0n); const m = kaspa.calculateTransactionMass(NET, t2);
let msg = ""; try { await rpc.submitTransaction({ transaction: t2, allowOrphan: false }); msg = "accepted with 0 fee?"; } catch (e) { msg = String(e.message || e); }
log({ step: "p2sh-spend-0fee", sdkMass: String(m), reply: msg.slice(0, 300) });
const req = msg.match(/required amount of (\d+)/); const f2 = req ? BigInt(req[1]) : BigInt(m) * 100n;
try { const r2 = await rpc.submitTransaction({ transaction: mk(f2), allowOrphan: false }); log({ step: "p2sh-spend", ok: true, fee: String(f2), txid: String(r2.transactionId) }); }
catch (e) { log({ step: "p2sh-spend", ok: false, fee: String(f2), error: String(e.message || e).slice(0, 300) }); }
process.exit(0);
