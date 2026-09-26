# F3 (MEDIUM): the public TN10 REST API lists UTXOs the node no longer has ("phantom coins")

**Severity:** Medium — wallets/tools that trust the API build invalid transactions and badly over-estimate balances.
**Components:** `api-tn10.kaspa.org` (public REST API/indexer) vs local kaspad 2.1.0 node state.

## Observation
Our nodes ran without `--utxoindex`, so sender state was rebuilt from the public API (`scripts/recover-utxos.py`,
`scripts/rebuild-storm-state.py`). Many listed outpoints were rejected by our synced node as missing/orphan inputs.
- `logs/storm/api-listed-but-missing.jsonl` (excerpt in `logs/excerpts/api-listed-but-missing-first50.jsonl`) holds **1,104**
  outpoints the API listed but the node rejected (spot-sampled; not the full set).
- Reported by the session operator (NOT independently re-verified from a committed log): about **248k** phantom coins in total,
  and the desk/faucet wallet balance looked like **~3.9M TKAS** on the API while the real spendable amount was **~53k TKAS**.
  Treat those two figures as *unverified* until re-measured with the script below.

## Reproduction
1. For a busy address, fetch `GET https://api-tn10.kaspa.org/addresses/<addr>/utxos`.
2. Build 1-in-1-out txs from those outpoints and submit to a synced node; count "orphan"/missing-input rejections.
3. Or compare with `getUtxosByAddresses` on a node that runs `--utxoindex` (recommended next step).

## Suggested fix
- API: expose the indexer's DAA/sync height with every response, and purge spent entries (reorg/prune-aware).
- Wallets: never trust indexer balances for coin selection without node confirmation; treat "orphan" rejections as a stale-UTXO signal.
