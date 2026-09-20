# Permanent Archive Viewer

`public/archive-viewer/index.html` is intentionally a zero-build static application: plain
HTML/CSS/JS, no bundler, no framework, no external scripts or fonts. Its only network
dependency is `https://arweave.net`.

## What it shows

Given a collection manifest transaction ID (`?manifest=<tx>` or pasted into the input box),
the viewer:

- Renders a collection header (`#viewer-collection-header`): title, schema version (labeled
  `schema 1.0 (legacy)` when the manifest predates 1.1), manifest version, generatedAt, asset
  count, total size, the manifest transaction ID itself, and a link to the previous manifest
  version when one exists (`?manifest=<previousManifestTransactionId>`).
- Renders one card per asset (`#viewer-asset-list`): archive name, media/content type, size,
  a click-to-reveal/copy SHA-256, an "open original" link, an inline lazy preview for
  image/* and video/* originals, the asset's current decision values, and a "record vN" link
  when the asset has an archive record.
- Fetches an asset's archive record on demand and opens it in a drawer
  (`#viewer-record-drawer`): evidence summaries, each decision's Jev value (confidence +
  review band) vs. the human-corrected value when present, the corrections trail, and a
  "previous version" link that walks `previousRecordTransactionId` back through history (up
  to 10 hops).
- Filters/searches (`#viewer-filter-row`): free-text search over archive name + decision
  values, chips per distinct "content pillar" decision value present in the collection, and a
  "has corrections" toggle.
- Handles the empty state (no `?manifest=`, shows instructions), fetch failures (error +
  retry), and legacy v1.0 manifests (renders what exists, labeled legacy).

## Schemas

**Collection manifest 1.1** (`recordType: 'collection-manifest'`):

```
{
  schemaVersion: '1.1', recordType: 'collection-manifest', version,
  previousManifestTransactionId,
  collection: { id, title, generatedAt },
  assets: [{
    id, sha256, sizeBytes, mediaType, contentType, archiveName,
    originalTransactionId, originalUrl, recordTransactionId, recordVersion,
    decisions: [{ id, question, value }]
  }],
  viewerTransactionId | null,
  provenance: { sourceCount?, sourceSystem, originalsReadOnly, contentAddressing }
}
```

**Archive record 1.1** (`recordType: 'archive-record'`, fetched lazily per asset from
`https://arweave.net/<recordTransactionId>`):

```
{
  schemaVersion: '1.1', recordType: 'archive-record', version,
  previousRecordTransactionId,
  asset: { ... },
  collection: { id, title },
  provenance,
  evidence: [{ provider, kind, summary, status, at }],
  decisions: [{
    id, question, value,
    jev: { value, confidence, reviewBand, choices },
    human: { value, at } | null
  }],
  corrections: [{ decisionId, previousValue, value, actor, at }],
  generatedAt
}
```

The viewer also still reads **collection manifest 1.0** (`buildCollectionManifest` in
`api/_lib/archive-manifest.cjs`): no `version`/`previousManifestTransactionId`/
`recordTransactionId`, assets keyed by `transactionId`/`arweaveUrl` instead of
`originalTransactionId`/`originalUrl`, and decisions carrying `selectedValue` instead of
`value`. A 1.0 manifest renders normally, labeled `schema 1.0 (legacy)`.

A "content pillar" chip is any decision whose `id` or `question` matches `/pillar/i` — the
taxonomy doesn't name this field explicitly in the schemas above, so the viewer infers it by
name; a collection with no pillar-tagged decisions simply shows no chips. "Has corrections" is
inferred as `recordVersion > 1` (per the owner's stated model, every correction mints a new
record version) rather than eagerly fetching every asset's record just to filter.

## URL forms

- Public/permanent: `https://arweave.net/<viewerTransactionId>?manifest=<collectionManifestTx>`
- Local/POC (served through HITLOOP so the UI can be tested before its own Arweave
  transaction exists): `/archive-viewer/index.html?manifest=<collectionManifestTx>`

The viewer fetches the manifest, records, and originals from `https://arweave.net` only. It
has no Firebase, HITLOOP API, wallet, or authentication dependency.

## Deployment

Deployment is a worker command, not a manual step: the `/archive` card's upload flow issues
`UPLOAD_JSON` with `kind: 'viewer'`, which uploads this HTML file itself to Arweave with
`Content-Type: text/html` and records the resulting `viewerTransactionId`. Open the viewer at
that transaction with `?manifest=<collection-manifest-tx>`.

## Integrity

The manifest records the SHA-256 approved before upload. The NAS worker re-hashes the original
immediately before Turbo upload and refuses changed bytes. The viewer labels an asset
`SHA-256 VERIFIED` to mean this pre-upload invariant was satisfied; it does not currently
download and re-hash the asset in the browser.
