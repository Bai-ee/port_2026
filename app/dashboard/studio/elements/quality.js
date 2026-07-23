// Quality/budget model — draft/proof/social/ultra tiers, a scene cost
// estimate from enabled element instances' `quality.estimatedCost`, and a
// per-tier geometry-detail multiplier that Phase 2's factories use to scale
// procedural segment counts.

export const QUALITY_TIERS = {
  draft:  { id: 'draft',  label: 'Draft',     maxCost: 40 },
  proof:  { id: 'proof',  label: 'Proof',     maxCost: 70 },
  social: { id: 'social', label: 'Social HD', maxCost: 90 },
  ultra:  { id: 'ultra',  label: 'Ultra 4K',  maxCost: 120 },
};

// The live Studio's ELEMENT PREVIEW quality selector (StudioElementsCard)
// only ever offers these three. Ultra 4K deliberately stays off this list —
// it's a FINAL-RENDER tier tied to the Cloud Run pipeline (art-scene-v2),
// which doesn't exist yet (Phase 6+). Offering it as a live-preview choice
// would imply a capability this build doesn't have; `QUALITY_TIERS.ultra`
// and `TIER_DETAIL.ultra` still exist (factories are tested against it —
// see factories.test.js) so the moment that renderer ships, wiring it in is
// a UI change, not an engine change.
export const LIVE_PREVIEW_TIERS = ['draft', 'proof', 'social'];

// Multiplier applied to a factory's BASE segment/detail count. 1 = full
// detail; draft trims it for a lighter live preview.
export const TIER_DETAIL = {
  draft: 0.6,
  proof: 0.8,
  social: 0.9,
  ultra: 1,
};

export function detailForTier(tierId) {
  return TIER_DETAIL[tierId] ?? TIER_DETAIL.draft;
}

/** Scale `base` by the tier multiplier and clamp to an integer >= `min`. */
export function scaleSegments(base, tierId, min = 3) {
  return Math.max(min, Math.round(base * detailForTier(tierId)));
}

export function estimateSceneCost(instances = []) {
  return instances
    .filter((i) => i && i.enabled)
    .reduce((sum, i) => sum + (Number(i.quality?.estimatedCost) || 0), 0);
}

export function budgetStatus(instances = [], tierId = 'draft') {
  const tier = QUALITY_TIERS[tierId] || QUALITY_TIERS.draft;
  const cost = estimateSceneCost(instances);
  return { cost, max: tier.maxCost, overBudget: cost > tier.maxCost, tierId: tier.id };
}
