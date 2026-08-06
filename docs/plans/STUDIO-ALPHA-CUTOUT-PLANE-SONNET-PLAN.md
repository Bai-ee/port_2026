# Studio Alpha-Cutout Plane — Sonnet Implementation Plan

**Status:** PLAN — not implemented. Approved implementer: Sonnet. Stop after each phase for review.

**Repository:** `/Users/bballi/Documents/Repos/Bballi_Portfolio`

## Objective

A new Studio catalog element: the user uploads an **SVG or PNG with an alpha channel** and it appears as a **flat plane in the scene**. The transparent (cut-out) regions are real holes — the scene behind shines through them — and an **animated reveal layer** sits directly behind the image so that zooming the camera into a cutout reveals motion behind it (aurora/noise shimmer), like looking through a stencil at a living backdrop.

## Current relevant architecture (read before coding)

- `app/dashboard/studio/elements/catalog.js` — `ELEMENT_CATALOG`: per-element `fieldSpec` (buckets: transform/appearance/material/motion), `bounds.localRadius`, `previewSupported`/`finalRenderSupported`, `performanceCost`, presets. Schema tests iterate the whole catalog automatically (`__tests__/schema.test.js`), so a well-formed entry gets baseline coverage for free.
- `app/dashboard/studio/elements/factories.js` — `FACTORIES` map: `{ create, applyInstance, animate, dispose }` per element type. `clearGroup` is the standard dispose. 28 existing factories to copy conventions from; `portal-plane` (flat disc + ring behind the hero) and `floating-media-frame` are the closest geometry precedents.
- **Upload precedent (CRITICAL — copy this one, not the sheet artwork library):** `app/dashboard/studio/components/LogoArtworkControl.jsx` + `TSHIRT_LOGO_LIB_KEY` in `ClothStudio.jsx`. It stores the ORIGINAL file bytes as a data URL (no canvas re-encode), because the main sheet artwork library (`ARTWORK_LIB_KEY`/`BUILTIN_ARTWORKS`) re-encodes to JPEG and **silently destroys alpha** — the exact channel this feature depends on. It also has the 3MB size cap + low-resolution warning patterns. `GlbAssetControl` (GLB Import) is the precedent for a custom Inspector control that owns an `assetId` field.
- Element lifecycle/persistence: `elements/scene-elements.js` (instance normalize/lifecycle), `elements/scene-recipe.js` (Scene Template capture/load + sanitize), `elements/placement.js` (`ELEMENT_ANCHORS`), `elements/quality.js`, `elements/capability.js`, `elements/preset-kinds.js`, `elements/scope-randomize.js`.
- Diffusion Camera focal targets: `app/dashboard/studio/diffusion-focus.js` `listDiffusionFocalTargets` already lists every enabled element instance — a new element becomes a valid focal target with **zero extra work**. Depth correctness matters (see alphaTest below).
- Render chain: scene → bloom/base composer → diffusion → treatment (`ClothStudio.jsx` `runFxFinishChain`). Cloud 4K art render (`services/studio-render/art-recipe.mjs`) supports only a whitelisted feature set — this element must declare `finalRenderSupported: false` (same as `portal-plane`).

## Proposed direction

New element type `cutout-plane` ("Cutout Plane", category `architectural`).

**Geometry/material:** one `PlaneGeometry` + `MeshStandardMaterial` (or Basic, matching how flat art elements read under the light rig) with the uploaded image as `map` and **`alphaTest` (default ≈0.5) rather than `transparent: true`** for the cutout itself. alphaTest discards cutout fragments outright, so:
- no transparency sorting artifacts against glass/cloth,
- the **depth buffer holds whatever is behind the hole**, which keeps the Diffusion Camera CoC math and the treatment pass's depth-based tone-map skip honest through the cutouts.
Expose `EDGE SOFTNESS` later only if needed (switching to blended `transparent` mode is a known trade — do not build it in Phase 1).

**SVG support:** accept `image/svg+xml` in the upload control; rasterize at load time (SVG data URL → `Image` → offscreen canvas at ~2048px longest edge → `CanvasTexture`). PNG/WebP go straight to texture from the stored data URL. Store the ORIGINAL bytes either way (re-rasterize on load, never persist the rasterization).

**Reveal layer:** a second, slightly larger plane a small offset BEHIND the cutout plane (element-local, inside the same group, so it moves/rotates with the image). Animated `ShaderMaterial` driven from `animate()` (time uniform), with fields: `revealStyle` (`aurora` | `noise` | `scan` | `off`), two colors, `revealSpeed`, `revealIntensity`. This is what "shines through" the holes when the camera pushes in. Keep the shader cheap (one fragment shader, no extra passes) — the whole element should stay in the same `performanceCost` band as `portal-plane` (4).

**Camera dive:** no new camera system. Zooming into a cutout = existing orbit/Shot Cam controls, and the instance is automatically offered as a Diffusion focal target (free, see above). A scripted "dive-through" animation is explicitly out of scope for this plan; propose separately if wanted.

**Persistence:** instance fields flow through the existing `extraInstances` → scene-recipe sanitize path. The image itself is stored browser-locally in a new library key (copy `TSHIRT_LOGO_LIB_KEY` mechanics, e.g. `holocloth-cutout-lib-v1`), referenced from the instance by `assetId`. Cloud Scene Templates carry only the `assetId` + fields, not the bytes — same limitation GLB Import already has; the element renders with a neutral placeholder (flat panel, reveal layer still animating) when the asset is missing, plus a small "upload missing" note in the Inspector.

## Keep vs change

- Keep: every existing element, the render chain, Diffusion Camera, upload components' UX patterns, cloud-template authorization.
- Add: one catalog entry, one factory, one Inspector upload control (clone of LogoArtworkControl adapted for SVG accept + library key), one library key, sanitize/recipe coverage, tests.
- Do NOT touch: primary T-shirt/cloth systems, Proof Render/Cloud Run, glass, GLB import internals, `ARTWORK_LIB_KEY` (the JPEG re-encoder — wrong tool here).

## Files likely involved

- `app/dashboard/studio/elements/catalog.js` (new `cutout-plane` entry)
- `app/dashboard/studio/elements/factories.js` (`cutoutCreate/ApplyInstance/Animate`, dispose via `clearGroup` + texture dispose)
- `app/dashboard/studio/components/CutoutArtworkControl.jsx` (new, cloned from `LogoArtworkControl.jsx`)
- `app/dashboard/studio/components/StudioElementInspector.jsx` (register the custom control kind)
- `ClothStudio.jsx` (library key + state plumbing, mirroring `logoLibrary`)
- `elements/scene-recipe.js` / `preset-kinds.js` / `scope-randomize.js` (field sanitize, look-preset + randomize ranges — randomize colors/speed only, never the asset)
- Tests: `elements/__tests__/` (schema auto-covers; add factory + sanitize round-trip + "missing asset falls back to placeholder" cases)

## Risks

- **Alpha destruction** if any code path routes the upload through the JPEG-re-encoding artwork library — the single biggest footgun; the plan pins the LogoArtworkControl path for this reason.
- localStorage quota: another data-URL library on the same origin (caps + upfront size warning already patterned in LogoArtworkControl).
- SVG rasterization fidelity (fonts/external refs inside SVGs won't resolve) — document as a known limit; recommend outlined/flattened SVGs.
- alphaTest gives hard 1-bit edges at extreme zoom — acceptable for stencil look; soft-edge mode is a deliberate later decision.
- Cloud templates referencing a browser-local `assetId` another browser doesn't have → placeholder behavior must be deterministic and honest (tested).

## Recommended phase order

1. **Phase 1 — element core:** catalog entry + factory (plane + alphaTest cutout + reveal layer with `aurora` style only) using a built-in placeholder texture; schema/factory tests. No upload yet.
2. **Phase 2 — upload:** CutoutArtworkControl (PNG/WebP/SVG accept, SVG rasterize, library key, size/resolution warnings), Inspector wiring, missing-asset placeholder + tests.
3. **Phase 3 — polish:** remaining reveal styles (`noise`, `scan`), presets, randomize ranges, Scene Template round-trip tests, live acceptance screenshots (camera pushed into a cutout with the reveal layer animating behind it).

**Approval recommendation:** approve Phase 1 only; review live before Phase 2.
