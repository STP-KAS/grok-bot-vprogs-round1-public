# tic-tac-toe campaign (hosted vprog by Maksim Biriukov)

**Purpose:** play https://vprogs-tt.izio.fr/ (code: github.com/biryukovmaxim/vprog-tictactoe @ `ba05d924`) with many wallets while
spraying 0.5 TKAS transfers, to see which layer refuses or falls behind.

**How to run:** `node campaign/run.mjs` on the `main` branch (Windows desk runner; `campaign/watch.ps1` restarts it).
Encoder: `vprog-tictactoe-encoder-wasm` 0.1.6. Results: `campaign/STATUS.md` (pushed by the runner every ~10 min).

**Expected:** finished games (create → join → 5 moves, X wins) and settled results.
**Actual (last STATUS I read, 2026-09-25 21:45:58 CEST):** sends 1,220; send failures 10,349; **finished games 0; game failures 1,534**.
The hosted lane's settlement was also frozen (~85 min behind L1 at 20:12, `logs/A3-settle-lag.txt`). The campaign was scheduled to run
until 2026-09-26 08:57 CEST; the runner pushed no `STATUS.md` after 21:45:58, so these are the last recorded numbers. Failure causes are in the runner's local `campaign/log.jsonl` (not committed).
