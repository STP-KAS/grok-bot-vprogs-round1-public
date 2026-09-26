# Sustained overload on TN10 node n0: does it hurt dApps, and do fees protect them?

Status: **interim summary, 25 Sep 2026, 22:55 CEST.** The storm is still running at full throttle until funds or disk run out. The final version (with the clean recovery measurement) will be `overload-final-summary.md`. TESTNET-10 ONLY.

## What we did
- **Overload window:** 21:48:41 → 22:46:14 CEST, **57.5 minutes of continuous full-throttle storm** on kaspad n0, a local TN10 node with `--ram-scale=0.1`, so its mempool hard cap is about 100k txs. The storm had 8 P2SH workers plus a 0.5-TKAS lane, all paying 1.2× the minimum feerate (120 sompi/gram).
- **Probes:** every 30 s, one small self-transfer (mass 1690) per fee tier: 1×, 1.2×, 2×, 5×, 10× and 100× the node's minimum relay feerate. **That minimum is 100 sompi/gram on this node**; 10 sompi/gram was rejected as "not standard". Inclusion time = submit until the txid appears in the virtual chain's accepted txs, polled every 1 s. Wallets: throwaway storm keys 400–799, not used by the storm. Script: `scripts/overload-probe.mjs`; data: `logs/overload/probes.jsonl`.
- **vprog / tic-tac-toe moves were skipped.** The upstream tn10-runtime demo needs a node with `--utxoindex`; n0 doesn't have it, and n1 (the only other node) was wiped earlier. That run failed with "Method unavailable. Run the node with the --utxoindex argument". The fee-tier probes are a stand-in for a dApp's txs: a move is just a tx, and at the same mass it waits the same way.

## How hard the node was loaded (57.5 min)
| 10-min bucket (CEST) | mempool median / max | included TPS (avg / 10 s peak) | blocks/s | block fill (compute mass) | storm fees |
|---|---|---|---|---|---|
| 21:48 | 66.9k / **99.9k** | 5,787 / 7,959 | 8.1 | 87% | 2,262 TKAS |
| 21:58 | 69.1k / **99.97k** | 5,664 / 9,274 | 9.5 | 73% | 2,123 TKAS |
| 22:08 | 61.9k / 93.6k | 7,418 / 8,958 | 9.5 | 98% | 2,723 TKAS |
| 22:18 | 67.8k / **99.8k** | 5,940 / 8,655 | 9.4 | 95% | 2,046 TKAS |
| 22:28 | 65.1k / 95.1k | 6,906 / 9,102 | 9.9 | 99% | 2,302 TKAS |
| 22:38 | 52.4k / **99.9k** | 7,289 / 9,204 | 10.2 | 99% | 1,863 TKAS |
| **whole window** | min 29.4k, max 99.97k | **6,466 avg**, peak 9,274 | | | **13,589 TKAS** |

The node's mempool touched its ~100k cap several times. Instead of crashing, kaspad **evicted 30,298 low-feerate txs** in favour of higher-feerate ones. It **did not panic**; the only panic that day was at 21:12, before this test.

## Probe results per fee tier (117 probes per tier over 57.5 min)
| tier (× min feerate) | feerate | fee per small tx | rejected | evicted | p50 | p90 | max | txs slower than 30 s |
|---|---|---|---|---|---|---|---|---|
| **1×** (below storm) | 100 sompi/g | 0.00169 TKAS | 0 | 0 | **7.0 s** | **29.8 s** | **105 s** | 11 of 117 (5 over 60 s) |
| **1.2×** (= storm) | 120 | 0.00203 TKAS | 0 | 0 | 7.1 s | 21.8 s | 92 s | 6 of 117 |
| **2×** | 200 | 0.00338 TKAS | 0 | 0 | 3.1 s | 9.5 s | 48 s | 2 of 117 |
| **5×** | 500 | 0.00845 TKAS | 0 | 0 | 1.4 s | 2.3 s | 39 s* | 1 of 117 |
| **10×** | 1,000 | 0.0169 TKAS | 0 | 0 | **1.2 s** | **1.7 s** | **3.7 s** | 0 |
| **100×** | 10,000 | 0.169 TKAS | 0 | 0 | 1.2 s | 1.7 s | 3.7 s | 0 |

\*a single outlier in the last 10 minutes, when the mempool hit 99.9k; the next-worst 5× probe took 6 s. For reference, an idle-node inclusion takes about 0.5–1 s, which was measured during the halt at 22:46.

### Does it get worse the longer it lasts? p50 / p90 / max in seconds, 10-min buckets
| minutes | 1× | 1.2× | 2× | 5× | 10× | 100× |
|---|---|---|---|---|---|---|
| 0–10 | 5.4 / 68 / 105 | 5.2 / 24 / 92 | 3.3 / 12 / 33 | 1.6 / 2.7 / 3.8 | 1.4 / 1.9 / 2.3 | 1.4 / 1.9 / 2.3 |
| 10–20 | 13.6 / 35 / 44 | 7.3 / 18 / 43 | 2.7 / 6.3 / 11 | 1.2 / 2.0 / 2.6 | 1.0 / 1.4 / 1.7 | 0.9 / 1.4 / 1.7 |
| 20–30 | 5.2 / 13 / 19 | 4.6 / 14 / 22 | 2.8 / 4.6 / 6.1 | 1.4 / 1.9 / 2.6 | 1.1 / 1.5 / 1.7 | 1.1 / 1.5 / 1.7 |
| 30–40 | 15.1 / 21 / 45 | 6.7 / 15 / 34 | 3.8 / 8.3 / 11 | 1.3 / 1.8 / 2.2 | 1.2 / 1.8 / 2.1 | 1.2 / 1.8 / 2.1 |
| 40–50 | 8.6 / 29 / 44 | 9.4 / 22 / 30 | 3.0 / 6.2 / 12 | 1.2 / 2.0 / 2.4 | 1.1 / 1.5 / 2.0 | 1.1 / 1.5 / 2.0 |
| 50–57 | 7.5 / 48 / 72 | 9.5 / 28 / 47 | 3.9 / 13 / 48 | 1.6 / 6.2 / 39 | 1.3 / 2.2 / 3.7 | 1.3 / 1.9 / 3.7 |

**No steady worsening.** Latency rises and falls with the mempool level: minutes 0–10 and 50–57 are the worst, and both are when the mempool sat at the 100k cap. There is no build-up over time. The high tiers stayed flat for the whole hour.

## Conclusions in plain language
1. **Sustained overload is not devastating on this node, but it is unpleasant for cheap txs.** In 57 minutes at ~6.5k included TPS with the mempool near its cap, **not one probe was rejected, evicted or lost.** Everything confirmed, the worst case in 105 s.
2. **Higher fees clearly protect dApps.** Paying **10× the minimum** (≈8× what the spammer pays, still only ~0.017 TKAS for a small tx) gave **~1.2 s median and under 4 s worst case**, the same as an idle network plus about one block. 5× is almost as good. **100× buys nothing over 10×.**
3. **Paying the same as the spammer (or the bare minimum) means lottery-like waits:** median ~7 s, 1 in 10 txs over ~20–30 s, rare ones 1.5 minutes. A dApp at the minimum fee would feel laggy, with an occasional very slow move. 2× halves that.
4. What limits throughput is **block capacity** (~500k compute mass × ~9.5–10 blocks/s ≈ 7–9k small txs/s), not the node. Blocks were 95–99% full for most of the hour.

## Recovery
- **22:46:14 halt (clean stop of the storm for maintenance):** the mempool fell **from 49.6k to 2.7k within 10 s (≈95% gone)** and to **0 by 22:46:29 (≤15–20 s)**, sampled every 10 s. Probes sent right after were included in **0.5 s at every tier**, i.e. baseline was back immediately. Kaspa at ~10 blocks/s clears a 50k backlog in a few seconds once new spam stops.
- The planned 2-minute break at 23:00 and a later pause were cancelled by the user. A longer, 5-s-sampled recovery measurement runs automatically when the storm stops for good (`scripts/recovery-watch.sh` → `logs/recovery/recovery-1.jsonl`).
- Confounder: the user's Grok Build agent may also be sending TN10 txs from outside, so later drains are not purely our backlog.

## Scale-up after the window (for context)
- 22:16: RATE_MAX 30k → 60k did nothing measurable, because blocks were already ~98% full.
- 22:41: the mempool reached **99.66k**, about 350 txs from the 100,001 panic point, because offered-rate bursts overshoot a 3-s control loop. The guards were tightened: taper 40k–60k, gate 70k/50k, and a **hard brake at 90k** (zero new storm txs). Since then the max has been 78k.
- 22:47: storm fee raised to **2× (200 sompi/g)**. Included TPS was **~8.3k average, peak 9,990** (4 min sample), blocks 99% full.
- 22:46: **299,993 TKAS sent to the Grok Build agent's receive address** in 1,184 txs/outputs (~420 TKAS each), fee 20.9 TKAS.

## TKAS fee burn
| setting | measured burn |
|---|---|
| 1.2× min (120 sompi/g), ~6.5k TPS, 57.5 min | **13,589 TKAS ≈ 2,360 TKAS per 10 min** |
| 2× min (200 sompi/g), ~8.3k TPS | **≈ 4,940 TKAS per 10 min** (~29.6k/h) |

**MAINNET ESTIMATE (not measured, assumption-based):** mainnet's default minimum relay feerate is 1 sompi/gram, 100× lower than this TN10 node's 100. The same ~6.5k TPS for 10 minutes at 1.2× the mainnet minimum would burn about **24 KAS per 10 min** (≈49 KAS at 2×). That is cheap enough that fees alone don't deter a well-funded spammer. What protects users is fee-priority ordering: anyone paying ~5–10× the spam feerate still confirmed in ~1–2 s here.

## Mitigation ideas
- **dApps / wallets:** use the node's `getFeeEstimate` priority bucket (or at least 5–10× the minimum) for time-sensitive moves. The cost is tiny (~0.017 TKAS per small tx at 10× here; at mainnet feerates, 100× lower). Detect congestion (mempool size / fee-estimate jump) and auto-bump. Resubmit with a higher fee (RBF) if a tx waits >10 s.
- **Node operators:** don't run public nodes with a tiny mempool (`--ram-scale 0.1` → 100k cap), and fix or upgrade past the 2.1.0 assert panic at the cap. Eviction by feerate worked well, but the cap panic is a crash risk. Rate-limit RPC submitters per connection.
- **Protocol-level:** fee-priority ordering already does its job. Throughput is block-mass bound (~8–10k small tx/s at 10 bps), so larger or faster blocks lift the floor for everyone.
- **Testing:** repeat with a `--utxoindex` node so real vprog / tic-tac-toe moves can be timed. Also repeat with a multi-node topology to see propagation effects.

## Files
`logs/overload/probes.jsonl`, `logs/overload/analysis.json` (from `scripts/analyze-overload.py`), `scripts/window-stats.py` (load buckets), `logs/storm/ramp.log` (every phase boundary), `logs/storm/grokbuild-fund-2.jsonl` (funding txids), `findings/overload-interim-2215.md` (first-30-min read).
