# Studio Roadmap Next Phase — Sonnet Handoff

Status: **new approval scope for the larger Studio roadmap**

This is the next approved Studio planning prompt after the closed randomization-lock checkpoint. It moves forward on the remaining Studio roadmap:

- remaining randomization scopes
- randomization guardrails
- curated set generators
- Element / Look / Render preset kinds
- cloud template persistence
- Proof rendering
- Ultra / 4K rendering
- new **Diffusion Camera** look/render feature

This work is still about the original `/dashboard/studio` Studio video-making experience. It is not Opportunity Signals, Social Auto-Publish, Video Remix, onboarding, or a new `/studio-v2`.

## Current baseline

The previous Studio checkpoint is closed and approved:

- Randomize All live-verified.
- Look randomize Refine / Remix / Transform / Wild live-verified.
- Changed-group reporting live-verified.
- Scene Template save/load for `randomizeIntensity` and `lookSeed` live-verified.
- Per-parameter-group lock UI implemented and live-verified.
- `npm test`, `npm run build`, and `node scripts/smoke-studio.mjs` passed.

Do not reopen that checkpoint unless a regression is found during the new work.

## Required reading

Read these before editing:

1. `CLAUDE.md`
2. `docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-PLAN.md`
3. `docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-SONNET-HANDOFF.md`
4. `docs/plans/STUDIO-VIDEO-UPGRADES-SONNET-HANDOFF.md`
5. `docs/dashboard-ui/VIDEO_STUDIO_UX_KIT.md`
6. `docs/features/studio/README.md`
7. `docs/features/studio/VIDEO_PROMO_VARIATION_ENGINE.md`
8. `docs/features/studio/STUDIO_RENDER_HOSTING.md`
9. `app/dashboard/studio/page.jsx`
10. `app/dashboard/studio/ClothStudio.jsx`
11. `app/dashboard/studio/components/StudioElementsCard.jsx`
12. `app/dashboard/studio/components/StudioElementInspector.jsx`
13. `app/dashboard/studio/components/SceneTemplatesCard.jsx`
14. `app/dashboard/studio/elements/intensity.js`
15. `app/dashboard/studio/elements/scene-elements.js`
16. `app/dashboard/studio/elements/randomize.js`
17. `app/dashboard/studio/elements/history.js`
18. `app/dashboard/studio/elements/scene-recipe.js`
19. `app/dashboard/studio/elements/templates.js`
20. `services/studio-render/recipe.mjs`
21. `services/studio-render/scene.mjs`
22. `services/studio-render/render.mjs`
23. `services/studio-render/server.mjs`
24. Relevant tests under `app/dashboard/studio/elements/__tests__/`

Before editing, inspect `git status --short`. Preserve all user-owned or unrelated changes.

## Important sequencing

The full list is too large for one undifferentiated coding round. Implement in gated slices. Stop after each slice for Codex review unless the user explicitly approves continuing.

### Slice 1 — Randomization Scopes + Guardrails + Diffusion Camera Schema

Goal: finish the controllable creative-randomization layer before touching cloud rendering.

Implement:

- A unified randomization scope control for:
  - Entire set
  - Lighting only
  - Camera only
  - Motion only
  - Colors only
  - Elements only
  - Selected element
  - Look only
  - Unlocked values only
- History support for every new scope. Do not add a randomization action unless it is undoable and redoable.
- Guardrails for generated scenes:
  - element-count min/max
  - weighted categories
  - no duplicate hero elements
  - safe-area checks
  - near-plane checks
  - contrast/readability checks where practical
  - transmission/shadow/render-budget caps
- Diffusion Camera schema and preview controls, without final-render claims yet.

Diffusion Camera means:

- a high-resolution cinematic camera look where the focus target remains crisp while areas outside the focal region soften;
- user controls for enabled/off, focal target, focus distance or focus point, aperture/strength, falloff, diffusion radius, highlight bloom, and optional foreground/background bias;
- deterministic seeded randomization under Camera only / Look only / Entire set where appropriate;
- explicit labels when the preview effect is approximate or final-render unsupported.

Technical expectation:

- Treat Diffusion Camera as a camera/look/post-processing feature, not as an element mesh.
- Prefer existing Three.js/postprocessing patterns already in Studio.
- If the browser preview cannot support a faithful high-quality effect yet, implement a bounded preview approximation and label it honestly.
- Do not call it 4K/final-supported until the fixed-frame renderer supports it and verification proves it.

Slice 1 exit gate:

- New scopes work and are undoable.
- New scopes respect whole-element locks and per-group locks.
- Guardrails prevent or clearly label invalid results.
- Diffusion Camera settings save/load in scene recipes/templates.
- Diffusion Camera appears in the UI as preview-supported or preview-approximate, not final-supported.
- `npm test`, `npm run build`, and `node scripts/smoke-studio.mjs` pass.
- Live browser checks prove at least: Camera-only randomize, Motion-only randomize, Colors-only randomize, Entire-set randomize, Unlocked-only behavior, guardrail warning path, and Diffusion Camera toggle/control persistence.
- Stop for Codex review.

### Slice 2 — Curated Set Generators + Preset Kinds

Goal: create useful creative starting points without starting cloud rendering.

Implement:

- 12 curated set generators from the original plan.
- Separate template/preset kinds:
  - Scene Template
  - Element Preset
  - Look Preset
  - Render Preset
- Local persistence for the new kinds first.
- Thumbnails only if they can be done locally without cloud persistence ambiguity.
- Presets must include Diffusion Camera fields when relevant.

Slice 2 exit gate:

- Generators produce valid, guarded, deterministic scenes.
- Presets save/load only their intended scope.
- Presets do not mutate historical render snapshots.
- Local thumbnail behavior is documented if implemented, or explicitly deferred.
- Full tests/build/smoke/live verification pass.
- Stop for Codex review.

### Slice 3 — Cloud Template Persistence

Goal: move templates from local-only convenience into authenticated storage.

Implement:

- Authenticated template APIs.
- Firestore collection/schema for Scene / Element / Look / Render presets.
- owner/client/global scope fields.
- admin-only Global promotion.
- schemaVersion, source recipe, seed, thumbnail path, timestamps, and version.
- migration/backfill plan for local templates.

Do not start Proof or 4K in this slice.

Slice 3 exit gate:

- Client-scoped reads/writes are isolated.
- Global templates are admin-only.
- Local templates can coexist or migrate safely.
- Tests cover auth, tenant isolation, schema validation, and invalid writes.
- Full tests/build/smoke/live verification pass.
- Stop for Codex review.

### Slice 4 — Proof Renderer

Goal: implement deterministic Cloud Run Proof render before any 4K claims.

Implement:

- versioned `art-scene-v2` recipe path.
- 960/1080-class Proof output.
- fixed-frame timing, deterministic seeded simulations, asset/font/shader preload.
- FFmpeg encode from frames.
- poster generation.
- `ffprobe` verification.
- job status/progress/failure messages.
- Proof support for Diffusion Camera, or explicit Proof-unsupported messaging if not ready.

Slice 4 exit gate:

- Proof render is deterministic.
- Output dimensions, FPS, duration, codec, frame count, and poster are verified.
- Browser preview and Proof renderer match closely enough for review.
- Diffusion Camera support is honestly labeled and verified.
- Full tests/build/smoke plus one Proof canary pass.
- Stop for Codex review.

### Slice 5 — Ultra / 4K Renderer

Goal: only after Proof is stable, add exact high-resolution outputs.

Implement:

- exact dimensions:
  - 3840x2160
  - 3840x2400 where existing 16:10 equivalent applies
  - 2160x2160
  - 2160x3840
  - exact-size Still Master PNG
- render target and GPU limit validation.
- time/cost estimates.
- budget warnings for transmission, particles, shadows, DOF/diffusion, and 4K combinations.
- acceptance gallery covering glass, particles, GLB, typography, reflections, Diffusion Camera, and vertical safe areas.

Slice 5 exit gate:

- Never label a lower-resolution output as 4K.
- `ffprobe` confirms actual dimensions/FPS/duration/frame count.
- H.264 MP4 has compatible pixel format and fast-start.
- Still Master PNG dimensions are exact.
- 4K canary is run only with explicit user approval.
- Stop for Codex review.

## Diffusion Camera acceptance criteria

Diffusion Camera is complete only when:

- It is visible as a camera/look/render feature in Studio.
- It can be enabled/disabled.
- It has clear controls for focal target/point, strength/aperture, falloff, blur/diffusion radius, and highlight bloom.
- It serializes in scene recipes/templates.
- It randomizes deterministically under the appropriate scopes.
- It respects locks where applicable.
- It does not obscure primary artwork by default.
- It has preview-vs-final support labels.
- It is included in Proof/4K render support only after renderer parity is implemented and verified.

## Final master prompt for Sonnet

Copy the prompt below into Sonnet.

---

You are starting the next approved phase of the original Studio video-making roadmap in:

`/Users/bballi/Documents/Repos/Bballi_Portfolio`

This is the original `/dashboard/studio` Studio/Holo Paper cinematic set builder. Do not work on Opportunity Signals, Social Auto-Publish, Video Remix/EditVideos, onboarding, or a new `/studio-v2`.

The prior Studio checkpoint is closed and approved. Do not reopen it unless you find a regression. Your new scope is the larger remaining roadmap, but you must execute it in gated slices and stop after each slice for Codex review.

Read before editing:

1. `CLAUDE.md`
2. `docs/plans/STUDIO-ROADMAP-NEXT-PHASE-SONNET-HANDOFF.md`
3. `docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-PLAN.md`
4. `docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-SONNET-HANDOFF.md`
5. `docs/plans/STUDIO-VIDEO-UPGRADES-SONNET-HANDOFF.md`
6. `docs/dashboard-ui/VIDEO_STUDIO_UX_KIT.md`
7. `docs/features/studio/README.md`
8. `docs/features/studio/VIDEO_PROMO_VARIATION_ENGINE.md`
9. `docs/features/studio/STUDIO_RENDER_HOSTING.md`
10. `app/dashboard/studio/page.jsx`
11. `app/dashboard/studio/ClothStudio.jsx`
12. `app/dashboard/studio/components/StudioElementsCard.jsx`
13. `app/dashboard/studio/components/StudioElementInspector.jsx`
14. `app/dashboard/studio/components/SceneTemplatesCard.jsx`
15. `app/dashboard/studio/elements/intensity.js`
16. `app/dashboard/studio/elements/scene-elements.js`
17. `app/dashboard/studio/elements/randomize.js`
18. `app/dashboard/studio/elements/history.js`
19. `app/dashboard/studio/elements/scene-recipe.js`
20. `app/dashboard/studio/elements/templates.js`
21. Relevant tests under `app/dashboard/studio/elements/__tests__/`

First run `git status --short`. Preserve every pre-existing user change. Do not touch unrelated files or user-owned assets.

Start with **Slice 1 only**:

- unified randomization scope control for Entire set, Lighting only, Camera only, Motion only, Colors only, Elements only, Selected element, Look only, and Unlocked values only;
- undo/redo support for every new randomization scope;
- guardrails for element count, weighted categories, no duplicate hero elements, safe-area/near-plane, contrast/readability where practical, and transmission/shadow/render-budget caps;
- Diffusion Camera schema and preview controls.

Diffusion Camera requirements:

- It is a camera/look/post-processing feature, not an element mesh.
- It creates a high-resolution cinematic feel by keeping a focal point sharp while softening areas outside the focal region.
- Controls: enabled/off, focal target or point, focus distance, aperture/strength, falloff, diffusion radius, highlight bloom, and optional foreground/background bias.
- It serializes in scene recipes/templates.
- It randomizes deterministically under Camera only / Look only / Entire set where appropriate.
- It respects locks where applicable.
- It is labeled honestly as preview-supported, preview-approximate, or final-render-supported depending on actual support.
- Do not claim Proof/4K support until the render service implements and verifies it.

Do not start in Slice 1:

- cloud template persistence
- Proof renderer
- Ultra / 4K renderer
- production deploys
- Social Auto-Publish
- Video Remix/EditVideos
- unrelated repo cleanup

Verify Slice 1 with:

- `npm test`
- `npm run build`
- `node scripts/smoke-studio.mjs`
- live browser checks for Camera-only, Motion-only, Colors-only, Entire-set, Unlocked-only, guardrail warning behavior, and Diffusion Camera persistence.

Documentation:

- Update `docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-PLAN.md` with a non-WIP as-built checkpoint for Slice 1.
- Include changed files, exact verification commands/results, what is complete, what remains deferred, and any preview-vs-final support limitations for Diffusion Camera.
- Stop for Codex review after Slice 1. Do not continue to Slice 2 without explicit approval.

When done, report changed files, verification results, live checks, remaining deferred work, and any risks requiring review.
