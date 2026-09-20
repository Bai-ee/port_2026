# Permanent Archive Contract (W7a, 2026-09-20)

Owner-locked direction: **no per-asset approval click, no collection form.**
Once an asset is documented (hashed, TwelveLabs evidence READY, six Jev
decisions present), the system uploads the original + a per-asset archive
record JSON to Arweave automatically, rebuilds the collection manifest, and
the human reviews AFTER as corrections that mint new record versions. There
is no rights hold: everything uploads. **The Arweave wallet lives only on
the worker; HITLOOP never uploads bytes itself** — HITLOOP only queues
`archive_commands` and the worker executes them.

This supersedes the old click-through flow (`ARWEAVE CHECKPOINT` card:
per-asset "UPLOAD APPROVED ORIGINALS" button, collection-id text field,
"APPROVE + ARCHIVE MANIFEST" button). Those routes
(`app/api/archive/arweave/{assets,upload}/route.js`, the legacy body of
`app/api/archive/arweave/collection/route.js`) still exist and still work,
but the `/archive` page no longer calls them — kept only for compatibility.
Real logic lives in `api/_lib/archive-permanent-archive.cjs`; every route
below is a thin wrapper around it (same pattern as
`archive-worker-intake.cjs` + `app/api/archive/worker/intake/route.js`).

## Command type: `UPLOAD_JSON`

A new `archive_commands` document type, alongside `PROCESS_COLLECTION`,
`LIST_DIRECTORY`, and `UPLOAD_ASSET_ARWEAVE`:

```
{
  type: 'UPLOAD_JSON',
  workerId: string,
  kind: 'archive-record' | 'collection-manifest' | 'viewer',
  fileName: string,
  contentType: 'application/json' | 'text/html',
  payload: object,       // JSON kinds: the record/manifest object itself
                          // 'viewer' kind: the HTML string
  tags: [{name, value}],
  refs: {
    contentAssetId?: string,     // archive-record only
    collectionId?: string,       // archive-record + collection-manifest
    version?: number,
    previousTransactionId?: string,
    sha256?: string,             // viewer only (of the HTML)
    title?: string,              // collection-manifest only (echoed back
                                  // into archive_collections on COMPLETE)
    assetCount?: number,         // collection-manifest only
    uploadedCount?: number,      // collection-manifest only
  },
  state: 'QUEUED' | 'CLAIMED' | 'RUNNING' | 'COMPLETE' | 'FAILED',
  createdAt, updatedAt,
}
```

The worker claims it like any other command, uploads `payload` to Arweave
with `tags`, and PATCHes `app/api/archive/commands/worker` with
`state:'COMPLETE'` and:

```
result: { transactionId, arweaveUrl, sizeBytes, kind, fileName, refs }
```

### Tags (`buildUploadJsonTags`, `api/_lib/archive-permanent-archive.cjs`)

| Tag | Value |
|---|---|
| `App-Name` | `HITLOOP-Archive` |
| `Archive-Schema` | `1.1` |
| `Record-Type` | `<kind>` |
| `Content-Type` | the command's `contentType` |
| `Version` | `<version>` |
| `Collection-ID` | `<collectionId>` (when known) |
| `Asset-SHA-256` | `<sha256>` (archive-record only) |
| `Previous-Tx` | `<previousTransactionId>` (when a previous version exists) |

### COMPLETE handler (`app/api/archive/commands/worker/route.js` -> `handleCommandComplete`)

| `kind` | Writes |
|---|---|
| `archive-record` | Upserts `archive_records/{contentAssetId}` `{version, transactionId, previousTransactionId, arweaveUrl, collectionId, updatedAt}`; mirrors `recordTransactionId`/`recordVersion` onto `archive_review/{id}`. Re-checks `dirty` (see Debounce below); always calls `maybeRebuildManifest(collectionId)`. |
| `collection-manifest` | Upserts `archive_collections/{collectionId}` `{manifestVersion, manifestTransactionId, previousManifestTransactionId, manifestUrl, assetCount, uploadedCount, title, state:'ARCHIVED', updatedAt}`. Re-checks `dirty`. |
| `viewer` | Sets `archive_settings/viewer` `{transactionId, arweaveUrl, uploadedAt, sha256}`. |

`UPLOAD_ASSET_ARWEAVE` COMPLETE still writes `archive_uploads/{transactionId}`
(`kind:'original'`, unchanged shape + a new `workerId` field), then calls
`enqueueNextRecordVersionIfNeeded` — which is exactly how the asset's first
archive-record (v1) gets created.

## Schema C — archive record (per asset), 1.1

Built by `api/_lib/archive-record.cjs` `buildArchiveRecord({review, upload,
version, previousTransactionId})`. **Never includes NAS paths** — only a
basename (`asset.archiveName`) and a location count
(`provenance.sourceCount`).

```
{
  schemaVersion: '1.1',
  recordType: 'archive-record',
  version: number,
  previousRecordTransactionId: string | null,
  asset: {
    id, sha256, sizeBytes, mediaType, contentType, archiveName,
    originalTransactionId, originalUrl,
  },
  collection: { id, title },
  provenance: {
    sourceCount: number,           // how many places this asset was found, not where
    sourceSystem: 'HITLOOP Archive',
    originalsReadOnly: true,
    contentAddressing: 'sha256',
  },
  evidence: [{ provider: 'twelvelabs', kind: 'video_understanding', summary, status, at }],
  decisions: [{
    id, question,
    value,                          // the human-corrected value when one
                                     // exists, else Jev's own pick
    jev: { value, confidence, reviewBand, choices },
    human: { value, at } | null,
  }],
  corrections: [{ decisionId, previousValue, value, actor, at }],
  generatedAt,
}
```

`value` resolution (`resolveDecisionValue`, also reused by the manifest
builder): `humanConfirmations[decisionId]` if present, else
`decision.selectedValue`.

## Schema D — collection manifest, 1.1

Built by `api/_lib/archive-manifest.cjs` `buildCollectionManifestV11`. Each
asset row is already-resolved by the caller
(`api/_lib/archive-permanent-archive.cjs` `rebuildManifest`) from
`archive_review` + `archive_uploads` + `archive_records` for that
collection.

```
{
  schemaVersion: '1.1',
  recordType: 'collection-manifest',
  version: number,
  previousManifestTransactionId: string | null,
  collection: { id, title, generatedAt },
  assets: [{
    id, sha256, sizeBytes, mediaType, contentType, archiveName,
    originalTransactionId, originalUrl,   // the original media file's own tx
    recordTransactionId, recordVersion,   // that asset's own archive-record JSON
    decisions: [{ id, question, value }],
  }],
  viewerTransactionId: string | null,
  provenance: { sourceCount, sourceSystem, originalsReadOnly, contentAddressing },
  // provenance.sourceCount at the manifest level is an aggregate proxy —
  // "how many distinct content assets this manifest vouches for"
  // (rows.length) — not a sum of NAS locations. Each asset's own location
  // count lives only in that asset's archive-record JSON (schema C).
}
```

`buildCollectionManifest` (schema 1.0, the old shape) is kept, unchanged,
for its existing callers/tests — it is not used by the automatic path.

## Collection identity — derived, never typed

```
id    = slug(job.relativePath)   // lowercase, non-alnum -> '-', trimmed; '.' -> 'root'
title = last path segment, as-is // '.' -> 'root'
```

`resolveCollectionForJob({collectionJobId})` resolves: the worker's asset
sync carries `collectionJobId`; the matching `PROCESS_COLLECTION` command
doc carries both `jobId` (set once the generic commands/worker PATCH sees
`CLAIMED`) and `relativePath`. `collectionId`/`collectionTitle` are stored
on the `archive_review` doc at sync time
(`app/api/archive/worker/assets/route.js`), read-before-write so a resync
that fails to resolve the collection never blanks a value a prior sync
already set.

## State flow

```
worker/assets sync (>=1 READY observation, >=6 decisions, >=1 non-junk
location, no active UPLOAD_ASSET_ARWEAVE command)
  -> auto-enqueue UPLOAD_ASSET_ARWEAVE (autoEnqueueArchiveUpload)
  -> worker uploads original to Arweave
  -> COMPLETE: archive_uploads write + enqueueNextRecordVersionIfNeeded
  -> auto-enqueue UPLOAD_JSON kind=archive-record v1
  -> worker uploads record JSON to Arweave
  -> COMPLETE: archive_records + archive_review mirror
  -> maybeRebuildManifest(collectionId)
       (no UPLOAD_ASSET_ARWEAVE / archive-record commands left QUEUED/
        CLAIMED/RUNNING for this collection)
  -> auto-enqueue UPLOAD_JSON kind=collection-manifest v1
  -> worker uploads manifest to Arweave
  -> COMPLETE: archive_collections upsert, state:'ARCHIVED'

Human correction (PATCH /api/archive/review) at any point after v1:
  -> appendReviewCorrection: humanConfirmations + humanCorrections[] append
  -> enqueueNextRecordVersionIfNeeded (guarded by the debounce below)
  -> ... same record -> manifest chain repeats for the new version
```

Junk files (`._*` AppleDouble resource forks, `.DS_Store`) are filtered out
of the *auto-enqueue decision* only (an asset whose only locations are junk
never gets uploaded) — they are not stripped from the stored
`archive_review.sourcePaths` itself; skipping their *discovery* entirely is
a separate, worker-side (assetManager repo) follow-up.

## Debounce rules

Both the per-asset record and the per-collection manifest use the same
pattern: **never enqueue a second command while one is in flight; mark the
existing doc `dirty:true` instead, and let that in-flight command's own
COMPLETE handler notice `dirty` and re-trigger.**

- **archive-record**: `enqueueNextRecordVersionIfNeeded` checks
  `hasActiveArchiveRecordCommand(contentAssetId)` (any `UPLOAD_JSON`
  `kind:'archive-record'` command for that asset in
  `QUEUED`/`CLAIMED`/`RUNNING`). If active, sets `archive_records/{id}.dirty
  = true` and returns without enqueueing. The archive-record COMPLETE
  handler re-checks `dirty`; if set, clears it and calls
  `enqueueNextRecordVersionIfNeeded` again (producing the *next* version,
  chained off the transaction that just completed).
- **collection-manifest**: `maybeRebuildManifest` checks for any
  in-flight `UPLOAD_ASSET_ARWEAVE` or archive-record `UPLOAD_JSON` command
  for the collection first (if any, it's not time yet — no dirty flag
  needed, a later COMPLETE will call `maybeRebuildManifest` again). If none,
  but a `collection-manifest` `UPLOAD_JSON` command is itself already in
  flight, it sets `archive_collections/{id}.dirty = true` instead of
  double-enqueueing. The manifest COMPLETE handler re-checks `dirty`; if
  set, clears it and calls `maybeRebuildManifest` again (which re-applies
  its own gate before actually rebuilding).

This makes both chains convergent and idempotent under concurrent
completions/corrections without ever needing a lock: at most one command of
each kind is ever in flight per asset/collection, and the dirty flag
guarantees the *last* change always eventually produces one more version.

## Viewer deploy

`POST /api/archive/arweave/collection` `{action:'deploy-viewer'}` ->
`deployViewerIfChanged()`: reads `public/archive-viewer/index.html` off
disk, hashes it (sha256), compares to `archive_settings/viewer.sha256`.
Same hash -> `{skipped:true, ...}`, no command. Different/missing -> picks
the most-recently-heartbeated worker and enqueues `UPLOAD_JSON
kind:'viewer'`.

`POST /api/archive/arweave/collection` `{action:'rebuild-manifest',
collectionId}` -> `rebuildManifestManual({collectionId})`: an explicit,
ungated fallback (bypasses the in-flight check) for when an operator wants
to force a rebuild.

## Page

`/archive`'s `PERMANENT ARCHIVE` status card (`#archive-permanent-status-panel`,
list `#archive-permanent-collections-list`, viewer row
`#archive-permanent-viewer-row`) is a **read-only aggregate**
(`GET /api/archive/approved?summary=1` -> `getPermanentArchiveSummary()`
in `api/_lib/archive-permanent-archive.cjs`) over `archive_collections` +
`archive_review` + `archive_uploads` + `archive_records` + `archive_commands`
+ `archive_settings/viewer`, plus the two explicit admin actions above. It
replaced the old `ARWEAVE CHECKPOINT` card (collection-id/title inputs,
per-asset upload button, quote button, finalize button) — there is nothing
left to approve.

The Human Review panel (`Jev decisions · corrections mint a new record
version`) is unchanged in mechanism (`archive_review` state machine,
`humanConfirmations`) except: state no longer gates anything, and
`PATCH /api/archive/review` now also appends to `humanCorrections[]`
(`{decisionId, previousValue, value, actor, at}`, audit trail) and returns
`recordVersionQueued: <n> | null`, which the page surfaces as `record v<n>
queued`.
