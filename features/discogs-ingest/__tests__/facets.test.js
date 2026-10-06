import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContentPackage, buildDiscogsFacets, detectGear, parseDraftRequest } from '../draft-builder.js';
import { effectiveFacets } from '../../x-content-inventory/facets.js';
import { validatePackage } from '../../x-content-inventory/schema.js';

const body = {
  releaseId: 74379, discogsUrl: 'https://www.discogs.com/release/74379', artist: 'Lith De Lanka', title: 'Fairy Tale',
  label: 'Deep Touch', catno: 'DT-117', year: '1999',
  videoStoragePath: 'publish-staging/discogs/74379/video.mp4', imageStoragePath: 'publish-staging/discogs/74379/image.jpg',
};
const full = {
  ...body, genres: ['Electronic'], styles: ['Acid House', 'Deep House', 'Acid House'],
  formats: ['Vinyl', '12"'], country: 'US', tracklist: [{ title: 'Fairy Tale' }, 'Dub', 42, { nope: 1 }], bogus: 'x',
};

test('full request -> facets', () => {
  const pkg = buildContentPackage(parseDraftRequest(full));
  assert.deepEqual(pkg.facets, {
    people: ['lith de lanka'], labels: ['deep touch'], eraYear: 1999, decade: '1990s',
    genres: ['electronic', 'acid house', 'deep house'], vibe: { kind: 'record' },
  });
  assert.deepEqual(validatePackage(pkg).errors, []);
  assert.equal('humanEdits' in pkg, false);
});

test('parse validates/trims optional fields, ignores unknown', () => {
  const r = parseDraftRequest(full);
  assert.deepEqual(r.styles, ['Acid House', 'Deep House']);
  assert.deepEqual(r.tracklist, ['Fairy Tale', 'Dub']);
  assert.equal(r.country, 'US');
  assert.equal('bogus' in r, false);
  const bad = parseDraftRequest({ ...body, genres: 'house', styles: [1, null] });
  assert.deepEqual([bad.genres, bad.styles], [[], []]);
});

test('partial request -> only what exists', () => {
  const f = buildContentPackage(parseDraftRequest({ ...body, label: '', year: null })).facets;
  assert.deepEqual(f, { people: ['lith de lanka'], vibe: { kind: 'record' } });
});

test('gear only when named outright', () => {
  assert.deepEqual(detectGear(['Acid House', 'TB-303 Acid']), ['tb-303']);
  assert.deepEqual(detectGear(['Roland TR 909 Drums']), ['tr-909']);
  assert.deepEqual(detectGear(['House 909 Remix', 'Techno']), []);
});

test('humanEdits untouched and win; re-ingest refreshes machine facets', () => {
  const first = buildContentPackage(parseDraftRequest(full));
  const stored = { ...first, humanEdits: { genres: ['jungle'] } };
  const again = buildContentPackage(parseDraftRequest({ ...full, styles: ['Techno'] }), stored);
  assert.equal('humanEdits' in again, false); // never written, so merge:true leaves it alone
  assert.deepEqual(again.facets.genres, ['electronic', 'techno']);
  assert.deepEqual(effectiveFacets({ ...again, humanEdits: stored.humanEdits }).genres, ['jungle']);
});

test('re-ingest without genre fields keeps stored machine genres', () => {
  const stored = buildContentPackage(parseDraftRequest(full));
  const again = buildContentPackage(parseDraftRequest(body), stored);
  assert.deepEqual(again.facets.genres, ['electronic', 'acid house', 'deep house']);
});

test('story/status preferExisting semantics preserved', () => {
  const again = buildContentPackage(parseDraftRequest(full), { story: 's', status: 'drafted', engine: 'client', tags: ['mine'] });
  assert.equal(again.story, 's'); assert.equal(again.status, 'drafted');
  assert.equal(again.engine, 'client'); assert.deepEqual(again.tags, ['mine']);
});

test('buildDiscogsFacets uses artists[] when present', () => {
  const f = buildDiscogsFacets({ ...parseDraftRequest(body), artists: ['A', 'B'] });
  assert.deepEqual(f.people, ['a', 'b']);
});

test('offline backfill derivation from stored package fields', async () => {
  const { deriveFacets } = await import('../../../scripts/discogs/backfill-facets.mjs');
  const pkg = { id: 'discogs-1', title: 'Aphex Twin – Windowlicker', entities: ['aphex twin', 'warp records'], eraYear: 1999 };
  assert.deepEqual(deriveFacets(pkg), {
    people: ['aphex twin'], labels: ['warp records'], eraYear: 1999, decade: '1990s', vibe: { kind: 'record' },
  });
  const rel = { artists: [{ name: 'Aphex Twin' }], labels: [{ name: 'Warp Records' }], genres: ['Electronic'], styles: ['IDM'] };
  assert.deepEqual(deriveFacets(pkg, rel).genres, ['electronic', 'idm']);
});
