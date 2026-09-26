# F4 (MEDIUM, ops): disk growth at sustained high TPS vs the pruning window

**Severity:** Medium for node operators; can end in a full disk and a node halt.

## Measurements (from logs)
- Planning figure recorded at 21:34:42 in `logs/storm/ramp.log`: "~320 B/tx on one node -> 12h budget cap ~3540 TPS;
  3000 TPS x 12h = ~38.6 GB" with 54 GB free and an 8.4 GB safety floor.
- `logs/tps12h/du.log` (21:25): n0 appdir 44,653 MB, n1 43,744 MB; box disk 91% used, 11.8 GB free.
- Supervisor samples: disk free fell from 12.2 GB (21:22) to 10.78 GB (21:31) with two nodes at ~4k TPS
  → ~1.4 GB in 9 min ≈ **~9 GB/h** for both nodes together (≈ 300–320 B per tx per node). Consistent with the planning figure.
- 21:33 `n1` stopped and its appdir (~44 GB) deleted (user-approved) → disk free 53.85 GB at 21:35.
- n0 alone afterwards: appdir 43.95 GB (21:35) → 44.76 GB (21:50) while disk free fell 55.38 → 53.52 GB (21:38 → 21:56):
  ~1.9 GB/18 min ≈ **~6 GB/h** at ~5–6k TPS on one node (appdir growth is stepwise because RocksDB compacts in bursts).

## Why it matters
Pruning keeps only a bounded window of block data, but the size of that window scales with transactions per block. At 10–30× normal
load a node sized for today's traffic can fill its disk within hours. A full disk halts the node — which, combined with F2,
loses the mempool as well.

## Suggested mitigation
- Document per-TPS disk budgets (e.g. `~300 B × TPS × pruning-window-seconds`) for node operators.
- kaspad: warn loudly and refuse new mempool entries (not crash) below a free-space floor.
- Our supervisor implements a disk taper (9.5 → 8.4 GB) and `scripts/monitor.py` writes a STOP file below 8 GB.
