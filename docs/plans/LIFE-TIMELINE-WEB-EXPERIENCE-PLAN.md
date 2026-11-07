# Life Timeline: web experience plan

Revision: 2026-11-07. Status: production plan proposed. The owner subsequently authorized a basic sample-data prototype, saving its source in HITLOOP, and publishing that prototype at a public URL. Production integration and new dependencies remain unapproved.

## Purpose and scope

Create a private, owner-only, zoomable timeline of the owner's photo and video archive. The archive should feel continuously available: scrub across years, inspect a magnified region, and open a photo without losing position. The first product uses only the owner's photos. Family-library comparison is a future capability that informs identity and layout boundaries now; it is not a request to build sharing, invitations, or family imports.

This plan supersedes the earlier month-at-a-time UX recommendation. Existing month packs and worker contracts remain authoritative. No production changes, deployment, environment changes, access-rule changes, paid API calls, or new dependencies are authorized by this document. Do not modify, restart, or interfere with the running photolib pipeline.

## 1. Experience

- Primary surface: a flat WebGL timeline with a fixed time orientation, deterministic image positions, and semantic zoom. The overview represents the complete indexed archive; higher zoom reveals months, days, readable thumbnails, and the selected preview.
- Navigation: decade/year/month labels, jump-to-date, a persistent overview scrubber, pointer-centered zoom, touch pinch/pan, and a visible return-to-overview action. Calendar time remains meaningful across sparse and dense periods. Group packing must not silently turn item rank into elapsed time.
- Focus: a scrubbing lens raises a small region into readable thumbnails. Hover can preview; click/tap pins the region. Touch interactions do not require hover. Selection opens the existing 1600px preview with an information drawer; mobile uses a full-screen viewer and information sheet.
- Filtering: update visible items, timeline density, facet counts, and viewer navigation together. Preserve the camera position and the selected item when it still matches. If selection no longer matches, explain and close the viewer. Default filtering hides nonmatches while retaining quiet date scaffolding; an optional context mode can show nonmatches as faint, nonselectable marks.
- Alternate layout: a chronological contact sheet can share the same data, textures, and selection state. Add one GPU layout transition only after navigation, lens, and filtering pass their performance gate. Resting positions remain deterministic.
- Viewer: arrows/swipes follow the filtered chronological result set. Escape/Back closes and restores position/focus. Videos remain posters; motion and edited children are availability indicators. Deep zoom cannot reveal more than the 1600px preview until the separately approved originals-serving phase.
- Mobile/accessibility: explicit date and zoom controls, keyboard selection and focus restoration, reduced-motion behavior, readable labels, and a semantic HTML list/grid alternative. A canvas or invisible native scroll proxy does not supply item accessibility automatically.
- Presentation: reuse the existing theme tokens and numeric scene bridge for background, labels, selection, and overlays. Preserve photographic color. Stable kebab-case IDs on edited containers; no new hex literals.

## 2. Third-party libraries: verified capabilities, proposed choices

Capability verification uses upstream documentation and local package inspection. It is not an application benchmark or permission to install. Exact new-package versions and transitive dependencies must be reviewed and pinned during an approved implementation phase.

| Responsibility | Choice | Status and reason |
| --- | --- | --- |
| GPU rendering | Three.js + React Three Fiber; existing Drei where useful | Already installed. Use orthographic projection, instanced rectangles, atlas-page batches, and demand rendering. Installed Three is 0.165.0; local Fiber 9.5.0 and Drei 10.7.7 declare compatible Three peer ranges. No renderer upgrade required for the proposed experiment. |
| Camera gestures | Existing Three MapControls/OrbitControls | Local r165 includes cursor zoom; MapControls supplies pan/zoom gestures. Configure a flat camera, disable rotation, and adapt touch behavior. The timeline scrubber and date navigation remain application work. |
| Animation | Existing GSAP | Animate camera/uniform values and optional layout interpolation. Avoid introducing another animation runtime or permanent particle motion. |
| Atlas generation | Existing Sharp | Resize/composite existing cloud thumbnails in a separate derived-asset process. Do not regenerate originals or edit the Mac ingestion pipeline. |
| Spatial lookup | Flatbush | Recommended new dependency, pending approval. Index settled thumbnail bounds for picking and viewport queries. It is static: rebuild after a layout/data revision, not every camera frame. Filter matches with a result mask. It does not solve hit testing during morphs automatically. |
| Text search | MiniSearch | Recommended new dependency, pending approval. Local full-text index for titles, descriptions, keywords, albums, and filenames; supports prefix/fuzzy search. Run in a worker and intersect text results with structured filters. It is not a general numeric/range filtering engine. |
| Structured facets | Native Web Worker with typed predicates/masks; evaluate crossfilter2 | First benchmark the simpler worker path at realistic metadata sizes. crossfilter2 is a suitable alternative for incremental multidimensional filtering and linked facet counts. Select one approach; do not maintain duplicate filtering engines. Array fields and facet-count semantics need explicit verification. |
| Worker RPC | Native worker messages; optional Comlink | Transfer compact buffers and avoid cloning full records on every query. Comlink is a verified convenience option if the protocol becomes complex, not a required performance dependency. |
| HTML fallback | Native bounded/paged list first; optional TanStack Virtual | TanStack Virtual is suitable if a substantial scrolling HTML fallback becomes part of scope. It does not render the GPU canvas. |

PixiJS plus pixi-viewport remains a credible alternative rendering stack, but do not add it alongside Three for the initial experiment. No library supplies the entire private timeline, signed delivery, metadata semantics, and future family permissions out of the box. GPU picking and compression libraries are deferred unless measurements justify them.

## 3. Filter any available metadata without overwhelming the interface

Use a metadata field registry describing field ID, label, type, supported operators, missing-value behavior, source, and whether evaluation belongs in the client projection or on the server. This is an explicit allowlist, not arbitrary Firestore field/path access. New available metadata can enter the registry without redesigning the filter UI.

The main toolbar offers search, capture date, media type, and a Filters button with active-count indication. A searchable filter drawer groups additional fields; active filters appear as removable chips. Mobile uses a sheet. Start simple, then expose an advanced condition builder using the same registry. Initial logic: AND across fields, OR among selected values in a field; multivalue fields support explicit contains-any/contains-all. Nested groups can follow without changing the predicate representation.

| Category | Available fields and interactions |
| --- | --- |
| Capture time | Local date/time ranges, year/month/day, derived weekday/time-of-day, recorded timezone, date source, date certainty, and missing dates where present. |
| Media | Image/video, extension, duration, width/height, derived orientation/resolution, motion-child presence, edited-child presence, and thumbnail availability. Invalid/zero dimensions count as unavailable. |
| Library metadata | Recorded favorite/hidden flags, albums, keywords, title, description; string contains/exact, membership, and present/missing operators. An explicit hidden-items control applies consistently to counts, overview assets, and results; default exclusion is a proposed UX choice to validate with the owner. |
| Camera | Make/model and missing camera data. |
| Location | GPS present/missing, latitude/longitude conditions, and coordinate-based bounds/radius. Named places and a basemap require later enrichment/provider decisions. |
| Provenance | Source ID, source kind/label, original filename, and number of recorded source locations. A source is an import location, not the person who took a photo. |
| Advanced diagnostics | Item ID/hash, recorded UTC time, schema and index timestamps where useful. Raw canonical/source paths remain server-only; any future path-matching filter executes there and returns matching IDs. |

Field coverage is visible: missing GPS is not a location, absent titles are not searchable captions, and library membership is not face/person recognition. Do not invent metadata not stored today, such as faces, city names, original byte sizes, or richer EXIF fields. Preserve false/zero versus missing where the source schema permits that distinction; do not claim unknown values the current ingest has already flattened.

Filters operate over the complete authorized library, not only currently visible months. Load the necessary facet columns/search projection independently of rendering data. Report indexing/loading coverage and disable incomplete global facets until ready. High-cardinality facets use search and bounded option lists. Counts describe unique items today; future collection-entry and unique-asset counts must be labeled separately. Example: capture date 2014–2018 AND camera make Apple AND has GPS AND (keyword vacation OR keyword travel).

Compute filter results, availability counts, and timeline bins away from the UI thread; return compact result masks/IDs and a query generation number so stale results cannot replace newer ones. Keep camera motion independent of filter computation. Avoid Firestore reads and re-signing on every keystroke. Preserve time gaps when filtering; fitting results is an explicit action.

## 4. Rendering and data delivery

Keep three separate projections:

1. Layout manifest: stable item identity, exact capture-date ordering, dimensions/flags, library key, and atlas page/slot. Derive it from current month packs plus authorized metadata. A normalized GPU time coordinate is not the authoritative date. Start with compressed JSON/dictionaries and typed buffers where needed; commit to a custom binary format only if measurements justify it.
2. Facet/search projection: approved searchable metadata, including array-valued and optional fields. Dictionary-encode repeated values. Load progressively in a worker; long descriptions and many keywords can dominate size. The complete metadata index cannot be assumed to have the tiny footprint of the layout manifest.
3. Full item detail: fetch only for selected/nearby viewer items through the owner API. Return an explicit allowlist instead of the raw Firestore document.

Use tiny overview images in multiple private atlas pages, with stable slots independent of capture order. Seal full pages, version the writable tail, and publish an immutable manifest revision only after referenced assets exist. Atlas rebuilds run separately from the active worker after approval. Manifest and metadata projections carry the same dataset revision; refresh on explicit reload/focus checks or an approved refresh process, not on every pan.

Overview detail is a measured choice between 16px and 32px image cells, page sizes, padding, and mip policy. Two 4096-square RGBA8 pages cost 128 MiB before mipmaps; with a full mip chain roughly 171 MiB, excluding CPU/decode copies and render targets. Full 32px residency is a candidate, not a mobile guarantee. A lower overview tier or smaller resident working set must preserve navigability when the full tier exceeds the chosen cap.

Promote only focus-region images to existing 320px thumbnails; selected photos use 1600px previews. Bound textures, decode work, upload work, and concurrency. Batch by atlas page; filter and viewport masks prevent irrelevant detail loads. Dispose resources and close transferred bitmaps when finished. Test actual decode paths and image color on target browsers instead of assuming one API is uniformly fastest.

Add owner-only layout/index and bounded thumbnail-signing routes without changing the frozen worker payload or existing owner-route defaults. The existing month endpoint can gain an opt-in metadata-only response. Keep signed media URLs at 60 minutes, return actual expiry, reuse still-valid signatures when appropriate, and cache by stable asset revision in bounded owner-scoped memory. Persistent media caching is a separate owner decision. Verify effective Storage CORS before attempting WebGL uploads; changes require approval.

## 5. Future family layers: design boundaries now, build later

Do not equate source, asset, library, and person:

- Asset: the original content identity, such as its full SHA-256.
- Library: a collection labeled Me, Wife, Dad, etc., with explicit access policy.
- Entry: an asset's membership in a library, identified by a stable library+item key, with that library's dates, titles, favorites, albums, and provenance.
- Source: an imported Photos library or folder within a library.
- Person depicted/photographer: separate metadata; never inferred solely from library membership.

Today the web adapter supplies a single owner-library key for all existing records. This requires no current Firestore migration or worker change. Keep internal selection and filter APIs able to accept library-scoped entry IDs. Do not show empty family controls or build a household management interface in the first UX.

Before importing another person's library, revise storage/ingest contracts: the current globally keyed life_media document uses latest-push metadata for most fields, so merging identical family photos there could overwrite library-specific information. Preserve per-library entry metadata; content deduplication must not collapse ownership or access rights. Scope source IDs as well. Sharing/revocation rules are a separate future decision; imported family collections may still initially be browsed only by the current owner.

Future views:

- Overlay: library toggles and optional per-layer opacity reveal several collections in a shared time field. Use labeled controls and selection outlines/badges to identify library membership without tinting photos. Shared assets can collapse visually with membership badges.
- Compare: aligned horizontal lanes, one per enabled library, sharing the same camera/date range. Each lane may show its own entry for the same asset. Clearly label whether counts mean unique assets or entries.
- Time basis: default browsing uses local capture dates. A future “same instant” comparison uses recorded UTC instants only where timezone evidence supports alignment. Local-only dates remain visibly unaligned/uncertain; never invent a timezone from a person's home or silently place them at UTC midnight. Different locations on the same calendar date are not automatically the same instant.

Authorization must precede metadata projection, counts, search, and URL signing. Adding UIDs to today's LIFE_OWNER_UIDS list does not implement library-specific access. Future atlas pages and search projections must be partitioned by authorization boundary; hiding a layer in the browser is not an access control. No cross-library sheets containing unauthorized imagery.

## 6. Proposed phases and gates

| Phase | Deliverable | Acceptance/gate |
| --- | --- | --- |
| R0: feasibility | Isolated local experiment after approval: 20k/50k distinct fixture images; overview, scrub, lens, worker filtering, target-device tests. Evaluate Flatbush/MiniSearch and native predicates versus crossfilter2. | Measure cold/warm readiness, frame times, texture and CPU memory estimates, filter latency, and suspend/context recovery. Aim for 60fps desktop interaction and responsive phone behavior; record results rather than promise universal limits. Choose the minimum dependency set and residency tier. No production assets, cloud writes, or pipeline changes. |
| R1: owner read models | Versioned manifest/facet projection, independent derived overview assets, bounded signing, explicit detail responses. | Local/fake-backed contract and authorization checks. Real cloud reads/writes, new storage prefix, CORS changes, or backfill require separate explicit approval. |
| R2: owner experience | Timeline, semantic zoom, lens, pop-up viewer, all available metadata filters/search, mobile and HTML alternative. | This must deliver the intended feel with bounded memory; verify URL/history/focus, missing fields/media, expiry, races, and existing theme checks. Stop for owner review. |
| R3: visual expansion | One alternate contact-sheet layout/morph, richer places UX, saved filter views if desired. | Add dependencies/services only when approved and measured useful. |
| Future: family comparison | Library membership, revised metadata/ingest boundaries, permissions, overlay and aligned lanes. | Separate planning/approval before ingestion or identity changes. |
| Future: original media | Tunnel, motion/video playback, original/edited serving. | Separate deployment/security/codec/range-request plan. |

R0 includes single-library fixtures now. A small two-library synthetic fixture can later validate identity and shared-photo behavior without importing anyone's real library. Across the production work, verify 20k+ items, high-cardinality arrays/text, rapid combined filters, partial index readiness, memory growth after repeated navigation, missing timezone, hidden items, expired credentials, and live-ingestion revision changes. No tests or benchmarks have been executed as part of this planning revision.

## 7. Likely implementation locations after approval

HITLOOP worktree: `/Users/bballi/Documents/Repos/Bballi_Portfolio-life-timeline`.

- Existing page: `app/dashboard/life/page.jsx`.
- New client modules beside the page or under `features/life-timeline/client/`: canvas/viewer, camera adapter, lens, filter registry/UI, worker, projection loader, spatial index, atlas residency, selection/history, and HTML alternative.
- Owner API logic: `features/life-timeline/{http,store,signed,owner-auth}.js` and new `app/api/life/` route wrappers.
- Separate derived-asset builder under `scripts/life-timeline/` or a dedicated approved process; keep expensive atlas generation out of page requests.
- Existing `lib/theme-scene/` as a reusable boundary, not a reason to rewrite the shared theme system.
- Update `features/life-timeline/CONTRACT.md` and `docs/source-of-truth/LIFE-TIMELINE.md` when approved read contracts are concrete.
- Worker code, current ingest/schema, NAS contents, deployment configuration, and access rules remain untouched in the present planning step.

## Sources

Library capabilities verified against primary sources:

- Three.js instancing: https://threejs.org/docs/pages/InstancedMesh.html
- Camera controls: https://threejs.org/docs/pages/MapControls.html and https://threejs.org/docs/pages/OrbitControls.html
- R3F performance/demand rendering: https://r3f.docs.pmnd.rs/advanced/scaling-performance
- Sharp compositing: https://sharp.pixelplumbing.com/api-composite/
- Flatbush: https://github.com/mourner/flatbush
- MiniSearch: https://github.com/lucaong/minisearch
- Crossfilter: https://crossfilter.github.io/crossfilter/ and https://github.com/crossfilter/crossfilter/wiki/API-Reference
- Comlink: https://github.com/GoogleChromeLabs/comlink
- TanStack Virtual: https://tanstack.com/virtual/latest/docs/introduction
- PixiJS alternative: https://pixijs.com/8.x/guides/production/performance-tips/ and https://viewport.pixijs.io/api/
- VIKUS precedent: https://github.com/cpietsch/vikus-viewer
- WebGL resource budgets/readback: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices
- Persistent cache behavior: https://developer.mozilla.org/en-US/docs/Web/API/Cache
- Storage CORS: https://docs.cloud.google.com/storage/docs/cross-origin

All performance targets are proposed acceptance criteria. No claims of measured application performance or blanket device memory limits are made.
