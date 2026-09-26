# DeskFloor — our own L1 covenant (SilverScript v1.0.0)

**Purpose:** smallest useful L1 program: `entry check(int n) { require(n >= floor); }` with constructor `floor`.
Source/artifacts: `../../silverscript/l1-floor.sil`, `l1-floor.args.json`, `l1-floor.recompiled.json`; edge compile: `../../silverscript/edge-compile.sh`.
Deploy/spend on TN10: `../../scripts/deskfloor.mjs` (P2SH outputs, then spends with various n).

**Expected vs actual**

| Case | Expected | Actual (TN10, `logs/B2-deskfloor-onchain.jsonl`) |
|---|---|---|
| n=1 (at floor), n=5, n=2^63-1 | accept | accepted |
| n=0, n=-1 | reject | rejected ("script ran, but verification failed") |
| wrong dispatch tag | reject | rejected ("script returned early") |
| 9-byte number | reject | rejected |

Compiler edges (`logs/B1-silverc-edges.txt`): floor up to 2^63-1 compiles; -2^63 fails "Number exceeds 8 bytes" (arguably should work: it is a valid i64);
2^63 / float / string rejected at arg parse. Debugger (`logs/B3-...`): `-1` as a bare arg is taken as a CLI flag; use `--arg=-1`.
