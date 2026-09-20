# Underground Existence skyline thumbnail pipeline

**Status:** implementation-ready; no production deployment authorized  
**Target repository:** `/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator`  
**Primary goal:** provide a cohesive, optimized, unique skyline-video still for every existing mix and automatically provide one for future uploads that lack approved artwork.

## Decision

Build a backend-owned thumbnail-assignment pipeline. It will extract and optimize stills from an explicit catalog of Chicago-skyline source videos, upload durable image assets to the existing media storage, persist their URLs and provenance in the artist/mix record, and let the existing static-site generator render those stored values everywhere.

The public frontend must never extract video frames or randomly choose images at page load. "Random" means deterministic selection at assignment time, seeded by the mix or artist identity, then persisted. A mix must show the same thumbnail on its card, artist page, homepage, archive, player, and future deploys.

## User-visible contract

1. Every existing mix receives a distinct skyline-derived thumbnail in the initial backfill.
2. A new mix with explicitly supplied cover art retains that art and is never overwritten automatically.
3. A new mix without approved cover art receives a generated skyline still automatically during ingestion.
4. A new artist without an uploaded profile image receives a separate generated skyline still automatically.
5. Generated mix thumbnails and generated artist images are stable and persisted; they do not rotate on reload.
6. An admin can later replace an automatic image with uploaded art, regenerate a different skyline still, or opt out for a record.
7. Existing mix URLs, audio streaming/player behavior, upload behavior, deployment flow, artist metadata, and user-uploaded artwork stay intact.

## Existing architecture and seams

### Current data path

```text
Admin UI upload/manage artist
  -> api/manage-artists.js and image-upload flow
  -> Firestore system/artists
  -> lib/WebsiteSync.js
  -> website/artists.json
  -> lib/WebsitePageGenerator.cjs
  -> static artist/home/archive/residents pages
  -> Arweave path-manifest deployment
```

`WebsiteSync.js` already maps `artistImageFilename` and `mixImageFilename`; `WebsitePageGenerator.cjs` already uses mix image first and artist image as fallback. Preserve that backwards-compatible rendering contract. The new pipeline writes durable image URLs into these existing fields, with adjacent metadata fields for origin and regeneration.

### Source-video reality

The local worker video cache currently contains Chicago skyline `.mov`/`.mp4` assets, including `chicago_veo_generated_16x9_1749167282568.mp4`. It is a development cache, not a valid production dependency. Build an explicit source catalog pointing to durable Firebase Storage objects (or another already-approved persistent source) before backfill. Never depend on a workstation-local `worker/outputs/video-cache` path at runtime.

## Data model

Use the existing image URL fields for maximum compatibility, and add optional metadata without changing their meaning.

```js
// Artist record
{
  artistImageFilename: 'https://.../generated/artist/<artist-key>.webp',
  artistImageMeta: {
    origin: 'generated-skyline' | 'uploaded' | 'legacy',
    assignmentVersion: 1,
    sourceVideoId: 'skyline-...',
    sourceTimeSec: 12.4,
    generatedAt: '<ISO timestamp>',
    contentHash: '<sha256-or-storage-generation>',
    locked: false
  }
}

// Mix record
{
  mixImageFilename: 'https://.../generated/mix/<mix-key>.webp',
  mixImageMeta: {
    origin: 'generated-skyline' | 'uploaded' | 'legacy',
    assignmentVersion: 1,
    sourceVideoId: 'skyline-...',
    sourceTimeSec: 27.8,
    generatedAt: '<ISO timestamp>',
    contentHash: '<sha256-or-storage-generation>',
    locked: false
  }
}
```

Rules:

- `origin: uploaded` and `locked: true` are never modified by automatic jobs.
- A generated field is only replaced by an explicit admin regeneration or a versioned migration the admin has previewed/approved.
- Use a canonical `mixKey` derived from the Arweave transaction ID when available; otherwise use a normalized stable composite of artist, title, and original mix URL. Do not use array position or current date.
- Store an idempotency key so retrying an upload does not generate a second asset.

## Asset specification

- Source: curated Chicago-skyline source catalog only in v1.
- Thumbnail output: square WebP, target `960 × 960`, quality 80–84; create an AVIF only if the existing static-site deployment/toolchain can serve it without regressions.
- Crop: deterministic center/subject-aware crop from a source 16:9 frame; no browser-side crop required for correctness.
- Safety: reject black frames, near-duplicate frames, severely blurred frames, and frames with embedded unintended text/UI.
- Output storage path: `website/generated-thumbnails/v1/{mix|artist}/{stable-key}.webp` or an existing equivalent Firebase Storage namespace.
- Cache policy: immutable/versioned output URLs where supported. Do not overwrite an asset in place; increment assignment version on deliberate regeneration.
- Preserve descriptive alt text in the generated site: `Artist — Mix title` for a mix; artist name for an artist image.

## Deterministic unique-selection algorithm

1. Build a durable catalog of eligible source videos. Each entry has stable ID, storage URL/path, duration, eligible time ranges, and enabled status.
2. For each video, build a candidate-frame inventory at fixed offsets (for example 10%, 25%, 40%, 55%, 70%, 85%) plus a small deterministic jitter. Extract candidates to a temporary workspace.
3. Score/reject candidates using image dimensions, luminance, contrast, blur/sharpness, and perceptual hash. Keep only valid candidates.
4. Sort candidates by stable ID. Compute a deterministic seeded index from `assignmentVersion + entityType + stableKey`.
5. Resolve collisions: if the selected perceptual hash or source/time pair is already assigned within the current initial batch, use deterministic probing to select the next eligible unused candidate.
6. Render and upload the exact selected thumbnail, then persist its URL and source metadata atomically with the record update.
7. On rerun, return the existing generated asset when metadata/idempotency proves it is already assigned. Do not re-randomize.

This produces visual variety while making builds reproducible. "Unique" means no intentionally duplicated candidate assignment among the initial set; exact visual uniqueness cannot be guaranteed if separate video frames are visually identical, so perceptual-hash screening is required.

## Work phases

### Phase 0 — inventory and safety baseline

1. Identify the durable Firebase Storage paths/URLs for the skyline source videos and create `config/skyline-thumbnail-sources.json` (or a similarly scoped server-side manifest).
2. Inspect every existing artist and mix record. Classify image state as uploaded, legacy, generated, missing, or invalid URL.
3. Produce a dry-run report: entity key, current image/origin, proposed video/time/crop, output URL, collision result, and skip reason.
4. Do not mutate Firestore, storage, `artists.json`, or generated pages in this phase.
5. Define an admin-controlled feature flag such as `SKYLINE_THUMBNAILS_ENABLED=false` by default until the dry run is approved.

### Phase 1 — reusable server/worker thumbnail service

Implement a small isolated service, for example `lib/SkylineThumbnailService.js`, used by both backfill and new-content ingestion.

Responsibilities:

- load/validate source catalog;
- derive stable keys and deterministic candidate selection;
- download/stream source video to a safe temporary directory when needed;
- use the project’s existing FFmpeg-capable worker environment to extract a still;
- validate/crop/encode WebP;
- upload generated asset to durable storage;
- return `{ imageUrl, meta }` without directly changing records;
- clean temporary files on success and failure;
- be idempotent and testable with injected storage/process dependencies.

Do not run FFmpeg or large video transfer inside a Vercel request/response path. The service must execute in the worker/job-capable environment already used for media processing.

### Phase 2 — initial backfill, preview first

1. Add a CLI/job command that supports `--dry-run`, `--limit`, `--artist`, `--mix-key`, and `--apply`.
2. Default mode must be dry-run and write a JSON/CSV report; `--apply` requires an explicit confirmation flag.
3. In v1 initial backfill, replace existing mix thumbnails only when the product owner explicitly authorizes the visual migration. Preserve their original URL in `previousMixImageFilename` or an audit record so it can be restored.
4. Never overwrite uploaded artist images. For artist records with no approved image, assign a generated artist image.
5. Run a small representative batch first; visually inspect generated cards on homepage, artist, archive, residents, and player surfaces.
6. After approval, apply in idempotent batches and write progress/audit records. If any entity fails, continue safely and report it; do not leave a half-written record.
7. Run `WebsiteSync` and the static page generator only after the data batch is successful.

### Phase 3 — new mix and artist ingestion

Update the backend/UI workflow at the `api/manage-artists.js` seam and any corresponding upload route.

1. Make artist thumbnail upload optional for new artists; label it `Upload artwork (optional)`.
2. On an uploaded image, set `origin: uploaded`, `locked: true`, and preserve existing behavior.
3. On a new mix without a mix image, enqueue an idempotent thumbnail-generation job after the mix record is validated and persisted.
4. On a new artist without artist artwork, enqueue an artist thumbnail generation job as well.
5. The API/UI must return a truthful `thumbnailStatus`: `uploaded`, `generating`, `generated`, `failed`, or `not-requested`.
6. Do not block successful audio upload on thumbnail generation. If generation fails, keep the mix/artist usable with the current fallback and show an admin retry action.
7. On job completion, update Firestore transactionally, sync the website data, and allow the normal deploy flow to incorporate it. Do not auto-deploy Arweave unless an already-authorized flow explicitly does so.

### Phase 4 — admin controls and observability

Add scoped controls in the existing admin UI:

- Preview proposed generated thumbnail before applying it;
- Upload/replace with artwork;
- Regenerate (choose another deterministic candidate using incremented `assignmentVersion`);
- Restore previous artwork/image assignment;
- Retry failed generation;
- Show origin, source video, timestamp, and status.

Admin status must avoid exposing secrets or raw stack traces. Log worker/job errors with entity key and safe diagnostic reason.

### Phase 5 — static-site rendering and regression checks

1. Keep `WebsiteSync.js` backwards-compatible and ensure it preserves the new metadata fields necessary for auditing.
2. Keep `WebsitePageGenerator.cjs` precedence: mix image → artist image → existing visual fallback.
3. Confirm all thumbnail surfaces consume the same persisted mix image: home cards, featured mix if applicable, archive rows, artist pages, persistent player, and any search results.
4. Preserve lazy loading and dimensions to prevent layout shift. Ensure cards use the optimized image URL, not source video URLs.
5. Regenerate locally and verify relative links/path-manifest compatibility before any Arweave deploy.

## Test plan

### Unit tests

- Stable key derivation is deterministic.
- Same input returns the same selected candidate and idempotency key.
- Candidate collision resolves deterministically to a unique alternative.
- Uploaded/locked artwork is never overwritten.
- Missing mix art generates mix art; missing artist art generates artist art.
- Invalid/missing source catalog entries fail with an actionable error.
- Storage/upload failure does not partially overwrite data.
- Re-run of a completed entity does not create another output file.
- Regeneration increments version and preserves previous assignment.
- `WebsiteSync` preserves the generated image URL and metadata.
- Rendering precedence remains mix → artist → fallback.

### Integration/manual tests

- Dry-run full corpus produces one proposed unique image for each existing mix and does not mutate data.
- Small apply batch produces optimized WebP assets with expected dimensions/filesize and valid storage URLs.
- Homepage, archive, artist, residents, featured, and persistent-player thumbnail references are consistent for a chosen mix.
- Upload a new mix with explicit art: art is preserved, no generation job is queued.
- Upload a new mix without art: job enters `generating`, resolves to `generated`, and image appears after standard sync/generation.
- Add a new artist without art: artist receives a distinct generated image; mix receives its own distinct image.
- Simulate FFmpeg/storage failure: upload succeeds, thumbnail status is failed, fallback remains functional, retry succeeds.
- Run all pre-existing audio player, page-generator, upload, and deployment tests. No changes to playback or Arweave audio URLs are permitted.

## Acceptance criteria

- [ ] The source catalog is durable and versioned; no production dependency relies on local worker cache files.
- [ ] A dry run lists every existing mix and its proposed unique still without modifying state.
- [ ] An approved initial apply creates optimized durable thumbnails for all targeted existing mixes and records provenance.
- [ ] Existing uploaded/locked artist or mix artwork remains untouched.
- [ ] Every new mix without artwork receives a deterministic generated thumbnail through the UI/backend path.
- [ ] Every new artist without artwork receives a deterministic generated artist image through the UI/backend path.
- [ ] A failed thumbnail job never makes the mix upload fail or corrupts its record.
- [ ] Admins can preview, replace, retry, regenerate, and restore images.
- [ ] Static pages consistently use the persisted image in all mix-thumbnail surfaces.
- [ ] All existing tests remain green and new pipeline tests pass.
- [ ] No Arweave deployment, source-media reupload, or GoDaddy change occurs as part of implementation.

## Rollout and rollback

1. Land code and tests with feature flag disabled.
2. Populate/validate the source catalog in non-mutating mode.
3. Run dry run and approve the report/contact sheet.
4. Apply a small batch, visually inspect static output, then backfill the full initial corpus.
5. Enable automatic generation for newly uploaded content.
6. Monitor job failures and generated asset sizes for one release cycle.

Rollback means disabling automatic assignment, restoring `previousMixImageFilename`/previous artist image from audit records, and regenerating the static site. Generated storage objects are retained initially; do not delete them during rollback.

## Explicit non-goals for v1

- No AI-generated image generation.
- No frontend frame extraction.
- No automatic overwrite of user-uploaded artwork.
- No public random rotation of thumbnails.
- No automatic Arweave upload/deployment.
- No use of arbitrary user videos outside the approved skyline source catalog.

