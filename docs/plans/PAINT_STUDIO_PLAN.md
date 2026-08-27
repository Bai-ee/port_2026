# Paint Studio — Plan

## Product brief

**Paint** is a Studio tool that lets a designer create and tune original, procedural wallpaper artwork, then export the exact composition as a production-ready image.

**Primary user:** the designer responsible for a client’s branded visual system. The later client-facing experience should expose approved templates and bounded controls, not the full authoring surface.

**Problem:** the client commissions illustrations whenever it needs a new wallpaper. That is slow, finite, and revision-heavy. A normal AI image generator would be quicker but is not acceptable for this use case.

**Solution:** select an authored style/template, then tune its live generative sketch—palette, density, composition, texture, seed, and template-specific parameters—until it is ready to export. The saved recipe is the source of truth, so the artwork can be revisited instead of recreated.

### V1 does

- Render authored p5.js procedural wallpaper templates in a live Studio artboard.
- Let a designer tune global palette, seed, density, texture, composition, and bounded template controls.
- Save a versioned recipe locally and export exact-size PNGs in wallpaper formats.
- Create deterministic variations through a visible seed and a Remix action.
- Preserve author/tool/template provenance with every saved/exported asset.

### V1 does not

- Generate or train images with a diffusion model, image model, or an LLM at runtime.
- Offer an unrestricted code editor or execute user-supplied JavaScript.
- Claim that an exported work is uncopyrightable or provide legal advice.
- Add Cloud Run/GPU rendering, video, animation timelines, or social publishing.
- Expose the full designer authoring surface directly to a client.

## Product decision

Put Paint in the existing `/dashboard/studio` tool switcher alongside **Mockup Video** and **Holo Paper**. It is a third Studio mode, not a dashboard card and not `/studio-v2`.

V1’s output should be called **original procedural artwork** or **rights-clear generative artwork**, not “copyright-free.” The system can demonstrate that no generative image model was used and retain an authored-code/template provenance record; it cannot make a universal copyright determination.

## Expected result

A designer opens **PAINT**, chooses a template such as *Watercolour Bloom*, *Botanical Weave*, or *Pigment Burst*, and immediately sees a complete composition. The artboard is live, but every variation is reproducible: `template + version + palette + params + seed` always recreate the same image. The right rail makes aesthetic controls legible. The designer saves a named recipe and exports desktop/mobile PNG wallpaper sizes. A later client mode starts from that approved recipe and exposes only brand-safe controls.

## UX shape

- Reuse the full-screen Studio shell, artboard, floating rail cards, glass tokens, responsive behavior, toasts, and Saved Assets conventions.
- Tool URL is `/dashboard/studio?tool=paint` and the top switcher has `MOCKUP VIDEO`, `HOLO PAPER`, and `PAINT`.
- The central artboard is the export frame. Do not put the preview inside a modal.
- First action: select a template from a visually led template card. No blank canvas.
- Under artboard: format selector (desktop, mobile, square/tablet), `Remix`, `Save recipe`, and primary `Export PNG`.
- Rail cards: Template; Palette; Composition; Material/Texture; Variation; Export; Saved recipes.
- Give every template a strong default and 3–5 curated named palettes. Avoid a generic prompt box in V1.

## Technical plan

### Phase 0 — guardrails and fixture

1. Read the Studio UX docs and inspect repository status.
2. Add Paint behind a local/admin feature flag; switching it must not build the Mockup or Cloth worlds.
3. Define a pure, versioned recipe schema and seeded PRNG. Add unit tests for normalization, deterministic output values, settings migration, and safe parameter clamping.
4. Establish a `PaintStudio` lazy-loaded component and a small module boundary. Do not add to the already-large `ClothStudio.jsx`.

### Phase 1 — viable authoring loop

1. Create `app/dashboard/studio/paint/` modules for recipes, PRNG, palettes, templates, renderer adapter, and storage.
2. Embed p5 only inside the Paint mode. Render onto a high-DPI canvas that responds to the selected output format.
3. Port the supplied sample sketches only after confirming their licence/ownership; otherwise use them as visual references and author fresh implementations.
4. Launch three curated templates:
   - **Watercolour Bloom**: translucent petal layers, ink stem details, pigment bleed.
   - **Botanical Weave**: dark branching paths with clustered stamped blossoms.
   - **Pigment Burst**: central pigment mass, soft particles, restrained confetti field.
5. Implement global controls (palette, background, seed, density, scale, texture) plus a small, template-specific control set. Every control has bounded ranges and a reset.
6. Implement `Remix` by changing the stored seed only; display and allow copying the seed.

### Phase 2 — persistence and export

1. Save named recipes in localStorage using a dedicated, versioned key—not the existing Mockup or Holo keys.
2. Export a lossless PNG at exact target dimensions. Render from the recipe at export size; do not resize the preview bitmap.
3. Include `paint-recipe.json` in the download or alongside a saved asset record, with template id/version, seed, parameters, palette, output size, and app renderer revision.
4. Add saved recipe previews and “Duplicate / Load / Delete” actions. Deletion must require confirmation.

### Phase 3 — client-safe delivery (separate approval)

1. Add authenticated persistence with client ownership and immutable export snapshots.
2. Add a `client`/`designer` capability model. Client mode permits only approved recipes, palettes, formats, and variation limits.
3. Add client download history and a provenance panel explaining the authored template and no-image-model pipeline.

## Non-negotiable engineering constraints

- No image-generation API, model inference, prompt-to-image request, or model-generated pixels in the Paint rendering path.
- Do not execute arbitrary user code. Templates are first-party modules registered in a constrained catalogue.
- Never use `Math.random()` in serialized visual state. A saved recipe must render identically on repeat export for a fixed renderer version.
- Keep template APIs narrow: `defaults`, `schema`, `render(context, recipe)`, `palettes`, and `version`.
- Do not change Mockup Video, Holo Paper, their queue contracts, Cloud Run service, or existing capture behavior.
- Use p5.js only if it is already installed or add it deliberately with a lazy client-only import. Keep p5 out of the initial Studio bundle.
- Respect `prefers-reduced-motion`; Paint V1 is a still-image system.
- Test export dimensions and recipe determinism. Manually verify desktop, mobile, and narrow layouts.

## Acceptance criteria

1. `/dashboard/studio?tool=paint` opens Paint without regressing either existing Studio mode.
2. A template is selected by default and produces a polished image without a prompt.
3. A saved recipe reloads to the same rendered composition.
4. Remix creates a visibly different but stylistically valid result; restoring the former seed restores the former result.
5. PNG export dimensions exactly equal the selected output format.
6. The exported bitmap is made entirely from first-party procedural template code and parameters, with recorded provenance.
7. `npm test`, `npm run build`, and `node scripts/smoke-studio.mjs` pass, with focused Paint tests added.

## Open decision

The exact named first client and their brand palette/template approvals are still open. Design V1 around the internal designer as the primary operator, so this unknown does not stall the first useful release.
