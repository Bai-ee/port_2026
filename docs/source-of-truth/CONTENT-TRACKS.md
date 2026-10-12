# Content Tracks + Promotion Loop (SSOT, 2026-10-11)

Plan: `docs/plans/CONTENT-TRACKS-PROMOTION-MASTER-PLAN.md`. Client: `bryan-balli-WUoltG84` (posts as @bai_ee). Owner decisions D1–D5 + the NAS-staging amendment are binding.

## What it is
- `plan.contentTracks` on `x_strategy_plans/{clientId}` (optional; absent ⇒ defaults, old plans behave exactly as before). Contract: `features/x-strategy/content-tracks.js` (`tracksOf`, `normalizeContentTracks`, `trackForEngine`, `allPromotions`).
- Defaults: **design** (client+identity engines, benchmark `seb__design`, 50%) and **music** (ue+record engines, **no benchmark yet**, 50%). Every engine belongs to exactly one track; ≤6 tracks, ≤3 benchmarks/track, ≤8 distinct (`PLAN_LIMITS.maxBenchmarkHandles`).
- **Tracks own the profile's benchmark list.** Any plan write (apply / revert / chat plan-change) that changes tracks or pace mirrors `[benchmarkPrimary, ...track benchmarks]` (≤8) into `client_configs.marketingBriefConfig.xGrowth.benchmarkHandles` (`track-profile.js profileBenchmarksFromPlan`, wrapper in `route-handlers.js`). A mirror failure never fails the save (`profileSync.error`). With tracks, the Accounts benchmark list is read-only (derived, links to Plan → Content tracks) and direct profile saves (Handles editor, chat `benchmarks-change`) keep the derived list — only the own handle changes. Old drift: `scripts/x-content/sync-profile-benchmarks.mjs` (dry-run default, `--write`).
- Pace stays `plan.benchmarkPrimary`. Track `share` × authored originals raises per-engine minimums (`track-profile.js applyTrackAllocation`, called from `plan-inputs.js`); never lowers a cap/floor.
- Per-track profile (`track-profile.js`): pools only that track's benchmark corpora. No benchmark ⇒ `status:'no-benchmark'`, fallback own history, surfaced as a gap — never invented numbers.
- Promotions (`promotions.js`): ue → rendered-video packages, record → Discogs, client → client work. URL starts `null`; the link rides **only in the self-reply** (`promotionSelfReply`, `''` when null).

## Rights (D1)
UE-hosted rendered mixes: BAI-EE ⇒ `owned`; others ⇒ `rights:'cleared'`, `approval:{state:'none'}`, `rightsSource:{by:'owner',policy:'ue-hosted-cleared',at:'2026-10-11'}`. `rightsSetBy:'human'` always wins. Applied by sync (`features/rendered-videos/`) and the one-off `scripts/x-content/apply-ue-rights-policy.mjs` (dry-run default, `--write`, counts only, idempotent). Upstream-deleted videos are retired (`retiredReason:'source-missing'`, prior status kept in `retiredFromStatus`) only after a **complete** listing.

## Daily loop
- Suggestions carry `track`, `promotion`, `package.media {kind,ref}`, `draft.selfReply`; max 5; default library `full`.
- **NAS amendment:** a package with no playable assetRefs ⇒ `package.media = {status:'needs-staging'}`. Save **refuses** (409 `needs-staging`) — never a text-only showcase draft (also enforced for old run docs via the live package). Web + Telegram offer **Stage from NAS** → existing `nas-stage` (owner click = approval; Mac analyzer must be online, UI says so). Never auto-staged. After `STAGE_FOR_PUBLISH` writes `publish-staging/nas/...` onto the package, reads overlay the media (`overlayStagedMedia`) and Save attaches it via `pickMedia`.
- Save writes one unscheduled `social_posts` draft with `mediaStoragePath` = object ref (re-signed at publish), `sourceRef.{track,promotionId}`.
- Cloud cron `GET /api/worker/daily-loop` (`30 11 * * *`): Bearer `CRON_SECRET` (fail closed in prod), `PILOT_CLIENT_IDS` required (503 if unset), **no model drafter**, saved scan only, no bird/X.

## Telegram
Briefing groups suggestions by track; suggestion card = media + exact copy + `track · promotion · why`; buttons Save draft / Dismiss (or Stage from NAS / Dismiss), tickets revision-bound (`rev` strict). One outbox notice per run key. Services wired in `features/telegram/runtime.js` (`saveSuggestion`, `dismissSuggestion`, `stageSuggestion`). Activation remains an owner gate (see TELEGRAM-COMMAND-CENTER.md).

## UI
X Strategy → Plan tab → "Content tracks" (`#x-strategy-content-tracks-panel`): engines, benchmarks (add ⇒ queues a refresh for the Mac worker), shares, promotion links, profile summary. Save returns as soon as the plan is written (reload runs in the background). Refresh requests: one open `queued` request per client (re-requests merge into it); a queued request is polled 5× then parks with "Queued at …" + **Re-check**; `rate-limited` shows "retry after ~15 min" + **Retry** for the handles that did not pull. Suggestion cards show track/promotion chips and the staging flow.

## Limits
- Insights → "By content track" renders `evaluation.byTrack` (per-track benchmarks, gaps vs the track lead, "no benchmark yet"); the overall pace section stays labelled separately. Own posts are not tagged by track, so each track's own side is all of your posts (stated in the UI).
- Follow-up: the Content Engine library list is ~6.6 MB (≈1980 NAS + 820 rv rows). Loading `rv-` by bucket needs the shared `inventory-list` loader split (BucketsPanel, two other panels and the day-plan slot lookup all read it) — not done.
- `readInventory()` (un-paginated) reads ids in two bounded queries: the head (READ_LIMIT) and everything after the NAS id range (`NAS_ID_END`), so the NAS archive can't crowd rendered videos out. Sources sorting before `nas-` still share the head budget.
- Corpus refresh needs the owner's Mac: `node scripts/x-content/strategy-refresh-worker.mjs`.
- Library is global (owner pilot only). Cron copy is plain fallback copy; regenerate with the model from the dashboard.
- Telegram video by URL caps at 20MB (else poster + link). Staging completion is not pushed — reopen Today's posts.
- Strategy-chat edits of `contentTracks` are supported by the proposal schema; no dedicated chat UI.
- Local `npm run build` with the symlinked `node_modules` needs `--webpack` (Turbopack rejects the symlink); Vercel builds normally.
