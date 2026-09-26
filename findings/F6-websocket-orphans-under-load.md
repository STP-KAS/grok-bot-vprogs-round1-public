# F6 (LOW–MEDIUM): WebSocket disconnects and orphan rejections under load

**Severity:** Low for the node, Medium for dApp UX (clients must retry correctly).

## Evidence
- `logs/storm/tps-T4.jsonl` (one of 8 senders, 19:02–19:14 UTC): 18× "WebSocket disconnected", 18× "WebSocket is not connected",
  211 lines with orphan errors, e.g. `transaction <h> is an orphan where orphan is disallowed` (47 in one split step).
- `logs/tps12h` workers: `orphan_retries` up to 716 per worker (P3), `reconnects` 0 after the supervisor added auto-reconnect.
- Orphans come from spending a just-created output before the node has it (chained sends, or a different node than the one that
  accepted the parent). RPC `submitTransaction` has `allowOrphan=false` by default.

## Suggested fix / client best practice
- Keep a UTXO "cool-down" (our `COOL=3s` / campaign runner's 25 s) or pin chained sends to the same node.
- Treat "orphan" as retryable with backoff; treat WebSocket drops as reconnect + re-submit of unconfirmed txs.
- SDK: surface a typed `Orphan` error instead of a string match.
