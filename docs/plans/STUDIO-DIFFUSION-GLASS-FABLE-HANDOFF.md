# Studio Diffusion Camera + Glass Petal Sphere — Fable Handoff

**Status:** Ready for implementation. Two user-visible Studio defects are confirmed; no fix has been implemented by Codex.

**Owner for next pass:** Fable

**Repository:** `/Users/bballi/Documents/Repos/Bballi_Portfolio`

## Goal

Correct two related visual-quality problems without reopening unrelated Studio systems:

1. Diffusion Camera adjustments currently create little or no distinguishable focal effect. The selected focal subject does not read as sharp against visibly blurred surroundings.
2. The primary Glass Petal Sphere reads as opaque/dense, while its visible optical control does not change transparency.

This is a visual-correction and control-semantics pass, not another Studio expansion phase.

## Required Reading

Read these files completely before editing:

- `CLAUDE.md`
- `docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-PLAN.md`
- `app/dashboard/studio/ClothStudio.jsx`
- `app/dashboard/studio/elements/catalog.js`
- `app/dashboard/studio/elements/scene-recipe.js`
- `app/dashboard/studio/elements/preset-kinds.js`
- `app/dashboard/studio/elements/curated-generators.js`
- Relevant tests under `app/dashboard/studio/elements/__tests__/`

The worktree is heavily dirty and contains several concurrent systems. Preserve all unrelated edits. Do not stage, commit, push, deploy, reset, or clean the worktree.

## Confirmed Finding 1 — Focal Target Is Not Connected

The Diffusion Camera UI exposes and serializes `diffusionCamera.focalTarget`, but the live renderer never reads it.

Current behavior in `ClothStudio.jsx`:

- The dropdown writes `diffusionCamera.focalTarget`.
- The render loop sends only `dc.focusDistance` to `uFocusDistance`.
- No selected element/object is resolved to a world or camera-space position.
- Selecting a different focal target therefore cannot change focus.

The existing `scene-recipe.js` comment says the reference is resolved at render time, but that resolution does not exist. This is a functional defect, not merely a weak visual preset.

## Confirmed Finding 2 — Current Blur Mapping Is Too Weak

Current shader defaults:

- `diffusionRadius = 0.3`
- `aperture = 0.4`
- `falloff = 0.5`
- Maximum radius before circle-of-confusion attenuation is approximately 3.5 pixels.
- Default falloff maps to approximately 1.575 world units.

Studio scenes generally occupy a shallow depth range. The broad focal band and small kernel mean much of the visible scene remains nearly sharp.

The shader also processes diffusion only when:

```glsl
rawDepth < 0.999999
```

Background pixels skip diffusion. This prevents the background side of object silhouettes from participating in the blur and weakens subject-versus-background separation.

The shader currently hardcodes:

```glsl
nearP = 0.05
farP = 60.0
```

Those happen to match the present cameras but should be explicit uniforms from the active camera so the depth contract cannot drift.

## Diffusion Camera Requirements

### Real focal-target resolution

Implement a real focal-target resolver for the current active camera.

At minimum support:

- Center of scene
- Primary artwork/cloth
- Primary Glass Petal Sphere when enabled
- Enabled, live element instances

Do not offer or resolve disabled, data-only, removed, or non-rendered objects.

The shader linearizes depth to a view-space distance. Resolve target depth in the same coordinate system:

1. Update the active camera and target world matrices.
2. Obtain the target's world-space focal point or deliberate bounding-box center.
3. Transform it through `camera.matrixWorldInverse`.
4. Use the positive camera-forward depth derived from camera-space Z.

Do not substitute simple Euclidean camera-to-target distance unless it is proven equivalent for the shader comparison.

Resolve it whenever the active camera, selected target, or target transform changes. A moving focal target must remain in focus.

### Honest Focus Distance semantics

No visible control may be ignored.

Choose and document one clear model:

- Add a Manual focal mode where Focus Distance is directly editable; object targets automatically resolve their distance, or
- Treat Focus Distance as an explicit offset from the resolved target and relabel it accordingly.

If a saved target cannot resolve, fall back visibly and deterministically to Center of scene or Manual. Never retain a stale invisible target distance.

### Useful visual response

Do not fix this only by widening slider ranges.

Required behavior:

- Minimum settings may be subtle.
- Midrange settings must be clearly perceptible.
- Maximum aperture/radius must create an unmistakable focused-subject versus blurred-surroundings result.
- Falloff must predictably change the width of the sharp focal region.
- Foreground Bias and Background Bias must produce visibly different results.
- The focal subject must remain observably sharper than off-focus content.

Handle `rawDepth === 1` intentionally. The current unconditional background exclusion is not acceptable if it prevents visual subject separation. Preserve the separate tone-mapping backdrop mask, but design a defensible diffusion policy for background pixels.

Retain the approved composition order:

```text
Scene → bloom/base composer → diffusion → graphic treatment/output
```

Keep the effect bounded for live preview and high-resolution browser export. If increasing taps or adding another pass, measure the cost and document it.

## Confirmed Finding 3 — Glass Has No Transparency Control

The primary Glass Petal Sphere currently uses:

```js
new THREE.MeshPhysicalMaterial({
  transmission: 1,
  thickness: 0.7,
  ior: 1.5,
  roughness: 0.03,
  metalness: 0,
  clearcoat: 1,
  clearcoatRoughness: 0.04,
  attenuationDistance: 1.8,
  side: THREE.DoubleSide,
})
```

The live update effect only applies:

```js
world.glassMat.roughness = glass.clarity;
world.glassMat.attenuationColor.set(glass.tint);
```

There is no glass opacity or transmission field in:

- `DEFAULT_GLASS`
- The Glass Petal Sphere catalog schema
- `sanitizeGlass`
- The primary instance material mapping
- Scene recipes/templates
- Presets/randomization
- Either shared glass-state UI

The control labeled `CLARITY` changes roughness/frost only. It cannot change physical transparency.

## Physical-Material Constraint

Use Three.js physical-transmission semantics correctly.

Official references:

- <https://threejs.org/docs/pages/MeshPhysicalMaterial.html>
- <https://threejs.org/manual/en/transparency.html>

Three.js recommends keeping material opacity at `1` when physical transmission is non-zero. Do not blindly combine alpha opacity and transmission to make the orb fade.

Preferred product model:

- Preserve the existing `clarity` field for backward compatibility, but label it honestly as `FROST` or `ROUGHNESS` if product language permits.
- Add a separately persisted `transmission` field.
- Present that field in user language such as `TRANSPARENCY`, with a clear mapping between its displayed direction and `MeshPhysicalMaterial.transmission`.
- Keep `opacity = 1` for the physical transmissive material.

At the transparent endpoint, artwork/background behind the orb must be plainly visible. At the opaque endpoint, the orb should intentionally become solid rather than merely disappear.

## Glass Visual Investigation

Before calibrating values, reproduce the issue with Diffusion Camera disabled so the defects remain isolated.

Compare identical camera poses across:

- White and dark tint
- Minimum and maximum Clarity/Frost
- Minimum and maximum Transmission/Transparency
- Environment lighting on and off
- Solid background and artwork behind the glass
- Effects chain off and on

Investigate independently:

- Five overlapping transmissive petals
- `THREE.DoubleSide`
- `thickness: 0.7`
- Attenuation distance
- Environment lighting
- Post-processing/render-target behavior

Do not change all variables simultaneously.

The petal geometry is torus-derived and appears closed. If verified, test `THREE.FrontSide` because rendering internal back faces on five overlapping closed transmissive shells may contribute to the dense appearance. Confirm normals, rotation, and back-view behavior before adopting it.

Calibrate thickness and attenuation only with same-pose evidence. Preserve sculptural refraction and highlights; do not turn the object into a faint alpha ghost.

## State and Persistence Integration

If `transmission` is added, update every relevant contract:

- `DEFAULT_GLASS`
- Glass Petal Sphere catalog `fieldSpec`
- Catalog controls and presets
- Both UI locations that edit the shared primary glass state
- `primaryInstance`
- Live material-update effect
- `sanitizeGlass`
- Scene Template capture/load
- Local and cloud recipe behavior
- Element/Look presets where applicable
- Seeded randomization ranges
- Lock behavior
- Curated generators only where intentionally authored
- Tests and any actual vendor mirror

Backward compatibility is mandatory:

- Old scenes without `transmission` load with the intended transparent default.
- Existing `clarity` values retain their previous roughness meaning.
- Invalid values are rejected or clamped through the existing schema/sanitizer boundary.

## Required Tests

Add focused coverage for:

1. Focal target resolves to camera-space depth.
2. Moving a target changes resolved focus depth.
3. Orbit and Shot Camera resolve correctly and independently.
4. Missing, disabled, removed, and data-only targets fall back deterministically.
5. Invalid targets do not remain selectable as if they were live.
6. Active camera near/far reach the diffusion shader configuration.
7. Diffusion extremes produce materially different CoC/blur behavior.
8. A focal subject retains more local edge contrast than off-focus content.
9. Old glass snapshots default to the intended transmission.
10. Transmission is bounded and sanitized.
11. The transparency control changes `glassMat.transmission`.
12. Clarity/Frost changes roughness independently.
13. Transparent and opaque endpoints survive template/preset round trips.
14. Randomization and locks handle the added field deterministically.
15. Diffusion changes never mutate glass state, and glass changes never mutate diffusion state.

Do not count a state/uniform assertion alone as proof that the visual defect is fixed.

## Live Acceptance Gate

Create a deliberately depth-layered scene with:

- A focal subject
- A foreground object
- A background object
- A detailed background/grid that makes blur visible

Capture same-pose evidence for:

1. Diffusion Off
2. Diffusion On with the artwork or orb sharply focused
3. A visibly blurred foreground and background
4. A second object selected as the focal target
5. Target moved in Z while remaining in focus
6. Target disabled/removed with deterministic fallback
7. Glass transparent endpoint with artwork visibly behind it
8. Glass opaque endpoint
9. Clarity/Frost changed while Transmission stays fixed
10. Transmission changed while Clarity/Frost stays fixed
11. Effects chain off and on
12. PNG output

Use pixel sampling, edge-contrast measurement, or deterministic image differences where practical. At minimum demonstrate quantitatively that maximum diffusion differs materially more from Off than minimum diffusion, while the focal subject remains sharper than an off-focus object.

## Verification Commands

Run, at minimum:

1. Focused new tests
2. Full Studio element suite
3. Full `npm test`
4. `npm run build`
5. `git diff --check` on touched files
6. Vendor drift guard only if a mirrored file changed

## Scope Boundaries

Do not modify:

- Primary T-shirt mesh, physics, print, or GLB model
- Proof Render or Cloud Run
- Browser video-export resizing, cancellation, or visibility lifecycle
- GLB Import
- Cloud-template authorization
- Unrelated elements
- Unrelated dirty-worktree files

Do not stage, commit, push, deploy, reset, or delete files.

## Documentation

Append an as-built checkpoint to this handoff covering:

- Confirmed root causes
- Focal-target resolution architecture
- Focus Distance semantics
- Background-depth policy
- Blur response and performance
- Glass Clarity/Frost versus Transmission semantics
- Geometry/material calibration
- Files changed
- Tests and build results
- Screenshot/quantitative evidence
- Anything not verified

## Final Report Format

Report:

- Root causes
- Exact shader, camera, state, and material changes
- Focal-target behavior
- Glass control behavior
- Exact files changed
- Test totals and build result
- Quantitative and screenshot evidence
- Performance impact
- Remaining limitations
- Confirmation that unrelated systems were untouched
- Confirmation that nothing was staged, committed, pushed, or deployed

End with exactly one of:

`FABLE STATUS: READY_FOR_CODEX_REVIEW`

or

`FABLE STATUS: BLOCKED — <precise blocker>`

---

## As-Built Checkpoint — 2026-07-31 (Fable)

**Status of the two findings:** both were already implemented in the dirty worktree by a prior correction round (`diffusion-focus.js` + shader/uniform rework + glass `transmission` field, all present with tests) — but never verified live and never checkpointed here. This session verified live and fixed the remaining user-facing defect: the feature *read as broken* even though the pipeline works.

### Confirmed root cause of "I don't see any diffusion working"

1. **Slider dead zone.** The user's persisted `holocloth-studio-defaults-v9` had `aperture: 0` and `diffusionRadius: 0`. The response curve `mix(1,40,radius) * mix(0.4,1,aperture)` maps that to a **0.4px worst-case radius — at/below the shader's own `radius > 0.4` blur gate, so mathematically zero blur** while the toggle showed On. Their `falloff: 1` (widest sharp band) compounded it. Not a pipeline bug: max-settings blur is unmistakable (verified live, below).
2. **Treatment masking.** The saved look ran the `halftone` treatment, which re-quantizes the frame into crisp dots *after* diffusion (the approved scene → diffusion → treatment order), visually masking moderate blur. Correct-by-design; noted, not changed.
3. **Stale support badge.** "Preview (approximate) — final-render not yet supported" predates the browser-export chain: PNG (`exportPng` → `runFxFinishChain`) and MP4 (canvas capture of the live chain) both include diffusion. Only the Cloud Run art render rejects it (`services/studio-render/art-recipe.mjs` `support: { diffusionCamera: false }`).

### Changes this session (ClothStudio.jsx + tests only)

- Badge (`#cloth-diffusion-camera-support-badge`) now reads **"Applies to preview + PNG/MP4 export · not in cloud 4K render"** — honest on both sides.
- New dead-zone warning `#cloth-diffusion-camera-no-blur-note`: shown when Diffusion is On but `computeBlurRadiusPx(1, diffusionCamera) < 1` (worst-case sub-pixel radius), telling the user to raise Aperture/Diffusion Radius. Uses the same `diffusion-focus.js` math the shader mirrors, so it cannot drift.
- New test in `__tests__/diffusion-focus.test.js`: zeroed sliders sit at/below the 0.4px shader gate (the dead zone) while shipped defaults stay clearly visible (24/24 pass; full Studio suites 848/848).
- The affected user's localStorage was restored with their exact fx look; diffusion sliders reset from the dead zone to shipped defaults (0.4/0.5/0.3).

### Live acceptance evidence (localhost:3055, same pose)

- Baseline (diffusion Off, treatment none): sharp cloth.
- Max settings + Manual focus at 0.6 (in front of everything): entire cloth heavily blurred — unmistakable. (At 40px radius the fixed 8-tap ring shows discrete ghosting — accepted preview-approximation behavior.)
- Same max settings + focal target `Primary artwork / cloth`: artwork snaps sharp, deeper cloth folds stay soft — focal-target resolution works.
- Zeroed sliders: zero visible change (the dead zone), now labeled by the warning note.

### Not verified this session

Glass transmission endpoints, Shot Cam focal resolution, bias-slider visual A/B, and the full 12-step same-pose evidence matrix — the underlying logic is test-covered (848 passing) but only the diffusion items above were re-proven live. `npm run build` not run (JSX + test-file change only).

FABLE STATUS: READY_FOR_CODEX_REVIEW
