# Studio Hanging T-Shirt Object - Sonnet Handoff

> **Direction superseded:** The shirt is now a primary Sheet Shape replacement,
> not a separate decorative element. Continue from
> [`STUDIO-REAL-TSHIRT-GLB-INTEGRATION-HANDOFF.md`](STUDIO-REAL-TSHIRT-GLB-INTEGRATION-HANDOFF.md).
> This document remains useful historical context for simulation, print,
> performance, export, and disposal requirements.

## Status

`SUPERSEDED — SEE ACTIVE REAL-GLB HANDOFF`

This is the next separate Studio phase after Diffusion Camera and graphic-treatment composition. The two-pass composition architecture has passed code review. A real-duration foreground-browser 1080p/4K export remains deferred as a production-release verification gate; it does not block local T-shirt implementation. Do not modify or reopen the diffusion-composition architecture unless the T-shirt integration exposes a reproducible regression.

## Product Requirement

Add a realistic, placeable hanging T-shirt to Cloth Studio. The shirt accepts a user-selected logo or artwork on its front surface. The user can move the logo horizontally and vertically, resize it, and rotate it while it remains attached to and deforms with the fabric.

The default shirt state hangs naturally from hanger-supported shoulder/sleeve points and moves gently in the wind. It must read as simulated fabric, not as a rigid shirt model with a looping rotation or a simple whole-mesh sine wave.

This feature is an **element**, not an environment:

- It needs the existing element position, rotation, scale, depth, duplication, locking, randomization, preset, template, and placement workflows.
- Shirt-specific fabric, wind, color, and logo controls belong in the selected-element inspector.
- Environments may light or surround the shirt, but must not own it.

## Required User Controls

### Shirt

- Shirt color
- Fabric roughness and optional subtle normal/bump strength
- Fabric weight
- Stretch stiffness
- Bend stiffness
- Damping
- Wind strength
- Wind direction
- Wind variation/turbulence
- Motion pause/resume through the existing Studio motion behavior
- Optional hanger visibility if a credible hanger asset/geometry is implemented

Provide a restrained, realistic default named `Gentle Hanger`:

- Shoulders and upper sleeve support points remain pinned to the hanger/support line.
- Gravity forms the body and sleeve drape.
- Wind creates low-amplitude, non-repeating movement.
- Motion must not look like a flag, banner, rigid pendulum, or synchronized vertex wave.

### Front Logo / Artwork

- Select from the existing artwork library where compatible
- Upload a PNG, JPEG, or WebP logo/artwork through the existing safe browser asset workflow
- Horizontal position
- Vertical position
- Uniform scale
- Rotation
- Opacity
- Reset placement
- Remove logo

Logo coordinates must use a stable normalized shirt-front coordinate system so placement survives:

- Shirt simulation
- Element transforms
- Quality-tier changes
- Save/reload
- Scene templates
- Element presets
- Cloud/global templates
- Browser video export

The logo must be mapped into the deforming shirt surface through UVs or an equivalent fabric-bound mapping. A flat plane hovering in front of the shirt, a screen-space overlay, or a decal that visibly separates during deformation is not acceptable.

Transparent logos must preserve alpha without dark or white boxes. Texture color space, filtering, mipmaps, anisotropy, and edge handling must be configured for clean high-resolution output.

## Realism Requirements

Use a genuine bounded cloth simulation or a proven cloth/soft-body implementation compatible with the existing Three.js browser architecture. Reuse the current Verlet/fixed-timestep conventions where appropriate, but do not copy the banner's simple sine-wave deformation and call it cloth simulation.

The simulated garment must include:

- A recognizable T-shirt silhouette with body, neckline, shoulders, and sleeves
- Front and back fabric surfaces rather than a single visibly paper-thin front card
- Stable seams or structural constraints connecting the garment regions
- Pinned hanger/support vertices
- Gravity
- Stretch and bend behavior
- Damping
- Bounded wind with spatial and temporal variation
- Stable normals updated after deformation
- No routine explosive simulation, NaNs, inverted scale, or unbounded vertex travel

Prefer a purpose-built, UV-authored shirt mesh or a carefully generated garment mesh whose topology and UV layout are deterministic. If a third-party asset is proposed, confirm its license, repository packaging, UV suitability, and offline/runtime availability before using it. Do not add a remote runtime dependency on an uncontrolled asset URL.

Self-collision and seam collision are desirable only if they remain stable within the browser performance budget. Do not claim them unless implemented and verified. Clearly document any bounded realism compromise.

## Studio Integration Requirements

Add a new catalog element type, recommended id:

`hanging-tshirt`

It must integrate with the existing element architecture:

- `elements/catalog.js`
- `elements/schema.js` and validators
- `elements/factories.js` or a narrowly extracted T-shirt factory module
- Scene element creation, duplication, removal, and selection
- Element Inspector
- Element locks and per-group locks
- All applicable randomization scopes
- Undo/redo
- Element presets
- Scene templates
- Cloud/global templates
- Scene recipe capture/sanitize/restore
- Placement bounds and warnings
- No-duplicate-hero guardrail where applicable
- Performance-budget accounting
- Resource disposal

Logo artwork data must not be embedded as an unbounded data URL inside Firestore documents or templates. Follow the repository's existing asset persistence rules. If the current artwork library is browser-local, saved remote templates must degrade honestly instead of claiming the logo will be available on another device.

Each T-shirt instance must own independent simulation and logo state. Duplicating a shirt must not share mutable geometry, simulation arrays, CanvasTexture state, or disposable resources in a way that causes one instance to alter or dispose another.

## Browser Export Requirements

The T-shirt and logo must render correctly through the approved browser export path:

- Live/native canvas
- 1080p
- 4K when device capability checks permit it
- MP4/H.264
- WebM/VP9
- Diffusion Camera off and on
- Graphic treatment off and on
- Diffusion Camera plus treatment composition enabled

Temporary export resizing must not reset the shirt simulation, logo placement, texture resolution, camera composition, or element transform. Export cleanup must restore the live renderer without leaking geometry, textures, render targets, streams, animation frames, or timers.

The logo texture must remain sharp at 4K. Do not upscale a low-resolution composited logo canvas while labeling the result high resolution. Size the compositing texture from the source asset and output requirement within real GPU limits, and surface an honest warning when the supplied logo is too small for the requested placement/output.

## Performance and Quality

Add explicit quality tiers for shirt simulation topology and cost. The live preview must remain interactive on supported hardware.

Required safeguards:

- Bounded vertex/constraint counts
- Fixed or bounded timestep
- Maximum catch-up steps
- Simulation reset/recovery if non-finite values appear
- Capability-aware 4K texture sizing
- Measured performance-budget cost
- No hidden per-frame geometry/material/texture allocation
- No per-frame CanvasTexture recreation
- No unbounded event listeners, timers, or animation loops

Measure the real factory across its supported control ranges before finalizing placement radius and performance cost. Do not leave placeholder budget numbers while calling the phase complete.

## Implementation Sequence

### T1 - Architecture and Static Garment

- Audit current cloth, banner, factory, schema, inspector, artwork, template, and export systems.
- Decide the shirt mesh/topology and UV strategy.
- Add normalized schema and a static placeable shirt with correct logo mapping.
- Verify transforms, logo controls, persistence, duplication isolation, and disposal.
- Stop for review if the chosen asset/topology introduces licensing or packaging risk.

### T2 - Pinned Cloth Simulation

- Add deterministic/bounded cloth dynamics, seams, pinned support points, gravity, wind, damping, and normals.
- Add `Gentle Hanger` defaults.
- Add quality tiers and simulation recovery.
- Verify independent multiple instances and pause/resume behavior.

### T3 - Full Studio and Export Integration

- Complete locks, randomization, undo/redo, presets, templates, recipe, placement, guardrails, and measured performance accounting.
- Verify preview, Diffusion Camera, treatments, combined FX, 1080p, and 4K browser exports.
- Finish live browser and media validation.

Sonnet may combine T1-T3 only if the implementation remains reviewable and no asset, licensing, schema, or performance uncertainty appears. Any external asset acquisition or dependency addition must be disclosed before it occurs.

## Acceptance Criteria

The phase is complete only when:

1. A user can add, select, duplicate, remove, position, rotate, and scale a hanging T-shirt element.
2. The default shirt hangs credibly from shoulder/sleeve support points and moves gently in bounded wind.
3. The garment visibly behaves as cloth, not a rigid model or banner wave.
4. A user can choose/upload a logo and adjust X, Y, scale, rotation, and opacity.
5. The logo remains attached to and deforms with the shirt surface.
6. Logo alpha, color, orientation, and front-facing placement are correct.
7. Shirt and logo state survive save/load, presets, templates, undo/redo, and reload under the repository's real persistence guarantees.
8. Locks and randomization respect shirt-specific parameter groups.
9. Multiple shirt instances remain independent.
10. Geometry, materials, textures, and simulation resources dispose cleanly.
11. Placement and performance costs are measured from the real implementation.
12. Live preview, 1080p, and capability-permitted 4K exports show the shirt and logo correctly.
13. Diffusion Camera, treatments, and their combined mode remain compatible.
14. Focused tests, the full suite, build, and Studio smoke test pass.
15. Live browser verification has no shader, WebGL, React, or resource-lifecycle errors.

## Master Prompt for Sonnet

You are implementing the next approved Studio phase in:

`/Users/bballi/Documents/Repos/Bballi_Portfolio`

Read this entire handoff first:

`docs/plans/STUDIO-HANGING-TSHIRT-SONNET-HANDOFF.md`

Also read:

- `CLAUDE.md`
- `docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-PLAN.md`
- The latest approved Diffusion Camera plus treatment-composition checkpoint
- `app/dashboard/studio/ClothStudio.jsx`
- `app/dashboard/studio/elements/catalog.js`
- `app/dashboard/studio/elements/schema.js`
- `app/dashboard/studio/elements/validators.js`
- `app/dashboard/studio/elements/factories.js`
- `app/dashboard/studio/elements/scene-elements.js`
- `app/dashboard/studio/elements/scene-recipe.js`
- `app/dashboard/studio/elements/placement.js`
- `app/dashboard/studio/elements/quality.js`
- Existing factory, schema, recipe, placement, quality, and video-export tests

The Diffusion Camera plus graphic-treatment composition code review is complete. Its deferred real-duration foreground-browser export check remains a production-release gate. This is a new element phase, not an extension of that shader round, and it must not absorb unrelated diffusion troubleshooting.

Before editing, report:

1. The current element/factory and cloth-animation architecture.
2. Whether you will use a purpose-built local mesh, procedural garment topology, or an existing licensed asset.
3. The UV/logo-compositing strategy.
4. The pinned-cloth simulation strategy.
5. Persistence and asset-ownership behavior.
6. Expected files and the primary performance/realism risks.

Then implement the bounded T1-T3 sequence in this document. Stop for approval between sub-phases if an external asset/dependency, licensing decision, schema migration, or material performance risk appears. Otherwise continue through the complete feature.

The implementation must be a real `hanging-tshirt` element with independent state, fabric-bound logo mapping, and a bounded pinned cloth simulation. A rigid GLB with a looping animation, a screen-space logo, a floating logo plane, or the existing banner sine-wave technique does not satisfy the requirement.

Keep the worktree guardrails:

- Do not revert unrelated modifications.
- Do not touch Proof Render or cloud infrastructure.
- Do not stage or commit.
- Keep changes inside Studio element/rendering modules, tests, and the Studio SSOT checkpoint.
- Reuse existing patterns instead of creating a parallel element system.

Run focused tests, the full test suite, build, and Studio smoke tests. Live-verify the complete control set, save/load behavior, duplicate isolation, disposal/re-add behavior, Diffusion Camera and treatment compatibility, and real downloaded 1080p/4K media. Use ffprobe for media structure and visual frame inspection for actual logo/fabric correctness.

Append an as-built checkpoint to the Studio SSOT plan. Report files, architecture, behavior, tests, live verification, exported media results, measured performance cost, limitations, and untouched systems.

End with:

`SONNET STATUS: READY_FOR_CODEX_REVIEW`
