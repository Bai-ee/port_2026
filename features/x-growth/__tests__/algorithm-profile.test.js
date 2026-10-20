import test from 'node:test';
import assert from 'node:assert/strict';
import { getAlgorithmProfile, getActiveProfileId } from '../algorithm-profile.js';

test('x-2026-10-17 is the active profile and carries the 10-17 upstream weights', () => {
  assert.equal(getActiveProfileId(), 'x-2026-10-17');
  const p = getAlgorithmProfile();
  assert.equal(p.id, 'x-2026-10-17');
  assert.equal(p.supersedes, 'x-2026-10-03');
  assert.equal(p.upstream.commit, '862a1235');
  assert.equal(p.rankingWeights.positive.favorite, 0.66);
  assert.equal(p.rankingWeights.negative.not_interested, -52.272);
  const byId = (list, id) => list.find((x) => x.id === id).weight;
  assert.equal(byId(p.predictedActions.positive, 'favorite'), 0.66);
  assert.equal(byId(p.predictedActions.negative, 'not_interested'), -52.272);
});

test('everything else in x-2026-10-17 equals x-2026-10-03 (only favorite and not_interested moved)', () => {
  const next = getAlgorithmProfile('x-2026-10-17').rankingWeights;
  const prev = getAlgorithmProfile('x-2026-10-03').rankingWeights;
  const { favorite: _f, ...nextPos } = next.positive;
  const { favorite: _p, ...prevPos } = prev.positive;
  assert.deepEqual(nextPos, prevPos);
  const { not_interested: _n, ...nextNeg } = next.negative;
  const { not_interested: _o, ...prevNeg } = prev.negative;
  assert.deepEqual(nextNeg, prevNeg);
  assert.deepEqual(next.multipliers, prev.multipliers);
  assert.deepEqual(next.coldStart, prev.coldStart);
  assert.deepEqual(next.video, prev.video);
  assert.deepEqual(next.boosts, prev.boosts);
});
