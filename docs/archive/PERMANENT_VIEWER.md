# Permanent Archive Viewer

`public/archive-viewer/index.html` is intentionally a zero-build static application.

## Permanent deployment (W7a, command-based)

There is no manual per-collection finalize step anymore — see
`docs/archive/PERMANENT_ARCHIVE_CONTRACT.md`. The three transactions this
viewer needs (originals, manifest, the viewer HTML itself) are produced by
`UPLOAD_JSON`/`UPLOAD_ASSET_ARWEAVE` `archive_commands` the worker executes;
HITLOOP only enqueues them.

1. Originals and per-asset archive-record JSON upload automatically once an
   asset is documented (hashed, TwelveLabs evidence READY, six Jev
   decisions) — no click.
2. The collection manifest rebuilds automatically once every in-flight
   upload for that collection settles (`maybeRebuildManifest` in
   `api/_lib/archive-permanent-archive.cjs`), or can be forced from the
   `/archive` page's `PERMANENT ARCHIVE` card ("REBUILD MANIFEST").
3. This viewer HTML itself is **not** auto-deployed (it doesn't change per
   collection) — click "DEPLOY VIEWER" on the same card, which calls
   `POST /api/archive/arweave/collection {action:'deploy-viewer'}`. That
   reads `public/archive-viewer/index.html` off disk, hashes it, and skips
   the upload entirely if `archive_settings/viewer.sha256` already matches
   (no-op re-deploy of unchanged HTML).
4. Open the viewer transaction with `?manifest=<collection-manifest-tx>`
   (the `/archive` page's OPEN VIEWER link builds this URL once both
   transactions are known:
   `https://arweave.net/<viewer-tx>?manifest=<manifest-tx>`).

The viewer fetches the manifest and originals from `https://arweave.net` only. It has no
Firebase, HITLOOP API, wallet, or authentication dependency.

For the POC the viewer is also reachable through HITLOOP at `/archive-viewer/` so its UI can
be tested before its own permanent Arweave transaction is created — the `/archive` page's OPEN
VIEWER link falls back to `/archive-viewer/index.html?manifest=<tx>` until a viewer transaction
exists.

## Integrity

The manifest records the SHA-256 approved before upload. The NAS worker re-hashes the original
immediately before Turbo upload and refuses changed bytes. The viewer labels an asset
`SHA-256 VERIFIED` to mean this pre-upload invariant was satisfied; it does not currently
download and re-hash the asset in the browser.
