// Content tracks + promotions in the daily loop: track/promotion/media on every suggestion, self-reply link,
// media on Save (incl. NAS needs-staging), strong match => original-with-media, and the scheduled (cron) runner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDailyLoop, OWNER_CLIENT_IDS, MAX_SUGGESTIONS } from '../daily-loop.js';
import { selectForSlots, matchScore } from '../daily-loop/select.js';
import { normalizeConversationPost } from '../daily-loop/conversations.js';
import { createMemoryRunStore, saveSuggestionDraft } from '../daily-run-store.js';
import { discoveryQueries } from '../daily-loop/brand.js';
import { pickMedia } from '../item-actions.js';
import { tracksOf } from '../../x-strategy/content-tracks.js';
import * as scheduledMod from '../daily-loop/scheduled.js';
const { pilotClientIds, runScheduledDailyLoop } = scheduledMod;

const OWNER = OWNER_CLIENT_IDS[0];
const NOW = Date.parse('2026-10-10T15:00:00Z');
const LOCAL = '2026-10-10';
const STORY = 'Rendered this mix on the studio pipeline and kept the original room sound on purpose, nothing added.';

const mix = {
  id: 'rv-1', title: 'Glenn Underground – Night Mix', series: 'C4', engine: 'ue', story: STORY, mediaState: 'video', rights: 'cleared',
  source: { kind: 'rendered-video' }, assetRefs: ['ev:mixes/night.mp4'], facets: { people: ['Glenn Underground'] },
  searchTokens: ['chicago', 'nightmix'], status: 'ready', platforms: ['x'],
};
const nas = {
  id: 'nas-1', title: 'Warehouse clip', series: 'C3', engine: 'record', story: STORY, mediaState: 'video', rights: 'owned',
  source: { kind: 'nas-archive' }, assetRefs: [], nas: { sha256: 'a', relativePath: 'x.mov', sourceId: 's' }, platforms: ['x'],
};
const tracksWithUrl = () => {
  const t = tracksOf(null);
  t.find((x) => x.id === 'music').promotions.find((p) => p.id === 'ue').url = 'https://example.com/ue';
  return t;
};
const showcaseSlot = { letter: 'A', type: 'original-showcase', lane: null, pillar: null, timeCT: null, startsAt: null, manual: false };

function showcase(pkg, contentTracks) {
  return selectForSlots({
    clientId: OWNER, localDate: LOCAL, now: NOW, packages: [pkg], slots: [showcaseSlot],
    matchedSlots: [{ slot: 'A', packageId: pkg.id }], contentTracks,
  });
}

test('suggestion carries track, promotion and package.media; MAX_SUGGESTIONS is 5', () => {
  assert.equal(MAX_SUGGESTIONS, 5);
  const [s] = showcase(mix, tracksWithUrl()).suggestions;
  assert.equal(s.track, 'music');
  assert.deepEqual(s.promotion, { id: 'ue', label: 'Underground Existence', url: 'https://example.com/ue' });
  assert.deepEqual(s.package.media, { kind: 'video', ref: 'ev:mixes/night.mp4' });
});

test('run doc: self-reply carries the link; empty when the url is null', async () => {
  const go = async (contentTracks) => (await runDailyLoop({ now: () => NOW, store: createMemoryRunStore(), readInputs: async () => ({ packages: [mix], contentTracks }) }, { clientId: OWNER })).run;
  const withUrl = await go(tracksWithUrl());
  assert.equal(withUrl.suggestions[0].draft.selfReply, 'Underground Existence: https://example.com/ue');
  const noUrl = await go(undefined);
  assert.equal(noUrl.suggestions[0].draft.selfReply, '');
  assert.equal(noUrl.suggestions[0].track, 'music');
  assert.equal(noUrl.usage.modelCalls, 0);
});

test('searchTokens count as match terms', () => {
  const m = matchScore('Glenn Underground in chicago tonight', mix);
  assert.equal(m.tier, 'specific');
  assert.ok(m.terms.includes('chicago'));
});

test('strong match on a quote slot yields an original with media, related to the post', () => {
  const post = normalizeConversationPost({
    id: 'p1', author: 'chicagoheads', text: 'Glenn Underground still the standard for deep house, nothing close', createdAt: new Date(NOW - 3_600_000).toISOString(),
    likeCount: 90, retweetCount: 9, replyCount: 4, hasMedia: true, media: [{ type: 'photo' }],
  }, 'watchlist');
  const r = selectForSlots({
    clientId: OWNER, localDate: LOCAL, now: NOW, packages: [mix], conversationPosts: [post], candidates: [{ ...post, vein: 'retro-analog-preinternet', score: 5, hasMedia: true }],
    slots: [{ ...showcaseSlot, letter: 'B', type: 'quote-react', lane: 'music' }], matchedSlots: [],
  });
  const s = r.suggestions[0];
  assert.ok(s, JSON.stringify(r.gaps));
  assert.equal(s.type, 'original');
  assert.equal(s.package.id, 'rv-1');
  assert.equal(s.related.author, 'chicagoheads');
  assert.match(s.why.now, /related to @chicagoheads/);
  assert.equal(s.slot.type, 'original-showcase');
});

test('discovery: bai-ee is excluded except for items in the music track', () => {
  const own = { ...mix, id: 'o', facets: { people: ['Bai-Ee'] } };
  const client = { ...mix, id: 'c', engine: 'client', series: 'C6', facets: { people: ['Bai-Ee'] } };
  assert.ok(discoveryQueries([own]).some((q) => /bai-?ee/i.test(q.term)));
  assert.ok(!discoveryQueries([client]).some((q) => /bai-?ee/i.test(q.term)));
});

// --- Save: media + needs-staging ---

async function savedSetup(pkg, contentTracks) {
  const store = createMemoryRunStore();
  const { run } = await runDailyLoop({ now: () => NOW, store, readInputs: async () => ({ packages: [pkg], contentTracks }) }, { clientId: OWNER });
  const key = { clientId: OWNER, localDate: LOCAL, channel: 'x', version: run.version };
  const rows = new Map();
  const deps = {
    store, now: () => NOW, getPackage: async () => pkg, postExists: async (id) => rows.has(id),
    signEvLong: async (p) => `https://signed.example/${p}`, hitloopUrl: async (p) => `https://hitloop.example/${p}`,
    createDraftPostOnce: async (clientId, postId, payload) => {
      if (rows.has(postId)) return { post: rows.get(postId), existing: true };
      const post = { id: postId, clientId, ...payload, status: 'draft', scheduledAt: null };
      rows.set(postId, post);
      return { post, existing: false };
    },
  };
  return { run, key, rows, deps };
}

test('Save attaches the package media ref (mediaStoragePath) and the link self-reply; re-save is idempotent', async () => {
  const { run, key, rows, deps } = await savedSetup(mix, tracksWithUrl());
  const id = run.suggestions[0].id;
  const a = await saveSuggestionDraft(deps, { key, suggestionId: id });
  const b = await saveSuggestionDraft(deps, { key, suggestionId: id });
  assert.equal(a.postId, b.postId);
  assert.equal(rows.size, 1);
  const post = [...rows.values()][0];
  assert.equal(post.mediaStoragePath, 'ev:mixes/night.mp4');
  assert.equal(post.mediaType, 'video');
  assert.equal(post.packageId, 'rv-1');
  assert.equal(post.scheduledAt, null);
  assert.equal(post.selfReply.text, 'Underground Existence: https://example.com/ue');
});

test('unstaged NAS item: needs-staging on the suggestion, and Save refuses (no write)', async () => {
  const { run, key, rows, deps } = await savedSetup(nas);
  const s = run.suggestions[0];
  assert.deepEqual(s.package.media, { status: 'needs-staging' });
  await assert.rejects(saveSuggestionDraft(deps, { key, suggestionId: s.id }), (e) => e.code === 'needs-staging' && e.status === 409);
  assert.equal(rows.size, 0);
});

test('staged NAS item: Save attaches the publish-staging ref through pickMedia', async () => {
  const { run, key, rows, deps } = await savedSetup(nas);
  const id = run.suggestions[0].id;
  const staged = { ...nas, assetRefs: ['publish-staging/nas-1/abcd.mp4'], staged: { storagePath: 'publish-staging/nas-1/abcd.mp4' } };
  deps.getPackage = async () => staged;
  await saveSuggestionDraft(deps, { key, suggestionId: id });
  const post = [...rows.values()][0];
  assert.equal(post.mediaStoragePath, 'publish-staging/nas-1/abcd.mp4');
  assert.equal(post.mediaUrl, 'https://hitloop.example/publish-staging/nas-1/abcd.mp4');
  assert.equal((await pickMedia(staged, deps)).mediaType, 'video');
});

// --- scheduled runner + worker route ---

test('scheduled runner: no drafter is ever passed; zero model calls; unset PILOT_CLIENT_IDS fails closed', async () => {
  assert.throws(() => pilotClientIds({}), (e) => e.status === 503);
  assert.deepEqual(pilotClientIds({ PILOT_CLIENT_IDS: ' a , b ' }), ['a', 'b']);
  let seen;
  await runScheduledDailyLoop({ store: {}, readInputsFor: async () => ({}), runLoop: async (d) => { seen = d; return { run: { suggestions: [] } }; } }, { clientIds: [OWNER] });
  assert.equal('draft' in seen, false);
  const out = await runScheduledDailyLoop({ store: createMemoryRunStore(), now: () => NOW, readInputsFor: async () => ({ packages: [mix] }) }, { clientIds: [OWNER, 'someone-else'] });
  assert.equal(out[0].ok, true);
  assert.equal(out[0].modelCalls, 0);
  assert.equal(out[0].copySource, 'fallback');
  assert.equal(out[1].ok, false); // non-owner client is refused by the loop's own gate
});

test('cron auth: unauthenticated => no; wrong secret => no; production without secret fails closed; dev needs the cron header', () => {
  const { cronAuthorized } = scheduledMod;
  assert.equal(cronAuthorized({}, { CRON_SECRET: 's' }), false);
  assert.equal(cronAuthorized({ authorization: 'Bearer x' }, { CRON_SECRET: 's' }), false);
  assert.equal(cronAuthorized({ authorization: 'Bearer s' }, { CRON_SECRET: 's' }), true);
  assert.equal(cronAuthorized({ vercelCron: '1' }, { VERCEL_ENV: 'production' }), false);
  assert.equal(cronAuthorized({ vercelCron: '1' }, { NODE_ENV: 'production' }), false);
  assert.equal(cronAuthorized({ vercelCron: '1' }, {}), true);
  assert.equal(cronAuthorized({}, {}), false);
});
