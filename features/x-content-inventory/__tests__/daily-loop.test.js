import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  tokenize, packageEligibility, contentBasis, buildBrandProfile, groupNarratives, brandFit, selectSuggestions,
  deriveStrategy, zonedTimeToIso, localDateOf, runDailyLoop, checkSuggestionText, buildContributionPrompt,
  fallbackCopy, conversationPostsFrom, normalizeConversationPost, performanceEvidence, matchScore, OWNER_CLIENT_IDS,
} from '../daily-loop.js';
import { createMemoryRunStore, saveSuggestionDraft, dismissSuggestion, runDocId } from '../daily-run-store.js';

const FX = JSON.parse(readFileSync(new URL('./fixtures/daily-loop-replay.json', import.meta.url), 'utf8'));
const OWNER = OWNER_CLIENT_IDS[0];
const NOW = Date.parse(FX.now);
const LOCAL = '2026-10-10';
const pkg = (id) => FX.packages.find((p) => p.id === id);

function select(overrides = {}) {
  const strategy = deriveStrategy({ benchmark: FX.benchmark, strategyPlan: FX.strategyPlan, localDate: LOCAL });
  return selectSuggestions({
    clientId: OWNER, localDate: LOCAL, now: NOW, strategy, brain: FX.brain, ownSummary: FX.ownSummary,
    packages: FX.packages, conversationPosts: conversationPostsFrom(FX), ...overrides,
  });
}

test('tokenize drops urls, handles, generic words and short numbers', () => {
  assert.deepEqual(tokenize('Look at this new 1997 flyer https://t.co/x @bob the best acid 12'), ['1997', 'flyer', 'acid']);
});

test('content basis by type: facts without a story are usable; model suggestions never count', () => {
  assert.equal(contentBasis(pkg('discogs-10207')).kind, 'facts');
  assert.equal(contentBasis(pkg('rv-fathers-day')).kind, 'facts');
  assert.equal(contentBasis(pkg('holopaper-cloth-grab')).kind, 'story');
  // A crowd photo with only a model-written suggestedStory has nothing verifiable.
  assert.equal(contentBasis(pkg('nas-photo-no-text')).kind, 'none');
  assert.equal(packageEligibility(pkg('nas-photo-no-text')).reason, 'no-grounding');
  assert.equal(packageEligibility(pkg('rv-client-retired')).reason, 'rights');
  assert.equal(packageEligibility({ ...pkg('discogs-10207'), id: 'EXAMPLE-x' }).reason, 'placeholder');
  // Someone else's rendered video is not "own work".
  assert.equal(contentBasis({ ...pkg('rv-fathers-day'), title: 'Client promo', facets: { people: ['someone'] } }).kind, 'none');
});

test('narratives: related posts group; unrelated stay apart; old posts drop out', () => {
  const posts = conversationPostsFrom(FX);
  const ns = groupNarratives(posts, { now: NOW });
  const cajual = ns.find((n) => n.posts.some((p) => p.id === '9104'));
  assert.ok(cajual.posts.some((p) => p.id === '9102'), 'Cajual/Chicago posts share two terms beyond the query');
  assert.ok(!cajual.posts.some((p) => p.id === '9103'));
  const stale = groupNarratives([normalizeConversationPost({ id: 'old', text: 'cajual chicago house', createdAt: '2026-10-01T00:00:00Z', likeCount: 900 }, 'x')], { now: NOW });
  assert.equal(stale.length, 0);
});

test('brand relevance is more than a keyword: "White House" is out of lane, Star Wars poster has no library overlap', () => {
  const eligible = FX.packages.filter((p) => packageEligibility(p).ok);
  const profile = buildBrandProfile({ packages: eligible, brain: FX.brain });
  const ns = groupNarratives(conversationPostsFrom(FX), { now: NOW });
  const politics = ns.find((n) => n.anchor.id === '9103');
  assert.equal(brandFit(politics, profile).blockedLane, true);
  const poster = ns.find((n) => n.anchor.id === '9001');
  assert.equal(brandFit(poster, profile).score, 0);
  // The draft (wrong-product) Brain contributes nothing to the profile.
  assert.equal(profile.terms.has('claire'), false);
  assert.match(profile.sources.brain, /not used/);
});

test('broad words alone are not brand fit; a named label/artist is', () => {
  const eligible = FX.packages.filter((p) => packageEligibility(p).ok);
  const profile = buildBrandProfile({ packages: eligible, brain: FX.brain });
  const n = (text) => ({ text });
  assert.equal(brandFit(n('new music video out now, deep house vibes'), profile).score, 0);
  assert.match(brandFit(n('new music video out now'), profile).reason, /only broad words/);
  // One-word names need domain context: slang "cajual" (= casual) must not match.
  assert.ok(!brandFit(n('thoda cajual hai'), profile).phrases.some((p) => p.startsWith('cajual')));
  const named = brandFit(n('Cajual house was untouchable in 96. Glenn Underground forever.'), profile);
  assert.ok(named.score > 0);
  assert.ok(named.phrases.some((p) => p.startsWith('cajual')));
  assert.ok(named.phrases.some((p) => p.startsWith('glenn underground')));
  // The Adamski/Hacienda post only shares "house music" — not enough.
  const ns = groupNarratives(conversationPostsFrom(FX), { now: NOW });
  assert.equal(brandFit(ns.find((x) => x.anchor.id === '9101'), profile).score, 0);
});

test('ambiguous names support but never anchor a match', () => {
  const rec = (title, labels = []) => ({ ...pkg('discogs-10207'), id: title, title, facets: { labels, genres: ['house', 'big beat'] } });
  // Real false positives from the 2026-10-10 run.
  assert.equal(matchScore('🐓 DAY 3:PLAY FIGHT — I need action', rec('3-Play – The Cream Of The Krop EP')), null);
  assert.equal(matchScore('limited edition black vinyl, out November', rec('Braxton Holmes – The Adventures E.P.', ['black vinyl records'])), null);
  // A genre phrase is a labelled genre-level match, never a specific one.
  assert.equal(matchScore('Big beat at Takutaku, Oct 20', rec('Blue Boy – Scattered Emotions EP')).tier, 'genre');
  // Specific names do anchor.
  assert.equal(matchScore('DJ Sneak at the Warehouse tonight', rec('DJ Sneak – Moon Doggy E.P.')).tier, 'specific');
  assert.ok(matchScore('anyone got Black Vinyl Records catalogue numbers?', rec('Braxton Holmes – The Adventures E.P.', ['black vinyl records'])));
});

test('ranking: a modest on-brand conversation beats a viral unrelated one; gaps explain the skips', () => {
  const r = select();
  const ids = r.suggestions.map((s) => s.opportunity?.id);
  assert.ok(!ids.includes('9103'), 'viral politics post never suggested');
  assert.ok(!ids.includes('9001'), 'viral off-brand poster never suggested');
  const top = r.suggestions[0];
  assert.equal(top.package.id, 'discogs-10207');
  assert.ok(['9102', '9104'].includes(top.opportunity.id));
  assert.ok(top.conversation.posts.every((p) => p.url.startsWith('https://x.com/')));
  for (const k of ['now', 'brand', 'brain', 'strategy', 'content', 'history']) assert.ok(top.why[k], `why.${k}`);
  assert.match(top.why.brain, /draft — not used/);
  assert.ok(r.gaps.some((g) => g.code === 'off-brand-conversations' && g.count >= 2));
  assert.ok(r.gaps.some((g) => g.code === 'strategy-excluded'));
  assert.ok(r.gaps.some((g) => g.code === 'ineligible-no-grounding'));
  assert.ok(r.suggestions.length <= 3);
});

test('conversation on-brand but with no owned content is a gap, not a forced match', () => {
  const r = select({ packages: [pkg('holopaper-cloth-grab')] });
  assert.ok(!r.suggestions.some((s) => s.type !== 'original'));
  assert.ok(r.gaps.some((g) => g.code === 'off-brand-conversations' || g.code === 'conversations-without-content'));
  assert.equal(r.suggestions[0].type, 'original');
  assert.equal(r.suggestions[0].package.id, 'holopaper-cloth-grab');
});

test('contribution type: fresh question → reply; inside quote window → quote; older → original', () => {
  const r = select();
  const byOpp = Object.fromEntries(r.suggestions.filter((s) => s.opportunity).map((s) => [s.opportunity.id, s.type]));
  // 9102 is 3.5h old and asks a question.
  if (byOpp['9102']) assert.equal(byOpp['9102'], 'reply');
  const later = select({ now: NOW + 40 * 3_600_000, localDate: LOCAL });
  for (const s of later.suggestions.filter((x) => x.conversation)) assert.equal(s.type, 'original');
});

test('history evidence is labelled weak when the sample is small, absent when missing', () => {
  const ev = performanceEvidence({ narrative: { text: 'chicago house record' }, type: 'reply', ownSummary: FX.ownSummary });
  assert.equal(ev.type.n, 4);
  assert.equal(ev.type.weak, true);
  assert.equal(performanceEvidence({ narrative: { text: 'x' }, type: 'quote', ownSummary: null }).available, false);
});

test('facts-only prompt forbids memories; fallback is the verifiable ID line', () => {
  const r = select();
  const s = r.suggestions.find((x) => x.package.basis === 'facts');
  const built = buildContributionPrompt({ suggestion: s, voice: '' });
  assert.match(built.prompt, /Do NOT write memories/);
  assert.match(built.prompt, /<conversation>/);
  assert.ok(!/CLAIRE/i.test(built.prompt), 'draft Brain voice never reaches the prompt');
  assert.match(fallbackCopy(s), /House Music Will Never Die/);
});

test('strategy: stale plan ignored; excluded plan reported', () => {
  const stale = deriveStrategy({ strategyPlan: { generatedAt: '2026-09-08', items: [{ scheduledAt: '2026-09-09T10:00:00-04:00', content: 'x' }] }, localDate: LOCAL });
  assert.equal(stale.plan.active, false);
  assert.ok(stale.gaps.some((g) => g.code === 'strategy-stale'));
  assert.ok(deriveStrategy({ strategyPlan: FX.strategyPlan, localDate: LOCAL }).gaps.some((g) => g.code === 'strategy-excluded'));
});

test('zonedTimeToIso converts Chicago wall time across DST', () => {
  assert.equal(zonedTimeToIso('2026-10-10', '09:30'), '2026-10-10T14:30:00.000Z');
  assert.equal(zonedTimeToIso('2026-01-10', '09:30'), '2026-01-10T15:30:00.000Z');
  assert.equal(localDateOf(Date.parse('2026-10-11T03:00:00Z')), '2026-10-10');
});

test('checks block hashtags, long quotes and long replies', () => {
  const quote = { type: 'quote', package: pkg('discogs-10207'), opportunity: { text: 'x' } };
  assert.equal(checkSuggestionText('cajual never missed', quote).blocked, false);
  assert.equal(checkSuggestionText('so good #house', quote).blocked, true);
  assert.equal(checkSuggestionText('x'.repeat(120), quote).blocked, true);
  assert.equal(checkSuggestionText('y '.repeat(120), { type: 'reply', package: pkg('discogs-10207') }).blocked, true);
});

const deps = (store, inputs = FX) => ({ now: () => NOW, store, readInputs: async () => inputs });

test('runDailyLoop rejects a non-owner client', async () => {
  await assert.rejects(runDailyLoop(deps(createMemoryRunStore()), { clientId: 'someone-else' }), /limited to the owner/);
});

test('runDailyLoop replay: inputs listed with freshness; unapproved Brain is a gap', async () => {
  const { run } = await runDailyLoop(deps(createMemoryRunStore()), { clientId: OWNER });
  assert.equal(run.status, 'complete');
  assert.equal(run.mode, 'replay');
  assert.equal(run.brainVersion, null);
  assert.ok(run.gaps.some((g) => g.code === 'brain-not-approved'));
  assert.ok(run.gaps.some((g) => g.code === 'feedback-loop-manual'));
  assert.deepEqual(run.inputs.map((i) => i.input), ['watchlist scan', 'brand-topic search', 'content library', 'Client Brain', 'Strategy Builder plan', 'strategy slots', 'own-account history', 'benchmark report']);
  assert.equal(run.inputs.find((i) => i.input === 'Strategy Builder plan').status, 'excluded');
});

test('rerun: unchanged inputs skip; forced rerun keeps reviewed work', async () => {
  const store = createMemoryRunStore();
  const d = deps(store);
  const { run } = await runDailyLoop(d, { clientId: OWNER });
  assert.equal((await runDailyLoop(d, { clientId: OWNER })).skipped, true);
  const key = { clientId: OWNER, localDate: LOCAL, channel: 'x', version: run.version };
  await dismissSuggestion({ store, now: () => NOW }, { key, suggestionId: run.suggestions[0].id });
  const forced = await runDailyLoop(d, { clientId: OWNER, force: true });
  assert.equal(forced.run.suggestions.find((s) => s.id === run.suggestions[0].id).reviewState, 'dismissed');
});

test('save draft: concurrent saves → one unscheduled row; blocked edit rejected; dismissed refused', async () => {
  const store = createMemoryRunStore();
  const { run } = await runDailyLoop(deps(store), { clientId: OWNER });
  const key = { clientId: OWNER, localDate: LOCAL, channel: 'x', version: run.version };
  const rows = new Map();
  const saveDeps = {
    store, now: () => NOW,
    getPackage: async (id) => pkg(id),
    createDraftPostOnce: async (clientId, postId, payload) => {
      if (rows.has(postId)) return { post: rows.get(postId), existing: true };
      const post = { id: postId, clientId, ...payload, status: 'draft', scheduledAt: null };
      rows.set(postId, post);
      return { post, existing: false };
    },
  };
  const s = run.suggestions[0];
  await assert.rejects(saveSuggestionDraft(saveDeps, { key, suggestionId: s.id, text: 'edited #hashtag' }), /Blocked/);
  const [a, b] = await Promise.all([1, 2].map(() => saveSuggestionDraft(saveDeps, { key, suggestionId: s.id })));
  assert.equal(a.postId, b.postId);
  assert.equal(rows.size, 1);
  const row = [...rows.values()][0];
  assert.equal(row.status, 'draft');
  assert.equal(row.scheduledAt, null);
  assert.equal(row.packageId, s.package.id);
  assert.equal(row.sourceRef.opportunityUrl, s.opportunity?.url || null);
  if (s.type === 'reply') assert.equal(row.replyTo.url, s.opportunity.url);
  if (s.type === 'quote') assert.ok(row.content.endsWith(s.opportunity.url));
  if (run.suggestions[1]) {
    await dismissSuggestion(saveDeps, { key, suggestionId: run.suggestions[1].id });
    await assert.rejects(saveSuggestionDraft(saveDeps, { key, suggestionId: run.suggestions[1].id }), /dismissed/);
  }
  // Package lost its rights after the run → save refused.
  if (run.suggestions[2]) {
    const off = { ...saveDeps, getPackage: async (id) => ({ ...pkg(id), rights: 'never-public' }) };
    await assert.rejects(saveSuggestionDraft(off, { key, suggestionId: run.suggestions[2].id }), /no longer eligible/);
  }
  assert.equal(runDocId(key), `${OWNER}__${LOCAL}__x__v${run.version}`);
});
