import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../contracts.js';
import * as barrel from '../index.js';
import { DEFAULT_ENGINE_CONFIG } from '../../x-content-inventory/engine-quota.js';
import { TIERS, resolveTier } from '../../x-benchmark/profile.js';
import { DEFAULT_TYPE_FLOORS, STRATEGY_PRIORITY } from '../../x-content-inventory/daily-loop/slots.js';

test('DEFAULT_PLAN derives from engine config, tiers, and S6 floors', () => {
  assert.equal(C.DEFAULT_PLAN.authoredPerDay, DEFAULT_ENGINE_CONFIG.authored.targetPerDay);
  assert.equal(C.DEFAULT_PLAN.tier, 1);
  assert.equal(TIERS[C.DEFAULT_PLAN.tier].authoredPerDay, C.DEFAULT_PLAN.authoredPerDay);
  assert.deepEqual({ ...C.DEFAULT_PLAN.typeFloors }, { ...DEFAULT_TYPE_FLOORS });
  assert.deepEqual({ ...C.DEFAULT_PLAN.typeCaps }, {});
  assert.deepEqual({ ...C.DEFAULT_PLAN.engineTargets }, {});
  assert.equal(C.DEFAULT_PLAN.benchmarkPrimary, 'seb__design');
  assert.equal(C.DEFAULT_PLAN.notes, '');
});

test('tierForAuthoredPerDay matches TIERS and is consistent with resolveTier next-step', () => {
  for (const [k, v] of Object.entries(TIERS)) {
    assert.equal(C.tierForAuthoredPerDay(v.authoredPerDay), Number(k));
    assert.equal(C.tierForAuthoredPerDay(v.authoredPerDay + 1), Number(k));
  }
  assert.equal(C.tierForAuthoredPerDay(1), 1);
  assert.equal(C.tierForAuthoredPerDay(7), 1);
  assert.equal(C.tierForAuthoredPerDay(8), 2);
  assert.equal(C.tierForAuthoredPerDay(16), 4);
  assert.equal(resolveTier({ currentAuthoredPerDay: 4 }).tier, 2); // recommendation, not placement
});

test('limits cover every tier', () => {
  const perDay = Object.values(TIERS).map((t) => t.authoredPerDay);
  assert.equal(C.PLAN_LIMITS.authoredPerDayMin, 1);
  assert.equal(C.PLAN_LIMITS.authoredPerDayMax, Math.max(...perDay));
  assert.equal(C.PLAN_LIMITS.historyCap, 30);
  assert.equal(C.PLAN_LIMITS.maxBenchmarkHandles, 8);
  assert.equal(C.PLAN_LIMITS.maxHandlesPerRefreshRequest, 6);
  assert.ok(C.isValidAuthoredPerDay(4) && !C.isValidAuthoredPerDay(0) && !C.isValidAuthoredPerDay(17) && !C.isValidAuthoredPerDay(2.5));
});

test('slot types come from slots.js and include the default floors', () => {
  assert.deepEqual([...C.KNOWN_SLOT_TYPES], Object.keys(STRATEGY_PRIORITY));
  for (const t of Object.keys(C.DEFAULT_PLAN.typeFloors)) assert.ok(C.isKnownSlotType(t));
  assert.equal(C.isKnownSlotType('bogus'), false);
});

test('proposal kinds, statuses, actions, collections', () => {
  assert.equal(C.PROPOSAL_KINDS.length, 8);
  assert.equal(new Set(C.PROPOSAL_KINDS).size, 8);
  assert.deepEqual(Object.keys(C.PROPOSAL_KIND_ACTIONS).sort(), [...C.PROPOSAL_KINDS].sort());
  assert.deepEqual([...C.PROPOSAL_STATUSES], ['pending', 'deciding', 'confirmed', 'rejected', 'failed']);
  assert.equal(C.ROUTE_ACTIONS.length, 10);
  assert.equal(new Set(C.ROUTE_ACTIONS).size, 10);
  for (const a of C.ROUTE_ACTIONS) assert.match(a, /^strategy-/);
  assert.equal(C.PROPOSAL_KIND_ACTIONS['plan-change'], 'strategy-plan-apply');
  assert.equal(C.PROPOSAL_KIND_ACTIONS['refresh-handles'], 'strategy-refresh');
  assert.deepEqual(Object.values(C.STRATEGY_COLLECTIONS).sort(),
    ['x_corpora', 'x_strategy_chats', 'x_strategy_plans', 'x_strategy_refresh_requests']);
  assert.deepEqual(Object.values(C.EVALUATION_CAVEAT), ['likes-only', 'few-rows', 'stale']);
  assert.deepEqual({ ...C.EVALUATION_THRESHOLDS }, { viewsCoverageMin: 0.5, minRows: 60, staleDays: 7 });
});

test('barrel keeps S6 exports and adds contracts', () => {
  assert.equal(typeof barrel.mergeRowsById, 'function');
  assert.equal(barrel.DEFAULT_PLAN, C.DEFAULT_PLAN);
  assert.equal(barrel.ROUTE_ACTIONS, C.ROUTE_ACTIONS);
});
