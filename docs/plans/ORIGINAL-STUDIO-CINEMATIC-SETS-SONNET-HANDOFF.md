# Sonnet Handoff Prompt — Original Studio Cinematic Sets + 4K

Copy everything below this line into the Sonnet task.

---

You are implementing the approved plan in this repository:

`docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-PLAN.md`

The target is the **original** `/dashboard/studio` implementation. Do not create `/dashboard/studio-v2`, do not implement the Unified Content Studio plan, and do not move this work into a new page.

## Required reading before editing

Read these files completely before taking implementation action:

1. `CLAUDE.md`
2. `docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-PLAN.md`
3. `docs/dashboard-ui/VIDEO_STUDIO_UX_KIT.md`
4. `docs/features/studio/README.md`
5. `docs/features/studio/VIDEO_PROMO_VARIATION_ENGINE.md`
6. `docs/features/studio/STUDIO_RENDER_HOSTING.md`
7. `app/dashboard/studio/page.jsx`
8. `app/dashboard/studio/ClothStudio.jsx`
9. `HomePage.jsx`
10. `ox.jsx`
11. `services/studio-render/recipe.mjs`
12. `services/studio-render/scene.mjs`
13. `services/studio-render/render.mjs`
14. `services/studio-render/server.mjs`
15. `scripts/render-ui-teaser.mjs`

Inspect the repository status before editing. Preserve all pre-existing user changes and do not reformat or rewrite unrelated files.

## Crucial factual correction

The homepage does **not** currently contain a GLB. The homepage hero is the procedural 25,000-particle torus/swarm in `ox.jsx`.

Implement these as separate elements:

- `homepage-particle-hero`: an adapted, seeded Studio version of the actual procedural homepage visual;
- `glb-model-stage`: a real GLB loader/import element for uploaded or approved models.

Do not invent a homepage GLB and do not change the homepage appearance.

## Objective

Turn Holo Paper inside the original Studio into a professional cinematic set builder with:

- a data-driven selectable scene-element catalog;
- the existing Glass Petal Sphere preserved as the first registered element;
- robust per-element transform/material/motion/appearance controls;
- global look-and-feel controls;
- seeded, reproducible, lock-aware randomization;
- Scene, Element, Look, and Render templates;
- a complete curated element library described in the plan;
- the actual homepage particle artwork;
- GLB loading with safe validation/optimization hooks;
- Draft, Proof, Social HD, Ultra 4K, and Still Master render tiers;
- a deterministic Cloud Run fixed-frame render path for professional 4K output;
- explicit user messaging when settings exceed preview or production capability.

## Non-negotiable constraints

- Work in the original `/dashboard/studio` only.
- Preserve Mockup Video and existing Holo Paper behavior.
- Do not replace the current glass sculpture.
- Do not break existing local PNG/video export.
- Do not change the current Mockup Cloud render recipe/worker behavior while building the Holo element foundation.
- Do not silently clamp resolution, FPS, duration, samples, element count, or particles.
- Do not use unseeded `Math.random()` for serialized/randomized scene state.
- Do not add Theatre.js or a new canvas framework. Use the existing Three.js, three-stdlib, React/R3F where already appropriate, GSAP, and current Studio timeline patterns.
- Do not deploy Cloud Run, trigger paid rendering, write global templates, or modify production schedules without explicit user approval.
- Keep new UI aligned with the existing Video Studio UX kit and rail-card system.
- Preserve mobile usability and the current preview-first hierarchy.

## Implementation order

Implement the plan phase by phase. Do not jump directly into 25 hard-coded meshes.

### Phase 0 — baseline

1. Capture current behavior and screenshots for Mockup Video and Holo Paper at desktop/mobile sizes.
2. Record the existing Glass Petal Sphere defaults and visible output.
3. Add a feature flag or admin-only development gate for the new element system.
4. Add focused tests for schema normalization, seeded PRNG output, settings migration, and lock behavior.
5. Document the do-not-touch render/card/route contracts discovered during inspection.

The flag-off path must remain identical.

### Phase 1 — architecture and glass parity

Create bounded modules under `app/dashboard/studio/elements/` and UI components under `app/dashboard/studio/components/` as described in the plan.

At minimum implement:

- element catalog;
- normalized versioned element instance schema;
- deterministic global/sub-seed derivation;
- quality cost metadata;
- lock-aware randomization helpers;
- serializer/migration helpers;
- element selection/add/remove/duplicate/reorder/visibility;
- common transform controls;
- undo/redo for element mutations;
- existing Glass Petal Sphere registered through the catalog.

Do not change the glass’s default geometry, material, transform, lighting, or output. Keep the existing Glass controls available until the new inspector reaches parity.

Run tests and visual checks before proceeding.

### Phase 2 — first professional pack

Implement these five elements first:

1. Liquid-Glass Lens
2. Chrome Ribbon
3. Kinetic Rings
4. Translucent Monoliths
5. Floating Media Frames

Each must have:

- a strong default;
- at least three named presets;
- bounded controls;
- safe random ranges;
- seeded motion/placement;
- draft/proof/final quality behavior;
- performance cost;
- format-aware placement;
- disposal/cleanup;
- an explicit unsupported state if final rendering is not yet implemented.

### Phase 3 — homepage particles and GLB

Adapt the pure particle-generation behavior from `ox.jsx` into a Studio element. Do not import the whole homepage Canvas and do not change homepage output. Seed initial positions and scatter behavior so a saved template reproduces exactly.

For GLB:

- use the existing Three.js GLTFLoader path;
- support Draco, Meshopt, and KTX2/Basis when needed;
- normalize bounds/pivot/scale;
- expose animation clips and turntable motion;
- add material/shadow overrides;
- enforce upload/asset caps and approved hosts;
- dispose all GPU resources when removed;
- keep original and optimized derivatives separate.

### Remaining phases

Continue through the element packs, global LOOK controls, template persistence, Proof renderer, and Ultra 4K renderer exactly in the order and exit gates defined in the plan.

Do not mark an element production-supported until both browser preview and final renderer support are implemented and verified.

## Randomization requirements

Use one stored global seed and derived subsystem seeds. Implement:

- Entire set;
- Look only;
- Lighting only;
- Camera only;
- Elements only;
- Selected element;
- Motion only;
- Colors only;
- Unlocked only.

Implement Refine, Remix, Transform, and Wild-but-valid intensities. Locks must work at the element and parameter-group level. Every randomization must be undoable and must display the seed.

Enforce hero safe zones, element-count budgets, transmission/shadow limits, output-format safe areas, and renderer capability constraints. A random result must always be valid for its selected target or explicitly labeled preview-only.

## Template requirements

Implement four distinct template kinds:

- Scene Template;
- Element Preset;
- Look Preset;
- Render Preset.

Keep localStorage convenience. Add authenticated cloud storage only through a validated API. Global template writes must be admin-only. Store `schemaVersion`, scope, owner/client, recipe, thumbnail, seed, timestamps, and version. Never mutate historical render snapshots when a template changes.

## 4K rendering requirements

The final professional renderer must not be a live MediaRecorder capture.

Build a versioned `art-scene-v2` path in the existing Cloud Run Studio service:

- exact output dimensions;
- fixed timestep based on frame number/FPS;
- deterministic seeded simulations;
- complete asset/shader/font preload;
- sequential frame rendering;
- explicit FFmpeg encode;
- poster generation;
- `ffprobe` verification;
- capture metadata with recipe/template/seed/renderer revision;
- progress stages and clear failures.

Required output choices:

- Social HD: 1920×1080, 1080×1080, 1080×1920;
- Ultra landscape: 3840×2160 and the existing 16:10 equivalent 3840×2400;
- Ultra square: 2160×2160;
- Ultra vertical: 2160×3840;
- Still Master: exact-size PNG, optional alpha only where supported.

Show exact dimensions. Never call a clamped/lower-resolution file “4K.” Query and validate GPU/render-target limits before enqueue. Use H.264 MP4 with explicit compatible pixel format and fast-start for the main social master; verify actual codec, dimensions, FPS, duration, and frame count before saving.

## Professional visual standard

Use physically plausible lighting and materials, HDRI/PMREM, deliberate shadows, explicit color management, ACES Filmic default, and a restrained finishing chain. Add post effects only with quality scaling and predictable final-render parity.

Avoid generic “AI art” defaults, noisy over-decoration, arbitrary rainbow gradients on every object, uncontrolled bloom, excessive chromatic aberration, or scenes where the hero content is obscured.

The curated defaults should feel like campaign art direction:

- Glass Gallery;
- Chrome Playground;
- Holographic Lab;
- Soft Sculpture Studio;
- Night Portal;
- Brand Museum;
- Liquid Editorial;
- Particle Cathedral;
- Neon Architecture;
- Minimal Product Stage;
- Maximal Music Visual;
- Monochrome Art Film.

## Verification after each phase

Run the smallest relevant checks continuously, then the full proportional suite at phase exit:

- unit tests for schema/randomization/templates;
- existing project tests;
- `npm run build`;
- `npm run smoke:studio`;
- route smoke where APIs change;
- desktop and mobile visual comparison;
- seed reproducibility check after reload;
- GPU memory/resource disposal check;
- preview performance budget check;
- Proof render fixture;
- Ultra 4K canary only after explicit approval and only when the renderer phase is complete.

Restart the dev server after editing server-side cached `.cjs` modules. Redeploy the Cloud Run renderer only when explicitly authorized.

## Working style and handoff

- Keep changes phase-bounded and reviewable.
- Prefer additive modules over growing `ClothStudio.jsx` further.
- Preserve unrelated dirty-worktree changes.
- Update the plan with accurate as-built notes as phases ship.
- Report exactly which elements are preview-only versus final-render capable.
- Stop and report if parity requires altering an existing production render contract outside the plan.

Start now with Phase 0 and Phase 1. Do not stop after producing another plan: implement the baseline, feature gate, schema/catalog/randomizer, ELEMENTS UI foundation, and Glass Petal Sphere parity. Then verify and report the exact files changed, tests run, and remaining phase gates.

