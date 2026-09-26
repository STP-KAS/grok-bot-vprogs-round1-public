import { readFileSync } from "node:fs";
import { kaspa, connect } from "./lib.mjs";
const addrs = readFileSync("../storm-addresses.txt","utf8").trim().split("\n").map(l=>l.split(" ")).filter(([i])=>+i>=400).map(([i,a])=>({i:+i,a}));
const rpc = await connect("n0");
const fe = await rpc.getFeeEstimate({});
console.log("fee", JSON.stringify(fe,(k,v)=>typeof v==='bigint'?v.toString():v).slice(0,400));
const r = await rpc.getUtxosByAddresses({addresses: addrs.map(x=>x.a)});
const by = {}; for (const e of r.entries) { const a = e.address.toString(); by[a]=(by[a]||[]); by[a].push(e.amount ?? e.utxoEntry?.amount); }
const funded = addrs.filter(x=>by[x.a]); 
console.log("funded", funded.length, "utxos", r.entries.length, "first", funded.slice(0,10).map(x=>`${x.i}:${by[x.a].length}:${Number(by[x.a].reduce((s,v)=>s+BigInt(v),0n))/1e8}`).join(" "));
const tot = r.entries.reduce((s,e)=>s+BigInt(e.amount ?? e.utxoEntry.amount),0n); console.log("total TKAS", Number(tot)/1e8);
process.exit(0);
