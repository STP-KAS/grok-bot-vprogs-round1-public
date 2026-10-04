# F2 (HIGH): the mempool is not persisted — a restart or crash drops every pending transaction

> **Mainnet labels (added 4 Oct 2026).** Kaspa Testnet-10 only. Every statement about mainnet in this file now carries a label: **A** = shown on TN10, backed by our own measured data (TN10 only, never proof for mainnet); **B** = plausible for mainnet but unsure, reason given; **C** = unknown, needs more testing and review. Claims, evidence and the tests still needed: [TN10 storms: what they do and do not say about a mainnet storm](https://github.com/STP-KAS/tn10-storm-2026-10-public-report/blob/main/TN10-STORMS-MAINNET-IMPLICATIONS-2026-10-04.md).

**Severity:** High for dApps/operators during congestion (silent tx loss), Low for consensus.
**Versions:** kaspad 2.1.0 (sha256 prefix `adf711b68abb2fab`), TN10, `--ram-scale=0.1`.

## What happened (verified from `logs/monitor.jsonl` + `logs/storm/ramp.log`)
- 21:11:06 CEST planned restart of `n1` (to raise `--async-threads` 1→4). `ramp.log`: "n1 mempool before: 58035".
  Monitor at 21:11:04 shows n1=58035; after restart n1's mempool started from empty.
- 21:12:50 `n0` crashed (F1) with ~100k in the pool; after restart at ~21:15:14 the monitor shows n0 mempool = 0.
- Nothing on disk restores them. Transactions that had not yet been relayed to a peer are simply gone; the wallet that sent them
  only learns this when it times out waiting for inclusion. Our senders had to rebuild UTXO state from the public API
  (`scripts/recover-utxos.py`, `scripts/rebuild-storm-state.py`), which exposed F3.

## Reproduction
Fill a node's mempool (any load script in `scripts/`), `SIGINT` it (`scripts/restart-node.sh n1`), compare mempool size before/after.

## Why it may matter on mainnet (B)
A 10–30 minute overload makes nodes the most likely to be restarted by operators (or to crash, F1) exactly when the pool is fullest.
Pending dApp transactions are then lost without an error, and wallets that do not re-broadcast will show "pending" forever. (Labels: the pool being dropped on restart is **A** on TN10, seen on our own nodes. That mainnet operators would restart or crash nodes at a full pool is **B**: plausible, but no mainnet overload was tested.)

## Suggested fix / mitigation
- Optional on-shutdown mempool dump + on-start reload (with revalidation), like Bitcoin Core's `mempool.dat`.
- Wallet/SDK: re-broadcast unconfirmed txs after a node reconnect; expose a "tx unknown to node" status.
- Operators: drain (stop feeding) before planned restarts.
