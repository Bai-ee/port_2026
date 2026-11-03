# Troubleshooting brief — Content Tracks / Rendered Videos in production (2026-10-11 night)

Read this brief, then `docs/source-of-truth/CONTENT-TRACKS.md` and `docs/source-of-truth/X-STRATEGY-TAB.md` (on `main`).
Production = `main` `85d6756d`, deploy `dpl_HeBRqqrQgeNmRMfnyELGBvM9mqvu` (hitloop.agency); rollback `dpl_7bnKW6efDsBkKYSFkqcn9iuJHv2P`.
Client = Hitloop `bryan-balli-WUoltG84` (owner pilot, @bai_ee). Work in worktree `~/Documents/Repos/Bballi_Portfolio-promo`
(branch `feat/content-promotion` = main; branch off it as `fix/content-tracks-prod`). Never edit the main checkout's code.

## Owner report
"Rendered videos don't pull in anything in prod, and adding handles isn't pulling in new information — looks like it hangs on saving."

## Evidence already gathered (read-only, 02:40 UTC 2026-10-12)
- Vercel: no runtime errors in 6h; the quote-targets route logs nothing (no console output on success).
- **Rendered videos:** `content_buckets/bryan-balli-WUoltG84/meta/rendered-videos` = `lastSyncAt 2026-10-12T02:34:17Z`,
  `counts {total:820, created:0, unchanged:0, restored:0, retired:0, updated:820}`. Library `ue` bucket = 820 packages; newest
  `renderedAt 2026-10-11T06:02Z` (this morning's daily render). EditVideos listing works (bridge `listRenderedVideos` returns completed docs).
  ⇒ Data is current; nothing new exists to pull. **Bug:** every sync reports `updated:820` / `unchanged:0`, so the diff in
  `features/rendered-videos/sync.js` isn't idempotent (likely a volatile field such as `ingestedAt`, new policy fields such as
  `rightsSource`, or array or key order compared by reference). It rewrites 820 docs per click and the UI can't say "0 new".
- **Handles:** plan `x_strategy_plans/bryan-balli-WUoltG84` v15 saved fine. Music track benchmarks are
  `[dorksirjur, discogs, toshioueki]`, and promotion URLs are set. `x_strategy_refresh_requests` has 3 docs `status:'queued'` since
  02:22 / 02:31 / 02:35 UTC (overlapping handle sets) with nobody draining them. The drain is the Mac worker
  `scripts/x-content/strategy-refresh-worker.mjs` (bird cookies), by design (`features/x-strategy/refresh.js`).
  `x_corpora` still only has `bai_ee` and `seb__design`.
  **Mismatch:** profile `client_configs/...marketingBriefConfig.xGrowth.benchmarkHandles = [seb__design, toshioueki]`, which is
  missing `dorksirjur` and `discogs`. Track benchmarks and profile benchmarks are two sources of truth that drifted.
- The owner's Discogs promotion URL is an artist page with a `srsltid=` tracking param. Flag it to the owner; don't change it.

## Update — worker run + Insights (02:45 UTC)
- The owner had the Mac worker run with `--once`. `toshioueki` (268 rows) and `dorksirjur` (543 rows) were ingested into `x_corpora`.
  `discogs` and the `bai_ee` re-pull hit **429** and their requests ended `rate-limited`. A rate-limited request is never retried
  automatically; the owner has to re-save. ⇒ The UI must show "rate-limited — retry after ~15 min" plus a retry action, not look stuck.
- **Insights is single-benchmark.** `evaluate.js` already computes `byTrack` (each track against its own benchmarks), but
  **no component renders `byTrack`** (grep under `components/`). Insights still shows only the gaps against the primary
  (`gapsAgainst`, seb__design). Also, the `evaluate` input benchmarks come from the profile's `benchmarkHandles`
  (`route-handlers.js` `loadProfile`), so a track-only handle shows `found:null` even when its corpus exists.
  **Fix:** load corpora for the union of profile and track benchmarks; render per-track Insights (each track: its benchmarks'
  stats, your own posts in that track's engines, the gaps against that track's lead benchmark, and "no benchmark yet" when it's
  empty); keep the overall pace comparison against the primary as a separate, labeled section.
- **Accounts tab vs Plan → Content tracks:** two benchmark lists (profile `xGrowth.benchmarkHandles` vs `plan.contentTracks[].benchmarks`).
  Make tracks the single source. The Accounts list becomes derived (pace primary plus the union of track benchmarks) or is replaced by
  a read-only view that links to the tracks, so the owner fills in benchmarks in one place.

## Tasks (in order; stop and report after step 2 if the cause is unclear)
1. **Reproduce in the browser** (owner signed in on hitloop.agency, or local `next dev` on a free port in the worktree against
   the same Firestore): X Strategy → Plan → Content tracks → add a handle → save. Record exactly what the UI shows: the spinner,
   which request is pending, the response body and timing. Content Engine → Video Remixes bucket: does it list items? What does Sync show?
2. **Root-cause each symptom** with file:line evidence:
   a. Why the sync counts every package as `updated`. Make the diff compare only producer-owned fields and normalize volatile ones.
   b. What "hangs on saving" really waits on: a save request that's slow or awaiting the refresh, or a UI polling a queued request forever.
   c. Why track benchmarks didn't reach `xGrowth.benchmarkHandles`. Pick ONE source of truth: either derive the profile handles
      from tracks (plus the pace benchmark), or have the track save write both atomically.
3. **Fix with minimal diffs and tests:**
   - The sync reports `created / unchanged / updated` truthfully. A second sync gives `unchanged:820`.
   - The UI shows the sync result ("0 new · 820 up to date · last synced …").
   - The handle save returns immediately and shows a clear state: "Queued — run the Mac refresh worker to load posts" with the
     queued time, plus a re-check button. No infinite spinner.
   - Collapse duplicate queued requests: requeue merges handles into the open request instead of creating another.
   - Fix the profile/track handle consistency, including the existing drift for this client. That's a data repair: do a dry run,
     then apply only with the owner's OK, since it changes `client_configs` (standing rule: don't change `client_configs` without approval).
4. **Verify:** affected suites plus full `npm test` (baseline: only the 2 known vendor-api-lib failures) and `next build --webpack`.
   Then run a fresh reviewer agent.
5. **Ship:** commit, then ask the owner before merging and pushing to `main`; a push deploys production. Smoke afterwards.

## Limits
- No X API calls.
- No live posting.
- No paid model calls.
- No bird calls unless the owner runs the worker.
- No Telegram activation.
- Firestore reads are fine. Any production write other than through the app's own UI needs the owner's OK.
- Env values are never printed.
- Sub-agents never run git write commands.
