# Content Engine v2: Buckets, Signals, Today (master plan)

Status: **P1 + P2 built, uncommitted** (2026-10-06). Written after an owner interview and 3 read-only audits. Scoped tests 435/435.
- **P1:** `buckets.js`, `facets.js`, `bucket-store.js`, `folders.js`, `search-index.js` (~3 ms per query at 10k items). Bucket route actions. Buckets tab UI (rail, folders, search, grid, drawer).
- **P2:**
  - Rendered Videos adapter, with `media-url` re-signing and the ingest/poster scripts. Dry run on real data found **814 renders**: 284 owned, 530 third-party `never-public`; 89 `auto-daily`, 81 deliberate, 644 origin-unknown (rendered in the EditVideos app with no Hitloop job).
  - Discogs facets in `buildContentPackage` plus `scripts/discogs/backfill-facets.mjs`, offline = artist/label/year. Genres need `--discogs`; a worker handoff doc for the Discogs thread covers new records.
  - Ideas seed: 22 items (16 client + 6 build). Grid thumbnails load lazily via `media-url`, and the item drawer shows a media preview.
- **Live feed + thumbs, run 2026-10-06 with owner OK:**
  - Rendered Videos is synced from Video Remix: 814 `rv-*` packages, via the route action `sync-rendered-videos` on tab open plus `scripts/x-content/sync-rendered-videos.mjs`.
  - Thumbnails: 522 videos via `scripts/x-content/backfill-rendered-thumbs.mjs` (ffmpeg on the Mac, because the EditVideos bucket has no CORS) and 17 Discogs records via `backfill-discogs-thumbs.mjs`.
  - **290 renders have records but their files are deleted from storage.** They are retired with the tag `media-missing` and hidden. Sync never resets their status.
  - Item actions: `media-urls` (batched), `save-thumb`, `set-rights`, `create-draft-from-item` (draft only).
  - Open: the EditVideos worker should emit a thumb at render time. New renders lack thumbs until the backfill re-runs.
Builds on `ACTIVE-CONTENT-SYSTEM-PLAN.md` (Phases 1–5, built and uncommitted on `feat/active-content-system`). Admin-only.
Proof of concept for one client: HITLOOP / @bai_ee. Every client-specific thing (buckets, folders, goals, follow list) is **data, not code**, so other clients can be configured later. The per-client customization UI is not built now.

## 1. What the owner wants (interview, 2026-10-06)

| Topic | Decision |
|---|---|
| Bucket | **A bucket is a source.** Today: Discogs Records · Rendered Videos · NAS Archive · Ideas (growth/client/design/dev). Buckets are added and renamed in the UI, and each has its own daily/weekly share. |
| Inside a bucket | **Folders hold themes** (acid, Housepit, 1997, 303…). Tags group items. |
| Rendered Videos | **Only finished renders** (DJ-mix audio, hosted on Firebase), each with DJ name and mix title. No raw source clips. |
| NAS Archive | Old flyers, party photos and past-event videos, as an **in-app searchable catalog**. |
| Metadata per item | As much as is cheap: people/crews/labels, venues/cities/parties/dates, gear (303/808/909) and genres, era and story, **vibe** (dark/light, night/day, party pic…). Extract once, cache, keep token cost low. |
| Viral scan | **Elevate the existing features**: paid X search plus Scout/watchlist, driven by the client's follow list and the marketing brief. Nothing new for its own sake. |
| Occasions | The system **detects** them from daily signals (Bandcamp Friday, Roland 909 Day, an artist trending) and ties them to the owner's content. These are not hand-maintained dates. |
| Autonomy | **Suggest, owner approves.** Nothing moves or posts by itself. |
| Goals | Growth (reach/followers) **and** inbound work for HITLOOP. Long-term goals steer; daily signals flex. |
| Today view | Per post: **edit in place · approve/schedule · post now · delete / back to drafts**. |
| Chat | An **advise-only** assistant beside the daily plan. It discusses and explains but never changes anything. |
| Placement | **Inside the Content Engine card.** |

## 2. What exists vs what is missing

| Need | Exists | Missing |
|---|---|---|
| Buckets | Hardcoded `engines.js` (record/ue/client/identity) and the quota layer | User-defined buckets, rename/add, per-bucket share stored as data |
| Folders/themes | `tags[]` on packages | Folders (manual + rule-based), UI |
| Discogs bucket | Live pipeline (28 records, 17 drafts) and ACS fields | Genre/style facets for matching |
| Rendered Videos | EditVideos `videos/{jobId}` holds the **real** `artist` + `mixTitle` and `videoUrl`; it is reachable through the bridge's `editvideos` admin app | Adapter, posters (none exist), re-signing (URLs expire after 1 yr), handling of daily-email random renders |
| NAS Archive | 8,711 assets hashed, `archive_review`, Jev 6 questions | **Only ~7 analyzed, zero images analyzed, no search.** Jev never sees pixels. |
| Metadata schema | `entities[]`, `eraYear`, `eventDate`, `tags` | Typed facets (people/venues/gear/genres/vibe…), alias table (909 → Roland TR-909) |
| Signals | Scout `agentData` (viralOpportunities, kolActivity, categoryTrends), `watchlistTimelines` (kols), `xMarketTalk` (paid), opportunitySignals, `quoteTargets` (free bird) | **Signal → my content matching**, occasion detection, free `bird search`, follow-list as the scan source |
| Occasions | `triggers.js` (21 defined; only anniversary + self-quote fire) | Wiring the scan/feed triggers to signals |
| Daily plan | Plan / Calendar / Clients / Results tabs, quota allocation, publish lock | Today view with in-place actions, opportunity slots, goal weights |
| Chat | None | Advise-only advisor |

## 3. Target UX: Content Engine card

Four tabs. Every new container gets a stable id (`x-content-…`). The card follows the phone-width standard.

**① Today** (`x-content-today-panel`). The daily driver.
- Left column: the day's posts in time order. Each row shows:
  - time, bucket chip, status;
  - **why now**: a linked viral post, an occasion, a goal, or the evergreen rotation;
  - a media thumbnail and the copy.
- Opportunity suggestions appear inline with an **Add to today** button. Accepting one bumps the lowest-priority evergreen item to tomorrow, and you approve that change.
- Clicking a row opens a drawer (`x-content-post-drawer`):
  - edit copy, media and time;
  - **Approve**, **Schedule**, **Post now**, **Back to drafts**, **Delete**.
  - **Post now** opens a confirm showing the exact text, media and account (@bai_ee), and states that it is live and irreversible. Your click is the per-post approval the X spend rule requires.
- Right column: **Advisor chat** (`x-content-advisor-chat`), advise-only.

**② Buckets** (`x-content-buckets-panel`). The library.
- Left rail: the bucket list with **+ Add bucket**, rename, reorder, and each bucket's share (per day / per week / max %).
- Inside a bucket: a folder row (manual folders plus **smart folders** = saved filters, e.g. `gear contains 303`), then a thumbnail grid.
- One **search bar** across all buckets: people, venue, gear, genre, year, vibe, free text.
- The item drawer has editable facets, **write story**, the suggested story, approval, and "used in N posts / last posted".

**③ Signals** (`x-content-signals-panel`).
- Today's hot posts and conversations from your follow list and brief keywords.
- Detected occasions (e.g. "Roland 909 Day trending · 14 posts from accounts you follow").
- Each signal shows its **matched content** from your buckets, a match reason (shared entity, gear, era) and **Suggest for today**.

**④ Results** (exists). Add a **Goals** panel: growth and inbound weights, plus optional time-boxed focus such as "push UE this month" or "launch /records". These weights tilt bucket shares and opportunity scoring.

## 4. Data model (additive, client-scoped)

- `content_buckets/{clientId}/buckets/{bucketId}`: `{ name, sourceKind: 'discogs'|'rendered-video'|'nas-archive'|'ideas'|'manual', share:{perDay, perWeek, maxSharePct}, color, order, active }`.
  - Seeded from today's engines. `engine` on packages stays as a compatibility alias of `bucketId`, and `resolveEngine` becomes `resolveBucket` with a fallback.
- `content_buckets/{clientId}/folders/{folderId}`: `{ bucketId, name, rule?: {field, op, value}, itemIds?: [] }`. A smart folder has a rule; a manual folder has ids.
- **Facets v1** on every item (the package or catalog row):
  - **People and places:** `people[] crews[] labels[] venues[] cities[] partyNames[]`.
  - **Time:** `dateText eventDate eraYear decade`.
  - **Sound:** `gear[]` (normalized, e.g. `tr-909`) and `genres[]`.
  - **Vibe:** `vibe:{ light:'dark'|'light', time:'night'|'day', kind:'flyer'|'party-photo'|'performance'|'gear'|'portrait'|'crowd'|'other', mood[] }`.
  - **Text:** `ocrText`, `story` (owner only), `storySuggestion`.
  - **Bookkeeping:** `facetConfidence{}`, `humanEdits{}` (a human value always wins), `facetVersion`, and `searchTokens[]` (lowercase words for search).
- `entity_aliases/{clientId}`: canonical name → aliases (909 → tr-909, roland 909; artist spellings). Grown from facets and confirmed by the owner.
- **NAS catalog**: `catalog/{sha256}` holds facets, a thumbnail path and the NAS path. A package is created **lazily** when an item is promoted or scheduled, so 8.7k rows never load into the planner.
- **Search:** a compact JSON index of id, facets and tokens (~5 MB at 8.7k items), built server-side, cached, and filtered client-side (MiniSearch-style). Firestore `array-contains` covers exact facet filters.

## 5. Sources (bucket adapters)

1. **Discogs Records** (live). Add facets from Discogs release data (genres/styles, label, year, artists), which is already fetched per release, so no new spend.
2. **Rendered Videos** (new, read-only).
   - Read EditVideos `videos/*` (real artist + mixTitle) through the bridge, joined to `media_jobs` for look/filter.
   - Store the object path and re-sign on demand.
   - Generate a first-frame poster locally with ffmpeg.
   - Facets: people = DJ, title = mix, plus genre/gear from the UE artist data where known.
   - Daily-email random renders stay included but tagged `auto-daily` (owner decision §9).
3. **NAS Archive** (new extraction, on the Mac worker).
   - **One vision call per item** on a downscaled 1024 px JPEG (video: 3–4 ffmpeg keyframes). Haiku 4.5 by default, with **a single forced-JSON facet schema** that also answers the 6 Jev questions.
   - Folder-path hints in the prompt (e.g. `Housepit/San Francisco/2008`).
   - **Cached by `sha256 + promptVersion`.** Each call is logged to the cost ledger.
   - Estimated cost: ~$0.003–0.01 per item, so ~$30–90 for the full 8.7k.
   - Rollout: **sample 200 items first** (~$1–2) → owner reviews quality → approve the full run.
   - TwelveLabs only for videos where audio or on-screen speech matters.
4. **Ideas** (exists): client stories and growth/design/dev ideas, captured in the UI.

## 5c. P3 NAS processing (built 2026-10-06, uncommitted, not yet run on real files)

- **Owner decisions:** this thread owns NAS analysis and staging; the Archive thread keeps the organizer and Arweave. Faces deferred. Haiku with a per-run cap (default $5, max $20). **Only content approved for posting goes to Firebase.** Analysis metadata syncs (summary, activity, facets); thumbnails and originals stay on the Mac and are served locally. When the laptop is offline, items show their summary as a placeholder.
- **Mac analyzer** (`assetManager/lib/archive/analyzer/`, `npm run archive:analyzer`, new files only):
  - Separate workerId `<id>-analyzer`.
  - Commands `ANALYZE_FACETS` (estimate/dryRun, cap, cancel) and `STAGE_FOR_PUBLISH`.
  - Images: 1024 px, one forced-JSON Haiku call. Videos: 4 keyframes.
  - Names come only from visible text or folder paths, never from faces.
  - Cache key sha256+prompt+model. Cost ledger.
  - Local server `127.0.0.1:8777` serves `/health`, `/thumbs/<sha>.jpg`, `/media/<sha>` (CORS: localhost + hitloop.agency).
  - No new packages (ffmpeg + fetch).
- **HITLOOP:**
  - `features/x-content-inventory/nas.js`.
  - Worker routes `nas/results` (→ `nas-<sha16>` packages, bucket `nas`) and `nas/upload-url` (→ `publish-staging/nas/…`).
  - The heartbeat route persists capabilities and localThumbBase.
  - Card actions: `nas-status` / `browse` / `estimate` / `process` / `jobs` / `cancel` / `stage`.
  - UI: a Source panel per bucket (`NasPanel`, `SourcePanel`). NAS tiles show the local thumb, or a summary when offline.
- **Local testing:** run the analyzer with `HITLOOP_ARCHIVE_CONTROL_URL=http://localhost:3002`; the assetManager `.env.local` points at :3000, which runs the old code. Verified: heartbeat lands with capabilities and 2 sources.
- **Later:** local face grouping (needs a library install, owner approval) and calendar placeholders for NAS items.

## 5a. Cross-bucket search = the manual version of the daily signal match (owner, 2026-10-06)

One search box spans every bucket and every metadata field, with results grouped by bucket. Searching "glenn underground" must return the records he made or is credited on, any mix of his, and any NAS flyer or photo that names him. That is the same match the daily X scan (§6) will run automatically.

- **Facets:** facets now include `credits` (Discogs extraartists + per-track artists/credits) and `catalogNumbers`. `people:` searches count credits as people. Legacy `entities` are searched too.
- **Discogs:** all 17 records are backfilled from the Discogs API with labels, credits, catalog numbers, genres/styles and year (Discogs year 0 = unknown, dropped). The unauthenticated rate limit is 25/min; `DISCOGS_TOKEN` raises it. The worker handoff should also send `extraartists` and track credits for new records.
- **NAS (P3) requirement:** extraction must fill the same facet names (people, credits, labels, venues, partyNames, eraYear, gear, genres) so flyers and photos land in the same search.
- **Rendered Videos:** only DJ + mix title today. Tracklists or credits per mix would let "glenn underground" find mixes that contain his tracks.

## 5b. Thumbnail requirement (owner, 2026-10-06; applies to every source)

Every item the system holds, schedules or references must have a **low-res thumbnail made at creation or analysis time**, so the Buckets grid, Calendar and Today view can show content without ever loading full media.

- **Spec:** 320 px long edge, JPEG/WebP at quality ~70, ~15–30 KB. Stored at a predictable path `thumbs/<itemId>.jpg`. The package carries a `thumbRef` field.
- **Delivery:** thumbs live in a read-only, long-cached path. Alternatively one batch action signs many at once (`media-urls {ids[]}`), never one call per tile. The grid loads only thumbs, lazily on scroll. Full video or image loads only in the item drawer.
- **Per source:**
  - **Discogs:** the worker already renders a 1:1 label image, so it emits the 320 px thumb in the same step. This is a handoff to the Discogs thread. A HITLOOP backfill generates thumbs for the existing records from `image-1x1.jpg`.
  - **Rendered Videos:** the poster script also writes the 320 px thumb. New renders get a thumb from the EditVideos worker at render time (worker-repo change, deployed by push, owner OK). The 814 existing renders are backfilled once.
  - **NAS Archive:** extraction already downscales each item to 1024 px for vision. It saves the 320 px thumb from that same read, for no extra cost. Video gets its first keyframe.
  - **Ideas:** a thumb whenever an asset is attached. Without one, a typed placeholder.
- **Rule:** an item without `thumbRef` is flagged "needs thumb" in the grid. Ingest/analysis steps must not mark an item ready without one.

## 6. Daily signal loop (elevating what exists)

```
06:30 local  bird scans (free): quote targets + NEW bird search over top facet terms + follow list
12:35 cron   Scout / watchlist (existing; paid X search only where already gated)
      ↓
signal-match.js (pure, no LLM)
  normalize signals → extract entities via alias table + facet lexicon
  → match against bucket items (people/labels/venues/gear/genres/era/occasion)
  → score = signal heat (velocity, ageHours, follow-list weight) × match strength × item readiness × goal weight
  → occasion detection: repeated phrases/hashtags across signals ("909 day", "bandcamp friday") + a small seed lexicon
      ↓
suggestions → Signals tab + inline in Today ("why now" links the source post)
      ↓  owner: Add to today
planner: opportunity slot (max 1–2/day) preempts the lowest-priority evergreen item, within spacing + caps
```

- **Follow list = the source of truth for "the ecosystem"** (owner decision §9: accounts @bai_ee follows, read free via bird, or `marketingBriefConfig.kols`).
- **Paid X search** runs only on existing gates (Generate & Send / Refresh Now). Nothing new spends automatically.
- **Drafting copy** for a suggestion is a paid model call made only when you click **Draft**.

## 7. Planner balance

- **Long timeframe:** goal weights (growth vs inbound) plus active focus campaigns tilt bucket shares.
- **Short timeframe:** opportunity slots driven by signals and occasions.
- **Floor:** the existing rules stay. About 4/day (cap 6), ≥120 min apart, record cap 40%, identity floor, entity cooldowns.
- **Feedback:** once a bucket has n ≥ 5 measured posts, Results feed bucket weights. Below that, buckets show "insufficient data" and weights are unchanged.

## 8. Advisor chat (advise-only)

- **Context:** today's plan, signals with matches, bucket stats, goals and recent performance, sent as a compact summary rather than raw dumps.
- **Model:** Sonnet, instrumented through `logAnthropicCall`. Estimated ~$0.01–0.03 per message.
- **No write tools.** It can say "move X to 19:00"; you click the change yourself.

## 9. Owner decisions (locked 2026-10-06)

1. **Follow list = both merged:** the accounts @bai_ee follows (free via bird) plus the curated Market Signals `kols`, with curated accounts weighted higher.
2. **Daily-email random renders:** included in Rendered Videos, tagged `auto-daily` (filterable/hideable).
3. **NAS extraction: not yet.** Build the catalog, schema and search first. The extraction run (sample → full) waits for a later explicit go-ahead.
4. **Opportunity slots:** up to 2 per day may preempt evergreen, still within the 6/day cap and spacing.
5. *Still open:* the existing engines become the first buckets (Discogs Records, Rendered Videos, Ideas), and identity stays as the "your takes" floor. This is assumed unless the owner objects.

## 10. Phases (parallel Sonnet agents, stop for approval after each)

| Phase | Scope | Parallel agents |
|---|---|---|
| **P0** | Finish the current branch: local test drive → fixes → commit/merge/deploy (owner) | — |
| **P1 Buckets** | Bucket + folder data model, engines → buckets migration (compatible), facets v1 schema + aliases, Buckets tab (rail, folders, grid, item drawer) | 3: model+migration · smart folders/search index · UI |
| **P2 Sources** | Rendered Videos adapter + posters + re-sign · Discogs facets · Ideas into buckets | 2–3 |
| **P2b Thumbnails** (next pass) | §5b. `thumbRef` field, 320 px thumbs for Discogs (backfill + worker handoff) and Rendered Videos (backfill + EditVideos worker change), batch `media-urls` action, grid uses thumbs only, "needs thumb" flag | 2–3 |
| **P3 NAS catalog** | Extraction worker (vision, keyframes, cache, ledger) on the Mac → 200-item sample → **owner review + spend OK** → full run; catalog + search | 2: worker · catalog/search UI |
| **P4 Signals** | `signal-match.js`, occasion detection, free bird search + follow-list scan, Signals tab | 3: matcher · scans · UI |
| **P5 Today** | Today view + post drawer actions (edit / approve / schedule / post-now confirm / drafts / delete), opportunity slots, goals panel | 2–3 |
| **P6 Advisor** | Advise-only chat with plan context, cost-logged | 1 |
| **P7 Feedback** | Results → bucket weights, alias growth from confirmed matches | 1–2 |

Guardrails for every phase: no X writes except your own click on Post now, no paid scans beyond the existing gates, no deploy/commit without approval, no `DashboardPage.jsx` edits, and new UI only inside the Content Engine card.
