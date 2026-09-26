#!/bin/bash
# Concurrency ramp for storm3.mjs (workers per process; 4 processes). Steps find where acceptance/mempool/tip degrade.
C=/tmp/tn10-storm.conc; L=/workspace/tn10-break-test-2026-09-25/logs/storm/ramp.log
st() { echo "$1" > $C; echo "$(date -Iseconds) conc_per_process=$1 (x4 processes)" >> $L; sleep $2; }
st 2 600; st 4 600; st 8 900; st 16 900; st 32 900; st 64 900
echo "$(date -Iseconds) ramp script finished; conc stays at $(cat $C)" >> $L
