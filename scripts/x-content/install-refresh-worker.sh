#!/usr/bin/env bash
# Install (or reinstall) the Mac refresh worker launchd job: com.hitloop.x-strategy-refresh.
#
# It drains the Refresh panel's Mac-source requests every 60 s with bird (free, browser cookies):
#   - x_strategy_refresh_requests  (Refresh group "Strategy accounts")
#   - x_quote_scan_requests        (Refresh group "Quote targets")
# and writes a heartbeat to x_strategy_workers/* so the panel can say when the Mac last checked in.
# An idle pass is one small Firestore read; launchd never starts a second copy while one is running.
#
# macOS: background jobs cannot read ~/Documents unless /bin/bash has Full Disk Access
# (System Settings > Privacy & Security > Full Disk Access). Without it the job fails with "Operation not permitted".
#
# Usage: bash scripts/x-content/install-refresh-worker.sh [interval_seconds]   (default 60)
set -euo pipefail

LABEL="com.hitloop.x-strategy-refresh"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
INTERVAL="${1:-60}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGS="$HOME/Library/Logs/hitloop"
mkdir -p "$LOGS" "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd "$REPO" &amp;&amp; "$NODE_BIN" scripts/x-content/strategy-refresh-worker.mjs --once</string>
  </array>
  <key>StartInterval</key><integer>$INTERVAL</integer>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>$LOGS/x-strategy-refresh.log</string>
  <key>StandardErrorPath</key><string>$LOGS/x-strategy-refresh.err</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL: every ${INTERVAL}s, node $NODE_BIN, repo $REPO"
