#!/bin/bash
# Kill cargo/rustc builds if free disk drops under 9 GB (node data must never hit a full disk).
while true; do
  f=$(df --output=avail -BG / | tail -1 | tr -dc 0-9)
  if [ "$f" -lt 9 ]; then
    echo "$(date -Iseconds) free=${f}G -> killing cargo builds" >> /tmp/tn10-disk-guard.log
    for p in $(ls /proc | grep -E '^[0-9]+$'); do
      e=$(readlink /proc/$p/exe 2>/dev/null); case "$e" in */cargo|*/rustc|*/cc1plus|*/ld) kill -TERM $p 2>/dev/null;; esac
    done
  fi
  sleep 10
done
