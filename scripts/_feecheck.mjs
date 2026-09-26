import { kaspa, connect } from "./lib.mjs";
const rpc = await connect("n0");
try { const fe = await rpc.getFeeEstimate({}); console.log("feeEstimate:", JSON.stringify(fe, (k,v)=>typeof v==='bigint'?v.toString():v)); } catch(e){ console.log("getFeeEstimate ERR:", String(e).slice(0,200)); }
try { const info = await rpc.getInfo(); console.log("mempool:", info.mempoolSize, "synced:", info.isSynced); } catch(e){ console.log(String(e).slice(0,120)); }
// build a sample 1-in-1-out tx to measure mass
const ent = { address: "kaspatest:qq", outpoint:{transactionId:"0".repeat(64),index:0}, utxoEntry:{ amount:100000000n, scriptPublicKey: kaspa.payToScriptHashScript("51"), blockDaaScore:0n, isCoinbase:false } };
const tx = kaspa.createTransaction([ent],[{address: kaspa.addressFromScriptPublicKey(kaspa.payToScriptHashScript("51"),"testnet-10").toString(), amount: 99990000n}],0n,null,0);
tx.inputs[0].signatureScript="0151";
console.log("p2sh mass:", kaspa.calculateTransactionMass("testnet-10", tx));
process.exit(0);
