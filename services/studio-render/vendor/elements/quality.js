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

// Transmission/shadow cost surcharge — docs/plans/STUDIO-ROADMAP-NEXT-PHASE-
// SONNET-HANDOFF.md Slice 1 guardrail "transmission/shadow/render-budget
// caps". Additive-only: `estimateSceneCost`/`budgetStatus` above are
// untouched (byte-identical), so no existing scene's overBudget verdict
// changes — this is a separate, opt-in detail surface a caller can show
// alongside the existing budget bar.
//
// Transmission is real today: several catalog types' live factories build a
// THREE.MeshPhysicalMaterial with `transmission` set (elements/factories.js)
// — physically-based transmission is one of three.js's most expensive
// material features, so those types cost more than their flat
// `estimatedCost` alone implies. Shadow-casting is NOT implemented anywhere
// in this Studio yet (no factory sets `castShadow`/`receiveShadow`), so
// `shadowSurchargeFor` is a documented no-op (always 0) — kept as its own
// function so wiring in a real per-type flag later is additive, not a
// signature change.
const TRANSMISSIVE_CATEGORIES = ['glass'];
const TRANSMISSION_SURCHARGE = 2;

export function transmissionSurchargeFor(instance, definition) {
  if (!instance?.enabled) return 0;
  return TRANSMISSIVE_CATEGORIES.includes(definition?.category) ? TRANSMISSION_SURCHARGE : 0;
}

export function shadowSurchargeFor() {
  return 0;
}

/** Same enabled-only accounting as estimateSceneCost, broken out by source. `definitions` is a `{ [type]: catalogEntry }` map — callers already have this (elements/catalog.js getElementDefinition per instance.type). */
export function estimateSceneCostDetailed(instances = [], definitions = {}) {
  let base = 0;
  let transmission = 0;
  let shadow = 0;
  (instances || []).forEach((i) => {
    if (!i || !i.enabled) return;
    const def = definitions[i.type];
    base += Number(i.quality?.estimatedCost) || 0;
    transmission += transmissionSurchargeFor(i, def);
    shadow += shadowSurchargeFor(i, def);
  });
  return { base, transmission, shadow, total: base + transmission + shadow };
}

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
