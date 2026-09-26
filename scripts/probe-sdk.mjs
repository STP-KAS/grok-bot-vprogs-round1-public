import { connect, deskKey, addrOf, log } from "./lib.mjs";
const rpc = await connect("n1");
const info = await rpc.getServerInfo();
log({ step: "serverInfo", version: info.serverVersion, synced: info.isSynced, daa: info.virtualDaaScore, net: info.networkId });
log({ step: "desk", address: addrOf(deskKey(0)) });
const m = await rpc.getMempoolEntries({ includeOrphanPool: false, filterTransactionPool: false });
log({ step: "mempool", n: m.mempoolEntries.length });
await rpc.disconnect();
