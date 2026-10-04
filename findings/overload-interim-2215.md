# Overload interim read: first 30 min of full-throttle storm on n0 (TN10 only)

> **Mainnet labels (added 4 Oct 2026).** Kaspa Testnet-10 only. Every statement about mainnet in this file now carries a label: **A** = shown on TN10, backed by our own measured data (TN10 only, never proof for mainnet); **B** = plausible for mainnet but unsure, reason given; **C** = unknown, needs more testing and review. Claims, evidence and the tests still needed: [TN10 storms: what they do and do not say about a mainnet storm](https://github.com/STP-KAS/tn10-storm-2026-10-public-report/blob/main/TN10-STORMS-MAINNET-IMPLICATIONS-2026-10-04.md).

Written 22:20 CEST, 25 Sep 2026. Window: **21:48:41–22:18:41 CEST** (30 min). The overload continues until 23:00 CEST, followed by a 2-minute break and then maximum throttle again. The final summary goes in `overload-30m-summary.md`.

## Setup
- Node: kaspad n0 (TN10, `--ram-scale=0.1`, so the mempool hard cap is about 100k txs). The storm runs 8 P2SH workers plus the 0.5-TKAS lane. The supervisor tapers submission between 45k and 68k mempool and closes the gate between 78k and 55k.
- The storm pays **120 sompi/gram**, which is 1.2× the node's minimum relay feerate.
- **Minimum relay feerate on this node is 100 sompi/gram**, not 1. A probe at 10 sompi/gram was rejected with "not standard: fees under the required amount"; 100 sompi/gram was accepted. All tiers below are multiples of 100 sompi/gram.
- Probes: `scripts/overload-probe.mjs`. Every 30 s it sends one 1-in-1-out self-transfer per tier (mass 1690) from throwaway storm keys 400–799, which no storm worker uses. Inclusion is detected when the txid shows up in `getVirtualChainFromBlock` accepted-tx ids, polled every 1 s, so latencies have about ±1 s resolution. Log: `logs/overload/probes.jsonl`.
- vprog / tic-tac-toe moves were **skipped**. The upstream tn10-runtime needs `--utxoindex`; n0 doesn't have it and n1 was wiped. See `vprogs/tn10-runtime-under-storm/run-2130.log`.

## Load during the window
| metric | value |
|---|---|
| included (net) TPS, average | **6,289** (10 s peak 9,274) |
| offered TPS, average | 5,056 (the taper and gate throttle it) |
| mempool | min 29.4k, typical 61–73k, **max 99,967** (at the cap) |
| blocks | 7.8–9.8 blocks/s, compute mass 67–98% of 500k (≈98% in the last 10 min) |
| mempool evictions (kaspad log) | 9,972 txs evicted for higher-feerate ones. **No panic** (the last panic was at 21:12) |
| storm fee burn | **7,207 TKAS in 30 min = ~2,400 TKAS per 10 min** |

## Probe latency by fee tier (60–61 probes per tier, 0 rejected, 0 evicted, all included)
| tier (× 100 sompi/g) | fee per probe | p50 | p90 | max | mean |
|---|---|---|---|---|---|
| 1× (below storm) | 0.00169 TKAS | 5.5 s | 29.7 s | 105 s | 13.5 s |
| 1.2× (= storm) | 0.00203 TKAS | 5.5 s | 17.5 s | 92 s | 10.5 s |
| 2× | 0.00338 TKAS | 3.0 s | 8.0 s | 33 s | 4.4 s |
| 5× | 0.00845 TKAS | 1.4 s | 2.3 s | 3.8 s | 1.5 s |
| 10× | 0.0169 TKAS | 1.15 s | 1.6 s | 2.3 s | 1.15 s |
| 100× | 0.169 TKAS | 1.14 s | 1.6 s | 2.3 s | 1.14 s |

### Does it get worse over time? 5-minute buckets, p50/p90 in seconds
| bucket | 1× | 1.2× | 2× | 5× | 10× | 100× | mempool p50 / max |
|---|---|---|---|---|---|---|---|
| 00–05 | 5.4 / 71 | 4.2 / 13 | 3.3 / 14 | 1.3 / 1.6 | 1.3 / 1.7 | 1.3 / 1.7 | 64k / 95k |
| 05–10 | 5.0 / 29 | 8.7 / 78 | 3.3 / 12 | 2.3 / 3.5 | 1.5 / 1.9 | 1.5 / 2.0 | 70k / 99.9k |
| 10–15 | 22.8 / 35 | 10.4 / 24 | 3.6 / 7.4 | 1.1 / 2.3 | 0.9 / 1.3 | 0.8 / 1.2 | 73k / 99.97k |
| 15–20 | 5.3 / 19 | 5.4 / 12 | 2.5 / 4.3 | 1.2 / 1.7 | 1.1 / 1.5 | 1.1 / 1.5 | 67k / 99.8k |
| 20–25 | 6.1 / 9.9 | 3.6 / 17 | 2.3 / 3.7 | 1.1 / 2.0 | 1.0 / 1.5 | 1.0 / 1.5 | 61k / 94k |
| 25–30 | 4.9 / 18 | 5.4 / 12 | 3.4 / 4.9 | 1.6 / 1.9 | 1.1 / 1.5 | 1.1 / 1.5 | 62k / 88k |

## Early read
- **Not devastating so far, and not getting worse over time.** Every probe was accepted and included within 105 s. There were no rejections and no evictions of probes. The worst stretch was minutes 5–15, when the mempool sat at the 100k cap. After that, latency eased as blocks came faster (9.5 blocks/s) and filled to 98%.
- **Fees clearly protect.** Paying 5× the minimum (≈4× what the storm pays) gives about 1–2 s inclusion no matter how full the mempool is. At 10×, latency stops improving. 100× buys nothing over 10×. Users at or below the storm's feerate (1–1.2×) see a median of 5–6 s, but a heavy tail of 30–100 s at p90/max, and 2× roughly halves that.
- The node survived repeated 99.9k-mempool peaks by evicting low-feerate txs. The 21:12 cap panic did not recur.

## Scale-up at 22:16 CEST (user: "scale more, don't spare TKAS")
- `/tmp/tps-storm.limits` was set to `40000 60000 72000 60000` (RATE_MAX 30k→60k). No change in included TPS in the first 3 minutes (6,790 average): blocks are already ~98% full by compute mass, and the mempool taper, not RATE_MAX, is what holds submission back.
- No extra rwstorm workers or newly funded wallets were added. The box is CPU-saturated (load 13–16 on 8 cores, kaspad about 200%). Block capacity (500k mass × ~9.5 blocks/s ÷ ~600 mass per tx ≈ 7–8k TPS) is the ceiling, not the number of senders.
- TKAS budget: about 666k TKAS in the storm pools against about 14 TKAS/min burn, so there's no risk of running dry.

## Fee burn estimate
- **TN10 (measured):** about **2,400 TKAS per 10 min** of overload at ~6.3k included TPS (120 sompi/gram × ~600 mass per storm tx).
- **Mainnet (ESTIMATE, not measured; corrected 4 Oct 2026):** ~~mainnet's default minimum relay feerate is 1 sompi/gram (100× lower than this TN10 node). The same tx volume at 1.2× the mainnet minimum would cost about **24 KAS per 10 min**.~~ **Corrected:** mainnet's minimum relay feerate has been 100 sompi/gram since rusty-kaspa PR #1004 (merged 15 May 2026), the same as this TN10 node, so the 120 sompi/gram case is the relevant one: about 2,400 KAS per 10 min (**B**: arithmetic; the volume is kaspad's "Processed" counter, which overstates unique transactions, so this is an upper bound). ~~Either way, the same ~7k TPS block-capacity ceiling applies.~~ The ~7k TPS figure is that same counter on TN10, not a measured mainnet capacity (**C** for mainnet).
