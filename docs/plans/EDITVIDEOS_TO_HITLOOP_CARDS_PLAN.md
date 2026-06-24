# EditVideos to Hitloop Dashboard Cards Plan

Date: 2026-06-24

> **STATUS: SHIPPED (Video Remix slice).** This plan is now **historical**. The as-built feature
> (queue + bridge + reconcile + card + params tab) is documented in the source of truth:
> [`docs/source-of-truth/VIDEO-REMIX-EDITVIDEOS-BRIDGE.md`](../source-of-truth/VIDEO-REMIX-EDITVIDEOS-BRIDGE.md).
> v1 reuses the **live EditVideos render pipeline** (Phase 5 revised) instead of self-hosting FFmpeg;
> `services/media-render` (Phase 0) is shelved. Read the SSOT before changing anything.

## Objective

Port the valuable parts of `/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator` into Hitloop as dashboard cards, without moving FFmpeg, large uploads, or Arweave upload work into Vercel request/response paths.

The target product outcome is a Deliverables workflow where a client can:

1. Upload or select existing video/image media.
2. Select Arweave-hosted audio or media.
3. Generate a short branded video from media folders, filters, overlays, logos, and end-card media.
4. Review status and generated assets in the Hitloop dashboard.
5. Optionally archive approved assets to Arweave.

## What EditVideos Actually Has

The EditVideos system is already split the right way for a free/Hobby-safe app:

- Frontend uploads media directly to Firebase Storage and only posts job metadata to the API. See `/Users/bballi/Documents/Repos/EditVideos/CLAUDE.md:43`.
- The Vercel API creates jobs and status/listing endpoints; it is not the primary render host. See `/Users/bballi/Documents/Repos/EditVideos/CLAUDE.md:45`.
- A GitHub Actions worker polls Firestore, processes one job at a time, runs FFmpeg, uploads the result, and updates status. See `/Users/bballi/Documents/Repos/EditVideos/CLAUDE.md:47`.
- Media folders are dynamically discovered from Firebase Storage; folder names are not hardcoded. See `/Users/bballi/Documents/Repos/EditVideos/CLAUDE.md:67`.
- Video generation creates a `videoJobs` doc with `selectedFolders`, `videoFilter`, `topLogo`, `endLogo`, `overlayEffect`, `useArtistImage`, `customEndMedia`, `endTextOverlay`, and optional `videoOrder`. See `/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator/api/generate-video.js:35`.
- The worker passes those fields to `ArweaveVideoGenerator`, renders 720x720 MP4, stores the file in Firebase Storage, and writes a signed URL back to Firestore. See `/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator/worker/processor.js:75` and `/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator/worker/processor.js:118`.

Feature inventory worth porting:

- Video generation from selected media folders plus Arweave audio, 5-second segments, filters, overlays, logos, and output to Firebase Storage. See `/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator/FEATURES.md:18`.
- Direct-to-Firebase video/image upload with new folder creation. See `/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator/FEATURES.md:110` and `/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator/FEATURES.md:275`.
- Folder discovery and folder preview. See `/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator/FEATURES.md:256` and `/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator/FEATURES.md:397`.
- Generated video list, polling, and status states. See `/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator/FEATURES.md:231`.
- Arweave archival upload and archive manifest. See `/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator/FEATURES.md:152`.
- Firebase usage indicators. See `/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator/FEATURES.md:322`.
- Filter, logo, overlay, and artist thumbnail/end-card controls. See `/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator/FEATURES.md:371`, `/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator/FEATURES.md:414`, `/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator/FEATURES.md:509`, and `/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator/FEATURES.md:544`.

Do not directly port the ArNS website deployment flow in v1. It is useful later as an "Archive Site to Arweave" admin deliverable, but it is coupled to Underground Existence artist pages and ArNS ownership.

## Hitloop Integration Points

Hitloop already has the correct card and worker model:

- Dashboard cards are governed by `NON_ADMIN_UNLOCKED_CARD_IDS` and `CAP_STEPS` in `DashboardPage.jsx`. Deliverables is currently the only open non-admin bucket. See `/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:2237` and `/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:2294`.
- Foundational modules live in `features/scout-intake/module-registry.js`. See `/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/module-registry.js:3`.
- The existing Video Promo card uses `/api/dashboard/studio-render` to enqueue a render job, not render inline. See `/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/dashboard/studio-render/route.js:75`.
- `render_jobs` has a lease, retry, and single-worker claim model that serializes GPU work. See `/Users/bballi/Documents/Repos/Bballi_Portfolio/api/_lib/studio-render-jobs.cjs:1`.
- The worker endpoint drains one job and re-triggers itself after success or retry. See `/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/worker/render-studio/route.js:72`.
- `studio-render-core.cjs` writes a normalized capture ref into `dashboard_state.studioCaptures`, which the existing `mockup-studio` and `post-me` cards read. See `/Users/bballi/Documents/Repos/Bballi_Portfolio/api/_lib/studio-render-core.cjs:27` and `/Users/bballi/Documents/Repos/Bballi_Portfolio/api/_lib/studio-render-core.cjs:204`.

The safest port is therefore not a new standalone app inside Hitloop. It should be a new `media_jobs` or generalized `render_jobs` family with card-specific job types, using the same queue, dashboard state, and asset ref conventions as Studio Render.

## Proposed Cards

### 1. Media Library

- Card id: `media-library`
- Bucket: `deliverables`; optionally cross-list into `content`
- Audience: client-visible, but only after upload/auth hardening
- Purpose: upload, organize, and preview source media folders
- EditVideos features: direct upload, new folder creation, dynamic folder discovery, folder preview
- Hitloop data:
  - `dashboard_state.mediaLibrary.folders[]`
  - `dashboard_state.mediaLibrary.recentUploads[]`
  - Firebase Storage paths under `clients/{clientId}/media/source/{folder}/...`
- API shape:
  - `GET /api/dashboard/media?action=folders`
  - `POST /api/dashboard/media?action=create-upload-session`
  - `GET /api/dashboard/media?action=folder-files&folder=...`
- Vercel rule: route returns signed/resumable upload metadata only. The browser uploads directly to Firebase Storage. No media bytes pass through Vercel.
- UI details:
  - Folder cards with file counts.
  - Upload modal with existing/new folder selector.
  - File type badges: video, image, audio, overlay, logo.
  - Client copy should use "Source Media" rather than the EditVideos "Upload Video" label because this will cover images, clips, logos, overlays, and future audio.

### 2. Video Remix

- Card id: `video-remix`
- Bucket: `deliverables`
- Audience: client-visible for run/review; advanced controls can be admin-only initially
- Purpose: generate a short branded video from uploaded media and Arweave media/audio
- EditVideos features: `generate-video`, folder selection, Arweave audio source, filters, overlays, top/end logos, artist-thumbnail/custom end media, video order
- Hitloop data:
  - Job docs in `media_jobs/{jobId}` with `type: 'video-remix'`
  - Output refs in `dashboard_state.mediaCaptures[]`
  - Optional rollup in `dashboard_state.videoRemix.latest`
- Output ref shape should match `studioCaptures` enough that the deliverable overlay and downloads can be reused:
  - `type: 'video_remix'`
  - `variant: 'video'`
  - `label`
  - `downloadUrl`
  - `storagePath`
  - `contentType`
  - `sizeBytes`
  - `durationSeconds`
  - `sourceFolders`
  - `arweaveSourceUrl`
  - `jobId`
- API shape:
  - `POST /api/dashboard/media?action=create-video-remix`
  - `GET /api/dashboard/media?action=job&jobId=...`
  - `GET /api/dashboard/media?action=jobs&type=video-remix`
- Worker:
  - New external FFmpeg worker, not a Vercel route render.
  - Reuse the EditVideos worker libraries after converting them from global bucket assumptions to `clientId`-scoped storage paths.
  - Process one job at a time in v1.
- UI details:
  - Card face shows latest generated remix, status, selected folders, duration, and action.
  - Details modal has folder picker, audio/Arweave source picker, filter, overlay, logo/end-card controls.
  - Non-admin click opens the full-screen deliverable overlay if a video exists.

### 3. Arweave Archive

- Card id: `arweave-archive`
- Bucket: `deliverables`, admin-only in v1
- Audience: admin first; client-visible only after wallet/cost policy is settled
- Purpose: permanently archive approved generated assets or source files to Arweave
- EditVideos features: `/api/archive-upload`, `archiveJobs`, `archiveManifest`
- Hitloop data:
  - `media_jobs/{jobId}` with `type: 'arweave-archive'`
  - `dashboard_state.arweaveArchive.manifest`
  - Per-asset metadata attached to `mediaCaptures[]` or `studioCaptures[]` as `arweaveUrl`, `transactionId`, `archivedAt`
- API shape:
  - `POST /api/dashboard/media?action=archive-to-arweave`
  - `GET /api/dashboard/media?action=archive-manifest`
- Vercel rule:
  - Prefer external worker for archive uploads if files are large.
  - Vercel can enqueue archive jobs and read manifests. It should not download a 100MB video from Firebase and upload it to Turbo inline.
- UI details:
  - Shows which deliverables are archived, pending confirmation, failed, or unarchived.
  - Shows estimated size/cost before enqueue.
  - Requires explicit confirmation because Arweave is permanent and wallet-funded.

### 4. Media Usage

- Card id: `media-usage`
- Bucket: `deliverables` for admins, or `services`/admin ops if visible later
- Audience: admin-only in v1
- Purpose: monitor Firebase Storage, Firestore reads/writes, job volume, and worker health
- EditVideos features: Firebase usage indicators and job status table
- Hitloop data:
  - `dashboard_state.mediaUsage` or an admin-only ops endpoint
  - `media_jobs` counts by status/type
  - Storage totals by client prefix
- API shape:
  - Add to existing ops overview if possible, rather than a new route.
  - If route needed, fold into `/api/dashboard/media?action=usage` or `/api/ops/overview`.
- UI details:
  - Storage used this month.
  - New uploads in last 24 hours.
  - Queued/rendering/failed jobs.
  - Last worker heartbeat.

### 5. Post Me Enhancement

- Existing card id: `post-me`
- Bucket: `deliverables`
- Purpose: let `post-me` consume either Studio Render video or Video Remix output
- Change:
  - Current `post-me` uses `studioCaptures` plus `siteMeta` and brief captions.
  - Add a source selector or priority chain:
    1. latest `video_remix` MP4
    2. latest `studio_video` MP4
    3. social preview image
- Vercel rule:
  - No API upload to X in v1. Keep the current X composer/download pattern unless paid API posting is explicitly added.

## Data Model

Add `media_jobs` rather than overloading `render_jobs` unless we intentionally generalize `render_jobs` to support multiple processors. A separate collection is cleaner because FFmpeg remix jobs have very different recipe shape, asset inputs, and output semantics than Studio Render GPU jobs.

Recommended job shape:

```js
{
  jobId,
  clientId,
  type: 'video-remix' | 'arweave-archive' | 'media-optimize',
  status: 'queued' | 'processing' | 'done' | 'failed',
  recipe: {
    durationSeconds: 30,
    output: { width: 720, height: 720, fps: 30, format: 'mp4' },
    sourceFolders: ['skyline', 'neighborhood'],
    sourceFiles: [],
    arweaveAudioUrl: null,
    arweaveMediaUrls: [],
    filter: { key: 'look_hard_bw_street_doc', intensity: 0.8 },
    overlay: { enabled: true, effect: 'retro_dust' },
    logos: { topStoragePath: null, endStoragePath: null },
    endCard: { mode: 'media' | 'text' | 'none', mediaPath: null, text: null },
    videoOrder: null
  },
  output: null,
  error: null,
  attempts: 0,
  workerLease: null,
  createdAt,
  updatedAt,
  startedAt: null,
  completedAt: null
}
```

Recommended `dashboard_state` additions:

```js
{
  mediaLibrary: {
    folders: [],
    recentUploads: [],
    updatedAt: ''
  },
  mediaCaptures: [
    {
      type: 'video_remix',
      variant: 'video',
      label: 'Video Remix',
      downloadUrl: '',
      storagePath: '',
      contentType: 'video/mp4',
      sizeBytes: 0,
      durationSeconds: 30,
      sourceFolders: [],
      arweaveSourceUrl: '',
      createdAt: '',
      jobId: ''
    }
  ],
  mediaVideoPending: {
    jobId,
    type: 'video-remix',
    queuedAt,
    sourceFolders: []
  },
  arweaveArchive: {
    manifest: {},
    lastArchivedAt: ''
  }
}
```

Keep generated asset refs scoped under:

- `clients/{clientId}/media/source/{folder}/{fileName}`
- `clients/{clientId}/media/generated/{jobId}.mp4`
- `clients/{clientId}/media/archive/{optionalManifestName}.json`

Do not reuse EditVideos top-level folder names like `videos/`, `skyline/`, `logos/` globally. In Hitloop, every path must be client-scoped.

## Worker Architecture

Recommended v1 worker:

- Location: `services/media-render/` or `workers/media-render/`
- Runtime: Node 20+ with FFmpeg available
- Trigger options:
  - Best: Cloud Run Job or Cloud Run service with min instances 0 and max concurrency 1.
  - Acceptable MVP: GitHub Actions workflow on dispatch + short cron, same as EditVideos.
  - Avoid: Vercel Function doing FFmpeg.
- Claiming:
  - Copy the lease pattern from `studio-render-jobs.cjs`.
  - Single queue lock for v1.
  - Max attempts 3-5 with backoff.
  - Orphan reclaim if worker dies.
- Processing:
  - Download selected Firebase media files to local temp.
  - Download Arweave URLs to local temp.
  - Build 5-second segments.
  - Compose 30-second 720x720 MP4.
  - Upload to Firebase Storage.
  - Append ref to `dashboard_state.mediaCaptures`.
  - Clear `mediaVideoPending`.
- FFmpeg:
  - Preserve the EditVideos pinned FFmpeg lesson. VFR iPhone `.mov` and `drawtext` need a full build.
  - Containerize FFmpeg in the worker image if using Cloud Run, so GitHub download availability is not a runtime risk.

## Vercel Free/Hobby Guardrails

Current Vercel docs matter here:

- Hobby deployments have a 100 MB static/source upload limit when deploying with the CLI, so large source media must never be committed or bundled. Vercel docs: <https://vercel.com/docs/limits#static-file-uploads>.
- Function request/response payloads are limited to 4.5 MB, so uploaded videos must go browser-to-storage, not browser-to-Vercel-to-storage. Vercel docs: <https://vercel.com/docs/functions/limitations#request-body-size>.
- Existing projects not using Fluid Compute have Hobby Function defaults/maximums around short request lifetimes, so FFmpeg and Arweave transfer work must stay out of Vercel Functions. Vercel docs: <https://vercel.com/docs/limits#vercel-functions>.
- Hitloop already uses Vercel cron for `/api/worker/render-studio`; avoid adding multiple cron-heavy routes unless necessary. See `/Users/bballi/Documents/Repos/Bballi_Portfolio/vercel.json:1`.

Concrete rules:

1. No media bytes through Vercel. Use Firebase client SDK or signed upload sessions.
2. No FFmpeg in Vercel routes. Delete or ignore EditVideos `api/upload-video.js` as a pattern for Hitloop; move optimization to the worker.
3. One dashboard media route, action-dispatched, to avoid route sprawl:
   - `/api/dashboard/media`
   - optional `/api/worker/media-render` only if the worker is triggered from Vercel
4. Keep route handlers metadata-only:
   - create job
   - list folders
   - list jobs
   - read manifest
   - sign upload/download access
5. Store generated videos in Firebase Storage, not `public/`.
6. Cap default output:
   - 720x720
   - 30 seconds
   - 30 fps
   - MP4 H.264
   - max output 40 MB, matching Studio Render's guardrail
7. Add per-client and global queue limits:
   - client: max 1 active `video-remix`
   - global: max 1 processing in v1
   - daily client quota configurable by tier
8. Use cached folder summaries where possible. Do not list the full bucket on every dashboard bootstrap.
9. Only archive to Arweave after explicit user/admin action. No auto-archive for every render.

## Pitfalls and Port Complexity

This is a medium-high complexity port. The dashboard cards are manageable; the difficult part is converting EditVideos from a single-purpose media app into a multi-client, quota-safe Hitloop subsystem.

### Primary Pitfalls

1. **Copying serverless routes too literally**
   EditVideos has Vercel API files that create jobs, list folders, upload/archive files, and in one case optimize video. In Hitloop, only metadata work belongs in Vercel. FFmpeg, video optimization, Firebase-download-to-Arweave upload, and any large file transfer must run in an external worker.

2. **Breaking Vercel payload and runtime limits**
   Large uploads must never pass through `/api/*`. Use direct-to-Firebase uploads or signed upload sessions. Vercel routes should return job ids, signed URLs, folder summaries, and small JSON only.

3. **Global storage assumptions**
   EditVideos uses global folders such as `skyline`, `logos`, `videos`, `paper_backgrounds`, `assets/chicago-skyline-videos`. Hitloop must scope everything under `clients/{clientId}/media/...`. This touches folder discovery, validation, worker downloads, output paths, archive manifests, dashboard state, and download links.

4. **Cross-client file access**
   Folder and file path inputs are dangerous once this becomes a multi-client dashboard. Every route and worker claim must verify `clientId`, normalize folder names, reject traversal, reject absolute paths, and refuse storage paths outside the client prefix.

5. **Worker duplication or stuck jobs**
   Video work is expensive enough that duplicate processing is a real cost bug. Copy the lease/retry/orphan-reclaim pattern from `studio-render-jobs.cjs`; do not rely on naive `where status == queued` polling alone.

6. **FFmpeg environment regressions**
   EditVideos depends on a full FFmpeg build for iPhone `.mov`, variable-frame-rate clips, `drawtext`, overlays, and H.264 output. A default apt or npm FFmpeg can pass simple tests and still fail real uploads. The media worker should pin/containerize the FFmpeg build and include fixtures for `.mov`, MP4, image segment, overlay, logo, and text overlay.

7. **Dashboard state drift**
   Hitloop cards render from normalized `dashboard_state`, not raw worker output. A worker that only updates `media_jobs` will leave cards stale. On success, append a normalized `mediaCaptures[]` ref and clear `mediaVideoPending`; on failure, write a visible failure state.

8. **Arweave permanence and wallet cost**
   Archive-to-Arweave should be admin-only until cost and confirmation flows are proven. Do not auto-archive every generated video. Require explicit confirmation, show estimated size/cost, and write transaction metadata back to the relevant asset ref.

9. **Route sprawl**
   EditVideos splits many concerns into many API files. Hitloop should keep this as one `/api/dashboard/media` action route plus, only if needed, one worker-drain route. Extra route files increase maintenance and deployment complexity.

10. **Product scope creep**
    EditVideos also has ArNS website deployment, artist pages, DALL-E fallback, artist thumbnail migration scripts, usage indicators, upload optimization, and archive pages. Do not port all of this in v1. The first useful product slice is: source media → queued remix job → external worker → generated MP4 card.

### Complexity by Area

| Area | Complexity | Why |
|---|---:|---|
| Dashboard card shells | Medium | Existing card patterns help, but the modal controls and client/admin visibility need care. |
| Metadata API | Medium | Auth, path validation, job creation, polling, and folder listing are straightforward if no bytes pass through Vercel. |
| Data model/projection | Medium | Needs clean `media_jobs`, `mediaCaptures`, pending markers, and normalized asset refs. |
| Worker port | High | Must decouple global folders/artists/default logos, add `clientId` scoping, preserve FFmpeg behavior, and write normalized outputs. |
| Direct upload flow | Medium-high | Browser-to-storage upload needs secure rules/session handling and reliable progress UI. |
| Arweave archive | Medium-high | Conceptually simple, operationally risky because uploads are permanent and wallet-funded. |
| Production hardening | High | Quotas, retries, cleanup, storage growth, worker heartbeat, and admin observability are mandatory before broad client exposure. |

### Rough Effort

Expect 4-7 focused implementation passes for a safe MVP:

1. Queue/data model.
2. Metadata API.
3. Basic `video-remix` card with pending/done/failed states.
4. Worker extraction with local fixtures.
5. Firebase output + `dashboard_state.mediaCaptures` append.
6. Media upload/library UI.
7. Arweave archive and ops visibility.

## Implementation Phases

### Phase 0 - Extract and Normalize the EditVideos Engine

> **Status (2026-06-24): SHELVED for v1.** Built as `services/media-render/`
> (renders from local fixtures, proven). Not used in v1 — Phase 5 was revised to
> bridge into the already-live EditVideos worker instead of self-hosting FFmpeg.
> This package returns when we move to client-scoped, multi-tenant rendering.

Deliverable: worker package compiles locally with client-scoped paths.

Tasks:

1. Create `services/media-render/package.json`.
2. Copy only worker-side libraries needed for render:
   - `ArweaveVideoGenerator.js`
   - `ArweaveAudioClient.js`
   - `VideoLoader.js`
   - `VideoSegmentCompositor.js`
   - `VideoCompositor.js`
   - `VideoFilters.js`
   - `ImageLoader.js`
   - `VideoOptimizer.js` only if optimization is worker-side
3. Remove Underground Existence-specific defaults from engine config:
   - default logos
   - artist names
   - top-level storage folders
   - hardcoded bucket paths
4. Add a `clientId` and `storagePrefix` parameter to every loader.
5. Replace global folder discovery with `clients/{clientId}/media/source/**`.
6. Add a fixture-driven local test with two short videos, one image, one Arweave URL mock, and one generated output.

### Phase 1 - Media Job Queue

Deliverable: Hitloop can enqueue and poll media jobs with no render work yet.

Tasks:

1. Add `api/_lib/media-jobs.cjs`.
2. Implement:
   - `createMediaJob`
   - `claimNextMediaJob`
   - `completeMediaJob`
   - `failMediaJob`
   - `requeueMediaJob`
   - `listMediaJobs`
3. Mirror the lease and retry strategy from `studio-render-jobs.cjs`.
4. Add Firestore rules/index notes for `media_jobs`.
5. Add unit tests for queue claim, retry, and orphan reclaim.

### Phase 2 - Dashboard Media API

Deliverable: one metadata-only API route.

Tasks:

1. Add `app/api/dashboard/media/route.js`.
2. Support action dispatch:
   - `GET ?action=folders`
   - `GET ?action=folder-files&folder=...`
   - `GET ?action=jobs&type=...`
   - `GET ?action=job&jobId=...`
   - `GET ?action=archive-manifest`
   - `POST ?action=create-upload-session`
   - `POST ?action=create-video-remix`
   - `POST ?action=archive-to-arweave`
3. Auth with `verifyRequestUser` and `getEffectiveClientContext`.
4. Validate folder names using the stricter EditVideos allowlist approach, but with client-scoped prefixes.
5. Return only signed upload/download metadata. Do not proxy files.
6. Add rate limits to job creation and folder listing.

### Phase 3 - Media Library Card

Deliverable: source media upload/preview card in Deliverables.

Tasks:

1. Add `media-library` to `NON_ADMIN_UNLOCKED_CARD_IDS` only after upload rules are safe.
2. Add card object in `DashboardPage.jsx` with `extraCategories: ['deliverables']` if primary category stays `content`.
3. Add modal/panel for:
   - folder list
   - create folder
   - upload files
   - preview files
4. Add a Firestore listener for `dashboard_state.mediaLibrary` or refresh after upload.
5. Make empty states clear: no source media yet, upload clips/images first.

### Phase 4 - Video Remix Card

Deliverable: card can enqueue a remix job and show pending/done/failed states.

Tasks:

1. Add `video-remix` card in Deliverables.
2. Add form controls:
   - source folders
   - Arweave audio/media URL
   - filter
   - overlay
   - top logo
   - end logo/end text/end media
   - output duration, locked to 30s in v1
3. On submit, call `/api/dashboard/media?action=create-video-remix`.
4. Set `dashboard_state.mediaVideoPending`.
5. Add live listener for `mediaCaptures` and `mediaVideoPending` similar to the current `studioCaptures` listener.
6. Build `deliverableAsset` from latest `video_remix`.
7. Update the full-screen deliverable overlay to accept `video_remix` refs with the same behavior as `studio_video`.

### Phase 5 - Bridge to the live EditVideos render pipeline (REVISED)

> **Direction change (2026-06-24):** Do **not** stand up a new FFmpeg worker for v1.
> The EditVideos render pipeline is already deployed and self-draining: a GitHub
> Action on `cron */1 * * * *` (`.github/workflows/process-videos.yml`) polls
> `videoJobs` in the `editvideos-63486` Firebase every minute, runs the proven
> `ArweaveVideoGenerator` engine, uploads the MP4, and writes results. Maximum
> reuse = Hitloop enqueues into that existing queue and reads the result back.
> The `services/media-render/` package (Phase 0) is **shelved** for the future
> client-scoped, multi-tenant path — not used in v1.

**Architecture: read EditVideos, render on EditVideos, surface in Hitloop.**

```
Hitloop card (RUN REMIX)
   → POST /api/dashboard/media?action=create-video-remix
       → media_jobs/{jobId}                (Hitloop — owns card state)
       → videoJobs/{editJobId}  status:pending   (EditVideos Firebase — the live worker's queue)
       → dashboard_state.mediaVideoPending       (card flips to "Queued…")
   ↓ (≤60s) live EditVideos GitHub Action claims & renders — ZERO worker changes
   → videos/{editJobId} + videoJobs status:completed + output URL (EditVideos bucket)
   ↓ Hitloop reconcile (poll on job GET + light cron backstop)
   → dashboard_state.mediaCaptures += { type:'video_remix', downloadUrl, … }
   → clear mediaVideoPending → card flips to "Video ready"
```

**Source media** stays in the EditVideos bucket's existing global folders
(`skyline/`, `videos/`, …) — keep uploading there as today, no migration.
**Generated output** stays in the EditVideos bucket for v1, served to the card by
its existing accessible URL (no copy into Hitloop storage yet; revisit if/when
output must be access-controlled per client).

**Caveat carried forward:** EditVideos folders are global/shared, not client-scoped.
Acceptable while single-operator. Revisit at true multi-tenant (that is when the
shelved `services/media-render` + per-client source path comes back).

Tasks:

1. **Cross-project access.** Add an EditVideos service-account credential to
   Hitloop env (e.g. `EDITVIDEOS_FIREBASE_*` / JSON) and a small
   `api/_lib/editvideos-bridge.cjs` that lazily inits a SECOND firebase-admin app
   named `editvideos` (do not collide with the default app). Read-only intent
   except for writing `videoJobs` docs.
2. **Enqueue bridge.** In `create-video-remix`, after `createMediaJob`, also write
   a `videoJobs/{editJobId}` doc in the EditVideos project using its EXACT existing
   schema (`status:'pending'`, `selectedFolders`, `videoFilter`, `topLogo`,
   `endLogo`, `overlayEffect`, `useArtistImage`, `customEndMedia`, `endTextOverlay`,
   `videoOrder`, `createdAt`). Store `editJobId` on the Hitloop `media_jobs` doc as
   the join key. Map the Hitloop recipe → EditVideos fields.
3. **Folder source.** Replace the card's placeholder `sourceFolders:['uploads']`
   with a real EditVideos folder picker (or a sane default of real folder names).
   Add `GET ?action=folders` that lists EditVideos source folders via the bridge
   (cached summary, not a full bucket scan on every load).
4. **Reconcile EditVideos → Hitloop.** Extend `GET ?action=job&jobId=` to read the
   linked `videoJobs` doc; when `completed`, append the normalized `video_remix`
   ref to `dashboard_state.mediaCaptures`, clear `mediaVideoPending`, and mark the
   Hitloop `media_jobs` doc `done`. Card polls this after enqueue.
5. **Backstop reconcile (optional v1.1).** A single light Hitloop cron that
   reconciles any in-flight `media_jobs` so results land even if the user closed
   the tab. One cron only — respect the route/cron-sprawl guardrail.
6. **Failure surfacing.** Map EditVideos `failed` status → `failMediaJob` + a
   visible card failure state.

Definition of done: clicking RUN REMIX produces, within ~1-2 minutes, a real MP4
(rendered by the untouched EditVideos worker) that appears in the Video Remix card
and opens/downloads through the existing deliverable overlay — with no new FFmpeg
infrastructure deployed by Hitloop.

**Prerequisite (ops, user-provided):** an EditVideos (`editvideos-63486`) service
account JSON with Firestore + Storage read and `videoJobs` write. Code can be
built without it; end-to-end test needs it.

### Phase 6 - Arweave Archive Card

Deliverable: admin can archive selected generated media to Arweave.

Tasks:

1. Port `ArweaveUploader.js` into server/worker code.
2. Move large archive transfer to worker.
3. Add cost estimate and confirmation step.
4. Add `archiveManifest` projection into `dashboard_state.arweaveArchive`.
5. Add UI showing transaction ID, Arweave URL, Turbo URL, and confirmation/pending state.
6. Add wallet-balance check before enqueue.

### Phase 7 - Post Me Integration

Deliverable: generated remix videos feed the existing posting workflow.

Tasks:

1. Add latest video-remix lookup near the existing latest studio video lookup.
2. Let `post-me` prefer latest MP4 remix, then Studio Render MP4, then OG image.
3. Preserve the current X composer/download flow.
4. Add filename labels that distinguish `video-remix` from `studio`.

### Phase 8 - Ops, Quotas, and Cleanup

Deliverable: stable production behavior.

Tasks:

1. Add quotas by tier:
   - free: 1 active job, low monthly count
   - paid: configurable higher count
   - admin: bypass
2. Add media storage cleanup policy:
   - generated captures keep last N per client
   - source media never auto-deleted without user action
3. Add dashboard admin view:
   - active jobs
   - failures
   - worker heartbeat
   - storage growth
4. Add docs:
   - env vars
   - worker deploy
   - storage paths
   - disaster recovery
5. Add smoke tests:
   - enqueue job
   - folder listing
   - worker local render with fixtures
   - card renders pending/done states

## What Not to Port in v1

- EditVideos vanilla `public/index.html` UI. Hitloop should use the dashboard card UI and existing modal patterns.
- `api/upload-video.js` as a Vercel FFmpeg optimizer. This violates the free-tier architecture.
- Global folders like `skyline`, `logos`, `videos`, and `paper_backgrounds`. Hitloop needs client-scoped folders.
- ArNS website deployment. Keep it as a later admin-only "publish/archive microsite" feature.
- Automatic Arweave archive on every generated asset. It creates wallet/cost risk and permanent-storage mistakes.
- Public `makePublic()` as the default. Prefer signed download URLs and the existing deliverable-file proxy guard where needed.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---:|---|
| Large uploads hit Vercel body limits | Broken uploads, expensive functions | Browser-to-Firebase direct upload only |
| FFmpeg exceeds Vercel duration/CPU | Failed deploy/runtime | External worker only |
| Bucket scans become expensive | Slow dashboard, Firestore/Storage read growth | Cache folder summaries in `dashboard_state.mediaLibrary` |
| Arweave wallet misuse | Irreversible/costly uploads | Admin-only v1, explicit confirmation, estimate first |
| Cross-client file access | Security issue | Prefix every path by `clientId`; validate on every API action |
| Worker duplicate processing | Duplicate files/cost | Lease lock copied from Studio Render pattern |
| VFR iPhone `.mov` failures | User uploads fail | Pin full FFmpeg build/container and keep fixture tests |
| Route sprawl | Vercel deployment complexity | One `/api/dashboard/media` route plus optional worker route |
| Dashboard card bloat | Poor UX | Progressive disclosure: card face summarizes, modal handles controls |

## Acceptance Criteria

1. `media-library` shows client-scoped folders and supports direct upload without Vercel receiving file bytes.
2. `video-remix` enqueues a `media_jobs` doc and shows queued/processing/done/failed states.
3. External worker renders a 30s MP4 from at least two uploaded clips and one Arweave audio URL.
4. Generated MP4 appears in `dashboard_state.mediaCaptures` and opens in the existing deliverable overlay.
5. `post-me` can use a generated remix MP4.
6. `arweave-archive` can archive a selected generated asset as admin and write transaction metadata back.
7. No new large files are committed to the repo or `public/`.
8. Vercel routes remain metadata-only and small-payload.
9. `npm run build` passes.
10. Queue/unit tests for media jobs pass.

## Recommended First Implementation Slice

Build this in the smallest useful order:

1. `media_jobs` queue with tests.
2. `/api/dashboard/media?action=create-video-remix` that only enqueues.
3. `video-remix` card showing pending status from `dashboard_state.mediaVideoPending`.
4. Local `services/media-render` worker rendering from fixture files.
5. Firebase upload of real output and `dashboard_state.mediaCaptures` append.
6. Card deliverable overlay for generated video.

That first slice proves the end-to-end architecture without taking on upload UI, Arweave archival, or advanced controls all at once.

## Separate Agent Build Brief

Use this section as the handoff prompt for a separate implementation agent.

### Mission

Build the first safe implementation slice of the EditVideos port inside Hitloop:

1. Add the media job queue.
2. Add the metadata-only dashboard media API.
3. Add a basic `video-remix` Deliverables card that can enqueue a job and display queued/processing/done/failed state.
4. Add an external/local worker package that can render from fixtures and later from Firebase client media.

Do not attempt Arweave archive, upload UI, ArNS, or Post Me integration until the basic queued render path works.

### Required Repo Context to Read First

Read these files before editing:

1. `/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/plans/EDITVIDEOS_TO_HITLOOP_CARDS_PLAN.md`
2. `/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/dashboard/studio-render/route.js`
3. `/Users/bballi/Documents/Repos/Bballi_Portfolio/api/_lib/studio-render-jobs.cjs`
4. `/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/worker/render-studio/route.js`
5. `/Users/bballi/Documents/Repos/Bballi_Portfolio/api/_lib/studio-render-core.cjs`
6. `/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx`
7. `/Users/bballi/Documents/Repos/Bballi_Portfolio/app/api/dashboard/deliverable-file/route.js`
8. `/Users/bballi/Documents/Repos/EditVideos/CLAUDE.md`
9. `/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator/api/generate-video.js`
10. `/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator/worker/processor.js`
11. `/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator/worker/lib/VideoLoader.js`
12. `/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator/worker/lib/VideoSegmentCompositor.js`
13. `/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator/worker/lib/VideoFilters.js`

### Build Rules

1. Keep Vercel routes metadata-only. No file upload bytes, no FFmpeg, no Arweave upload body streaming.
2. Add no more than one user-facing route for this feature: `app/api/dashboard/media/route.js`.
3. If a worker trigger route is needed, follow the existing `app/api/worker/render-studio/route.js` auth and lease style.
4. Scope every storage path by `clientId`.
5. Reject any user-provided path outside `clients/{clientId}/media/...`.
6. Do not make files public by default. Prefer signed URLs or the existing safe download patterns.
7. Do not import worker-only FFmpeg modules into Next.js client or route code.
8. Preserve existing dashboard behavior and non-admin gating.
9. Do not remove or rewrite Studio Render; this feature is adjacent to it.
10. Keep the first slice small enough to build and test.

### Suggested Build Order

1. **Create `api/_lib/media-jobs.cjs`**
   - Model it after `studio-render-jobs.cjs`.
   - Use collection `media_jobs`.
   - Support `createMediaJob`, `claimNextMediaJob`, `completeMediaJob`, `failMediaJob`, `requeueMediaJob`, `listMediaJobs`, and `getMediaJob`.
   - Add a singleton queue lock for v1.

2. **Add unit tests for the queue**
   - Test job creation.
   - Test single claim.
   - Test failed/requeued job.
   - Test expired lease reclaim if practical with mocked timestamps.

3. **Create `/api/dashboard/media`**
   - Implement only:
     - `POST ?action=create-video-remix`
     - `GET ?action=job&jobId=...`
     - `GET ?action=jobs&type=video-remix`
   - Validate auth with `verifyRequestUser` and `getEffectiveClientContext`.
   - Validate recipe inputs.
   - Write `dashboard_state.mediaVideoPending` when enqueueing.

4. **Add `video-remix` card**
   - Add card in `DashboardPage.jsx`, Deliverables bucket.
   - Read latest `dashboard_state.mediaCaptures` with `type === 'video_remix'`.
   - Show pending state from `dashboard_state.mediaVideoPending`.
   - Footer action enqueues a basic recipe.
   - For v1, controls can be simple defaults; do not build the full media picker yet.

5. **Add live dashboard listener support**
   - Extend the existing `dashboard_state` listener pattern used for `studioCaptures`.
   - Merge only `mediaCaptures` and `mediaVideoPending` to avoid clobbering bootstrap state.

6. **Create `services/media-render`**
   - Copy only worker-side EditVideos libraries needed for rendering.
   - Add local fixture render first.
   - Parameterize `clientId`, `sourceFolders`, `sourceFiles`, and output path.
   - Do not connect production Firebase until local fixtures work.

7. **Append normalized capture refs**
   - On worker success, write output under `clients/{clientId}/media/generated/{jobId}.mp4`.
   - Append:
     - `type: 'video_remix'`
     - `variant: 'video'`
     - `downloadUrl`
     - `storagePath`
     - `contentType`
     - `sizeBytes`
     - `durationSeconds`
     - `jobId`
   - Clear `mediaVideoPending`.

### Definition of Done for First Slice

The first slice is complete when:

1. `npm run build` passes.
2. Queue tests pass.
3. An authenticated dashboard user can enqueue a `video-remix` job.
4. The `video-remix` card shows pending state.
5. A local worker run can produce a fixture MP4.
6. A completed job can append a `video_remix` capture ref.
7. The card can open/download the generated video through existing deliverable patterns.

### Explicit Non-Goals for the First Slice

Do not build these yet:

1. Direct upload UI.
2. Full folder picker.
3. Arweave archive.
4. ArNS deploy.
5. Artist management.
6. DALL-E fallback.
7. X API posting.
8. Batch rendering.
9. Public client exposure before path validation and quotas are in place.
