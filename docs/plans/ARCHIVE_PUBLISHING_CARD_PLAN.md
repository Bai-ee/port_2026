# Archive / Publishing Card Plan

Date: 2026-06-25
Status: implemented (full card shipped in the Knowledge Officer bucket)

## As-built notes (2026-06-25)

- Card id `archive-publishing`, `category: 'knowledge'` (Knowledge Officer bucket), admin-only. Not a scout module — direct admin action.
- Backend: `api/_lib/editvideos-bridge.cjs` extended with archive/deploy/arns/cost helpers + pure normalizers; `api/_lib/archive-publishing-projection.cjs` (pure projection). Actual wallet-funded mutations (archive upload, website deploy, ArNS) are PROXIED over HTTP to the EditVideos deployed app via `EDITVIDEOS_API_BASE`; manifest/job status read directly from EditVideos Firestore through the named bridge app.
- Route: 8 actions added to `app/api/dashboard/media/route.js`; all archive/website/arns actions are admin-gated via `isAdminEmail`. Results mirror into `dashboard_state.archivePublishing`.
- Frontend: 5-tab modal (Archive/Manifest/Website/ArNS/Cost) keyed on `activeTileModal.cardId === 'archive-publishing'`; `.apk-scope` styles in the `dashboardCss` template literal.
- Tests: `api/_lib/__tests__/archive-publishing.test.js` (14 cases). `npm test` (561) + `npm run build` pass.
- Required env for live operation: `EDITVIDEOS_API_BASE` (deployed EditVideos URL), plus existing `EDITVIDEOS_FIREBASE_*`. Degrades to a disabled/empty state when unset (no crash).

## Objective

Add one admin-first dashboard card that lets HITLOOP archive approved Firebase media and finished videos to Arweave, inspect the archive manifest, estimate publishing costs, deploy an Arweave-hosted media/artist microsite, and manage the ArNS pointer for that deployment.

The card should turn the useful publishing pieces from the EditVideos repo into a controlled HITLOOP workflow without moving large file transfer or irreversible wallet-funded actions into casual client-facing paths.

## Target Card

- Card id: `archive-publishing`
- Initial bucket: `deliverables` for admins only
- Later visibility: client-visible read-only delivery view once archive/deploy flows are proven
- Producer path: direct dashboard/admin action, not a scout module
- Primary dashboard state path: `dashboard_state.archivePublishing`

This should be one card with tabs, not five separate cards:

1. `Archive`
2. `Manifest`
3. `Website Deploy`
4. `ArNS`
5. `Cost`

## Existing Sources to Reuse

### HITLOOP

- `docs/source-of-truth/VIDEO-REMIX-EDITVIDEOS-BRIDGE.md` documents the shipped cross-project bridge and must be read before implementation.
- `api/_lib/editvideos-bridge.cjs` already owns the named Firebase Admin app for the EditVideos project.
- `api/_lib/media-jobs.cjs` already supports `type: 'arweave-archive'`.
- `app/api/dashboard/media/route.js` is the existing metadata-only media route.
- `DashboardPage.jsx` already renders Video Remix and reads `mediaCaptures` / `mediaVideoPending`.
- `docs/source-of-truth/CREATIVE-BRIEF-DELIVERABLES-WIRING.md` defines the card-to-dashboard-state contract.

### EditVideos

- `arweave-video-generator/api/archive-upload.js`
  - Archives a Firebase Storage file to Arweave.
  - Writes `archiveJobs`.
  - Updates `archiveManifest`.
  - Returns `transactionId`, `arweaveUrl`, `turboUrl`, file size, and status.
- `arweave-video-generator/api/deploy-website.js`
  - Estimates deploy cost via `GET`.
  - Syncs artist data, regenerates pages, deploys site to Arweave, and can update ArNS.
- `arweave-video-generator/api/upload.js`
  - Estimates upload costs and uploads audio/images to Arweave.
- `arweave-video-generator/lib/ArweaveUploader.js`
  - The low-level Arweave/Turbo upload code.
- `arweave-video-generator/lib/WebsiteDeployer.js`
  - Website upload + manifest creation.
- `arweave-video-generator/lib/ArNSUpdater.js`
  - ArNS update helper.
- `arweave-video-generator/lib/ArweaveCostCalculator.js`
  - Cost estimate helper.

## Product Scope

### Archive to Arweave

Purpose: permanently archive selected Firebase media or finished HITLOOP videos to Arweave for provenance, permanent links, and client delivery.

Sources:

- Latest `dashboard_state.mediaCaptures[]` video remix outputs.
- Existing `dashboard_state.studioCaptures[]` studio render videos.
- EditVideos source media folders exposed through the current bridge.
- Later: client-scoped Firebase media if HITLOOP moves off global EditVideos folders.

Required UI:

- Source picker: `Finished Videos`, `Studio Captures`, `Source Folders`.
- File rows with name, type, size, source, current archive state.
- Multi-select.
- Explicit confirmation before upload.
- Action: `Archive selected`.
- Result rows: status, transaction ID, Arweave URL, Turbo URL, archived timestamp.

Rules:

- Admin-only in v1.
- No auto-archive after render.
- Estimate first for batch archive.
- Do not route media bytes through a Next/Vercel dashboard request.

### Archive Manifest

Purpose: show what has already been archived and make permanent links easy to inspect/copy.

Required UI:

- Group by client/source/campaign/folder when metadata exists.
- Show filename, source path, transaction ID, Arweave URL, Turbo URL, archived timestamp, file size, content type.
- Status: `uploading`, `pending_confirmation`, `confirmed`, `failed`, `unknown`.
- Actions: open, copy URL, copy transaction ID, retry failed archive.

Data source:

- EditVideos `archiveManifest` for bridge-backed archive.
- HITLOOP `dashboard_state.archivePublishing.manifest` mirror for dashboard read speed.

### Arweave Website Deploy

Purpose: publish a generated media/artist microsite to Arweave.

Required UI:

- Show deploy target and source site type.
- Show changed files, unchanged files, total files.
- Show last deployment: manifest ID, Arweave URL, ArNS URL, timestamp.
- Action: `Estimate deploy`.
- Action: `Deploy to Arweave`.

V1 constraint:

- Treat this as operator/admin-only because the existing EditVideos website deploy is coupled to Underground Existence artist pages and ArNS ownership.
- Do not make it client-visible until the deploy target is generalized away from the Underground Existence site.

### ArNS Domain Update

Purpose: inspect and update the ArNS pointer after a successful deploy.

Required UI:

- Show configured ArNS name.
- Show last deployment manifest ID.
- Show last known ArNS target if available.
- Action: `Update ArNS`.
- Action: `Retry ArNS update` if deployment succeeded but ArNS failed.
- Show propagation note and status.

Rules:

- Admin-only.
- Only enabled after a successful website deploy with a manifest ID.
- Must preserve deploy success if ArNS update fails.

### Deployment Cost Estimate

Purpose: estimate Arweave cost before publishing a file batch or website diff.

Required UI:

- Estimate selected archive batch.
- Estimate website deploy diff.
- Show bytes, KB/MB, file count, AR estimate, USD estimate, price timestamp if available.
- Show clear note that estimate is not a final invoice.

## Architecture Decisions

1. Keep the shipped Video Remix bridge model.
   - HITLOOP should call/bridge metadata and status.
   - EditVideos remains the system of record for existing global source folders, archive jobs, and Arweave deployment until a client-scoped worker exists.

2. Keep Vercel routes metadata-only where possible.
   - Safe: enqueue archive job, read manifest, read status, calculate cost from file metadata, trigger deploy.
   - Unsafe: downloading large Firebase files and uploading them to Arweave inside a regular dashboard route.

3. Use worker-backed archive for large files.
   - The EditVideos archive endpoint currently performs the Firebase download and Turbo upload in an API handler.
   - HITLOOP should wrap it only for small/proven flows at first, then move archive transfer to an external worker if files are large or timeouts appear.

4. Mirror enough state into HITLOOP.
   - EditVideos can stay source of truth for transactions.
   - HITLOOP still needs `dashboard_state.archivePublishing` so the dashboard does not need to join multiple external reads on every render.

5. Split "archive media" from "deploy website."
   - Archive media is the practical MVP.
   - Website deploy + ArNS is phase two because it has more coupling and ownership risk.

## Proposed Data Model

### `media_jobs` archive job

```js
{
  jobId,
  clientId,
  type: 'arweave-archive',
  status: 'queued' | 'processing' | 'done' | 'failed',
  recipe: {
    source: 'mediaCaptures' | 'studioCaptures' | 'editvideosFolder',
    files: [
      {
        label,
        folder,
        fileName,
        fullPath,
        storageBucket,
        storagePath,
        downloadUrl,
        contentType,
        sizeBytes,
        sourceCaptureJobId
      }
    ],
    estimate: {
      fileCount,
      sizeBytes,
      costAR,
      costUSD,
      estimatedAt
    }
  },
  output: {
    archivedFiles: [
      {
        label,
        sourcePath,
        transactionId,
        arweaveUrl,
        turboUrl,
        fileSize,
        contentType,
        archivedAt,
        status
      }
    ]
  },
  editArchiveJobIds: [],
  error: null,
  attempts: 0,
  createdAt,
  updatedAt,
  startedAt: null,
  completedAt: null
}
```

### `dashboard_state.archivePublishing`

```js
{
  archivePublishing: {
    latestArchiveJob: {
      jobId,
      status,
      queuedAt,
      completedAt,
      fileCount,
      error
    },
    archivedAssets: [
      {
        label,
        source: 'video-remix' | 'studio-render' | 'source-media' | 'website-deploy',
        sourceJobId,
        sourcePath,
        transactionId,
        arweaveUrl,
        turboUrl,
        fileSize,
        contentType,
        status,
        archivedAt
      }
    ],
    manifest: {
      source: 'editvideos',
      version,
      lastUpdated,
      folders: {}
    },
    costEstimate: {
      mode: 'archive' | 'website-deploy',
      fileCount,
      sizeBytes,
      costAR,
      costUSD,
      estimatedAt
    },
    latestDeployment: {
      deploymentId,
      status,
      manifestId,
      arweaveUrl,
      arnsUrl,
      filesUploaded,
      filesUnchanged,
      totalFiles,
      costEstimate,
      deployedAt,
      arnsUpdatedAt,
      arnsError
    }
  }
}
```

### Asset ref enrichment

When an existing capture is archived, enrich the corresponding `mediaCaptures[]` or `studioCaptures[]` item when possible:

```js
{
  arweave: {
    transactionId,
    url,
    turboUrl,
    archivedAt,
    status
  }
}
```

## Backend Plan

### Phase 1 - Read-only bridge and manifest UI data

Deliverable: HITLOOP can read the EditVideos archive manifest and expose normalized source files for archive selection.

Tasks:

1. Extend `api/_lib/editvideos-bridge.cjs`.
   - `getArchiveManifest()`
   - `getArchiveJob(jobId)`
   - `listArchiveableCaptures(clientId)` if kept bridge-side, or implement this in the dashboard route.
   - `estimateArchiveFiles(files)` using file metadata first.
2. Add route actions in `app/api/dashboard/media/route.js` or a new route if cleaner.
   - `GET ?action=archive-manifest`
   - `GET ?action=archive-sources`
   - `POST ?action=archive-estimate`
3. Normalize response shape.
   - Manifest entries should always include `label`, `sourcePath`, `transactionId`, `arweaveUrl`, `status`, `fileSize`, and `archivedAt` when available.
4. Add tests for pure mapping/normalization.

Gate:

- Admin API can return a manifest with no write side effects.
- Missing EditVideos credentials degrade to a clear 503/disabled state, not a dashboard crash.

### Phase 2 - Archive selected finished video

Deliverable: admin can archive one selected completed video and see the Arweave URL in the dashboard.

Tasks:

1. Add route action:
   - `POST ?action=archive-to-arweave`
2. Accept only a constrained source in the first slice:
   - latest or selected `mediaCaptures[]` video remix that came from EditVideos.
3. Map a selected video URL/storage path back to an EditVideos Firebase file path.
   - Prefer output file metadata if available.
   - If the signed URL does not safely reveal a bucket path, store output `storagePath` during reconcile before this phase.
4. Create a `media_jobs` doc with `type: 'arweave-archive'`.
5. Call the EditVideos archive flow or enqueue a worker-backed archive.
6. Mirror success/failure into:
   - `media_jobs/{jobId}`
   - `dashboard_state.archivePublishing.archivedAssets[]`
   - matching capture `arweave` metadata when possible
7. Add polling/status action:
   - `GET ?action=archive-job&jobId=...`

Gate:

- One completed Video Remix MP4 can be archived.
- Transaction ID and Arweave URL are visible in the dashboard.
- Failed archive leaves a visible, retryable error.

### Phase 3 - Batch archive and source-folder archive

Deliverable: admin can archive multiple finished assets or selected source-folder files.

Tasks:

1. Expand archive source selection.
   - `mediaCaptures`
   - `studioCaptures`
   - EditVideos `folder-files`
2. Add batch handling.
   - One `media_jobs` parent job with child EditVideos archive job IDs, or one job per file with a grouped batch ID.
3. Add per-file status.
4. Add retry for failed file(s), not just whole batch.
5. Add cost estimate before the archive button is enabled.

Gate:

- Batch archive can partially succeed without losing per-file result metadata.
- The UI clearly separates archived, pending, failed, and unarchived files.

### Phase 4 - Website deploy estimate

Deliverable: admin can estimate an Arweave website deploy without deploying.

Tasks:

1. Extend bridge:
   - `estimateWebsiteDeploy({ websiteDir })`
2. Add route action:
   - `GET ?action=website-deploy-estimate`
3. Normalize EditVideos estimate response.
   - `filesChanged`
   - `filesUnchanged`
   - `totalFiles`
   - `sizeBytes`
   - `costAR`
   - `costUSD`
4. Mirror latest estimate into `dashboard_state.archivePublishing.costEstimate`.

Gate:

- Estimate tab displays file counts and cost from live EditVideos deployment code.
- No Arweave upload is triggered.

### Phase 5 - Website deploy

Deliverable: admin can deploy the configured media/artist website to Arweave and see deployment metadata.

Tasks:

1. Extend bridge:
   - `deployWebsiteToArweave({ websiteDir })`
2. Add route action:
   - `POST ?action=deploy-website`
3. Persist deployment result:
   - `dashboard_state.archivePublishing.latestDeployment`
   - optional `archive_deployments/{deploymentId}` collection if history needs to outlive dashboard state
4. Show deployment history in the card.
5. Do not block deployment success on ArNS update.

Gate:

- Deploy succeeds or fails with visible status.
- Manifest ID and Arweave URL are stored in HITLOOP.
- Previous deployment result remains visible after dashboard refresh.

### Phase 6 - ArNS status/update

Deliverable: admin can update or retry the ArNS pointer for the latest deployment.

Tasks:

1. Confirm whether EditVideos exposes ArNS update only inside deploy or as a reusable function.
2. If no clean endpoint exists, add a bridge/action that calls the same helper through EditVideos-side code or creates a small HITLOOP wrapper.
3. Add route action:
   - `POST ?action=update-arns`
4. Persist:
   - target manifest ID
   - ArNS name
   - ArNS URL
   - status
   - updated timestamp
   - error
5. Disable update unless a latest deployment has a manifest ID.

Gate:

- ArNS update failure does not erase deployment success.
- Retry is possible without redeploying files.

### Phase 7 - Client delivery mode

Deliverable: read-only client view can show permanent links after admin approval.

Tasks:

1. Add `visibleToClient` or delivery-ready flags per archived asset/deployment.
2. Add non-admin read-only card mode or fold permanent links into existing deliverable overlay.
3. Hide wallet, deploy, ArNS, retry, and cost controls from clients.
4. Add copy/download/open actions only.

Gate:

- Client can access permanent delivery links without seeing admin publishing controls.

## Frontend Plan

### Card face

Show:

- Latest archived asset count.
- Latest deployment status.
- Last Arweave URL or ArNS URL.
- Pending/failed badge if an archive/deploy job is active.
- Admin action: `Open Publishing`.

Empty state:

- "No archived assets yet."
- Secondary text should mention approved videos/files can be permanently published by an admin.

### Modal tabs

#### Archive

Controls:

- Source segmented control: `Finished videos`, `Studio captures`, `Source folders`.
- Folder picker only when source is `Source folders`.
- File table with checkboxes.
- Estimate summary.
- Button: `Archive selected`.

States:

- Loading sources.
- Empty source.
- Estimate missing.
- Confirming archive.
- Archiving with per-file progress.
- Error with retry.

#### Manifest

Controls:

- Search/filter by folder, file, transaction.
- Group by folder/source.
- Open/copy actions.
- Refresh.

States:

- No manifest.
- Manifest read failed.
- Partial data warning.

#### Website Deploy

Controls:

- Target summary.
- Estimate deploy.
- Deploy.
- Deployment history.

States:

- No estimate yet.
- Estimating.
- Deploying.
- Deploy succeeded.
- Deploy failed.

#### ArNS

Controls:

- Current configured name.
- Latest manifest ID.
- Last update status.
- Update/retry button.

States:

- No deployment available.
- Updating.
- Updated.
- Failed.

#### Cost

Controls:

- Archive batch estimate details.
- Website deploy estimate details.
- File count and size breakdown.

States:

- No selected files.
- Estimate unavailable.
- Estimate stale warning.

## API Surface

Prefer extending `app/api/dashboard/media/route.js` because this is part of the media/deliverables surface and can reuse auth/client resolution. If it becomes too crowded, split to `app/api/dashboard/archive-publishing/route.js`.

Proposed actions:

```txt
GET  /api/dashboard/media?action=archive-sources
GET  /api/dashboard/media?action=archive-manifest
GET  /api/dashboard/media?action=archive-job&jobId=...
POST /api/dashboard/media?action=archive-estimate
POST /api/dashboard/media?action=archive-to-arweave
GET  /api/dashboard/media?action=website-deploy-estimate
POST /api/dashboard/media?action=deploy-website
POST /api/dashboard/media?action=update-arns
```

Auth rules:

- All mutation actions admin-only in v1.
- Read-only manifest can be admin-only initially.
- Client-visible read actions come later and should filter to approved/delivery-ready assets only.

## Verification Plan

### Unit tests

Add tests for:

- Archive manifest normalization.
- Archive source list normalization.
- Cost estimate mapping.
- Dashboard state projection for successful archive.
- Dashboard state projection for failed archive.
- ArNS/deploy result mapping.

### Integration checks

Manual or scripted checks:

1. Read archive manifest with real EditVideos credentials.
2. Estimate one selected completed video.
3. Archive one small known media file.
4. Confirm `media_jobs` status updates.
5. Confirm `dashboard_state.archivePublishing.archivedAssets[]` updates.
6. Confirm manifest tab shows transaction ID and URL after refresh.
7. Estimate website deploy.
8. Deploy website in admin-only flow.
9. Retry ArNS update after a deployment.

### Build checks

Run:

```bash
npm test
npm run build
```

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Arweave uploads are permanent | Wrong file cannot be un-published from Arweave | Admin-only, explicit confirmation, estimate first, selected files preview |
| Wallet-funded operations cost money | Unexpected spend | Cost estimate, no auto-archive, batch confirmation |
| Large file transfer inside Vercel may timeout | Failed archive jobs | Start with small/proven files, move transfer to worker if needed |
| EditVideos website deploy is Underground Existence-specific | Wrong client/site could be published | Admin-only, label target clearly, generalize before client use |
| ArNS ownership/config mistakes | Domain points to wrong manifest | Require latest deployment manifest, show target before update, retry without redeploy |
| Signed video URLs may not expose storage path | Archive cannot map capture to Firebase file | Store `storagePath` during media reconcile before archive MVP |
| Global EditVideos folders are not client-scoped | Cross-client/source confusion | Admin-only, visible source labels, future client-scoped worker path |
| Manifest and HITLOOP mirror can drift | Dashboard displays stale archive state | Refresh action, reconcile/poll after archive, preserve EditVideos as source of truth |

## Implementation Order

1. Add read-only bridge helpers and manifest normalization.
2. Add admin route actions for manifest/sources/estimate.
3. Add card shell and Manifest/Cost tabs.
4. Add single-video archive action.
5. Mirror archive result to `dashboard_state.archivePublishing`.
6. Add Archive tab file selection and polling.
7. Add batch/source-folder archive.
8. Add website deploy estimate.
9. Add website deploy.
10. Add ArNS update/retry.
11. Add client delivery read-only mode.

## MVP Definition

The first usable MVP is smaller than the whole card:

1. Admin opens `archive-publishing`.
2. Admin selects one completed Video Remix MP4.
3. HITLOOP estimates archive cost.
4. Admin confirms archive.
5. The file is uploaded to Arweave.
6. Dashboard shows transaction ID, Arweave URL, Turbo URL, and archived timestamp.
7. The archive result persists after refresh.

Do not start website deploy or ArNS UI until this MVP is working.

## Final Acceptance Criteria

- `archive-publishing` card exists for admins.
- Archive tab can archive selected finished videos and source files.
- Manifest tab shows archived files, transaction IDs, Arweave URLs, Turbo URLs, timestamps, and status.
- Website Deploy tab can estimate and deploy the configured site to Arweave.
- ArNS tab can update or retry the pointer for the latest manifest.
- Cost tab can estimate selected archive batches and website deploy diffs.
- All mutation actions are admin-only.
- No media bytes pass through client-facing dashboard routes unless a file-size-safe exception is explicitly documented.
- Archive/deploy failures are visible, retryable, and do not corrupt existing dashboard state.
- `npm test` and `npm run build` pass.
