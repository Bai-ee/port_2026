#!/usr/bin/env bash
# Daily Content Loop — the local morning run: scan → discover → execute.
#
# WHY LOCAL: steps 1-2 use `bird` (this machine's x.com browser cookies).
# COST: zero. No X API, no ScrapeCreators, no Anthropic — --execute runs WITHOUT
# --draft-with-model on purpose; model copy is a manual, per-run decision.
# IT CANNOT POST OR SCHEDULE. The loop only writes the run doc and search snapshot.
#
# Every step is attempted even if an earlier one failed (a failed scan leaves the
# stale input visible in the run's INPUTS table). Exit is non-zero if any step failed.
#
# Usage: scripts/x-content/daily-loop-local.sh <clientId>
# Log:   ~/Library/Logs/hitloop-daily-loop.log

set -u

CLIENT_ID="${1:-}"
if [ -z "$CLIENT_ID" ]; then
  echo "usage: $0 <clientId>" >&2
  exit 2
fi

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_FILE="$HOME/Library/Logs/hitloop-daily-loop.log"
NODE_BIN="$(command -v node || true)"

mkdir -p "$(dirname "$LOG_FILE")"
cd "$REPO" || exit 1

log() { printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >> "$LOG_FILE"; }

if [ -z "$NODE_BIN" ]; then
  log "ERROR node not found on PATH"
  echo "ERROR: node not found on PATH." >&2
  exit 1
fi

FAILED=0

run_step() {
  local name="$1"
  shift
  log "START $name"
  "$@" >> "$LOG_FILE" 2>&1
  local code=$?
  if [ "$code" -eq 0 ]; then
    log "OK    $name"
  else
    log "FAIL  $name (exit $code)"
    FAILED=1
  fi
}

log "=== daily loop for ${CLIENT_ID} ==="
run_step "scan" "$NODE_BIN" "$REPO/scripts/x-content/scan-quote-targets.mjs" --client "$CLIENT_ID" --write
run_step "discover" "$NODE_BIN" "$REPO/scripts/x-content/daily-run.mjs" --client "$CLIENT_ID" --discover --write
run_step "execute" "$NODE_BIN" "$REPO/scripts/x-content/daily-run.mjs" --client "$CLIENT_ID" --execute
log "=== done (failed=${FAILED}) ==="

exit "$FAILED"
