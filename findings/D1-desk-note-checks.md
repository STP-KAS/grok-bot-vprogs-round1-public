# D1: checks carried over from the desk note (STP-KAS/vprogs-tn-desk-public)

Evidence is in `logs/A*.txt`, `logs/B*`; the desk note itself is at https://github.com/STP-KAS/vprogs-tn-desk-public.

| Check | Result | Evidence |
|---|---|---|
| Hosted tic-tac-toe settlement frozen | Still frozen: at 18:12 UTC the demo's last settlement was DAA 580229488 vs virtual DAA 580293545 → gap 64,057 DAA ≈ **85.4 min** of lag, `settlementMoved=false`, while the L2 tip moved 57 in the sample | `logs/A3-settle-lag.txt`, `logs/A2-probe.txt` |
| Settler/reorg-floor rules model | TAP run 20:12 CEST, all subtests ok | `logs/A1-rules-test.txt` |
| Issue-126 reorg-below-floor panic | Still present in pinned `3a61c0ba608b` (source read, per desk note); guard patch `patches/reorg-below-floor.diff` in the desk repo, **not applied upstream** | desk note |
| Upstream pins | vprogs master `f9b84a863a7c` (2026-07-28), `release-candidate` `3a61c0ba608b` (2026-09-24, = draft PR 164), tictactoe `ba05d924e1e5`, silverscript `v1.0.0` = `3ed973335b59` | `logs/A4-upstream-pins.txt` |
| SilverScript version-stamp trap | Artifact `compiler_version` is `0.1.0` though the tag is v1.0.0; bumping the constant would break `pragma ^0.1.0`. Unchanged. | desk note, `silverscript/l1-floor.recompiled.json` |
| silverc constructor edges | ints up to 2^63-1 compile; -2^63 fails ("Number exceeds 8 bytes"); 2^63, floats, strings rejected at arg parse | `logs/B1-silverc-edges.txt` |
| cli-debugger `DeskFloor.check` | n=0 FAIL, n=1/2/2^63-1 PASS; `-1` as a separate arg is parsed as a flag (usage error) — must be passed `--arg=-1` | `logs/B3-silverc-debugger-runs.txt` |
| DeskFloor covenant on-chain (TN10) | n=0, -1, wrong dispatch tag, 9-byte number → rejected; n=1, 5, 2^63-1 → accepted | `logs/B2-deskfloor-onchain.jsonl` |
| Bridge bugs (malformed peer reply stops bridge, receipt-cache key omits pins, `signed_carrier_transaction` assert) | Still open per source read; **not re-tested** in this session | desk note |
