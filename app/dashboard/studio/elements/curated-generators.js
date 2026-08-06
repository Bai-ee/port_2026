// Curated set generators — docs/plans/STUDIO-ROADMAP-NEXT-PHASE-SONNET-
// HANDOFF.md Slice 2, "12 curated set generators" (docs/plans/ORIGINAL-
// STUDIO-CINEMATIC-SETS-4K-PLAN.md "### Curated generators" only named the
// 12 sets; the concrete content — element type lists, counts, and the
// FX/environment/scene/diffusion-camera preset ids each set applies — is
// specified here). Pure logic (no React, no three.js) — every generator run
// is directly unit-testable, same discipline as the rest of elements/*.js.
//
// A curated generator is NOT a new placement/selection system: it's a
// deterministic RECIPE over the same primitives Add Element/Randomize
// already use (elements/catalog.js's weighted pick, elements/placement.js's
// format-aware default transform, elements/scene-elements.js's id
// allocation + material/motion/appearance variation). Given a generator id
// and a seed, `generateCuratedSet` picks a random-but-reproducible COUNT of
// DISTINCT element types from that generator's own curated list, places each
// one via the exact same guarded default-transform search every other
// element uses, and varies each instance's material/motion/appearance so
// repeat picks of the same type don't look identical.
//
// This module never touches React state, undo/redo history, or any seed
// beyond what's passed in — same separation of concerns createSceneElement/
// randomizeAllElements already establish (elements/scene-elements.js): the
// caller (UI) owns wiring this result into extraInstances/history/the
// fx/env/scene preset pickers, this function only computes what that result
// should be.

import { getElementDefinition, getElementWeight, MAX_EXTRA_INSTANCES } from './catalog.js';
import { createElementInstance } from './schema.js';
import { defaultTransformForFormat } from './placement.js';
import { mulberry32, deriveSeed } from './randomize.js';
import { nextElementId, randomizeInstanceFields } from './scene-elements.js';

// Every id/label/elementTypes/fxPresetId/envId/sceneId/diffusionCamera value
// below is verbatim, requester-specified content — these preset ids
// reference real, already-registered FX_PRESETS/ENV_PRESETS/SCENE_PRESETS
// entries in ClothStudio.jsx. Do not alter without re-verifying against that
// file's live preset registries.
export const CURATED_GENERATORS = [
  { id: 'glass-gallery', label: 'Glass Gallery', description: 'A hushed showcase of pure transmissive glass forms.', elementTypes: ['liquid-glass-lens', 'prismatic-slab', 'iridescent-film', 'gel-panels'], minCount: 2, maxCount: 3, fxPresetId: 'studio-clean', envId: 'hall', sceneId: 'gallery-white', diffusionCamera: { enabled: true, aperture: 0.3, falloff: 0.6, diffusionRadius: 0.25, highlightBloom: 0.3 } },
  { id: 'chrome-playground', label: 'Chrome Playground', description: 'Hard reflective metal shards and rings at play.', elementTypes: ['mirror-fragments', 'chrome-ribbon', 'orb-constellation'], minCount: 2, maxCount: 3, fxPresetId: 'chrome-emboss', envId: 'room', sceneId: null, diffusionCamera: null },
  { id: 'holographic-lab', label: 'Holographic Lab', description: 'Spectral iridescence under a shifting rig.', elementTypes: ['iridescent-film', 'prismatic-slab', 'kinetic-rings'], minCount: 2, maxCount: 3, fxPresetId: 'kaleido-cathedral', envId: 'room', sceneId: null, diffusionCamera: null },
  { id: 'soft-sculpture-studio', label: 'Soft Sculpture Studio', description: 'Organic, breathing forms in a calm white space.', elementTypes: ['inflatable-forms', 'metaball-bloom', 'translucent-monoliths'], minCount: 2, maxCount: 3, fxPresetId: 'studio-clean', envId: 'room', sceneId: 'gallery-white', diffusionCamera: null },
  { id: 'night-portal', label: 'Night Portal', description: 'A dark, moody threshold lit from within.', elementTypes: ['portal-plane', 'volumetric-light-cone', 'caustic-water-light'], minCount: 2, maxCount: 3, fxPresetId: 'night-neon', envId: 'night', sceneId: 'deep-sea', diffusionCamera: { enabled: true, aperture: 0.5, falloff: 0.4, diffusionRadius: 0.4, highlightBloom: 0.5 } },
  { id: 'brand-museum', label: 'Brand Museum', description: 'A gallery wall for logo and frame work.', elementTypes: ['logo-sculpture', 'floating-media-frame', 'kinetic-type-totem'], minCount: 2, maxCount: 3, fxPresetId: 'studio-clean', envId: 'hall', sceneId: 'gallery-white', diffusionCamera: null },
  { id: 'liquid-editorial', label: 'Liquid Editorial', description: 'Glossy, fluid, high-fashion surfaces.', elementTypes: ['gel-panels', 'liquid-glass-lens', 'caustic-water-light'], minCount: 2, maxCount: 3, fxPresetId: 'cinema-bloom', envId: 'dusk', sceneId: 'retro-sunset', diffusionCamera: { enabled: true, aperture: 0.4, falloff: 0.5, diffusionRadius: 0.3, highlightBloom: 0.4 } },
  { id: 'particle-cathedral', label: 'Particle Cathedral', description: 'A vast, drifting field of atmospheric particles.', elementTypes: ['homepage-particle-hero', 'particle-ribbon', 'volumetric-light-cone'], minCount: 2, maxCount: 3, fxPresetId: 'kaleido-cathedral', envId: 'hall', sceneId: null, diffusionCamera: null },
  { id: 'neon-architecture', label: 'Neon Architecture', description: 'Glowing structural lines in a night alley.', elementTypes: ['light-tubes', 'wireframe-sculpture', 'cloth-banners'], minCount: 2, maxCount: 3, fxPresetId: 'night-neon', envId: 'night', sceneId: 'neon-alley', diffusionCamera: null },
  { id: 'minimal-product-stage', label: 'Minimal Product Stage', description: 'A clean, restrained stage for a single hero.', elementTypes: ['translucent-monoliths', 'floating-media-frame'], minCount: 1, maxCount: 2, fxPresetId: 'studio-clean', envId: 'room', sceneId: 'gallery-white', diffusionCamera: null },
  { id: 'maximal-music-visual', label: 'Maximal Music Visual', description: 'Loud, dense, maximum energy.', elementTypes: ['orb-constellation', 'metaball-bloom', 'particle-ribbon', 'kinetic-rings'], minCount: 3, maxCount: 4, fxPresetId: 'acid-posterize', envId: 'room', sceneId: 'candy-pop', diffusionCamera: null },
  { id: 'monochrome-art-film', label: 'Monochrome Art Film', description: 'A stark, cinematic black-and-white study.', elementTypes: ['wireframe-sculpture', 'mirror-fragments', 'topographic-floor'], minCount: 2, maxCount: 3, fxPresetId: 'newsprint-1bit', envId: 'night', sceneId: null, diffusionCamera: { enabled: true, aperture: 0.35, falloff: 0.5, diffusionRadius: 0.3, highlightBloom: 0.15 } },
];

export function getCuratedGenerator(generatorId) {
  return CURATED_GENERATORS.find((g) => g.id === generatorId) || null;
}

export function resolveCuratedDiffusionCamera(current, config) {
  const existing = current && typeof current === 'object' ? current : {};
  if (!config || typeof config !== 'object') return { ...existing, enabled: false };
  return { ...existing, ...config, enabled: config.enabled === true };
}

/**
 * Weighted-without-replacement pick of `count` DISTINCT items from `items`
 * (elements/catalog.js getElementWeight per item) — repeatedly weighted-picks
 * one item from the remaining pool and removes it, `count` times. `count` is
 * clamped to `items.length` defensively (every CURATED_GENERATORS entry's
 * maxCount already fits within its own elementTypes.length, but this stays
 * safe if that ever drifts). Every weight is guaranteed > 0 by
 * getElementWeight's own contract (defaults to 1), so the running total is
 * always positive while the pool is non-empty.
 */
function weightedPickDistinct(rand, items, count) {
  const pool = [...items];
  const picked = [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i += 1) {
    const weights = pool.map((type) => getElementWeight(type));
    const total = weights.reduce((sum, w) => sum + w, 0);
    let r = rand() * total;
    let idx = pool.length - 1; // float-safety fallback: last item if rounding overshoots
    for (let j = 0; j < pool.length; j += 1) {
      r -= weights[j];
      if (r <= 0) { idx = j; break; }
    }
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picked;
}

/**
 * Generate one curated set — a reproducible, format-aware batch of
 * extraInstances plus the generator's FX/environment/scene/diffusion-camera
 * presets. Pure state-transform: does not read or write any React state,
 * undo/redo history, or scene seed beyond `seed`/`formatId` — the caller
 * (UI) owns applying the result to extraInstances/history/preset pickers.
 *
 * Determinism: the same (`generatorId`, `seed`, `formatId`) always produces
 * a deep-equal result (every random draw is seeded off `seed` via
 * deriveSeed/mulberry32 — never Math.random()); a different `seed` produces
 * a different result (different count/type selection and/or different
 * material variation).
 *
 * Returns `{ feasible, extraInstances, fxPresetId, envId, sceneId,
 * diffusionCamera, warnings }` on success, or `{ feasible: false, error }`
 * for an unknown `generatorId` — never throws.
 */
export function generateCuratedSet(generatorId, { seed, formatId = 'landscape' } = {}) {
  const generator = getCuratedGenerator(generatorId);
  if (!generator) return { feasible: false, error: 'Unknown generator' };

  const rand = mulberry32(deriveSeed(seed, generatorId, 'curated-generate'));

  const span = generator.maxCount - generator.minCount + 1;
  const rolledCount = generator.minCount + Math.floor(rand() * span);
  const count = Math.min(rolledCount, MAX_EXTRA_INSTANCES);

  const pickedTypes = weightedPickDistinct(rand, generator.elementTypes, count);

  const warnings = [];
  const existingIds = [];
  const placedInstances = pickedTypes.map((type) => {
    const id = nextElementId(type, existingIds);
    existingIds.push(id);
    const def = getElementDefinition(type);
    const { position, scale, feasible, constraint } = defaultTransformForFormat(type, formatId, def);
    if (!feasible) warnings.push({ type, constraint });
    return createElementInstance(type, {
      id,
      enabled: true,
      transform: { position, scale, rotation: [0, 0, 0] },
    });
  });

  const extraInstances = placedInstances.map((instance) => {
    const def = getElementDefinition(instance.type);
    const materialRand = mulberry32(deriveSeed(seed, instance.id, 'curated-material'));
    const { instance: varied } = randomizeInstanceFields(instance, def, materialRand, { intensity: 'remix' });
    return varied;
  });

  return {
    feasible: warnings.length === 0,
    extraInstances,
    fxPresetId: generator.fxPresetId,
    envId: generator.envId,
    sceneId: generator.sceneId,
    diffusionCamera: generator.diffusionCamera,
    warnings,
  };
}
