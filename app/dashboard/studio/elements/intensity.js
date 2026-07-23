// Randomization intensity tiers — docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-PLAN.md
// "Seeded randomization system" § Intensity. Four creative ranges shared by
// every randomize action (Look, Selected element, All elements) so "Refine"
// means the same thing everywhere: a small, current-value-centered nudge,
// not a fresh full-range roll.
//
// 'remix' is the pre-existing default behavior this whole randomize system
// shipped with before intensity tiers existed (a flat full-range reroll for
// numeric fields, a flat pick() for categorical ones) — kept BYTE-IDENTICAL
// so every already-approved randomize call site that doesn't opt into a
// tier is unaffected; 'remix' is not a new behavior, it's the old one named.

export const INTENSITY_TIERS = ['refine', 'remix', 'transform', 'wild'];

export const INTENSITY_META = {
  refine: { label: 'Refine', description: 'Subtle changes, preserves composition.' },
  remix: { label: 'Remix', description: 'Noticeable materials/lighting/motion changes.' },
  transform: { label: 'Transform', description: 'New set arrangement using the same chosen elements.' },
  wild: { label: 'Wild, still valid', description: 'Maximum change while respecting safe zones, cost budget, and renderer limits.' },
};

export const DEFAULT_INTENSITY = 'remix';

export function isValidIntensity(tier) {
  return INTENSITY_TIERS.includes(tier);
}

// How far a NUMERIC field may move from its CURRENT value, as a fraction of
// the field's full declared range width — only meaningful for 'refine'
// (every other tier draws a fresh value, not a nudge; see isNudge below).
const REFINE_SPREAD_FRACTION = 0.08;

// Refine only ever nudges near the current value ("preserves composition");
// every other tier draws a fresh value from the full declared range —
// 'remix'/'transform' flat, 'wild' biased toward the extremes.
export function isNudge(tier) {
  return tier === 'refine';
}

export function biasesTowardExtremes(tier) {
  return tier === 'wild';
}

// Whether a CATEGORICAL field (a palette/list pick) must land on a value
// DIFFERENT from its current one, when the list has more than one option.
// Refine/Remix may coincidentally keep the current value — a real roll, not
// artificially excluded. Transform/Wild always move it: "a new set
// arrangement" and "maximum change" both imply the picked option changes.
export function forcesCategoricalChange(tier) {
  return tier === 'transform' || tier === 'wild';
}

/**
 * Roll a single numeric field. `rand` is a mulberry32 stream, `current` the
 * field's live value, `range` its declared `[min, max]`. Always clamped to
 * `range` regardless of tier — "Wild, still valid" per the plan: maximum
 * change, never outside the guardrailed bound.
 */
export function rollNumeric(rand, current, range, tier = DEFAULT_INTENSITY) {
  const [min, max] = range;
  const width = max - min;
  if (isNudge(tier)) {
    const base = typeof current === 'number' && Number.isFinite(current) ? current : min + rand() * width;
    const spread = REFINE_SPREAD_FRACTION * width;
    return Math.min(max, Math.max(min, base + (rand() * 2 - 1) * spread));
  }
  if (biasesTowardExtremes(tier)) {
    // Push a uniform (0,1) sample toward 0 or 1 (a symmetric power curve)
    // rather than a flat draw, so 'wild' visibly favors the range's edges.
    const u = rand();
    const biased = u < 0.5 ? 0.5 * (2 * u) ** 2.2 : 1 - 0.5 * (2 * (1 - u)) ** 2.2;
    return min + biased * width;
  }
  return min + rand() * width; // 'remix' / 'transform' — flat full-range reroll
}

/** Roll a single categorical (palette/list) field. */
export function rollCategorical(rand, current, list, tier = DEFAULT_INTENSITY) {
  if (!Array.isArray(list) || !list.length) return current;
  if (!forcesCategoricalChange(tier) || list.length < 2) {
    return list[Math.floor(rand() * list.length)];
  }
  const others = list.filter((v) => v !== current);
  const pool = others.length ? others : list;
  return pool[Math.floor(rand() * pool.length)];
}
