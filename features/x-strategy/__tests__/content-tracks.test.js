import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TRACKS, normalizeContentTracks, tracksOf, trackForEngine, allPromotions, normalizePromotions, parseListId, MAX_LISTS_PER_TRACK, MAX_DISTINCT_LISTS,
} from '../content-tracks.js';
import { promotionsOf, promotionFor, promotionSelfReply } from '../promotions.js';
import { twoTracks, twoTrackPlan } from './fixtures/two-tracks.js';

const clone = twoTracks;

test('no code-default tracks: absent contentTracks ⇒ [] (no inherited priors)', () => {
  assert.deepEqual([...DEFAULT_TRACKS], []);
  assert.deepEqual(tracksOf({ plan: { authoredPerDay: 4 } }), []);
  assert.deepEqual(tracksOf(null), []);
  assert.deepEqual(promotionsOf(null), []);
});

test('invalid stored tracks ⇒ [] (never someone else\'s tracks)', () => {
  assert.deepEqual(tracksOf({ plan: { contentTracks: [{ id: 'x' }] } }), []);
});

test('an empty track list is valid and stays empty', () => {
  assert.deepEqual(normalizeContentTracks([]), []);
  assert.deepEqual(tracksOf({ plan: { contentTracks: [] } }), []);
  assert.throws(() => normalizeContentTracks(null), /must be an array/);
});

test('a two-track list normalizes cleanly and shares sum to 1', () => {
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
  assert.equal(trackForEngine([], 'ue'), null);
  assert.deepEqual(allPromotions([]), []);
  const t = tracksOf(twoTrackPlan());
  assert.equal(trackForEngine(t, 'ue').id, 'music');
  assert.equal(trackForEngine(t, 'client').id, 'design');
  assert.equal(trackForEngine(t, 'nope'), null);
  const all = allPromotions(t);
  assert.deepEqual(all.map((p) => p.id), ['client', 'ue', 'discogs']);
  assert.equal(all[1].trackId, 'music');
});

test('promotionFor maps packages to promotions', () => {
  assert.equal(promotionFor({ series: 'C6' }, promotionsOf(null)), null);
  const p = promotionsOf(twoTrackPlan());
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

test('parseListId: URL, bare digits, trailing slash/query; garbage => null', () => {
  assert.equal(parseListId('https://x.com/i/lists/1299069903333285888'), '1299069903333285888');
  assert.equal(parseListId('https://twitter.com/i/lists/123/'), '123');
  assert.equal(parseListId('https://x.com/i/lists/123?s=20'), '123');
  assert.equal(parseListId(' 456 '), '456');
  for (const v of ['', null, undefined, 'abc', 'https://x.com/someone', '12a', '1'.repeat(26), 'https://x.com/i/lists/']) assert.equal(parseListId(v), null);
});

test('lists: absent => [] and everything else unchanged', () => {
  const out = normalizeContentTracks(clone());
  assert.ok(out.every((t) => Array.isArray(t.lists) && t.lists.length === 0));
});

test('lists: URL -> id, dedupe, label sanitize/default/trim', () => {
  const t = clone();
  t[0].lists = [
    { id: 'https://x.com/i/lists/111', label: '  A|B;C,D=E\nF ' },
    { id: '111', label: 'dup' },
    { id: '222', label: '' },
  ];
  const out = normalizeContentTracks(t);
  assert.deepEqual(out[0].lists, [{ id: '111', label: 'A B C D E F' }, { id: '222', label: 'List 222' }]);
  t[0].lists = [{ id: '444', label: 'x'.repeat(80) }];
  assert.equal(normalizeContentTracks(t)[0].lists[0].label.length, 40);
});

test('lists: caps and bad ids throw 400', () => {
  const mk = (lists, i = 0) => { const t = clone(); t[i].lists = lists; return t; };
  const status = (fn) => assert.throws(fn, (e) => e.status === 400);
  assert.equal(MAX_LISTS_PER_TRACK, 3);
  assert.equal(MAX_DISTINCT_LISTS, 8);
  status(() => normalizeContentTracks(mk([{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }])));
  status(() => normalizeContentTracks(mk([{ id: 'nope' }])));
  status(() => normalizeContentTracks(mk([{ id: '' }])));
  const t = clone();
  t[0].lists = [1, 2, 3].map((id) => ({ id: String(id) }));
  t[1].lists = [4, 5, 6].map((id) => ({ id: String(id) }));
  normalizeContentTracks(t);
  const t3 = [...t, { id: 'extra', label: 'Extra', engines: [], benchmarks: [], share: 0.1, promotions: [], topics: [], lists: [{ id: '7' }, { id: '8' }, { id: '9' }] }];
  status(() => normalizeContentTracks(t3));
});
