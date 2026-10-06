# Social publish scripts

- `schedule-records.mjs [--dry-run] [--per-day=1|2]` - schedules story-ready Discogs drafts (source `discogs-ingest`, `needsStory: false`, no `[add your memory]`, media present) into 09:00 / 19:00 America/Chicago slots. Default 1 per day. Patches the same draft; never posts.
- `publish-due.mjs [--dry-run]` - runs the scheduler, then publishes everything due (same function as `GET /api/social-posting?action=process-due`). `--dry-run` writes and posts nothing.

Run from the repo root: `node --env-file=.env.local scripts/social/publish-due.mjs --dry-run`

## Mac sweep (launchd, every 15 min)

Install (posts to X live on the schedule once loaded; dry-run first):

    cp scripts/social/com.hitloop.publish-due.plist ~/Library/LaunchAgents/
    launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hitloop.publish-due.plist

Check: `launchctl print gui/$(id -u)/com.hitloop.publish-due`, log at `~/Library/Logs/hitloop-publish-due.log`.

Uninstall:

    launchctl bootout gui/$(id -u)/com.hitloop.publish-due
    rm ~/Library/LaunchAgents/com.hitloop.publish-due.plist

The Mac must be awake and the worktree must keep `.env.local`. Edit the node path / WorkingDirectory in the plist if they differ.

## GitHub Actions alternative

`.github/workflows/social-publish-sweep.yml` (every 30 min) calls the deployed `process-due` with secret `CRON_SECRET`. It is inert until repo variable `SOCIAL_PUBLISH_ENABLED=true`. It only publishes already-scheduled posts (it does not run the scheduler; use the route below or the CLI).

Scheduling over HTTP: `POST /api/archive/worker/discogs/schedule` with `Authorization: Bearer $HITLOOP_ARCHIVE_WORKER_TOKEN`, body `{"dryRun": true}`.

Use ONE sweeper (launchd or Actions). The publish path has no row lock, so two sweepers (or one plus the daily Vercel cron) can race on the same due post.

## Scope

`publish-due.mjs` publishes only the owner account (`DISCOGS_X_CLIENT_ID` or the default in `features/discogs-ingest/service.js`). Other clients stay on the deployed cron. Pass `--all-clients` to sweep everyone (do not run alongside another sweeper; there is no row lock).
