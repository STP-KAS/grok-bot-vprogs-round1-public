// Fund throwaway test wallets from the desk wallet (receive/0). Testnet-10 only.
// UTXOs come from the public API list (our nodes run without --utxoindex); submission goes to our local node.
// usage: node fund.mjs <node> <amountTkasEach> <name1,name2,...> [minUtxoTkas]
import { readFileSync } from "node:fs";
import { kaspa, connect, deskKey, addrOf, ensureWallets, log, NET } from "./lib.mjs";
const [node = "n1", each = "1000", namesArg = "W1", minU = "1000"] = process.argv.slice(2);
const names = namesArg.split(",");
const wallets = ensureWallets(names);
const key = deskKey(0); const desk = addrOf(key);
const list = JSON.parse(readFileSync(process.env.UTXO_FILE || "/tmp/desk-utxos.json", "utf8"));
const need = BigInt(Math.round(Number(each) * 1e8)) * BigInt(names.length);
const big = list.filter((u) => BigInt(u.utxoEntry.amount) >= BigInt(Math.round(Number(minU) * 1e8)))
  .sort((a, b) => (BigInt(b.utxoEntry.amount) > BigInt(a.utxoEntry.amount) ? 1 : -1));
const picked = []; let sum = 0n;
for (const u of big) { if (sum >= need + 100000000n) break; picked.push(u); sum += BigInt(u.utxoEntry.amount); }
if (sum < need) { log({ step: "fund", ok: false, error: "not enough large utxos", have: sum }); process.exit(2); }
const entries = picked.map((u) => ({ address: u.address, outpoint: u.outpoint,
  utxoEntry: { amount: BigInt(u.utxoEntry.amount), scriptPublicKey: new kaspa.ScriptPublicKey(0, u.utxoEntry.scriptPublicKey.scriptPublicKey),
    blockDaaScore: BigInt(u.utxoEntry.blockDaaScore), isCoinbase: Boolean(u.utxoEntry.isCoinbase) } }));
const outputs = names.map((n) => ({ address: wallets[n].address, amount: BigInt(Math.round(Number(each) * 1e8)) }));
const rpc = await connect(node);
try {
  const { transactions, summary } = await kaspa.createTransactions({ entries, outputs, changeAddress: desk, priorityFee: 0n, networkId: NET });
  const txids = [];
  for (const p of transactions) { p.sign([key]); txids.push(String(await p.submit(rpc))); }
  log({ step: "fund", ok: true, node, inputs: entries.length, inputSompi: sum, outputs: names.map((n) => [n, wallets[n].address]), eachSompi: outputs[0].amount, txids, fees: summary.fees });
} catch (e) { log({ step: "fund", ok: false, error: String(e.message || e) }); process.exitCode = 1; }
finally { await rpc.disconnect(); }
