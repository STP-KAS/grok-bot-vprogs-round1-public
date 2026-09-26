# vprogs work in this repo

| Folder | Purpose | Status |
|---|---|---|
| `tn10-runtime-under-storm/` | Run upstream `kaspanet/vprogs` `examples/tn10-runtime` (release-candidate `3a61c0ba608b`) against our node while the storm keeps a 50–70k backlog | **Not completed** — runtime panicked: node lacks `--utxoindex` (F7) |
| `tictactoe-campaign/` | Play Max's hosted tic-tac-toe vprog (`vprogs-tt.izio.fr`) at scale + 0.5 TKAS spray (the `campaign/` runner on `main`) | Ran; **0 finished games** at last status (see below) |
| `deskfloor-l1-covenant/` | Our own SilverScript v1.0.0 L1 covenant `DeskFloor` (refuses n < floor), compiled, debugged and exercised on TN10 | **Completed** — expected == actual |
