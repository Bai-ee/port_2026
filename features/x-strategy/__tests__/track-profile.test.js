import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTrackProfile, loadTrackProfiles, trackEngineMinimums, applyTrackAllocation, hasExplicitTracks,
  newTrackBenchmarkHandles, computeRowMetrics,
} from '../track-profile.js';
import { normalizeContentTracks, tracksOf } from '../content-tracks.js';
import { twoTracks } from './fixtures/two-tracks.js';
import { mergeEngineConfig, DEFAULT_ENGINE_CONFIG } from '../../x-content-inventory/engine-quota.js';
import { deriveTrackWatchlists } from '../../x-benchmark/derive-watchlist.js';

let n = 0;
function row(handle, over = {}) {
  n += 1;
  const id = `${handle}-${n}`;
  return {
    id, utc: '2026-09-01T12:00:00.000Z', dateLocal: `2026-09-${String(1 + (n % 20)).padStart(2, '0')}`, hourLocal: 9 + (n % 3),
    type: 'original-showcase', media: 'video', hasLink: false, topics: [], lanes: [], chars: 100 + n, likes: 10 + (n % 7), reposts: 0, replies: 0,
    views: 1000, conversationId: id, quotedAuthor: null, ...over,
  };
}
const corpus = (handle, count, over = {}) => Array.from({ length: count }, () => row(handle, over));
const tracks = twoTracks;
const withBench = (id, benchmarks) => tracks().map((t) => (t.id === id ? { ...t, benchmarks } : t));

test('acceptance 3: a track profile computes from its own handle only', () => {
  const seb = corpus('seb__design', 20, { media: 'video', chars: 200 });
  const other = corpus('othermusic', 20, { media: 'none', type: 'original-text', chars: 40 });
  const track = withBench('music', ['othermusic']).find((t) => t.id === 'music');
  // seb__design rows are offered but must not be read: the track does not list that handle.
  const p = buildTrackProfile({ track, rowsByHandle: { 'seb__design': seb, othermusic: other } });
  assert.equal(p.status, 'ok');
  assert.equal(p.metrics.rows, 20);
  assert.equal(p.metrics.medianLength, 40);
  assert.deepEqual(Object.keys(p.metrics.formatMix), ['none']);
  assert.deepEqual(p.perHandle.map((h) => h.handle), ['othermusic']);
  assert.ok(p.metrics.topExampleIds.every((id) => id.startsWith('othermusic-')));
});

test('no benchmark => no-benchmark + own-history fallback, never invented numbers', () => {
  const music = tracks().find((t) => t.id === 'music');
  const own = corpus('bai_ee', 12, { media: 'image' });
  const p = buildTrackProfile({ track: music, rowsByHandle: {}, ownRows: own, ownHandle: 'bai_ee' });
  assert.equal(p.status, 'no-benchmark');
  assert.equal(p.fallback, 'own-history');
  assert.equal(p.source, 'own-history');
  assert.equal(p.metrics.rows, 12);
  const empty = buildTrackProfile({ track: music, rowsByHandle: {}, ownRows: [], ownHandle: 'bai_ee' });
  assert.equal(empty.metrics.rows, 0);
  assert.equal(empty.metrics.medianLength, null);
  assert.equal(empty.metrics.formatMix, null);
});

test('own-history fallback filters by track topics when enough rows match', () => {
  const music = { ...tracks().find((t) => t.id === 'music'), topics: ['Music'] };
  const own = [...corpus('bai_ee', 10, { topics: ['music'] }), ...corpus('bai_ee', 5, { topics: ['code'] })];
  const p = buildTrackProfile({ track: music, rowsByHandle: {}, ownRows: own, ownHandle: 'bai_ee' });
  assert.equal(p.scope, 'topic-filtered');
  assert.equal(p.metrics.rows, 10);
  const few = buildTrackProfile({ track: music, rowsByHandle: {}, ownRows: corpus('bai_ee', 3, { topics: ['music'] }), ownHandle: 'bai_ee' });
  assert.equal(few.scope, 'all-own-rows');
});

test('benchmark handle without rows => no-rows with needsRefresh', () => {
  const track = withBench('music', ['ghost']).find((t) => t.id === 'music');
  const p = buildTrackProfile({ track, rowsByHandle: { ghost: [] } });
  assert.equal(p.status, 'no-rows');
  assert.deepEqual(p.needsRefresh, ['ghost']);
  assert.equal(p.metrics.rows, 0);
});

test('link-in-reply rate counts originals whose thread has a linked self-reply; null when no replies exist', () => {
  const originals = corpus('h', 4);
  const reply = row('h', { type: 'reply', hasLink: true, conversationId: originals[0].id });
  const withReplies = computeRowMetrics([...originals, reply]);
  assert.equal(withReplies.linkInReplyRate, 0.25);
  assert.equal(computeRowMetrics(originals).linkInReplyRate, null);
});

test('pooled track keeps a per-handle breakdown (2 handles)', () => {
  const track = withBench('design', ['aa', 'bb']).find((t) => t.id === 'design');
  const p = buildTrackProfile({ track, rowsByHandle: { aa: corpus('aa', 10), bb: corpus('bb', 6) } });
  assert.equal(p.metrics.rows, 16);
  assert.deepEqual(p.perHandle.map((h) => [h.handle, h.rows]), [['aa', 10], ['bb', 6]]);
});

test('loadTrackProfiles reads only needed handles; failing read => needsRefresh not a throw', async () => {
  const reads = [];
  const store = {
    async readRows(h) {
      reads.push(h);
      if (h === 'boom') throw new Error('down');
      return { rows: corpus(h, 9) };
    },
  };
  const list = withBench('design', ['seb__design', 'boom']);
  const out = await loadTrackProfiles({ tracks: list, corpusStore: store, ownHandle: 'bai_ee' });
  assert.deepEqual(reads.sort(), ['bai_ee', 'boom', 'seb__design']); // own read for music's no-benchmark fallback
  assert.equal(out[0].status, 'ok');
  assert.deepEqual(out[0].needsRefresh, ['boom']);
  assert.equal(out[1].status, 'no-benchmark');
});

test('allocation: shares x authored originals raise engine minimums, never lower caps or floors', () => {
  const t = normalizeContentTracks(tracks());
  const base = mergeEngineConfig({});
  const { minimums, byTrack } = trackEngineMinimums({ tracks: t, authoredPerDay: 4, config: base });
  assert.deepEqual(byTrack.map((x) => x.originalsPerDay), [2, 2]);
  const plan = { authoredPerDay: 4, engineTargets: {}, contentTracks: t };
  const cfg = applyTrackAllocation({ plan }, undefined);
  assert.ok(cfg.engines.identity.minPerDay >= 1);
  assert.ok(cfg.engines.record.minPerDay >= 1);
  assert.ok(cfg.engines.ue.weeklyMin >= base.engines.ue.weeklyMin);
  assert.ok(cfg.engines.ue.weeklyMin <= cfg.engines.ue.weeklyMax);
  for (const e of Object.keys(base.engines)) {
    assert.equal(cfg.engines[e].maxPerDay, base.engines[e].maxPerDay);
    assert.equal(cfg.engines[e].weeklyMax ?? null, base.engines[e].weeklyMax ?? null);
    assert.ok((cfg.engines[e].minPerDay ?? 0) >= (base.engines[e].minPerDay ?? 0));
  }
  assert.deepEqual(DEFAULT_ENGINE_CONFIG, mergeEngineConfig({}), 'defaults untouched');
});

test('allocation honours a user-lowered cap (min clamps to the cap)', () => {
  const t = normalizeContentTracks(tracks());
  const plan = { authoredPerDay: 8, engineTargets: { engines: { record: { maxPerDay: 1 } } }, contentTracks: t };
  const cfg = applyTrackAllocation({ plan }, mergeEngineConfig(plan.engineTargets));
  assert.equal(cfg.engines.record.maxPerDay, 1);
  assert.ok(cfg.engines.record.minPerDay <= 1);
});

test('back-compat: a plan with no contentTracks is returned untouched', () => {
  const plan = { authoredPerDay: 4, engineTargets: {} };
  assert.equal(hasExplicitTracks({ plan }), false);
  assert.equal(applyTrackAllocation({ plan }, undefined), undefined);
  const cfg = mergeEngineConfig({ authored: { targetPerDay: 5 } });
  assert.equal(applyTrackAllocation({ plan }, cfg), cfg);
  assert.deepEqual(tracksOf({ plan }), [], 'no inherited default tracks');
});

test('newTrackBenchmarkHandles lists handles added by a change (to queue a refresh)', () => {
  const before = { plan: { contentTracks: tracks() } };
  const after = { plan: { contentTracks: withBench('music', ['newmusic']) } };
  assert.deepEqual(newTrackBenchmarkHandles(before, after), ['newmusic']);
  assert.deepEqual(newTrackBenchmarkHandles({ plan: {} }, after), ['seb__design', 'newmusic'], 'no tracks before => every handle is new');
  assert.deepEqual(newTrackBenchmarkHandles(after, after), []);
});

test('deriveTrackWatchlists tags candidates by track and never merges tracks', () => {
  const q = (author, likes, id) => row('x', { id, type: 'quote-react', quotedAuthor: author, likes, quotedText: 'hello world' });
  const list = withBench('music', ['mm']);
  list[0] = { ...list[0], benchmarks: ['dd'] };
  const out = deriveTrackWatchlists(list, { dd: [q('shared', 50, 'a1')], mm: [q('shared', 30, 'b1'), q('onlymusic', 10, 'b2')] });
  assert.equal(out.perTrack.design.status, 'ok');
  assert.deepEqual(out.accounts.filter((a) => a.track === 'design').map((a) => a.handle), ['shared']);
  assert.deepEqual(out.accounts.filter((a) => a.track === 'music').map((a) => a.handle).sort(), ['onlymusic', 'shared']);
  const none = deriveTrackWatchlists(tracks(), {});
  assert.equal(none.perTrack.music.status, 'no-benchmark');
  assert.equal(none.perTrack.design.status, 'no-rows');
});
