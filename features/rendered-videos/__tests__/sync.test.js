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
  assert.equal(d.store.get('rv-a').rights, 'cleared');
  d.store.set('rv-a', { ...d.store.get('rv-a'), rights: 'never-public', rightsSetBy: 'human', approval: { state: 'needed' }, syncHash: 'stale' });
  await syncRenderedVideos({ ...d, listVideos: async () => [vid('a', { artist: 'Someone Else' })] }, { force: true });
  assert.equal(d.store.get('rv-a').rights, 'never-public'); // human choice wins
  assert.equal(d.store.get('rv-a').approval.state, 'needed');
});

test('legacy never-public/needed rows migrate to cleared/none on sync; an approved state is kept', async () => {
  const d = makeDeps([vid('a', { artist: 'Someone Else' }), vid('b', { artist: 'Someone Else' })]);
  await syncRenderedVideos(d, { force: true });
  d.store.set('rv-a', { ...d.store.get('rv-a'), rights: 'never-public', approval: { state: 'needed' }, syncHash: 'stale' });
  d.store.set('rv-b', { ...d.store.get('rv-b'), rights: 'never-public', approval: { state: 'approved', by: 'me' }, syncHash: 'stale' });
  await syncRenderedVideos(d, { force: true });
  assert.deepEqual([d.store.get('rv-a').rights, d.store.get('rv-a').approval.state], ['cleared', 'none']);
  assert.equal(d.store.get('rv-a').rightsSource.policy, 'ue-hosted-cleared');
  assert.equal(d.store.get('rv-b').approval.state, 'approved');
});

test('sync twice => same items, no writes second time (accept. 5)', async () => {
  const d = makeDeps([vid('a'), vid('b', { artist: 'Bai-ee' })]);
  await syncRenderedVideos(d, { force: true });
  const snap = JSON.stringify([...d.store.entries()].sort());
  d.calls.upsert.length = 0;
  await syncRenderedVideos(d, { force: true });
  assert.equal(d.calls.upsert.length, 0);
  assert.equal(JSON.stringify([...d.store.entries()].sort()), snap);
});

test('upstream-deleted => retired(source-missing) only after a COMPLETE listing; never deleted; restored on return', async () => {
  const d = makeDeps([vid('a'), vid('b')]);
  await syncRenderedVideos(d, { force: true });
  d.listStored = async () => [...d.store.values()].map((x) => structuredClone(x));
  const only = [vid('a')];
  // bare array and complete:false => completeness unknown => no invalidation
  await syncRenderedVideos({ ...d, listVideos: async () => only }, { force: true });
  await syncRenderedVideos({ ...d, listVideos: async () => ({ videos: only, complete: false }) }, { force: true });
  assert.notEqual(d.store.get('rv-b').status, 'retired');
  // an empty "complete" listing never mass-retires
  await syncRenderedVideos({ ...d, listVideos: async () => ({ videos: [], complete: true }) }, { force: true });
  assert.notEqual(d.store.get('rv-b').status, 'retired');
  const r = await syncRenderedVideos({ ...d, listVideos: async () => ({ videos: only, complete: true }) }, { force: true });
  assert.equal(r.retired, 1);
  assert.equal(d.store.get('rv-b').status, 'retired');
  assert.equal(d.store.get('rv-b').retiredReason, 'source-missing');
  assert.notEqual(d.store.get('rv-a').status, 'retired');
  assert.equal(d.store.has('rv-b'), true);
  // idempotent
  const r2 = await syncRenderedVideos({ ...d, listVideos: async () => ({ videos: only, complete: true }) }, { force: true });
  assert.equal(r2.retired, 0);
  // comes back upstream => restored
  const r3 = await syncRenderedVideos({ ...d, listVideos: async () => ({ videos: [vid('a'), vid('b')], complete: true }) }, { force: true });
  assert.equal(r3.restored, 1);
  assert.equal(d.store.get('rv-b').status, 'idea');
  assert.equal(d.store.get('rv-b').retiredReason, undefined);
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

test('volatile fields (clock, stored key order, write stamps) never count as an update', async () => {
  const d = makeDeps([vid('a'), vid('b', { artist: 'Bai-ee' })]);
  await syncRenderedVideos(d, { force: true });
  // Firestore hands keys back in its own order and the store stamps updatedAt on write.
  for (const [id, p] of d.store) {
    const shuffled = Object.fromEntries(Object.entries(p).reverse());
    shuffled.facets = Object.fromEntries(Object.entries(p.facets || {}).reverse());
    d.store.set(id, { ...shuffled, updatedAt: 123 });
  }
  d.advance(60 * 60 * 1000);
  const r = await syncRenderedVideos(d, { force: true });
  assert.deepEqual([r.created, r.updated, r.unchanged], [0, 0, 2]);
});

test('a hash-shape change (new machine fields) rewrites each row once, then reports unchanged', async () => {
  const d = makeDeps([vid('a'), vid('b')]);
  await syncRenderedVideos(d, { force: true });
  for (const [id, p] of d.store) d.store.set(id, { ...p, syncHash: 'pre-rights-policy' });
  const once = await syncRenderedVideos(d, { force: true });
  assert.deepEqual([once.updated, once.unchanged], [2, 0]);
  const twice = await syncRenderedVideos(d, { force: true });
  assert.deepEqual([twice.updated, twice.unchanged], [0, 2]);
});

test('skips non-completed videos', async () => {
  const d = makeDeps([vid('a'), vid('b', { status: 'failed' })]);
  const r = await syncRenderedVideos(d, { force: true });
  assert.equal(r.total, 1);
});
