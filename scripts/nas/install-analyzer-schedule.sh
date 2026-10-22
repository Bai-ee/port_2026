#!/usr/bin/env bash
# Install (or remove) the NAS analyzer worker as a keep-alive launchd job.
#
# The analyzer (assetManager `npm run archive:analyzer`) copies NAS files into publish-staging when a draft needs its
# image (STAGE_FOR_PUBLISH) and serves local thumbnails to the dashboard on 127.0.0.1:8777. It must simply always be
# running on this Mac; launchd restarts it after a crash, a reboot or a login. The wrapper (run-analyzer.sh) mounts
# the NAS shares first.
#
# Usage:
#   scripts/nas/install-analyzer-schedule.sh install
#   scripts/nas/install-analyzer-schedule.sh uninstall
#   scripts/nas/install-analyzer-schedule.sh status
#   scripts/nas/install-analyzer-schedule.sh restart     # never while an ANALYZE job is RUNNING (see assetManager docs/archive/ANALYZER.md)
set -euo pipefail

LABEL="com.hitloop.archive-analyzer"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="$HOME/Library/Logs/hitloop"
RUNNER="$REPO/scripts/nas/run-analyzer.sh"

write_plist() {
  mkdir -p "$LOG_DIR" "$(dirname "$PLIST")"
  cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>"${RUNNER}"</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>${LOG_DIR}/archive-analyzer.log</string>
  <key>StandardErrorPath</key><string>${LOG_DIR}/archive-analyzer.err</string>
</dict>
</plist>
PLIST_EOF
}

case "${1:-}" in
  install)
    chmod +x "$RUNNER"
    write_plist
    launchctl unload "$PLIST" 2>/dev/null || true
    launchctl load "$PLIST"
    echo "installed $LABEL (keep-alive); logs in $LOG_DIR/archive-analyzer.{log,err}"
    ;;
  uninstall)
    launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "removed $LABEL"
    ;;
  restart)
    launchctl kickstart -k "gui/$(id -u)/$LABEL"
    echo "restarted $LABEL"
    ;;
  status)
    launchctl list | grep "$LABEL" || echo "$LABEL not loaded"
    curl -s -m 3 http://127.0.0.1:8777/health || echo "analyzer not answering on 127.0.0.1:8777"
    echo
    ;;
  *)
    echo "usage: $0 install|uninstall|restart|status" >&2
    exit 2
    ;;
esac
