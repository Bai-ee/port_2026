import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReviewRequest, ownedReviewPackages, publicizeReviewResult } from '../public-review.js';

test('list clamps days to 1-90 and defaults to 10', () => {
  assert.equal(parseReviewRequest({ action: 'list' }).days, 10);
  assert.equal(parseReviewRequest({ action: 'list', days: 0 }).days, 1);
  assert.equal(parseReviewRequest({ action: 'list', days: 999 }).days, 90);
  assert.equal(parseReviewRequest({ action: 'list', days: 'x' }).days, 10);
});

test('set accepts only rv- ids and known states', () => {
  assert.deepEqual(parseReviewRequest({ action: 'set', id: 'rv-abc_1', state: 'approved' }), { action: 'set', id: 'rv-abc_1', state: 'approved' });
  for (const id of ['pkg-1', 'rv-', 'rv-a/b', 'rv-a b', `rv-${'a'.repeat(121)}`, '', null, 5]) {
    assert.throws(() => parseReviewRequest({ action: 'set', id, state: 'approved' }), /rv-/, String(id));
  }
  assert.throws(() => parseReviewRequest({ action: 'set', id: 'rv-1', state: 'nope' }), /state/);
});

test('media validates ids, cap and kinds', () => {
  assert.deepEqual(parseReviewRequest({ action: 'media', ids: ['rv-1', 'rv-1', 'rv-2'] }), { action: 'media', ids: ['rv-1', 'rv-2'], kinds: ['thumb'] });
  assert.throws(() => parseReviewRequest({ action: 'media', ids: ['rv-1', 'pkg-2'] }), /rv-/);
  assert.throws(() => parseReviewRequest({ action: 'media', ids: [] }), /required/);
  assert.throws(() => parseReviewRequest({ action: 'media', ids: Array.from({ length: 61 }, (_, i) => `rv-${i}`) }), /At most/);
  assert.throws(() => parseReviewRequest({ action: 'media', ids: ['rv-1'], kinds: ['poster'] }), /kinds/);
});

test('unknown actions are rejected', () => {
  assert.throws(() => parseReviewRequest({ action: 'delete' }), /Unknown/);
  assert.throws(() => parseReviewRequest(null), /Unknown/);
});

test('ownedReviewPackages keeps only rv- packages of the media owner', () => {
  const stored = [{ id: 'rv-1', clientId: 'owner' }, { id: 'rv-2', clientId: 'other' }, { id: 'pkg-3', clientId: 'owner' }];
  assert.deepEqual(ownedReviewPackages(stored, 'owner').map((p) => p.id), ['rv-1']);
  assert.deepEqual(ownedReviewPackages(new Map(stored.map((p) => [p.id, p])), 'owner').map((p) => p.id), ['rv-1']);
  assert.deepEqual(ownedReviewPackages(stored, null), []);
});

test('publicizeReviewResult drops curation.by from list items and set results', () => {
  const list = publicizeReviewResult({ ok: true, items: [{ id: 'rv-1', curation: { state: 'approved', at: 't', by: 'a@b.c' } }, { id: 'rv-2', curation: null }], counts: {} });
  assert.deepEqual(list.items[0].curation, { state: 'approved', at: 't' });
  assert.equal(list.items[1].curation, null);
  assert.deepEqual(publicizeReviewResult({ ok: true, id: 'rv-1', curation: { state: 'rejected', at: 't', by: 'x' } }).curation, { state: 'rejected', at: 't' });
  assert.equal(publicizeReviewResult({ ok: true, id: 'rv-1', curation: null }).curation, null);
  assert.equal(JSON.stringify(list).includes('a@b.c'), false);
});
