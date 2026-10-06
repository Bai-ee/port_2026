import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncRenderedVideos, SYNC_THROTTLE_MS } from '../sync.js';

const vid = (id, o = {}) => ({ id, jobId: id, artist: 'ACIDMAN', mixTitle: 'Mix', duration: 100, fileName: `${id}.mp4`, status: 'completed', createdAt: '2026-09-01T00:00:00Z', ...o });

function makeDeps(videos, store = new Map(), meta = {}) {
  const calls = { upsert: [], mediaJobs: [], metaWrites: [] };
  let t = Date.parse('2026-10-06T12:00:00Z');
  const deps = {
    calls, store, meta,
    listVideos: async () => videos,
    listMediaJobs: async (ids) => { calls.mediaJobs.push(ids); return new Map(); },
    readExisting: async (ids) => new Map(ids.filter((i) => store.has(i)).map((i) => [i, structuredClone(store.get(i))])),
    upsert: async (p) => { calls.upsert.push(p); store.set(p.id, structuredClone(p)); },
    readMeta: async () => (deps.meta.lastSyncAt ? deps.meta : null),
    writeMeta: async (m) => { deps.meta = m; calls.metaWrites.push(m); },
    now: () => t,
    advance: (ms) => { t += ms; },
  };
  return deps;
}

test('creates new rv packages with a syncHash', async () => {
  const d = makeDeps([vid('a'), vid('b')]);
  const r = await syncRenderedVideos(d, { force: true });
  assert.deepEqual([r.created, r.updated, r.unchanged, r.total], [2, 0, 0, 2]);
  assert.ok(d.store.get('rv-a').syncHash);
  assert.equal(d.store.get('rv-a').story, '[add your memory]');
  assert.deepEqual(d.calls.mediaJobs[0].sort(), ['a', 'b']);
});

test('second run is all unchanged: no writes, no media_jobs join', async () => {
  const d = makeDeps([vid('a')]);
  await syncRenderedVideos(d, { force: true });
  d.calls.upsert.length = 0; d.calls.mediaJobs.length = 0;
  const r = await syncRenderedVideos(d, { force: true });
  assert.deepEqual([r.created, r.updated, r.unchanged], [0, 0, 1]);
  assert.equal(d.calls.upsert.length, 0);
  assert.equal(d.calls.mediaJobs.length, 0);
});

test('update refreshes machine fields but never owner fields', async () => {
  const d = makeDeps([vid('a')]);
  await syncRenderedVideos(d, { force: true });
  const owner = {
    story: 'My real memory of making this video for the label night, long enough.', humanEdits: { people: ['X'] },
    approval: { state: 'approved', by: 'me' }, status: 'scheduled', lastPostedAt: '2026-09-30T00:00:00Z', postCount: 3,
    bucketId: 'custom', thumbRef: 'content-thumbs/c/rv-a.jpg', tags: [...d.store.get('rv-a').tags, 'my-tag'],
  };
  d.store.set('rv-a', { ...d.store.get('rv-a'), ...owner });
  d.calls.upsert.length = 0;
  d.advance(1);
  const r = await syncRenderedVideos({ ...d, listVideos: async () => [vid('a', { mixTitle: 'Renamed Mix' })] }, { force: true });
  assert.equal(r.updated, 1);
  const out = d.calls.upsert[0];
  assert.match(out.title, /Renamed Mix/);
  for (const [k, v] of Object.entries(owner)) if (k !== 'tags') assert.deepEqual(out[k], v, k);
  assert.ok(out.tags.includes('my-tag'));
});

test('rights refreshed unless set by a human', async () => {
  const d = makeDeps([vid('a', { artist: 'Someone Else' })]);
  await syncRenderedVideos(d, { force: true });
  assert.equal(d.store.get('rv-a').rights, 'never-public');
  d.store.set('rv-a', { ...d.store.get('rv-a'), rights: 'cleared', rightsSetBy: 'human', syncHash: 'stale' });
  await syncRenderedVideos({ ...d, listVideos: async () => [vid('a', { artist: 'Someone Else' })] }, { force: true });
  assert.equal(d.store.get('rv-a').rights, 'cleared');
});

test('stored genres/era survive a sync that has no artists.json', async () => {
  const d = makeDeps([vid('a')]);
  await syncRenderedVideos(d, { force: true });
  d.store.set('rv-a', { ...d.store.get('rv-a'), eraYear: 2009, facets: { ...d.store.get('rv-a').facets, genres: ['acid'] }, syncHash: 'stale' });
  await syncRenderedVideos(d, { force: true });
  assert.equal(d.store.get('rv-a').eraYear, 2009);
  assert.deepEqual(d.store.get('rv-a').facets.genres, ['acid']);
});

test('throttle: <10min skips without force and returns last counts; force overrides', async () => {
  const d = makeDeps([vid('a')]);
  const first = await syncRenderedVideos(d);
  assert.equal(first.created, 1);
  d.advance(SYNC_THROTTLE_MS - 1000);
  let listed = 0;
  const spy = { ...d, listVideos: async () => { listed += 1; return [vid('a')]; } };
  const second = await syncRenderedVideos(spy);
  assert.equal(second.throttled, true);
  assert.equal(second.created, 1);
  assert.equal(second.lastSyncAt, first.lastSyncAt);
  assert.equal(listed, 0);
  const forced = await syncRenderedVideos(spy, { force: true });
  assert.equal(listed, 1);
  assert.equal(forced.unchanged, 1);
  d.advance(SYNC_THROTTLE_MS);
  assert.ok(!(await syncRenderedVideos(spy)).throttled);
});

test('skips non-completed videos', async () => {
  const d = makeDeps([vid('a'), vid('b', { status: 'failed' })]);
  const r = await syncRenderedVideos(d, { force: true });
  assert.equal(r.total, 1);
});
