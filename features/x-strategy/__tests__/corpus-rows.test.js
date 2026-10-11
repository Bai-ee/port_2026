import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRowsById, METRIC_FIELDS } from '../corpus-rows.js';
import { mergeRowsById as viaBarrel } from '../index.js';

const row = (id, utc, over = {}) => ({ id, utc, likes: 1, views: null, ...over });

test('barrel re-exports mergeRowsById', () => {
  assert.equal(viaBarrel, mergeRowsById);
});

test('newer metrics win', () => {
  const out = mergeRowsById([row('1', '2026-01-02T00:00:00Z', { likes: 1 })], [row('1', '2026-01-02T00:00:00Z', { likes: 9 })]);
  assert.equal(out.length, 1);
  assert.equal(out[0].likes, 9);
});

test('existing views kept when incoming has none', () => {
  for (const none of [null, undefined]) {
    const out = mergeRowsById([row('1', 'b', { views: 500 })], [row('1', 'b', { views: none })]);
    assert.equal(out[0].views, 500);
  }
});

test('incoming views used when existing has none', () => {
  const out = mergeRowsById([row('1', 'b', { views: null })], [row('1', 'b', { views: 70 })]);
  assert.equal(out[0].views, 70);
});

test('incoming views of 0 are real and win', () => {
  const out = mergeRowsById([row('1', 'b', { views: 500 })], [row('1', 'b', { views: 0 })]);
  assert.equal(out[0].views, 0);
});

test('existing order is stable', () => {
  const ex = [row('c', '2026-03'), row('b', '2026-02'), row('a', '2026-01')];
  const out = mergeRowsById(ex, [row('a', '2026-01', { likes: 5 }), row('c', '2026-03', { likes: 5 })]);
  assert.deepEqual(out.map((r) => r.id), ['c', 'b', 'a']);
});

test('new rows are placed newest-first by utc', () => {
  const ex = [row('c', '2026-03'), row('a', '2026-01')];
  const out = mergeRowsById(ex, [row('old', '2025-12'), row('top', '2026-04'), row('mid', '2026-02')]);
  assert.deepEqual(out.map((r) => r.id), ['top', 'c', 'mid', 'a', 'old']);
});

test('does not mutate inputs', () => {
  const ex = [row('1', 'b', { views: 5 })];
  const inc = [row('1', 'b', { views: null, likes: 3 }), row('2', 'c')];
  const exCopy = structuredClone(ex);
  const incCopy = structuredClone(inc);
  const out = mergeRowsById(ex, inc);
  assert.deepEqual(ex, exCopy);
  assert.deepEqual(inc, incCopy);
  assert.notEqual(out[0], ex[0]);
});

test('duplicates in incoming collapse (last wins)', () => {
  const out = mergeRowsById([], [row('1', 'b', { likes: 1 }), row('1', 'b', { likes: 4 })]);
  assert.equal(out.length, 1);
  assert.equal(out[0].likes, 4);
});

test('empty and non-array inputs', () => {
  assert.deepEqual(mergeRowsById([], []), []);
  assert.deepEqual(mergeRowsById(undefined, null), []);
  const ex = [row('1', 'b')];
  assert.deepEqual(mergeRowsById(ex, []), ex);
  assert.deepEqual(mergeRowsById([], ex), ex);
});

test('rows without an id are skipped, not thrown', () => {
  const out = mergeRowsById([row('1', 'b'), { utc: 'x' }, null], [{ likes: 2 }, undefined, row('2', 'c')]);
  assert.deepEqual(out.map((r) => r.id), ['2', '1']);
});

const full = (id, over = {}) => ({
  id, utc: '2026-01-02T00:00:00Z', type: 'original', lane: 'work', topics: ['old-tag'], text: 'old text',
  url: 'u-old', quotedAuthor: 'someone', likes: 1, reposts: 1, replies: 0, views: 200, engagement: 2, engagementRate: 1, ...over,
});

test('METRIC_FIELDS excludes tags, type, text and urls', () => {
  for (const f of ['topics', 'type', 'lane', 'text', 'url', 'quotedAuthor', 'utc', 'id']) assert.ok(!METRIC_FIELDS.includes(f));
});

test('null/undefined incoming never erases existing fields', () => {
  const inc = { id: '1', utc: 'x', likes: null, reposts: undefined, replies: null, views: null, engagement: null, engagementRate: null, quotedAuthor: null, topics: null };
  const [m] = mergeRowsById([full('1')], [inc]);
  assert.deepEqual(m, full('1'));
});

test('non-metric fields of an existing row are preserved', () => {
  const inc = full('1', { topics: ['new-tag'], type: 'quote', lane: 'x', text: 'new', url: 'u-new', quotedAuthor: 'other', likes: 5 });
  const [m] = mergeRowsById([full('1')], [inc]);
  assert.deepEqual([m.topics, m.type, m.lane, m.text, m.url, m.quotedAuthor], [['old-tag'], 'original', 'work', 'old text', 'u-old', 'someone']);
  assert.equal(m.likes, 5);
});

test('engagementRate is recomputed against the kept views when metrics change', () => {
  const [m] = mergeRowsById([full('1')], [{ id: '1', likes: 9, views: null, engagementRate: null }]);
  assert.equal(m.views, 200);
  assert.equal(m.engagement, 10);
  assert.equal(m.engagementRate, 5);
});

test('engagementRate untouched when nothing changed, or when views unknown', () => {
  const [a] = mergeRowsById([full('1')], [{ id: '1', likes: 1, engagementRate: 0.01 }]);
  assert.equal(a.engagementRate, 1);
  const [b] = mergeRowsById([full('2', { views: null, engagementRate: null })], [{ id: '2', likes: 7 }]);
  assert.equal(b.likes, 7);
  assert.equal(b.engagementRate, null);
});

test('incoming views fill a row that had none and derive the rate', () => {
  const [m] = mergeRowsById([full('1', { views: null, engagementRate: null })], [{ id: '1', views: 400 }]);
  assert.equal(m.views, 400);
  assert.equal(m.engagementRate, 0.5);
});

test('new rows keep their own tags and fields whole', () => {
  const out = mergeRowsById([full('1')], [full('2', { topics: ['fresh'], utc: '2026-02-01T00:00:00Z' })]);
  assert.deepEqual(out.map((r) => r.id), ['2', '1']);
  assert.deepEqual(out[0].topics, ['fresh']);
});
