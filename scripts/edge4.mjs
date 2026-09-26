// Edge cases, round 4: ~240 KB payload. First with 0 fee (to read the node's full fee rule), then paying it.
import { kaspa, connect, walletKey, loadWallets, log, NET } from "./lib.mjs";
const W = loadWallets(); const rpc = await connect(process.argv[2] || "n1");
const key = walletKey("W4"), me = W.W4.address, spk = kaspa.payToAddressScript(me);
const e = { address: me, outpoint: { transactionId: "e2bc96d6ff3385a173b041d762bbb97e2d86a46047ec1072bc58e539b7fb1dbc", index: 200 }, amount: 49900000000n, scriptPublicKey: spk, blockDaaScore: 0n, isCoinbase: false };
const pl = new Uint8Array(240 * 1024).fill(0x64);
async function sub(fee) { const tx = kaspa.createTransaction([e], [{ address: me, amount: e.amount - fee }], 0n, pl, 1); kaspa.signTransaction(tx, [key], false); try { const r = await rpc.submitTransaction({ transaction: tx, allowOrphan: false }); return { fee, accepted: true, txid: String(r.transactionId) }; } catch (x) { return { fee, accepted: false, error: String(x.message || x) }; } }
log({ case: "E17 240 KB payload, fee 0", ...(await sub(0n)) });
log({ case: "E17 240 KB payload, fee 0.5 TKAS", ...(await sub(50000000n)) });
await rpc.disconnect();
