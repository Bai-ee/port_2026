# Claude handoff — Paint Studio

Implement the approved plan at `docs/plans/PAINT_STUDIO_PLAN.md` in this repository. Work only on the new Paint Studio feature. Preserve all pre-existing user changes.

## Required reading before editing

1. `CLAUDE.md` if present
2. `docs/plans/PAINT_STUDIO_PLAN.md`
3. `docs/dashboard-ui/VIDEO_STUDIO_UX_KIT.md`
4. `docs/features/studio/README.md`
5. `app/dashboard/studio/page.jsx`
6. `app/dashboard/studio/ClothStudio.jsx` only as needed to understand existing Studio mode boundaries
7. `package.json`

Inspect `git status --short` before editing. Do not discard, reformat, or overwrite unrelated work.

## Objective

Add **Paint** as the third mode in the existing `/dashboard/studio` workspace. It creates original, deterministic procedural wallpaper artwork that a designer can tune and export. It is not an AI image generator, code editor, video tool, or a new Studio page.

The target entry point is `/dashboard/studio?tool=paint`. Update the existing tool switcher to expose `MOCKUP VIDEO`, `HOLO PAPER`, and `PAINT`, preserving the existing URL semantics for the first two modes.

## Required implementation

1. Add a lazy, client-only `PaintStudio` component; do not add Paint logic to `ClothStudio.jsx` or grow the main page unnecessarily.
2. Build a bounded module structure under `app/dashboard/studio/paint/` for:
   - versioned recipe schema + migration/normalization;
   - seeded PRNG and derived variation helpers;
   - template catalogue;
   - palettes;
   - p5/canvas renderer adapter;
   - local saved-recipe storage;
   - exact-size PNG export.
3. Reuse the Studio full-screen shell, preview-first artboard, under-canvas controls, floating glass rail cards, responsive rail behavior, type, and tokens from the Video Studio UX kit.
4. Start with a selected template—not a blank canvas—and include three first-party procedural templates: Watercolour Bloom, Botanical Weave, and Pigment Burst. Each needs a carefully art-directed default, several named palettes, global controls, and a small set of template-specific controls.
5. Expose: template selection, palette/background, composition, texture/material, seed, Remix, reset, Save recipe, Load/Duplicate/Delete saved recipe, output format, and Export PNG.
6. Make all serialized behavior deterministic. A recipe is `{ schemaVersion, templateId, templateVersion, seed, paletteId, background, params, output }`; normalise and clamp it before render/export. Never use `Math.random()` in a template render path.
7. Render export from the normalized recipe at the exact chosen output dimensions. Do not export a scaled preview. Record a provenance object next to the export/saved recipe with template/version, seed, params, dimensions, renderer revision, and timestamp.
8. Add focused tests for recipe normalization/migration, seed determinism, parameter bounds, and export-size logic. Extend smoke coverage appropriately.

## Non-negotiable constraints

- No diffusion model, image API, text-to-image request, LLM-generated pixels, or runtime generated code. Do not add a prompt box.
- Do not execute arbitrary user-supplied JavaScript. Templates must be registered first-party modules with a constrained interface.
- Treat reference/sample p5 sketches as inspiration only until their licence is verified. Do not copy them verbatim.
- Do not modify Studio Cloud Run, render worker, render job contracts, Mockup Video, or Holo Paper behavior.
- Do not create `/studio-v2`, a dashboard modal, or a standalone app.
- Do not deploy, call paid services, or change production data/schedules.
- Use feature gating if that is the repository’s established pattern; the flag-off state must preserve current behavior.
- Keep the initial p5 payload lazy and client-only. If p5 is not installed, make the smallest justified dependency change.

## Visual standard

The references point to quiet, tactile procedural art: paper-like backgrounds, controlled pigment transparency, botanical linework, and restrained particle texture. Do not produce generic neon “AI art,” noisy random confetti, or a dashboard-looking canvas. The template must look intentional before a user changes a control.

## Verification and handoff

Run the relevant focused tests plus `npm test`, `npm run build`, and `node scripts/smoke-studio.mjs`. If an existing failure is unrelated, report it with evidence. Manually verify all three Studio modes at desktop and narrow layouts, a recipe save/load, reproducible seed, and exact PNG dimensions. Finish with a concise summary of files changed, commands run, and any remaining limitation—especially whether client-safe shared storage is intentionally deferred.
