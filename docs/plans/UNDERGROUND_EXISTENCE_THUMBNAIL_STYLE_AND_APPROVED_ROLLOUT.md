# Underground Existence thumbnail style, uniqueness, and approved rollout

**Target repository:** `/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator`  
**Status:** revision plan; keep the thumbnail feature flag OFF until explicit approval  
**Depends on:** the existing skyline-thumbnail pipeline and its dry-run/contact-sheet artifacts.

## Objective

Make all automatically generated mix and artist thumbnails visually belong to Underground Existence’s existing video language: high-contrast black-and-white imagery with restrained analog texture. At the same time, guarantee that automatically assigned stills remain unique across all historical backfills and future uploads, not merely within one job run.

The controlled rollout is:

1. Add persistent cross-run uniqueness.
2. Add and validate the monochrome textured still treatment.
3. Run a clean, non-mutating dry run.
4. Review and explicitly approve the contact sheet.
5. Apply only to existing mixes without approved artwork.
6. Enable automatic generation for future art-less mix/artist uploads.

## Non-negotiable rules

- Existing uploaded/approved artwork is immutable by default.
- Generated thumbnails are assigned once, persisted, and never rotate in the browser.
- Do not use local workstation video-cache files as production source assets.
- Source videos must be manually curated before they enter the enabled source catalog.
- No generated thumbnail may be published before it passes the visual-quality and style checks.
- No Firestore mutation, storage upload, Arweave deploy, ArNS update, or GoDaddy change occurs in dry-run mode.
- A failed image job must never block or roll back a successful audio/mix upload.

## Visual treatment specification

### Desired look

The still must read as a frame from the established Underground Existence video world:

- monochrome / black-and-white rather than a simple desaturation;
- deep blacks, protected highlights, and strong midtone separation;
- subtle analog grain/texture, not digital noise or a dirty overlay;
- slight vignette only where it supports the source frame;
- no text, logos, watermarks, UI, fingers/obstructions, dashcam/vehicle artifacts, police imagery, highway signage, or obviously non-skyline imagery;
- square, editorial crop that works in 1:1 cards and Media Session artwork.

### Implementation policy

Create a versioned, testable `SkylineThumbnailStyle` (or equivalent) service owned by the worker pipeline. It must take a candidate source frame and produce a deterministic `960 × 960` WebP.

Use a reproducible FFmpeg filter graph rather than browser CSS. The exact filter values must be tuned from real approved-video reference frames, but the implementation should include:

1. crop/scale to a square composition;
2. grayscale conversion;
3. contrast and tonal-curve adjustment to establish dense blacks and readable highlights;
4. restrained, deterministic film-grain texture;
5. optional low-strength vignette;
6. WebP encoding at quality 80–84.

The texture seed must derive from the stable entity key plus assignment version. It must be repeatable; rerunning the same entity/version must reproduce the same pixel output/content hash.

Do not apply texture via an arbitrary random generator at runtime, and do not put this effect in the public CSS. The persisted file must already contain the completed treatment.

### Style-quality gates

Before upload, validate the rendered output—not merely the source frame:

- exact dimensions: 960 × 960;
- valid WebP decode;
- output filesize within an agreed performance range, target 25–150 KB;
- luminance histogram is neither nearly all black nor washed out;
- contrast falls within a measured target range based on approved reference stills;
- perceptual hash is sufficiently distinct from already assigned generated assets;
- no source/crop is accepted if the curator has disabled its source video.

Generate a contact sheet showing the **final styled thumbnail**, not the original 16:9 source frame. Label each tile with entity, source video ID, timestamp, candidate ID, assignment version, and origin (`generated-skyline`).

## Persistent cross-run uniqueness

### Problem

The current batch-level set prevents duplicate candidates only during one process. A later upload/job can choose a candidate already assigned in a previous backfill, even though it is visually supposed to be unique.

### Required solution

Persist a global generated-thumbnail assignment ledger in the system of record—not in process memory or a local output folder. Prefer a dedicated Firestore collection, for example:

```text
skyline_thumbnail_assignments/{candidateId}
```

Each assignment document must contain:

```js
{
  candidateId,             // stable sourceVideoId + timestamp/crop/styleVersion
  perceptualHash,
  entityType,              // mix | artist
  entityKey,               // stable composite identity
  imageUrl,
  assignmentVersion,
  status,                  // reserved | committed | released
  createdAt,
  updatedAt
}
```

Rules:

1. The entity key for a mix must be unique per mix record, not just its Arweave transaction ID. Use a normalized stable composite such as `artistName + mixTitle + txid`, with a deterministic collision suffix if required.
2. Candidate reservation must be atomic. Two concurrent new-upload jobs cannot reserve the same candidate.
3. A job reserves a candidate before rendering/uploading. It commits the assignment only after storage upload and Firestore entity update both succeed.
4. On failure, release the reservation or mark it expired with a safe TTL/reconciliation job.
5. Selection excludes every candidate ID already committed and every perceptual hash within the duplicate threshold.
6. A completed entity rerun reuses its own committed assignment; it must not consume a new candidate.
7. Intentional admin regeneration increments assignment version, preserves a restore record, releases the prior assignment only after the replacement is committed, and chooses a globally unused candidate.
8. Existing report rows must state whether their uniqueness is batch-only or globally committed.

## Source catalog curation

1. Start from the source-curation contact sheet.
2. Mark every unwanted video `enabled: false`; do not attempt to algorithmically justify unsuitable footage.
3. Keep a durable, versioned catalog with source ID, Firebase Storage path/URL, eligible time windows, enabled status, curator note, and catalog version.
4. Use only approved skyline/Chicago footage. The generic b-roll folder must not become an implicit source pool.
5. If approved source count is insufficient for unique outputs, increase eligible curated material before lowering duplicate thresholds or using inappropriate footage.

## Execution phases

### Phase 1 — style calibration, no data mutation

1. Extract a small representative candidate set from only curator-approved videos.
2. Produce at least three style variants using the versioned style service.
3. Generate a labeled comparison contact sheet.
4. Select one style configuration as `styleVersion: 1`; record the exact filter graph/settings in code and documentation.
5. Add regression fixtures and expected hashes/quality metrics for approved sample frames.

### Phase 2 — global assignment ledger

1. Implement ledger schema, atomic reservation/commit/release, stale-reservation cleanup, and idempotent entity lookup.
2. Replace batch-only `usedCandidateIds` logic with ledger-backed selection.
3. Add tests for concurrent reservations, duplicate transaction IDs across distinct mixes, retries, failed uploads, intentional regeneration, and restore protection.
4. Keep feature flag disabled.

### Phase 3 — clean dry run

1. Clear only generated dry-run artifacts from a dedicated disposable output path; never delete production assets or records.
2. Run the full eligible corpus against the approved catalog, the selected style version, and a read-only/throwing Firestore and storage adapter.
3. Verify zero Firestore writes and zero storage uploads.
4. Produce:
   - JSON/CSV proposal report;
   - styled contact sheet;
   - source usage summary;
   - candidate/hashed-duplicate report;
   - list of preserved uploaded/approved covers;
   - explicit failure/skipped-entity report.
5. Required dry-run success: every targeted art-less mix has one unique proposed candidate; no duplicate candidate ID/perceptual hash is proposed; all outputs pass style quality gates.

### Phase 4 — visual approval gate

The product owner reviews the final styled contact sheet and selects one of:

- approve full initial backfill;
- approve a small named batch only;
- reject named candidate/source assignments and rerun;
- change style parameters and repeat Phase 1.

No `--apply` command may run without both the feature flag and a deliberate typed confirmation argument. The contact sheet is the approval artifact; do not substitute source-frame inspection.

### Phase 5 — initial controlled apply

1. Apply only to existing mixes missing approved artwork.
2. Leave all uploaded/locked/legacy approved covers untouched.
3. Start with a small approved batch and inspect homepage, artist, archive, residents, featured, persistent player, share card/Media Session artwork surfaces.
4. Commit data and ledger assignment atomically where possible; otherwise use recoverable job states plus reconciliation.
5. Preserve previous values/audit history for every mutated record.
6. Complete the backfill only after small-batch review passes.

### Phase 6 — future art-less uploads

1. Enable generation only after the initial apply is accepted.
2. On new artist/mix upload with approved artwork: persist uploaded image, mark locked, queue no generator job.
3. On new mix without art: create/validate the mix record, enqueue a thumbnail job, reserve a global candidate, render/style/upload, then commit metadata.
4. On new artist without art: follow the same flow with a distinct artist candidate.
5. Surface `generating`, `generated`, `failed`, `uploaded`, and retry/replace/regenerate controls in the admin UI.
6. Keep the uploaded audio valid even if image generation fails.

## Tests and acceptance criteria

- [ ] A same entity/version produces bit-stable styled output and metadata.
- [ ] Style fixtures prove grayscale, contrast, texture, dimensions, filesize, and valid WebP output.
- [ ] Uploaded/locked art is never overwritten by initial backfill, retry, restore, or automatic generation.
- [ ] Every targeted art-less mix in a clean dry run receives one globally unique proposed candidate.
- [ ] Duplicate Arweave transaction IDs do not cause output-path/provenance collisions.
- [ ] Concurrent jobs cannot reserve the same candidate.
- [ ] Failed render/upload leaves no committed ledger record and no broken entity image URL.
- [ ] Contact sheet tiles show final styled outputs and provenance.
- [ ] Apply is impossible without both enabled flag and explicit confirmation.
- [ ] New art-less artist/mix uploads gain a unique generated thumbnail asynchronously; upload remains usable if the job fails.
- [ ] Existing audio, warming, deep link, Media Session, resume, site generation, and upload tests remain green.
- [ ] No deployment or production data change occurs until explicit visual approval.

## Rollback

Disable the thumbnail feature flag, stop job consumption, restore image fields from audit history, and mark corresponding ledger entries `released` only after restoration succeeds. Retain generated files initially for forensic recovery; do not bulk-delete during rollback.

