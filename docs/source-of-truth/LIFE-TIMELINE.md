# Life Timeline (personal photo timeline) — source of truth

Private, **owner-only** timeline of every photo/video by capture date. v1 = Apple Photos library on the NAS → dated copies on the NAS + cloud thumbnails/previews + a bare validation view. Plan + owner decisions: `docs/plans/LIFE-TIMELINE-PHOTO-LIBRARY-PLAN.md` (untracked). Contract: `features/life-timeline/CONTRACT.md`. Worker side: assetManager `docs/archive/PHOTOLIB.md`.

## Scope rules
- Personal scope: never read by the content agent, calendar fill, Brain, MCP, digest, `x_content_packages`, `timeline_entries` or buckets.
- Server-only data: `life_media`, `life_months`, `life_month_parts`, `life_sources` (explicit deny in `firestore.rules` — **not deployed yet**; collections have no client rule, so they are denied either way).
- Browser only ever gets V4 **signed** read URLs (60 min) for `life-thumbs/<id>_{s,m}.jpg`. No download tokens, no originals, no tunnel in v1 (deferred).

## Flow
1. Mac worker (assetManager, `npm run photolib -- apply --library <bundle>`) reads the library DB from a temp copy, hashes each original, copies it once to `HITLOOP-ARCHIVE/timeline/YYYY/MM/YYYY-MM-DD_HHMMSS_<sha8>.<ext>` (+ `_motion.mov` Live Photo halves, `_edited.*` renders, sidecar `_meta/<sha256>.json`), journaled and undoable.
2. `npm run photolib -- thumbs` → JPEG 320/1600 px in `~/.photolib/thumbs/` (JPEG, not WebP: no WebP encoder on the Mac).
3. `npm run photolib -- push --library <bundle>` → `POST /api/archive/worker/life/upload-urls` (signed PUTs) → `POST /api/archive/worker/life/results` → `life_media` upsert + month packs rebuilt.
4. Owner opens `/dashboard/life` → `GET /api/life/months|month|item`.

## Routes
- Worker (bearer `HITLOOP_ARCHIVE_WORKER_TOKEN`): `app/api/archive/worker/life/{upload-urls,results}`.
- Owner: `app/api/life/{months,month,item}` — Firebase ID token AND uid in env **`LIFE_OWNER_UIDS`** (503 when unset — fail closed, no admin fallback).
- Handlers: `features/life-timeline/http.js`; pure logic `schema.js`; Firestore `store.js`; signing `signed.js`; gate `owner-auth.js`.

## Env (not yet set in Vercel — no deploy in v1)
`LIFE_OWNER_UIDS` (owner uid), plus the existing `HITLOOP_ARCHIVE_WORKER_TOKEN` and Firebase admin vars.

## Dates
Bucketed by **local capture time** (`takenLocal`), never UTC or file mtime. Library `imageDate` is a UTC instant; local = + `imageTimeZoneOffsetSeconds`; LMT-style offsets (e.g. -05:59) are rounded to 15 min for `tz`/`tsUtc` while keeping the wall clock.

## Tests
`node --test features/life-timeline/__tests__/*.test.js` (fakes only).
