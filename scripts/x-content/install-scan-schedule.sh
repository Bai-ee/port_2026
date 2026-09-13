#!/usr/bin/env bash
# Install (or remove) the daily local quote-target scan as a launchd job.
#
# WHY LOCAL: `bird` authenticates with this machine's x.com browser cookies, so
# the scan cannot run on Vercel. It writes its result to Firestore; the
# dashboard only ever reads. Cost is zero — no X API, no ScrapeCreators, no LLM.
#
# The job runs at 06:30 local, a few hours before the 07:00 CT first posting
# slot, so the day's candidates are waiting when you open the card.
#
# Usage:
#   scripts/x-content/install-scan-schedule.sh install <clientId>
#   scripts/x-content/install-scan-schedule.sh uninstall
#   scripts/x-content/install-scan-schedule.sh status

set -euo pipefail

LABEL="com.hitloop.x-quote-scan"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="$HOME/Library/Logs/hitloop"
NODE_BIN="$(command -v node || true)"

cmd="${1:-status}"

case "$cmd" in
  install)
    CLIENT_ID="${2:-}"
    if [ -z "$CLIENT_ID" ]; then
      echo "ERROR: a clientId is required." >&2
      echo "  scripts/x-content/install-scan-schedule.sh install bryan-balli-WUoltG84" >&2
      exit 1
    fi
    if [ -z "$NODE_BIN" ]; then
      echo "ERROR: node not found on PATH." >&2
      exit 1
    fi
    # bird must be resolvable by the scanner. Fail now rather than at 06:30.
    BIRD_PATH="${BIRD:-$HOME/.local/birdtool/node_modules/.bin/bird}"
    if [ ! -x "$BIRD_PATH" ]; then
      echo "ERROR: bird not found at $BIRD_PATH" >&2
      echo "  mkdir -p ~/.local/birdtool && cd ~/.local/birdtool && npm init -y && npm i @steipete/bird" >&2
      echo "  (or set BIRD=/path/to/bird before running this)" >&2
      exit 1
    fi

    mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"
    cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${REPO}/scripts/x-content/scan-quote-targets.mjs</string>
    <string>--client</string><string>${CLIENT_ID}</string>
    <string>--write</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>BIRD</key><string>${BIRD_PATH}</string>
    <key>HOME</key><string>${HOME}</string>
    <!-- ⚠️ Required, and the reason this job silently produced empty scans for
         weeks. launchd runs with PATH=/usr/bin:/bin:/usr/sbin:/sbin, and
         \`bird\` is a \`#!/usr/bin/env node\` script — so it died with
         "env: node: No such file or directory" on every account while the
         scan itself reported a clean run and wrote 0 candidates. Naming the
         node binary in ProgramArguments is not enough; the child process
         needs to find node too. -->
    <key>PATH</key><string>$(dirname "${NODE_BIN}"):/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>WorkingDirectory</key><string>${REPO}</string>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>${LOG_DIR}/x-quote-scan.log</string>
  <key>StandardErrorPath</key><string>${LOG_DIR}/x-quote-scan.err</string>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
PLIST_EOF

    launchctl unload "$PLIST" 2>/dev/null || true
    launchctl load "$PLIST"
    echo "installed ${LABEL}"
    echo "  runs 06:30 daily for client ${CLIENT_ID}"
    echo "  logs  ${LOG_DIR}/x-quote-scan.log"
    echo ""
    echo "⚠️  The scan only runs while this Mac is awake. If it sleeps through 06:30,"
    echo "    launchd runs it at the next wake. A stale scan is visible in the card."
    ;;

  uninstall)
    launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "removed ${LABEL}"
    ;;

  status)
    if launchctl list | grep -q "$LABEL"; then
      echo "loaded:"
      launchctl list | grep "$LABEL"
    else
      echo "not loaded"
    fi
    [ -f "$LOG_DIR/x-quote-scan.log" ] && { echo ""; echo "last run (tail):"; tail -5 "$LOG_DIR/x-quote-scan.log"; } || true
    ;;

  *)
    echo "usage: $0 {install <clientId>|uninstall|status}" >&2
    exit 1
    ;;
esac
