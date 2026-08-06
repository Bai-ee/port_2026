# Studio Video Export — Restore Basic Export (Sonnet Implementation Handoff)

Status: **Phase 1 IMPLEMENTED 2026-08-04 (awaiting the user's manual foreground-tab verification). Phase 2 AUTHORIZED. Phases 3–4 not authorized.**

> Phase 1 note: `evaluateLiveExportGuard`'s "no provenance" test had to be a **falsy** check (`!captureSourceUrl && !captureViewport`), not `=== undefined`. `DEFAULT_DEVICE_PRIMARY` uses `''` as the unset sentinel and the `{...DEFAULT_DEVICE_PRIMARY, ...saved.devicePrimary}` spread fills that `''` in for keys missing from an old saved blob — so the real legacy scene reaches the guard with `''`, and a strict `undefined` check would never have matched it.

> ⚠️ Another session is editing `ClothStudio.jsx` and `video-export.js` concurrently (a `preferLiveForFinalRender` / `use-live` step in `planDeviceScreenSteps` landed mid-implementation). Re-read files immediately before every edit; never trust a cached line offset.

Created 2026-08-04. Applies to the HOLO PAPER studio (`app/dashboard/studio/ClothStudio.jsx`, `/dashboard/studio?tool=cloth`).

---

## 0. The situation

The version of Studio deployed to prod exports video correctly. The local working tree has ~7,600 added lines in `ClothStudio.jsx` since that commit (scene elements, GLB t-shirt, device mockup + Go Live, diffusion camera, hero text, timeline, high-res export tiers, Proof/Final Render). Somewhere in that stack, **basic video export stopped working**.

The user's stated original goal was narrow: *a high-fidelity 4K export that doesn't lose frames.* Everything else accreted around it. The job now is to get plain video export working again **without deleting any of the layered work**, then reintroduce quality work deliberately.

### Safety — already done, do not undo

All local work (1,542 files, including all 203 untracked files) is captured on branch **`snapshot/studio-worktree-20260804`**, commit **`50c321c2`**. `HEAD` is unchanged at `47aaea90`; the worktree was never modified to create it.

**Absolute rules for this task:**

- **Never** run `git checkout <path>`, `git restore`, `git stash`, `git reset --hard`, `git clean`, or anything else that discards worktree or untracked files.
- **Never** delete a file to "get back to a working state." Every fix is additive or an in-place edit.
- Do not revert, remove, or disable a feature to make export work. Fix the interaction.
- Do not stage, commit, push, or deploy. The user commits.
- If you believe something must be removed, stop and report instead.

To read the last-known-good implementation for reference, use `git show HEAD:app/dashboard/studio/ClothStudio.jsx` — **read only**, never check it out over the working file.

---

## 1. Confirmed root cause (Phase 1 target)

**Every Export Video click is intercepted by the Go-Live export guard, which fires a paid network screenshot and an 8-second wait before the recorder is ever constructed — and with the user's actual saved state it can never take the fast path.**

Verified live in the browser against the user's real `localStorage` key `holocloth-studio-defaults-v9`:

```
clothShape: "device"      live: true      liveUrl: present      captureUrl: present
captureSourceUrl: ABSENT  captureViewport: ABSENT
frameId: "landscape"      exportResolutionTier: "1x"    perf: "high"
```

The Export Video button (`ClothStudio.jsx:10077`) calls `runExportWithLiveGuard(exportVideo)`, never `exportVideo` directly. That guard calls `evaluateLiveExportGuard` (`app/dashboard/studio/elements/video-export.js:417`):

```js
const liveActive = clothShape === 'device' && Boolean(live) && Boolean(liveUrl);   // true
const captureMatchesLive = Boolean(captureUrl)
  && captureSourceUrl === liveUrl        // undefined === string  -> false
  && captureViewport === viewport;       // undefined === string  -> false
if (!captureMatchesLive) return { action: 'capture-then-await', ... };
```

The provenance fields (`captureSourceUrl`, `captureViewport`) were introduced by a later hardening round. **The user's saved scene predates them**, so `captureMatchesLive` is permanently false and the guard always returns `capture-then-await`. The module's own comment acknowledges this: *"Absent provenance (a legacy capture saved before this round) never matches — treated exactly like no capture at all."*

What then happens on every single export attempt:

1. `POST /api/public/studio-device-capture` — a **browserless** full-page screenshot. Costs a quota unit that `api/_lib/studio-device-capture.cjs` explicitly does **not** refund on failure. Status reads *"This can take up to a minute."*
2. On any failure (network, token, quota, SSRF rejection, timeout): `setStatus('Could not capture the website for export — try again.')` and **`exportVideo` is never called**. No recorder, no file, no error dialog — just a status line.
3. On success: Live is paused, then `awaitLiveScreenTeardownThenRun` polls via `requestAnimationFrame` for up to 8 s waiting on three THREE.js `userData` signals (`deviceLiveGone`, `screenMaterialRestored`, `capturedTextureApplied`) plus one committed frame. If any never lands, it times out and **`exportVideo` is never called**.

So the button can consume a paid API call and then do nothing, twice over, and both failure exits look identical to "the export button is broken." This is a pure regression: the prod `exportVideo` (`git show HEAD:app/dashboard/studio/ClothStudio.jsx`, ~line 3031) is called directly on click and is entirely local — no fetch, no guard, no gate.

**Immediate user-side workaround to verify the diagnosis before writing any code:** toggle Go Live **off** (or switch Subject away from Device). `evaluateLiveExportGuard` then returns `proceed` and export runs the normal path. If export works with Go Live off and fails with it on, Phase 1 is confirmed.

---

## 2. Secondary blockers (Phase 2 — do not fix yet, but do not break)

These are pre-flight gates added after prod that can also refuse to start an export. Prod had none of them; it always attempted the recording.

- **`canSustainExportCapture` hard-blocks below 27 fps** (`video-export.js:257`, called at `ClothStudio.jsx:8180`). Throughput is measured *after* resizing the renderer to the boosted crop source, with the full current FX chain live. On a heavier scene this legitimately reads under 27 and the export is refused with *"This device can't sustain a usable … capture."* Prod never measured anything.
- **Two `document.hidden` hard-blocks** (`:8132`, `:8173`). Correct in intent, but they abort rather than warn.
- **Boosted crop-source memory at the `2x` tier.** `computeCropSourceResolution` (`video-export.js:175`) inverts the 0.92 crop margin against the *stage* aspect, so a 4:3 stage exporting 9:16 "4K" renders ≈5565×4174 (23 MP) to produce a 2160×3840 (8.3 MP) file. With two HalfFloat composer targets, `diffuseTarget`, the shared `DepthTexture`, UnrealBloom's mips, an MSAA default framebuffer and `preserveDrawingBuffer: true`, that is >1.5 GB of GPU memory. At the user's saved `1x` tier this is roughly prod-equivalent (2181×1174 vs prod's 2100×1130), so it is **not** the current blocker — but it is why `2x` fails.

---

## 3. Confirmed defects found in review (Phase 3 — do not fix yet)

1. **`progressTimer` leak on the MP4→WebM retry.** `progressTimer` is assigned at `ClothStudio.jsx:8277`. When `rec.onstop` sees an empty MP4 and retries (`:8228-8231`) it returns without calling `cleanup()`, so attempt 1's interval handle is overwritten by attempt 2 and never cleared. It keeps calling `setRecordingProgress` every 200 ms for the life of the page.
2. **Export changes FX pixel-frequency, so the video does not match the preview.** The render loop sets `resW/resH` from `renderer.domElement.width` (`:4575`), and the treatment shader defines halftone cells, dither, scanlines, chroma and grain in pixels (`vUv * uRes`, lines 578/587/594/610/619/631). Boosting the backing store during recording shrinks all of them. The still exporter deliberately does the opposite and documents why at `:7841`. `exportVideo` never got that treatment.
3. **`evaluateExportCapability` is called with a hardcoded `fps: 30`** (`:7942`) while `chooseCaptureFps` may then select 60 — the pixel-frame budget warning under-counts by 2×.
4. **Server encode is untagged for color.** `services/studio-render/art-render.mjs:641` passes `-crf 18 -pix_fmt yuv420p +faststart` with no `-preset` and no `bt709` primaries/trc/colorspace, so HD output may be interpreted as BT.601 by players — a color shift versus the browser preview.

---

## 4. Phase 1 — make export always reach the recorder

**Objective:** clicking Export Video always ends in either a downloaded file or an explicit, actionable error. It must never silently end with no recording, and it must never require a network call.

### 1a. Trust a legacy capture instead of forcing a re-capture

In `evaluateLiveExportGuard` (`app/dashboard/studio/elements/video-export.js`), a `captureUrl` that carries **no provenance at all** (`captureSourceUrl` and `captureViewport` both absent/undefined) must be treated as usable — take the `await-readiness` path, not `capture-then-await`. Provenance that is *present and mismatched* must keep today's behavior (that check exists to stop exporting a stale site, and it is correct); only the **absent** case changes.

Update the module header comment: it currently documents the opposite decision. State plainly that a legacy capture is trusted because forcing a re-capture makes export depend on a paid network call.

### 1b. Never let a guard failure end the attempt silently

Both failure exits must fall through to running the export anyway, with an honest status:

- `captureDeviceScreenForExport(...).catch(...)` in `runExportWithLiveGuard` (`ClothStudio.jsx:5916`) — on failure, set a status saying the live screen could not be captured and the export is proceeding with whatever the screen currently shows, then call `fn()`.
- The 8-second timeout inside `awaitLiveScreenTeardownThenRun` — same treatment: state that the captured screen did not settle in time and the export is proceeding anyway, then call `fn()`.

Rationale: recording *something* is strictly better than recording nothing. The existing behavior optimizes for "never export a wrong-looking frame" and pays for it with "never export at all," which is the wrong trade for a draft-quality Quick Export.

### 1c. Add a guard bypass the user can always reach

Add a checkbox or small toggle next to Export Video: **"Skip live-screen prep"** (`id="studio-export-skip-live-prep-toggle"`). When on, the Export Video / Export PNG / Export Timeline buttons call their export function directly, bypassing `runExportWithLiveGuard` entirely. Default off. Persist it in the existing settings object alongside `exportResolutionTier`.

This is the escape hatch: whatever else breaks in the device/live subsystem, there is always a path to a recording.

### 1d. Make the failure states visible

Every early return in `exportVideo` and in the guard currently only calls `setStatus`. Add a `console.warn('[holocloth] export aborted', { reason, ... })` at each one so the next diagnosis takes seconds rather than a code read. Keep the existing `[holocloth]` prefix.

### Tests required (Phase 1)

Extend `app/dashboard/studio/elements/__tests__/video-export.test.js`:

- `evaluateLiveExportGuard` returns `await-readiness` when `captureUrl` is set and both provenance fields are absent (the regression case).
- It still returns `capture-then-await` when provenance is present and mismatched.
- It still returns `capture-then-await` when there is no `captureUrl` at all.
- It still returns `proceed` when Live is inactive or the subject is not a device.

Run `npm test` — the suite is `node --test`, not vitest. Report the before/after counts.

### Phase 1 gate

Stop here and report. The user must verify in a **foregrounded** browser tab (automation runs the tab hidden, which throttles `requestAnimationFrame` and trips the visibility guards, so an agent cannot validate this itself):

1. With Go Live **on**, click Export Video → a file downloads.
2. With Go Live **off**, click Export Video → a file downloads.
3. With the new bypass toggle **on**, click Export Video → a file downloads.
4. Export Timeline and both Export PNG buttons still work.

Report what you changed, what you could not verify, and stop.

---

## 4B. Phase 3 — remove the high-resolution tier, fix the defects (AUTHORIZED 2026-08-04)

User decision: **drop the 4K/2x capability entirely.** The goal is the shortest reliable path to a video of the canvas with any subject installed — holo paper, device mockup, GLB t-shirt, scene elements. High-resolution export returns later on the Phase 4 architecture, not on `MediaRecorder`.

Removing the tier system deletes the boosted crop-source resize, which is what made the export heavy, and it also **resolves defect §3.2 for free**: with the renderer never resized mid-recording, `resW/resH` stay at their live values and the FX pixel-pitch no longer shifts. Do not fix §3.2 separately — verify it is gone.

### 3a. Record the crop at native frame size, like the prod version

Target behavior for `exportVideo`, matching `git show HEAD:app/dashboard/studio/ClothStudio.jsx` (~line 3031, read-only reference):

- With a capture frame active: copy the crop into an offscreen canvas sized exactly `FRAME_PRESETS[frameId].w × .h` (1080×1080 / 1080×1350 / 1080×1920 / 1920×1080) and record that.
- With `frameId: 'off'`: record `renderer.domElement` directly, unchanged.
- **The renderer, composer, and `diffuseTarget` are never resized for an export.** No `setPixelRatio`, no `setSize`, no restore.

Remove from `exportVideo`: the `preset`/`sourceSize` computation, the `applyExportResize` call, the `world.diffuseTarget?.setSize(...)` call, the `prevPixelRatio` capture and both restore calls in `cleanup()`, and the `preset`-conditional branches in the status/filename strings (keep the frame's own `fr.w × fr.h` dimensions in the status text and the `-<slug>` filename suffix; drop the `-ultra` suffix).

`world.exportLock` and the `ResizeObserver` early-return that reads it are now pointless — nothing changes the renderer size during a recording. Remove both, and the `applyLiveSize()` call in `cleanup()` that only existed to undo the resize. Leave `applyLiveSize` itself and its other callers alone.

### 3b. Remove the tier system from `elements/video-export.js`

Delete `RESOLUTION_TIERS`, `getResolutionTiers`, `findResolutionPreset`, `computeCropSourceResolution`, `applyExportResize`, and `FRAME_RECT_MARGIN`. Simplify `startExportCapture`'s signature to `{ buildCaptureSource, captureFps, MediaRecorderCtor, mime, videoBitsPerSecond }` — it no longer resizes anything; its guarded allocate-and-release-on-throw contract is unchanged and still wanted.

Flatten `BITRATE_PRESETS` to one value per container (`mp4: 12_000_000`, `webm: 8_000_000` — the prod values) and simplify `getBitrateForTier` to `getBitrateFor(format)`.

Keep and do not weaken: `evaluateExportCapability`, `estimatePixelFrameWork`, `MAX_REALTIME_PIXEL_FRAME_BUDGET`, `chooseCaptureFps`, `canSustainExportCapture`, `describeUnsustainableCapture`, `startMediaRecorderWithFallback`, `evaluateLiveExportGuard`, `isLiveTeardownReady`, `planDeviceScreenSteps`, `shouldResumeLiveAfterExport`. `planDeviceScreenSteps` in particular belongs to Final Render — do not touch it.

### 3c. Remove the tier UI, keep the saved field readable

Remove the export-resolution selector from the Render panel and the `exportResolutionTier` React state.

**Do not** remove the key from persisted data handling: `captureMasterRecipe` and `applySceneRecipe` both carry `exportResolutionTier`, and master saves / scene recipes already on disk contain it. Accept and ignore it on read so an existing save still applies cleanly, and stop writing it. Confirm no saved-recipe round-trip test breaks; if one asserts the field survives, update the assertion to match the new contract rather than deleting the test.

### 3d. Defect — `progressTimer` leaks on the MP4→WebM retry

`progressTimer` is assigned in `startRecording`. When `rec.onstop` detects an empty MP4 and retries as WebM, it returns without calling `cleanup()`, so attempt 1's handle is overwritten by attempt 2 and never cleared — it keeps calling `setRecordingProgress` every 200 ms for the life of the page. Clear any existing timer before assigning a new one, and clear it on the retry branch itself.

### 3e. Defect — capability check under-counts the frame budget

`evaluateExportCapability` is called with a hardcoded `fps: 30` while `chooseCaptureFps` may later pick 60, halving the real pixel-frame estimate. Pass the worst case (`HIGH_CAPTURE_FPS`) so the warning is honest. This is warning-only; it must not become a block.

### 3f. Defect — server encode is untagged for color

`services/studio-render/art-render.mjs`'s `encodeWithFfmpeg` passes `-c:v libx264 -crf 18 -pix_fmt yuv420p -movflags +faststart` with no color metadata, so HD output can be read as BT.601 and shift color versus the browser preview. Add `-color_primaries bt709 -color_trc bt709 -colorspace bt709`. This is the Final Render path, not the browser path — it must not change resolution, fps, duration, or frame count, and the existing `validateWithFfprobe` assertions must still pass unchanged.

### Tests required (Phase 3)

- Update `app/dashboard/studio/elements/__tests__/video-export.test.js` for every removed/renamed export. Tests for deleted functions get deleted with them; tests for kept functions must not be weakened to pass.
- Add a test that `startExportCapture` still releases the crop-copy loop and the stream tracks when the `MediaRecorder` constructor throws.
- Keep the Phase 1 `evaluateLiveExportGuard` provenance tests passing unmodified.
- Re-run the vendored-copy sync script after editing `elements/`, so the drift guard stays green.

### Phase 3 gate

Manual verification in a foregrounded tab, one export each: holo paper cloth, device mockup, GLB t-shirt, and a scene with elements — at `frameId: 'off'` and at one fixed frame. Each must download a playable file.

## 5. Phase 4 — planned, not authorized

- **Phase 2:** convert the remaining pre-flight gates from blocks to warnings. `canSustainExportCapture` should surface "this may drop frames" and proceed; `document.hidden` should stay a block (it genuinely cannot produce a real capture) but must say so before any paid or slow work happens. Restore prod's "always attempt" posture.
- **Phase 3:** the four confirmed defects in §3.
- **Phase 4:** the actual original goal — frame-exact high-resolution export. `MediaRecorder` cannot guarantee this at any resolution; it samples asynchronously while the sim advances on wall-clock `clock.getDelta()` (`ClothStudio.jsx:4446`). The two honest routes are (a) the existing deterministic server pipeline in `services/studio-render/` (fixed timestep → PNG sequence → libx264, already ffprobe-validated), or (b) an in-browser WebCodecs `VideoEncoder` + muxer driven off a fixed-timestep step function, which drops zero frames because it does not run in real time. (b) is the smaller change and needs no cloud. Decide before building.

Phase 4 is where the 4K work belongs, and it should be reached **after** basic export is trustworthy again — not before.

---

# Phase 5 — "blank timeline export" + "records an example domain" (2026-08-04)

Two user-reported defects that predate this week's work:

1. *"Export timeline gives me a blank screen."*
2. *"The render button loses the live url site and records an example domain."*

## 5.0 Prod is not a reference for either of these

The user asked to diff against the working production version. **That comparison cannot exist for these two symptoms.** `git show HEAD:app/dashboard/studio/ClothStudio.jsx` contains zero occurrences of `deviceLive`, `devicePrimary`, `exportTimeline`, `timelineClock`, `cssRenderer`, `captureUrl`, or `liveUrl` — prod's Studio is cloth-only, with no device mockup, no live screen, and no timeline. Prod remains a valid reference for the plain cloth export path (already restored in Phases 1–3) and for nothing else. Both symptoms live entirely in code that has never been deployed.

## 5.1 Traced chain — what was confirmed, what was refuted

Verified by reading the code, not assumed.

**CONFIRMED**

- `devicePrimary.captureUrl` points at a stored screenshot, loaded with `THREE.TextureLoader` in `deviceApplyScreenSource`/`deviceSyncScreenTexture` (`elements/factories.js:3547`).
- **The error callback swallows the failure** (`factories.js:3565-3569`). It only resets `appliedScreenKey`; nothing is recorded, nothing is logged, no caller can observe it. The procedural placeholder stays on the screen mesh and `root.userData.screenCaptureTexture` is never assigned.
- The procedural placeholder (`makeDeviceScreenTexture`, `factories.js:3429`) is a generic fake website — nav bar, hero + CTA, card row, footer. **This is the "example domain."** There is no literal `example.com` in the studio or render code.
- `awaitLiveScreenTeardownThenRun` (`ClothStudio.jsx:5843`) requires `capturedTextureApplied` (`screenMaterial.map === screenCaptureTexture`). After a swallowed load failure that is permanently false, so the guard always burns its full 8-second deadline.
- Phase 1's unconditional "proceed anyway" at that deadline (`ClothStudio.jsx:5862-5877`) then records the placeholder — **symptom 2** — and the same unconditional proceed in the capture-fetch `.catch` (`ClothStudio.jsx:5953-5963`) is worse still: that branch never paused Live, so `world.deviceLive` is non-null, the render loop sets `treatmentPass.uniforms.uCleanAlphaHole = 1` (`ClothStudio.jsx:4630`), and the screen region records as a transparent hole.

**REFUTED**

- **Not an expired signed URL.** `captureUrl` is never a signed storage URL. `app/api/public/studio-device-capture/route.js` mints `/api/public/studio-device-capture?id=<sha1>&v=<ts>` — its own GET. Nothing about it expires: the Firestore cache doc (`studio_device_captures`) and the object (`public/studio-device-captures/<id>.<ext>`) are never deleted by any retention sweep in this repo, and `CACHE_TTL_MS` only gates *re-capture*, never serving (a stale doc is still served — the route says so explicitly).
- **Not CORS / a missing `crossOrigin`.** The route comment states the reason the image URL is its own GET: *"SAME-ORIGIN on purpose, so the WebGL texture load never depends on storage-bucket CORS headers (the plan's flagged top risk)."* `pinDeviceScreenIfNeeded` already hard-asserts the same-origin shape (`ClothStudio.jsx:6533`).
- **Not a rebuild/dedupe race.** `deviceRebuild` resets `root.userData.appliedScreenKey = null` (`factories.js:3721`), so a topology rebuild does re-apply the capture.

What remains as a genuine load failure for that same-origin GET: a missing Firestore doc or storage object (404), a Firestore/Storage throw (the GET's `readCachedCapture` call is **not** wrapped, so it returns a 500 HTML page), or a `captureUrl` persisted in a pre-same-origin shape by an older build (which *would* fail cross-origin). All three are indistinguishable today because the failure is swallowed.

**THE CHAIN'S BIGGEST MISS — the real cause of symptom 1**

`exportTimeline` re-enables the live iframe *after* the guard tore it down.

- `captureSceneRecipe` (`ClothStudio.jsx:5494`) stores the entire `devicePrimary` object in every keyframe, including `live: true` and `liveUrl`.
- `applySceneRecipe` (`ClothStudio.jsx:5550`) merges it straight back: `setDevicePrimary(prev => ({ ...DEFAULT_DEVICE_PRIMARY, ...prev, ...r.devicePrimary }))`.
- `exportTimeline` calls `applySceneRecipe(kf0.recipe)` (`:8393`), and `stepTimelinePlayback` calls `applyRecipeFn(blendRecipes(from, to, 0))` at **every keyframe-pair boundary** (`:1231`) plus `applyRecipeFn(toKf.recipe)` on completion (`:1274`).
- The live-screen effect's deps are exactly `[clothShape, worldReady, devicePrimary.live, devicePrimary.liveUrl, devicePrimary.viewport]` (`:7559`), so each of those re-applications **rebuilds the CSS3D iframe and re-punches the alpha hole mid-recording**.

`stripDeviceScreenSource` already exists in `timeline.js:743` and encodes exactly the right rule — *"a keyframe can never carry different screen content mid-video; the BASE scene's own pinned screen is authoritative for the whole render"* — but it is applied **only** at the cloud-submission boundary (`buildTimelineSubmission`). The local Quick Export timeline path has no equivalent. On a device scene with keyframes captured while Go Live was on, Export Timeline therefore records a transparent hole **every time**, regardless of the guard. A device filling the frame = a blank video.

**SECOND, INDEPENDENT `exportTimeline` DEFECT (not device-related — hits cloth-only scenes too)**

`exportTimeline` sets `world.timelineClock.startedAt = world.clock.elapsedTime` (`:8398`) and *then* calls `exportVideo(dur)`. `exportVideo` awaits `measureSustainableFps()` (up to a 1500 ms hard ceiling) plus encoder setup before `MediaRecorder` actually starts. The timeline is therefore already ~1.5–2 s in when the first frame is captured, and it reaches `done` ~1.5–2 s before the recorder stops. On a 3-second timeline roughly half the clip is the wrong content: the opening is missing and the tail is a frozen final frame. Not "blank," but a real defect, and on a short timeline it reads as one.

## 5.2 What the fix must achieve

Never record a knowingly-wrong frame; never silently record nothing. Make the frame honest *before* recording.

## 5.3 Changes

**A. `elements/factories.js` — stop swallowing the texture-load failure.**
Add three exported pure helpers (testable in Node — the loader itself is browser-only): `classifyScreenSourceUrl(url)` (`'route' | 'data' | 'foreign'`, mirroring the `pinDeviceScreenIfNeeded` hardening check), `recordScreenCaptureLoadFailure(userData, { key, url })`, and `clearScreenCaptureLoadError(userData)`. The loader's error callback records `userData.screenCaptureError = { url, reason }` and `console.warn`s; the success callback and the revert-to-placeholder path clear it. `screenCaptureTexture` is deliberately **not** nulled on failure — the readiness predicate already reports the truth about the current map, and nulling it would misreport a still-valid older capture.

**B. `elements/video-export.js` — the deadline branch becomes a pure decision.**
New `evaluateLiveTeardownDeadline({ deviceLiveGone, screenMaterialRestored, capturedTextureApplied, wantsCapturedScreen, screenCaptureError })` → `{ action: 'proceed' | 'stop', message }`:
- live iframe still up, or the alpha-punch material not restored → **stop** (recording it produces a transparent hole);
- an unresolved `screenCaptureError` for the wanted source → **stop**, naming the URL;
- the scene has a screen source but it never became the screen map → **stop** (it would record the placeholder site);
- otherwise → **proceed**. This preserves Phase 1's intent exactly: a guard hiccup on a scene with no live hole and no capture requirement still exports.

**Why stop rather than auto-recapture.** By the time this deadline is reached the guard has *already* either obtained a fresh capture successfully or verified one exists. The failure is that the image the browser already holds a URL for will not load. A second browserless call costs a quota unit that `studio-device-capture.cjs` explicitly does not refund, and the route's 24 h cache would return the same cached bytes at the same URL — so it would very likely fail identically while spending money. Stopping with the URL named is both cheaper and more informative. The user already has two zero-cost recovery paths: the Capture button, and the **Skip live-screen prep** toggle.

**C. `ClothStudio.jsx` — tear the live screen down for real, not on a timer.**
Extract the live effect's `restore()` into a module-scope `teardownLiveScreenNow(world)` and call it from `runExportWithLiveGuard` immediately after each `setDevicePrimary(..., live: false)`, so the iframe removal + hole-material restore is synchronous instead of waiting on a React commit. The effect keeps calling the same helper; it is idempotent.

**D. `ClothStudio.jsx` — the capture-fetch `.catch` becomes conditional.**
If a `captureUrl` already exists, fall through to the await-readiness path (pause Live, tear down, wait) — recording a real, if unprovenanced, capture beats stopping. If there is no capture at all, **stop** with an actionable message; Live was never paused in that branch, so there is nothing to resume. The unconditional `fn()` — which recorded the alpha hole — is gone.

**E. `timeline.js` + `ClothStudio.jsx` — a timeline export can never re-enable the live screen.**
Export `stripDeviceScreenSource`; apply it in `exportTimeline`'s initial `applySceneRecipe`, and inside `stepTimelinePlayback` for **every** recipe application while `clock.exporting` is true. This makes the local export honor the same rule the cloud submission already does.

**F. `ClothStudio.jsx` — anchor the timeline clock to the real recording start.**
At the point `exportVideo` actually starts `MediaRecorder` (where `textAnimClock` is bracketed), re-anchor `world.timelineClock.startedAt` and reset `lastFromIndex`/`lastTextLayersKey`/`lastU` when `clock.exporting` is set, so the recording brackets the whole pass instead of losing its opening.

**G. `app/api/public/studio-device-capture/route.js` — the GET stops returning HTML 500s.**
Wrap the GET's `readCachedCapture` so a Firestore/Storage error returns a clean JSON 503 instead of an unhandled throw. Does not change the success path or the POST.

## 5.4 Tests

- `elements/__tests__/video-export.test.js` — every `evaluateLiveTeardownDeadline` branch, including that a no-source scene still proceeds (the Phase 1 intent) and that a live iframe still up never proceeds.
- `elements/__tests__/factories.test.js` — `classifyScreenSourceUrl`, and that a recorded load failure is observable and clearable (the swallowed-error regression).
- `__tests__/timeline.test.js` — `stripDeviceScreenSource` directly: removes every screen-source field, returns the same reference when there is nothing to strip, never mutates.
- Re-run `services/studio-render/scripts/vendor-elements.mjs` and `vendor-timeline.mjs` (both `factories.js`/`video-export.js` and `timeline.js` are vendored; the byte-compare drift guard fails otherwise).

## 5.5 Not verifiable by an agent

Automation runs the tab hidden, which throttles `requestAnimationFrame` and trips `exportVideo`'s two `document.hidden` blocks, so no agent can validate a real export. A foregrounded-tab pass is required — see the gate in §5.6 of the report.

---

# Phase 6 — "the export literally records example.com" (2026-08-04)

Status: **IMPLEMENTED 2026-08-04. Tests 2467 → 2470, 0 fail. Awaiting the user's foregrounded-tab verification (see §6.6).**

## 6.0 The measured cause — not a capture failure at all

The reported symptom: the live preview shows the real site (`hitloop.agency`), every export shows "example domain."

The investigating hypothesis going in was that the browserless capture of a JS-heavy site was failing/blanking and being cached for 24 h. **That is refuted.** Read directly out of Firestore (free, no browserless call), `studio_device_captures` holds exactly five docs, and there is **no doc for `hitloop.agency` at any viewport**. The doc the user's scene points at is:

```
id        c54ea80a8c0142eab4bddef88a95faca4ed1e053
url       https://example.com/          <-- not the user's site
viewport  desktop
bytes     17259     dims 1440x900       capturedAt 2026-08-03T06:31:33Z
```

Downloaded and decoded, that image is the real IANA **"Example Domain"** page — heading, sentence, "Learn more" link on `#eee`. It is a *successful, correct* capture. It is 1440×900 because `example.com` is a short page, so its full-page height **is** the viewport height. `17259` bytes matches the bytes fetched from the live `captureUrl` exactly, so this is definitively the image being exported.

So "it goes to example domain" is literal, not a metaphor for the procedural placeholder (§5.1) and not a blank render.

**How it gets there:** the saved scene has `liveUrl: "hitloop.agency"` but `captureUrl` = the example.com capture, with **no provenance** (`captureSourceUrl`/`captureViewport` empty). Phase 1 §1a deliberately made the guard *trust* an unprovenanced capture:

```js
const hasNoProvenance = !captureSourceUrl && !captureViewport;
const captureMatchesLive = Boolean(captureUrl)
  && (hasNoProvenance || (captureSourceUrl === liveUrl && captureViewport === viewport));
```

That was written for a legacy capture assumed to be *of the current site*. The user's legacy capture is of a **different** site, so the guard returns `await-readiness`, pins the example.com texture, and records it. Phase 1 converted a transient annoyance (an extra paid capture per export) into a permanent wrong-content export.

The same file already encodes the correct rule for the Proof/Final Render path and directly contradicts the guard:

```js
// planDeviceScreenSteps
const captureMatchesLive = dp.captureSourceUrl === dp.liveUrl && dp.captureViewport === dp.viewport;
if (!liveActive || captureMatchesLive) return { steps: ['use-capture', 'proceed'] };
// "Absent provenance ... never matches — treated exactly like having no capture at all"
```

Two functions, one file, opposite answers to the same question. Phase 6 makes them agree.

**Cost objection answered:** re-trusting nothing costs at most **one** paid capture per (URL, viewport) per 24 h, because (a) the guard writes provenance on success, so every later export matches and takes the free `await-readiness` path, and (b) same-URL re-captures inside 24 h are served from the route cache for free. `planDeviceScreenSteps` has been paying exactly this price all along.

## 6.1 Evidence points checked

| # | Claim | Verdict |
|---|---|---|
| 1 | Live iframe normalizes a scheme-less URL, so the preview is right | **confirmed** (`ClothStudio.jsx` live effect) |
| 2 | The capture route normalizes too — a missing scheme is not the bug | **confirmed** (`route.js:71`) |
| 3 | `hitloop.agency` is a real, content-rich site | **confirmed** — and irrelevant; it was never captured |
| 4 | The cached capture is not that site | **confirmed, different reason** — it is a correct capture of a *different URL* |
| 5 | 1440×900 proves a viewport-only last-resort fallback ran | **refuted, twice.** `example.com`'s full page genuinely is 900px tall; and this route passes **no `fallbackVariant`** to `captureScreenshotBuffer`, so that fallback branch is unreachable here |
| — | Hydration/paint-timing exhausts the retry ladder | **refuted** — the ladder never ran; there is no failed-capture record for this URL at all |

## 6.2 Changes

**A. `elements/video-export.js` — the guard stops trusting unprovenanced captures (the actual fix).**
Delete the `hasNoProvenance` escape from `evaluateLiveExportGuard` so it matches `planDeviceScreenSteps` exactly: while Live is active, a capture is trusted only when `captureSourceUrl === liveUrl && captureViewport === viewport`. Live inactive still `proceed`s untouched. Rewrite the Phase 1 comment block to record why the "trust legacy" decision was wrong.

**B. `api/_lib/studio-device-capture.cjs` — never cache a blank capture.**
New `assessCaptureContent(buffer)` → `{ ok, reason, stdev, nonBackgroundFraction }`. Decodes with `sharp` (already a root dep, already used in `app/briefs/.../og-image/route.js` and `api/_lib/device-mockup.cjs`), downsamples to 64×64, and rejects only a genuinely **uniform** frame.

Calibrated against the five real stored captures rather than guessed:

| capture | stdev | non-background @64×64 |
|---|---|---|
| synthetic flat white | 0.00 | 0.0000 |
| example.com (sparsest real page) | 9.56 | 0.0427 |
| vercel.com / wikipedia / critters.quest | higher | higher |

Thresholds: reject when `stdev < 1.0` **and** `nonBackgroundFraction < 0.005`. That is a ~9× margin under the sparsest legitimate capture. **Explicitly rejected as a heuristic: "a full-page request that returned exactly viewport height is a failed capture."** `example.com` is the counter-example — short pages legitimately return viewport height, and blocking them would be a new bug.

Fails **open**: if `sharp` cannot be loaded or the buffer cannot be decoded, the capture is allowed through. A quality check must never be the reason a working capture is lost.

**C. `api/_lib/studio-device-capture.cjs` — the cache-serving decision becomes a testable pure function.**
`shouldServeCachedCapture({ cached, forceRefresh })` → `{ serve, reason }`. The route already accepted `refresh: true`; this extracts the decision so the force-recapture path has real unit coverage instead of living only inside a Next route file.

**D. `app/api/public/studio-device-capture/route.js` — reject before persisting; honest error.**
Run `assessCaptureContent` on the browserless buffer *before* `saveBufferArtifact`/`saveCaptureCacheDoc`. On rejection: fall back to an existing (stale) cache doc if one exists, else return `502` naming the reason. Nothing blank ever reaches the cache. Also passes the new per-call browserless waits (E).

**E. `api/_lib/browserless.cjs` — an adaptive content wait, opt-in per call.**
One new optional arg on `captureScreenshotBuffer`, threaded through `...args` to `captureScreenshotBufferOnce`, defaulting to today's exact behavior so no other consumer moves: `waitForContent` swaps the fonts-only `waitForFunction` for one that additionally polls (bounded, always resolving true so `bestAttempt: true` still yields a shot) until the document actually contains text or media. `domcontentloaded` + `document.fonts.ready` can both be satisfied while a client-rendered app's root is empty.

Deliberately **adaptive rather than a longer fixed `waitForTimeout`**: a fixed extra wait is spent even on a page that rendered instantly, and it is spent out of the same request-timeout budget the render itself has to fit inside — which, per §6.2E-bis below, is exactly the budget that is already failing.

**E-bis. The measured second cause: `hitloop.agency` never captures full-page, and this route cannot report that in production.**
Discovered from the `browserless_requests` ledger (free) after the one authorized paid capture returned 408:

```
2026-08-04T22:09..22:11  hitloop.agency  desktop-full  45s/60s/60s  408 408 408   <- this session
2026-08-04T18:47..18:49  hitloop.agency  desktop-full  45s/60s/60s  408 408 408   <- pre-change
2026-08-04T16:33..16:35  hitloop.agency  desktop-full  45s/60s/60s  408 408 408   <- pre-change
2026-08-04T12:54..12:56  hitloop.agency  desktop-full  45s/60s/60s  408 408 408   <- pre-change
2026-08-04T12:54:02      hitloop.agency  desktop       7,978ms      200           <- viewport WORKS
```

Three identical pre-change ladders prove the timeout is **not** caused by the new wait. And the 200 proves the site captures fine at **viewport** height in 8 seconds; it is specifically `desktop-full` + `scrollPage` that never completes. This is why `studio_device_captures` has no doc for the URL, which is why the scene still carried the example.com capture. Two independent causes, one symptom.

Two consequences fixed in the route:

1. **The ladder cannot fit `maxDuration`.** 45 + 60 + 60 + 3s backoff ≈ 168s against a declared `maxDuration = 120`, so on any site that exhausts it the Vercel function is killed before the honest 502 can be returned. Bounded to `maxAttempts: 2` at 42s each (~85s).
2. **The already-built viewport fallback was never wired.** `captureScreenshotBuffer`'s `fallbackVariant` docblock names this route as its intended consumer ("the route wires this to a viewport-only variant as a LAST-RESORT fallback after a full-page attempt exhausts its own budget") — but the wiring did not exist. Now wired to the same device's viewport-only variant at a 25s budget. Worst case ≈ 110s, inside `maxDuration`. Costs exactly one extra browserless call, only after the full-page ladder is spent.

The degradation is real and must never be silent: a viewport-height texture gives the device's scroll-pan nothing to travel. The route returns `fellBackToViewport: true` and `DeviceScreenControl` says *"only the top screenful; the full page took too long to render, so the screen won't scroll."*

**F. `components/DeviceScreenControl.jsx` — a user-reachable force re-capture, and an honest fallback message.**
A `FORCE FRESH` toggle (`id="cloth-device-screen-force-recapture-toggle"`) next to CAPTURE that sends `refresh: true`, bypassing the 24 h cache. The escape hatch from any poisoned or merely outdated cached capture.

## 6.3 Tests

- `elements/__tests__/video-export.test.js` — the two "absent provenance → await-readiness" tests invert to `capture-then-await` (they encode the defect); matching-provenance, mismatched-provenance and live-inactive cases stay untouched.
- `api/_lib/__tests__/studio-device-capture.test.js` — `assessCaptureContent` accepts a content image and the real sparse-page shape, rejects a flat frame, and fails open on an undecodable buffer; `shouldServeCachedCapture` covers fresh/stale/absent × `forceRefresh`.
- Re-run `services/studio-render/scripts/vendor-elements.mjs` (`video-export.js` is vendored; the byte-compare drift guard fails otherwise).

## 6.4 The constraint the user has to hear

*"We aren't capturing, we are trying to load the full live url."* For a **browser export** that is not achievable, at any effort. The live screen is a CSS3D `<iframe>` composited **behind** the WebGL canvas through an alpha-punched hole; `canvas.captureStream()` records the canvas only, and no browser API rasterizes a cross-origin iframe into a canvas. The screenshot capture is the only mechanism by which the live site's pixels can reach a browser export — so fixing the capture *is* the fix for the stated goal.

The one path where "load the real live URL" is literally true is the **server-side Final Render**, which already exists and already does it.

## 6.5 The Final Render path — how close it is, and why it is not this task

Not built here, deliberately. Reported because it is the only mechanism that does what the user literally asked for.

Already in place: `api/_lib/proof-render-live-url.cjs` (`resolveDeviceLiveUrl`) SSRF-validates and normalizes a submitted `devicePrimary.liveUrl`, wired into `app/api/dashboard/proof-render/route.js`. `planDeviceScreenSteps({ preferLiveForFinalRender: true })` already routes a live-active scene to `use-live` instead of pinning a still. `services/studio-render/art-render-validation.mjs` has **lifted** the `device-screen-live` capability gate, and `art-render.mjs` calls `services/studio-render/live-site-capture.mjs` to capture the live URL as a real **frame sequence** in Playwright Chromium — with a genuine readiness probe (`waitForCaptureReady`, `shouldSettleStuckPage`, paint-stability checks against text/media/canvas), not a fixed timer. It throws rather than render a blank sourced screen.

So it is not a sketch; it is a built path. It is also strictly better for `hitloop.agency` than the browserless route: no 60s vendor ceiling, no full-page/scrollPage stall, and a real readiness signal. What it still needs before it can be recommended as the answer is the deployment/lifecycle work the deterministic-render handoff already tracks (Cloud Tasks, deploy, rollout) — out of scope here, and gated on the user per that doc.

## 6.6 Not verifiable by an agent

- A real export requires a **foregrounded** tab (automation runs it hidden, which throttles rAF and trips `exportVideo`'s `document.hidden` blocks).
- With the guard now refusing an unprovenanced capture, the user's first export with Go Live on will trigger a real capture of `hitloop.agency`. Whether the new viewport fallback produces a usable screen for that site has **not** been proven end-to-end — the one authorized paid capture was spent proving the full-page ladder fails (3× 408), and the viewport-variant success is inferred from a pre-existing `browserless_requests` 200 for the same URL, not re-run.

---

# Phase 7 — Stop re-running a capture path that has never worked for this URL (2026-08-04)

Status: **plan written, then implemented in the same session.** No paid browserless call spent — every claim below comes from the existing `browserless_requests` ledger and unit tests.

## 7.0 The user-visible defect

"I click Export Video on a device scene with Go Live on and nothing happens."

Nothing is broken. This is what actually happens, end to end:

1. Saved state is `clothShape:'device'`, `live:true`, `liveUrl:'hitloop.agency'`, `viewport:'desktop'`, a `captureUrl` with **no provenance**, `skipLivePrep:false`.
2. No provenance + Live active ⇒ `evaluateLiveExportGuard` returns `capture-then-await` (correct — Phase 6 made this deliberate, and a test asserts it can never diverge from `planDeviceScreenSteps`).
3. The export fires `POST /api/public/studio-device-capture` and waits on it.
4. That capture **cannot succeed full-page for this site.** The ledger holds four separate 3-attempt `desktop-full` ladders for `hitloop.agency`, every attempt HTTP 408, plus one more ladder spent by a later session — seven-plus consecutive 408s, zero successes.
5. So the user sits through ~2×42s of full-page attempts plus a 25s viewport fallback ≈ **110 seconds** with one static status string and a live-looking Export button, then gets an error or a degraded fallback.

From outside, 110 silent seconds is indistinguishable from "nothing happens."

**The key measurement:** the plain `desktop` viewport variant of that exact URL returned **HTTP 200 in 7,978 ms** (same ledger). Full-page + `scrollPage` is what stalls; viewport height works in 8 seconds. Yet the route always leads with `FULL_PAGE_SCREENSHOT_VARIANTS` and only reaches the viewport variant after the full-page ladder is exhausted — so for a site that has never once succeeded full-page that is ~84 seconds of guaranteed waste on **every attempt, forever**.

## 7.1 What Phase 7 changes

**A. `api/_lib/studio-device-capture.cjs` — a per-URL+viewport full-page failure marker, and one pure decision over it.**

- `FULL_PAGE_FAILURE_TTL_MS = 7 days`.
- `markFullPageCaptureFailed(id, { url, viewport, nowMs })` — writes `{ fullPageFailedAt }` with **`{ merge: true }`**, so it can never erase an existing capture's `storagePath`.
- `planCaptureStrategy({ cached, forceRefresh, nowMs })` → `{ strategy: 'full-page' | 'viewport-only', reason, fullPageFailedAt }`. Full-page stays the default for any URL with no recorded failure — it is genuinely better output when it works. Only a marker within the TTL downgrades the *lead* variant.
- **`refresh: true` always retries full-page.** Added during implementation, not in the original sketch: without it the marker is a second write-once-serve-forever trap — a site downgraded by one bad day would have no user-reachable way back to a scrollable screen for a week. `FORCE FRESH` in `DeviceScreenControl` is an explicit opt-in toggle, so the ~84s that retry can cost is spent only when someone asks for it. The automatic export-time capture never sends `refresh`.
- `saveCaptureCacheDoc` gains `fullPageFailedAt`. The write is a whole-doc `set()`, so **omitting the field is how a successful full-page capture clears the marker** — no separate delete, no second write, no window where a stale marker outlives a proof it is wrong.
- `hasStoredCapture(cached)` — the single predicate for "this cache entry has bytes behind it," used by every fallback branch in the route.

**B. `app/api/public/studio-device-capture/route.js` — lead with whichever variant the evidence supports.**

- `full-page` (default): unchanged — 2×42s full-page + `scrollPage`, then the existing single viewport fallback.
- `viewport-only` (marker active): the viewport variant becomes the **primary**, 2 attempts × 25s, no fallback beneath it. Worst case ~51s instead of ~110s; the measured case is ~8s.
- Marker written whenever full-page was actually attempted and did not produce the shot: both-failed, and fell-back-to-viewport-succeeded.
- Marker preserved (original timestamp, never refreshed) when the request never attempted full-page — so the TTL keeps ticking from the real failure and the site gets a genuine full-page retry a week later instead of being downgraded forever by its own success.
- Every stale-cache fallback branch moves from `cached?.doc` to `hasStoredCapture(cached)`.

**C. `app/dashboard/studio/ClothStudio.jsx` — the capture wait stops being silent.**

`runExportWithLiveGuard`'s `capture-then-await` branch holds a `liveCapturePrep` state (`{ url, startedAt }`) for exactly the fetch's lifetime. As built:

- `#cloth-studio-status-row` ticks once a second — `Capturing <url> for the device screen… Ns.` — plus a patience line past 25s. Real elapsed seconds, never a fabricated percentage: the route's duration is not knowable from the client (~8s cached/viewport vs ~110s cold full-page), and a fake bar would be lying about it.
- New `#cloth-export-live-capture-row` in the EXPORT panel: what is happening, why (a live site can't be recorded directly), and that the export starts by itself.
- Export video CTA becomes `Capturing website… Ns`, disabled; both Export PNG buttons disabled; the timeline strip's Export Timeline disabled by passing `recording={recording || liveCaptureBusy}` (that prop is already the strip's "an export is under way" gate).

## 7.2 How a failure marker is prevented from being served as a capture

This is the one genuinely dangerous part of the design: `studio_device_captures/{id}` currently only exists **after a success**, and a marker makes it exist after a **failure**. Three independent guards:

1. `shouldServeCachedCapture` checks `storagePath` **before** freshness, so a marker-only doc returns `{ serve:false, reason:'incomplete-cache-entry' }` — it can never be served as a fresh hit. (Reordered only; every prior verdict is unchanged.)
2. The route's two "honest stale fallback" branches (capture failed / blank capture rejected) used `cached?.doc`, which a marker-only doc satisfies — that would have returned `ok:true` with an `imageUrl` for bytes that do not exist, and the studio's `TextureLoader` would have seen an opaque failure. Both now test `hasStoredCapture(cached)`.
3. `GET` already refuses a doc with no `storagePath` (404), so even a bug upstream cannot serve a marker as an image.

Covered by tests that assert a marker-only doc is never served, never used as a stale fallback, and never mistaken for a fresh entry.

## 7.3 How the marker expires

- **7 days** from the recorded failure (`FULL_PAGE_FAILURE_TTL_MS`). After that the next capture leads with full-page again.
- A successful **full-page** capture clears it immediately (whole-doc `set()` without the field).
- A successful **viewport-only** capture under an active marker keeps the *original* timestamp, so repeated use never extends the downgrade.
- A fresh full-page failure records a fresh timestamp — the loop is self-healing in both directions.
- `FORCE FRESH` (`refresh: true`) bypasses the marker entirely, so the full-page retry is also available on demand.

## 7.4 Tests

`api/_lib/__tests__/studio-device-capture.test.js`, all against `fake-firestore.cjs` (no network, no paid call):
- `planCaptureStrategy` — full-page by default, viewport-only inside the TTL, full-page again past it, unaffected by a capture doc carrying no marker, and always full-page under `forceRefresh`.
- marker-only doc: never served (`shouldServeCachedCapture`), never a stale fallback (`hasStoredCapture`).
- `markFullPageCaptureFailed` merges onto an existing capture doc without destroying `storagePath`.
- `saveCaptureCacheDoc` clears the marker on full-page success and preserves it when told to.

## 7.5 Explicitly not done

- No live/paid capture was run. Whether `hitloop.agency` produces a *usable* viewport screen is still inferred from the ledger's 200, not re-proven.
- `evaluateLiveExportGuard` / `planDeviceScreenSteps` provenance logic untouched (Phase 6's divergence test still governs it).

---

# Phase 8 — "Record live screen": export the REAL website, via tab capture (2026-08-05)

## 8.0 The wrong conclusion every earlier round drew

Every round so far answered "I want my live site in the video" with a **still capture** of the site, on this reasoning:

> the live screen is a CSS3D `<iframe>` behind the WebGL canvas, and `canvas.captureStream()` cannot see DOM behind (or in front of) the canvas — so a live site cannot be recorded.

The premise is true. The conclusion is not. `captureStream()` records **one canvas**. `navigator.mediaDevices.getDisplayMedia()` records the **composited tab surface** — every layer the user can see, cross-origin iframes included. That is the missing path, and Phase 8 builds it as an explicit, user-selected export source.

## 8.1 What is built

A new export SOURCE, off by default, persisted in `SETTINGS_KEY` beside `skipLivePrep`:

- Toggle `#studio-export-record-live-screen-toggle` (row `#studio-export-record-live-screen-row`) in the Render panel. Only rendered for the **Device** subject; disabled with a precise reason unless **Go Live is on with a URL** and the browser has `getDisplayMedia`.
- With it on, **Export video** and **Export Timeline** call `getDisplayMedia` **directly in the click's user-gesture chain** (`{ video:{ displaySurface:'browser', frameRate:30 }, audio:false, preferCurrentTab:true }`), then hand the resulting stream to the EXISTING `exportVideo` lifecycle as `displayCapture`.
- The stream is cropped — stage canvas region, then the active capture frame's aspect — into the SAME offscreen canvas the normal crop-copy already records, so output dimensions and framing are identical to a normal export.
- `startExportCapture` / `startMediaRecorderWithFallback` / `cleanup()` are reused unchanged. The recorder logic is NOT forked.

## 8.2 The one rule this mode exists to keep

**The live iframe stays up for the whole recording.** This mode bypasses `runExportWithLiveGuard` entirely — no capture-then-await, no browserless call, no pause, no alpha hole, no teardown wait. `skipLivePrep` is irrelevant to it. That is the entire point of the mode.

## 8.3 Honest constraints (stated in the UI, not just here)

- Tab capture records at the **surface's own resolution** — the user's display, not a native 1080p/4K framebuffer. A 1080×1920 vertical frame is upscaled from however many real pixels the stage occupies on screen. This mode trades resolution for actually showing the live site.
- Fixed **30fps** (`DEFAULT_CAPTURE_FPS`): the display track, not the renderer, is the limiter, and the rate has to be requested before the throughput measurement can run.
- The stage must be fully on-screen and unobstructed for the whole recording — the crop is of the shared surface, so anything overlapping the stage is IN the video.

## 8.4 Failure handling — never silent

| Case | Detection | Behavior |
| --- | --- | --- |
| User cancels the picker | `NotAllowedError` / `AbortError` | Clean abort, status says so, no state changed |
| User shares a window/screen instead of a tab | `track.getSettings().displaySurface !== 'browser'` | Stop tracks, abort, name what was shared |
| `preferCurrentTab` rejected as a constraint combination | `TypeError`/`NotSupportedError`/`InvalidStateError` on attempt 1 | One retry without `preferCurrentTab`, still inside the activation window |
| API missing entirely | `navigator.mediaDevices.getDisplayMedia` absent | Toggle disabled, reason points at the normal export path |
| Stage partly off-screen | crop rect falls outside the stream | Abort with a message, never a silently wrong crop |
| "Stop sharing" pressed mid-recording | track `ended` | Treated exactly like the Cancel button |

Every exit path (success, cancel, error, capability rejection, no-mime) stops the display tracks — a leaked tab-capture track leaves Chrome's "sharing this tab" bar up.

## 8.5 Pure, dependency-injected decisions (tested)

Added to `app/dashboard/studio/elements/video-export.js`, in the established pattern — the React/DOM glue stays untested, the decisions do not:

- `evaluateLiveRecordEligibility` — may this mode be offered/used at all.
- `evaluateDisplaySurface` — is the shared surface the right KIND of surface (unknown/unreported is allowed, a wrong kind is not).
- `computeDisplayCaptureRect` — maps the canvas's `getBoundingClientRect()` into stream pixels using the REAL ratio between the track's `getSettings().width/height` and the tab viewport (never `devicePixelRatio`), applies the frame-aspect inset, and refuses out-of-bounds crops.
- `describeDisplayCaptureError` / `shouldRetryDisplayCaptureWithoutPreferCurrentTab` — cancel-vs-failure classification and the one legal retry.

## 8.6 Tablet live-URL investigation

Reported: the live URL does not load with the device viewport set to **Tablet**. Findings are in the session report; the code-side conclusion is that the tablet path is symmetric with desktop/mobile at every layer that was suspected (viewport→CSS3D wrapper sizing, the rebuild/re-punch ordering, the hole-material lifecycle, and the async screen-texture sync, which never touches `mesh.material`).

---

# Phase 9 — SHARE TAB: the live site as a real texture, so the FX chain can touch it (2026-08-05)

## 9.0 The problem Phase 8 did not solve

Phase 8 got the live site into an exported **file**. It did not get the live site into the **scene**. Go Live composites a CSS3D `<iframe>` *behind* the WebGL canvas through an alpha-punched hole (`holeMat`, `uCleanAlphaHole`). Those pixels are DOM, never GL — so:

- The Diffusion Camera, bloom, treatment and grain run on the canvas and can **never** reach them. The device screen is the one rectangle in the frame with no post-processing on it, and it reads as a sticker.
- Reading a cross-origin site into a texture is blocked by same-origin policy. Not a missing feature — a rule.

`getDisplayMedia` is the **consented exception**. If the user shares their *site's own tab*, the browser hands us a `MediaStream` we are allowed to sample. Fed to a `THREE.VideoTexture` on the screen mesh, the live site becomes an **ordinary texture in the 3D scene** — at which point every GPU effect applies to it, live, in the preview, and the normal `canvas.captureStream()` export records it with no tab-capture-of-a-composite involved.

## 9.1 What is built

A fourth device-screen source — **SHARE TAB** — alongside placeholder / uploaded image / captured still / Go Live. Session-scoped, never persisted.

- Control lives in `app/dashboard/studio/components/DeviceScreenControl.jsx`, section `#<idPrefix>-share-section`. It is **opt-in by prop**: only ClothStudio's PRIMARY device panel passes `onStartScreenShare`/`onStopScreenShare`, so the Inspector's duplicate-device instances render exactly as they do today.
- The button calls `getDisplayMedia` **directly in the click's user-gesture chain** (no `await` before it) with `{ video:{ frameRate:30 }, audio:false, selfBrowserSurface:'exclude', surfaceSwitching:'include' }`.
  - **`selfBrowserSurface:'exclude'` is load-bearing** — it removes the Studio's own tab from the picker, which is what makes a canvas-showing-itself feedback loop impossible. Unknown dictionary members are ignored per WebIDL, and a browser that *rejects* the combination gets one retry with the plain `{video:true,audio:false}` request (same one-legal-retry precedent as `shouldRetryDisplayCaptureWithoutPreferCurrentTab`).
- The stream drives a detached `<video>` (muted / playsInline / autoplay, never in the DOM) → `THREE.VideoTexture` → the screen mesh's `map`, through the **same** `deviceSyncScreenTexture` path every other screen texture uses. It is a normal `MeshBasicMaterial` map. **`holeMat` is never used and no CSS3DObject is created in this mode.**
- Fit is **cover** (centre-crop to the screen's aspect), not the full-page scroll-fraction mapping `deviceScreenRepeatFraction` applies to tall screenshots: the stream is viewport-shaped and the user scrolls in their own tab, so there is no scroll-pan to drive. `deviceAnimate` therefore leaves the share texture's `offset` alone (SCROLL POSITION / AUTO SCROLL do not apply to it); SWAY still works, it is a transform.

## 9.2 Mutual exclusion with Go Live

Never both. Enforced in three places, all in ClothStudio:

| Action | Effect |
| --- | --- |
| Start SHARE TAB while Go Live is on | `live:false`, `deviceInteract` off, `teardownLiveScreenNow(world)` runs synchronously |
| `commitLiveUrl` (Go Live / Load URL) while sharing | `stopDeviceScreenShare(world)` runs first |
| Pick a Capture/upload while sharing | the existing `takesOver` branch also stops the share |

Priority inside the factory puts the share source **first** (`share:<W>x<H>` > upload > capture > placeholder), so the on-screen result can never disagree with the exclusion the UI just enforced.

## 9.3 Lifecycle — a leaked track is very visible

`stopDeviceScreenShare(world)` (module scope in `ClothStudio.jsx`, mirroring `stopDisplayCapture`/`teardownLiveScreenNow`) is the ONE teardown: detach `track.onended`, stop every track, pause + detach the `<video>`, dispose the `VideoTexture`, restore the factory's own textured material if the share texture is still on the mesh, null `world.deviceShare`. Idempotent. Called on:

- the STOP SHARING button,
- Go Live / capture / upload taking over,
- **`track.onended`** — Chrome's own "Stop sharing" bar (falls back to whatever screen source was configured before, and says so),
- world cleanup (unmount).

## 9.4 Not persistable, and the UI says so

A `MediaStream` does not survive a reload. Nothing about the share is written to `SETTINGS_KEY` — no new `devicePrimary` field exists — and the control states plainly that it lasts for the session and must be re-shared after a reload.

## 9.5 Failure handling — never silent

| Case | Detection | Behavior |
| --- | --- | --- |
| User cancels the picker | `NotAllowedError` / `AbortError` | Clean no-op; status says nothing changed; no state touched |
| API unavailable | `navigator.mediaDevices.getDisplayMedia` absent | Button disabled with a reason pointing at Capture / Upload image |
| Not a device subject | `clothShape !== 'device'` | Section not offered; reason names Sheet Shape → Device |
| Shared a window / whole screen | `track.getSettings().displaySurface` | **Allowed** (they are still pixels) with a plain warning naming what was shared — unlike the export path's `evaluateDisplaySurface`, which blocks, because there recording the wrong thing is a silently wrong file |
| Stream reports no dimensions | `videoWidth/videoHeight` ≤ 0 | Refuse, stop tracks, say so |
| Track ends unexpectedly | `track.onended` | Teardown, fall back to the previous screen source, tell the user |

## 9.6 Pure, dependency-injected decisions (tested)

Added to `app/dashboard/studio/elements/video-export.js` — the React/DOM glue stays untested, the decisions do not:

- `evaluateScreenShareEligibility({ clothShape, hasDisplayMedia })` — may SHARE TAB be offered/used at all.
- `buildScreenShareRequest()` / `buildBasicScreenShareRequest()` — the exact constraint dictionaries, so `selfBrowserSurface:'exclude'` is asserted by a test rather than trusted.
- `shouldRetryScreenShareWithBasicOptions(err)` — the one legal retry (constraint-class rejections only; never a user cancel).
- `describeScreenShareError(err)` — cancel-vs-failure classification with precise copy.
- `describeSharedSurfaceForScreen({ displaySurface })` — allow-with-warning surface classification.
- `computeScreenCoverFit({ screenAspect, sourceWidth, sourceHeight })` — the cover-fit crop mapping from stream dimensions to the screen's aspect, returning `{ repeat:{x,y}, offset:{x,y} }` for `texture.repeat`/`texture.offset`.

`deviceScreenAspect(viewport)` is exported from `elements/factories.js` (the screen's shape has always lived there) and injected into `computeScreenCoverFit` — the same DI shape the rest of this module uses.

## 9.7 What must not change

- Go Live, Capture, Upload, the pinned still, and `planDeviceScreenSteps` behave exactly as before.
- `evaluateLiveExportGuard`'s provenance logic is untouched — a test asserts it agrees with `planDeviceScreenSteps`.
- Phase 8's `recordLiveScreen` tab-capture EXPORT mode stays. It remains the answer for Go Live; SHARE TAB simply makes it unnecessary for *this* workflow.
- The server-side Final Render path is untouched. `ctx.deviceShare` is only ever populated by the browser, so `art-scene.mjs`'s device ctx (`deviceScreenAssetsById: {}`) resolves exactly as it does today.

## 9.8 Why the FX chain genuinely reaches it (verified, not asserted)

`runFxFinishChain()` is `composer.render()` → `diffusionPass.render(renderer, diffuseTarget, composer.readBuffer)` → (text overlay) → `treatmentPass.render(renderer, null, diffuseTarget)`. `composer`'s first pass is `new RenderPass(scene, camera)` — the WHOLE scene, which contains the device root and therefore the screen mesh. So a screen carrying a normal texture is rasterized into `composer.readBuffer` like any other geometry, and `diffusionPass` samples that buffer as `tDiffuse`. Its CoC term also reads `fxDepth`, which the screen mesh writes (the material is opaque, `depthWrite` on) — so the screen is depth-sorted for the Diffusion Camera rather than treated as background. `treatmentPass.uniforms.uCleanAlphaHole` is set from `world.deviceLive ? 1 : 0`, and this mode never creates a `deviceLive`, so no hole is punched. **The live site is post-processed exactly like the rest of the scene.**

## 9.9 Not verifiable by an agent

`getDisplayMedia` requires a real user gesture and a picker; automation runs the tab hidden. Everything below needs the user, at `http://localhost:3000/dashboard/studio?tool=cloth`:

1. Sheet Shape → **Device**. Open the device panel.
2. In WEBSITE SCREEN → **SHARE TAB**, click **Share a tab**.
3. Chrome shows its share picker with the **Chrome Tab / Window / Entire Screen** tabs. The Studio's own tab is **absent** from the tab list (`selfBrowserSurface:'exclude'`). Pick the tab the site is open in → **Share**. Chrome then shows its persistent "…is sharing a tab" bar with a **Stop sharing** button.
4. The site should appear on the device screen, live, and **scrolling in that other tab should be visible on the screen in the preview**.
5. Turn the **Diffusion Camera** on and pull focus — the screen should blur/sharpen with the rest of the scene. Same for bloom / treatment / grain.
6. **Export video** — the normal canvas export, with `recordLiveScreen` OFF — should contain the live site.
7. Press Chrome's own **Stop sharing** → the screen falls back to whatever it showed before and the panel says so. Chrome's sharing bar must disappear (no leaked track).
8. Reload → the share is gone, as documented.

**Known unknown — backgrounded-tab frame rate.** Capture of a shared tab continues while that tab is not focused, but Chrome throttles work in background tabs and the delivered rate may drop below the requested 30fps. This has not been measured here; do not promise smoothness. If the shared tab's animation looks slow, keep it visible (a second window/monitor) rather than fully occluded.
