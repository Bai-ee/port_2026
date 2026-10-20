import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLaneGraph, laneOfTrack, laneModels, quotedAuthors, musicBioHits, avoidTermsFromTopics,
  isLaneGraphStale, toStoredLaneGraph, laneGraphFromXGrowth, LANE_GRAPH_MAX_AGE_MS,
} from '../lane-graph.js';

// Fixtures mirror the real plan: record/ue/nas are music tracks, client/identity are design.
const tracks = [
  { id: 'record', label: 'Record Collection Videos', benchmarks: ['slimeysmine'], topics: ['archive sets', 'flyers'] },
  { id: 'ue', label: 'Dj Mix Videos', benchmarks: ['slimeysmine'], topics: ['DJ mixes'] },
  { id: 'client', label: 'Video Editing', benchmarks: [], topics: ['client work', 'tools'] },
  { id: 'identity', label: 'Graphic Design', benchmarks: ['0xcharlota'], topics: ['client work', 'tools'] },
  { id: 'nas', label: 'Throwback Content', benchmarks: [], topics: ['past events'] },
];
const q = (author, engagement = 10) => ({ quotedAuthor: author, engagement });
const corpora = {
  seb__design: [q('rare_jpg'), q('rare_jpg'), q('@interiorsuckerr'), q('seb__design'), q('bai_ee'), q('cryptoguy'), { text: 'no quote' }, q('bad handle!')],
  '0xcharlota': [q('rare_jpg'), q('0xCharlota'), q('Rare_JPG')],
};
const user = (username, description, name = '') => ({ username, description, name });
const following = {
  slimeysmine: [user('djhype', 'Jungle DJ and label boss'), user('actor_guy', 'actor, films'), user('doc_scott', 'drum and bass, records'), user('cryptodj', 'dj, crypto price calls')],
  dorksirjur: [user('djhype', 'DJ Hype'), user('chicago_hist', 'Chicago house history, mixes'), user('slimeysmine', 'rave records')],
  bai_ee: [user('chicago_hist', 'house music archive'), user('raunofreiberg', 'design @vercel'), user('bai_ee', 'dj house')],
};
const base = {
  tracks, benchmarkPrimary: 'seb__design', ownHandle: 'bai_ee', corpora, following,
  avoidHandles: ['cryptoguy'], avoidTerms: ['crypto'],
};

test('laneOfTrack: music words win, everything else is design', () => {
  assert.deepEqual(tracks.map(laneOfTrack), ['music', 'music', 'design', 'design', 'music']);
});

test('laneModels: benchmarks by lane, benchmarkPrimary is design, throwback model is music, no overlap', () => {
  assert.deepEqual(laneModels({ tracks, benchmarkPrimary: 'seb__design' }), {
    design: ['0xcharlota', '0xdesigner', 'seb__design'],
    music: ['dorksirjur', 'slimeysmine'],
  });
  // a music benchmark is never also design
  assert.deepEqual(laneModels({ tracks, benchmarkPrimary: 'slimeysmine' }).design, ['0xcharlota', '0xdesigner']);
  assert.deepEqual(laneModels({ tracks: [], benchmarkPrimary: '' }), { design: ['0xdesigner'], music: ['dorksirjur'] });
});

test('quotedAuthors: counts, strips @, ignores malformed handles and non-quotes', () => {
  const m = quotedAuthors(corpora.seb__design);
  assert.equal(m.get('rare_jpg').quotes, 2);
  assert.equal(m.get('interiorsuckerr').handle, 'interiorsuckerr');
  assert.equal(m.has('bad handle!'), false);
  assert.equal(quotedAuthors(null).size, 0);
});

test('design lane: weighted by quotes across models, excludes owner, models and avoided handles', () => {
  const g = buildLaneGraph(base);
  assert.deepEqual(g.design.map((a) => a.handle), ['rare_jpg', 'interiorsuckerr']);
  assert.equal(g.design[0].weight, 4);
  assert.equal(g.design[0].source, 'quoted-by:0xcharlota(2),seb__design(2)');
  assert.equal(g.design.some((a) => ['seb__design', '0xCharlota', 'bai_ee', 'cryptoguy'].includes(a.handle)), false);
});

test('music lane: bio-filtered following of music models + owner; owner/models/avoid excluded', () => {
  const g = buildLaneGraph(base);
  const byHandle = Object.fromEntries(g.music.map((a) => [a.handle, a]));
  assert.deepEqual(Object.keys(byHandle).sort(), ['chicago_hist', 'djhype', 'doc_scott']);
  assert.equal(byHandle.djhype.source, 'following:dorksirjur,slimeysmine');
  assert.equal(byHandle.chicago_hist.source, 'following:bai_ee,dorksirjur');
  assert.ok(byHandle.djhype.weight >= 2 && byHandle.djhype.weight < 3, 'two lists + capped bio bonus');
  assert.equal(byHandle.actor_guy, undefined, 'non-music bio dropped');
  assert.equal(byHandle.cryptodj, undefined, 'avoid term in bio dropped');
  assert.equal(byHandle.slimeysmine, undefined, 'model itself excluded');
  assert.equal(byHandle.bai_ee, undefined, 'owner excluded');
  assert.deepEqual(g.music.slice(0, 2).map((a) => a.handle), ['chicago_hist', 'djhype'], 'two-list accounts first, ties alphabetical');
  assert.equal(g.music[2].handle, 'doc_scott');
  assert.equal(g.meta.dropped.notMusicBio, 2); // actor_guy, raunofreiberg
});

test('lanes never share a model: a design model quoted by the music lane is excluded there', () => {
  const g = buildLaneGraph({ ...base, following: { ...following, bai_ee: [user('seb__design', 'design house')] } });
  assert.equal(g.music.some((a) => a.handle === 'seb__design'), false);
});

test('maxPerLane caps each lane after sorting; empty inputs give empty lanes', () => {
  assert.equal(buildLaneGraph({ ...base, maxPerLane: 1 }).design.length, 1);
  const empty = buildLaneGraph({});
  assert.deepEqual([empty.design, empty.music], [[], []]);
});

test('musicBioHits and avoidTermsFromTopics', () => {
  assert.equal(musicBioHits(user('x', 'DJ and house selector')), 3);
  assert.equal(musicBioHits(user('x', 'accountant')), 0);
  assert.deepEqual(avoidTermsFromTopics(['Crypto price and speculation talk', 'Politics not associated with design or music', 'Music-tech as the main label', 'AI or SaaS pitch']), ['crypto', 'politics']);
});

test('isLaneGraphStale: missing / bad / old are stale, fresh is not', () => {
  const now = Date.parse('2026-10-20T00:00:00Z');
  assert.equal(isLaneGraphStale(null, now), true);
  assert.equal(isLaneGraphStale({ builtAt: 'nope' }, now), true);
  assert.equal(isLaneGraphStale({ builtAt: new Date(now - LANE_GRAPH_MAX_AGE_MS - 1).toISOString() }, now), true);
  assert.equal(isLaneGraphStale({ builtAt: new Date(now - 60_000).toISOString() }, now), false);
});

test('stored shape round-trips through xGrowth', () => {
  const stored = toStoredLaneGraph(buildLaneGraph(base), { builtAt: '2026-10-20T00:00:00.000Z' });
  assert.deepEqual(Object.keys(stored.design[0]).sort(), ['handle', 'source', 'weight']);
  assert.equal(laneGraphFromXGrowth({ laneGraph: stored }).builtAt, stored.builtAt);
  assert.equal(laneGraphFromXGrowth({ laneGraph: { design: 'x' } }), null);
  assert.equal(laneGraphFromXGrowth(undefined), null);
});
