import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeXGrowthProfile,
  resolveXGrowthProfile,
  resolveTier,
  DEFAULT_X_GROWTH_PROFILE,
  MAX_BENCHMARK_HANDLES,
  TIERS,
} from '../profile.js';

test('defaults are off and approval-gated', () => {
  const p = normalizeXGrowthProfile(undefined, null);
  assert.equal(p.enabled, false);
  assert.equal(p.mode, 'approval', 'a new client must never start on auto-publish');
  assert.deepEqual(p.benchmarkHandles, []);
});

test('handles are stored bare, however they were typed', () => {
  const p = normalizeXGrowthProfile({
    ownHandle: '@Bai_ee',
    benchmarkHandles: 'https://x.com/seb__design, @rare_jpg\ninteriorsuckerr',
  });
  assert.equal(p.ownHandle, 'Bai_ee');
  assert.deepEqual(p.benchmarkHandles, ['seb__design', 'rare_jpg', 'interiorsuckerr']);
});

test('benchmark handles are deduped and capped', () => {
  const p = normalizeXGrowthProfile({
    benchmarkHandles: ['a', '@a', 'b', 'c', 'd', 'e', 'f', 'g'],
  });
  assert.equal(p.benchmarkHandles.length, MAX_BENCHMARK_HANDLES);
  assert.deepEqual(p.benchmarkHandles.slice(0, 3), ['a', 'b', 'c']);
});

test('an omitted field preserves what was stored, an empty one clears it', () => {
  const prior = { ...DEFAULT_X_GROWTH_PROFILE, ownHandle: 'bai_ee', benchmarkHandles: ['seb__design'], enabled: true };
  const untouched = normalizeXGrowthProfile({ enabled: true }, prior);
  assert.deepEqual(untouched.benchmarkHandles, ['seb__design'], 'a partial save must not wipe a setting the form did not render');
  const cleared = normalizeXGrowthProfile({ benchmarkHandles: [] }, prior);
  assert.deepEqual(cleared.benchmarkHandles, []);
});

test('an unknown mode falls back rather than being stored', () => {
  const p = normalizeXGrowthProfile({ mode: 'yolo' }, { ...DEFAULT_X_GROWTH_PROFILE, mode: 'off' });
  assert.equal(p.mode, 'off');
});

test('an out-of-range tier override is dropped, not clamped', () => {
  // Clamping would silently pin a client to a tier they never chose.
  assert.equal(normalizeXGrowthProfile({ tierOverride: 9 }).tierOverride, null);
  assert.equal(normalizeXGrowthProfile({ tierOverride: 2 }).tierOverride, 2);
});

test('never throws on junk', () => {
  for (const input of [null, 'x', 42, [], { benchmarkHandles: 7, lanes: {} }]) {
    const p = normalizeXGrowthProfile(input, null);
    assert.ok(Array.isArray(p.benchmarkHandles));
    assert.ok(Array.isArray(p.lanes));
  }
});

test('the connected X account fills in a missing handle', () => {
  const r = resolveXGrowthProfile({
    config: { benchmarkHandles: ['seb__design'] },
    socialAccount: { username: '@bai_ee' },
  });
  assert.equal(r.ownHandle, 'bai_ee');
  assert.equal(r.handleSource, 'connected-account');
  assert.equal(r.ready, true);
});

test('an explicit handle wins over the connected account', () => {
  // They can be different identities — the connected account is not
  // necessarily the one being grown.
  const r = resolveXGrowthProfile({
    config: { ownHandle: 'studio_main', benchmarkHandles: ['seb__design'] },
    socialAccount: { username: 'personal_alt' },
  });
  assert.equal(r.ownHandle, 'studio_main');
  assert.equal(r.handleSource, 'config');
});

test('a profile with no benchmark is not ready, and says what is missing', () => {
  const r = resolveXGrowthProfile({ config: { ownHandle: 'bai_ee' } });
  assert.equal(r.ready, false);
  assert.deepEqual(r.missing, ['benchmarkHandles']);
});

test('lanes fall back to the Client Brain when unset', () => {
  const r = resolveXGrowthProfile({
    config: { ownHandle: 'x', benchmarkHandles: ['y'] },
    clientBrain: { lanes: ['design engineering', 'music'] },
  });
  assert.deepEqual(r.lanes, ['design engineering', 'music']);
});

test('a pinned tier always wins', () => {
  const t = resolveTier({ tierOverride: 1, currentAuthoredPerDay: 12 });
  assert.equal(t.tier, 1);
  assert.equal(t.source, 'pinned');
});

test('the recommended tier is the next step up, not the benchmark in one jump', () => {
  // The measured failure mode is spiking for a week and stopping. A tier that
  // is held beats a tier that is spiked.
  const t = resolveTier({ currentAuthoredPerDay: 1.38 });
  assert.equal(t.tier, 1);
  assert.equal(t.authoredPerDay, TIERS[1].authoredPerDay);
  const t2 = resolveTier({ currentAuthoredPerDay: 5 });
  assert.equal(t2.tier, 2);
});

test('an account with no history starts at tier 1', () => {
  assert.equal(resolveTier({}).tier, 1);
  assert.equal(resolveTier({ currentAuthoredPerDay: 0 }).source, 'default');
});
