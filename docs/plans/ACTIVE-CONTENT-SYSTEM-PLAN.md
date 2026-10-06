# Active Content System — plan (draft for owner approval)

Status: **Phase 1 built, uncommitted** (2026-10-06) on worktree `Bballi_Portfolio-content-system`, branch `feat/active-content-system` off `origin/main`. Discogs branches were already merged to main, so 1D ran in Phase 1. Full suite: 3951/3953, and the 2 failures are pre-existing studio-render vendor-sync checks. Owner decisions locked: split start, GitHub Actions is the single publisher (launchd retired), 4/day cap 6, Discogs thread owns the worker and this system owns allocation and publishing. Admin-only feature.

**Phases 2–5 were also built on 2026-10-06, uncommitted.** Full suite 4008/4010, with the same 2 pre-existing failures. `next build --webpack` compiles. Turbopack refuses the worktree's symlinked `node_modules`, which is an environment issue, not a code issue.

- **2A Records:** Discogs packages and drafts now carry engine, source, entities, packageId, priority and format. The scheduler is quota-aware: it keeps posts ≥120 min apart across all engines, holds the daily cap and the 40% share, applies the 30-day label/artist cooldown, and works inside 08:00–21:00 CT, preferring 09:00 and 19:00.
- **2B UE:** `features/ue-content/` plus `scripts/x-content/ue-ingest.mjs`, dry-run by default.
  - 44 records → 23 mix packages (7 owned Bai-ee, 16 `never-public` third-party) + 6 build stories.
  - 21 skipped: 0:00 durations, duplicates, known defects.
  - Stories are placeholders until Bryan writes them, with a factual `variants.x.suggestedStory`.
- **2C Client + calendar:**
  - Pure modules `client-capture.js` and `week-calendar.js`, plus `client-stories.json` (16 idea rows, not yet seeded).
  - Admin route actions `week-calendar`, `capture-client-story`, `approve-package` and `reject-package`.
  - Calendar and Clients tabs in the `x-content` card.
  - Quota-skipped slots show as "skipped", not as a gap.
- **3A Video:** `renderStillVideo` in `services/media-render/` plus `scripts/media/render-still-video.mjs`. Renders 1:1 / 9:16 1080p, 12–20 s, Ken Burns, with an audio excerpt and fades. Text overlays need an ffmpeg build with libfreetype; the local Homebrew build lacks `drawtext`.
- **4A Performance:** `performance.js` (join + per-engine stats with small-n flags and a verified-weight value score), `scripts/x-content/backfill-performance.mjs` (dry-run, bird read-only), the `engine-performance` route action, and a Results tab. bird returns no views, so measuring views needs x-monitor or a `--views` map. Velocity in the first 2 h is not measurable from a daily capture.
- **4B Scorer:**
  - `scoreXPost` is re-weighted to the verified weights and gains `sharePotential` / `followPotential`. Link multiplier is ×0.56. It no longer recommends "add a question" by default.
  - Replay against 84 real originals gives Spearman vs views 0.04 → 0.10. Neither scorer predicts reach, so treat it as a checklist.
  - Stored `xGrowthScore` values are no longer comparable with new ones.
- **5 Instagram:** Graph API container→poll→publish adapter (refuses while `live:false`), `instagram-caption.js`, and `INSTAGRAM-CHANNEL-STRATEGY.md`. Wiring into the publish loop and OAuth are not built.

Phase 1 as-built:
- `engines.js` holds the engine contract.
- `schema.js` adds optional fields plus `needsApproval`/`isApproved`.
- `engine-quota.js` holds `DEFAULT_ENGINE_CONFIG` and `allocateEngines`, wired into `plan-day.js`.
- `match.js` is engine-locked and diversity-aware. It applies entity cooldown and the evergreen recycle, and it refuses placeholder stories (`TODO…`, `[add your memory]`).
- `store.js` writes cost 2 reads and adds `readCandidates`, a composite index, and `backfillIndexFields`.
- The publish loop moves `draft → approved → scheduled → posting(claimed) → posted`, with `needs_review` for stale claims.
- Auto-retry applies only to 429 and pre-send network errors. 5xx and mid-request errors are ambiguous on X, so they wait for a human.
- Each sweep publishes at most 3. Write-back sets the package's `lastPostedAt` and `postCount`.
Supersedes the cadence/allocation assumptions in `X-CONTENT-ENGINE-HANDOFF.md` (fixed 5 posts/day, benchmark-share mix). Builds on, and does not replace, `DISCOGS-RECORDS-MASTER-PLAN.md` (lives on `feat/discogs-x-drafts`).

## 1. Objective

One admin-only system that runs **production → review → schedule → publish** for three content engines into one calendar, with Bryan's personal X account as the primary channel:

| Engine | Role in the identity | Volume |
|---|---|---|
| **Records** (Discogs archive) | Taste, music knowledge, history, discovery | Thousands, evergreen |
| **Underground Existence / creative tech** | Technical curiosity + execution; proof of systems-building | Dozens now, hundreds possible |
| **Client work / HITLOOP** | Commercial application of the same judgment | Low volume, timely, approval-gated |
| *Identity* (takes, quote-reacts, self-quotes) | Original thinking that ties the three together | Daily |

Automation does inventory, metadata, rendering, recommendations, scheduling, distribution. The human owns taste, story, approval, exceptions. Capacity is 4–8+ per day; that is a ceiling, not a quota.

## 2. What exists today (audit findings)

**Records: largely built, unmerged.** `feat/discogs-x-drafts` (worktree `Bballi_Portfolio-discogs`, ~125 commits ahead of main) plus `release/records-2026-10-06` (committed 2026-10-06 00:01) and the Mac worker `assetManager@feat/discogs-ingest`. Flow: NAS label photo + phone video → Claude-vision label read → exact-catno Discogs match → 60 s clip, 1:1 + 9:16 → `social_posts` draft + `x_content_packages/discogs-<releaseId>` (C1) → `[add your memory]` story gate → scheduler (09:00/19:00 CT, 1/day) → `publish-due.mjs` (launchd) or GitHub Actions sweep. **24 records ingested** out of thousands; story-writing is the bottleneck. Records do have video, so the video-only showcase rule holds.

**UE: rich inventory, no content engine.** `EditVideos/arweave-video-generator`. 18 artists, 44 mix records (36 distinct audio), 125 audio files in the wallet (90 unreferenced), about 59 mixes in Drive. A GitHub Actions FFmpeg worker renders 30 s 720×720 clips (13 looks, beat-sync). The site is permanent on Arweave. Ready now: about 8 rendered 30 s artist videos plus flyers and logos. Strong build-story material: Arweave deploy chain, integrity audit, spend gates, skyline thumbnail pipeline. ⚠️ **The UE wallet private key is in public git history** (`UE_RELEASE_HANDOFF.md` §1a). Rotate it before funding, and never post wallet or deploy internals.

**Client work: material is there, nothing is captured.** About 16 strong stories (CQ clones follow-up, CQ claim demo, NTR Plan 013 release, NTR homepage, EditTrades flag flow + honest negative backtest, edge research, MCP signal, EditTrax players, Site Recreate before/after, HOLO PAPER, VTC releases, Invoice Studio, Client Brain method, brief pipeline `07-comparison`). Almost all of it is `client-approval-needed`. The case-study data in the repo is placeholder (Fernwood is fictional, so never post it as proof).

**Planner (X content engine).** Good bones: pure modules, rights gate, story refusal, named gaps, artifact fatigue. It does not fit three engines:
- No `engine` field.
- Series `perDay` is unused.
- Greedy matching lets one series take every slot.
- Fatigue keys only on artifacts, so 100 records on one label all look fresh.
- `status:'posted'` retires evergreen rows forever.
- `lastPostedAt` is never written.
- The store reads every row on every write (cap 2000, about 4,000 reads per upsert), so it can't hold thousands of records.

**Publishing loop.** Draft, schedule and publish all exist on `social_posts`. X video and image upload works. The gaps:
- **No claim/lock**, and `failed` auto-retries, so two sweepers double-post. Both launchd and GitHub Actions now exist on the Discogs branch.
- `process-due` on Vercel runs once a day.
- No `approved` state for ordinary drafts.
- `performance` is never written.
- Instagram is a 501 stub.

**Performance data.** The corpus stops at 2026-09-10 (246 posts, 84 with views). Timing tables are noise (median about 66 views). Nothing joins a published `twitterId` back to its engine or package.

**Algorithm (verified 2026-10-05, profile `x-2026-10-03`).**
- Each post's first 2 h decide its reach (small-account cold start).
- An author's 2nd post in one viewer's feed scores ×0.5, the 3rd ×0.25.
- Reply, quote and DM share are worth 5, copy-link 20, follow 4, like 0.5. A report is −234.
- Implication: spaced, high-value posts beat volume, and records must not bunch.

## 3. Architecture (extend, don't rebuild)

```
 SOURCES (engine adapters)            CONTENT MODEL                 PLANNER                 LOOP
 ─────────────────────────            ─────────────                 ───────                 ────
 Records: Discogs worker ──┐
 UE: system/artists + vids ─┼──► ContentPackage (+engine,… ) ──► engine-quota layer ──► social_posts
 Client: capture + approval ┘     x_content_packages (indexed)     + buildCalendar         draft → approved
 Identity: quote/self-quote ───►  record_catalog (bulk, later)     + matchDay (diverse)     → scheduled → claim
                                                                                            → posted → write-back
                                   ▲                                                              │
                                   └──────────── lastPostedAt / postCount / twitterId / metrics ◄─┘
```

### 3a. Content model: additive fields on `ContentPackage`

All fields are optional and validated only when present, so existing rows stay valid.
- `engine: 'record' | 'ue' | 'client' | 'identity'`, defaulted from series (`SERIES[x].engine`, so the mapping is data).
- `source: { kind: 'discogs'|'ue'|'manual'|'thread', externalId, url }`: Discogs release id, UE mix id.
- `priority: 'pinned' | 'timely' | 'evergreen'` + `expiresAt`, so a client launch can outrank the archive.
- `campaign: string|null`, `related: [packageId]`, `tags: []`.
- `format: 'video'|'still'|'text'|'thread'|'carousel'` (intent), separate from `mediaState` (what exists).
- `approval: { state: 'none'|'needed'|'approved'|'rejected', by, at }`. Client work defaults to `needed`. This sits alongside the rights gate.
- `variants: { x: {...}, instagram: {...} }` for channel-specific copy and format on shared assets.
- `metrics: {}` and `signals: {}`, reserved for the feedback and recommendation layers. Nothing writes them in v1.

### 3b. Engine-quota layer (new; the core of the request)

Config lives in Firestore as data (`content_system_config/x`), not constants. It sits between `buildCalendar` (slot types) and `matchDay` (fill). Per engine:
- `minPerDay`, `maxPerDay`, `maxSharePct`, `minSpacingMin`, `windows[]`.
- Entity cooldowns (same label, artist or client within N days).
- Evergreen recycle window.

Slots are reserved by engine first, then filled by type. Matching becomes diversity-aware (penalties for repeated label, artist, series or engine) instead of greedy. `posted` evergreen rows go into cooldown, not retirement.

**Starting config (recommendation; tune from data after 4 weeks):**

| Engine | Per day | Notes |
|---|---|---|
| Identity (takes / quote-react / self-quote) | 1–2 | Protected floor. Original thinking is never crowded out. |
| Records | 1 → 2 | Max 40% of authored posts. Label/artist cooldown 30 days. Story required. |
| UE / creative tech | 3–4 per week | Alternate the music cut with the "how it's built" cut. |
| Client / HITLOOP | ≥ 3 per week | Approval-gated. `timely` outranks evergreen. |
| **Authored total** | **4, cap 6** | ≥ 2 h apart (cold-start window). Replies (10/day) sit outside the cap. |

Rationale: author-diversity decay and the 2 h cold-start window reward 4 spaced posts over 8 bunched ones. Raise the cap only when median views clear about 300.

### 3c. Store scaling

Indexed queries replace full reads: `engine + status + lastPostedAt asc, limit 50` gives a bounded candidate pool per engine. This removes the 2000 cap and the double full-read on writes. Bulk Discogs metadata can stay per-release (`discogs-<id>` packages already exist). A separate `record_catalog` is needed only past roughly 10k rows. It is deferred, and the hook is `source.externalId`.

### 3d. Review + publish loop (reliability first)

- `social_posts` status adds `approved`, between `draft` and `scheduled`. Story gate, rights/approval gate and content guard all run before `approved`.
- **Atomic claim:** a Firestore transaction moves `scheduled → posting` with `claimedAt` and `attempts`. `failed` retries become opt-in (`attempts < 3`). Add a per-run cap and an idempotency key. One sweeper only.
- **Write-back:** on `posted`, set the package `lastPostedAt`, `postCount`, `twitterId` and the `social_posts.packageId` join.
- **Trigger** (owner decision, §6): the GitHub Actions sweep every 15 min already exists on the Discogs branch. Keep it as the single sweeper once the claim lock lands, and retire launchd as a sweeper. Cloud Scheduler is the precise-timing upgrade later.
- Fix doc drift: CLAUDE.md says `*/30`, real is daily; the "12h" error text should read 26h.

### 3e. Engine adapters

- **Records:** consume what the Discogs pipeline writes. Add `engine:'record'` and `source` to its package writes, and send its scheduler slots through the quota layer instead of the fixed 09:00/19:00. The Discogs thread keeps owning the worker and ingest.
- **UE:** read-only adapter over Firestore `system/artists`. It emits one package per **verified-playable** mix (skip known-defect txids) and links the rendered artist videos. Two variants per mix: music cut and build-story cut. The video step (later phase) adds a mix-excerpt render to the existing worker, beat-synced and longer than 10 s.
- **Client:** a capture template (problem, decision, rejected idea, result, asset, client, rights) plus an approval record per client. Seed from the 16 stories above as `idea` rows. Bryan writes each story; nothing auto-drafts client copy without a story.

### 3f. Unified calendar (admin card)

Extend the existing `x-content` card with a week grid over `social_posts`. It shows engine colour and status, approve/schedule buttons, per-engine counts vs config, and why each slot holds what it holds. No new card.

### 3g. Deferred: hooks only, not built

- **Recommendation and trend layer:** `signals{}` on packages, pluggable `scorers[]` in match.
- **Instagram:** its own adapter (Graph API, Business account) and its own cadence. Shares assets via `variants.instagram` (9:16 already rendered for records).
- **HITLOOP company account:** only when audience data justifies it.
- **Scorer re-weighting** to the verified weights. It runs after the loop is live, so its effect can be measured.

## 4. Phases (parallel Sonnet agents, disjoint files)

**Gate 0, owner (blocking):** decide the branch base (§6.1). Every build phase runs in a dedicated worktree, never in this shared checkout.

**Phase 1: foundation (4 parallel agents)**
| Agent | Scope | Files |
|---|---|---|
| 1A Content model | Additive fields, `SERIES.engine`, validator, schema tests | `features/x-content-inventory/{schema,categories}.js` + tests |
| 1B Quota layer | `engine-quota.js` (pure), config loader with defaults, integrate into `plan-day.js`, diversity-aware match, cooldown-not-retire | `features/x-content-inventory/{engine-quota,plan-day,match}.js` + tests |
| 1C Store scaling | Indexed candidate queries, drop full-read writes, composite-index definition | `features/x-content-inventory/store.js`, `firestore.indexes.json` |
| 1D Publish loop | `approved` status, transaction claim, attempts, idempotency, write-back join, fix 12h text | `features/social-posting/twitter-service.js`, `app/api/social-posting/route.js` + tests |

Acceptance: the full X suite plus new tests are green. `day-view.mjs` shows engine allocation. A double-sweep test proves no double-post. No live X writes.

**Phase 2: engines + calendar (3 parallel agents)**
- 2A: Records adapter hook (engine/source on Discogs writes; scheduler goes through the quota layer).
- 2B: UE adapter (read-only, verified-playable only, two variants).
- 2C: Client capture template + approval record + 16 seeded `idea` rows + week-grid calendar in the `x-content` card.

**Phase 3: video production**
- UE mix-excerpt render in the EditVideos worker.
- Generic still → video step (the `services/media-render` compositor, 1:1 and 9:16, 12–20 s) for client work.

**Phase 4: feedback loop**
- Free bird timeline backfill, joined to `packageId`.
- Per-engine performance view.
- Then the scorer re-weighting and starting-config tuning.

**Phase 5: Instagram adapter + channel strategy.**

Stop for owner approval after every phase.

## 5. Hard constraints (all phases)

- **X API:** no X write by any agent or path without a dry-run and explicit per-batch owner approval (`X-API-AND-PROFILE-OPERATIONS.md`). Seeded drafts stay `scheduledAt:null`. Nothing auto-posts.
- **No deploy, merge, push or paid call** without owner approval. Don't load the launchd plist: it posts live.
- **No emoji in post text.** Story is required, so the system never posts a record without Bryan's words.
- **Client work:** never published while `approval.state !== 'approved'`.
- **UE:** no wallet or key details in posts. Link only verified-playable mixes.
- **Builds:** no `npm run build` while dev runs. Stage hunks only; this checkout carries other sessions' work.

## 6. Owner decisions needed before Phase 1

1. **Branch base.**
   - Recommended: a new branch + worktree off `release/records-2026-10-06` once it is merged, because Phase 1D and 2A touch files the Discogs branch already changed.
   - Alternative: start 1A–1C now off `main` (planner files the Discogs branch didn't touch), and hold 1D and 2A until the Discogs merge.
2. **Single sweeper.** Recommended: the GitHub Actions 15-min sweep, after the claim lock lands. Alternatives: Cloud Scheduler, or Vercel Pro.
3. **Starting cadence** (§3b table): approve or adjust.
4. **Who owns Records engine changes.** This system or the Discogs thread. Recommended: the Discogs thread keeps the worker and ingest; this system owns allocation and scheduling.
5. **UE wallet key rotation:** acknowledge. It blocks any UE spend; it does not block posting already-rendered videos.
