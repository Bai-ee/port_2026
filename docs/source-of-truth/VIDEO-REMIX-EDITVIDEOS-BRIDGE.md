# Video Remix ⇄ EditVideos Bridge — as-built source of truth

Status: **SHIPPED** (2026-06-24), proven end-to-end on `hitloop.agency`.
Render-behavior additions (2026-07-01): 5 new filter looks, "None"=truly-nothing logos, pinned
(deterministic) audio, bigger end logo, and a full set-vs-rendered settings snapshot on the card —
all in [§ Render behavior](#render-behavior--filters-logos-audio-layout-editvideos-worker).
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

## Files (Hitloop)

| File | Role |
|---|---|
| `api/_lib/media-jobs.cjs` | `media_jobs` queue (lease/retry/orphan-reclaim, mirrors `studio-render-jobs.cjs`). `createMediaJob`, `getMediaJob`, `listMediaJobs`, `setMediaJobEditRef`, `listInFlightMediaJobs`, `completeMediaJob`, `failMediaJob`. |
| `api/_lib/editvideos-bridge.cjs` | Named 2nd firebase-admin app `editvideos`. `mapRecipeToVideoJob`, `enqueueVideoJob`, `triggerWorker`, `getVideoJob`, `listSourceFolders`, `listSourceFoldersWithCounts`, `listFolderMedia`, `createUploadSession`, `listOptions` (artists/mixes/filters/overlays/logos, 60s cache). |
| `api/_lib/media-recipe.cjs` | `validateRemixRecipe` + folder allowlist (`sanitizeFolderName`). Output locked 720/30/30. Allows safe two-segment existing EV folders such as `assets/retro_dust`; new upload folders stay flat. |
| `api/_lib/media-reconcile.cjs` | `reconcileMediaJob(job, clientId)` — EditVideos → Hitloop. |
| `app/api/dashboard/media/route.js` | Metadata-only route. Actions: `create-video-remix`, `job` (reconciles), `jobs`, `folders`, `folder-files`, `create-upload-session`, `complete-upload`, `options`. |
| `app/api/worker/media-reconcile/route.js` | Backstop sweep (worker-secret auth); also pingable by the EV Action. |
| `DashboardPage.jsx` | `video-remix` card, `dashboard_state` listener (carries `mediaCaptures`/`mediaVideoPending`), `runVideoRemix`, REMIX params tab, SOURCE MEDIA upload tab, shell/modal `<video>` (`latestRemixVideoUrl`). |
| `services/media-render/` | **Shelved** standalone FFmpeg worker (local fixtures only). Future client-scoped path. |
| `api/_lib/__tests__/{media-jobs,media-recipe,editvideos-bridge}.test.js` | Unit tests (node:test + in-memory Firestore fake). Test glob includes `api/**/__tests__`. |

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

1. **Always fire the dispatch trigger.** EditVideos' GitHub cron is throttled on free tier (observed
   ~90 min stale). `triggerWorker()` (`repository_dispatch`) on enqueue is what makes a click render
   in ~1 min. Without it, jobs sit `pending`.
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
