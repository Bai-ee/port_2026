# Social archive timeline — module contract

Source plan: `docs/plans/LIVING-TIMELINE-ARCHIVE-PLAN.md`. This file is the **single source of truth for module APIs** so parallel work fits together. Read `schema.js` and `fs-reader.js` first (already written; do not change their exports).

Stack: Node ESM (`.js`), tests with `node:test` + `node:assert/strict`, run with
`node --test 'features/social-archive/__tests__/*.test.js'`. No new dependencies. No network calls. No Claude calls. Never write outside your own files.

## Principles (owner rules)
1. Timestamps carry KIND + SOURCE; file dates (mtime/download time) are forbidden. A photo's `posted` date is NOT its event/taken date.
2. Store only the owner's own words (≤ TEXT_MAX), no DMs, no other people's comments, no ads/device data. Adapters must only read an allowlist of archive paths.
3. Deterministic parsing only. Unmatched/unparsed things are COUNTED and reported, never guessed.
4. Idempotent: ids come from `entryId()`; re-importing changes nothing.
5. `audience` gates reuse; anything not `public` is never used as a voice exemplar.

## Raw entry (what adapters return; `sanitizeEntry` makes it a stored entry)
```
{ platform:'facebook'|'x'|'instagram', account:'Housepit CHI', platformId:'<stable id within the archive>',
  kind:'post'|'media'|'event'|'story'|'reel'|'comment', ts:'ISO UTC', tsKind:'posted'|'taken'|'event'|'created',
  tsSource:'facebook-posts-html'|'facebook-album-html'|'facebook-events-html'|'x-tweets-js'|'instagram-posts-json'|…,
  tsConfidence:'high'|'medium'|'low', text, album?, place?, permalink?, lang?,
  media:[{ type:'image'|'video', relPath:'photos_and_videos/<album>/<file>.jpg' /* POSIX, relative to ARCHIVE ROOT */, takenAt? }],
  peopleTagged?:[], relation?:{type:'reply'|'quote'|'repost'|'crosspost', targetId?}, engagement?:{likes,reposts,comments,views},
  audience?:'public'|'friends'|'only-me'|'unknown', source:{ archive:'<archive name>', file:'<file inside archive>', exportedAt? } }
```

## Adapters — `features/social-archive/adapters/{facebook,x,instagram}.js`
Each exports:
- `ADAPTER` (string id, e.g. `'facebook-html'`)
- `detect(reader) -> boolean` (true when the reader's root looks like that platform's export)
- `parse({ reader, account, archiveName }) -> { entries: RawEntry[], stats: {…counts…}, warnings: string[] }`
Pure given the reader. Tolerant of missing files and of format variants (see each adapter's notes). `stats` must include `entries`, `byKind`, `withMedia`, `skipped` (with reasons).
Convention: the archive root is the folder containing the platform's top-level dirs (`posts/`, `photos_and_videos/` for Facebook; `data/` for X; `content/` or `your_instagram_activity/` for Instagram).

## Matching — `features/social-archive/match.js`
- `matchEntries(entries, packages, { archiveRootRel }) -> { links:[{entryId, packageId, relPath}], unmatched:[{entryId, relPath}], stats:{media, matched, unmatched, entriesWithMatch} }`
- A package matches when `package.nas.relativePath` (source-root-relative) equals `${archiveRootRel}/${media.relPath}`; fall back to a case-insensitive and URL-decoded comparison; NEVER fuzzy-match by filename alone. A package is any object `{ id, nas:{ relativePath, sha256? } }`.

## Store — `features/social-archive/timeline-store.js` (first arg `db` = Firestore-like; use only `collection().doc().get/set`, `where('f','==',v)` chains, `limit`, `get`, `batch`; no range queries, no `arrayUnion`)
Collections: `timeline_entries` (doc id `${clientId}__${entry.id}`), `timeline_days` (doc id `${clientId}__${YYYY-MM-DD}`), `social_archives` (doc id `${clientId}__${platform}__${slug(account)}__${slug(archiveName)}`).
- `upsertEntries(db, clientId, entries) -> { written }` (merge; keeps existing `linked`; ≤400 per batch)
- `rebuildDays(db, clientId, days:string[]) -> { rebuilt }`: each day doc = `{ clientId, day, counts:{post,media,event,story,reel,comment}, platforms:{facebook:n,…}, total, snippets:[{id,platform,kind,text(≤90)}] (≤5), entryIds:[…≤200], updatedAt }`, recomputed from `timeline_entries where clientId==X and day==D`
- `getDay(db, clientId, day) -> { day, counts, platforms, total, entries:[stored entries sorted by ts] }`
- `listDays(db, clientId, { from, to, limit=400 }) -> [{ day, counts, platforms, total, snippets }]` ascending, built from per-date doc gets (cap the span at 800 days)
- `searchEntries(db, clientId, { q='', platform, account, from, to, limit=100 }) -> entries[]` (in-memory over `where clientId==`; case-insensitive substring over text/album/hashtags/mentions; newest first)
- `saveArchive(db, clientId, archive)` / `listArchives(db, clientId) -> archives[]` where archive = `{ platform, account, archiveName, adapter, adapterVersion, exportedAt?, entries, firstTs, lastTs, withMedia, matched, unmatched, ingestedAt }`
- `linkEntriesToPackages(db, clientId, links, entriesById) -> { packagesUpdated }`: for each `packageId`, read `x_content_packages/{packageId}` (skip if missing) and merge-set `{ post:{ platform, account, entryId, postedAt, day, text(≤300), album? }, postIds:[…union, ≤20], dates:[…union of {kind:'posted', date:'YYYY-MM-DD', source:'<tsSource>', platform}] }`; also write `linked:[packageIds]` onto each entry. Never overwrite `lastPostedAt`, status, story or any owner field.

## Ingest — `features/social-archive/ingest.js`
`ingestArchive({ db, clientId, platform, account, archiveName, reader, archiveRootRel, adapter?, packages?, dryRun=true, now? }) -> report`
Flow: detect → parse → `sanitizeEntry` each (count rejects by reason) → `matchEntries` (packages loaded via `loadNasPackages(db, clientId)` when not passed) → if `!dryRun`: upsert, link, rebuild affected days, save archive doc. Report: `{ platform, account, archiveName, dryRun, entries, rejected:{reason:n}, byKind, firstTs, lastTs, days, withMedia, media:{total,matched,unmatched}, unmatchedSample:[…10], warnings }`. **Dry run writes nothing, ever.**

## CLI — `scripts/social-archive/ingest.mjs`
`node scripts/social-archive/ingest.mjs --platform facebook --account "Housepit CHI" --dir "/Volumes/Public/Bryan/Facebook Downloads/facebook-HousepitCHI" --archive-root-rel "Facebook Downloads/facebook-HousepitCHI" [--client <id>] [--write]`. Default is dry run (prints the report). `--write` is the only way it writes. Env via `require('features/not-the-rug-brief/load-env')` (never `node --env-file`). `--client` defaults to the same default client the content engine scripts use.

## Voice + Brain — `features/social-archive/voice.js`
- `computeFingerprint(entries, { platform, account? }) -> { platform, sample, window:{from,to}, len:{median,p90}, caps, emoji, hashtags, links, questions, exclaims, lowerStartRate, topHashtags:[], topMentions:[], openers:[], signOffs:[] }` (only `audience==='public'`, `kind in post|story|reel`, non-empty text)
- `pickExemplars(entries, { platform, topic='', limit=5 }) -> entries[]` (public only; mix of representative-by-length and top engagement; topic filters by substring over text/hashtags/album when given; deterministic order)
- `timelineContext({ db, clientId, platform, topic, day, limit=4, maxChars=1800 }) -> string` ('' when nothing; never throws): a compact block: fingerprint line + exemplar posts (with date and kind) + (when `day`) that day's items. Facts are labelled **locked: do not change dates**.
- Wired into `features/client-brain/store.cjs` `loadClientBrainContext(clientId, opts)`: new optional `opts.platform` / `opts.topic`; ONLY when one is passed, append `timelineContext(...)` inside try/catch (any error ⇒ ignore). With neither option the function's behavior and output are byte-identical to today.

## Server + UI (content engine card)
Route `app/api/dashboard/quote-targets/route.js` (admin-gated like the existing actions) gains: `timeline-day {day}`, `timeline-days {from,to}`, `timeline-search {q,platform,account,from,to,limit}`, `timeline-archives {}`. Handlers live in `features/social-archive/actions.js` (`handleTimelineAction(deps, action, body)` → `{ ok, … }`, throws `{status}` errors like `features/x-content-inventory/nas.js`).
UI: new tab **Timeline** in `components/dashboard/XContentEngineCard.jsx` → `components/dashboard/x-content/TimelinePanel.jsx` (day picker/search box, chronological day list with counts and snippets, click a day for posts + media + flyers that day, archives imported list). `ItemDrawer.jsx` shows a **Posted copy** section when `item.post` exists (platform, date, album, caption, "other items from that day" link that runs the day search). `search-index.js` gains `day:YYYY-MM-DD` (matches `dates[]` of kind posted/event/taken plus `facets.eventDate`) and free-text over `post.text`. Package read paths must let `post`, `postIds`, `dates` through (check the normalizers used by the inventory list and bucket routes).
