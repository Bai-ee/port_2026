# Living Timeline Archive — plan (2026-10-08)

**Status (updated 2026-10-08):** P1 (Facebook adapter + day index + matcher + store + CLI + Timeline tab + `day:` search) and the X/Instagram adapters and voice/Brain hook (P2, P3, P6-core) are BUILT and tested; the Facebook Housepit CHI export is imported (1,381 entries, 1,061/1,064 media matched). See `docs/source-of-truth/SOCIAL-ARCHIVE-TIMELINE.md` for what exists. Still plan-only: P4 (EXIF/video dates), P5 polish, P7, Brain Content-library tab, other accounts. Stop for owner approval after every phase. No pushes, deploys or paid calls without an explicit OK.
**Elevation list entry:** see `ELEVATION-LIST.md` (#3).
**Related:** `BRAIN-CONTENT-RETRIEVAL-PARKED-IDEA.md` (Brain reads the library), `CONTENT-ENGINE-V2-MASTER-PLAN.md` (buckets, search), `assetManager/docs/archive/ANALYZER.md` (analysis, batch, event dates).

## 1. Objective

Turn the owner's social media archives (Facebook, X, Instagram) and raw media files into **one living, dated timeline** that can be:

1. **Searched by day** ("2018-11-15" → the flyer for that night, photos taken, posts made, videos in the library), by month, year, platform, person, venue.
2. **Queried like a brain** to learn tone and knowledge about the client, so every written output (social posts first, then replies, emails, briefs) is tailored per platform for likeness and for what the client actually knows and has done.
3. **Kept current** with new exports (merge, don't redo), **cheaply**: parse deterministically, store only what is needed, point to the raw files instead of copying them.

## 2. Principles (what keeps this simple)

- **Reuse the framework.** Packages, buckets, facets, `search-index`, `onThisDay`, the analyzer, `social_posts`, `x-content-guard`, `loadClientBrainContext`. New code is adapters and one index, not a new system.
- **Dates carry their kind.** `event` (printed on a flyer), `taken` (camera/EXIF/video container), `posted` (platform timestamp), `created` (our own records). Never merged into one field. File dates (mtime, download time) are **never used**.
- **Deterministic first, models last.** Parsing archives costs $0. Claude is used only where the owner already opted in (image analysis, batch mode at half price). Embeddings come later and are cheap.
- **Store extracted fields, not raw archives.** Raw archives stay on the NAS as the source of truth; the database holds a compact row per entry plus a path/hash back to the source.
- **Retrieval, not copying, into the Brain.** One-way, read-only (see the parked Brain doc).
- **Privacy by default.** No DMs. No other people's comments or content stored as the owner's. Audience (public / friends / only me) is recorded and gates reuse.

## 3. What exists today (verified)

| Piece | State |
|---|---|
| NAS analyzer (image/video facets, flyer text, batch mode, live price) | **BUILT**, local, running |
| Flyer event dates from printed text (weekday inference, month-day only) | **BUILT** |
| Bucket model, search (`date:`, people, venues), "On this day" view | **BUILT** |
| Facebook export on the NAS (`Public/Bryan/Facebook Downloads/…`) | HTML export: `photos_and_videos/album/*.html` (per-photo upload timestamps, album names), `events/events.html`, `posts/posts_1.html` |
| X: bird-CLI timeline import (~800 posts, free) | **BUILT** (`scripts/x-monitor/import-bird-timeline.mjs`), plus X Monitor card (metered sync, manual) |
| Client Brain consumers (9) via `loadClientBrainContext` | **BUILT**, read approved context only |
| Per-platform voice fingerprints, a unified day index, Instagram/Facebook/X-archive adapters | **NOT BUILT** |

## 4. Required metadata (the ingest contract)

Every timeline entry, whatever the platform:

| Field | Notes |
|---|---|
| `id`, `platform`, `platformId`, `permalink?` | `platformId` makes re-imports idempotent. |
| `account` | Which account (personal, Housepit CHI page, Secret Studio Records, @bai_ee, IG account…). |
| `kind` | `post` · `media` · `event` · `flyer` · `story` · `reel` · `comment-by-owner`. |
| `ts` (UTC) + `tsKind` + `tsSource` + `tsConfidence` | e.g. `posted` / `facebook-album-html` / `high`. |
| `text` | Owner's own words, trimmed (≤ ~600 chars stored; full text stays in the archive). |
| `mentions`, `hashtags`, `links`, `lang` | Extracted by rules. |
| `media[]` | `{type, relPath, sha256, w, h, durationSec?, takenAt?}`; joined to analyzer packages by hash. |
| `place?` | Check-in / tagged location text only. |
| `peopleTagged[]` | Names the platform recorded. **Never from faces** unless owner-confirmed. |
| `relation?` | reply-to / quote / repost / crosspost (X, IG). |
| `engagement?` + `capturedAt` | likes, reposts, comments, views when the archive has them. |
| `audience` | `public` / `friends` / `only-me` / `unknown`. Gates any reuse. |
| `source` | `{archiveName, file, exportedAt, adapterVersion}`. |
| `voice` (derived, small) | length, caps ratio, emoji count, hashtag count, link flag, opener pattern. Used for fingerprints; no model. |

**Skipped on purpose (efficiency + privacy):** direct messages, ads and off-platform activity, device and login data, other people's posts, reactions given.

## 5. Data model (one small addition)

- **`timeline_entries/{clientId}_{id}`** — the row above. Thousands of rows, each small.
- **`timeline_days/{clientId}_{YYYY-MM-DD}`** — one doc per day with counts per kind and the ids (and a few text snippets). "Search a day" is **one document read**; a month is a range query on the doc id. Updated whenever entries are added.
- **Media items stay in `x_content_packages`** (already there for NAS items). Timeline entries reference them by `packageId`; no duplication.
- **No raw archive stored in the database.** Raw files stay on the NAS.

## 6. Per-platform tailoring (likeness and knowledge)

- **Voice fingerprint per platform** (X, Instagram, Facebook): computed from the owner's own posts there, deterministically. Typical length, casing, punctuation, emoji, hashtag and link habits, openers and sign-offs, topics, how replies differ from originals.
- **Exemplar sets, not dumps:** a few representative and a few best-performing posts per platform and per topic (weighted by engagement where known) as few-shot examples. Selected by rules; the Brain gets 3–5 per request.
- **Knowledge:** the timeline answers "what has the client done/said about X, and when" (events, lineups, releases, photos) so a post can reference real history with a date and a confidence label.
- **How it plugs in:** `loadClientBrainContext(clientId, { topic, platform })` appends the matching fingerprint and exemplars. With no `platform`/`topic` it behaves exactly as today, so the nine consumers do not change.
- **Guard:** dates in drafts come from locked timeline facts and pass `features/x-content-guard`; month-and-day-only dates never become a specific year.

## 7. Phases (stop for approval after each)

**P0 — Inventory and formats ($0).** Read-only. Catalog what archives exist on the NAS (FB, X, IG) and what raw sources have true dates (`phone_backup`, `Photos Library.photoslibrary`, camera folders). Confirm each format against the real files. Owner action: request fresh exports in **JSON** where offered (Facebook and Instagram offer HTML or JSON; X ships `data/*.js`). Output: a one-page format table and a go/no-go per source.

**P1 — Facebook adapter + day index.** Parse album pages (album name, per-photo upload time), `events.html`, `posts_1.html`. Match photos on disk to entries (path + order), report **unmatched counts**, never guess. Write `timeline_entries` + `timeline_days`. Add `day:` / `month:` search and a day view. Cost $0.

**P2 — X adapter.** Parse the X archive (tweets, media, replies/quotes) and merge with the existing bird import by `platformId`. Engagement from the archive where present. Cost $0; no X API calls.

**P3 — Instagram adapter.** Parse posts, stories, reels, captions, tags, timestamps. Cost $0.

**P4 — Raw files.** Read EXIF and video-container dates from NAS files (free, local), join to posts by filename and hash, add `taken` dates. Unknown stays unknown and lands in the Unknown group and `unknown/` folder.

**P5 — Timeline view.** Buckets-tab view: earliest to latest, zoom year → month → day, Unknown at the end; click a day for flyers, photos, videos, posts. "On this day" reuses it.

**P6 — Brain retrieval + voice.** `searchContent` (read-only), Brain "Content library" tab, per-platform fingerprints and exemplars into `loadClientBrainContext`, Enhance integration with locked facts. Optional: embeddings for meaning-based search.

**P7 — Incremental updates.** New exports merge idempotently (`platformId`/hash), with a diff report ("312 new, 4 changed, 0 removed").

## 8. Cost

All parsing, matching, EXIF and voice features are **$0**. Image analysis continues at ~$0.0067 per file (≈$0.0033 in batch mode). Optional embeddings for several thousand posts are well under a dollar. No X API spend at any phase.

## 9. Risks

- **Export formats drift** (Facebook especially). Mitigation: P0 verifies against real files; adapters are versioned and report unmatched counts.
- **Posted ≠ taken ≠ event.** Mitigation: every date carries its kind; the UI shows the kind next to the date.
- **Matching photos to album entries is heuristic.** Mitigation: path + order + counts, unmatched list, no guessing.
- **Privacy / legal.** Own-account exports are fine to process locally. Do not store others' comments or DMs; keep `audience`; do not publish anything derived from `friends`/`only-me` content; face-derived names stay local and owner-confirmed (Illinois BIPA caution — not legal advice).
- **Voice drift.** Fingerprints are recomputed from recent posts and show their sample window.
- **Scope creep.** Each phase is independently useful and stoppable.

## 10. Success criteria

1. Search `2018-11-15` → the Thursday flyer (event), photos and posts from that day, grouped by date kind, in one response.
2. Open the timeline: earliest to latest item, Unknown group at the end, zero entries silently dropped (unmatched counts reported).
3. Ask for an Instagram caption about a past event: the Brain returns the platform's fingerprint plus 3–5 exemplars plus the locked event facts; the draft passes the content guard.
4. A new export imports with a diff report and creates no duplicates.

## 11. Open questions for the owner

1. Which accounts count (personal, Housepit CHI page, Secret Studio Records, Sounds From The Divide, @bai_ee, IG)? Which client owns each?
2. Do you have phone backups or camera folders on the NAS to include for true "taken" dates?
3. Time window to prioritize (e.g., 2015–2021 first)?
4. Default audience rule: only `public` content may be quoted in posts?
5. Can you re-request Facebook and Instagram exports in JSON?
