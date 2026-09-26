# tn10-runtime under storm

**Purpose:** show whether a vprog (upstream demo runtime, dev-mode proofs) keeps settling while L1 is overloaded.

**How to run:** `bash run.sh [seconds=900]` — needs the vprogs checkout at `/workspace/vprogs-rc` (branch `release-candidate`,
`3a61c0ba608b`), a node WITH `--utxoindex` on `TN10RT_WRPC_URL`, and two throwaway TN10 keys (read into env from a local
mode-600 file; never printed; logs are redacted with `sed`).

**Expected:** accounts created, moves executed, settlement txs landing on L1 despite a 50–70k mempool.
**Actual (21:30 CEST):** panic at `l1/wallet/src/lib.rs:167` — `Method unavailable. Run the node with the --utxoindex argument.`
See `run-2130.log`, `logA-2130.txt`, `logB-2130.txt`. The overload phase then SKIPPED vprog moves for the same reason. → finding F7.
**Next step:** a third node with `--utxoindex` (disk ~+10–20%), then re-run during a full-throttle window.
