import { connect } from "./lib.mjs";
const rpc = await connect("n0");
const d = await rpc.getBlockDagInfo({}); const start = d.pruningPointHash ? d.sink : d.sink;
await new Promise(r=>setTimeout(r,3000));
const t=Date.now(); const v = await rpc.getVirtualChainFromBlock({ startHash: start, includeAcceptedTransactionIds: true });
console.log(Object.keys(v), v.addedChainBlockHashes.length, v.acceptedTransactionIds.length, Object.keys(v.acceptedTransactionIds[0]||{}), (v.acceptedTransactionIds||[]).reduce((s,x)=>s+x.acceptedTransactionIds.length,0), Date.now()-t,"ms");
process.exit(0);
