# Permanent Archive Viewer

`public/archive-viewer/index.html` is intentionally a zero-build static application.

## Permanent deployment

After an approved collection has been finalized:

1. Upload every original asset to Arweave.
2. Upload the generated collection manifest and record its transaction ID.
3. Upload this viewer HTML itself to Arweave with `Content-Type: text/html`.
4. Open the viewer transaction with `?manifest=<collection-manifest-tx>`.

The viewer fetches the manifest and originals from `https://arweave.net` only. It has no
Firebase, HITLOOP API, wallet, or authentication dependency.

For the POC the viewer is also reachable through HITLOOP at `/archive-viewer/` so its UI can
be tested before its own permanent Arweave transaction is created.

## Integrity

The manifest records the SHA-256 approved before upload. The NAS worker re-hashes the original
immediately before Turbo upload and refuses changed bytes. The viewer labels an asset
`SHA-256 VERIFIED` to mean this pre-upload invariant was satisfied; it does not currently
download and re-hash the asset in the browser.
