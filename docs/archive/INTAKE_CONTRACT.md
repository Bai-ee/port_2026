# Archive Lane 2 Intake Contract (W2, 2026-09-20)

Lane 2 = a single image/video uploaded from a phone on `/archive`. It lands
transiently in Firebase Storage — **HITLOOP's own default bucket**
(`intakeBucket()` in `api/_lib/archive-intake-bucket.cjs`, via
`fb.adminStorage.bucket()` off `api/_lib/firebase-admin.cjs`'s `adminApp`),
under prefix `archive-intake/{intakeId}/{safeFileName}`. An `archive_intake`
Firestore doc tracks its lifecycle. The NAS worker (W3, a separate
agent/repo) polls, claims, downloads, runs the identical hash → dedupe →
analyze → review → Arweave pipeline Lane 1 uses, and is the **only** thing
that ever deletes the Firebase object — and only after that asset's Arweave
upload succeeds.

**Storage note (2026-09-20, revised from the original plan):** the plan
originally called for reusing the EditVideos-bridge bucket
(`bridgeBucket()` in `api/_lib/editvideos-bridge.cjs`, same one Media
Library uploads to). A live localhost test found `bridgeBucket()` fails in
this environment — the EditVideos service-account key
(`EDITVIDEOS_FIREBASE_SERVICE_ACCOUNT_KEY`) is rejected by Google
(`invalid_grant: Invalid JWT Signature`), so `POST /api/archive/intake`
503'd before minting a URL. Lane 2 now uses HITLOOP's own default bucket
instead — it works in this environment, already carries a CORS entry for
`http://localhost:3000`, and is the cleaner ownership boundary anyway:
archive intake data belongs in HITLOOP's project, not EditVideos'. The
storage **path prefix is unchanged** (`archive-intake/{intakeId}/{safeFileName}`).
CORS is ensured by `ensureIntakeCors()` (same file), which **merges** a
single rule for `http://localhost:3000`, `https://hitloop.agency`,
`https://www.hitloop.agency`, and `NEXT_PUBLIC_SITE_URL` (if set) into the
bucket's existing CORS config — it never replaces or drops any other rule
already on the bucket — and skips the write entirely when an existing rule
already covers every required origin/method/header. Success is memoized for
the life of the process.

This mirrors master plan decisions D1–D4:
Firebase is an inbox, never a library (D3); nothing here ever touches the NAS
(D1); both lanes converge on the same pipeline (D2); all hashing/Arweave
streaming happens in the worker, never inside a Vercel function (D4).

Owned by HITLOOP (this repo). Published first so W3 (assetManager /
NAS worker) can build against it without waiting on the UI.

## Firestore: `archive_intake/{intakeId}`

| Field | Type | Set by | Notes |
|---|---|---|---|
| `state` | string | both | see State machine below |
| `storagePath` | string | HITLOOP (create) | `archive-intake/{intakeId}/{safeFileName}` |
| `fileName` | string | HITLOOP (create) | original name as reported by the browser, truncated to 256 chars; display only |
| `contentType` | string | HITLOOP (create) | must be `image/*` or `video/*` |
| `sizeBytes` | number | HITLOOP | browser-reported at create; overwritten with the real Storage byte count once `markUploaded` can read `file.getMetadata()` |
| `sha256` | string \| null | worker | `null` until the worker PATCHes it in at `HASHED` |
| `contentAssetId` | string \| null | worker | `null` until the worker sets it (the `content_assets` record this upload resolved to after dedupe) |
| `createdBy` | `{uid, email}` \| null | HITLOOP (create) | from the verified admin ID token |
| `claimedBy` | string \| null | worker | workerId, set on the `UPLOADED → CLAIMED` transition |
| `error` | string \| null | worker | set on `FAILED`; may be explicitly cleared (`null`) on a later successful transition |
| `createdAt` | Timestamp | HITLOOP (create) | server timestamp |
| `updatedAt` | Timestamp | both | server timestamp, bumped on every write |

### State machine

```
PENDING_UPLOAD --(browser PATCH, object must exist in Storage)--> UPLOADED
UPLOADED       --(worker PATCH)--> CLAIMED
CLAIMED        --(worker PATCH, requires sha256)--> HASHED
HASHED         --(worker PATCH)--> REVIEWED
REVIEWED       --(worker PATCH)--> ARCHIVED
ARCHIVED       --(worker DELETE only)--> PURGED
any state      --(worker PATCH, error required)--> FAILED
```

`ARCHIVED → PURGED` is deliberately **not** a PATCH target — purging has the
required side effect of deleting the Storage object, so it only happens
through the DELETE route. Pure transition rules live in
`api/_lib/archive-intake-transitions.cjs` (no Firebase dependency, unit
tested directly).

### Purge rule

The worker deletes the Firebase object **only** once that intake doc reaches
`ARCHIVED` for the matching `sha256` — i.e. after `UPLOAD_ASSET_ARWEAVE`
completes for that asset in the worker's own pipeline. This route only
enforces the state precondition (`ARCHIVED`) and ownership (`claimedBy`
matches the caller); it trusts the worker to have actually confirmed the
Arweave upload before calling DELETE, exactly as it does for Lane 1 assets.
Until purged, the object stays — a crash or a retry never orphans an
unarchived original.

## Routes

| Route | Method | Caller / auth | Request | Response | Notes |
|---|---|---|---|---|---|
| `/api/archive/intake` | POST | Admin (Firebase ID token, `verifyAdminRequest` — same as `browse`) | `{fileName, contentType, sizeBytes}` | `201 {ok, intakeId, uploadUrl, method:'PUT', contentType, storagePath}` | Creates the doc in `PENDING_UPLOAD`, mints a 15-min v4 signed PUT URL bound to `contentType`. Rejects a `contentType` that isn't `image/*`/`video/*`, or `sizeBytes` over 50MB (image) / 500MB (video) — mirrors Media Library's own caps. |
| `/api/archive/intake` | PATCH | Admin | `{intakeId, state:'UPLOADED', sizeBytes}` | `200 {ok, intakeId, state:'UPLOADED'}` | Only `state:'UPLOADED'` is accepted from the browser (any other value is `400`). Verifies the object exists in Storage (`file.exists()`) before flipping state — `409` if the upload hasn't actually landed yet. Idempotent if already `UPLOADED`. |
| `/api/archive/intake` | GET | Admin | `?limit=` (1–50, default 20) | `200 {items:[...]}` | Recent intake docs, newest first, for the Quick Ingest panel's recent list. |
| `/api/archive/worker/intake` | GET | Worker (`Authorization: Bearer HITLOOP_ARCHIVE_WORKER_TOKEN`, same check as `worker/heartbeat`) | `?workerId=` | `200 {items:[{intakeId, storagePath, fileName, contentType, sizeBytes, downloadUrl, createdAt}]}` | Every `UPLOADED` doc, each with a fresh 30-min signed GET URL. `workerId` is required for parity/logging with every other worker route — it is not a claim filter; nothing is assigned to a worker until it PATCHes `CLAIMED`. |
| `/api/archive/worker/intake` | PATCH | Worker | `{intakeId, workerId, state, sha256?, contentAssetId?, error?}` | `200 {ok, intakeId, state}` | One validated transition (see State machine). Re-reads the doc's current state server-side — never trusts a client-claimed `fromState`. `409` on an illegal jump or on a doc claimed by a different worker (except reporting `FAILED`, which any worker may do). `400` if `HASHED` is requested with no `sha256` on the payload or already on the doc. |
| `/api/archive/worker/intake` | DELETE | Worker | `{intakeId, workerId}` | `200 {ok, intakeId, state:'PURGED'}` | Only from `ARCHIVED`; `409` otherwise or on an ownership mismatch. Deletes the Storage object (`ignoreNotFound: true` — already-gone is not an error) then sets `PURGED`. |

All four routes return `{error}` with a matching HTTP status (`400`
validation, `401`/`403` auth, `404` not found, `409` invalid
transition/ownership, `503` CORS-config failure) on failure.

## Client

`components/archive/QuickIngestPanel.jsx`, mounted in `app/archive/page.jsx`
directly under "Process a Collection". Single file at a time
(`accept="image/*,video/*"`), uses the page's own `authedFetch` (no second
auth path), progress bar via `lib/dashboard/upload-signed-url.js`'s
`uploadFileToSignedUrl` (extracted byte-for-byte from
`MediaLibraryCard.jsx`, which now imports it from the same place — no
behavior change there). Flow: POST mint → XHR PUT → PATCH confirm → refresh
recent list. No `confirm()`/`alert()` dialogs; errors render inline in the
progress row's status text.

DOM ids: `archive-quick-ingest-panel` (root), `archive-quick-ingest-dropzone`,
`archive-quick-ingest-progress-row`, `archive-quick-ingest-recent-list`.
