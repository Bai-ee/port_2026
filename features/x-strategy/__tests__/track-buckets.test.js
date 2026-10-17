// Content tracks <-> Content Center buckets: the track contract, which track a library item belongs to, the daily
// loop's track tag, the bucket -> track sync (bucket-tracks.js), the agent's per-track library summary and the Brain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeContentTracks, trackForPackage, trackForEngine, bucketOfPackage, tracksOf } from '../content-tracks.js';
import { bucketTracks, syncBucketTracks } from '../bucket-tracks.js';
import { summarizeTrackLibrary } from '../route-handlers.js';
import { selectForSlots } from '../../x-content-inventory/daily-loop/select.js';
import { createMemoryPlanStore } from '../plan-store.js';
import { ENGINE_IDS } from '../../x-content-inventory/engines.js';

const sync = await import('../../client-brain/brain-sync.cjs');

// The home client's shape: three tracks, NAS throwback items carry engine `record` but sit in bucket `nas`.
const threeTracks = () => [
  { id: 'design', label: 'Design & client work', engines: ['client', 'identity'], buckets: ['client', 'identity'], benchmarks: [], share: 0.6, topics: [], promotions: [] },
  { id: 'music', label: 'Record Collection & Dj Mix Videos', engines: ['ue', 'record'], buckets: ['ue', 'record'], benchmarks: [], share: 0.2, topics: [], promotions: [] },
  { id: 'throwback', label: 'Throwback Content', engines: [], buckets: ['nas'], benchmarks: [], share: 0.2, topics: [], promotions: [] },
];
const BUCKETS = [
  { id: 'client', name: 'Video Editing' }, { id: 'identity', name: 'Graphic Design' }, { id: 'nas', name: 'Throwback Content' },
  { id: 'record', name: 'Record Collection Videos' }, { id: 'ue', name: 'Dj Mix Videos' },
];

test('contract: buckets normalized (lowercase, deduped), [] when absent, one track per bucket, bad ids refused', () => {
  const tracks = normalizeContentTracks(threeTracks().map((t, i) => (i === 0 ? { ...t, buckets: ['Client', 'client', 'identity'] } : t)));
  assert.deepEqual(tracks.map((t) => t.buckets), [['client', 'identity'], ['ue', 'record'], ['nas']]);
  const noBuckets = normalizeContentTracks(threeTracks().map(({ buckets, ...t }) => t));
  assert.deepEqual(noBuckets.map((t) => t.buckets), [[], [], []]);
  assert.throws(() => normalizeContentTracks(threeTracks().map((t) => (t.id === 'throwback' ? { ...t, buckets: ['ue'] } : t))), /Bucket ue is in both music and throwback/);
  assert.throws(() => normalizeContentTracks(threeTracks().map((t) => (t.id === 'throwback' ? { ...t, buckets: ['Not An Id!'] } : t))), /bad bucket id/);
});

test('trackForPackage: bucket wins over engine; unlisted bucket falls back to the engine owner', () => {
  const tracks = normalizeContentTracks(threeTracks());
  const nasItem = { id: 'nas-1', engine: 'record', bucketId: 'nas' };
  const recordItem = { id: 'disc-1', engine: 'record' }; // no bucketId => bucket = its engine id
  assert.equal(bucketOfPackage(nasItem), 'nas');
  assert.equal(bucketOfPackage(recordItem), 'record');
  assert.equal(trackForPackage(tracks, nasItem).id, 'throwback');
  assert.equal(trackForPackage(tracks, recordItem).id, 'music');
  assert.equal(trackForPackage(tracks, { engine: 'ue', bucketId: 'some-new-bucket' }).id, 'music');
  // A plan with no buckets behaves exactly like the engine lookup.
  const plain = normalizeContentTracks(threeTracks().map((t) => ({ ...t, buckets: [] })));
  assert.equal(trackForPackage(plain, nasItem)?.id, trackForEngine(plain, 'record')?.id);
});

test('daily loop: a NAS item (engine record, bucket nas) is tagged with the throwback track', () => {
  const pkg = {
    id: 'nas-9', title: 'Warehouse 1996 flyer wall', series: 'C3', engine: 'record', bucketId: 'nas', mediaState: 'video', rights: 'owned',
    story: 'Filmed the flyer wall at the warehouse in 1996 before the venue closed, every party we threw is on it.',
    source: { kind: 'nas-archive' }, assetRefs: ['ev:nas/flyers.mp4'], status: 'ready', platforms: ['x'],
  };
  const slot = { letter: 'A', type: 'original-showcase', lane: null, pillar: null, timeCT: null, startsAt: null, manual: false };
  const { suggestions } = selectForSlots({
    clientId: 'c1', localDate: '2026-10-16', now: Date.parse('2026-10-16T15:00:00Z'), packages: [pkg], slots: [slot],
    matchedSlots: [{ slot: 'A', packageId: pkg.id }], contentTracks: normalizeContentTracks(threeTracks()),
  });
  assert.equal(suggestions[0].track, 'throwback');
});

// Home's live plan before the switch (2026-10-16): three grouped tracks, no buckets.
const homeGrouped = () => [
  { id: 'design', label: 'Design & client work', engines: ['client', 'identity'], benchmarks: ['seb__design', '0xcharlota'], lists: [], share: 0.6,
    promotions: [{ id: 'client', label: 'Client work', engine: 'client', url: 'https://hitloop.agency/', weeklyTarget: 2 }], topics: ['client work', 'tools'] },
  { id: 'music', label: 'Music', engines: ['ue'], benchmarks: ['piedpipergb'], lists: [], share: 0.2,
    promotions: [{ id: 'ue', label: 'Underground Existence', engine: 'ue', url: 'https://www.undergroundexistence.info/', weeklyTarget: 3 }], topics: ['DJ mixes'] },
  { id: 'throwback-events', label: 'Throwback events', engines: ['record'], benchmarks: ['dorksirjur'], lists: [], share: 0.2,
    promotions: [{ id: 'discogs', label: 'Discogs store', engine: 'record', url: 'https://www.discogs.com/', weeklyTarget: 3 }], topics: ['flyers'] },
];
const HOME_BUCKETS = [ // listBuckets() order
  { id: 'record', name: 'Record Collection Videos', active: true }, { id: 'ue', name: 'Dj Mix Videos', active: true },
  { id: 'client', name: 'Video Editing', active: true }, { id: 'identity', name: 'Graphic Design', active: true },
  { id: 'nas', name: 'Throwback Content', active: true },
];
const byId = (tracks) => Object.fromEntries(tracks.map((t) => [t.id, t]));

test('bucketTracks: home migrates to one track per bucket, inheriting settings and splitting shares', () => {
  const tracks = normalizeContentTracks(bucketTracks(homeGrouped(), HOME_BUCKETS, { engineHints: { nas: 'record' } }));
  assert.deepEqual(tracks.map((t) => [t.id, t.label, t.engines, t.buckets]), [
    ['record', 'Record Collection Videos', ['record'], ['record']], ['ue', 'Dj Mix Videos', ['ue'], ['ue']],
    ['client', 'Video Editing', ['client'], ['client']], ['identity', 'Graphic Design', ['identity'], ['identity']],
    ['nas', 'Throwback Content', [], ['nas']],
  ]);
  const t = byId(tracks);
  assert.deepEqual(t.client.benchmarks, ['seb__design', '0xcharlota']);
  assert.deepEqual(t.identity.benchmarks, ['seb__design', '0xcharlota']); // both design buckets keep @seb__design
  assert.deepEqual(t.nas.benchmarks, ['dorksirjur']);
  assert.deepEqual(t.nas.topics, ['flyers']);
  // Share split evenly across the old track's buckets: design 0.6 -> 0.3 + 0.3, throwback 0.2 -> 0.1 + 0.1.
  assert.deepEqual(tracks.map((x) => Math.round(x.share * 100)), [10, 20, 30, 30, 10]);
  // Promotions follow their engine; the engine-less Throwback track has none.
  assert.deepEqual(t.client.promotions.map((p) => p.id), ['client']);
  assert.deepEqual(t.identity.promotions, []);
  assert.deepEqual(t.record.promotions.map((p) => p.id), ['discogs']);
  assert.deepEqual(t.nas.promotions, []);
  // A NAS item (engine record, bucket nas) belongs to Throwback; a Discogs item to Record Collection Videos.
  assert.equal(trackForPackage(tracks, { engine: 'record', bucketId: 'nas' }).id, 'nas');
  assert.equal(trackForPackage(tracks, { engine: 'record' }).id, 'record');
});

test('bucketTracks: a second run changes nothing; a rename only relabels; owner settings stay', () => {
  const once = normalizeContentTracks(bucketTracks(homeGrouped(), HOME_BUCKETS, { engineHints: { nas: 'record' } }));
  assert.deepEqual(normalizeContentTracks(bucketTracks(once, HOME_BUCKETS)), once);
  const tuned = once.map((t) => (t.id === 'nas' ? { ...t, share: 0.5, benchmarks: ['someone'] } : t));
  const renamed = HOME_BUCKETS.map((b) => (b.id === 'nas' ? { ...b, name: 'Throwbacks' } : b));
  const after = byId(normalizeContentTracks(bucketTracks(tuned, renamed)));
  assert.equal(after.nas.label, 'Throwbacks');
  assert.deepEqual(after.nas.benchmarks, ['someone']);
});

test('bucketTracks: new bucket joins at share 0; a deactivated built-in bucket drops its track and its engine moves', () => {
  const base = bucketTracks(homeGrouped(), HOME_BUCKETS, { engineHints: { nas: 'record' } });
  const added = normalizeContentTracks(bucketTracks(base, [...HOME_BUCKETS, { id: 'ideas-2', name: 'Ideas 2', active: true }]));
  assert.equal(added.length, 6);
  assert.deepEqual(byId(added)['ideas-2'], { ...byId(added)['ideas-2'], label: 'Ideas 2', engines: [], buckets: ['ideas-2'], benchmarks: [], share: 0 });
  const off = normalizeContentTracks(bucketTracks(base, HOME_BUCKETS.map((b) => (b.id === 'identity' ? { ...b, active: false } : b))));
  assert.equal(off.length, 4);
  assert.ok(!off.some((t) => t.id === 'identity'));
  assert.deepEqual(off[0].engines, ['record', 'identity']); // every engine still has a track
  assert.deepEqual(ENGINE_IDS.filter((e) => !off.some((t) => t.engines.includes(e))), []);
});

test('bucketTracks: no existing tracks => equal shares; no active buckets => none; at most 12 tracks', () => {
  const fresh = normalizeContentTracks(bucketTracks([], HOME_BUCKETS));
  assert.deepEqual(fresh.map((t) => t.share), [0.2, 0.2, 0.2, 0.2, 0.2]);
  assert.deepEqual(bucketTracks(homeGrouped(), HOME_BUCKETS.map((b) => ({ ...b, active: false }))), []);
  const many = [...HOME_BUCKETS, ...Array.from({ length: 10 }, (_, i) => ({ id: `extra-${i}`, name: `Extra ${i}`, active: true }))];
  assert.equal(normalizeContentTracks(bucketTracks([], many)).length, 12);
});

test('syncBucketTracks: skips a client without a plan, writes once (versioned), then is a no-op', async () => {
  const store = createMemoryPlanStore();
  const readBuckets = async () => HOME_BUCKETS;
  const readBucketEngine = async (_c, id) => (id === 'nas' ? 'record' : null);
  assert.deepEqual(await syncBucketTracks('c1', { planStore: store, readBuckets }), { changed: false, skipped: 'no-plan' });
  await store.apply('c1', { changes: { contentTracks: homeGrouped() }, by: 'owner', source: 'manual', reason: 'fixture', expectedVersion: 0 });
  const first = await syncBucketTracks('c1', { planStore: store, readBuckets, readBucketEngine });
  assert.equal(first.changed, true);
  const doc = await store.get('c1');
  assert.equal(doc.version, 2);
  assert.deepEqual(tracksOf(doc).map((t) => t.label), ['Record Collection Videos', 'Dj Mix Videos', 'Video Editing', 'Graphic Design', 'Throwback Content']);
  assert.deepEqual(tracksOf(doc).find((t) => t.id === 'nas').benchmarks, ['dorksirjur']);
  assert.deepEqual(await syncBucketTracks('c1', { planStore: store, readBuckets, readBucketEngine }), { changed: false });
  assert.equal((await store.get('c1')).version, 2);
});

test('summarizeTrackLibrary: per-track item count, top tags and sample titles', () => {
  const tracks = normalizeContentTracks(bucketTracks(homeGrouped(), HOME_BUCKETS, { engineHints: { nas: 'record' } }));
  const lib = byId(summarizeTrackLibrary(tracks, [
    { id: 'a', title: 'Flyer wall 1996', engine: 'record', bucketId: 'nas', tags: ['flyer', 'warehouse'] },
    { id: 'b', title: 'Boiler room set', engine: 'record', bucketId: 'nas', tags: ['flyer'] },
    { id: 'c', title: 'Mix 12', engine: 'ue', bucketId: 'ue', tags: [] },
  ]).map((r) => ({ ...r, id: r.trackId })));
  assert.equal(lib.nas.itemCount, 2);
  assert.deepEqual(lib.nas.topTags, [{ tag: 'flyer', count: 2 }, { tag: 'warehouse', count: 1 }]);
  assert.deepEqual(lib.nas.sampleTitles, ['Flyer wall 1996', 'Boiler room set']);
  assert.equal(lib.ue.itemCount, 1);
  assert.equal(lib.identity.itemCount, 0);
});

test('Brain sync only changes settings of existing tracks: unknown labels warn, nothing is added or renamed', async () => {
  const store = createMemoryPlanStore();
  const tracks = bucketTracks(homeGrouped(), HOME_BUCKETS, { engineHints: { nas: 'record' } });
  await store.apply('c1', { changes: { contentTracks: tracks }, by: 'owner', source: 'manual', reason: 'fixture', expectedVersion: 0 });
  const res = await sync.writeBrainTracksToPlan(store, 'c1', [
    { label: 'throwback content', share: 0.1, topics: ['flyers', 'raves'], benchmarks: ['dorksirjur'] },
    { label: 'Design & client work', share: 0.6, topics: [], benchmarks: [] },
  ], { tracksOf });
  assert.equal(res.warnings.length, 1);
  assert.match(res.warnings[0], /no track named "Design & client work"/);
  const after = tracksOf(await store.get('c1'));
  assert.equal(after.length, 5);
  const nas = after.find((t) => t.id === 'nas');
  assert.equal(nas.label, 'Throwback Content');
  assert.deepEqual(nas.topics, ['flyers', 'raves']);
  assert.deepEqual(nas.buckets, ['nas']);
});
