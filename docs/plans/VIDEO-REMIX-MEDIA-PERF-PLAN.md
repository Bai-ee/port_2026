# Video Remix / dashboard media performance plan

Frozen plan for making the Video Remix card (and the shared card-face video shells) load and scroll fast. Backend/render contract is untouched throughout — this is a media-loading + UI-weight workstream.

**Status: Phase 1 SHIPPED (2026-07-01, `DashboardPage.jsx` only, pending manual dev test). Phases 2–4 remaining.**

## Diagnosis (verified in code)

- SAVED ASSETS held up to 40 remixes, every one mounted as `<video preload="metadata">` → a metadata/range request + demuxer instance per file on modal open.
- Folder previews fetched `limit=36` and rendered every file as a `<video>` thumb via the `#t=0.1` fragment — duplicated across the order slots, clip pool, source grid, and admin cleanup rows.
- The dashboard grid autoplayed multiple looping MP4s at once (Video Remix shell, Mockup Studio shell, Post Me mockup) that kept decoding while scrolled off-screen → scroll jank.
- No posters, no pagination, no lazy loading.

Explicitly NOT a bottleneck: server-side signed-URL generation (`getSignedUrl` v4 is local crypto, plus `listFolderMedia` caches per `folder:limit` in `editvideos-bridge.cjs`). The original "split metadata from preview URLs" idea was dropped for this reason.

## Phase 1 — lazy loading + pagination + off-screen pause (SHIPPED)

All in `DashboardPage.jsx`; no CSS additions, no backend changes.

1. **`LazyVideoThumb`** (module scope, next to `firstFrameThumbSrc`): renders a src-less `preload="none"` video until the element nears the viewport (IntersectionObserver, 200px margin), then sets the real src and disconnects. Swapped in at 7 sites: remix-tab order slots + clip pool, source-tab order slots + media grid + admin cleanup rows, saved-remix player, mockup-studio assets player.
2. **Off-screen pause**: shared `offscreenVideoPauseObserver` + `observeOffscreenVideoPause(el)` pauses looping card-face videos scrolled out of view and resumes only ones it paused (manual pause respected). Wired as `ref` on the Mockup Studio shell and Post Me mockup video, and folded into `initRemixShellVideo` (covers the Video Remix card face + modal players). React 19 ref-cleanup unobserves on unmount.
3. **SAVED ASSETS pagination**: renders `SAVED_REMIX_PAGE_SIZE` (8) players, then `#saved-remix-load-more-row` "Load more (N older)". Count resets when the modal card changes (`savedRemixVisibleCount`).
4. **Folder preview paging**: `loadVideoRemixFolderFiles(folder, limit)` defaults to `VIDEO_REMIX_FOLDER_PAGE_SIZE` (12, was 36), steps `+VIDEO_REMIX_FOLDER_PAGE_STEP` (24) per click, caps at `VIDEO_REMIX_FOLDER_PAGE_MAX` (120 = server cap). Client cache stays keyed by folder name (upload/delete invalidation unchanged); a cached entry satisfies only requests ≤ its stored limit. Load-more rows: `#remix-order-pool-load-more-row` (REMIX tab), `#source-media-load-more-row` (SOURCE MEDIA tab; cleanup list grows with it). "More may exist" heuristic: last fetch filled its limit.

Known accepted trade-offs:
- Thumbs paint blank (container background) for a beat before the first frame loads in.
- Resuming an **unmuted** remix shell after scroll-away can be blocked by autoplay policy → sits paused with controls; user taps play.

## Phase 2 — shared thumb component + render skipping (UI-only)

1. Extract a `MediaThumb` wrapper so sizing/badge/label markup stops being duplicated per grid (`LazyVideoThumb` unified loading; markup is still copy-pasted).
2. `content-visibility: auto` + `contain-intrinsic-size` on long list rows (`.saved-remix-card`, `.upload-row`, `.media-thumb-grid` cells) in the `dashboardCss` const (⚠️ + keep `dashboard.css` mirror in sync). Skips layout/paint off-screen; complements Phase 1 lazy loading (CSS alone does NOT stop media fetches — `preload="none"` handling stays).
3. Optional: unmount saved-remix `<video>` back to a placeholder when scrolled far away — frees decoder instances, not just paint.

## Phase 3 — real posters (cross-repo, biggest remaining visual win)

1. EditVideos worker (`Bai-ee/arweave-video-generator`) emits a JPEG poster beside each rendered MP4 (one FFmpeg `-frames:v 1` pass per render). Deployed by push in that repo.
2. `api/_lib/media-reconcile.cjs` carries `posterUrl` into `mediaCaptures` next to `downloadUrl` (same signed-URL refresh path). Update SSOT [`VIDEO-REMIX-EDITVIDEOS-BRIDGE.md`](../source-of-truth/VIDEO-REMIX-EDITVIDEOS-BRIDGE.md) § Render behavior.
3. UI: thumbs + card face become `<img src={posterUrl}>`; `<video>` mounts on play. Fixes the Phase-1 blank-thumb flash.
4. Last slice: posters for **source folder** media + a backfill pass over existing files (worker-side; bigger scope, do only after remix posters prove out).

## Phase 4 — only if needed after Phase 3

- Real cursor pagination on `listFolderMedia` (not a growing limit) if folders exceed 120 files.
- Archive/hidden state for old remixes so history doesn't ride the active card UI forever (Firestore keeps 40 either way).
- Dropped for good: metadata/signed-URL split (see Diagnosis).

## Verification per phase

- JSX parse + `npm run dev` manual pass: modal open weight, thumb fill-in while scrolling, grid scroll with a rendered remix + studio video, unmute persistence on the remix shell.
- Phase 3 additionally: a fresh render lands with `posterUrl`, reconcile backfills older captures gracefully (missing poster ⇒ fall back to `LazyVideoThumb` behavior).
