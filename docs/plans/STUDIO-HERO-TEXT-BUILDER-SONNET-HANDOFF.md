# Studio Hero Text Builder — Sonnet Implementation Handoff

**Status:** Planned, not started. Approved direction; implement phase-by-phase, stop after each phase for user approval.

**Owner for implementation:** Sonnet

**Repository:** `/Users/bballi/Documents/Repos/Bballi_Portfolio`

## Objective

Turn the Studio into a website-hero / promo builder: layered headline text ON TOP of the live 3D scene — Google Fonts, size, leading, tracking, alignment, position, X/Y/Z rotation — composed per capture frame, receiving the existing graphic treatment, exporting through the existing PNG/video paths at every frame size and resolution tier. Then per-layer in/out text animation. Then a keyframe timeline that captures full scene state (camera + look + text) at multiple points and plays/exports the whole flow as one promo video.

This is an additive feature. The completed Diffusion Camera + Glass work, the T-shirt systems, Proof Render, and cloud-template auth are all out of scope and must not regress.

## Required Reading

- `CLAUDE.md`
- `app/dashboard/studio/ClothStudio.jsx` (targeted sections below — do not skim-edit this file; it is 6.3k lines and live production code)
- `app/dashboard/studio/elements/scene-recipe.js`
- `app/dashboard/studio/elements/video-export.js`
- `api/_lib/studio-templates.cjs` (`sanitizeSceneRecipeForCloud`)
- `app/dashboard/studio/__tests__/diffusion-focus.test.js` (the established pure-module + node:test pattern to copy)

The worktree is heavily dirty with several concurrent shipped-but-uncommitted systems. Preserve everything. Do not stage, commit, push, deploy, reset, or clean.

## Current Architecture (as-built facts, verified 2026-07-31)

### Capture frames & export sizes

- `FRAME_PRESETS` (`ClothStudio.jsx:659`): `off / square 1080² / portrait 1080×1350 / vertical 1080×1920 / landscape 1920×1080`. Each frame is a **centered crop of the same render** — there is no per-frame camera, focal point, or composition change. `computeFrameRect` (line 667) = largest centered rect of the frame's aspect fitting the canvas with a 0.92 safety margin.
- The HUD (`hudCanvasRef`, drawn per-frame by `drawHud`, line 2912) renders the frame filmstrip: all crops in a row, active one centered, `world.frameSlide` eases transitions. **The HUD canvas is a separate 2D canvas overlay and is NEVER part of any export.**
- PNG export (`exportPng`, line 4661): boosts pixelRatio (≤4), re-renders, then 2D-crops `renderer.domElement` via `computeFrameRect` into an offscreen canvas at 2× frame resolution.
- Video export (`exportVideo`, line 4729 + `elements/video-export.js`): resolution tiers per frame (`RESOLUTION_TIERS`, 1x/2x — 2x = real 4K/Ultra), `computeCropSourceResolution` boosts the renderer so the crop is native (never upscaled), then a crop-copy rAF loop draws the renderer canvas into a capture canvas that feeds `MediaRecorder`.
- `syncFrameUniforms` (line 2361) shapes the vignette to the active crop via `uFrameCenter` — precedent for frame-relative math feeding the shader chain.

### Post chain & render loop

- Approved order: `Scene → bloom/base composer → DIFFUSION pass → TREATMENT pass`. The **diffusion pass owns tone-map + sRGB encode**; the treatment pass runs in **display space** ("ink/paper colours stay as authored").
- The render loop uses the composer **only when `fxActive()`** (line 3060); otherwise plain `renderer.render(scene, cam)`.
- `liveRef.current` mirrors React state into the render loop each frame (line 2064).

### State, persistence, templates

- All Studio state persists as one localStorage blob under `SETTINGS_KEY` (line 2038).
- `captureSceneRecipe` / `applySceneRecipe` (lines 3657 / 3671) define the Scene Template contract; every applied field goes through a sanitizer or validity guard.
- Cloud templates re-sanitize server-side in `api/_lib/studio-templates.cjs` `sanitizeSceneRecipeForCloud` — **a new recipe key is silently dropped on cloud save unless added there too.**
- There is **no keyframe/timeline system today**. `anim` is cloth-turbulence only (`{on, turbulence, speed}`); glass rotation and camera orbit are continuous, not keyframed. Video export records "whatever the live scene does" for `videoSeconds`.

## Locked Design Decisions

1. **Text renders inside the WebGL pipeline, never as DOM.** DOM text would not appear in PNG/video exports. Implementation: a dedicated overlay `THREE.Scene` containing one plane per text layer, each plane textured by a 2D-canvas–drawn `CanvasTexture` (`MeshBasicMaterial`, `transparent: true`, `toneMapped: false`, `depthTest: false`).
2. **Composited after diffusion, before treatment.** Text is never DoF-blurred (it's UI/graphic, not scene geometry), colors stay as-authored (display space), and the treatment pass runs over scene+text together — that is the "play with the treatment and the text on top" requirement. In composer terms: an overlay render step between `diffusionPass` and `treatmentPass` (clear=false, clearDepth=true). On the non-fx path: after `renderer.render`, render the overlay scene with `renderer.autoClear=false`. On the transparent-PNG path: composite text too (text over transparent bg = usable hero asset).
3. **Frame-relative layout.** Position (`anchorX/anchorY` 0–1), size (`sizePct` of frame height), and max width are defined relative to the **active capture-frame rect** (`computeFrameRect`; `off` = 0.92 safe area). A hero composed in `landscape` re-anchors when switching to `vertical`. This is what makes one scene exportable per-platform without re-layout.
4. **X/Y rotation is real 3D.** The overlay scene uses its own fixed `PerspectiveCamera`; rotating a text plane in X/Y produces genuine perspective, Z is flat spin.
5. **Google Fonts via `FontFace`/`document.fonts` — no new npm deps** (repo rule). A curated list (~16 display-worthy families) loaded on demand from `fonts.gstatic.com`; draw only after `document.fonts.load` resolves; system-font fallback with a visible status note if offline. Never block the render loop on font loading.
6. **Export crispness:** text canvases redraw at export scale during `exportPng`'s boost and `exportVideo`'s crop-source resolution (same moment the composer resizes). Never let a 1x preview texture be upscaled into a 2x export.
7. **Pure logic in a new module** `app/dashboard/studio/text-layers.js` (schema, sanitizer, Google-font catalog, layout math, animation timing) + node:test coverage — same tier and pattern as `diffusion-focus.js`. Timeline logic later in `app/dashboard/studio/timeline.js`, same pattern.
8. **Text/timeline are excluded from seeded randomization and from the camera undo stacks** (deliberate: authored copy is never randomized; matches existing "template load is not a slider tweak" stance).

## Proposed State Shape (Phase 1 fields; later phases extend)

```js
// DEFAULT_TEXT_LAYER — sanitized by sanitizeTextLayers(raw, fallback)
{
  id: 'txt-1', on: true,
  text: 'HEADLINE',
  fontId: 'space-grotesk',      // key into GOOGLE_FONT_CATALOG
  weight: 700,
  sizePct: 12,                  // % of frame-rect height
  leading: 1.05,                // line-height multiplier
  tracking: 0,                  // letter-spacing, em
  align: 'center',              // left | center | right
  anchorX: 0.5, anchorY: 0.4,   // frame-relative
  maxWidthPct: 85,
  rotX: 0, rotY: 0, rotZ: 0,    // degrees, clamped ±80/±80/±180
  color: '#ffffff', opacity: 1,
  uppercase: false,
}
// Top-level state: textLayers: TextLayer[]  (Phase 1 may ship with max 3 layers)
```

## Phase Order

### Phase 1 — Text layer foundation (single + multi layer, static)

- `text-layers.js`: schema, `sanitizeTextLayers`, `GOOGLE_FONT_CATALOG`, frame-relative layout math (`layoutTextPlane({layer, frameRect, canvasSize})` → plane position/scale), text-canvas draw spec (`buildTextCanvasSpec` — font string, wrapped lines honoring `maxWidthPct`, leading/tracking) — all pure, all tested.
- ClothStudio wiring: `textLayers` state (+ `SETTINGS_KEY` blob), overlay scene + camera in world setup, per-layer plane/texture lifecycle, render-loop compositing on both fx and non-fx paths, redraw-on-change (font load async), export-scale redraw in `exportPng` + `exportVideo`.
- UI: new `components/StudioHeroTextCard.jsx` ("HERO TEXT" card, existing Section/Slider idiom): layer list (add/remove/duplicate, ≤3), textarea, font picker, weight, size/leading/tracking/align, anchor X/Y sliders, rot X/Y/Z sliders, color, opacity, uppercase. Stable DOM ids (`id="studio-hero-text-card"`, per-control ids).
- Persistence: `captureSceneRecipe`/`applySceneRecipe` + `sanitizeSceneRecipeForCloud` (server) carry `textLayers`. Old recipes without the key load as `[]`.
- HUD: draw the active layer's anchor point + frame-relative bounding box when the HERO TEXT card is open (edit affordance only — HUD never exports).
- Tests: sanitizer bounds/fallbacks, layout math per frame preset, wrap/leading determinism, recipe round-trip, old-recipe compat, server sanitizer passes the key.
- Acceptance: same-pose PNG exports at all 5 frame ids + video export at 1x and 2x show identical composition with crisp text; treatment visibly applies to text; transparent PNG keeps text; text never blurs when Diffusion Camera is enabled.

### Phase 2 — Hero polish

- Layout presets (hero-left / centered / lower-third / poster stack) as authored `textLayers` sets; per-frame safe-area guides on the HUD; optional per-layer backdrop bar/pill (drawn into the same text canvas, not a separate mesh); font pairing defaults.
- Nothing new in persistence beyond preset ids. Small phase, mostly authored data + UI.

### Phase 3 — In/out text animation

- Extend layer schema: `anim: { in: 'fade'|'rise'|'blur'|'tracking'|'wipe'|'none', out: same, inDur, outDur, delay, ease }` (sanitized, bounded).
- `text-layers.js` gains pure `computeTextAnimState({anim, tNow, tStart, tEnd})` → `{opacityMul, offsetY, blurPx, trackingMul, clipT}` — tested against exact timings.
- Render loop drives it: live "Preview in/out" button replays; during video export the clock is `tStart = recordStart`, `tEnd = recordStart + videoSeconds`, so in/out bracket the clip automatically.
- Blur for text = redraw-canvas blur or opacity/scale cheat — do NOT add a new shader pass for this; measure cost if canvas `filter:'blur()'` is used per-frame (only during anim windows).
- Acceptance: exported video shows headline animating in at start and out before the end at every frame/tier; static PNG unaffected.

### Phase 4 — Keyframe timeline (promo flows)

- `timeline.js` (pure): `keyframes: [{id, name, hold, transition, recipe, textLayers}]` where `recipe` = `captureSceneRecipe()` snapshot; `resolveTimelineState(keyframes, t)` interpolates a **whitelist of numeric leaf fields** (shotCam az/el/dist/fov, envIntensity, fx sliders, glass numeric fields, diffusionCamera numeric fields, light-can intensities, bgColor via color lerp) and cuts discrete fields (artworkId, sceneId, clothShape, text content, fonts) at segment boundaries; text layers cross via their Phase-3 in/out anims. Cloth physics keeps simulating live — it is never keyframed.
- ClothStudio wiring: "ADD KEYFRAME" captures current state; playback mode feeds `resolveTimelineState` output into `liveRef`-consumed values each frame (bypass React state during playback; write back on stop); scrubber row UI; total duration drives `videoSeconds`; "Export timeline" = start playback + existing `exportVideo`.
- Timeline persists in the `SETTINGS_KEY` blob and as its own named saves; cloud-template support only if trivial, else explicitly deferred.
- Tests: interpolation whitelist exactness (a non-whitelisted field must NEVER lerp), boundary cut determinism, total-duration math, round-trip persistence, playback state restore.
- Acceptance: a two-keyframe promo (different camera + different headline) exports as one video with smooth camera move and text swap; scrubbing matches export.

## Keep vs Change

- **Keep:** composition order, both export paths' mechanics, frame filmstrip, recipe sanitizer discipline, all completed diffusion/glass behavior, cloth sim, no-new-deps rule.
- **Change (additive only):** render loop gains an overlay composite step; export paths gain a text-redraw hook; recipe/template contracts gain `textLayers` (+ `timeline` in Phase 4); one new card component; two new pure modules + tests.

## Risks

- `ClothStudio.jsx` bloat — keep all pure logic in the new modules; the wiring diff should be small and surgical.
- Async font loads racing texture draws — always draw fallback first, redraw on `fonts.load` resolve; never await inside the render loop.
- 2x video export + per-frame text redraw cost — textures redraw only on change/anim-window frames, not every frame; measure and note frame-time impact in the as-built.
- Server sanitizer drop (`sanitizeSceneRecipeForCloud`) — easy to forget; Phase 1 test must cover it.
- Fast-Refresh mid-run trap: do not edit `ClothStudio.jsx` while a Studio export/recording is running in a dev browser.

## Verification (every phase)

1. New focused tests
2. Full Studio element suite (`node --test app/dashboard/studio/...`)
3. Full `npm test`
4. `npm run build`
5. `git diff --check` on touched files
6. Live same-pose export evidence per that phase's acceptance gate

## Scope Boundaries

Do not modify: T-shirt mesh/physics/print/GLB, Proof Render / Cloud Run, GLB Import, cloud-template authorization, diffusion-focus.js / glass-transmission behavior (consume, don't change), unrelated dirty-worktree files. Do not stage, commit, push, deploy, reset, or delete.

## Report Format (per phase)

Files changed · exact behavior changed · what stayed untouched · verification run · manual test next · risks/not verified. Append an as-built checkpoint to THIS doc after each phase.

---

## AS-BUILT CHECKPOINT — Phases 1, 3, 4 (2026-07-31, Fable orchestrating Sonnet agents)

**Status: ALL PHASES (1, 2, 3, 4) SHIPPED and verified locally.**

### Phase 2 addendum (same day, second pass)

- `HERO_LAYOUT_PRESETS` (hero-left / centered / lower-third / poster-stack) in `text-layers.js`; LAYOUTS row (`hero-text-layouts-row`) in the card — applying replaces all layers (presets author their own fonts/anchors).
- Per-layer backdrop: `backdrop` none/bar/pill + `backdropColor`/`backdropOpacity`/`backdropPadPct`; `buildTextCanvasSpec` emits pre-scaled per-line `backdropRects` (pill radius = h/2; align-honoring x); drawn under the text in `drawTextLayerCanvas`; BACKDROP row (`hero-text-backdrop-row`) in the card; server sanitizer extended.
- HUD safe-area guides (title-safe 90% rect + thirds) while the Hero Text card is open — HUD only, never exported.
- Fix A: `exportTimeline` stashes pre-export `videoSeconds`; `exportVideo` `cleanup()` restores it (root-cause fix for the blank duration select). Narrow known gap: the two pre-cleanup pre-flight guards can strand the stash (same pre-existing class as stranded `timelinePlayback`).
- Fix B: `fxActive` now honors `world.timelineOverride` (`?? liveRef` pattern), so fx ramping from 0 during a transition activates the composer path.
- **Align-aware anchoring fix (found in live verification):** `layoutTextPlane` previously centered the plane on `anchorX` regardless of align — left-aligned presets hung off-frame. Now align 'left' → anchorX is the block's left edge, 'right' → right edge, 'center' unchanged. Regression-tested; presets render correctly (verified live).
- Live-verified: LAYOUTS row applies presets inside the frame, backdrop pill renders behind the headline with treatment intact, safe-area guides draw on the HUD, zero console errors.
- Final totals: **full `npm test` 1951/1951 pass; `npm run build` green.**

### Timeline v2 addendum (2026-07-31, third pass) — normalized-time track ported from the Mockup Video studio

Replaces v1's hold/transition shot list with the Mockup studio's (`app/dashboard/studio/page.jsx`) track model, per user request ("keyframes across time, all params remembered and animated").

- **Model (`timeline.js` v2):** `{ keyframes: [{id, name, t∈[0,1], recipe, orbitPose{px,py,pz,tx,ty,tz}|null}], totalSeconds [1,120] (default 8), loop }`. `resolveTrackState(timeline, u)` = page.jsx `applyPath` port (clamp ends, straddling pair, per-segment smoothstep `t*t*(3-2*t)`); marker spacing IS the speed. `resolveTimelineState` deleted. **v1 blobs auto-migrate** in `sanitizeTimeline`: keyframe t = cumulative-hold-start/oldDuration, each hold becomes a duplicate keyframe at hold-end (the Mockup hold idiom), totalSeconds = ceil(old) — verified live (the saved 2-shot v1 state loaded as 4 keys · 6s at exact t positions).
- **"All params animate" whitelist expansion:** + `mat.*` 15 numerics, `mat.baseColor` hex-lerp, `anim.turbulence/speed`, `glass.position/rotationOffset` vec3s, `lightCans.N.az` (shortest-angle)/`el`. `blendTextLayers`: layers matched by id with equal text/fontId/weight/uppercase/align lerp transforms (size/leading/tracking/opacity/anchors/rots/backdropOpacity/Pad/maxWidth) + color hex-lerps; changed text = discrete cut. `phys.*`/`anim.on` hard-gated (documented). **Orbit camera** pose is captured per keyframe (`captureOrbitPose`) and lerped via `blendOrbitPose` when the landed recipe has `shotCam.use:false` — free-orbit camera work is now keyframable (it was never in the recipe).
- **Wiring:** `applyMatToWorld` extracted from the mat effect (shared by effect + per-frame override); `world.timelineClock {mode idle|playing|looping}` driven by the render loop (no gsap); scrub = one-shot `world.scrubRequest` consumed by the loop; playhead React sync at 10Hz (never per-frame setState); discrete cut fires once per crossed `fromIndex` with text-anim retrigger (v1 rule kept); loop order fix: timeline override runs BEFORE `applyTextAnimFrame`, which now reads `entry.baseOpacity` so timeline opacity and in/out fades compose instead of fighting. Known trade-off: glass auto-spin holds (doesn't accumulate) while a glass-transform override is active.
- **Track UI (`StudioTimelineCard` rewrite):** ported gestures — drag marker retimes (bypasses sanitize mid-gesture deliberately: re-sort/re-id would break id-based dragging), double-tap empty adds a key at that u from the current scene, double-tap/long-press marker deletes, tap selects (+ jumps playhead — deliberate deviation from page.jsx), playhead ball is the only scrub handle with 0.022 key-snap; DURATION seconds input; Play (honors loop pref)/Loop/Reset/Export transport; selected-key rename/re-capture/delete row.
- **Live-verified:** migration exactness, track render, drag-retime, double-tap add ("Shot 5"), selection/rename row, full-track playback with camera interpolation + discrete text cut + fade retrigger, playhead advance, zero console errors. Video-file export still needs the one manual foregrounded-tab click (unchanged environment limitation).
- **Totals: full `npm test` 1975/1975 pass; `npm run build` green.** Timeline v1 UI concepts removed: per-keyframe HOLD/TRANSITION sliders, reorder buttons (drag replaces them).
- **Under-canvas strip (fourth pass, user request "built into the canvas … same way the mockup video studio"):** track + transport moved out of the rail into `components/StudioTimelineStrip.jsx` (`#studio-cloth-timeline-strip`), mounted as a sibling AFTER `#cloth-studio-stage-area` (outside the `stageRef` ResizeObserver subtree — no canvas-sizing feedback), structure ported 1:1 from `page.jsx` L2408-2546: 46px circle Play/Loop/Reset with 8px labels, right-pinned ADD KEYFRAME + EXPORT TIMELINE pills, full-width pill track (progress fill, `#ec4899` playhead line+ball, 9px diamond markers, TL_PAD 14) recolored for the dark stage chrome, inline DURATION field; selected-keyframe rename/re-capture/delete as a conditional third row. `StudioTimelineCard` slimmed to a settings card (count/duration readout + persisted loop preference + pointer). Presentation-only — engine/handlers untouched. **Styling correction (user screenshot review):** the strip sits on the LIGHT board chrome (not dark stage pixels) — an initial dark-glass recolor rendered white-on-white/invisible; fixed by porting page.jsx's light-glass styles VERBATIM (same `GLASS` tokens via `rail-ui.jsx`, byte-identical to page.jsx's own), with the Mockup's exact 3-zone row (spacer · centered 46px Play/Loop/Reset circles with labels beneath · right-pinned pills) and the duration field at the track row's right end. No new tokens/styles invented — existing `GLASS`/`ui` helpers only. **Final parity round:** transport corrected to page.jsx's actual Play/Stop/Reset set (Loop transport button removed; Stop/Reset additionally disable while recording — this studio records live, Mockup doesn't), `loopTimeline` handler deleted, spacing wrapper + 14px bottom padding matched. **Rail card removed entirely** (user request): `StudioTimelineCard.jsx` deleted, `timelineOpen` state dropped, the persisted loop preference became a Repeat-icon toggle in the strip next to the duration field (`#cloth-timeline-loop-toggle`, gradient-ring active state) — the under-canvas strip is the timeline's ONLY surface. Live-verified; 1975/1975, build green.
- **Live-screen canvas controls (2026-08-01):** when the device's LIVE site is showing (`clothShape==='device' && devicePrimary.live && liveUrl`), two on-canvas circles appear left of Reset/Poke — `#cloth-studio-live-interact-btn` (Orbit ⇄ Interact, purple active state, drives the same `deviceInteract` the rail toggle does) and `#cloth-studio-live-refresh-btn` (re-sets `world.deviceLive.iframe.src`) — the same pair the Mockup studio pins by its artboard (`#studio-export-orbit`/`#studio-export-refresh`). Live-verified: buttons appear only in live mode, interact flips canvas↔CSS3D pointer events, zero console errors. Live-verified: strip renders under canvas, Play→Stop toggle, editing disabled while playing, full-track playback with recipe cuts + material lerp visible in the rail panel, controls restore on completion, zero console errors. Tests 1975/1975, build green.

### What exists now

- `app/dashboard/studio/text-layers.js` — pure module: `MAX_TEXT_LAYERS` (3), 16-font `GOOGLE_FONT_CATALOG`, `DEFAULT_TEXT_LAYER`, `sanitizeTextLayer(s)`, `fontById`, `googleFontCssUrl`, `resolveFrameRect` (mirrors `computeFrameRect` exactly), `TEXT_CANVAS_SCALE = 2` (canvases draw at 2× frame-native so 2x exports need NO redraw), `buildTextCanvasSpec` (DI'd `measure`, pre-scaled draw positions, 1× `fontString` for measuring), `layoutTextPlane` (CSS-px center-origin +y-up; overlay camera = 1 world unit : 1 CSS px at z=0). Phase 3 added `anim` schema (`in/out/inDur/outDur/delay/ease`), `TEXT_ANIM_INS/OUTS/EASES`, and pure `computeTextAnimState` (3-phase timing; `tEnd` non-finite = no out window; out anchored to `tEnd - outDur`).
- `app/dashboard/studio/timeline.js` — pure module: keyframes (≤12) of `{id, name, hold, transition, recipe}` where `recipe` is an opaque `captureSceneRecipe()` snapshot; `sanitizeTimeline`, `timelineDuration`, `resolveTimelineState` (power2-in-out eased blend, loop support), `TIMELINE_LERP_WHITELIST` (24 dot-paths: shotCam az[shortest-angle]/el/dist/fov, envIntensity, glass numerics incl. transmission, diffusionCamera numerics, fx numerics, lightCans[].intensity, bgColor hex-lerp), `blendRecipes` (discrete fields CUT at transition start — new text rides the whole camera move; whitelisted numerics lerp).
- `app/dashboard/studio/components/StudioHeroTextCard.jsx` — HERO TEXT rail card (`id="studio-hero-text-card"`): layer pills + eye toggles, Add/Duplicate/Remove, textarea, font/weight selects (grouped, loading/offline note), SIZE/LEADING/TRACKING/OPACITY sliders, align L/C/R, ANCHOR X/Y, MAX WIDTH, ROT X/Y/Z, color + AA uppercase, ANIMATION section (`hero-text-animation-section`) with IN/OUT/IN DUR/OUT DUR/DELAY/EASE + Preview in/out.
- `app/dashboard/studio/components/StudioTimelineCard.jsx` — TIMELINE rail card (`id="studio-timeline-card"`): keyframe rows (rename, re-capture, reorder, remove), Add Keyframe, per-shot HOLD/TRANSITION sliders, loop toggle, duration readout, Play, Export Timeline.
- `ClothStudio.jsx` wiring — `textLayers`/`timeline` state in the `SETTINGS_KEY` blob + scene recipes (`textLayers` only; timeline deliberately NOT nested in scene templates); Google-Font `<link>` injection + `document.fonts.load` with fallback-first draw and ready-redraw; dedicated `textOverlayScene` + px-calibrated `PerspectiveCamera`; text composited AFTER diffusion, BEFORE treatment **inside `runFxFinishChain`** (renders into `diffuseTarget` with autoClear off — there is no composer.passes slot; the chain is manual) and via autoClear-off overlay render on the non-fx + both `exportPng` branches; per-frame anim application (cheap opacity/Y channel every frame; tracking/blur/wipe redraw canvas only inside active windows, throttled); `world.textAnimClock` modes idle/preview/export; timeline playback via `world.timelineOverride` effective-view reads (fx/diffusionCamera/glass.rotate at the existing per-frame liveRef read sites) + `applyTimelineContinuousOverride` (imperative re-application of effect-driven values: shotCam, glass material, envIntensity, lightCans, bgColor) + one discrete `applySceneRecipe(blendRecipes(from,to,0))` per segment boundary; per-segment text-anim retrigger (changed text restarts the clock; unchanged text only extends `tEnd`); `exportTimeline` = apply kf[0] → set playback → `exportVideo(overrideSeconds)` (≤ `TIMELINE_EXPORT_MAX_SECONDS` 60, status warning when capped); export `cleanup()` clears playback/override on every exit path.
- `api/_lib/studio-templates.cjs` — `sanitizeSceneRecipeForCloud` passes `textLayers` (incl. `anim`) through structurally; client `sanitizeTextLayers` on load remains the real boundary. Cloud-template `timeline` support deferred.

### Verification (2026-07-31)

- Full `npm test`: **1929/1929 pass** (baseline before work: 1822). New suites: text-layers 45, text-anim 30, timeline 31, + studio-templates round-trip additions.
- `npm run build`: pass (one pre-existing unrelated Turbopack NFT warning).
- Live browser (localhost:3055, Chrome): headline renders over the 3D scene **with the halftone treatment applied to the text**; live text/font/size edits redraw; ROT Y produces real perspective; frame switch (16:9 → 9:16) re-wraps and re-anchors the layer to the new crop; localStorage persistence survives full reload; PNG export verified at 3840×2160 landscape (2× native crop) with the headline baked in, crisp; 2-keyframe timeline captured, played: camera interpolated between poses, headline cut+faded in per shot, playback landed on the final keyframe; zero console errors the whole session.

### Known limitations / not verified

- **Timeline video-file export not machine-verified**: the Claude-in-Chrome automation tab permanently reports `document.visibilityState === 'hidden'`, so the pre-existing (correct) hidden-tab export guard blocks recording. The export path is the SAME proven `exportVideo` flow the Render card already uses; Phase 4 only adds duration override + playback clock. **Manual confirmation = one click on Export Timeline with the tab genuinely foregrounded.**
- Phase 2 (hero layout presets, per-frame safe-area guides, backdrop bars) not built.
- `fxActive()` gate edge case: a transition whose ONLY live change is fx.grain/vignette ramping from 0 with no other fx on in either keyframe won't activate the composer path (documented in code, surgical-diff decision).
- `videoSeconds` UI select shows blank after a timeline export sets a non-preset duration (cosmetic).
- blur/wipe/tracking anim presets not visually exercised in the live pass (fade was, via timeline playback); their math is unit-tested.
