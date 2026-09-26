#!/bin/bash
# Rate ramp for gen2.mjs generators: per-generator tx/s, 5 minutes per step, aligned to the 5-minute miner measure windows.
R=/tmp/tn10-gen.rate; L=/workspace/tn10-break-test-2026-09-25/logs/load/ramp.log
step() { echo "$1" > $R; echo "$(date -Iseconds) rate_per_gen=$1 total_target=$(( $1 * 8 ))" >> $L; }
step 5;   sleep 300
step 25;  sleep 300
step 75;  sleep 300
step 200; sleep 300
step 0;   echo "$(date -Iseconds) ramp done" >> $L
