# Video Remix ⇄ EditVideos Bridge — as-built source of truth

Status: **SHIPPED** (2026-06-24), proven end-to-end on `hitloop.agency`.
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
```

## Files (Hitloop)

| File | Role |
|---|---|
| `api/_lib/media-jobs.cjs` | `media_jobs` queue (lease/retry/orphan-reclaim, mirrors `studio-render-jobs.cjs`). `createMediaJob`, `getMediaJob`, `listMediaJobs`, `setMediaJobEditRef`, `listInFlightMediaJobs`, `completeMediaJob`, `failMediaJob`. |
| `api/_lib/editvideos-bridge.cjs` | Named 2nd firebase-admin app `editvideos`. `mapRecipeToVideoJob`, `enqueueVideoJob`, `triggerWorker`, `getVideoJob`, `listSourceFolders`, `listOptions` (artists/mixes/filters/overlays/logos, 60s cache). |
| `api/_lib/media-recipe.cjs` | `validateRemixRecipe` + folder allowlist (`sanitizeFolderName`). Output locked 720/30/30. |
| `api/_lib/media-reconcile.cjs` | `reconcileMediaJob(job, clientId)` — EditVideos → Hitloop. |
| `app/api/dashboard/media/route.js` | Metadata-only route. Actions: `create-video-remix`, `job` (reconciles), `jobs`, `folders`, `options`. |
| `app/api/worker/media-reconcile/route.js` | Backstop sweep (worker-secret auth); also pingable by the EV Action. |
| `DashboardPage.jsx` | `video-remix` card, `dashboard_state` listener (carries `mediaCaptures`/`mediaVideoPending`), `runVideoRemix`, REMIX params tab, shell/modal `<video>` (`latestRemixVideoUrl`). |
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
- Capture shape: `{ type:'video_remix', variant:'video', downloadUrl, durationSeconds:30, sourceFolders, jobId, editJobId, createdAt }`.

## Recipe → videoJobs mapping (`mapRecipeToVideoJob`)

`artist` (null = random audio) · `mixTitle` · `useTrax` · `selectedFolders` · `duration:30` ·
`videoFilter` (filter.key) · `filterIntensity` (0–1, default 0.8) · `enableOverlay`+`overlayEffect` ·
`topLogo`/`endLogo` (logos.top/end) · `useArtistImage` · `endTextOverlay` (endCard.text) ·
`customEndMedia:null` · `videoOrder:null`.

Options for the params tab come from `listOptions()`: 9 filters + 6 overlays (static, from EV
`VideoFilters.js` / its UI), artists+mixes (live from EV `system/artists`), logos (live from EV
bucket `logos/`).

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
6. **Capture lands even without the live listener.** `runVideoRemix` merges `job.output` into local
   state on poll-`done`, so the card flips to "Video ready" even under admin impersonation (listener
   off) or a cached bootstrap.
7. Generated MP4 carries an `aac` audio track; it's served from the EV bucket via a signed URL.

## How to extend

- **New recipe field:** add to `validateRemixRecipe` (sanitize) → `mapRecipeToVideoJob` (map to the EV
  `videoJobs` field) → REMIX tab control in `DashboardPage.jsx`. Verify the EV worker honors the field.
- **New action:** add a metadata-only branch in `app/api/dashboard/media/route.js` (no file bytes, no FFmpeg).
- **Multi-tenant / client-scoped media:** un-shelve `services/media-render`, add a `FirebaseMediaStore`,
  and move source folders under `clients/{clientId}/media/...` (the original plan's Phase 0/3).

## Verify

- `npm test` (includes `api/**/__tests__`) · `npm run build`.
- Live read sanity: a node script loading env via `@next/env` calling `editvideos-bridge.listSourceFolders()`/`listOptions()` proves cross-project auth without enqueuing a render.
