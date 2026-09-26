# F5 (MEDIUM, config): RPC ingest is throttled by the `--async-threads` setting

**Severity:** Medium — silently caps accepted TPS per node; looks like "the network is slow".

## Evidence
- Both nodes originally ran `--async-threads=1` (see the full command line recorded in `logs/C10-restart-n0.log`).
- `logs/storm/ramp.log` 21:10:50: "HALT tps; restart n0 with --async-threads=4 (RPC ingest bottleneck: n0/n1 run --async-threads=1)".
- Before the change, 8 sender processes each stalled at ~310–326 tx/s accepted (`logs/storm/tps-T*.jsonl`, 19:10 UTC samples),
  ~2,550 tx/s total across 8 senders. After restart with 4 threads, per-process peaks reached ~1,940–2,040 tx/s
  (max `tps_accepted` per file), and the supervisor later logged bursts up to 13,226 tx/s accepted (1 node, 21:36–22:00).
- The gRPC server also has a hard client cap: holding 100 gRPC clients against `--rpcmaxclients=64` → 56 accepted, 44 failed,
  fresh probes got `RESOURCE_EXHAUSTED` (`logs/C8-rpccap-grpc-n0.jsonl`). wRPC held 1,000 clients fine (`logs/C9b-*`).

## Suggested fix
- Document the throughput effect of `--async-threads` in `kaspad --help`/ops docs; consider defaulting to the core count.
- Log a warning when the RPC queue is saturated, so operators can tell ingest limits from network limits.
