# Content pilot: representative-post dry run

**This is a LOCAL FIXTURE dry run.** It uses an in-memory fake Firestore and a mock X publisher. It is not a staging check and not a live check. It proves the owner post lifecycle logic in the deploy candidate; it says nothing about real Firestore indexes or rules, real X credentials, Vercel/cron configuration, or deployed behavior.

Guarantees: no network (global `fetch` is stubbed to throw and counted), no real Firestore, no real X, no model calls, no secrets read or printed. `PILOT_CLIENT_IDS` / `PILOT_OWNER_UIDS` are set inside the script and restored afterward.

## Run it

```
node scripts/pilot/dry-run-post.mjs     # prints a numbered transcript; exit 0 = all PASS, 1 = any FAIL
node --test scripts/pilot/__tests__/dry-run-post.test.mjs
```

The test calls the script's exported `runDryRun()` and asserts every step passes.

## What it covers

Owner client `bryan-balli-WUoltG84`: draft (`ensureDraftPost`, idempotent) -> edit -> `approveAndSchedule` 32 days out -> sweep leaves it alone -> competing schedules refused (`package-already-pending`, `plan-spacing`) -> `buildMonthCalendar` -> force due (1h in the past) -> `processDuePosts` publishes once via the mock -> package usage written back -> `buildPostResults` shows "not measured yet" -> a second post hits a mock `ETIMEDOUT`, parks `needs_review`, is not retried -> `reconcilePost`.

## Transcript (one real run)

```
LOCAL FIXTURE DRY RUN (in-memory fake Firestore + mock X publisher; not a staging or live check)

1. Draft via ensureDraftPost (owner client, package A)
   expected: draft, v2, one row, repeat save is idempotent
   actual:   draft, v2, one row, repeat save is idempotent
   PASS
2. Edit the draft text
   expected: draft | Representative post: edited by the owner.
   actual:   draft | Representative post: edited by the owner.
   PASS
3. Approve and schedule >= 31 days out
   expected: scheduled, >= 31 days out, approvedHash set
   actual:   scheduled, 32.0 days out, approvedHash set
   PASS
4. Sweep now does NOT publish the future-dated post
   expected: 0 tweets, status scheduled
   actual:   0 tweets, status scheduled
   PASS
5. Second schedule, SAME package, refused
   expected: rejected package-already-pending
   actual:   rejected package-already-pending
   PASS
6. Second schedule, other package, 30 min apart, refused
   expected: rejected plan-spacing
   actual:   rejected plan-spacing
   PASS
7. Calendar view shows the post as scheduled on its day
   expected: post present with state scheduled, not proposed
   actual:   state scheduled, real, date 2026-11-12
   PASS
8. Force due (scheduledAt 1h in the past, inside the 2h window)
   expected: status scheduled, scheduledAt in the past
   actual:   status scheduled, scheduledAt in the past
   PASS
9. processDuePosts publishes through the MOCK publisher exactly once
   expected: 1 tweets, status posted, numeric twitterId
   actual:   1 tweets, status posted, numeric twitterId
   PASS
10. Package usage written back (posted, postCount 1, lastTwitterId)
   expected: status posted, postCount 1, lastTwitterId = post twitterId
   actual:   status posted, postCount 1, lastTwitterId matches
   PASS
11. Results view: posted with "not measured yet" metrics
   expected: in posted list, metrics null, note "not measured yet"
   actual:   in posted list, metrics null, note "not measured yet"
   PASS
12. Schedule second v2 post (package B) far out, then force due
   expected: scheduled, due
   actual:   scheduled, due
   PASS
13. Ambiguous publish (mock ETIMEDOUT) parks needs_review
   expected: needs_review, network-ambiguous, retryable false, 1 attempt
   actual:   needs_review, network-ambiguous, retryable false, 1 attempt
   PASS
14. Parked post is NOT retried by later sweeps
   expected: 0 further publish attempts, status needs_review
   actual:   0 further publish attempts, status needs_review
   PASS
15. reconcilePost marks the held post posted with a numeric platform id (no publish)
   expected: bad id rejected; posted, id 1850000000000009999, no new tweet
   actual:   bad id rejected; posted, id 1850000000000009999, 0 new tweets
   PASS
16. No network call was made (global fetch never invoked)
   expected: 0 fetch calls
   actual:   0 fetch calls
   PASS

16/16 steps passed. RESULT: PASS
```
