// Paint Studio — thin wrapper around the shared seeded-PRNG module
// (app/dashboard/studio/elements/randomize.js). Templates must reuse this
// module instead of touching Math.random() or reimplementing PRNG math, so
// a saved recipe's `seed` reproduces the exact same artwork on every render
// (see docs/plans/PAINT_STUDIO_PLAN.md "Non-negotiable engineering
// constraints").
import { mulberry32, deriveSeed, randomInRange, pick, snapToStep } from '../elements/randomize.js';

// createRand(seed) -> a mulberry32-seeded RNG function. Call it repeatedly to
// draw the next value in [0, 1); the same seed always yields the same
// sequence.
export function createRand(seed) {
  return mulberry32(seed);
}

// deriveTemplateSeed(baseSeed, templateId, purpose) -> a derived uint32 seed
// for an auxiliary stream a template wants (e.g. a palette-jitter or
// stamp-placement pass that should vary independently of the main draw
// order). Thin wrapper over the shared deriveSeed so different
// templateId/purpose pairs never draw from the same PRNG stream even when
// the base seed is identical.
export function deriveTemplateSeed(baseSeed, templateId, purpose) {
  return deriveSeed(baseSeed, templateId, purpose);
}

// Re-exported unchanged so templates only need to import from this one
// Paint-specific module rather than reaching into ../elements/randomize.js
// directly.
export { randomInRange, pick, snapToStep };
