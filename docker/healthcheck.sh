#!/bin/sh
# One healthcheck for both processes started from this image.
#
# The image previously carried a single HEALTHCHECK that fetched
# http://127.0.0.1:3000/api/health. The worker serves no HTTP, so that check
# could never pass: the container stayed in "health: starting" until its retries
# ran out and then reported "unhealthy". An orchestrator that waits for every
# service to become healthy - TrueNAS among them - therefore showed the whole
# stack as "Deploying" for ever, even though the worker was doing its job.
#
# The worker is checked against the heartbeat it writes on every queue poll, so
# this reports liveness rather than merely reporting success.
set -eu

if [ "${NUTRICORE_PROCESS:-app}" = "worker" ]; then
  beat="${NUTRICORE_HEARTBEAT_FILE:-/tmp/nutricore-worker.heartbeat}"
  [ -f "$beat" ] || { echo "no worker heartbeat at $beat"; exit 1; }

  now=$(date +%s)
  # The heartbeat holds a unix timestamp written by src/worker.ts.
  beat_at=$(cat "$beat" 2>/dev/null || echo 0)
  case "$beat_at" in
    ''|*[!0-9]*) echo "unreadable worker heartbeat"; exit 1 ;;
  esac

  age=$((now - beat_at))
  # A single job may legitimately hold the loop for a long time: a slow local
  # model is given the whole OLLAMA_TIMEOUT_SECONDS budget plus a margin, so a
  # working worker is never called unhealthy for being busy.
  limit=$(( ${OLLAMA_TIMEOUT_SECONDS:-600} + 120 ))
  [ "$age" -le "$limit" ] || { echo "worker heartbeat is ${age}s old (limit ${limit}s)"; exit 1; }
  echo "worker heartbeat ${age}s old"
  exit 0
fi

wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
