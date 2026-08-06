# Studio T-Shirt — Active Handoff (Primary Cloth + 3D Merch Model)

**Status:** `PART A + PART B COMPLETE — primary cloth geometry corrected, 3D merch model shipped, P1 async-state defect corrected (round 2)`
**Last updated:** 2026-07-31
**Canonical real-GLB asset:** `public/models/merch/tshirt.glb`
**Runtime URL:** `/models/merch/tshirt.glb`

This document is the active continuity record for Cloth Studio's T-shirt work.

## Product Decision (pivoted — supersedes this doc's own earlier direction)

An earlier round of this doc directed replacing the primary cloth shape with
the real GLB. **That direction is superseded.** The GLB is a volumetric 3D
product scan; it does not naturally preserve the tactile feel of flat
simulated cloth, and using it as the primary surface was the wrong approach.

There are now **two distinct objects.** Do not merge them or give them
ambiguous names internally.

### 1. Primary T-Shirt Cloth

A procedural, genuinely boundary-conforming 2.5D T-shirt-shaped cloth that
replaces the rectangular flyer and inherits its cloth physics and
interaction. Selected from `Images panel → Sheet Shape → T-Shirt` — this
replaces the flyer; the Material panel has no second shape selector.

- Does **not** use `tshirt.glb`.
- Built by `elements/tshirt-mesh.js`, driven by `elements/factories.js`'s
  `hanging-tshirt` factory (`singleInstanceRenderer: true` — never
  independently addable via the normal Elements "Add" picker; it exists
  only as this one dedicated primary-shape object).
- Wired into `ClothStudio.jsx` via a **dedicated lifecycle effect**
  (`world.tshirtPrimaryEntry = { object, factory, instance }`), not the
  generic `extraInstances`/`elementLiveObjects` array — mirrors that array's
  own `create`/`applyInstance`/`animate`/`dispose` calls one level up, since
  `hanging-tshirt`'s `singleInstanceRenderer` flag makes it invisible to the
  generic sync effect by design.
- The primary instance is built each render via `elements/primary-cloth.js`
  `buildPrimaryTshirtInstanceRaw({ mat, phys, anim, tshirtPrint, hasArtwork })`
  → `normalizeElementInstance(raw, 'hanging-tshirt')` — maps the SAME shared
  material/physics/animation/artwork state the flyer sheet uses.
- Pointer grab/fling: `ClothStudio.jsx`'s `onPointerDown`/`Move`/`Up`
  raycast the garment's own front/back meshes (`root.userData.motion`) when
  `world.cloth` is null (sheet disposed) and `world.tshirtPrimaryEntry`
  exists — same tweezer-pinch-radius mechanism the flyer's own `world.grab`
  uses, stored in a parallel `world.tshirtGrab`, synced onto
  `object.userData.grab` and consumed by `elements/tshirt-mesh.js`
  `stepSim`'s `grab` param every frame.

### 2. 3D T-Shirt Model (Part B — shipped)

`public/models/merch/tshirt.glb` as an **optional, separate** interactive
merchandise catalog element — internal type `tshirt-model`, distinct from
the primary cloth's `hanging-tshirt`. Standard element behaviors (add/
select/move/rotate/scale/depth/duplicate/remove/lock/undo-redo/save-
restore/disposal) all work through the normal Elements picker — it is
**not** `singleInstanceRenderer`, unlike the primary cloth.

- `elements/factories.js`: `tshirtModelCreate`/`tshirtModelLoadAsset`/
  `tshirtModelApplyInstance`/`tshirtModelAnimate`/`tshirtModelDispose`,
  closely modeled on the existing `glb-import` factory (same async-load/
  `loadToken` race-guard/`clearGroup`/`applyMaterialOverride` idioms), but
  simplified: `TSHIRT_MODEL_URL` is a fixed canonical path (no asset-
  library lookup), and there is no animation-clip selection (the source
  file embeds none). `stillUnresolved` retries on every `applyInstance`
  call while nothing has loaded yet — deliberately does NOT special-case a
  prior `loadError`, so a transient failure keeps retrying rather than
  getting stuck (glb-import's own `stillUnresolved` doesn't special-case it
  either).
- `elements/catalog.js`: `'tshirt-model'` entry, category `apparel`,
  `bounds.localRadius: 0.46` (same measured margin as `glb-import`'s own —
  reused, not re-derived, since both go through the identical
  `normalizeGLBTransform` call), `performanceCost: 6`. Optional turntable
  spin (`motion.rotate`, default **off**) — not fake wind animation, not
  cloth deformation.
- `elements/placement.js`: `ELEMENT_ANCHORS['tshirt-model']` — corner-
  anchored/foreground like `glb-import`, opposite corner so the two don't
  default to overlapping if a scene has both.
- Never appears automatically when the primary T-shirt cloth is selected
  (confirmed live — selecting Sheet Shape → T-Shirt renders only the
  procedural garment; the 3D model only appears once explicitly added via
  Elements → Add Element).
- No front-print compositing (the primary cloth remains the printable
  surface) — this asset's UVs aren't even cleanly separable for it (see
  Asset Facts below).
- The temporary Phase 1 inspection harness (`app/preview/glb-inspect/`) has
  been deleted — its findings are fully captured above and were already
  durable before deletion.

## Asset Facts (real GLB — recovered from the production loader + the file's own embedded metadata)

- 4 meshes (`Object_2`..`Object_5`, largest `Object_5` ≈ 65,532 verts — the
  front/body), ~201,595 vertices / ~373K triangles total.
- No skin/bones/animations in the source file; NORMAL+UV present, no
  TANGENT; one shared `pbrMetallicRoughness` material across all 4 meshes
  (no texture — flat color).
- UVs are a multi-tile atlas; front/back are **not** cleanly separable by
  UV alone (empirically measured — a front-facing, chest-height sample
  spans nearly the full U range). Any future front-print work on this asset
  would need a world-space/projected approach, not naive UV placement.
- Credible collar/sleeve/shoulder/side/hem anatomy, front-facing by default.

## Attribution (already captured — durable, do not re-derive)

[`docs/attribution/TSHIRT-GLB-ATTRIBUTION.md`](../attribution/TSHIRT-GLB-ATTRIBUTION.md) —
sourced directly from the GLB's own embedded `asset.extras` metadata (read
from the binary's glTF JSON chunk, not re-typed from a web page): title
"Tshirt", author Tabbuso (https://sketchfab.com/Tabbuso), source
https://sketchfab.com/3d-models/tshirt-5a21282b2e454d1696547148f617d3d0,
CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/). This is complete
and does not need to change for Part B.

## Current Code Map

- Primary Studio lifecycle, pointer input, T-shirt dedicated effect:
  `app/dashboard/studio/ClothStudio.jsx`
- Primary sheet-to-shirt state mapping (shared mat/phys/anim/artwork →
  `hanging-tshirt` instance) and legacy migration:
  `app/dashboard/studio/elements/primary-cloth.js`
- Procedural garment topology (boundary-conforming, "P1" round) + Verlet sim:
  `app/dashboard/studio/elements/tshirt-mesh.js`
- Shirt factory/material/animation contract, hanger geometry:
  `app/dashboard/studio/elements/factories.js` (`tshirt*` functions)
- 3D merch model factory (Part B): `app/dashboard/studio/elements/factories.js`
  (`tshirtModel*` functions, right after `glb-import`'s own functions)
- Element definitions, normalized field ranges, performance/bounds:
  `app/dashboard/studio/elements/catalog.js` (`'hanging-tshirt'` and
  `'tshirt-model'` entries)
- Default placement anchor (Part B): `app/dashboard/studio/elements/placement.js`
  (`ELEMENT_ANCHORS['tshirt-model']`)
- GLB loader, normalization, decoder configuration, disposal (shared infra,
  used by both `glb-import` and `tshirt-model`):
  `app/dashboard/studio/elements/glb-loader.js`
- Canonical real asset: `public/models/merch/tshirt.glb`
- Attribution: `docs/attribution/TSHIRT-GLB-ATTRIBUTION.md`
- Tests: `app/dashboard/studio/elements/__tests__/{primary-cloth,tshirt-mesh,factories,glb-loader,placement}.test.js`
  (`tshirt-model` coverage lives in `factories.test.js`'s dedicated "TSHIRT
  MODEL" block, mirroring `glb-import`'s own "GLB IMPORT" block)

## Round History

### Round A — real-GLB-as-primary-cloth (superseded, reverted)

Built a bone-lattice GPU-cage deformation system loading the real GLB as the
primary cloth shape. Fully reverted this round per the product correction
above — `elements/tshirt-glb-lattice.js`/`elements/tshirt-glb-build.js` (the
lattice/skinning modules from that attempt) are no longer wired into
`ClothStudio.jsx`'s primary path. Not yet deleted from the repo (harmless,
unused) — a future cleanup pass may remove them once Part B's own GLB
element work (which needs simpler, non-deforming GLB handling closer to
`glb-import`'s own pattern) confirms none of that code is worth reusing.

### Round B — procedural pivot + first anatomy pass (superseded by Round C)

Reverted Round A's wiring back to a procedural `hanging-tshirt` factory
path, and replaced the original crude rectangle+trapezoid silhouette with a
smoothly-blended union of regions (torso half-width blended via smoothstep,
sleeve tested in its own angled local frame, an underarm "fillet" ellipse
unioned in to soften the concave junction). **This was still fundamentally
a uniform-grid-cell-clipping approach** — every candidate grid point was
tested against an inside/outside silhouette function, so the perimeter was
only ever as smooth as the grid was fine. Live-verified this was
insufficient: even after a ~2.3x resolution bump plus a boundary-smoothing
(Laplacian) pass, the neckline still rendered as a visible triangle and the
shoulder/sleeve boundary as a staircase — and a resolution high enough to
fix that by brute force alone would have cost ~7x more, consuming most of
the entire scene's performance budget for one element.

### Round C — genuinely boundary-conforming topology ("P1 visual correction," current)

Full rewrite of `elements/tshirt-mesh.js`'s geometry generation. Per an
explicit user correction: **do not merely increase grid resolution while
retaining cell-based silhouette clipping** — build a boundary-conforming
outline instead.

**Architecture:** the torso and each sleeve are now separate structured
grid **patches**, each a plain row-major `cols`×`rows` grid — but every
row's (torso) or cross-section's (sleeve) edge position is computed
**directly from a smooth closed-form curve** (`torsoHalfWidth(y)`,
`neckHalfExtent(y)`, `sleeveHalfWidth(along)` — all continuous functions),
never discovered by testing candidate grid cells. This makes the perimeter
smooth **by construction** at any resolution, not just "smoother at higher
resolution" — the actual fix for the underlying problem, not a mitigation.

- **Neckline**: for rows within the neck's own Y range, columns that would
  fall inside the neck cutout are clamped to the ellipse's own analytic
  edge (`neckHalfExtent`) instead of being culled — the boundary IS the
  curve. A non-uniform row-spacing warp (`torsoRowY`, `NECK_ROW_FRACTION =
  0.4`) additionally concentrates ~40% of the torso's row budget into the
  neckline's own narrow Y band — needed because even an exact analytic
  ellipse reads as a V (not round) when only ~5 rows cross its depth at
  uniform spacing; this reallocates existing rows there at zero extra cost.
- **Shoulder/sleeve/underarm**: `torsoHalfWidth(y)` blends hem→chest→shoulder
  via smoothstep (natural taper + shoulder slope); each sleeve is generated
  in its own rotated local frame (`sleeveFrame`, angled `sleeveAngleDeg`
  down-and-out) with an exact analytic taper
  (`sleeveHalfWidth`). The sleeve is **not** vertex-shared with the torso
  (different parametrizations) — instead, `buildAttachmentPairs` ties each
  sleeve root vertex to its nearest torso boundary vertex with a short
  structural-style constraint, geometrically close by construction (bounded
  by the sleeve's own root half-width) and physically held together during
  simulation.
- **Hem**: a shallow per-column cosine bow at the bottom row only.
- **Collar band**: unchanged concept from Round B — a thin ring just outside
  the neckline ellipse gets a small +Z geometric bump (`insideCollarBand`,
  `collarBumpZ`), reading as a restrained raised trim without separate 3D
  ribbing geometry.
- **Triangulation**: same quad→2-triangle pattern as before, generalized to
  any patch, with a degenerate-triangle filter (`triAreaPattern` vs a
  near-zero epsilon) for the rare case where multiple torso columns collapse
  onto the same clamped neckline point.
- **Hanger fix**: the hanger bar previously rendered ABOVE the shoulder line
  at the same Z as the garment fabric, with no cloth geometry above it to
  occlude it — it visibly cut across the front. Moved to sit exactly at
  shoulder height and well BEHIND the back panel in Z, so the garment's own
  fabric occludes it everywhere the shirt actually covers; it now only
  shows through the neck opening and past the sleeve tips.

**Round C addendum — 3 P1 defects found by precise code review, fixed same
round** (measured via exact index/coordinate diagnostics, not visual
inspection): (1) the left sleeve's mirrored local frame has opposite
triangle-winding handedness from the torso/right sleeve — its front/back
`flipWinding` booleans needed to be swapped, or its front triangles could
show the back panel through `FrontSide` materials; (2) `buildAttachmentPairs`
always indexed the torso's RIGHT edge column regardless of which sleeve
called it, so the LEFT sleeve's attachment constraints pulled toward the
opposite side of the body — fixed by passing an explicit `edgeCol` instead
of a mirroring workaround; (3) the neckline's triangulation had no concept
of "which side of the opening" a vertex was on, so real triangles/
constraints spanned straight across it — fixed with an exact closed-form
segment-vs-ellipse intersection test (`segmentCrossesNeckHole`, exported),
correct at any resolution, after two resolution-dependent sampling attempts
each caught their own gap by a subsequent, finer check. 3 new regression
tests target these directly (per-patch winding, per-side attachment,
exact-function neckline-crossing) and hold across 6 resolutions (16×20 to
60×76). 783/783, clean build, live-verified — the neckline fix is directly
visible on screen (a genuine open hole, not filled fabric).

**Resolution/cost**: the new multi-patch architecture costs measurably more
per `cols`×`rows` unit than the old single-grid version (separate sleeve
patches add real vertices/constraints beyond what masking-in a shared grid
did). Measured via `computeMeasuredCost` and reconciled against
`QUALITY_TIERS.maxCost` (draft 40 .. ultra 120, see `elements/quality.js`):
settled on an ULTRA-tier torso grid of 26×33 (`elements/factories.js`
`tshirtRebuild`), landing at `performanceCost: 31` (`elements/catalog.js`)
— roughly 2.8x the pre-rewrite baseline, comfortably inside every tier's
budget with headroom for other elements. `bounds.localRadius` was
re-measured under the same worst-case 30s simulated stress test the
original measurement used and bumped from 1.05 to 1.15 (real observed
ceiling ≈1.074) to reflect the new topology's slightly larger reach.

**Tests**: `elements/__tests__/tshirt-mesh.test.js` fully rewritten (36
tests, including the 3 P1-defect regression tests from the Round C
addendum above — per-patch winding, per-side sleeve attachment, and
exact-function neckline-crossing) — anatomy claims (sleeve angle/taper,
torso taper, round/centered neckline, collar band), boundary continuity (no
large row-to-row jumps on the side seam, neckline edge, or sleeve edge —
the actual regression target for this round), no degenerate triangles, UV
bounds, matching front/back seam pairs, sleeve↔torso attachment constraints
exist, quality-tier vertex budgets, and the full simulation-stability +
pointer-grab suite carried over unchanged (topology-agnostic). Full Studio
element suite: **783/783**. Clean build.

**Live-verified** (screenshots, real browser, `elementsV1Enabled` scene
cleared of unrelated glass/elements clutter for a clean view): rest pose
front view shows a genuinely round, centered crew-neck (not a V or
triangle); visible shoulder slope; sleeves angled down-and-out with a clear
taper to the cuff; smooth (non-staircased) underarm transition; a visible
torso taper at the side seam; a curved (non-flat) hem; the front print
correctly bounded to the chest with no bleed onto sleeves; the hanger bar no
longer cuts across the front. **Not verified this round** (same
environment limitation as prior Studio rounds — `document.visibilityState`
stays `hidden` in the automated browser tab, which blocks the compositor
from presenting new frames for continuous rAF-driven animation/drag,
independent of app code): wind-deformed pose, dragged-sleeve/dragged-hem
poses, and back-view anatomy (would need camera orbit, itself a
continuous-render operation). Pointer grab/release was live-smoke-tested
error-free via real dispatched `PointerEvent`s (no visual confirmation of
the resulting deformation, same limitation).

### Round D — 3D T-Shirt Model, Part B (current)

Built the separate, optional merch element authorized once Round C's
anatomy was visually approved. `elements/factories.js`: `tshirtModelCreate`/
`tshirtModelLoadAsset`/`tshirtModelApplyInstance`/`tshirtModelAnimate`/
`tshirtModelDispose`, modeled closely on `glb-import`'s existing functions
(same async-load/`loadToken`/`clearGroup`/`applyMaterialOverride`
idioms), simplified for a fixed asset URL and no animation clips.
`elements/catalog.js`: `'tshirt-model'` entry (`apparel` category,
`bounds.localRadius: 0.46`, `performanceCost: 6`, turntable spin off by
default). `elements/placement.js`: `ELEMENT_ANCHORS['tshirt-model']`
(corner-anchored/foreground, opposite corner from `glb-import`). Registered
in the `FACTORIES` map. Deleted the now-fully-recorded Phase 1 inspection
harness (`app/preview/glb-inspect/`).

**Tests**: a dedicated "TSHIRT MODEL" block added to `factories.test.js`
(create, fixed-URL fetch — not an asset-library lookup, bounding-sphere
normalization, failed-fetch honest error state, stalled-load retry,
material override + restore, turntable spin default-off + only rotates
`root.userData.motion`, dispose-during-in-flight-load discards the late
result, two duplicated instances load/dispose independently, catalog entry
is not `singleInstanceRenderer`) plus one `getElementDefinition` catalog
assertion and one `placement.test.js` default-position assertion picked up
automatically by its existing generic loop. Two of the new tests failed on
first write and were fixed as real bugs, not test bugs: (1) the retry test
caught that `tshirtModelApplyInstance`'s `stillUnresolved` check
special-cased `loadError`, which meant a genuinely failed load never
retried on a later `applyInstance` call — fixed by dropping that
condition, matching `glb-import`'s own `stillUnresolved` precedent; (2) the
duplicate-independence test wrongly assumed `dispose()` empties
`root.userData.motion.children` — `clearGroup`'s real, documented contract
only disposes GPU resources and clears the ROOT's own children (detaching
`motion`), it does not recursively empty `motion`'s own children array —
fixed by asserting geometry disposal directly (`spyDispose`) instead. Full
Studio element suite: **793/793** (was 783 before this round: +8 factories
tests, +2 already-generic placement/catalog assertions counted in their
existing loops). Full `npm test`: **1767/1767** (includes the vendor-sync
drift guard — re-ran `node services/studio-render/scripts/vendor-elements.mjs`
after the `catalog.js`/`placement.js` edits, since that Cloud Run vendor
copy must stay byte-identical to the real source). `npm run build`: clean,
exit 0 (`/preview/glb-inspect` correctly absent from the route list post-
deletion).

**Live-verified** (fresh browser tab, `localhost:3055/dashboard/studio?tool=cloth`):
selecting Sheet Shape → T-Shirt renders only the procedural primary
garment — the 3D model does **not** appear automatically. Adding
"3D T-Shirt Model" via Elements → Add Element renders the real GLB
(credible collar/sleeve/shoulder/body anatomy, confirmed via zoomed
screenshot) at its corner-anchored default position, coexisting with the
primary garment with no visual or state conflict. Inspector shows the full
Transform block plus "Turntable Spin" (off by default) and material-
override controls. Duplicate created a second, independent instance
(performance budget 6→12/40, confirming per-instance cost accounting);
removing the duplicate left the original instance and its performance cost
untouched; removing the original left the primary garment fully intact and
the scene back to empty. Console clean throughout (no errors). Turntable
spin was toggled on but the automated tab's `document.visibilityState`
stays `hidden` (the same limitation logged in Round C above), so continuous
rAF-driven rotation could not be visually confirmed — the `animate()`
logic itself is directly unit-tested (asserts `root.userData.motion.rotation.y`
advances and `root.rotation` is never touched) independent of rAF.

### Round E — P1 async-state defect correction (Codex review, round 2)

Round D shipped a real fix for the original "`motion.children.length === 0`
means retry" bug, but a second, more precise review found it still had two
gaps, both stemming from the same root cause: the state machine didn't
distinguish "a retry is already in flight" from "idle," and nothing bridged
`root.userData` state into React — the Inspector's promised error UI never
actually rendered.

**Previous conflation.** Round D's `tshirtModelApplyInstance` already used
an explicit `idle | loading | loaded | error` state on `root.userData.loadState`
instead of the original child-count inference, and `tshirtModelRetry` was
the only way out of `'error'`. The gap: `tshirtModelRetry` unconditionally
reset straight to `'idle'` regardless of the CURRENT state, so two Retry
clicks in quick succession (or one click landing before the Inspector had
re-rendered to hide the button) could each independently reset to idle and
each launch their own fetch — parallel requests, the exact failure mode the
whole fix exists to prevent, just reachable from Retry instead of a
transform drag. Separately, the Inspector's status bridge was a 400ms
`setInterval` poll reading `root.userData` directly — it worked, but wasn't
the "intentional, explicit" bridge the review asked for, added avoidable
latency, and had no defense against a retry burst landing inside one poll
window.

**Chosen lifecycle states.** `elements/factories.js` now tracks
`root.userData.loadState` as exactly one of `TSHIRT_MODEL_STATES`: `idle`,
`loading`, `loaded`, `error`, `disposed`.
- A fetch starts ONLY on the `idle → loading` transition, inside
  `tshirtModelApplyInstance`.
- `tshirtModelApplyInstance` does nothing further while `loading` (transform
  still applies every call — it's a plain property of `root`, independent of
  load state) and does nothing to retry an `error` — a genuine failure must
  survive unrelated instance edits (a transform drag calls `applyInstance`
  repeatedly) without silently retrying dozens of times.
- `tshirtModelRetry(ctx, root, instance)` is the only way out of `'error'`,
  and is now itself guarded: a no-op if `loadState` is already `'loading'`
  or `'disposed'`. This is what actually closes the round-2 gap — repeated
  Retry clicks (or the reconciliation loop's own automatic retry landing at
  the same moment) can never stack a second fetch.
- `tshirtModelDispose` sets `loadState = 'disposed'` (in addition to bumping
  `loadToken`, which already guarded the geometry attachment). A disposed
  root now refuses ANY further `applyInstance` call outright — including
  transform — rather than relying solely on the token check.
- `root.userData.latestInstance` is kept current on every `applyInstance`
  call regardless of state, so whenever a load actually lands (fresh or via
  retry), the material override applied is whatever the user's LATEST edit
  was — not a stale snapshot from whenever loading first started.

**React/Three.js status bridge.** Replaced the polling effect with a
push-based callback: `ctx.onTshirtModelStatus(instanceId, {state, error})`,
supplied by `ClothStudio.jsx` as `reportTshirtModelStatus` (a
`useCallback` with an empty dependency array — stable identity, so
threading it through a freshly-built `ctx` on every reconciliation-effect
run never causes extra churn). `elements/factories.js` calls it at every
real transition — `tshirtModelReportStatus(ctx, root, token, state, error)`
re-checks `root.userData.loadToken === token` before calling, so a late
callback from a superseded or disposed load can never fire; the same guard
that already protected geometry attachment now protects the status report
too. `ClothStudio.jsx` owns the actual state:
`tshirtModelStatus: {[instanceId]: {state, error}}`, read by the Inspector
as `loadStatus={tshirtModelStatus[selectedInstance.id]}`.
`clearTshirtModelStatus(id)` is called directly at both places a
`tshirt-model` entry is disposed in the reconciliation effect (the
`elementsV1Enabled`-off cleanup loop and the disabled/removed cleanup
loop) — both already have `id` in scope, so this needed no change to the
generic `dispose(root)` factory contract shared by every other type.

**Retry behavior, as seen by the user.** While loading: a restrained
"Loading 3D T-shirt…" status line, no Retry control exists at all (so
there is structurally nothing to click). On failure: a red banner with the
actual error message, plus a **Retry** button. Clicking Retry starts
exactly one new request; clicking it again (or anywhere) while that retry
is in flight is a no-op at the factory level regardless of how many times
the button is clicked or how stale the UI's own re-render is. On success:
the banner clears and the normal Transform/Material/Turntable controls
resume.

**Extracted pure helper.** `StudioElementInspector.jsx` has no existing
test infrastructure (no JSX/DOM render environment is configured in this
repo — `npm test`'s glob only picks up `.test.{js,mjs}`), so the actual
view DECISION (what's visible, what the message says, whether Retry
appears) was extracted into a new pure module,
`elements/tshirt-model-status.js` (`tshirtModelLoadStatusView`), tested
directly with `node:test` — same split this codebase already uses for
`elements/capability.js`. `LoadStatusBanner` in the Inspector is now a thin
wrapper that only renders whatever that function returns.

**Tests.** `factories.test.js`'s TSHIRT MODEL block grew from 15 to 21
tests, covering (among the pre-existing single-flight/latest-settings
cases from Round D): the exact `loading → loaded`/`loading → error` status
sequence via a callback log (`tshirtModelCtxWithLog`), retry performs
exactly one additional fetch, repeated Retry clicks while one is pending
perform exactly one fetch total, dispose-during-load transitions to
`'disposed'` and frees the late GLB's own geometry (spied), a disposed
root refuses a later `applyInstance` outright (including transform), a
late FAILURE (not just a late success) after disposal never populates
`loadError` or reports status, and two duplicated instances retry fully
independently with status callbacks that never cross ids. New file
`__tests__/tshirt-model-status.test.js` (7 tests) covers the extracted
Inspector-view helper directly: every state's visibility/message, and that
`showRetry` is never true while `loading`. Full Studio element suite:
**808/808**. Full `npm test`: **1782/1782**. `npm run build`: clean, exit
0. `git diff --check` on every touched file: clean (no whitespace errors).
Vendor sync: not needed — none of the touched files
(`factories.js`, `ClothStudio.jsx`, `StudioElementInspector.jsx`,
`tshirt-model-status.js`) are in `VENDORED_FILES`
(`services/studio-render/scripts/vendor-elements.mjs`); the drift-guard
test in `services/studio-render/__tests__/art-recipe.test.mjs` (part of the
1782 above) confirms this.

**Live-verified** (fresh browser tab, a `window.fetch` shim scoped to only
`/models/merch/tshirt.glb` requests, logging call timestamps and
optionally injecting an artificial delay/failure — every OTHER request
passed through untouched): adding the element fetches the asset exactly
once end-to-end. Simulating a failure rendered the Inspector's real error
banner ("Model failed to load: simulated network failure") with a visible
Retry button. Clicking Retry five times in rapid, synchronous succession
(a tight loop of real `.click()` calls on the actual button before React
had a chance to re-render and remove it) produced exactly one additional
fetch — confirmed via the shim's own call log both immediately after the
click burst and again after the load resolved — and the model recovered
(error banner cleared, normal controls resumed). Adding a third instance
and removing it in the same synchronous script, before its artificially
delayed fetch could resolve, left the scene back at its prior 2-instance
state once the fetch actually resolved seconds later — no reappearance, no
console errors. Two duplicated instances were shown behaving fully
independently: one simulated-failed while the other stayed loaded and
visible throughout, and retrying the failed one never affected the other.
The Primary T-Shirt Cloth (Part A) rendered correctly and unchanged in
every screenshot across this whole session — round neck, shoulders,
sleeves, hem all intact. **Limitation, reported honestly:** the automated
tab's `document.visibilityState` stayed `hidden` throughout (confirmed via
`document.hidden`), which is known to block continuous `requestAnimationFrame`-driven
rendering — so turntable-spin animation and any live visual confirmation
of a slider being physically dragged mid-load were not attempted live;
those two behaviors (spin math, and transform/material survival +
latest-value-wins through a mid-load edit) are instead covered by
deterministic, non-flaky unit tests in `factories.test.js`, which is the
more reliable way to test exact concurrency timing regardless of browser
automation limitations. Everything React-state-driven (the error/retry UI
itself) does NOT depend on `requestAnimationFrame` and WAS directly
observed working via real screenshots.

## Guardrails

- Preserve unrelated dirty-worktree changes.
- Do not stage, commit, push, or deploy unless explicitly requested.
- Do not change Proof Render, cloud infrastructure, or unrelated Studio
  systems.
- Do not add a remote runtime dependency on Sketchfab.
- Do not use the real GLB for the primary cloth shape — that direction is
  permanently superseded per the product correction above.
- Do not keep both a legacy procedural shirt AND the new one visible
  together, and do not silently fall back to an older shape on failure.
- Do not declare completion from geometry metadata alone — verify anatomy
  with real screenshots.

## Resume Protocol

1. Read `CLAUDE.md`.
2. Read this document completely.
3. Run `git status --short`.
4. Confirm the canonical GLB exists at `public/models/merch/tshirt.glb`.
5. Determine which round (A/B/C/D above, or a later one) the worktree
   currently reflects, and continue from there — do not restart the
   procedural-topology work from Round B's now-superseded approach, and do
   not redo Part B (Round D) — both Part A and Part B are complete as of
   this document's current status line.

Every implementation round must report: round/checkpoint completed, exact
files changed, measured behavior, tests and exact totals, build result,
live-verification evidence, known limitations, and whether attribution is
complete. End with exactly one:

`SONNET STATUS: READY_FOR_CODEX_REVIEW`

or

`SONNET STATUS: BLOCKED — <precise blocker>`
