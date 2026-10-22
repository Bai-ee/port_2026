#!/usr/bin/env bash
# Runs the NAS analyzer worker (assetManager `npm run archive:analyzer`) for launchd.
#
# WHY: the analyzer is the only thing that copies a NAS file into publish-staging (STAGE_FOR_PUBLISH), which is how
# a throwback draft gets its image. When it is not running every Stage click and every calendar media backfill sits
# QUEUED for days (2026-10-18 → 10-22 it was simply not started). A stage also FAILS with "File not found on source"
# when the file's SMB share is not mounted, so the shares are mounted first (guest, idempotent; a failure is logged
# and the analyzer still starts for the shares that are up).
#
# Installed by scripts/nas/install-analyzer-schedule.sh (launchd label com.hitloop.archive-analyzer, KeepAlive).
set -uo pipefail

ASSET_MANAGER="${HITLOOP_ASSET_MANAGER_DIR:-$HOME/Documents/Repos/assetManager}"
NAS_HOST="${HITLOOP_NAS_HOST:-192.168.1.6}"
# Every share a registered NAS source lives on (archive_workers sources: /Volumes/bryan, /Volumes/Public/Bryan).
SHARES="${HITLOOP_NAS_SHARES:-bryan Public}"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

for share in $SHARES; do
  if [ ! -d "/Volumes/$share" ]; then
    echo "$(date '+%F %T') mounting smb://$NAS_HOST/$share"
    osascript -e "mount volume \"smb://GUEST@$NAS_HOST/$share\"" >/dev/null 2>&1 || echo "$(date '+%F %T') mount of $share failed (NAS off or no network); continuing"
  fi
done

cd "$ASSET_MANAGER" || { echo "assetManager repo not found at $ASSET_MANAGER"; exit 1; }
echo "$(date '+%F %T') starting analyzer"
exec npm run archive:analyzer
