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
#   scripts/x-content/install-scan-schedule.sh install <clientId>          # one client
#   scripts/x-content/install-scan-schedule.sh install <id1,id2,id3>      # several, scanned sequentially
#   scripts/x-content/install-scan-schedule.sh install --pilot            # PILOT_CLIENT_IDS from .env.local at run time
#   (ONE launchd job either way: label com.hitloop.x-quote-scan. Each client scans its own stored
#    watchlist and writes only its own quoteTargets; a client with no watchlist is skipped.
#    The job runs scripts/x-content/scan-and-pull.sh: the scan, then pull-corpora.mjs with the same scope,
#    which refreshes each client's xGrowth ownHandle + benchmarkHandles corpora in x_corpora/{handle}.)
#   scripts/x-content/install-scan-schedule.sh uninstall
#   scripts/x-content/install-scan-schedule.sh status
#
# Optional, separate job — the Daily Content Loop morning run (scan → discover →
# execute, no model, see docs/source-of-truth/DAILY-CONTENT-LOOP.md):
#   scripts/x-content/install-scan-schedule.sh install-daily-loop <clientId>             # dry run: prints the plist
#   scripts/x-content/install-scan-schedule.sh install-daily-loop <clientId> --install   # writes + loads it
#   scripts/x-content/install-scan-schedule.sh uninstall-daily-loop
#   scripts/x-content/install-scan-schedule.sh status-daily-loop

set -euo pipefail

LABEL="com.hitloop.x-quote-scan"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="$HOME/Library/Logs/hitloop"
NODE_BIN="$(command -v node || true)"

# --- Daily Content Loop job (separate label + plist from the scan job) --------
DL_LABEL="com.hitloop.x-daily-loop"
DL_PLIST="$HOME/Library/LaunchAgents/${DL_LABEL}.plist"
DL_LOG="$HOME/Library/Logs/hitloop-daily-loop.log"
BIRD_PATH="${BIRD:-$HOME/.local/birdtool/node_modules/.bin/bird}"

# Prints the daily-loop plist for client $1. Fires 06:45 in the Mac's local time
# zone, exactly like the scan job (launchd has no per-job zone) — that is
# America/Chicago only while this Mac is set to Central time.
daily_loop_plist() {
  cat <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${DL_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${REPO}/scripts/x-content/daily-loop-local.sh</string>
    <string>${1}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>BIRD</key><string>${BIRD_PATH}</string>
    <key>HOME</key><string>${HOME}</string>
    <!-- Same trap as the scan job: bird is a node script and launchd's default
         PATH has no node. -->
    <key>PATH</key><string>$(dirname "${NODE_BIN}"):/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>WorkingDirectory</key><string>${REPO}</string>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>45</integer></dict>
  <key>StandardOutPath</key><string>${LOG_DIR}/x-daily-loop.out</string>
  <key>StandardErrorPath</key><string>${LOG_DIR}/x-daily-loop.err</string>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
PLIST_EOF
}

cmd="${1:-status}"

case "$cmd" in
  install)
    CLIENT_ID="${2:-}"
    if [ -z "$CLIENT_ID" ]; then
      echo "ERROR: a clientId, a comma list of clientIds, or --pilot is required." >&2
      echo "  scripts/x-content/install-scan-schedule.sh install <clientId>[,<clientId>...]" >&2
      echo "  scripts/x-content/install-scan-schedule.sh install --pilot" >&2
      exit 1
    fi
    if [ "$CLIENT_ID" = "--pilot" ]; then
      SCAN_SCOPE_ARGS="<string>--pilot</string>"
      SCAN_SCOPE_LABEL="the clients in PILOT_CLIENT_IDS (read from .env.local at run time)"
    elif [[ "$CLIENT_ID" =~ ^[A-Za-z0-9_-]+(,[A-Za-z0-9_-]+)*$ ]]; then
      SCAN_SCOPE_ARGS="<string>--clients</string><string>${CLIENT_ID}</string>"
      SCAN_SCOPE_LABEL="client(s) ${CLIENT_ID}"
    else
      echo "ERROR: invalid client list '${CLIENT_ID}' (comma-separated ids, letters/digits/_/- only)." >&2
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
    <!-- scan-and-pull.sh runs the quote-target scan, then the per-client corpus pull (pull-corpora.mjs),
         with the same scope args; exit is non-zero when either failed. -->
    <string>/bin/bash</string>
    <string>${REPO}/scripts/x-content/scan-and-pull.sh</string>
    ${SCAN_SCOPE_ARGS}
    <string>--write</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>BIRD</key><string>${BIRD_PATH}</string>
    <key>HOME</key><string>${HOME}</string>
    <key>NODE_BIN</key><string>${NODE_BIN}</string>
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
    echo "  runs 06:30 daily for ${SCAN_SCOPE_LABEL}: quote-target scan, then own + benchmark corpus pull"
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

  install-daily-loop)
    CLIENT_ID="${2:-}"
    if [ -z "$CLIENT_ID" ]; then
      echo "ERROR: a clientId is required." >&2
      echo "  scripts/x-content/install-scan-schedule.sh install-daily-loop bryan-balli-WUoltG84 [--install]" >&2
      exit 1
    fi
    if [ -z "$NODE_BIN" ]; then
      echo "ERROR: node not found on PATH." >&2
      exit 1
    fi
    if [ "${3:-}" != "--install" ]; then
      echo "DRY RUN — nothing written, nothing loaded. Plist that would go to ${DL_PLIST}:"
      echo ""
      daily_loop_plist "$CLIENT_ID"
      echo ""
      echo "Add --install to write and load it. Runs 06:45 Mac-local time; log ${DL_LOG}."
      exit 0
    fi
    if [ ! -x "$BIRD_PATH" ]; then
      echo "ERROR: bird not found at $BIRD_PATH (set BIRD=/path/to/bird)." >&2
      exit 1
    fi

    mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"
    daily_loop_plist "$CLIENT_ID" > "$DL_PLIST"
    launchctl unload "$DL_PLIST" 2>/dev/null || true
    launchctl load "$DL_PLIST"
    echo "installed ${DL_LABEL}"
    echo "  runs 06:45 daily for client ${CLIENT_ID}: scan -> discover -> execute (no model)"
    echo "  log   ${DL_LOG}"
    echo ""
    echo "⚠️  Only runs while this Mac is awake; a missed run fires at the next wake."
    echo "    The scan job above also scans at 06:30 — harmless, or uninstall it."
    ;;

  uninstall-daily-loop)
    launchctl unload "$DL_PLIST" 2>/dev/null || true
    rm -f "$DL_PLIST"
    echo "removed ${DL_LABEL}"
    ;;

  status-daily-loop)
    if launchctl list | grep -q "$DL_LABEL"; then
      echo "loaded:"
      launchctl list | grep "$DL_LABEL"
    else
      echo "not loaded"
    fi
    [ -f "$DL_LOG" ] && { echo ""; echo "last run (tail):"; tail -5 "$DL_LOG"; } || true
    ;;

  *)
    echo "usage: $0 {install <clientId>[,<clientId>...] | install --pilot|uninstall|status|install-daily-loop <clientId> [--install]|uninstall-daily-loop|status-daily-loop}" >&2
    exit 1
    ;;
esac
