#!/bin/bash
# Run upstream kaspanet/vprogs examples/tn10-runtime (release-candidate 3a61c0ba608b, dev-mode proofs) against our local
# TN10 node n1 WHILE the TPS storm keeps the mempool at a 50-70k backlog. Keys: throwaway W5/W6 read from the secure
# wallet file into env only (never printed/committed). usage: run.sh [seconds=900]
set -u
D=/workspace/tn10-break-test-2026-09-25/vprogs/tn10-runtime-under-storm
[ -e /workspace/vprogs-rc/target ] || ln -s /workspace/cargo-target /workspace/vprogs-rc/target
export TN10RT_WRPC_URL=${TN10RT_WRPC_URL:-ws://127.0.0.1:17220}
export TN10RT_KEY1=$(python3 -c "import json;print(json.load(open('/home/box/secure/tn10-break-wallets.json'))['W5']['key'])")
export TN10RT_KEY2=$(python3 -c "import json;print(json.load(open('/home/box/secure/tn10-break-wallets.json'))['W6']['key'])")
export STEP_DELAY_MS=${STEP_DELAY_MS:-4000} SEED_DEPTH=${SEED_DEPTH:-500} ACCOUNTS=${ACCOUNTS:-3}
bash /workspace/vprogs-rc/examples/tn10-runtime/scripts/run-demo.sh ${1:-900} 2>&1 | sed -E 's/[0-9a-f]{64}/<h>/g; s/(KEY[12]?=)[^ ]+/\1<redacted>/g' > $D/run-$(date +%H%M).log
cp /workspace/vprogs-rc/examples/tn10-runtime/scripts/logA.txt $D/logA-$(date +%H%M).txt 2>/dev/null
cp /workspace/vprogs-rc/examples/tn10-runtime/scripts/logB.txt $D/logB-$(date +%H%M).txt 2>/dev/null
