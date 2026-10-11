# Content Management owner pilot — production operations

Status: **launch candidate, not deployed.** Everything below was verified locally (tests, fixture dry run, read-only legacy report). Nothing was deployed, enabled or written to production. Companion docs: [`CONTENT-MANAGEMENT.md`](CONTENT-MANAGEMENT.md) (as-built), `docs/plans/content-pilot-build-log.md`, `docs/plans/content-pilot-legacy-report.md`, `docs/plans/content-pilot-dry-run.md`, `docs/plans/content-pilot-customer-access-checklist.md`.

**What the pilot is:** one authorized owner (uid allowlist) operating one account (`bryan-balli-WUoltG84`, @bai_ee) through Content Management. **Not** customer access: enrollment stays off; the customer gate is a separate checklist. Channel support: **X is live; Instagram is a stub behind `live:false` — do not describe it as working.**

## 1. Environment (names only, never values)
| Where | Names | Required? |
|---|---|---|
| Vercel (server) | `PILOT_OWNER_UIDS`, `PILOT_CLIENT_IDS` | **Required.** Unset ⇒ every Content Management route 503s in production *and preview* (fail closed). Unset client list still treats the owner client as a pilot client for plan enforcement. |
| | `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY`, `FIREBASE_ADMIN_STORAGE_BUCKET` (or `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`) | Required |
| | `CRON_SECRET` — must be named exactly this | **Required.** Vercel cron only sends `Authorization: Bearer $CRON_SECRET` for an env var literally named `CRON_SECRET` (the route also accepts the `SOCIAL_POSTING_CRON_SECRET` alias, but Vercel will not send it). **In production/preview a missing secret FAILS CLOSED: every `process-due` call returns 401 and nothing publishes or expires** — silent unless you check the cron log. |
| | `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET` (aliases accepted) | Required to publish to X |
| | `ANTHROPIC_API_KEY` | Required for strategy chat, Enhance, the opt-in model drafter |
| | `EDITVIDEOS_FIREBASE_SERVICE_ACCOUNT_KEY`, `EDITVIDEOS_FIREBASE_BUCKET`, `HITLOOP_ARCHIVE_WORKER_TOKEN` | Required only for `ev:` media / archive worker routes |
| | `PILOT_ALERT_EMAIL`, `PILOT_ALERT_FROM`, `RESEND_API_KEY` | Optional: failed/held-post alert email (all three must be set; off otherwise) |
| | `X_STRATEGY_DAILY_TURN_CAP` (default 60), `X_STRATEGY_WORKER_ID` | Optional |
| GitHub | secrets `HITLOOP_CRON_SECRET`, `HITLOOP_ARCHIVE_WORKER_TOKEN`; repo variable `SOCIAL_PUBLISH_ENABLED` | Only for the fallback sweep (leave unset) |
| Local Mac worker | a signed-in browser for `bird` cookies, `X_STRATEGY_BIRD_COOKIE_SOURCE` (default `chrome`), Firebase admin credentials | For scan + strategy refresh only |

## 2. Publishing: exactly ONE publisher
- **Active (after deploy): the Vercel cron** `GET /api/social-posting?action=process-due`, **every 15 minutes** (`vercel.json`). The project is on Vercel Pro (owner-confirmed 2026-10-11; a `*/15` cron would fail a Hobby deploy). `STALE_DUE_MS` is **2 hours**: a due post more than 2h late is marked `expired`, never posted.
- **Fallback, documented and OFF:** `.github/workflows/social-publish-sweep.yml` (`*/30`; also schedules Discogs records). It is inert unless the repo variable `SOCIAL_PUBLISH_ENABLED=true`. **Do not enable it alongside the cron**; publishing takes an atomic claim so overlap is safe but wasteful and confuses the log. Verify the variable is unset in GitHub before launch (cannot be read from code).
- The Mac launchd publish sweep (`scripts/social/`) is retired: do not install it.
- Other crons (digest/render/reconcile) are unchanged and daily.

## 3. Operator signals (what to look at, no polling)
- **Held posts (`needs_review`)** — ambiguous publish outcome (timeout/5xx/unknown), clearance revoked, window closed, edited after approval, or a reply. They are never retried. The calendar shows the reason and the next step; **Mark posted** (needs the numeric X post id) or **Mark not posted** (returns an unscheduled draft). Failed posts with a rate-limit or pre-send network error are retried by the next run (≤3 attempts); other failures are not retried.
- **Alert email** — after each publish run, if anything was **held, failed or expired (missed the 2h window)** and `PILOT_ALERT_EMAIL`, `PILOT_ALERT_FROM` and `RESEND_API_KEY` are all set, one email (ids + error classes only, no post text; one per id-set per UTC day). It is sent once per run: a transient Resend failure is not retried, and **a total outage of the cron produces no alert at all** (nothing runs). Check the cron log (200 responses every 15 min) after deploy.
- **Input status strip** (Today / Queue): Brain approval, plan, account-data age, scan age, posting queue; the refresh-worker line comes from the worker heartbeat (`x_strategy_workers`, written on every poll once the worker runs this version) — it never says online/offline, only "last seen N min ago" / "never reported". A long bird scrape (>15 min) can read as "not seen" while it is working.
- **Spend**: strategy chat (cap `X_STRATEGY_DAILY_TURN_CAP` turns/day, ≤4 rounds, ≤1500 tokens each) and Enhance are logged to the Operating Cost card (`logAnthropicCall`; Enhance logging added in this work). The opt-in drafter is logged. **X API spend (writes/searches) is invisible on that card** — publishing cost is the post count; searches only run from dashboard-triggered refresh.
- Timezone: slots/days are **America/Chicago** for the owner. Other clients are not supported (customer-gate item).

## 4. Data stores and indexes
New collections: `x_schedule_ledger/{client}__{CT-day}`, `x_package_reservations/{client}__{package}`, `x_strategy_workers/{worker}`. Added fields on `social_posts` (all additive): `revision`, `lifecycleVersion`, `approvedHash`, `planOverride`, `reconciledAt/By`, provenance fields. **No new composite indexes**: reservation reads are doc gets plus one single-field `scheduledAt` range (client filtered in memory); `status ==` sweeps and `(clientId, packageId)` equality need none; `(clientId, createdAt desc)` already exists. Deployed bundle: `docs/audits` is not in `.vercelignore` and the strategy corpora fall back through static imports; `scripts/` is ignored, so no deployed route may depend on it.

## 5. Failure model (what the code guarantees and what it does not)
- Scheduling: every schedule/reschedule/approve-and-schedule is one transaction over the post + CT-day ledger (± neighbours) + package reservation; a competing scheduler loses on spacing/cap/package. Edits and approvals carry the `revision` the operator saw; a stale one is refused (`revision-conflict`) and the operator's text is kept. Approval binds the exact copy/media/reply target (`approvedHash`); anything changed since ⇒ delivery refuses (`approval-stale`).
- Delivery: an internal claim prevents two sweeps sending the same row. **Exactly-once delivery to X cannot be guaranteed after a timeout** (X has no idempotency key): ambiguous outcomes park `needs_review` and are reconciled **by platform id** by the operator. Reconciliation never sends anything to X.
- Not covered: weekly engine caps and engine-share are not enforced; `post-now` is an explicit immediate publish and is not plan-checked; reply posts cannot be scheduled/published (threading unsupported) and stay manual; real-Firestore transaction retry/contention was tested only against a serializing fake — **verify on staging**.

## 6. Deploy candidate procedure (requires explicit owner authorization — none given)
1. Preconditions: owner confirmed the Vercel plan allows a 15-minute cron; `CRON_SECRET` is set (and a first `process-due` run returns 200 in the cron log); owner reviewed `content-pilot-legacy-report.md` (0 rows to park at last read); `PILOT_OWNER_UIDS`/`PILOT_CLIENT_IDS` set in Vercel production **and preview**; GitHub `SOCIAL_PUBLISH_ENABLED` confirmed unset; owner signed in for the browser walkthrough (see build log) and it passed.
2. Build check in a throwaway copy (never `npm run build` in the worktree with a dev server): see build log for the result at the candidate commit.
3. Deploy with the existing Vercel flow (git push of the reviewed branch is an owner action). `vercel.json` change is the single `process-due` cadence.
4. Post-deploy smoke (owner): sign in, open Content Management, confirm the status strip loads, schedule one `[CM test]` draft ≥ 30 days out, confirm it appears in Queue & Calendar, reject it. Then (separate authorization) approve one posting batch before any live X write.
5. **Rollback / pause:** revert the deploy in Vercel (previous deployment → promote); the cron path reverts with it. To pause publishing without a deploy, remove the cron entry or unset `CRON_SECRET` (production fails closed: every sweep returns 401 until it is set again; remember to restore it). Data is additive and backward compatible: legacy code ignores `revision`, `approvedHash`, ledger and reservation docs. A post parked `needs_review` stays parked (safe). If posts were scheduled under the new code and the old code runs, the old `process-due` (daily) publishes them late or expires them at 26h — reject or reschedule them first.
6. Dry-run representative post (local, fixtures): `node scripts/pilot/dry-run-post.mjs` (16 steps, mock publisher).
