import { kaspa, connect } from "./lib.mjs";
const rpc = await connect("n0");
console.log("methods with mempool/utxo:", Object.getOwnPropertyNames(Object.getPrototypeOf(rpc)).filter(m=>/mempool|utxo|getMempoolEntr/i.test(m)));
process.exit(0);
