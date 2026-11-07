# Life Timeline — HITLOOP contract (FROZEN v1)

Personal, owner-only photo/video timeline. Plan: `docs/plans/LIFE-TIMELINE-PHOTO-LIBRARY-PLAN.md` (untracked, main checkout).
Worker side: assetManager `docs/archive/PHOTOLIB.md` + `lib/photolib/types.ts` (`LifeItem` there == §LifeItem here).

## Scope rules
- Personal scope. Never read/written by the content agent, calendar fill, Brain, MCP, digest, `x_content_packages`, `timeline_entries`, buckets.
- Server-only: Firestore `life_*` collections have no client rule (default deny); `firestore.rules` gets an explicit deny block (NOT deployed in v1).
- Every media URL handed to the browser is a short-lived V4 **signed read URL** (TTL 60 min). Never download-token URLs, never public objects.
- v1 serves Storage thumbnails only (`s` 320px, `m` 1600px JPEG; videos = poster). No originals, no tunnel.

## Storage
`life-thumbs/<id>_s.jpg`, `life-thumbs/<id>_m.jpg` (default bucket). `id` = first 16 hex of sha256.

## Firestore
### `life_media/{id}` (schema `life.media/1`)
```
{ schema:'life.media/1', id, sha256, kind:'image'|'video', ext, width, height, durationSec,
  takenLocal:'YYYY-MM-DDTHH:MM:SS'|null, tz:'±HH:MM'|null, tsUtc:ISO|null,
  tsSource:'library-db'|'exif'|'quicktime'|null, tsKind:'exact'|'local-only'|'unknown',
  ym:'YYYY-MM'|'unknown', day:'YYYY-MM-DD'|null,
  gps:{lat,lon}|null, albums:string[], favorite, hidden, title, description, keywords:string[],
  camera:{make,model}|null, motion:{sha256,durationSec}|null, edited:{sha256}|null,
  thumbs:{s:storagePath, m:storagePath}|null, canonicalPath,
  locations:[{sourceId, relativePath, originalFileName}], sourceIds:string[],
  createdAt:ISO, updatedAt:ISO }
```
Upsert merges `locations` (dedupe sourceId+relativePath), `sourceIds` (union), `albums` (union); everything else = latest push.

### `life_months/{ym}` — one read per month for the scrubber/grid
```
{ ym, count, partCount, items:[MonthEntry] (part 0), updatedAt }
MonthEntry = { id, t: takenLocal|null, k:'i'|'v', w, h, m:boolean /*has motion*/, d:durationSec|null }
```
Items sorted by `t` asc then `id`. More than 1,500 items → `partCount>1`, parts 1..n in `life_month_parts/{ym}_{n}` = `{ ym, part, items }`.
`ym:'unknown'` holds undated items (`t:null`). Month packs are rebuilt from `life_media where ym == X` after each ingest (idempotent).

### `life_sources/{sourceId}`
`{ id, kind:'photos'|'iphoto'|'folder', label, libraryPath /*share-relative*/, itemCount, lastPushAt }` (itemCount recomputed on push = count of life_media with sourceIds array-contains id).

## LifeItem (push item; validated by `schema.js sanitizeLifeItem`)
Fields = `life_media` minus `{schema, ym, day, sourceIds, createdAt, updatedAt}`. Validation: `sha256` 64 lowercase hex; `id === sha256.slice(0,16)`; kind in enum; strings trimmed + capped (title 300, description 2000, album/keyword 200 each, ≤100 albums, ≤200 keywords, ≤50 locations); `takenLocal` matches `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$` or null; `tz` `^[+-]\d{2}:\d{2}$` or null; gps in range; `thumbs` paths must equal `life-thumbs/<id>_s.jpg` / `_m.jpg`; `canonicalPath` must start `HITLOOP-ARCHIVE/timeline/` and contain no `..`; `relativePath`s no leading `/`, no `..`, no `/Volumes`. Invalid item → skipped with reason, others proceed.

## Worker routes (worker token: `workerAuthStatus` from `features/discogs-ingest/service.js`; 503 if unset, 401 if wrong)
- `POST /api/archive/worker/life/upload-urls` body `{ items:[{ sha256, variant:'s'|'m', contentType:'image/jpeg', sizeBytes }] }` (1..200, size 1..10 MB) → `{ urls:[{ sha256, variant, storagePath, uploadUrl, headers:{'content-type':'image/jpeg'} }] }` (V4 write, 15 min; lowercase header key — see nas.js comment).
- `POST /api/archive/worker/life/results` body `{ source:{id,kind,label,libraryPath}, items:LifeItem[1..100] }` → `{ ok:true, upserted, skipped:[{id,reason}], months:[ym…] }`. Upserts `life_media`, rebuilds touched `life_months`, upserts `life_sources`.

## Owner routes (`app/api/life/*`, `no-store`)
Gate: `verifyRequestUser` (Firebase ID token) AND `decoded.uid` in env `LIFE_OWNER_UIDS` (comma list). Env unset → 503 `{error:'Life timeline not configured'}`; not owner → 403. Never falls back to admins.
- `GET /api/life/months` → `{ months:[{ym,count}] (asc, excludes 'unknown'), unknownCount, total }`.
- `GET /api/life/month?ym=YYYY-MM|unknown` → `{ ym, items:[{ id, t, k, w, h, m, d, thumbUrl }], expiresAt }` (thumbUrl = signed `_s`; items without thumbs get `thumbUrl:null`).
- `GET /api/life/item?id=<sha16>` → `{ item: life_media doc minus canonicalPath, previewUrl (signed _m)|null, thumbUrl|null, expiresAt }`; 404 if missing.

## Code layout
`features/life-timeline/{schema.js (pure: sanitizeLifeItem, monthKey, buildMonthPacks, MONTH_PART_MAX=1500), store.js (Firestore via api/_lib firebase-admin; deps injectable), ingest.js (ingestLifeResults(deps, body)), signed.js (signReadUrl/signUploadUrl, injectable), owner-auth.js (requireLifeOwner), __tests__/*.test.js}` — ESM `.js` like `features/social-archive`. Tests use fakes only (no Firebase).
P4 page: `app/dashboard/life/page.jsx` (owner-only bare validation view; ids kebab-case; theme tokens only).
