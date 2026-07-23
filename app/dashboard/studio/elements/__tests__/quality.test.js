import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateSceneCost, budgetStatus, QUALITY_TIERS, detailForTier, scaleSegments, LIVE_PREVIEW_TIERS } from '../quality.js';
import { createElementInstance } from '../schema.js';

test('estimateSceneCost: only counts enabled instances', () => {
  const on = createElementInstance('glass-petal-sphere', { id: 'g1', enabled: true });
  const off = createElementInstance('glass-petal-sphere', { id: 'g2', enabled: false });
  assert.equal(estimateSceneCost([on, off]), on.quality.estimatedCost);
  assert.equal(estimateSceneCost([off]), 0);
  assert.equal(estimateSceneCost([]), 0);
});

test('budgetStatus: flags overBudget once cost exceeds the tier max', () => {
  const instances = Array.from({ length: 10 }, (_, i) =>
    createElementInstance('glass-petal-sphere', { id: `g${i}`, enabled: true }));
  const status = budgetStatus(instances, 'draft');
  assert.equal(status.max, QUALITY_TIERS.draft.maxCost);
  assert.ok(status.cost > status.max);
  assert.equal(status.overBudget, true);
});

test('budgetStatus: unknown tier falls back to draft', () => {
  const status = budgetStatus([], 'not-a-tier');
  assert.equal(status.tierId, 'draft');
  assert.equal(status.overBudget, false);
});

test('detailForTier: draft is lower detail than ultra; unknown tier falls back to draft', () => {
  assert.ok(detailForTier('draft') < detailForTier('ultra'));
  assert.equal(detailForTier('ultra'), 1);
  assert.equal(detailForTier('not-a-tier'), detailForTier('draft'));
});

test('scaleSegments: scales by tier and never drops below min', () => {
  assert.equal(scaleSegments(100, 'ultra'), 100);
  assert.equal(scaleSegments(100, 'draft'), 60);
  assert.equal(scaleSegments(1, 'draft', 3), 3); // clamped up to min
});

test('LIVE_PREVIEW_TIERS: excludes ultra — it stays unavailable until the final renderer supports it', () => {
  assert.deepEqual(LIVE_PREVIEW_TIERS, ['draft', 'proof', 'social']);
  assert.ok(!LIVE_PREVIEW_TIERS.includes('ultra'));
  LIVE_PREVIEW_TIERS.forEach((id) => assert.ok(QUALITY_TIERS[id], `${id} should be a real tier`));
});

// ── The exact call ClothStudio.jsx's elementBudget memo makes:
// budgetStatus(renderedElementInstances, elementQualityTier) — this is the
// UI-facing budget calculation (Phase 2 exit-gate item 3). Same instances,
// same cost, but the reported max — and therefore overBudget — must track
// whichever live preview tier is selected, not a hardcoded 'draft'.
test('budgetStatus: Draft/Proof/Social each report their own QUALITY_TIERS max for the identical instance set', () => {
  const instances = Array.from({ length: 5 }, (_, i) =>
    createElementInstance('glass-petal-sphere', { id: `g${i}`, enabled: true }));
  const cost = estimateSceneCost(instances);
  LIVE_PREVIEW_TIERS.forEach((tierId) => {
    const status = budgetStatus(instances, tierId);
    assert.equal(status.tierId, tierId);
    assert.equal(status.max, QUALITY_TIERS[tierId].maxCost, `${tierId} max should be QUALITY_TIERS.${tierId}.maxCost`);
    assert.equal(status.cost, cost, `${tierId} cost should be identical — only the max should vary with tier`);
  });
  // The tiers themselves must actually differ, or this test would pass
  // vacuously even with the old hardcoded-'draft' bug.
  assert.ok(QUALITY_TIERS.draft.maxCost < QUALITY_TIERS.proof.maxCost);
  assert.ok(QUALITY_TIERS.proof.maxCost < QUALITY_TIERS.social.maxCost);
});

test('budgetStatus: the same scene can read overBudget at a lower tier and comfortably under at a higher one', () => {
  // Sized to land strictly between draft's and proof's max — overBudget at
  // draft (40), clear at proof (70) and social (90).
  const instances = Array.from({ length: 9 }, (_, i) =>
    createElementInstance('glass-petal-sphere', { id: `g${i}`, enabled: true })); // cost 6 each = 54
  assert.equal(budgetStatus(instances, 'draft').overBudget, true);
  assert.equal(budgetStatus(instances, 'proof').overBudget, false);
  assert.equal(budgetStatus(instances, 'social').overBudget, false);
});
