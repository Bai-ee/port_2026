# HOLO PAPER Studio — FX Completion Plan (implementer handoff)

**Status: PHASE 1 SHIPPED + EXTENDED — live on hitloop.agency 2026-07-22** (`c75a0321`, `60c1f86d`, `661183d9`).
Read § "As built" before touching this file again. §7 Phase 2 remains decision-gated.
**Date:** 2026-07-22
**Owner file:** `app/dashboard/studio/ClothStudio.jsx` (self-contained, no sibling modules).

---

## As built (what actually shipped, vs this plan)

Everything in §3–§4 landed, plus a follow-on round the user asked for after seeing it.

**Delivered beyond the plan**
- **12 graphic treatments** in the finish pass (halftone · pixel · posterize · 1-bit threshold · duotone · chromatic split · CRT scanlines · riso misregister · edge lines · solarize · cross-process · kaleidoscope), selected by `#define` + `material.needsUpdate` (recompile on change, no per-pixel branch chain), all running **display-space** through one shared `tap()` helper so multi-tap looks keep the tone map, sRGB encode, backdrop rule and vignette consistent.
- **20 full-look presets** (`FX_PRESETS`, groups PRINT/PHOTO/DIGITAL/EXPERIMENTAL) + Randomize. Per the user's explicit call, a look also sets **material, environment HDRI, backdrop and light rig** through the existing setters; any hand-tweak drops to `Custom…`.
- **Capture-frame carousel:** the HUD lays every crop out as a filmstrip (active centred + dimmed-around, neighbours ghosted), `#cloth-frame-carousel-{prev,next}-btn` on the canvas edges ease the strip across (350ms, HUD-only — the render path is untouched).
- **Vignette is frame-shaped** (`uFrameCenter`/`uFrameHalf`): the falloff ellipse takes the active crop's aspect so exports carry a true vignette. Full canvas reproduces the old numbers exactly.

**Corrections to this plan's analysis**
- §3.3 was real, and worse than described: rendering into a target skips **both** the ACES tone map and the sRGB encode (three.cjs:20571/30071 — gated on `_currentRenderTarget === null`), so the finish pass owns both via the stock chunks and must stay **enabled** whenever the chain runs.
- **New trap the plan missed:** tone-mapping every pixel greys a white backdrop to ~226, because three never tone maps the clear colour (`getUnlitUniformColorSpace` writes it linear into the target). Fixed with a shared `DepthTexture` across both composer buffers — depth 1.0 = untouched backdrop = encode only, no tone map.
- Composer buffer is **HalfFloat**; EffectComposer's stock 8-bit *linear* target bands in the shadows and clips highlights before ACES sees them.
- §3.1's weld is confirmed numerically (2457 → 2316 verts) but produced **no visible change** at the angles tested — see §8: the user's reported seam is most likely the petal-overlap intersections, still unaddressed.

**Verification actually run:** vertex count · all 13 treatment options compiled with zero shader errors · FX-neutral vs FX-off pixel-identical incl. backdrop · 4 HDRIs 200 (dev + prod) · persistence across reload with `SETTINGS_KEY` unchanged · frame carousel + frame-shaped vignette · **PNG export carries FX** (halftone still: 29% dark / 43% light bimodal vs flat FX-off baseline, 3840×2160 crop) · **transparent PNG keeps real alpha and skips FX** (alphaMin 0) · MP4 export produces a valid `video/mp4` (content unjudgeable — a background tab throttles rAF, so automated recordings capture almost no frames) · `npm run build` clean.

---

## 0. Why this plan exists

A prior agent (Fable) landed ~140 uncommitted lines into `ClothStudio.jsx` adding three things:
HDRI environment lighting, a post-FX chain (bloom / grain / vignette), and a glass-seam fix.

**All three are incomplete or broken.** The engine-side code exists; the UI that would reach it
was never written, and the seam fix was measured and does nothing. Today the app renders
exactly as it did before the diff.

Your job in Phase 1 is to finish that work correctly — not to redesign it. Fable picked the
right features and the right integration points. The wiring and the correctness are missing.

### Current uncommitted state

```
 M app/dashboard/studio/ClothStudio.jsx     (+140 lines — the work described here)
?? public/hdr/                              (4 CC0 HDRIs, 6.4MB total, UNTRACKED)
```

The same dirty tree also holds **unrelated** digest/media/site-recreate changes. See §6 —
your commit must not sweep those in.

---

## 1. Environment facts (verified 2026-07-22, do not re-derive)

| Fact | Value |
|---|---|
| `three` | `0.165.0` |
| `three-stdlib` | `2.36.1` |
| `OutputPass` in three-stdlib | **DOES NOT EXIST** (`typeof === 'undefined'`) — this matters, see §3.3 |
| Confirmed-available stdlib exports | `RGBELoader`, `mergeVertices`, `EffectComposer`, `RenderPass`, `ShaderPass`, `UnrealBloomPass`, `RoomEnvironment`, `OrbitControls` |
| Other passes available for later | `BokehPass`, `SMAAPass`, `FilmPass`, `AfterimagePass`, `HalftonePass`, `DotScreenPass`, `GlitchPass`, `SSAOPass`, `SAOPass`, `LUTPass`, `RenderPixelatedPass` |
| Renderer config (`ClothStudio.jsx` ~L678) | `WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })`, `toneMapping = ACESFilmicToneMapping`, `toneMappingExposure = 1.0` |
| Settings key | `SETTINGS_KEY = 'holocloth-studio-defaults-v9'` (~L112) |
| HDRIs on disk | `public/hdr/{venice_sunset_1k,qwantani_dusk_2_1k,dancing_hall_1k,moonless_golf_1k}.hdr` |

> **Line numbers in this doc will drift as you edit.** Treat them as hints. Anchor on the
> quoted identifiers/comments with `grep -n`, never on a bare line number.

---

## 2. DO NOT TOUCH

Hard boundaries. Violating any of these is a failed handoff.

1. **Do not touch the mockup-video / studio-render pipeline.** `api/_lib/studio-recipe-variations.cjs`,
   `api/_lib/studio-render-core.cjs`, `services/studio-render/*`, `renderAndStoreStudioVideo`.
   `ClothStudio.jsx` is deliberately self-contained so those fragile paths stay untouched (see
   the file's own header comment, L8-10). Keep it that way.
2. **Do not touch the cloth solver.** `world.buildCloth`, the verlet step, `applyRumple`,
   pin modes, the grab/fling pointer handlers. Physics defaults are baked from the user's
   approved live settings and are not in scope.
3. **Do not touch the other dirty files** in the working tree (daily-digest, media route,
   pre-digest-video, AdminEmailModals, digest docs, vercel.json, `app/recreate/`,
   `components/recreate/`, `api/_lib/media-clip-selector.cjs`). Unrelated workstreams.
4. **Do not bump `SETTINGS_KEY`.** `envId` and `fx` are additive keys read with fallbacks
   (`ENV_PRESETS[saved.envId] ? ... : 'room'`, `{ ...DEFAULT_FX, ...(saved.fx || {}) }`).
   A bump would wipe every user's baked-in physics/material/lighting defaults for no reason.
5. **Do not change baked defaults** for material, physics, rumple, or the light rig.
6. **Do not add dependencies.** Everything needed is already in `three` / `three-stdlib` / `lucide-react`.
7. **Do not redesign the petal/blade silhouette.** The crescent-blade sphere was approved in
   commit `911ae1ea`. You are fixing its *shading*, not its shape. `PETALS` array values,
   `R`/`tube`/`arc`/`rot`, and the taper math stay as-is.

---

## 3. Verified defects to fix

### 3.1 The seam fix is a measured no-op — **P0**

**Where:** `makePetalGeo`, anchor on the comment `// Weld the tube's duplicated UV-seam vertices`.

**Current code:**
```js
g = mergeVertices(g, 1e-4);
g.computeVertexNormals();
```

**Why it fails:** three's `mergeVertices` builds its dedup hash from **every** vertex
attribute, including `uv`. `TorusGeometry` seam vertices share a position but carry different
UVs (u=0 vs u=1), so they hash differently and are never welded. Split vertices keep split
normals, which is exactly what renders as a hard line down the blade.

**Measured proof** (run this yourself to confirm before and after your fix):
```
verts before        : 2457
after mergeVertices : 2457   ← current code, 0 vertices welded
after drop-uv+merge : 2316   ← 141 welded (tube seam ring + collapsed tips)
```

**The fix:** weld by position only. Drop `uv` and the stale `normal` attribute *before*
merging, then recompute normals. Safe because `glassMat` is a `MeshPhysicalMaterial` with
**no maps of any kind** (verified: transmission/thickness/ior/roughness/metalness/clearcoat/
attenuation only) — the petal UVs are dead weight and nothing reads them.

Order matters: delete attributes → `mergeVertices` → `computeVertexNormals`. Keep a comment
explaining *why* UVs are dropped, so the next person doesn't "restore" them.

**Acceptance:** vertex count drops from 2457 to ~2316 per petal, and the seam line is gone
from the rendered blade.

### 3.2 HDRI environments and post-FX are unreachable — **P0**

`setEnvId` (~L601) and `setFxKey` (~L603) are declared and **never called from JSX**. Confirmed
by grep: zero references outside their own definitions. Both features are inert.

Everything downstream already works and should be left alone:
- `ENV_PRESETS` map + `world.setEnvironment(id)` + PMREM cache + the `envId` effect (~L1407-1411)
- `DEFAULT_FX`, `GRAIN_VIGNETTE_SHADER`, the composer chain, `fxActive()`, the render-loop
  branch (~L1293-1308), and the PNG-export FX branch
- localStorage save/restore for both keys

You are writing **only the UI**. See §4.2 and §4.3.

### 3.3 The composer path will shift colors — **P0, verify empirically first**

The renderer uses `ACESFilmicToneMapping`. When `EffectComposer` renders the scene into its
internal render target, three sets `outputColorSpace = LinearSRGBColorSpace` for that pass
(confirmed in `node_modules/three/build/three.cjs:20608`). The final `ShaderPass` then blits
those values to the default framebuffer using a plain `ShaderMaterial`, which performs **no
sRGB encode**. Normally `OutputPass` handles this — **and `OutputPass` does not exist in
three-stdlib 2.36.1.**

Expected symptom: the instant any FX is enabled, the image visibly changes brightness /
saturation even at neutral settings.

**Verify before fixing** (cheap and definitive):
1. Force `fxActive()` to return `true` temporarily.
2. Set `bloom: false, grain: 0, vignette: 0` — every pass a pass-through.
3. Screenshot. Flip `fxActive()` back to `false`. Screenshot again.
4. Identical images ⇒ no defect, skip this fix. Different ⇒ fix it.

**If it needs fixing:** do the color-space encode (and, if tone mapping is also being dropped,
the ACES tonemap) inside `GRAIN_VIGNETTE_SHADER`'s fragment shader, and ensure that pass is
**always the last enabled pass whenever the composer is active** — i.e. it can no longer be
disabled just because grain and vignette are both 0. `EffectComposer` sets `renderToScreen`
on the last *enabled* pass, so a disabled final pass silently hands the job to `UnrealBloomPass`.

Do not add a new dependency to get `OutputPass`. Own the math in the shader you already have.

### 3.4 Teardown leaks — **P1**

`world.cleanup` (anchor: `world.cleanup = () => {`) disposes petals, pmrem, renderer, and
controls but never disposes the `EffectComposer` or the cached HDRI textures. Add both.
The composer's render targets are full-resolution; on a page that can remount, this leaks.

Also: the composer is constructed unconditionally at init even when no FX is ever enabled.
Acceptable for now (construction is cheap, the render targets are the cost) — but note it in
a comment rather than silently leaving it.

### 3.5 `public/hdr/` is untracked — **P0**

`git add public/hdr/` in the same commit. Without it, the ENVIRONMENT select ships to prod
and every HDRI 404s. 6.4MB across 4 files is acceptable for `public/` — they load on demand,
not on page load, and only when the user picks a non-`room` environment.

Confirm the files are CC0 (Poly Haven) and add a one-line attribution comment next to
`ENV_PRESETS` if one isn't already there.

---

## 4. Phase 1 — implementation

### 4.1 Patterns you must follow

This file has a strict, established idiom. Match it exactly; do not introduce a new style.

**Panel container** — `RailCard`, signature at ~L59:
```js
function RailCard({ id, icon, title, subtitle, color, open, onToggle, badge, children, maxH = 2400 })
```

**Slider** — signature at ~L94:
```js
function Slider({ label, min, max, step, value, onChange, fmt = (v) => v.toFixed(2), disabled = false })
```

**Toggle row** — copy the exact shape used by `GLASS FORM` / `AUTO ROTATE` (anchor: grep
`AUTO ROTATE`). A `<span style={ui.label}>` with `justifyContent: 'space-between'` and an
inline `ui.btn(active)` button reading `On`/`Off`. Dependent controls below it get
`disabled={!parent.on}` and their label row gets `opacity: parent.on ? 1 : 0.4`.

**Open state** — one `useState(false)` per card, declared with the others at ~L629-637.

**Help text** — every card ends with a plain-language `<span>` at
`fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute`. Write these
for a non-technical user. "Bloom threshold" is jargon; "how bright a highlight must be before
it glows" is not.

**DOM naming (repo rule, mandatory):** every edited/added container gets a stable kebab-case
`id` named by function, never by styling. Follow the existing `cloth-*-panel` convention:
`id="cloth-fx-panel"`, `id="cloth-env-select-grid"`. Banned: `container`, `wrapper`, `box`.

**Icons:** `lucide-react`, imported as a single destructured block at L13-16. Add what you
need there. `Sparkles` or `Aperture` suits an FX card; `Sun` or `Globe` suits environment.

### 4.2 Environment select → the Background card

Mount inside the existing `{/* BACKGROUND */}` `RailCard` (`id="cloth-background-panel"`),
**below** the `SET` grid and **above** the `LIGHT INTENSITY` slider.

- Label it `ENVIRONMENT LIGHT`.
- Render `Object.entries(ENV_PRESETS)` as a 2-column button grid — copy
  `id="cloth-scene-set-grid"` verbatim for markup and styling; give yours
  `id="cloth-env-select-grid"`.
- Active state via `ui.btn(envId === id)`, click calls `setEnvId(id)`.
- Reflect the choice in the card's `subtitle` when it isn't `room`, matching how the card
  already surfaces `SCENE_PRESETS[sceneId]?.label`.
- Loading is async (`RGBELoader`, ~1.5MB per file). Show a lightweight pending state on the
  pressed button — the user must not think the click did nothing. Keep it simple; local
  `useState` for the in-flight id is fine. `world.setEnvironment` currently exposes no
  completion callback, so either thread one through or resolve on a short timer — prefer
  threading a callback, it's honest.
- Help text: explain that this is the light *reflected in* the artwork and glass, and that
  it is separate from the visible Background.

**Scope note:** environment currently affects reflections only, not the visible backdrop.
That is correct for Phase 1. HDRI-as-visible-backdrop is Phase 2 — do not build it.

### 4.3 New FX card

Add a new `RailCard` with `id="cloth-fx-panel"`. Place it **after** the Glass card and
**before** Animate, so the visual-finishing controls sit together.

Suggested `color`: pick an unused accent — existing cards use `#ec4899` (Background),
`#eab308` (Lighting), `#38bdf8` (Glass), `#0ea5e9` (Animate), `#14b8a6` (Physics).
`#a855f7` is free and reads as "effects".

Controls, in order:

| Control | Type | Range / step | State key | Disabled when |
|---|---|---|---|---|
| `BLOOM` | On/Off toggle | — | `fx.bloom` | — |
| `BLOOM STRENGTH` | Slider | 0 – 2, step 0.05 | `fx.bloomStrength` | `!fx.bloom` |
| `BLOOM THRESHOLD` | Slider | 0 – 1, step 0.01 | `fx.bloomThreshold` | `!fx.bloom` |
| `FILM GRAIN` | Slider | 0 – 1, step 0.01 | `fx.grain` | — |
| `VIGNETTE` | Slider | 0 – 1, step 0.01 | `fx.vignette` | — |

- All writes go through `setFxKey(key, value)`.
- `fmt` for the 0-1 perceptual sliders: `(v) => \`${Math.round(v * 100)}%\`` — matches
  `TURBULENCE` / `RUMPLE`. For strength use `(v) => \`${v.toFixed(2)}x\`` — matches `SCALE`.
- `subtitle`: summarize active FX, e.g. `Bloom · grain 20%`, else `Off`. Match how the Glass
  card composes its subtitle.
- Help text: one sentence, plain language, and state explicitly that FX are captured in both
  PNG export and video recording.

### 4.4 Ordering / dependency notes

- Do the §3.1 seam fix **first** and confirm it visually. It is independent of the UI work and
  it is the user's headline complaint.
- Do §3.3 (color-space verification) **before** building the FX card. If the composer shifts
  colors, every FX slider you build will be judged against a broken baseline.
- The UI work (§4.2, §4.3) is mechanical once those two are settled.

---

## 5. Verification — required before you report done

Run all of these. Report actual results, including anything that fails.

1. **Seam, numerically.** Node one-liner replicating `makePetalGeo`'s deform → assert vertex
   count drops 2457 → ~2316.
2. **Seam, visually.** `npm run dev`, open `/dashboard/studio?tool=cloth`, Glass → On,
   rotate the form a full turn. No hard line down any blade. Screenshot before/after.
3. **Composer neutrality.** The §3.3 A/B: FX-on-at-neutral vs FX-off must be pixel-identical.
4. **Each HDRI loads.** Select all four environments. Each must visibly change the reflections
   in the foil, with no console errors and no 404s in the Network tab.
5. **Persistence.** Set a non-default `envId` + FX values, hard-reload. Both restore.
   Then confirm existing material/physics/lighting defaults are untouched (the settings-key
   was not bumped).
6. **PNG export carries FX.** Enable bloom + vignette, export PNG, confirm the file shows them.
7. **Transparent PNG still works.** `Background → None` + "Export PNG (no background)" must
   still produce real alpha. The export code deliberately skips FX when transparent — confirm
   that branch still holds.
8. **Video export carries FX.** Record a short clip with FX on; confirm the MP4 shows them.
9. **No regression with FX off.** With all FX off the render path must still be the direct
   `renderer.render` call, not the composer.
10. **Build.** `npm run build` clean. No unused-variable warnings for `setEnvId` / `setFxKey`
    (their existence was the bug).

---

## 6. Commit discipline

The working tree is dirty with several unrelated workstreams. Stage **only**:

```
app/dashboard/studio/ClothStudio.jsx
public/hdr/
docs/plans/HOLO-PAPER-STUDIO-FX-COMPLETION-PLAN.md   (this file, if not already committed)
```

Suggested split — two commits, because they are two different claims:

```
fix(studio): weld glass petal seam — position-only merge, UVs dropped
feat(studio): HDRI environment light + bloom/grain/vignette FX card
```

Conventional Commits. Subject ≤50 chars. Body only where the "why" isn't obvious — the seam
commit deserves one line noting that `mergeVertices` hashes UVs, since that is the exact trap
the previous attempt fell into.

---

## 7. Phase 2 — DECISION-GATED, DO NOT START

The user's broader ask: *"richer scenes… everything looks very poly and flat… I expected
abstract, intense dramatic effects… blow out graphic design features and effects."*

Phase 1 addresses the mechanical causes of "flat" (flat white `RoomEnvironment` lighting,
no post-processing, a hard shading seam). Whether that is *enough* is a judgement the user
makes after seeing it. Candidates, ranked, for a Phase 2 plan — **not approved, not scoped**:

1. **HDRI as visible backdrop**, not just reflections — the single biggest "real scene" win.
2. **Chromatic aberration + anamorphic streaks** — custom `ShaderPass`; the "intense" look.
3. **Depth of field** via `BokehPass` (already available) — the strongest cheap depth cue.
4. **Dispersion on the glass** — per-channel IOR offset; expensive but it is *the* hero effect.
5. **Geometry variety** beyond 5 torus petals — shape presets, not one baked silhouette.
6. **HDRI-lit scene sets** replacing the current 2D canvas backdrops.
7. **`LUTPass` color grading** with a few shipped looks — cheap, high perceived polish.

Bring Phase 1 back for review first. Do not begin any of the above without explicit approval.

---

## 8. Open question for the user (blocking nothing in Phase 1)

The original screenshot showing the seam was purged from macOS temp before it could be read.
The §3.1 defect was found and confirmed independently by measurement, so Phase 1 is not
blocked. But if the user's "noticeable seam" turns out to be the *intersection lines where the
5 petals overlap* rather than the per-blade shading seam, that is a different fix (petal
placement / count, not vertex welding). Ask for the screenshot again; if the seam persists
after §3.1, this is the likely cause.
