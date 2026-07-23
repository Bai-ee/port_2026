# Video Remix ⇄ EditVideos Bridge — as-built source of truth

Status: **SHIPPED** (2026-06-24), proven end-to-end on `hitloop.agency`.
Render-behavior additions (2026-07-01): 5 new filter looks, "None"=truly-nothing logos, pinned
(deterministic) audio, bigger end logo, and a full set-vs-rendered settings snapshot on the card —
all in [§ Render behavior](#render-behavior--filters-logos-audio-layout-editvideos-worker).
Media Library workspace (2026-07-16): the `media-library` card split off into its own
management-only two-pane workspace (move/rename/delete folders, multi-select, drag-and-drop,
upload) backed by a new `media_assets` Firestore index + client-captured poster thumbnails — see
[§ Media Library workspace](#media-library-workspace-index--posters). `video-remix` keeps its
existing build UI unchanged; it only gained the poster thumbnail fix.
Supersedes the implementation sections of [`docs/plans/EDITVIDEOS_TO_HITLOOP_CARDS_PLAN.md`](../plans/EDITVIDEOS_TO_HITLOOP_CARDS_PLAN.md) — that plan is historical; this doc is the truth.

## What it is

The **Video Remix** Deliverables card generates short branded videos (720×720, 30s, MP4) from
EditVideos source media + Arweave audio. It does **not** run FFmpeg in Hitloop. It reuses the
already-deployed **EditVideos render pipeline** (a GitHub Action that renders every job) and
surfaces the result back in the Hitloop dashboard.

> Key decision: **reuse the live EditVideos pipeline, don't port FFmpeg.** Source media and output
> both stay in the EditVideos Firebase project (`editvideos-63486`). Hitloop only writes job
> metadata + reads the result URL. The standalone `services/media-render/` worker (Phase 0) is
> **shelved** for a future client-scoped/multi-tenant path and is NOT used in production.

## End-to-end flow

```
Card "RUN REMIX" (or REMIX tab → Generate)
  → runVideoRemix() (DashboardPage.jsx) → POST /api/dashboard/media?action=create-video-remix
      • createMediaJob()           → media_jobs/{jobId}        (Hitloop Firestore — card state)
      • enqueueVideoJob(recipe)    → videoJobs/{editJobId}     (EditVideos Firestore — exact EV schema)
      • setMediaJobEditRef(jobId, editJobId)                   (join key)
      • triggerWorker()            → repository_dispatch to the EditVideos GitHub Action
      • dashboard_state.mediaVideoPending = {...}              (card shows "Queued…")
  → LIVE EditVideos GitHub Action renders (UNTOUCHED) → uploads MP4 → videoJobs.status='completed' + videoUrl
  → reconcileMediaJob() (on job poll / on dashboard load / daily cron)
      • reads videoJobs status via getVideoJob(editJobId)
      • on 'completed': append video_remix capture → dashboard_state.mediaCaptures,
        clear mediaVideoPending, completeMediaJob(jobId)
      • on 'failed': failMediaJob(jobId)
  → Card shell + Details modal play the latest video (latestRemixVideoUrl) with native controls.

SOURCE MEDIA tab (Video Remix modal)
  → GET /api/dashboard/media?action=folders&withCounts=1
      • listSourceFoldersWithCounts() scans the EditVideos bucket and returns folder cards/counts
  → GET /api/dashboard/media?action=folder-files&folder=...
      • listFolderMedia() returns signed one-hour preview URLs for media in that folder
  → POST /api/dashboard/media?action=create-upload-session
      • createUploadSession() validates folder/files and returns short-lived signed PUT URLs
  → Browser uploads files directly to the EditVideos bucket (no file bytes through Vercel)
  → POST /api/dashboard/media?action=complete-upload clears the folder cache
  → Uploaded folder is selected in the REMIX tab's `sourceFolders`.
```

## Daily email video recipe

The daily email does **not** use the Video Remix UI/card params. The morning cron calls
`app/api/worker/pre-digest-video/route.js`, which owns a code-only production recipe named
`hitloop-daily-email-v1`.

Current locked daily-email recipe:

- Random artist + random mix from live EditVideos artist options.
- Strict source folder: `skyline` only.
- Six explicit skyline clips are randomly selected and pinned into `videoOrder` before enqueueing.
  This avoids folder-only random renders that can become visually static after ~15s.
  Selection is the **shared** `api/_lib/media-clip-selector.cjs` (see § Clip selection below) —
  the card path uses the same module, so no queue path falls back to the worker's own pick.
- Filter: `look_hard_bw_street_doc` at `0.8`.
- Top logo: `ue_barcode_white.png`.
- End logo: `mixtapes_white_square.png`.
- `useArtistImage: false`; the EditVideos worker treats artist image as a full 5s segment, not
  a single last frame.

Changing the daily email look should start in `DAILY_EMAIL_VIDEO_PRODUCTION` in that worker, not
in the dashboard Video Remix UI.

## Clip selection — shared, randomized, anti-repeating (2026-07-20)

`api/_lib/media-clip-selector.cjs` is the ONE selector for every queue path. It filters to videos
at/above a size floor, puts clips **not used by the last N renders first** (shuffled), lets recently
used clips fill only leftover slots, and pins the result as an explicit `videoOrder`.

- **Daily email** (`pre-digest-video`): `antiRepeatLookback: 3`, `minSizeBytes: 5MB`. An unfillable
  folder is **fatal** (reported) — better than silently shipping a folder-only recipe.
- **Card** (`create-video-remix`): when the caller sends **one folder and no manual clip order**, the
  route auto-pins a randomized order (lookback 3). An explicit `videoOrder` is always respected;
  multi-folder recipes are left to the worker (`validateRemixRecipe` rejects `videoOrder` unless
  there is exactly one folder). A folder too small to fill 6 segments falls through to the worker's
  own pick rather than failing the render.
- ⚠️ **Why this matters:** the EditVideos worker's own clip pick is effectively **deterministic**
  (same root cause as the pinned-audio behavior). Any path that omits `videoOrder` can therefore
  render the same footage twice. Do not add a queue path that skips this selector.
- ⚠️ Anti-repeat memory reads `media_jobs.recipeFull.videoOrder` **filtered to the same folder** —
  jobs enqueued without a `videoOrder` contribute nothing. A failed Firestore read degrades to a
  plain shuffle (still random), never throws.
- ⚠️ `listFolderMedia` hard-clamps to **120 files** (`safeLimit = Math.min(120, …)`), slicing
  bucket-lexicographic order. skyline is at 112 objects — past 120 the tail becomes permanently
  unpickable. Paginate before folders grow further.
- Tests: `api/_lib/__tests__/media-clip-selector.test.js` (rng injected for determinism).

## Files (Hitloop)

| File | Role |
|---|---|
| `api/_lib/media-jobs.cjs` | `media_jobs` queue (lease/retry/orphan-reclaim, mirrors `studio-render-jobs.cjs`). `createMediaJob`, `getMediaJob`, `listMediaJobs`, `setMediaJobEditRef`, `listInFlightMediaJobs`, `completeMediaJob`, `failMediaJob`. |
| `api/_lib/editvideos-bridge.cjs` | Named 2nd firebase-admin app `editvideos`. `mapRecipeToVideoJob`, `enqueueVideoJob`, `triggerWorker`, `getVideoJob`, `listSourceFolders`, `listSourceFoldersWithCounts`, `listFolderMedia`, `signReadUrl`, `createUploadSession`, `listOptions` (artists/mixes/filters/overlays/logos, 60s cache), `moveSourceFiles`, `renameSourceFolder`, `deleteSourceFolder`, `listAllSourceFileRows`. |
| `api/_lib/media-assets.cjs` | `media_assets` Firestore index (global, mirrors the bucket). `assetDocId`/`posterPathForSource` (pure), `upsertAssets`, `removeAssets`, `moveAssetDocs`, `ensureFolderDoc`/`removeFolderDoc`, `listIndexFolders`, `listIndexFolderFiles`, `syncIndexFromBucket`. See [§ Media Library workspace](#media-library-workspace-index--posters). |
| `api/_lib/media-recipe.cjs` | `validateRemixRecipe` + folder allowlist (`sanitizeFolderName`). Output locked 720/30/30. Allows safe two-segment existing EV folders such as `assets/retro_dust`; new upload folders stay flat. |
| `api/_lib/media-reconcile.cjs` | `reconcileMediaJob(job, clientId)` — EditVideos → Hitloop. |
| `app/api/dashboard/media/route.js` | Metadata-only route. Actions: `create-video-remix`, `job` (reconciles), `jobs`, `folders`, `folder-files`, `create-upload-session`, `complete-upload`, `options`, `media-index` (GET), `move-media`/`rename-folder`/`delete-folder`/`create-folder` (admin-gated POST). |
| `app/api/worker/media-reconcile/route.js` | Backstop sweep (worker-secret auth); also pingable by the EV Action. |
| `DashboardPage.jsx` | `video-remix` card (build UI, unchanged), `dashboard_state` listener (carries `mediaCaptures`/`mediaVideoPending`), `runVideoRemix`, REMIX params tab, SOURCE MEDIA upload tab, shell/modal `<video>` (`latestRemixVideoUrl`); imports `MediaThumb` for source-clip thumbnails. |
| `components/dashboard/MediaLibraryCard.jsx` | The `media-library` card's workspace UI (mount branch at the old shared `video-remix`/`media-library` guard). Exports `MediaThumb` (poster → video-first-frame → icon-tile fallback), consumed by both this card and `video-remix`. |
| `services/media-render/` | **Shelved** standalone FFmpeg worker (local fixtures only). Future client-scoped path. |
| `api/_lib/__tests__/{media-jobs,media-recipe,media-assets,editvideos-bridge}.test.js` | Unit tests (node:test + in-memory Firestore fake). Test glob includes `api/**/__tests__`. |

## Media Library workspace (index + posters)

The `media-library` card used to be a text-swap clone of the `video-remix` modal (same shared JSX,
one flag swapping two strings) — no move, no bulk move, no rename/delete folder, no multi-select.
It is now its own **management-only** two-pane workspace: folder rail (left) + file grid (right),
drag-and-drop move onto a folder, multi-select (click/shift-click) with a sticky selection bar as
the non-DnD/touch fallback, rename/delete folders, create an empty folder, and upload. It never
renders the clip-order row or "Use for Remix" — `video-remix` keeps that build UI, untouched,
in its own branch of the old shared guard (`DashboardPage.jsx` — search `media-library-modal-panel`
/ `activeTileModal.cardId === 'video-remix'`).

**Firestore index, bucket stays truth.** A folder was (and still is) just a GCS path prefix in the
shared EditVideos bucket — no folder record exists anywhere; today's flat folder scan
(`discoverSourceFolderDetails`) doesn't scale to "list this folder's files" or "does this empty
folder exist" without hitting the bucket every time. `media_assets` (a new, **global** — not
per-client, matching the bucket's own shared model — Firestore collection, `api/_lib/media-assets.cjs`)
mirrors bucket objects for fast listings/counts:

- Doc id = `assetDocId(fullPath)` = base64url of the full object path (idempotent upserts).
- Asset doc: `{ type:'asset', fullPath, folder, name, size, contentType, kind, posterPath, updated, syncedAt }`.
  **Stores paths, never signed URLs** (they expire in an hour) — the route signs `url`/`posterUrl`
  at read time (`signReadUrl` in the bridge) when returning `media-index`/`folder-files` rows.
- Folder doc (`folder:<name>`): represents a folder with **zero files** — folder listings are the
  union of asset-derived folders (counted) and folder-only docs (count 0). This is what makes empty
  folders possible for the first time.
- Mutations write the **bucket first** (source of truth), then reconcile the index; a bucket
  `file.move()` (library does copy+delete) is not transactional, so move/rename/delete-folder
  return per-file `{moved/deleted, failed}` results and an on-demand sweep
  (`GET media-index?sync=1`, or automatically when the index reads empty) heals any drift via
  `syncIndexFromBucket()` (diffs a fresh `listAllSourceFileRows()` bucket scan against the index).

**Posters.** First-frame JPEGs are captured **client-side** at upload (`captureVideoPoster` in
`MediaLibraryCard.jsx`: hidden `<video>` → seek ~0.1s → `<canvas>` → JPEG blob, max 480px wide,
q0.7, 3s timeout) — no server transcode. They live at the deterministic path
`.posters/<folder>/<fileName>.jpg` (`posterPathForSource`, appending `.jpg` to the full original
name, never swapping the extension). `.posters` is in `EXCLUDED_FOLDERS` and — like every
dot-prefixed bucket segment — was already excluded from folder discovery before this change.
`create-upload-session` mints a second signed PUT for the poster when the client asks for one
(`withPoster:true`, video files only); `complete-upload` records `posterPath` on the index doc.
Move/rename/delete carry the poster sibling along (best-effort, ignore-missing — legacy files have
none yet). `MediaThumb` (exported from `MediaLibraryCard.jsx`, imported by both cards) renders
`posterUrl` when present, else a best-effort `<video>` first frame, else an icon-tile fallback —
**never a black square**. Backfilling posters for existing `.mov`/HEVC files is deferred to a
server-side (FFmpeg, cross-repo) job — see `docs/plans/VIDEO-REMIX-MEDIA-PERF-PLAN.md`.

**Admin gating.** `move-media`/`rename-folder`/`delete-folder`/`create-folder` are admin-gated at
the route (`ADMIN_MEDIA_MUTATIONS`, same pattern as `delete-source-media`). `media-index` (GET) is
open to any authenticated user — a non-admin sees a read-only workspace (browse + preview only; the
UI hides upload/move/rename/delete controls via the `isAdmin` prop, it isn't only a backend gate).
Upload (`create-upload-session`/`complete-upload`) intentionally stays open to any client, same as
today's `video-remix` upload flow, which shares those two actions — gating them would have broken
`video-remix` uploads for non-admins.

## External (EditVideos) — DO NOT modify to ship Hitloop changes

- Project/bucket: `editvideos-63486` / `editvideos-63486.firebasestorage.app`.
- Repo: `Bai-ee/arweave-video-generator`; worker `.github/workflows/process-videos.yml` (cron `*/1` + `repository_dispatch` event `process-video-job`).
- Queue: `videoJobs/{id}` — `status: pending → completed|failed`, output in `videoUrl`.
- Source folders are **global/shared** at bucket root (`skyline`, `neighborhood`, …), not client-scoped.

## Join keys

- `media_jobs.jobId` (Hitloop) ⇄ `media_jobs.editJobId` == `videoJobs/{editJobId}` (EditVideos).
- `dashboard_state.mediaCaptures[].jobId` links a capture back to its `media_jobs` doc.
- Capture shape: `{ type:'video_remix', variant:'video', downloadUrl, durationSeconds:30, sourceFolders, jobId, editJobId, createdAt, createdWith }`. `createdWith` (added 2026-07-01, marked `full:true`) is the full settings snapshot rendered on the SAVED ASSETS card — see [§ Render behavior](#render-behavior--filters-logos-audio-layout-editvideos-worker).

## Recipe → videoJobs mapping (`mapRecipeToVideoJob`)

`artist` (null = random audio) · `mixTitle` · `useTrax` · `selectedFolders` · `duration:30` ·
`videoFilter` (filter.key) · `filterIntensity` (0–1, default 0.8) · `enableOverlay`+`overlayEffect` ·
`topLogo`/`endLogo` (logos.top/end) · `useArtistImage` · `endTextOverlay` (endCard.text) ·
`customEndMedia:null` · `videoOrder:null`.

Options for the params tab come from `listOptions()`: **14 filters** (9 original + 5 added
2026-07-01) + 6 overlays (static, mirror EV `VideoFilters.js`), artists+mixes (live from EV
`system/artists`), logos (live from EV bucket `logos/`). See [§ Render behavior](#render-behavior--filters-logos-audio-layout-editvideos-worker)
for the filter looks + how to add one.

## Render behavior — filters, logos, audio, layout (EditVideos worker)

⚠️ **How a video *looks* is decided in the EditVideos repo (`Bai-ee/arweave-video-generator`),
not Hitloop.** Color looks, overlays, logos, audio pick, text layers, and layout all live in
that repo's **worker**. Changing any of them = edit that repo and push it — the GitHub Action
renders from committed **`main`** HEAD on dispatch/cron, so **a push deploys the change but does
NOT itself trigger a render** (next enqueue/cron does). This is a nuance to the "DO NOT modify
EditVideos" rule above: that rule is about the **queue/schema** (don't fork the `videoJobs`
contract); the **render engine is where look/branding work happens** and is edited on purpose.

Worker files (EditVideos repo):

| File | Role |
|---|---|
| `worker/lib/VideoFilters.js` | `VIDEO_FILTERS` preset map (key → FFmpeg color chain) + `getFilter(key,intensity)`. |
| `worker/lib/ArweaveVideoGenerator.js` | Composites the frame: top logo, end logo, text overlay, artist image, layers. |
| `worker/lib/ArweaveAudioClient.js` | Selects the artist / mix / track audio. |
| `worker/processor.js` | Job entry — reads the `videoJobs` doc, calls the generator. Output locked 720×720/30s. |
| `.github/workflows/process-videos.yml` | The Action (cron `*/1` + `repository_dispatch`); **pins ffmpeg 6.1.3**. |

### Filter looks (14 as of 2026-07-01)

A look = an FFmpeg color chain in `VIDEO_FILTERS`. **To add one:** add a preset object in EV
`VideoFilters.js` + a matching `{key,label}` row in Hitloop `editvideos-bridge.cjs`
`FILTER_OPTIONS`; the params dropdown auto-renders from fetched `options.filters` (**no
`DashboardPage.jsx` edit**). Ship the EV preset **first** so the key resolves (else the worker
warns + falls back to B&W).

- 9 originals (gritty neon / faded tape / hard B&W / camcorder / club cinematic / neon / zine /
  pixel / sodium) **+ 5 added 2026-07-01:** `look_original` (**No Filter (Original)**),
  `look_bright_airy` (**Bright & Airy / Hawaii**), `look_crisp_enhance`, `look_golden_warm`,
  `look_vivid_pop`.
- ⚠️ **B&W trap:** a null/empty `videoFilter` makes `VideoCompositor` apply a **default black &
  white** (`hue=s=0`). "No Filter (original)" MUST be an explicit preset whose chain is
  **scale/pad only** — never map it to null.
- ⚠️ **Intensity doubles at 0.8:** Hitloop sends `filterIntensity:0.8`, and `applyFilterIntensity`
  scales `eq`/`saturation`/`brightness`/`noise`/`vignette` deltas by `intensity/0.4` (**2× at
  0.8**); `curves`/`colorbalance` are NOT scaled. Author looks to read right **at 0.8**.
- Build chains from production-proven primitives (`scale`/`pad`/`eq`/`curves`/`unsharp`) and
  **ffmpeg-dry-run each** (`ffmpeg -f lavfi -i testsrc=... -vf "<chain>" -frames:v 1 out.png`)
  before pushing.

### "None" means truly nothing (fixed 2026-07-01)

The worker was built to **always brand** videos, so UI "None" meant *default*, not *off*. As-built now:
- **Top logo None → skips the layer** (was: default `ue_barcode` logo — the barcode across the top).
  Guarded `if (logoToLoad)` in `ArweaveVideoGenerator.js`.
- **End logo None → already skips** (block gated `if (finalEndLogo && !endTextOverlay)`; the
  `ue_square` default branch is **dead code**). **Overlay None → already off** (`if (enableOverlay)`).
- ⚠️ **Still always-on** (out of scope by choice): the hardcoded **"Artist / Mix /
  UndergroundExistence.info" text overlay** (~L729). ⚠️ A **custom-but-not-found** top logo still
  falls back to the barcode (only "None" skips). ⚠️ `generateTextLayers` is **DEAD code** (never called).

### Audio pinned for repeatability (fixed 2026-07-01)

Unset artist/mix used to **random-pick each render** (the "inconsistent renders"). Now
`ArweaveAudioClient.js` `getArtistMix`/`getArtistTrax` pick the **FIRST** artist/mix/track
deterministically. ⚠️ The **in-track start offset** (`ArweaveAudioClient.js` ~L746) is **still
random** — same mix, different 30s slice; pin it separately if byte-identical audio is required.

### End logo size/placement (2026-07-01)

End-logo layer = **72% of frame width** (was 35%), **centered both axes**
(`ArweaveVideoGenerator.js`, end-logo block). Shared by all end logos (white/black variants).

### Set-vs-rendered: the settings snapshot on the SAVED ASSETS card (2026-07-01)

`media-reconcile.cjs` writes `capture.createdWith` (marked `full:true`) = the full validated-recipe
snapshot: filter+intensity, overlay, top/end logo, artist, mix, `useArtistImage`, end text, custom
audio, output size, duration, and the **manual clip filenames** (from `videoOrder`). The SAVED
ASSETS card (`DashboardPage.jsx`, `saved-remix-meta`) renders every set field for troubleshooting;
a **null field shows `auto`** (worker auto-picks — e.g. random logo/audio). Older captures (no
`full`) keep the legacy compact line. Auto-mode source clips aren't named (worker random-picks them;
only manual `videoOrder` names are known here).

### Revert anchors (git tags)

Each behavior change this session is one **isolated commit** — revert via `git revert <sha>`.
- **EditVideos repo:** `pre-video-filters-phase1` (before the 5 looks) · `pre-logo-audio-fix`
  (before top-logo None=skip + deterministic audio) · `pre-endlogo-size` (before end-logo resize).
- **Hitloop repo:** `pre-video-filters-phase1` (before the `FILTER_OPTIONS` rows). The
  `createdWith` snapshot shipped on `media-reconcile.cjs` (clean) + `DashboardPage.jsx`.

## Env vars (Hitloop — local `.env.local` + Vercel production)

```
EDITVIDEOS_FIREBASE_SERVICE_ACCOUNT_KEY   # EV service-account JSON (paste CLEAN, no trailing newline)
EDITVIDEOS_FIREBASE_BUCKET=editvideos-63486.firebasestorage.app
EDITVIDEOS_GITHUB_TOKEN                    # EV repo PAT with dispatch scope
EDITVIDEOS_GITHUB_REPO=Bai-ee/arweave-video-generator
```
Source of values: the EditVideos project (its `.env.local` / its own Vercel env). The route degrades
gracefully if absent (job queues, no render). Rotating these in EditVideos requires re-syncing here.

## Gotchas / hard-won lessons (read before changing anything)

1. **Always fire the dispatch trigger — and `await` it.** EditVideos' GitHub cron is throttled on
   free tier (observed **2h15m** between runs on 2026-07-20, despite `*/1` in the workflow).
   `triggerWorker()` (`repository_dispatch`) on enqueue is what makes a click render in ~1 min.
   Without it, jobs sit `pending` for hours.
   ⚠️ **Fixed 2026-07-20:** both call sites fired it **fire-and-forget**
   (`triggerWorker().then(…)`, unawaited). On Vercel the function instance can freeze the moment the
   response is returned, so the `fetch` to GitHub never landed — **zero `repository_dispatch` runs
   existed in the repo's entire history**; every job waited for the throttled `schedule` cron. For
   the daily email that meant the render missed the 13:00 send and the digest silently re-served
   *yesterday's* video. Both `pre-digest-video` and `dashboard/media` now `await` the dispatch.
   **Never make this call fire-and-forget again.** Verify with
   `gh run list --repo Bai-ee/arweave-video-generator` — healthy state shows `repository_dispatch`
   rows, not only `schedule`.
   `pre-digest-video` cron also moved `45 11` → **`0 6` UTC**: Vercel Hobby cron drift (~1h observed;
   scheduled 11:45 actually fired 12:42–13:00) left 0–18 min before the `0 13` send.
2. **Vercel Hobby cron = once/day max.** So reconcile is layered: poll-on-enqueue (live) +
   reconcile-on-job-GET (next dashboard load) + daily `/api/worker/media-reconcile` backstop. Do not
   assume per-minute cron.
3. **React `muted` prop re-mutes on every render.** The shell `<video>` sets `muted` ONCE via a
   stable module-scope ref (`initRemixShellVideo`) so a user un-mute via native controls sticks.
   Never pass a reactive `muted` prop to it.
4. **`--btns-only` cards are `pointer-events:none` on the body.** Video Remix has both footer buttons,
   so its shell video needs an explicit `pointer-events:auto` (see `dashboard.css`
   `.tile-intake-card--btns-only .tile-intake-placeholder-video-remix video`) or its native controls
   (volume/unmute) can't be clicked.
4b. ⚠️ **App-init order is load-bearing (found 2026-07-20).** `api/_lib/firebase-admin.cjs`
   `initAdminApp()` returns **`getApps()[0]`** — *whichever* firebase-admin app initialized first,
   not the default app by name. The bridge's named `editvideos` app is a second app in the same
   process, so **if the bridge initializes before the Hitloop app, `fb.adminDb` silently points at
   `editvideos-63486`** and `media_jobs` reads/writes cross projects (observed in a standalone
   script: `listMediaJobs` failed with a missing-index error naming the EV project). Production is
   safe today only because `verifyRequestUser` → `fb.adminAuth` runs at the top of every
   authenticated request, so Hitloop always wins the race. Any worker/script that touches the bridge
   before Hitloop must touch `fb.adminDb` first. The durable fix is to resolve the default app by
   name (`getApps().find((a) => a.name === '[DEFAULT]')`) — not yet done.
5. **EditVideos folders are global/shared**, not per-client. Fine for single-operator. True
   multi-tenant means un-shelving `services/media-render` + client-scoped source paths.
   The SOURCE MEDIA upload tab currently writes to those same global/shared folders.
6. **Capture lands even without the live listener.** `runVideoRemix` merges `job.output` into local
   state on poll-`done`, so the card flips to "Video ready" even under admin impersonation (listener
   off) or a cached bootstrap.
7. Generated MP4 carries an `aac` audio track; it's served from the EV bucket via a signed URL.
8. **Render look/branding lives in the EditVideos worker, not Hitloop.** Filter looks, logo/overlay
   "None"=off behavior, audio pick, and layout are edited in the EV repo and deployed by push — see
   [§ Render behavior](#render-behavior--filters-logos-audio-layout-editvideos-worker). Two traps
   worth pre-loading: a **null filter renders black & white** (not "original"), and **"None" used to
   mean "default branding"** (now fixed for logos, still true for the hardcoded UE.info text).

## How to extend

- **New recipe field:** add to `validateRemixRecipe` (sanitize) → `mapRecipeToVideoJob` (map to the EV
  `videoJobs` field) → REMIX tab control in `DashboardPage.jsx`. Verify the EV worker honors the field.
- **New action:** add a metadata-only branch in `app/api/dashboard/media/route.js` (no file bytes, no FFmpeg).
- **Upload media:** keep uploads direct-to-storage through `create-upload-session`; do not proxy video
  or image bytes through the dashboard route.
- **Multi-tenant / client-scoped media:** un-shelve `services/media-render`, add a `FirebaseMediaStore`,
  and move source folders under `clients/{clientId}/media/...` (the original plan's Phase 0/3).

## Verify

- `npm test` (includes `api/**/__tests__`) · `npm run build`.
- Live read sanity: a node script loading env via `@next/env` calling `editvideos-bridge.listSourceFolders()`/`listOptions()` proves cross-project auth without enqueuing a render.
