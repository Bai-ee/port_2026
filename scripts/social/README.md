# Social publish scripts

> **SINGLE PUBLISHER: the GitHub Actions sweep (`.github/workflows/social-publish-sweep.yml`) is the only scheduled publisher.**
> **DO NOT LOAD `com.hitloop.publish-due.plist` (launchd is RETIRED as a publisher).** The file stays only as history. If it is loaded on the Mac, unload it:
> `launchctl bootout gui/$(id -u)/com.hitloop.publish-due` (check with `launchctl list | grep hitloop`).
> The daily Vercel cron also calls `process-due`; that is safe because every publish takes an atomic claim first, but it is not the intended publisher.

## Publish safety rules (as built)

- Claim: a post is moved `scheduled|queued -> posting` in a Firestore transaction (`claimedAt`, `attempts+1`) before any X call. If the doc is no longer claimable the sweep skips it, so two overlapping sweeps publish at most once.
- A `posting` claim older than 15 min is marked `needs_review` and reported (the tweet may already be live). It is never retried automatically.
- `failed` retries only when `retryable === true` (network, 5xx, 429) and `attempts < 3`. 402 CreditsDepleted and 4xx content/auth errors never retry. Old `failed` rows without `retryable` are not retried.
- At most 3 publishes per run (`?max=N` on the route, `--max=N` on the CLI, hard ceiling 10). The rest stay due for the next sweep.
- Only rows with a `scheduledAt` in the past and status `scheduled|queued` are due. Drafts/approved rows (`scheduledAt: null`) are never published by the sweep.
- Scheduling a post whose package (or the post itself) needs approval requires `approve-draft` first.


- `schedule-records.mjs [--dry-run] [--per-day=1|2]` - schedules story-ready Discogs drafts (source `discogs-ingest`, `needsStory: false`, no `[add your memory]`, media present) quota-aware: prefers 09:00 / 19:00 America/Chicago, else the nearest valid time in 08:00-21:00 CT; records/day <= engine config (default 1), <= 40% of that day's authored posts, >= 120 min from every other scheduled/approved/posting/posted post of any engine, no shared artist/label within 30 days. Prints per-record reasons (`plan[].reason`, `skipped[].reasons`). Patches the same draft; never posts.
- `publish-due.mjs [--dry-run]` - runs the scheduler, then publishes everything due (same function as `GET /api/social-posting?action=process-due`). `--dry-run` writes and posts nothing.

Run from the repo root: `node --env-file=.env.local scripts/social/publish-due.mjs --dry-run`

## Mac sweep (launchd) - RETIRED, do not install

Install (posts to X live on the schedule once loaded; dry-run first):

    cp scripts/social/com.hitloop.publish-due.plist ~/Library/LaunchAgents/
    launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hitloop.publish-due.plist

Check: `launchctl print gui/$(id -u)/com.hitloop.publish-due`, log at `~/Library/Logs/hitloop-publish-due.log`.

Uninstall:

    launchctl bootout gui/$(id -u)/com.hitloop.publish-due
    rm ~/Library/LaunchAgents/com.hitloop.publish-due.plist

The Mac must be awake and the worktree must keep `.env.local`. Edit the node path / WorkingDirectory in the plist if they differ.

## GitHub Actions sweep (the single publisher)

`.github/workflows/social-publish-sweep.yml` (every 30 min) calls the deployed `process-due` with secret `CRON_SECRET`. It is inert until repo variable `SOCIAL_PUBLISH_ENABLED=true`. It only publishes already-scheduled posts (it does not run the scheduler; use the route below or the CLI).

Scheduling over HTTP: `POST /api/archive/worker/discogs/schedule` with `Authorization: Bearer $HITLOOP_ARCHIVE_WORKER_TOKEN`, body `{"dryRun": true}`.

Use ONE sweeper: the Actions workflow. The publish path now takes an atomic row claim, so an overlap with the daily Vercel cron or a manual run cannot double-post, but it still wastes calls.

## Scope

`publish-due.mjs` publishes only the owner account (`DISCOGS_X_CLIENT_ID` or the default in `features/discogs-ingest/service.js`). Other clients stay on the deployed cron. Pass `--all-clients` to sweep everyone (manual use only; the atomic claim protects against overlap).
