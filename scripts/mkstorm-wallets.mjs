// Create a fresh TEST mnemonic (testnet throwaway) and derive N receive addresses for the transfer storm.
// The mnemonic and keys stay in /home/box/secure (mode 600). Only addresses are printed.
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { kaspa, SECURE, NET } from "./lib.mjs";
const N = Number(process.argv[2] || 200);
const MF = `${SECURE}/tn10-storm-mnemonic.txt`, KF = `${SECURE}/tn10-storm-keys.json`;
if (!existsSync(MF)) { writeFileSync(MF, kaspa.Mnemonic.random(24).phrase + "\n", { mode: 0o600 }); chmodSync(MF, 0o600); }
const phrase = readFileSync(MF, "utf8").trim();
const gen = new kaspa.PrivateKeyGenerator(new kaspa.XPrv(new kaspa.Mnemonic(phrase).toSeed("")), false, 0n);
const out = [];
for (let i = 0; i < N; i++) { const k = gen.receiveKey(i); out.push({ i, key: k.toString(), address: k.toKeypair().toAddress(NET).toString() }); }
writeFileSync(KF, JSON.stringify(out), { mode: 0o600 }); chmodSync(KF, 0o600);
writeFileSync("/workspace/tn10-break-test-2026-09-25/storm-addresses.txt", out.map((o) => `${o.i} ${o.address}`).join("\n") + "\n");
console.log(JSON.stringify({ wallets: N, first: out[0].address, last: out[N - 1].address }));
