# F1 (CRITICAL): kaspad 2.1.0 aborts the whole node when the mempool reaches its transaction-count cap

**Status:** reproduced once on our TN10 node `n0`, 2026-09-25 21:12:50 CEST. Draft upstream issue text at the bottom. NOT filed.
**Severity:** Critical — a remote peer or an RPC client can terminate a node with a flood of otherwise-valid, fee-paying transactions.

## Summary
Under sustained high-rate submission (~4,600 tx/s of 1-in-1-out txs over wRPC plus P2P relay from the peer node), the mempool
reached its transaction-count cap and kaspad **panicked and exited** instead of rejecting the one extra transaction. The size check
is an `assert!`; a transaction was admitted while the pool already held `maximum_transaction_count` entries.

## Versions / environment
- kaspad **2.1.0**, binary `/workspace/artifacts/kaspa-tn10/bin/kaspad`, sha256 prefix `adf711b68abb2fab`.
- Source line: `mining/src/mempool/validate_and_insert_transaction.rs:123` (rusty-kaspa, kaspad 2.1.0 line).
- Flags: `--testnet --netsuffix=10 --ram-scale=0.1 --async-threads=4 --rpcmaxclients=64` (+ ports/peers).
  `--ram-scale=0.1` scales `maximum_transaction_count` to **100,000** (config.rs), which is the `max: 100000` in the message.
- Box: 8 cores, 16 GB RAM, Linux (overlay disk).

## Reproduction
1. Run two peered TN10 kaspad 2.1.0 nodes with `--ram-scale=0.1` (100k mempool cap) and `--async-threads=4`.
2. Point ~8 sender processes (`scripts/tps.mjs`, P2SH(OP_TRUE) 1-in-1-out mode, conc 64/proc) at both nodes' wRPC borsh ports.
3. Drive offered rate to ~4,000–8,000 tx/s so both mempools sit at 60k–100k with active feerate eviction.
4. The node exits within minutes. Ours crashed once about 20s after both mempools crossed ~92k–98k (see `../logs` monitor samples
   21:12:34 n0=39203 → 21:12:44 n0=97987 → crash 21:12:50).

## Evidence (last log lines before exit, full excerpt: `n0-mempool-panic-2112.log`)
```
21:12:44.699 [INFO ] Tx throughput stats: 4608.55 u-tps, 90.61% e-tps (in: 57148 via RPC, 43519 via P2P, out: 46115 via accepted blocks)
21:12:44.711 [INFO ] Mempool stats: 6564 transactions were evicted from the mempool in favor of incoming higher feerate transactions
21:12:50.259 [ERROR] thread 'tokio-runtime-worker' panicked at mining/src/mempool/validate_and_insert_transaction.rs:123:13:
             Transactions in mempool: 100001, max: 100000, mempool bytes size: 51400514, max: 100000000
             note: run with `RUST_BACKTRACE=1` ... / Exiting...
```
The panic hook exits the whole process. The ~100k in-memory mempool was lost (see F2 — mempool is not persisted). The peer node `n1`
had shed ~58k the same way on a planned restart one minute earlier. `n0` restarted cleanly and re-synced within ~15 s.

## Root-cause hypothesis
`validate_and_insert_transaction` calls `transaction_pool.limit_transaction_count()` to select low-priority / low-feerate txs to evict,
evicts them, then `assert!`s `len < maximum_transaction_count`. When the selected evictions do **not** actually free a slot, the assert
aborts the node instead of returning `RejectMempoolIsFull`. Candidate reasons (not isolated here): `remove_transaction` returning
`Ok(())` without removing a tx that already left the pool; a race between block-template/new-block handling and insertion; or redeemer
bookkeeping keeping a "removed" tx counted. Notably, RPC-submitted txs are `Priority::High` and are **not** eligible for feerate
eviction, so a pool that fills with high-priority txs cannot self-drain, making the assert reachable.

## Suggested fix
Replace the post-eviction `assert!` with a graceful `Err(RuleError::RejectMempoolIsFull)` (or equivalent), returned to the caller so the
one transaction is rejected and the node keeps running. Separately, audit `limit_transaction_count()` so it cannot report success
without freeing a slot, and consider capping the share of `Priority::High` (RPC) entries so a pure-RPC flood cannot wedge the pool.

## Draft upstream issue (NOT filed)
> **Title:** kaspad panics/exits on mempool count cap under sustained load (assert at validate_and_insert_transaction.rs:123)
>
> **Body:** On kaspad 2.1.0, under ~4.6k tx/s sustained submission (RPC + P2P relay) with the mempool at its `maximum_transaction_count`
> cap, the node panics with `Transactions in mempool: 100001, max: 100000` at `mining/src/mempool/validate_and_insert_transaction.rs:123`
> and exits. The size check is an `assert!` executed after eviction; when eviction frees no slot (e.g. the pool is full of `Priority::High`
> RPC txs that are not eviction-eligible), the assert aborts the process instead of rejecting the incoming tx. This is remotely triggerable
> with valid fee-paying transactions. Suggested: return `RejectMempoolIsFull` instead of asserting, and bound the high-priority share.
> Repro, flags, and full log excerpt attached. Observed on testnet-10 with `--ram-scale=0.1` (cap 100k).
