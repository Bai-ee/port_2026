import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TRACKS, normalizeContentTracks, tracksOf, trackForEngine, allPromotions, normalizePromotions,
} from '../content-tracks.js';
import { promotionsOf, promotionFor, promotionSelfReply } from '../promotions.js';

const clone = () => JSON.parse(JSON.stringify(DEFAULT_TRACKS));

test('absent contentTracks ⇒ defaults (back-compat)', () => {
  const t = tracksOf({ plan: { authoredPerDay: 4 } });
  assert.deepEqual(t.map((x) => x.id), ['design', 'music']);
  assert.deepEqual(t[1].benchmarks, []);
  assert.equal(tracksOf(null).length, 2);
});

test('invalid stored tracks fall back to defaults', () => {
  assert.equal(tracksOf({ plan: { contentTracks: [{ id: 'x' }] } })[0].id, 'design');
});

test('defaults normalize cleanly and shares sum to 1', () => {
  const t = normalizeContentTracks(clone());
  assert.equal(t.reduce((s, x) => s + x.share, 0), 1);
});

test('shares normalize when they do not sum to 1', () => {
  const t = clone(); t[0].share = 0.3; t[1].share = 0.1;
  const out = normalizeContentTracks(t);
  assert.ok(Math.abs(out[0].share - 0.75) < 1e-9 && Math.abs(out[1].share - 0.25) < 1e-9);
});

test('engines must be disjoint and complete', () => {
  const dup = clone(); dup[1].engines.push('client');
  assert.throws(() => normalizeContentTracks(dup), /both/);
  const miss = clone(); miss[1].engines = ['ue']; miss[1].promotions = miss[1].promotions.filter((p) => p.engine === 'ue');
  assert.throws(() => normalizeContentTracks(miss), /missing: record/);
});

test('benchmark limits and handle cleaning', () => {
  const t = clone(); t[1].benchmarks = ['@A_b', 'a_b', 'c'];
  assert.deepEqual(normalizeContentTracks(t)[1].benchmarks, ['a_b', 'c']);
  t[1].benchmarks = ['a', 'b', 'c', 'd'];
  assert.throws(() => normalizeContentTracks(t), /at most 3/);
  const u = clone(); u[1].benchmarks = ['a', 'b', 'c']; u[0].benchmarks = ['d', 'e', 'f'];
  assert.throws(() => normalizeContentTracks(u, { maxDistinctBenchmarks: 5 }), /distinct/);
  const v = clone(); v[1].benchmarks = ['bad handle!'];
  assert.throws(() => normalizeContentTracks(v), /Bad benchmark/);
});

test('promotion engine must belong to its track; urls https only', () => {
  const t = clone(); t[0].promotions[0].engine = 'ue';
  assert.throws(() => normalizeContentTracks(t), /not in its track/);
  assert.throws(() => normalizePromotions([{ id: 'a', label: 'A', engine: 'ue', url: 'http://x.com' }]), /https/);
  assert.equal(normalizePromotions([{ id: 'a', label: 'A', engine: 'ue', url: '' }])[0].url, null);
});

test('trackForEngine + allPromotions', () => {
  const t = tracksOf(null);
  assert.equal(trackForEngine(t, 'ue').id, 'music');
  assert.equal(trackForEngine(t, 'client').id, 'design');
  assert.equal(trackForEngine(t, 'nope'), null);
  const all = allPromotions(t);
  assert.deepEqual(all.map((p) => p.id), ['client', 'ue', 'discogs']);
  assert.equal(all[1].trackId, 'music');
});

test('promotionFor maps packages to promotions', () => {
  const p = promotionsOf(null);
  assert.equal(promotionFor({ series: 'C4', source: { kind: 'rendered-video' } }, p).id, 'ue');
  assert.equal(promotionFor({ series: 'C4', source: { kind: 'nas' } }, p), null);
  assert.equal(promotionFor({ series: 'C1', source: { kind: 'discogs' } }, p).id, 'discogs');
  assert.equal(promotionFor({ series: 'C6' }, p).id, 'client');
  assert.equal(promotionFor(null, p), null);
});

test('promotionSelfReply: empty without url, label+url with', () => {
  assert.equal(promotionSelfReply({ label: 'X', url: null }), '');
  assert.equal(promotionSelfReply({ label: 'UE', url: 'https://ue.example/' }), 'UE: https://ue.example/');
});

test('promotionsOf reads stored tracks', () => {
  const t = clone(); t[1].promotions[0].url = 'https://ue.example';
  const p = promotionsOf({ plan: { contentTracks: t } });
  assert.equal(p.find((x) => x.id === 'ue').url, 'https://ue.example/');
});
