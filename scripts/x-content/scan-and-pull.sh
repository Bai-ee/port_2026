#!/usr/bin/env bash
# Daily launchd entry (label com.hitloop.x-quote-scan, installed by install-scan-schedule.sh):
#   1. scan-quote-targets.mjs  — quote-target scan per client
#   2. pull-corpora.mjs        — per-client own + benchmark corpus pull (multi-client F3)
# Both get the same args (scope flags + --write). Both always run (a failed scan does not block the pull);
# exit code is non-zero when either failed. Both are local `bird` only: zero cost, no X API.
#
# Usage: scripts/x-content/scan-and-pull.sh (--client <id> | --clients a,b,c | --pilot) [--write]

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NODE="${NODE_BIN:-node}"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] scan-and-pull: scan"
"$NODE" "$REPO/scripts/x-content/scan-quote-targets.mjs" "$@"
SCAN_RC=$?

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] scan-and-pull: pull-corpora (scan exit ${SCAN_RC})"
# Short window: rows merge, and the scan has already used part of the shared bird rate limit.
"$NODE" "$REPO/scripts/x-content/pull-corpora.mjs" "$@" --days "${PULL_DAYS:-7}"
PULL_RC=$?

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] scan-and-pull: done (scan ${SCAN_RC}, pull ${PULL_RC})"
if [ "$SCAN_RC" -ne 0 ]; then exit "$SCAN_RC"; fi
exit "$PULL_RC"
