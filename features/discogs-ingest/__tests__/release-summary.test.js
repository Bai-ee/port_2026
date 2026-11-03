import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDiscogsBundle } from '../release-summary.js';
import { fetchReleaseBundle } from '../discogs-api.js';

const RELEASE = {
  id: 10207, title: 'House Music Will Never Die', year: 1989, country: 'US', uri: 'https://www.discogs.com/release/10207',
  artists: [{ name: 'G.U. Cei Bei' }], labels: [{ name: 'Trax Records', catno: 'TX-1' }], formats: [{ name: 'Vinyl', descriptions: ['12"', '45 RPM'] }],
  genres: ['Electronic'], styles: ['Chicago House'], tracklist: [{}, {}], videos: [{}, {}, {}],
  community: { have: 812, want: 1450, rating: { average: 4.4, count: 120 } }, lowest_price: 19.5, num_for_sale: 7,
};

test('value: suggested VG+ wins, then other suggested conditions, then the lowest listing', () => {
  const s = summarizeDiscogsBundle({ releaseId: '10207', release: RELEASE, marketStats: { lowest_price: { value: 21, currency: 'USD' }, num_for_sale: 7 }, priceSuggestions: { 'Very Good Plus (VG+)': { value: 34.6, currency: 'USD' }, 'Near Mint (NM or M-)': { value: 48, currency: 'USD' } } });
  assert.equal(s.valueUsd, 34.6);
  assert.equal(s.valueBasis, 'suggested Very Good Plus (VG+)');
  assert.equal(s.lowestUsd, 21);
  assert.deepEqual(s.formats, ['Vinyl 12" 45 RPM']);
  assert.equal(s.want, 1450);
  assert.equal(s.discogsVideos, 3);
  const noSugg = summarizeDiscogsBundle({ release: RELEASE, marketStats: { lowest_price: { value: 21, currency: 'USD' } }, priceSuggestions: null });
  assert.equal(noSugg.valueUsd, 21);
  assert.equal(noSugg.valueBasis, 'lowest listing');
  const none = summarizeDiscogsBundle({ release: { ...RELEASE, lowest_price: null }, marketStats: {}, priceSuggestions: {} });
  assert.equal(none.valueUsd, null);
  assert.equal(none.valueBasis, null);
});

test('fetchReleaseBundle: a failing part is recorded, never thrown; the rest still arrives', async () => {
  const api = {
    release: async () => RELEASE,
    marketStats: async () => ({ num_for_sale: 7 }),
    priceSuggestions: async () => { throw Object.assign(new Error('Discogs GET /marketplace/price_suggestions failed: 404'), { status: 404 }); },
    collectionInstances: async () => ({ releases: [{ instance_id: 1 }] }),
  };
  const b = await fetchReleaseBundle(api, 10207, { username: 'me', now: () => '2026-10-18T20:00:00Z' });
  assert.equal(b.release.id, 10207);
  assert.equal(b.priceSuggestions, null);
  assert.equal(b.errors.priceSuggestions.status, 404);
  assert.equal(summarizeDiscogsBundle(b).inCollection, 1);
  assert.deepEqual(summarizeDiscogsBundle(b).partsMissing, ['priceSuggestions']);
});
