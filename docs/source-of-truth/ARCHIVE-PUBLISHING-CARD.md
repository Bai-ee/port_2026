# Archive / Publishing Card — As-Built Source of Truth

Last verified: 2026-06-25 against `main` (working tree).
Scope: the admin-only **Archive / Publishing** dashboard card (`archive-publishing`) in the **Knowledge Officer** bucket. It archives approved media/videos to Arweave, inspects the archive manifest, estimates cost, deploys the Arweave microsite, and manages the ArNS pointer.

Frozen plan it implements: [`docs/plans/ARCHIVE_PUBLISHING_CARD_PLAN.md`](../plans/ARCHIVE_PUBLISHING_CARD_PLAN.md). If this doc and the plan disagree, **this doc wins** (the plan is the pre-build spec; this is what shipped).

> Companion doc: [`VIDEO-REMIX-EDITVIDEOS-BRIDGE.md`](VIDEO-REMIX-EDITVIDEOS-BRIDGE.md) — same cross-project bridge model. Read it first if you are new to the EditVideos integration.

---

## 1. What it is

One card, one tile-detail modal, **five tabs**: `Archive · Manifest · Website · ArNS · Cost`. Admin-only in v1 — every wallet-funded/irreversible action is gated server-side and confirmed in the UI (estimate-first).

HITLOOP does **not** run Arweave/Turbo uploads or website deploys. Those wallet-funded, permanent operations live in the **EditVideos deployed app**. HITLOOP:
- **reads** the EditVideos `archiveManifest` / `archiveJobs` Firestore docs directly through the named bridge admin app (read-only), and
- **proxies** the mutations (archive upload, deploy, ArNS) over HTTP to the EditVideos app via `EDITVIDEOS_API_BASE`.

This is the same "HITLOOP carries metadata + status; EditVideos is system of record" pattern as Video Remix.

---

## 2. Files (the whole feature)

| Layer | File | What it owns |
|---|---|---|
| Bridge | `api/_lib/editvideos-bridge.cjs` | Archive/deploy/arns/cost helpers + **pure** normalizers (firebase-free, unit-tested). |
| Projection | `api/_lib/archive-publishing-projection.cjs` | **Pure** mapping of results → `dashboard_state.archivePublishing` shape. |
| Route | `app/api/dashboard/media/route.js` | 8 actions; admin-gated mutations; mirrors results into `dashboard_state`. |
| Card + UI | `DashboardPage.jsx` | Card object (`id: 'archive-publishing'`, `category: 'knowledge'`), 5-tab modal, state, handlers, `.apk-scope` CSS in the `dashboardCss` template literal. |
| Tests | `api/_lib/__tests__/archive-publishing.test.js` | 14 cases over the pure fns (cost, manifest/source normalization, deploy map, projection). |

Join key across the system: there is **no** `cardId` scout-module path here — this is a **direct admin action** card (producer path = dashboard route, not the scout pipeline). Do not add it to `module-registry.js` or `projectModuleResult`.

---

## 3. Bridge helpers (`editvideos-bridge.cjs`)

Pure (no firebase — safe to unit-test and call from the route):
- `costForBytes(bytes, arPriceUSD)` / `summarizeArchiveCost(files, arPriceUSD)` — mirror EditVideos `ArweaveCostCalculator` rates (`0.0001 AR/MB`, `$0.10/MB` approx).
- `normalizeArchiveManifest(raw)` → `{ source, version, lastUpdated, folders, entries[] }` (flat, newest-first, derives `arweaveUrl` from txid).
- `normalizeArchiveSources({ mediaCaptures, studioCaptures, folderFiles })` → typed selectable rows (`source ∈ mediaCaptures|studioCaptures|editvideosFolder`).
- `mapDeployResult(raw)` / `mapDeployEstimate(raw)`.

Impure (reach EditVideos):
- `getArchiveManifest()` — reads `archiveManifest/main` via bridge app. Degrades to empty.
- `getArchiveJob(archiveJobId)` — reads `archiveJobs/{id}`.
- `getArPriceUSD()` — CoinGecko, `$10/AR` fallback (5-min cache).
- `estimateArchiveFiles(files)` — live AR price × `summarizeArchiveCost`.
- `archiveFirebaseFile({ folder, fileName })` — `POST {EDITVIDEOS_API_BASE}/api/archive-upload`.
- `estimateWebsiteDeploy({ websiteDir })` — `GET {EDITVIDEOS_API_BASE}/api/deploy-website`.
- `deployWebsite({ websiteDir })` — `POST {EDITVIDEOS_API_BASE}/api/deploy-website` (does ArNS inline on the EditVideos side).
- `updateArns({ manifestId })` — `POST {EDITVIDEOS_API_BASE}/api/update-arns`. **Optional endpoint**: EditVideos performs ArNS inside deploy, so a standalone retry endpoint may not exist — returns `501` ("redeploy to refresh the pointer") if absent, never crashes.

`requireApiBase()` throws `503` when `EDITVIDEOS_API_BASE` is unset → the card shows a disabled state instead of failing.

---

## 4. Route API (`app/api/dashboard/media/route.js`)

All actions hang off the existing metadata-only media route (reuses auth/client resolution). **Mutations are admin-only** via `isAdminEmail(decoded.email)` — resolved from the verified token, not the impersonation flag, so a real admin on their own dashboard passes.

```txt
GET  /api/dashboard/media?action=archive-sources[&folder=<name>]   admin
GET  /api/dashboard/media?action=archive-manifest                  admin
GET  /api/dashboard/media?action=archive-job&jobId=<id>            admin
GET  /api/dashboard/media?action=website-deploy-estimate           admin
POST /api/dashboard/media?action=archive-estimate   {files:[]}     admin
POST /api/dashboard/media?action=archive-to-arweave {files:[]}     admin (mutation)
POST /api/dashboard/media?action=deploy-website     {websiteDir?}  admin (mutation)
POST /api/dashboard/media?action=update-arns        {manifestId}   admin (mutation)
```

- The POST guard catches any `archive-*` action plus `deploy-website` / `update-arns` (set `ARCHIVE_MUTATIONS`); existing `create-video-remix` / upload actions are untouched.
- `archive-to-arweave` creates one `media_jobs` doc (`type: 'arweave-archive'`) for the batch, archives each file in series, supports **partial success** (`done` / `partial` / `failed`), and mirrors per-file results.
- `update-arns` records `arnsError` on failure and **never erases** `latestDeployment` success.
- `writeArchivePublishing(clientId, mutate)` = transactional merge into `dashboard_state.{clientId}.archivePublishing`.

---

## 5. Data model — `dashboard_state.archivePublishing`

Written by the route (via the pure projection helpers); read by the card. Shape (see plan §"Proposed Data Model" for full field list):

```js
archivePublishing: {
  latestArchiveJob: { jobId, status, queuedAt, completedAt, fileCount, error },
  archivedAssets: [ { label, source, sourceJobId, sourcePath, transactionId,
                      arweaveUrl, turboUrl, fileSize, contentType, status, archivedAt } ],
  manifest:     { source:'editvideos', version, lastUpdated, folders },  // mirror (optional)
  costEstimate: { mode:'archive'|'website-deploy', fileCount, sizeBytes, costAR, costUSD, ... },
  latestDeployment: { deploymentId, status, manifestId, arweaveUrl, arnsUrl,
                      filesUploaded, filesUnchanged, totalFiles, costEstimate,
                      deployedAt, arnsUpdatedAt, arnsError },
}
```

`mergeArchivedAssets` dedupes on `transactionId` (fallback `sourcePath`), caps to the last 60. `assetSourceFor` maps row `source` → asset `source` enum (`video-remix` / `studio-render` / `source-media`).

---

## 6. Frontend (`DashboardPage.jsx`)

- **Card object**: `category: 'knowledge'` → renders in the Knowledge Officer bucket grid (filter is by `card.category`). `adminOnly: true` is declarative; real gating = not listed in `NON_ADMIN_UNLOCKED_CARD_IDS` + the `knowledge` bucket being in `NON_ADMIN_LOCKED_NAV_KEYS`.
- **Modal**: registered in `CUSTOM_DETAIL_CARD_IDS` (no generic REPORT/DATA container). Block keyed on `activeTileModal.cardId === 'archive-publishing'`. Tabs driven by `modalTab ∈ archive|manifest|website|arns|cost`; default set in the modal-tab init effect.
- **DOM**: container `#archive-publishing-modal-tabs-container.apk-scope`. CSS scope `.apk-*` lives in the `dashboardCss` template literal (NOT `dashboard.css`).
- **State/handlers** (component scope): `refreshArchiveSources`, `loadArchiveFolders`, `refreshArchiveManifest`, `runArchiveEstimate`, `runArchiveSelected`, `runDeployEstimate`, `runDeployWebsite`, `runUpdateArns`; an open-effect loads sources + manifest when the modal mounts.

---

## 7. Required env (live operation)

| Var | Purpose |
|---|---|
| `EDITVIDEOS_API_BASE` | Base URL of the deployed EditVideos app (archive-upload / deploy-website / update-arns). **New for this feature.** |
| `EDITVIDEOS_FIREBASE_SERVICE_ACCOUNT_KEY`, `EDITVIDEOS_FIREBASE_BUCKET` | Existing bridge creds — read `archiveManifest` / `archiveJobs` + list source folders. |
| `EDITVIDEOS_ARNS_NAME` (optional) | Surfaced as the configured ArNS name when the deploy result omits it. |

Unset `EDITVIDEOS_API_BASE` ⇒ reads degrade to empty/disabled, mutations return a clear `503`. No crash.

---

## 8. How to extend (recipes)

- **Add an archive source type**: extend `normalizeArchiveSources` (new `source` value) + add a segmented button in the Archive tab + map it in `assetSourceFor`.
- **Make a sub-flow client-visible (plan Phase 7)**: add a `visibleToClient` flag per asset, add the card id to `NON_ADMIN_UNLOCKED_CARD_IDS`, and render a read-only mode hiding wallet/deploy/ArNS/retry controls.
- **Move large-file archive off Vercel**: today `archive-to-arweave` calls the EditVideos handler (its existing behavior). If big files time out, switch to a worker-backed archive (mirror the `media_jobs` lease pattern in `api/_lib/media-jobs.cjs`).
- **Touch the pure fns?** They are covered by `api/_lib/__tests__/archive-publishing.test.js` — update tests alongside.

## 9. Verification

`npm test` (561 incl. 14 new) + `npm run build` both pass as of 2026-06-25. Live archive/deploy/ArNS against real EditVideos endpoints is `⚠ops` — requires `EDITVIDEOS_API_BASE` + an admin session and cannot be confirmed from this repo.
