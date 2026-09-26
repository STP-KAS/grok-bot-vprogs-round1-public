# F7 (MEDIUM, vprogs tooling): the vprogs TN10 runtime panics without `--utxoindex`; vprog moves under load were skipped

**Severity:** Medium — blocks running vprogs against a performance-tuned node; panic instead of a clear startup error.

## Evidence (`vprogs/tn10-runtime-under-storm/run-2130.log`)
Upstream `kaspanet/vprogs` `examples/tn10-runtime` (branch `release-candidate` @ `3a61c0ba608b`, dev-mode proofs), run 21:30 CEST:
```
settlement mode (dev): bootstrapping dev-pins covenant; issuer kaspatest:qq8uju6j...
thread 'main' panicked at l1/wallet/src/lib.rs:167:56:
fetch spendable utxos: RpcSubsystem("Method unavailable. Run the node with the --utxoindex argument.")
```
Our only running node (n0) has no utxoindex; n1 was wiped for disk. So the planned "vprog moves under 30-min overload" test was SKIPPED.

## Suggested fix
- `l1/wallet`: check `getServerInfo().hasUtxoIndex` at startup and exit with a clear message (no panic).
- Next step for us: start a third node with `--utxoindex` (disk budget permitting) and re-run `vprogs/tn10-runtime-under-storm/run.sh`.
