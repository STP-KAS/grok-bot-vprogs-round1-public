> **Experimental only. Not a product.**
>
> Do not use wallet integrations on this GitHub. STP remains a clown. [DISCLAIMER.md](DISCLAIMER.md)

# TN10 full-load stress & break test + vprogs (25 Sep 2026)

> **Mainnet labels (added 4 Oct 2026).** Kaspa Testnet-10 only. Every statement about mainnet in this file now carries a label: **A** = shown on TN10, backed by our own measured data (TN10 only, never proof for mainnet); **B** = plausible for mainnet but unsure, reason given; **C** = unknown, needs more testing and review. Claims, evidence and the tests still needed: [TN10 storms: what they do and do not say about a mainnet storm](https://github.com/STP-KAS/tn10-storm-2026-10-public-report/blob/main/TN10-STORMS-MAINNET-IMPLICATIONS-2026-10-04.md).

> Clean public copy (history squashed) of a private working repo.
>
> **Copy of private repo `STP-KAS/grok-bot-vprogs` (history squashed for privacy).** Originally created **25 Sep 2026 20:54 CEST**, last updated **26 Sep 2026 07:51 CEST** (report branch `tn10-break-report`; the Windows campaign-runner branch last changed 25 Sep 2026 21:50 CEST, and its `campaign/` files are included here). The report covers the TN10 round-1 run of **25 Sep 2026, ~20:12 to 22:46 CEST** (round 2 continued to 26 Sep 06:31 CEST). The single commit here is dated 26 Sep 2026 only because history was squashed. Local user paths were replaced with `<user>` and email addresses were removed.

> **Testnet-10 only.** No seed, private key, wallet state file or anything from the operator's secure directory is in
> this repo (`tools/secret-scan.sh` runs before every push). **Round 2 final** (22:47:26 → 06:31:10 CEST: disk-taper stop, ~7h44m,
> peak 12,175 TPS, ~197.8k TKAS burned, recovery N/A at mempool=7) lives in **https://github.com/STP-KAS/grok-bot-vprogs-round2**.
>
> Numbers marked **[unverified]** come from operator notes or the explorer UI and are not backed by a committed log. Everything else was
> re-read from the logs in `logs/` while writing this. Times are CEST (UTC+2) unless marked UTC.

Contents: [1 What](#1-what) · [2 Why](#2-why-mainnet-relevance) · [3 How](#3-how) · [4 Metrics & timeline](#4-metrics-and-timeline) ·
[5 Findings](#5-findings) · [6 Overload impact on dApps](#6-overload-impact-on-dapps) · [7 vprogs](#7-vprogs) · [8 Conclusion](#8-conclusion) ·
[9 Mitigations](#9-solutions--mitigations) · [10 What we built](#10-what-we-built) · [11 Next steps](#11-ideas-for-next-steps) ·
[12 Reproduce / monitor / contribute](#12-how-to-reproduce-monitor-stop-and-contribute)

---

## 1. What

A deliberate attempt to push Kaspa **testnet-10 (TN10)** as hard as one 8-core / 16 GB box can, find what breaks first, and write each
breakage up as a bug report. Alongside it, we tried to run **vprogs** (Kaspa's verifiable programs) while the network was overloaded.

Inspiration:
- Maksim Biriukov's post: *"Play the game https://vprogs-tt.izio.fr/, read the code github.com/biryukovmaxim/vprog-tictactoe, build your own
  vprog kaspanet/vprogs release-candidate."*
- The operator's desk note **https://github.com/STP-KAS/vprogs-tn-desk-public** (SilverScript v1.0.0 vs the vprogs demo; frozen settlement;
  issue-126 reorg-below-floor guard; version-stamp trap). Its checks were re-run here — see [findings/D1](findings/D1-desk-note-checks.md).

In plain words: we ran our own Kaspa nodes and miners on the test network, made thousands of throwaway wallets send each other coins as
fast as possible, watched what the nodes did, and wrote down every failure.

## 2. Why (mainnet relevance)

Kaspa's selling point is that transactions confirm in seconds. That only holds while blocks have room. If demand exceeds capacity even
for **10–30 minutes**, transactions queue in the **mempool** (the waiting room of unconfirmed transactions). A dApp — an exchange
withdrawal, a bridge, a vprog settlement, a game move — can then sit there for minutes, and **paying a higher fee only helps up to a
point**: during our 57.5-min overload a 1× (minimum) fee waited ~7 s at the median and up to 105 s, while 10× got ≤3.7 s every time (section 6). Worse, if a node
crashes or restarts during the overload, its waiting room is **lost** (F1, F2), and the dApp's transaction silently disappears.
Testing this on TN10 now, with real node software, is much cheaper than discovering it on mainnet during a spike.

**Mainnet labels for this section:** the queueing, fee-tier and lost-mempool results above are **A** on TN10 only (one node, `--ram-scale=0.1`, our own flood). That a mainnet spike would behave the same is **B**: same node code, but mainnet has far more nodes and miners we do not control. Whether a 10–30 minute mainnet overload can be reached at all is **C**: never tested.

## 3. How

### Setup
| Piece | Details |
|---|---|
| Nodes | Two local **kaspad 2.1.0** nodes, `n0` and `n1` (binary sha256 prefix `adf711b68abb2fab`), peered to each other and to TN10. Flags: `--testnet --netsuffix=10 --ram-scale=0.1` (⇒ mempool cap 100,000 txs), `--async-threads=1` → later **4**, `--rpcmaxclients=64`, no `--utxoindex`. `n1` was stopped and wiped at 21:33 to free disk; since then **n0 only**. |
| Miners | `kaspa-miner` patched to 4× (`bin-x4`), kept alive by `scripts/keepalive-storm-2.sh` (2 miners on n0 since 21:34). Our miners found ~65% of TN10 blocks in one measured 41 s window (`logs/C8-miner-share-during-cap.json`). |
| Wallets | Throwaway TN10 wallets: 800 "storm" addresses (0–399 = 0.5 TKAS lane, 400–799 = TPS lane) derived from a fresh test mnemonic (`scripts/mkstorm-wallets.mjs`), funded from the desk wallet with ~430-input transactions (`scripts/fund-storm.mjs`, 100 funding txs). Keys stay in a mode-600 file outside the repo. |
| Traffic lanes | **0.5 TKAS lane:** random wallet→wallet transfers of exactly 0.5 TKAS (1 input → pay + change). **TPS lane:** 1-in-1-out transfers to maximise tx *count*; from 21:06 in **P2SH(OP_TRUE)** mode (no signature: mass 571 vs 1624 for a signed spend) — `scripts/p2sh-probe.mjs`, `scripts/tps.mjs`. |
| Supervisor | `scripts/tps-supervisor.py` runs 8 `rwstorm.mjs` workers (P0–P7) + one 0.5 TKAS worker (H). Guards: per-node **mempool gate** (stop feeding at 85k, resume at 70k; 78k/55k in the overload phase), **mempool taper**, **disk taper** (slow down at 9.5 GB free, stop at 8.4 GB), drain-estimating rate control, worker auto-reconnect. `scripts/monitor.py` writes a STOP file if disk < 8 GB, RAM < 1 GB or tip age > 180 s. |
| Measurement | `scripts/nettps.sh` parses kaspad's own "Processed N blocks … (T transactions)" line every 10 s → `logs/tps12h/nettps.jsonl` (**network** TPS, all TN10 traffic, ours + others). `monitor.jsonl` samples both nodes every 10 s. Fee-tier probes: `scripts/overload-probe.mjs` → `logs/overload/`. |

### Timeline (from `logs/storm/ramp.log`, `monitor.jsonl`, `nettps.jsonl`)
| Time (CEST) | Event |
|---|---|
| 20:12–20:48 | Desk-note checks (A1–A6), SilverScript/DeskFloor (B1–B3), edge-case txs (C1–C7), RPC client caps (C8/C9), graceful restarts (C10) |
| 20:54 | Explorer baseline **63.6 TPS (1 h avg 267)** **[unverified — explorer screenshot, no log]**. Storm A,B started conc=8 |
| 20:55 | HALT: 1-in-2-out 0.5 TKAS txs hit the **KIP-9 storage-mass cap: ~25 tx/block** |
| 20:59 | Split into 0.5 TKAS lane (storm3 A,B) + TPS lane (tps.mjs, 1-in-1-out). n1 mempool at ~100k = full |
| 21:00 | Paused 0.5 TKAS lane to watch n1 drain — RPC-submitted txs are `Priority::High` and never evicted |
| 21:02–21:09 | TPS lane v2→v4: 8 processes, desk coinbase UTXOs as inputs, both nodes, P2SH(OP_TRUE) mode, conc up to 64/proc |
| ~21:10 | **Explorer >3,000 TPS [unverified — explorer UI]**. Our 8 senders: **2,550 tx/s accepted** combined (last samples before 19:10:50 UTC in `logs/storm/tps-T*.jsonl`) |
| 21:10:50 | HALT; restart n0 with `--async-threads=4` (**first bottleneck: `--async-threads=1`**) |
| 21:11:06 | Restart n1 with 4 threads — **58,035** mempool txs dropped (F2) |
| 21:12:29 | TPS lane restarted on both nodes |
| **21:12:50** | **n0 CRASH** — mempool assert `100001 > 100000` (F1). n0 restarted by hand ~21:15 |
| 21:13–21:14 | Miners briefly stopped/restarted per user (keepalive-storm-2.sh) |
| 21:27 | 12 h supervisor started (gate 85k/70k, backlog target 50–70k) |
| 21:32–21:33 | User-approved: stop n1 and delete its data (~44 GB) → disk free 53.85 GB |
| 21:34:42 | Storm n0-only. Disk budget: ~320 B/tx/node → 12 h cap ~3,540 TPS |
| 21:36:33 | **FULL THROTTLE** per user: RMAX 30,000 tx/s, no 12 h rationing |
| 21:45–21:48:41 | **Phase 1: overload** + fee-tier probes (final start 21:48:41). Originally 30 min (to 22:18:41) |
| 22:11:32 | Plan change logged: overload **extended to 23:00** |
| 22:16:25 | SCALEUP-1: `RATE_MAX` 30,000 → 60,000 tx/s. Before: net TPS 6.1–7.7k, blocks ~98% full by compute mass, mempool 66k |
| 22:19:50 | First 30 min of overload done: net 6,289 TPS avg, mempool max 99,967, fees 2,402 TKAS / 10 min |
| 22:42:18 | SAFETY: `RATE_MAX` 60,000 → 8,000 (mempool hit 99.66k at 22:41; bursts overshoot the 3 s taper). **23:00 break cancelled** per user |
| 22:46:11–14 | Fleet HALT (cum. fees 16,119 TKAS) → **end of the 57.5-min overload** (21:48:41–22:46:14). Drain measured while halted |
| 22:47:16 | 299,993 TKAS moved from storm pools to another agent's build wallet (`kaspatest:qzzkwgjh…wtgzv`, receive-only) in 1,184 txs |
| 22:47:26 | **Round 2 start (PHASE4-MAX):** supervisor restarted with **fee 2× (200 sompi/g)** for all workers, hard brake at 90k mempool, taper 40–60k, gate 70k/50k |
| 22:48:33 | Planned recovery pause cancelled by user (0 s) — the clean recovery measurement is deferred until funds run out |
| 22:48:55 → | `RATE_MAX` 9,000 → 20,000; round 2 then evolved (10× fee, 1k baseline, disk taper) and **ended 06:31:10 CEST 26 Sep** → **final write-up:** https://github.com/STP-KAS/grok-bot-vprogs-round2 |

## 4. Metrics and timeline

| Metric | Value | Source / status |
|---|---|---|
| Baseline network TPS | 63.6 TPS (1 h avg 267) at 20:54 | explorer **[unverified]** |
| First peak | >3,000 TPS on explorer ~21:10; our 8 senders ~2,550 tx/s accepted | explorer **[unverified]**; senders ✔ `logs/storm/tps-T*.jsonl` |
| Per-sender cap at `--async-threads=1` | ~310–326 tx/s each | ✔ `tps-T*.jsonl` |
| Network TPS, n0-only full throttle (21:36–22:00) | 10 s samples: median **5,707**, mean 5,617, min 1,567, **max 7,959** (21:54:36) | ✔ `nettps.jsonl` (100 samples) |
| Network TPS, 21:13–21:36 (2 nodes, then 1) | median 4,677, max 5,426 | ✔ `nettps.jsonl` |
| Supervisor accepted rate, 21:36–22:00 | median 5,222 tx/s, bursts up to **13,226** tx/s (per ~5 s sample; bursts drain local queues) | ✔ `supervisor.jsonl` (brief says "up to ~8,000"; logs show higher single samples) |
| Txs per block / blocks per s (21:36–22:00) | median 801 tx/block, 7.4 blocks/s | ✔ `nettps.jsonl` |
| Mempool backlog | n0 median 65.5k (21:36–22:00), range ~1.5k–99.2k; n1 hit **100,000** before 21:13 | ✔ `monitor.jsonl` |
| First bottleneck | `--async-threads=1` → raised to 4 | ✔ `ramp.log` 21:10:50 |
| Crash | n0 panic at 21:12:50, `100001 > 100000` | ✔ `findings/n0-mempool-panic-2112.log` |
| Mempool lost on restart | n1 58,035 (21:11), n0 ~98k (21:12:50) | ✔ `ramp.log`, `monitor.jsonl` |
| Disk per tx | ~300–320 B per tx per node | ✔ `ramp.log` projection + supervisor disk samples |
| Disk growth | ~9 GB/h with 2 nodes at ~4k TPS (12.2 → 10.78 GB free in 9 min); ~6 GB/h n0-only at ~5–6k TPS | ✔ derived from `supervisor.jsonl` |
| n1 wipe | ~44 GB freed (appdir 43.7 GB) → 53.85 GB free | ✔ `du.log`, `monitor.jsonl` |
| Storm fee burn | **~2,330 TKAS / 10 min** at full throttle (657.7 → 2,989.2 TKAS, 21:40:29 → 21:50:29); ~2,700 / 10 min 22:06–22:15. Cross-check: ~4.5k tx/s × 571 g × 120 sompi/g ≈ 185 TKAS/min. (A later operator note of "~13 TKAS/min" does **not** match the supervisor counter — **unresolved**; runway at ~270/min on ~666k TKAS is still ~40 h) | ✔ `supervisor.jsonl` |
| Node min fee rate | 100 sompi/gram; 1–10 sompi/g rejected "not standard"; storm pays 1.2× (120) | ✔ `ramp.log` 21:48:41 + overload worker |
| Faucet/desk budget | Really only ~53k TKAS spendable; API showed ~3.9M | **[unverified]** operator note (F3) |
| **KIP-9 storage mass of 0.5 TKAS** | 1-in-2-out (0.5 pay + change): **20,001 grams**; 1-in-1-out 0.5 TKAS: **4 grams**; 0.5+0.5 from 1.0: 30,000; 5 TKAS pay: 2,000 | ✔ measured 21:58 with SDK 2.1.0 `calculateStorageMass("testnet-10", …)` |
| What that means | 500,000-gram block mass limit / 20,001 ≈ **25 txs per block** for 0.5 TKAS payments — exactly the cap seen at 20:55. Small outputs are storage-mass bound; 1-in-1-out is ~free | ✔ |
| WebSocket drops | 18× "WebSocket disconnected" + 18× "not connected" in one sender during the 2-node ramp | ✔ `tps-T4.jsonl` |
| Orphan rejections | 211 orphan-error lines in one sender; up to 716 `orphan_retries` per supervised worker | ✔ `tps-T4.jsonl`, `worker-P3.jsonl` |
| gRPC client cap | 100 clients vs `--rpcmaxclients=64` → 56 ok, 44 failed, `RESOURCE_EXHAUSTED`; wRPC held 1,000 | ✔ `C8`, `C9b` |
| Node RSS | n0 ~1.7–2.0 GB under full load | ✔ `monitor.jsonl` |

`tools/report-stats.py logs/ HH:MM HH:MM` recomputes all the ✔ window statistics from the raw logs.

## 5. Findings

Each is a stand-alone bug report (repro, versions, log excerpt, severity, suggested fix). F1 contains a **draft upstream issue (not filed)**.

| # | Title | Severity |
|---|---|---|
| [F1](findings/F1-mempool-cap-panic.md) | kaspad panics and exits at mempool cap (`100001 > 100000`, `validate_and_insert_transaction.rs:123`) | **Critical** |
| [F2](findings/F2-mempool-not-persisted.md) | Mempool not persisted — ~58k (n1) and ~98k (n0) txs lost on restart/crash | High |
| [F3](findings/F3-public-api-stale-utxos.md) | Public TN10 API lists UTXOs the node doesn't have (1,104 sampled; ~248k / 3.9M-vs-53k **[unverified]**) | Medium |
| [F4](findings/F4-disk-growth-vs-pruning.md) | Disk growth at high TPS vs pruning window (~300–320 B/tx/node) | Medium (ops) |
| [F5](findings/F5-rpc-async-threads-default.md) | RPC ingest throttled by `--async-threads`; gRPC client cap | Medium (config) |
| [F6](findings/F6-websocket-orphans-under-load.md) | WebSocket drops and orphan rejections under load | Low–Medium |
| [F7](findings/F7-vprogs-runtime-needs-utxoindex.md) | vprogs TN10 runtime panics without `--utxoindex`; vprog-under-load test skipped | Medium |
| [D1](findings/D1-desk-note-checks.md) | Desk-note re-checks: settlement frozen (64,057 DAA gap; ~85 min at a sampled 12.5 DAA/s, ≈107 min at the 10 BPS target), issue-126 guard unapplied, version-stamp trap, silverc edges, bridge bugs (not re-tested) | info |

Other observations (not full reports): edge-case txs behaved as designed (`logs/C2–C7`): dust and 1,000,000-sompi outputs rejected by
storage mass, 5,000,000 accepted; fee floor below 1,000,000 sompi rejected for that tx; 240 KB payload rejected at 0 fee, accepted at
0.5 TKAS; 600+ input txs exceed the 500,000 compute-mass limit; 200 × 5 TKAS outputs accepted, 250 rejected. Graceful restart takes
~2.5 s shutdown + ~1.2 s to RPC/synced (`logs/C10-restart-n0.log`).

## 6. Overload impact on dApps

> Source: [findings/overload-30m-summary.md](findings/overload-30m-summary.md) (by the overload worker, 22:55; covers the
> **full 57.5-min overload, 21:48:41–22:46:14**, not just 30 min; still marked "interim" by its author because the clean recovery pause
> was cancelled). The earlier 30-min read is kept at [findings/overload-interim-2215.md](findings/overload-interim-2215.md).

**Load:** mempool median 52–69k per 10-min bucket, **max 99.97k** (the ~100k cap was touched several times); included TPS **6,466 avg**,
10 s peak **9,274**; 8–10 blocks/s at up to 99% of the compute-mass limit; kaspad **evicted 30,298** low-feerate txs and **did not panic**.
Storm fees **13,589 TKAS** over the window (~2.4k TKAS / 10 min at 1.2× min fee).

**How long a normal dApp transaction waited, by fee** (117 probes per tier, 0 rejected, 0 evicted, all included):

| Fee tier (× min 100 sompi/g) | p50 | p90 | max | slower than 30 s |
|---|---|---|---|---|
| 1× (below the storm) | **7.0 s** | 29.8 s | **105 s** | 11 / 117 (5 over 60 s) |
| 1.2× (= storm) | 7.1 s | 21.8 s | 92 s | 6 / 117 |
| 2× | 3.1 s | 9.5 s | 48 s | 2 / 117 |
| 5× | 1.4 s | 2.3 s | 39 s (one outlier at 99.9k mempool) | 1 / 117 |
| 10× | **1.2 s** | 1.7 s | 3.7 s | 0 |
| 100× | 1.2 s | 1.7 s | 3.7 s | 0 |

Idle-node inclusion for reference: ~0.5–1 s (measured during the 22:46 halt).

**Plain reading.** An hour of overload did not lose or refuse any normal transaction, and it did **not get worse over time** — latency
tracks the mempool level (worst when it sits at the cap). But anyone paying the minimum or the spammer's fee waits ~7 s typically and
**up to ~1.5–2 minutes**, and ~1 in 10 such transactions takes over 30 s. For a DEX, bridge or liquidation that is real harm. Paying
**10× the minimum** gave ≤3.7 s every time; 100× bought nothing more. So on mainnet, **if** blocks fill the same way (**B**: same mempool code, but never tested on mainnet; the TN10 result is **A**), dApps should bump fees dynamically during spikes, and
node operators should not let nodes crash or restart at the cap (F1/F2), because on TN10 that — not fees — is where transactions actually vanished.
Vprog moves under load were **skipped** (F7).

## 7. vprogs

See [vprogs/README.md](vprogs/README.md). Summary:
- **tn10-runtime-under-storm** (upstream `kaspanet/vprogs` release-candidate `3a61c0ba608b`): **not completed** — panicked, node lacks `--utxoindex` (F7).
- **tic-tac-toe campaign** (Max's hosted vprog): the `campaign/` runner on `main` ran; last status I read (21:45:58): 1,220 sends, 10,349 send failures,
  **0 finished games, 1,534 game failures**. The hosted lane's settlement was frozen (~85 min behind). It was scheduled to run until 08:57 on 26 Sep; the runner pushed no status after 21:45:58, so these are the last recorded numbers.
- **DeskFloor** (our own SilverScript v1.0.0 L1 covenant): **completed**; on-chain accept/reject matches expectations for all 7 cases.
- We did **not** build a new vprogs guest (ZK program) this session; the RISC Zero settler build had already failed on the Windows desk (desk note). Honest gap.

## 8. Conclusion

1. One box with two nodes pushed TN10 to **~5–8k network TPS** sustained for 20+ minutes (median 5.7k, 801 tx/block, 7.4 bps).
   The chain itself kept up: no sync loss, sink age sub-second.
2. What broke was **the node around the chain**: the mempool cap assert killed a node (F1), a restart threw away 58k pending txs (F2),
   RPC ingest defaults capped throughput (F5), and disk is the real long-run limit (F4).
3. **Small payments are expensive by design**: a 0.5 TKAS output costs 20,001 grams of storage mass — ~25 such payments per block.
4. Over a 57.5-min overload, fees work but saturate: 10× min fee ≤ 3.7 s always; 1×/1.2× ≈ 7 s median with a tail up to 105 s (117 probes/tier). The node survived repeated 99.9k-mempool peaks (30,298 evictions) without the F1 panic recurring.
5. vprogs tooling is not ready for "tuned" nodes (needs `--utxoindex`) and the hosted demo's settlement is frozen.

## 9. Solutions / mitigations

| Problem | Node / protocol devs | Operators | dApp / wallet devs |
|---|---|---|---|
| F1 panic | Replace `assert!` with `RejectMempoolIsFull`; cap `Priority::High` share | Keep `--ram-scale` headroom; watchdog restarts | Retry on "mempool full" with backoff |
| F2 loss | Optional mempool dump/reload | Drain before restarts | Re-broadcast unconfirmed txs after reconnect |
| F3 stale API | Include indexer height; purge spent entries | Run own `--utxoindex` node | Confirm UTXOs against a node |
| F4 disk | Free-space floor that rejects instead of crashing | Budget ~300 B × TPS × pruning window | — |
| F5 ingest | Document/auto-size `--async-threads` | Set threads ≈ cores; raise `--rpcmaxclients` for gRPC | Prefer wRPC for many clients |
| F6 orphans | Typed orphan error | — | UTXO cool-down, pin chained sends to one node |
| Storage mass | — | — | Batch small payments; avoid tiny outputs; pay ≥5× min fee during spikes |

## 10. What we built

`scripts/` (Node.js uses the Kaspa WASM SDK 2.1.0 via `lib.mjs`; Python uses stdlib or gRPC):

| Script | One line |
|---|---|
| `lib.mjs` | Shared helpers: SDK load, node URLs, key loading from the local secure dir (never printed) |
| `mkstorm-wallets.mjs` | Create a throwaway test mnemonic and derive N storm addresses (only addresses printed) |
| `fund.mjs` / `fund-storm.mjs` | Fund test wallets / storm wallets from the desk wallet with ~430-input txs |
| `consolidate.mjs` | Many-input txs from the desk wallet's coinbase pile (compute-mass boundary) |
| `edge.mjs`, `edge2–4.mjs` | Edge-case txs: dust, fee floor, double spend, orphan, bad sig, big payloads, many outputs, lock time |
| `gen.mjs`, `gen2.mjs`, `ramp.sh` | Early load generators + rate ramp |
| `storm.mjs`, `storm2.mjs`, `storm3.mjs`, `storm-ramp.sh` | 0.5 TKAS random-transfer storm v1–v3 + concurrency ramp |
| `tps.mjs` | TPS lane: maximise tx count (1-in-1-out, P2SH(OP_TRUE) mode) |
| `p2sh-probe.mjs` | Checks an unsigned P2SH(OP_TRUE) spend is standard and measures its mass |
| `rwstorm.mjs` | Supervised random wallet→wallet worker (TPS mode + 0.5 TKAS PAY lane) |
| `tps-supervisor.py` | Fleet supervisor with mempool gate/taper, disk taper, rate control, auto-restart |
| `overload-probe.mjs`, `analyze-overload.py` | Fee-tier probes every 30 s and their inclusion-latency analysis |
| `prio-probe.mjs`, `_feecheck.mjs`, `_mpcheck.mjs`, `_probebal.mjs`, `_vctest.mjs`, `probe-sdk.mjs` | Small probes (priority, fee estimate + mass, RPC methods, balances, SDK) |
| `monitor.py` | 10 s node/box sampler with safety STOP file |
| `nettps.sh` | Network TPS from kaspad's own 10 s log line |
| `blockfill.py` | Tx count and mass of recent blocks |
| `minershare.py` | Our miners' share of blocks in a window |
| `rpccap.py` | Hold many gRPC/wRPC clients, check refusal and recovery |
| `restart-node.sh` | Graceful restart of one node with its exact flags, timing to synced |
| `keepalive-storm-2.sh` | Miner keepalive (fixed address, step-wise ramp) |
| `disk-guard.sh` | Kill cargo builds if disk < 9 GB |
| `recover-utxos.py`, `rebuild-storm-state.py` | Rebuild wallet UTXO state from the public API (no utxoindex) |
| `deskfloor.mjs` | Deploy and spend the DeskFloor covenant on TN10 |
| `tools/report-stats.py` | Recompute report statistics for a time window |
| `tools/secret-scan.sh` | Pre-push secret scan |

## 11. Ideas for next steps

1. Run a third node **with `--utxoindex`** and re-run vprog moves during overload (F7).
2. Minimal repro of F1 on a single node with a scripted RPC flood + `RUST_BACKTRACE=1`; try `--ram-scale` 0.05 to hit it faster.
3. Prototype the `assert!` → `RejectMempoolIsFull` change and re-run the storm.
4. Mempool persistence prototype; measure restart reload time at 100k txs.
5. Measure disk per tx precisely vs pruning depth with `du` sampled every minute over 2 h.
6. Batch-payment lane (1-in-N-out, big outputs) to show how to fit more payments per block under KIP-9.
7. Longer fee-tier sampling (hundreds of probes per tier) and eviction behaviour at the gate.
8. Re-test the desk-note bridge bugs against a live runtime.

## 12. How to reproduce, monitor, stop, and contribute

Prereqs: kaspad 2.1.0, Kaspa WASM SDK 2.1.0 at `$KASPA_SDK`, Node 20+, Python 3, `jq`. Scripts assume the work dir
`/workspace/tn10-break-test-2026-09-25` and keys in a local mode-600 dir; adapt `scripts/lib.mjs`. **TN10 only.**

| Test | One command |
|---|---|
| Edge-case txs | `node scripts/edge.mjs` (then `edge2/3/4.mjs`) |
| RPC client caps | `python3 scripts/rpccap.py` (see its docstring for args) |
| Graceful restart timing | `bash scripts/restart-node.sh n0` |
| 0.5 TKAS storm | `FROM=0 TO=400 node scripts/storm3.mjs` |
| TPS lane | `FROM=400 TO=800 node scripts/tps.mjs` |
| Supervised full storm | `setsid nohup python3 scripts/tps-supervisor.py 12 &` |
| Fee-tier overload probe | `node scripts/overload-probe.mjs` → `python3 scripts/analyze-overload.py` |
| KIP-9 storage mass | SDK: `calculateStorageMass("testnet-10", [inputSompi], [outSompi…])` (Numbers, not BigInt) |
| DeskFloor covenant | `bash silverscript/edge-compile.sh` then `node scripts/deskfloor.mjs` |
| vprogs under storm | `bash vprogs/tn10-runtime-under-storm/run.sh 900` (needs `--utxoindex`) |
| Stats for a window | `python3 tools/report-stats.py logs 21:36 22:00` |

**Storm status (round 2 ended 06:31:10 CEST 26 Sep; see round2 final write-up):**
```
tail -1 logs/tps12h/nettps.jsonl | jq '{t,net_tps,tpb}'                  # network TPS (10 s)
tail -1 logs/tps12h/supervisor.jsonl | jq '{t,accepted_tps,fees_tkas,disk_free_gb,m:.nodes.n0.mempool}'
tail -1 logs/monitor.jsonl | jq '{t,n0:.n0.mempool,synced:.n0.synced,disk_free_gb,mem_avail_mb}'
tail -5 logs/storm/ramp.log
```
**Stop / pause:** `touch /tmp/tps-storm.HALT` stops the supervisor + workers (and `nettps.sh`); a rate limit file
`/tmp/tps-storm.limits` holds `LOW HIGH PANIC RATE_MAX` (re-read every 3 s; `RATE_MAX` 0 pauses sending without killing workers);
`touch /tmp/overload-probe.STOP` stops probes. Miners: `touch /tmp/relqunch-keepalive-100.HALT` stops the keepalive loop (miners themselves keep running until killed by pid).
Never `pkill -f` with a pattern that matches your own shell.

**Contributing / reuse:** copy `scripts/` + `tools/`, point `lib.mjs` at your node and key dir, keep keys out of the repo
(`.gitignore` blocks `state-*.json`, wallets, seeds, `node_modules`, big logs), run `tools/secret-scan.sh` before pushing, and
record every rate change as one line in `logs/storm/ramp.log` so the timeline can be rebuilt. New findings: copy a file from
`findings/` as a template (summary, versions, repro, evidence, root cause, fix, draft issue). Mark unverified numbers.

---
The tic-tac-toe `campaign/` runner and its original note are on the `main` branch (see `campaign/`); this report was pushed on branch
`tn10-break-report` so the live runner's pushes to `main` are not broken.

## Round 2 final (26 Sep 2026)
Round 2 ran from **22:47:26 CEST 25 Sep** to **06:31:10 CEST 26 Sep** (~7 h 44 min). It stopped because the supervisor **disk taper** (9.5→8.4 GB free) wound RATE from 1,000 (05:25) toward 0 (~06:30); recovery-watch then fired with **mempool=7**, so drain metrics are N/A. Whole-window network TPS: median **1,548** / mean **2,507** / peak **12,175** (regimes mixed: 2× full, 10× full, 1k baseline, taper). Storm fee burn ≈ **197,803 TKAS**. Mempool peak in-window **~88k** (the 21:12 crash was before round 2). Grok Build agent (funded ~300k TKAS at 22:47) was an outside confounder.

**Full write-up + logs:** [STP-KAS/grok-bot-vprogs-round2](https://github.com/STP-KAS/grok-bot-vprogs-round2).

## Round 3 (26 Sep 2026)
vprogs under a TN10 storm: our own vprog on vprogs master and tic-tac-toe, plus the n0 `--utxoindex` restart. See [STP-KAS/grok-bot-vprogs-round3](https://github.com/STP-KAS/grok-bot-vprogs-round3).

## Round 4 and later

The **final** round-4 report (data up to 09:20 CEST 26 Sep) is [here](https://github.com/STP-KAS/grok-bot-vprogs-round4). Later rounds: [5](https://github.com/STP-KAS/grok-bot-vprogs-round5) · [6](https://github.com/STP-KAS/grok-bot-vprogs-round6) · [7](https://github.com/STP-KAS/tn10-vprogs-round7-ideas) · [8](https://github.com/STP-KAS/tn10-vprogs-round8-covenants). Summary of all rounds: [tn10-vprogs-stress-findings](https://github.com/STP-KAS/tn10-vprogs-stress-findings).
