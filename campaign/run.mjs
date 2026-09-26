// Two-hour TN10 spray and tic-tac-toe matches.
// WALLET_MNEMONIC is the new wallet. The desk seed stays in the local wallet file.
// This file prints no secrets. Stdout is only DONE or FAILED.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import {
  initSync,
  my_ids,
  network_params,
  create_game_tx,
  join_game_tx,
  turn_tx,
  UtxoCandidate,
} from "file:///C:/Users/<user>/AppData/Local/Temp/enc-wasm/package/vprog_tictactoe_encoder_wasm.js";

const require = createRequire(
  "C:/Users/<user>/grok-test-cascade-work/wasm-sdk/kaspa-wasm32-sdk/examples/nodejs/javascript/transactions/simple-transaction.js"
);
globalThis.WebSocket = require("websocket").w3cwebsocket;
const kaspa = await import(
  pathToFileURL(
    "C:/Users/<user>/grok-test-cascade-work/wasm-sdk/kaspa-wasm32-sdk/nodejs/kaspa/kaspa.js"
  ).href
);

const EXPECTED =
  "kaspatest:qr90yfltgn4sm56gdtyg9hvl4mv47c0lhsugs308w8x78kljdngzgg62pkxkm";
const ROOT = "C:/Users/<user>/Documents/kaspa/grok-bot-vprogs";
const LOG = `${ROOT}/campaign/log.jsonl`;
const STATUS = `${ROOT}/campaign/STATUS.md`;
const HALF = 50_000_000n;
const FEE = 20_000n;
const STAKE = 100_000_000n;
const HOURS = 12;
const N = 128;
const SEND_WORKERS = 12;
const GAME_WORKERS = 4;
const UNTIL = `${ROOT}/campaign/until.txt`;
const phraseFile = `${ROOT}/campaign/.phrase`;
const phrase = process.env.WALLET_MNEMONIC || (readFileSync(phraseFile, "utf8").trim());
if (!phrase) fail("missing_mnemonic");

initSync(
  readFileSync(
    "C:/Users/<user>/AppData/Local/Temp/enc-wasm/package/vprog_tictactoe_encoder_wasm_bg.wasm"
  )
);
const params = network_params("testnet-10");
const configId = createHash("sha256").update(Buffer.from([4])).digest("hex");
const net = new kaspa.NetworkId("testnet-10");
const rpc = new kaspa.RpcClient({
  resolver: new kaspa.Resolver(),
  networkId: net,
  encoding: kaspa.Encoding.Borsh,
});

function fail(error) {
  console.log(`FAILED: ${error}`);
  process.exit(1);
}
function note(row) {
  appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n");
}
function identity(words, index) {
  const key = new kaspa.PrivateKeyGenerator(
    new kaspa.XPrv(new kaspa.Mnemonic(words).toSeed("")),
    false,
    0n
  ).receiveKey(index);
  const address = key.toKeypair().toAddress(net).toString();
  const priv = key.toString();
  return { index, address, priv, userId: my_ids(priv).user_id_hex, signer: new kaspa.PrivateKey(priv) };
}
function hex(b) {
  return Buffer.from(b).toString("hex");
}
class Reader {
  constructor(b) {
    this.b = b;
    this.pos = 0;
  }
  u8() {
    return this.b[this.pos++];
  }
  u16() {
    const v = this.b[this.pos] | (this.b[this.pos + 1] << 8);
    this.pos += 2;
    return v;
  }
  u32() {
    const v =
      (this.b[this.pos] |
        (this.b[this.pos + 1] << 8) |
        (this.b[this.pos + 2] << 16) |
        (this.b[this.pos + 3] << 24)) >>>
      0;
    this.pos += 4;
    return v;
  }
  u64() {
    return BigInt(this.u32()) + 0x1_0000_0000n * BigInt(this.u32());
  }
  bytes(n) {
    const v = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
  vec() {
    return this.bytes(this.u32());
  }
}
function txFromBorsh(bytes) {
  const r = new Reader(bytes);
  const version = r.u16();
  const inputs = Array.from({ length: r.u32() }, () => {
    const transactionId = hex(r.bytes(32));
    const index = r.u32();
    const signatureScript = hex(r.vec());
    const sequence = r.u64();
    const input = { previousOutpoint: { transactionId, index }, signatureScript, sequence, sigOpCount: 0 };
    if (r.u8() === 0) input.sigOpCount = r.u8();
    else input.computeBudget = r.u16();
    return input;
  });
  const outputs = Array.from({ length: r.u32() }, () => {
    const value = r.u64();
    const scriptPublicKey = { version: r.u16(), script: hex(r.vec()) };
    let covenant;
    if (r.u8() === 1) covenant = { authorizingInput: r.u16(), covenantId: hex(r.bytes(32)) };
    return { value, scriptPublicKey, covenant };
  });
  return {
    version,
    inputs,
    outputs,
    lockTime: r.u64(),
    subnetworkId: hex(r.bytes(20)),
    gas: r.u64(),
    payload: hex(r.vec()),
    storageMass: r.u64(),
    id: hex(r.bytes(32)),
  };
}
function entryOf(raw) {
  return {
    address: raw.address,
    outpoint: { transactionId: raw.outpoint.transactionId, index: raw.outpoint.index },
    utxoEntry: {
      amount: BigInt(raw.utxoEntry.amount),
      scriptPublicKey: new kaspa.ScriptPublicKey(0, raw.utxoEntry.scriptPublicKey.scriptPublicKey),
      blockDaaScore: BigInt(raw.utxoEntry.blockDaaScore),
      isCoinbase: Boolean(raw.utxoEntry.isCoinbase),
    },
  };
}
async function utxos(address) {
  const res = await fetch(`https://api-tn10.kaspa.org/addresses/${address}/utxos`);
  if (!res.ok) throw new Error(`utxo_${res.status}`);
  const body = await res.json();
  return Array.isArray(body) ? body : [];
}
async function daa() {
  const dag = await (await fetch("https://api-tn10.kaspa.org/info/blockdag")).json();
  return BigInt(dag.virtualDaaScore);
}
function mature(rows, tip, min) {
  return rows.filter((u) => {
    const amt = BigInt(u.utxoEntry.amount);
    const born = BigInt(u.utxoEntry.blockDaaScore);
    const ok = !u.utxoEntry.isCoinbase || tip > born + 1000n;
    return ok && amt >= min;
  });
}
async function submitPlain(entries, outputs, signer, payload) {
  const built = await kaspa.createTransactions({
    entries,
    outputs,
    priorityFee: FEE,
    changeAddress: entries[0].address,
    networkId: net,
    payload: payload ? Array.from(new TextEncoder().encode(payload)) : undefined,
  });
  const ids = [];
  for (const pending of built.transactions) {
    await pending.sign([signer]);
    ids.push(String(await pending.submit(rpc)));
  }
  return ids;
}
async function submitCarrier(bytes) {
  const tx = new kaspa.Transaction(txFromBorsh(bytes));
  const submitted = await rpc.submitTransaction({ transaction: tx, allowOrphan: false });
  return String(submitted.transactionId ?? tx.id);
}
function candidate(raw) {
  return new UtxoCandidate(
    raw.outpoint.transactionId,
    raw.outpoint.index,
    BigInt(raw.utxoEntry.amount),
    raw.utxoEntry.scriptPublicKey.scriptPublicKey,
    0
  );
}

const root = identity(phrase, 0);
if (root.address !== EXPECTED) fail("address_mismatch");
const wallets = [root];
for (let i = 1; i < N; i++) wallets.push(identity(phrase, i));

const deskPhrase = readFileSync(
  "C:/Users/<user>/Documents/kaspa/groks-wallet/secrets/wallet.txt",
  "utf8"
)
  .split(/\r?\n/)
  .find((l) => l.startsWith("mnemonic:"))
  .slice("mnemonic:".length)
  .trim();
const desk = identity(deskPhrase, 0);

await rpc.connect();
const stats = { sends: 0, sendFail: 0, games: 0, gameFail: 0, volume: 0n, funded: "0", addresses: N };
const recent = new Map();
const reserved = new Set();
const playing = new Set();
let pushedAt = Date.now();

function remember(ids) {
  const now = Date.now();
  for (const id of ids) recent.set(id, now);
  for (const [id, at] of recent) if (now - at > 60_000) recent.delete(id);
}
function spendable(rows, tip, min) {
  const now = Date.now();
  return mature(rows, tip, min).filter((u) => {
    const at = recent.get(u.outpoint.transactionId);
    return !(at && now - at < 25_000);
  });
}

async function fundIfShort() {
  const bal = await (await fetch(`https://api-tn10.kaspa.org/addresses/${root.address}/balance`)).json();
  const have = BigInt(bal.balance ?? 0);
  if (have >= 50_000_000_000n) {
    stats.funded = have.toString();
    note({ kind: "fund_skip", balance: have.toString() });
    return;
  }
  const tip = await daa();
  const rows = mature(await utxos(desk.address), tip, 150_000_000n).sort((a, b) =>
    BigInt(a.utxoEntry.amount) < BigInt(b.utxoEntry.amount) ? -1 : 1
  );
  let left = 200_000_000_000n;
  const chunk = 20_000_000_000n;
  let guard = 0;
  while (left > 0n && guard < 12) {
    guard++;
    const want = left > chunk ? chunk : left;
    const picked = [];
    let sum = 0n;
    for (const row of rows) {
      if (picked.includes(row)) continue;
      picked.push(row);
      sum += BigInt(row.utxoEntry.amount);
      if (sum >= want + FEE + 1_000_000n || picked.length >= 12) break;
    }
    if (sum < want + FEE) break;
    for (const row of picked) {
      const at = rows.indexOf(row);
      if (at >= 0) rows.splice(at, 1);
    }
    try {
      const ids = await submitPlain(
        picked.map(entryOf),
        [{ address: root.address, amount: want }],
        desk.signer,
        "grok-bot-vprogs-fund"
      );
      stats.volume += want;
      note({ kind: "fund", txids: ids, sompi: want.toString() });
      left -= want;
    } catch (err) {
      note({ kind: "fund_fail", error: String(err.message || err) });
      break;
    }
  }
  stats.funded = (200_000_000_000n - left).toString();
}

function takeRow(rows) {
  rows.sort((x, y) => (BigInt(x.utxoEntry.amount) < BigInt(y.utxoEntry.amount) ? -1 : 1));
  for (const row of rows) {
    const id = `${row.outpoint.transactionId}:${row.outpoint.index}`;
    if (reserved.has(id)) continue;
    reserved.add(id);
    return row;
  }
  return null;
}

async function sendHalf(pool) {
  const open = pool.filter((w) => !playing.has(w.index));
  if (!open.length) return;
  const a = open[Math.floor(Math.random() * open.length)];
  let b = wallets[Math.floor(Math.random() * N)];
  if (a.index === b.index) b = wallets[(a.index + 1) % N];
  const tip = await daa();
  const row = takeRow(spendable(await utxos(a.address), tip, HALF + FEE));
  if (!row) {
    stats.sendFail++;
    note({ kind: "send_skip", from: a.index });
    return;
  }
  const ids = await submitPlain([entryOf(row)], [{ address: b.address, amount: HALF }], a.signer, "grok-bot-vprogs");
  remember(ids);
  stats.sends++;
  stats.volume += HALF;
  note({ kind: "send", from: a.index, to: b.index, txids: ids });
}

async function fanOut() {
  const tip = await daa();
  const rows = spendable(await utxos(root.address), tip, 220_000_000n);
  rows.sort((a, b) => (BigInt(a.utxoEntry.amount) < BigInt(b.utxoEntry.amount) ? -1 : 1));
  const need = [];
  for (const w of wallets) {
    if (w.index === 0) continue;
    const bal = await (await fetch(`https://api-tn10.kaspa.org/addresses/${w.address}/balance`)).json();
    if (BigInt(bal.balance ?? 0) < HALF) need.push(w);
  }
  note({ kind: "fanout_need", count: need.length });
  const gift = 200_000_000n;
  let cursor = 0;
  while (need.length && cursor < rows.length) {
    const raw = rows[cursor++];
    const room = Number((BigInt(raw.utxoEntry.amount) - FEE) / gift);
    const n = Math.min(need.length, room, 4);
    if (n < 1) continue;
    const batch = need.splice(0, n);
    try {
      const ids = await submitPlain(
        [entryOf(raw)],
        batch.map((w) => ({ address: w.address, amount: gift })),
        root.signer,
        "grok-bot-vprogs-new"
      );
      remember(ids);
      stats.sends++;
      stats.volume += gift * BigInt(batch.length);
      note({ kind: "fanout", to: batch.map((w) => w.index), txids: ids });
    } catch (err) {
      need.unshift(...batch);
      note({ kind: "fanout_fail", error: String(err.message || err) });
      break;
    }
  }
}

async function playOne() {
  const free = wallets.filter((w) => w.index !== 0 && !playing.has(w.index));
  if (free.length < 2) return;
  const a = free[Math.floor(Math.random() * free.length)];
  let b = free[Math.floor(Math.random() * free.length)];
  if (a.index === b.index) b = free[(free.indexOf(a) + 1) % free.length];
  playing.add(a.index);
  playing.add(b.index);
  try {
  const state = await (await fetch("https://vprogs-tt.izio.fr/api/state")).json();
  const tip = await daa();
  const need = STAKE + 50_000_000n;
  const au = spendable(await utxos(a.address), tip, need);
  const bu = spendable(await utxos(b.address), tip, need);
  if (!au.length || !bu.length) {
    stats.gameFail++;
    note({ kind: "game_skip", a: a.index, b: b.index });
    return;
  }
  const acct = await fetch(`https://vprogs-tt.izio.fr/api/accounts/${a.userId}`);
  const started = acct.status === 200 ? BigInt((await acct.json()).games_started ?? 0) : 0n;
  const created = create_game_tx(
    a.priv, params, candidate(au[0]), a.address, state.lane_subnet, configId,
    started, STAKE, 1, 1, STAKE, state.covenant_id
  );
  const createId = await submitCarrier(created);
  let gid = null;
  for (let i = 0; i < 15 && !gid; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const games = await (await fetch("https://vprogs-tt.izio.fr/api/games")).json();
    const mine = (games.games || []).find(
      (g) => g.state_name === "Open" && g.players && g.players[0] === a.userId
    );
    if (mine) gid = mine.id;
  }
  if (!gid) throw new Error("create_not_visible");
  const tip2 = await daa();
  const bu2 = mature(await utxos(b.address), tip2, need);
  const joined = join_game_tx(
    b.priv, params, candidate(bu2[0]), b.address, state.lane_subnet, configId,
    gid, STAKE, state.covenant_id
  );
  await submitCarrier(joined);
  const plan = [[a, 0], [b, 3], [a, 4], [b, 6], [a, 8]];
  for (const [who, cell] of plan) {
    const opp = who === a ? b.userId : a.userId;
    const tipN = await daa();
    const mine = mature(await utxos(who.address), tipN, 30_000_000n);
    if (!mine.length) throw new Error("turn_unfunded");
    const bytes = turn_tx(
      who.priv, params, candidate(mine[0]), who.address, state.lane_subnet,
      gid, who.userId, opp, cell
    );
    await submitCarrier(bytes);
    await new Promise((r) => setTimeout(r, 1500));
  }
  let final = null;
  for (let i = 0; i < 15; i++) {
    const g = await (await fetch(`https://vprogs-tt.izio.fr/api/games/${gid}`)).json();
    if (g.state_name && g.state_name !== "Open" && g.state_name !== "Playing") {
      final = g.state_name;
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  stats.games++;
  note({ kind: "game", id: gid, state: final, a: a.index, b: b.index, createId });
  } finally {
    playing.delete(a.index);
    playing.delete(b.index);
  }
}

function writeStatus() {
  const text = [
    "# Status",
    "",
    `Updated ${new Date().toISOString()}`,
    "",
    `- sends: ${stats.sends}`,
    `- send failures: ${stats.sendFail}`,
    `- finished games: ${stats.games}`,
    `- game failures: ${stats.gameFail}`,
    `- sompi moved: ${stats.volume.toString()}`,
    `- funded onto index 0: ${stats.funded}`,
    "",
  ].join("\n");
  writeFileSync(STATUS, text);
}
function push() {
  writeStatus();
  try {
    execSync("git add campaign README.md", { cwd: ROOT, stdio: "ignore" });
    try {
      execSync("git diff --cached --quiet", { cwd: ROOT, stdio: "ignore" });
      return;
    } catch {
      execSync('git commit -m "Record the running TN10 spray and matches."', { cwd: ROOT, stdio: "ignore" });
      execSync("git push origin main", { cwd: ROOT, stdio: "ignore" });
    }
  } catch (err) {
    note({ kind: "push_fail", error: String(err.message || err) });
  }
  pushedAt = Date.now();
}

try {
  let end = Date.now() + HOURS * 3600 * 1000;
  try {
    const prior = readFileSync(UNTIL, "utf8").trim();
    const parsed = Date.parse(prior);
    if (Number.isFinite(parsed) && parsed > Date.now()) end = parsed;
  } catch { /* first launch */ }
  writeFileSync(UNTIL, new Date(end).toISOString());
  await fundIfShort();
  await fanOut();
  note({ kind: "scale", addresses: N, senders: SEND_WORKERS, games: GAME_WORKERS });
  const slices = Array.from({ length: SEND_WORKERS }, (_, i) =>
    wallets.filter((w) => w.index !== 0 && w.index % SEND_WORKERS === i)
  );
  async function sendLoop(pool) {
    while (Date.now() < end) {
      try {
        await sendHalf(pool);
      } catch (err) {
        stats.sendFail++;
        const msg = String(err.message || err);
        if (stats.sendFail % 200 === 1) note({ kind: "send_fail", error: msg });
        if (msg.includes("Unexpected token") || msg.includes("429") || msg.includes("fetch")) {
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
      if (Date.now() - pushedAt > 10 * 60 * 1000) push();
    }
  }
  async function gameLoop() {
    while (Date.now() < end) {
      try {
        await playOne();
      } catch (err) {
        stats.gameFail++;
        const msg = String(err.message || err);
        if (stats.gameFail % 50 === 1) note({ kind: "game_fail", error: msg });
        if (msg.includes("Unexpected token") || msg.includes("429") || msg.includes("fetch")) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }
  }
  await Promise.all([
    ...slices.map((pool) => sendLoop(pool)),
    ...Array.from({ length: GAME_WORKERS }, () => gameLoop()),
  ]);
  push();
  console.log(`DONE: sends=${stats.sends} games=${stats.games}`);
} catch (err) {
  note({ kind: "fatal", error: String(err.message || err) });
  try { push(); } catch { /* keep the failure */ }
  fail(String(err.message || err));
} finally {
  await rpc.disconnect().catch(() => undefined);
}
