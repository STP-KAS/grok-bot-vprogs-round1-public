#!/usr/bin/env bash
# Relqunch TN10 miner keepalive: 100 miners across 2 nodes (n1, n0; 50/node).
# FIXED mining address — never rotates. Ramp STEP BY STEP after isSynced.
# No mainnet, no tweets, no go-public.
set -uo pipefail

ADDR='kaspatest:qzffl5xy9np46gkttyuftqnv2w04pr8g3wsp7c3vv8se3txtelx6q7c0v0ldx'
MINER_BIN=/workspace/artifacts/kaspa-tn10/bin-x4/kaspa-miner   # batched x4 native build 2026-09-25; old binary: /workspace/artifacts/kaspa-tn10/bin/kaspa-miner
ROOT=/tmp/relqunch-miners
META=/tmp/relqunch-fleet
LOGDIR=/tmp/relqunch-miners/logs
PIDFILE=/tmp/relqunch-keepalive-100.pid
PER_NODE=2   # storm-time: 2 miners, both on n0
# Only nodes that fit on disk. Position in this list sets the miner index block:
# n1 gets gb001-gb050 (keeps existing gb021-gb040), n0 gets gb051-gb100.
NODES=(0)   # storm-time: n1 data wiped 2026-09-25 21:3x, n0 only
TARGET=2
MAX_STARTS_PER_CYCLE=1
INTERVAL=60
RPC_PORTS=(16210 16220 16230 16240 16250)
JSON_PORTS=(18210 18220 18230 18240 18250)
MIN_MEM_AVAIL_MB=1800

mkdir -p "$ROOT" "$LOGDIR"
echo $$ > "$PIDFILE"
echo $$ > /tmp/relqunch-keepalive-30.pid
echo "$ADDR" > /tmp/kaspa-miner-tn10.addr
echo "$ADDR" > /workspace/artifacts/kaspa-tn10/current-addr.txt
echo 0 > /workspace/artifacts/kaspa-tn10/hold-miner-count.txt 2>/dev/null || true

node_ready() {
  local n=$1 pidf=$META/tn10-n${n}.pid pid out jp
  pid=$(cat "$pidf" 2>/dev/null || true)
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 1
  jp=${JSON_PORTS[$n]}
  out=$(python3 /tmp/relqunch-upgrade/is-synced.py "$jp" 2>/dev/null || echo 0)
  if [ "$out" = "1" ]; then
    echo 1 > "$META/tn10-n${n}.synced"
    return 0
  fi
  echo 0 > "$META/tn10-n${n}.synced"
  return 1
}

count_miners_for_port() {
  local port=$1 c=0 p exe cmd
  for p in $(ls /proc | grep -E '^[0-9]+$'); do
    exe=$(readlink -f /proc/$p/exe 2>/dev/null || true)
    case "$exe" in *kaspa-miner|*"kaspa-miner (deleted)") ;; *) continue;; esac
    cmd=$(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null || true)
    case "$cmd" in *knsbot*) continue;; esac  # KNS bot's own miner: not ours, not counted
    case "$cmd" in
      *" -p ${port} "*|*" -p ${port}")
        case "$cmd" in *"$ADDR"*) c=$((c+1));; esac
        ;;
    esac
  done
  echo "$c"
}

kill_wrong_miners() {
  local p exe cmd
  for p in $(ls /proc | grep -E '^[0-9]+$'); do
    exe=$(readlink -f /proc/$p/exe 2>/dev/null || true)
    case "$exe" in *kaspa-miner|*"kaspa-miner (deleted)") ;; *) continue;; esac
    cmd=$(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null || true)
    case "$cmd" in
      *"$ADDR"*|*knsbot*) ;;
      *)
        echo "$(date -Iseconds) kill wrong-addr miner pid=$p"
        kill -9 "$p" 2>/dev/null || true
        ;;
    esac
  done
}

mem_ok() {
  local avail
  avail=$(awk '/MemAvailable:/{print int($2/1024)}' /proc/meminfo)
  [ "$avail" -ge "$MIN_MEM_AVAIL_MB" ]
}

start_miner() {
  local idx=$1 n=$2 port=${RPC_PORTS[$n]} suffix log pidf
  suffix=$(printf 'gb%03d' "$idx")
  log=$LOGDIR/miner-$(printf '%03d' "$idx").log
  pidf=$ROOT/miner-$(printf '%03d' "$idx").pid
  if [ -f "$pidf" ] && kill -0 "$(cat "$pidf")" 2>/dev/null; then
    return 0
  fi
  nohup nice -n 19 "$MINER_BIN" --testnet --mining-address "$ADDR" \
    -s 127.0.0.1 -p "$port" -t 1 --user-agent-suffix "$suffix" \
    >>"$log" 2>&1 &
  echo $! > "$pidf"
  echo "$(date -Iseconds) started miner $idx on n$n:$port $suffix pid=$!"
}

ensure_fleet() {
  kill_wrong_miners
  local n idx base have started=0 pidf
  if ! mem_ok; then
    echo "$(date -Iseconds) skip starts: low mem (need ${MIN_MEM_AVAIL_MB}MB avail)"
    return 0
  fi
  local pos=0
  for n in "${NODES[@]}"; do
    base=$((pos * PER_NODE)); pos=$((pos+1))
    if ! node_ready "$n"; then
      continue
    fi
    have=$(count_miners_for_port "${RPC_PORTS[$n]}")
    if (( have >= PER_NODE )); then
      continue
    fi
    # any free slot 1..PER_NODE*#NODES (slots may sit on the other node after rebalances; per-node count is by port)
    for idx in $(seq 1 $((PER_NODE * ${#NODES[@]}))); do
      (( started >= MAX_STARTS_PER_CYCLE )) && return 0
      if ! mem_ok; then
        echo "$(date -Iseconds) pause ramp: low mem after $started starts"
        return 0
      fi
      pidf=$ROOT/miner-$(printf '%03d' "$idx").pid
      if [ -f "$pidf" ] && kill -0 "$(cat "$pidf")" 2>/dev/null; then
        continue
      fi
      start_miner "$idx" "$n"
      started=$((started+1))
      have=$((have+1))
      sleep 1
      if (( have >= PER_NODE )); then
        break
      fi
    done
  done
}

echo "$(date -Iseconds) relqunch-keepalive-100 start addr=$ADDR target=$TARGET per_node=$PER_NODE step=$MAX_STARTS_PER_CYCLE"
while true; do
  if [ -f /tmp/relqunch-keepalive-100.HALT ] || [ -f /tmp/relqunch-keepalive-30.HALT ]; then
    echo "$(date -Iseconds) HALT; exit"; exit 0
  fi
  ensure_fleet || true
  total=0
  for p in $(ls /proc | grep -E '^[0-9]+$'); do
    exe=$(readlink -f /proc/$p/exe 2>/dev/null || true)
    case "$exe" in *kaspa-miner|*"kaspa-miner (deleted)")
      cmd=$(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null || true)
      case "$cmd" in *knsbot*) ;; *"$ADDR"*) total=$((total+1));; esac
      ;;
    esac
  done
  echo "$(date -Iseconds) miners=$total/$TARGET mem_avail_mb=$(awk '/MemAvailable:/{print int($2/1024)}' /proc/meminfo)"
  python3 /tmp/relqunch-upgrade/write-status.py >/dev/null 2>&1 || true
  sleep "$INTERVAL"
done
