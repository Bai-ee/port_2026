// Slot orchestrator (selectForSlots), the vein map, null-package review, and the
// no-repeat quote-react fallback. Real shapes from fixtures/daily-loop-real-shapes.json
// and the committed own corpus; posts marked INVENTED are not real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectForSlots, selectSuggestions } from '../daily-loop/select.js';
import { planSlots } from '../daily-loop/slots.js';
import { buildDayPlan } from '../plan-day.js';
import { VEIN_MAP, veinsForLane, pillarForVein } from '../daily-loop/veins.js';
import { fillQuoteSlot } from '../daily-loop/fill-quote.js';
import { conversationPostsFrom, normalizeConversationPost } from '../daily-loop/conversations.js';
import { fallbackCopy, quoteReactFallback, checkSuggestionText } from '../daily-loop/copy.js';
import { saveSuggestionDraft, editSuggestion } from '../daily-loop/review.js';
import { createMemoryRunStore } from '../daily-run-store.js';
import { OWNER_CLIENT_IDS } from '../daily-loop/config.js';
import { WATCHLIST } from '../../x-quote-targets/watchlist.js';

const FX = JSON.parse(readFileSync(new URL('./fixtures/daily-loop-real-shapes.json', import.meta.url), 'utf8'));
const CORPUS = JSON.parse(readFileSync(new URL('../../../docs/audits/bai-ee-x-corpus.json', import.meta.url), 'utf8'));
const NOW = Date.parse(FX.now);
const OWNER = OWNER_CLIENT_IDS[0];
const LOCAL = '2026-10-10';
const slot = (letter, type, over = {}) => ({ letter, type, lane: null, pillar: null, timeCT: null, startsAt: null, manual: false, ...over });
const scanPosts = FX.scan.candidates.map((c) => ({ ...normalizeConversationPost(c, 'watchlist'), score: c.score }));
const showcasePkg = FX.packages.find((p) => p.source?.kind === 'discogs');
const base = { clientId: OWNER, localDate: LOCAL, now: NOW, packages: FX.packages, candidates: scanPosts, conversationPosts: conversationPostsFrom(FX) };

// --- veins ---

test('every vein in the watchlist is mapped to P1', () => {
  const veins = [...new Set(WATCHLIST.map((a) => a.vein))];
  assert.ok(veins.length >= 4);
  const unmapped = veins.filter((v) => !VEIN_MAP[v]);
  assert.deepEqual(unmapped, []);
  for (const v of veins) assert.equal(pillarForVein(v), 'P1');
});

test('calendar lanes prefer the veins that list them, strongest measured vein first', () => {
  assert.deepEqual(veinsForLane('music'), ['japanese-asian-design', 'retro-analog-preinternet']);
  assert.equal(veinsForLane('craft')[0], 'motion-generative');
  assert.ok(veinsForLane('work').includes('editorial-typography'));
  assert.deepEqual(veinsForLane('nonsense'), []);
  assert.deepEqual(veinsForLane(null), []);
});

test('fill-quote prefers a vein the slot lane favours, via the map (not name equality)', () => {
  // The real top-scoring retro post is the @grok joke (now rejected), so a media retro post carries its score.
  const a = { ...scanPosts.find((c) => c.author === 'SciFiArchives'), hasMedia: true, score: scanPosts.find((c) => c.author === 'applefiles_').score };
  // INVENTED: a motion-vein post just under the top score.
  const motion = { ...scanPosts.find((c) => c.author === 'rare_jpg'), vein: 'motion-generative', score: a.score - 0.1 };
  const pick = (lane) => fillQuoteSlot({ slot: slot('A', 'quote-react', { lane }), candidates: [a, motion], now: NOW });
  assert.equal(pick('craft').post.vein, 'motion-generative');
  assert.match(pick('craft').fit.reason, /preferred by craft lane/);
  // 'music' favours retro, already the top pick; no lane leaves the top score alone.
  assert.equal(pick('music').post.author, 'SciFiArchives');
  assert.equal(pick(null).post.author, 'SciFiArchives');
});

// --- orchestrator ---

test('a real watchlist post fills quote-react with no owned item; id hashes slot TYPE, not letter', () => {
  const run = (letter) => selectForSlots({ ...base, slots: [slot(letter, 'quote-react', { pillar: 'P1', timeCT: '09:30', startsAt: '2026-10-10T14:30:00.000Z' })] });
  const a = run('A');
  const s = a.suggestions[0];
  assert.equal(s.package, null);
  assert.equal(s.type, 'quote');
  assert.equal(s.opportunity.url.includes('/status/'), true);
  assert.equal(s.why.content, 'none required — reaction slot');
  assert.deepEqual(Object.keys(s.slot).sort(), ['fillReason', 'letter', 'lane', 'pillar', 'startsAt', 'timeCT', 'type'].sort());
  assert.equal(s.slot.fillReason.length > 0, true);
  assert.equal(s.proposedSlot.iso, '2026-10-10T14:30:00.000Z');
  assert.equal(run('C').suggestions[0].id, s.id);
});

test('a deep-house lifestyle post never fills quote-react; the slot becomes a visible gap', () => {
  // INVENTED: shape of the real @Lush_Beauty1 post named in the spine doc.
  const lush = { id: '1', text: 'Deep house music is so soothing', author: 'Lush_Beauty1', createdAt: new Date(NOW - 3_600_000).toISOString(), likes: 900 };
  const r = selectForSlots({ ...base, candidates: [lush], conversationPosts: [], slots: [slot('A', 'quote-react', { pillar: 'P1' })] });
  assert.equal(r.suggestions.length, 0);
  const g = r.gaps.find((x) => x.code === 'slot-unfilled:A');
  assert.match(g.message, /none on a P1 vein/);
});

test('cap 3 holds in strategy order, no post or package is shared, and later slots become gaps', () => {
  const slots = [
    slot('A', 'quote-react', { pillar: 'P1' }),
    slot('B', 'original-showcase', { pillar: 'P2' }),
    slot('C', 'original-text', { pillar: 'P3', lane: 'craft' }),
    slot('R', 'reply'),
    slot('D', 'self-quote'),
  ];
  const matchedSlots = [{ slot: 'B', packageId: showcasePkg.id, matchScore: 1, matchReason: 'never posted' }];
  const r = selectForSlots({ ...base, slots, matchedSlots, ownPosts: CORPUS, ownHandle: 'bai_ee' });
  assert.ok(r.suggestions.length <= 3);
  assert.deepEqual(r.suggestions.map((s) => s.slot.letter).slice(0, 2), ['A', 'B']);
  const pkgs = r.suggestions.map((s) => s.package?.id).filter(Boolean);
  assert.equal(new Set(pkgs).size, pkgs.length);
  const posts = r.suggestions.map((s) => s.opportunity?.id).filter(Boolean);
  assert.equal(new Set(posts).size, posts.length);
  const letters = new Set([...r.suggestions.map((s) => s.slot.letter), ...r.gaps.filter((g) => g.code.startsWith('slot-unfilled:')).map((g) => g.code.slice(-1))]);
  assert.deepEqual([...letters].sort(), ['A', 'B', 'C', 'D', 'R']);
});

test('fewer suggestions when slots cannot fill, each with a gap reason; retweet is manual', () => {
  const r = selectForSlots({
    ...base, packages: [], candidates: [], conversationPosts: [],
    slots: [slot('A', 'quote-react'), slot('B', 'original-showcase'), slot('C', 'original-text'), slot('R', 'reply'), slot('D', 'self-quote'), slot('E', 'retweet', { manual: true })],
  });
  assert.equal(r.suggestions.length, 0);
  const codes = r.gaps.filter((g) => g.code.startsWith('slot-unfilled:')).map((g) => g.code);
  assert.deepEqual(codes, ['A', 'B', 'C', 'R', 'D', 'E'].map((l) => `slot-unfilled:${l}`));
  assert.ok(r.gaps.every((g) => !g.code.startsWith('slot-unfilled:') || g.message.length > 20));
});

test('selectSuggestions delegates to the slot path when slots are given and keeps shortlist rows', () => {
  const r = selectSuggestions({ ...base, slots: [slot('A', 'quote-react', { pillar: 'P1' })] });
  assert.equal(r.suggestions[0].slot.letter, 'A');
  assert.ok(Array.isArray(r.shortlist));
  assert.ok(r.shortlist.some((x) => x.skipped), 'skipped conversations stay visible');
  assert.equal(typeof r.stats.narratives, 'number');
});

test('real planSlots output drives the orchestrator end to end', () => {
  const { slots, plan } = planSlots({ buildDayPlan, input: { corpusRows: CORPUS, packages: FX.packages, date: LOCAL, now: NOW } });
  const r = selectForSlots({ ...base, slots, matchedSlots: plan.slots, ownPosts: CORPUS, ownHandle: 'bai_ee' });
  assert.ok(r.suggestions.length <= 3);
  const quote = r.suggestions.find((s) => s.slot.type === 'quote-react');
  assert.ok(quote && quote.package === null);
});

// --- null package through review ---

async function quoteReactRun() {
  const r = selectForSlots({ ...base, slots: [slot('A', 'quote-react', { pillar: 'P1' })] });
  const s = { ...r.suggestions[0], draft: { text: 'clean work.', selfReply: '', source: 'fallback' }, edit: null, reviewState: 'pending', socialPostId: null };
  const store = createMemoryRunStore();
  const key = { clientId: OWNER, localDate: LOCAL, channel: 'x', version: 3 };
  await store.claim({ key, fingerprint: 'f', force: true, now: NOW });
  await store.complete({ ...key, status: 'running', suggestions: [s], gaps: [], usage: {} });
  const rows = new Map();
  const deps = {
    store, now: () => NOW,
    getPackage: async () => { throw new Error('a reaction slot must not look up a package'); },
    createDraftPostOnce: async (clientId, postId, payload) => { const post = { id: postId, clientId, ...payload, status: 'draft' }; rows.set(postId, post); return { post, existing: false }; },
  };
  return { s, key, deps, rows };
}

test('editing and saving a quote-react suggestion with package:null works', async () => {
  const { s, key, deps, rows } = await quoteReactRun();
  const edited = await editSuggestion(deps, { key, suggestionId: s.id, text: 'the detail does it.' });
  assert.equal(edited.reviewState, 'edited');
  assert.equal(edited.edit.checks.blocked, false);
  const saved = await saveSuggestionDraft(deps, { key, suggestionId: s.id });
  assert.equal(saved.ok, true);
  const row = rows.get(saved.postId);
  assert.equal(row.packageId, null);
  assert.equal(row.engine, null);
  assert.match(row.content, /^the detail does it\.\n\nhttps:\/\/x\.com\//);
});

// --- fallback never repeats within a run ---

test('quote-react fallbacks never repeat across 3+ suggestions in one run', () => {
  const sug = (id) => ({ type: 'quote', slot: { type: 'quote-react', letter: 'A' }, opportunity: { id, text: 'x' }, package: null });
  const used = new Set();
  const lines = [];
  // Same-id posts hash to the same line, the worst case for repeats.
  for (const id of ['9', '9', '9', '9', '9', '9', '9', '9']) {
    const line = fallbackCopy(sug(id), { usedLines: used });
    used.add(line);
    lines.push(line);
  }
  assert.equal(new Set(lines).size, 8);
  assert.ok(lines.every((l) => l.length < 50 && !/[?#]|https?:/.test(l)));
  // Exhausted: returns '' rather than repeating.
  assert.equal(quoteReactFallback({ post: { id: '9' }, usedLines: lines }), '');
  assert.equal(quoteReactFallback({ post: { id: '9' } }), quoteReactFallback({ post: { id: '9' } }));
});

test('the orchestrator output passes the copy checks with its fallback line', () => {
  const r = selectForSlots({ ...base, slots: [slot('A', 'quote-react', { pillar: 'P1' })] });
  const s = r.suggestions[0];
  assert.equal(checkSuggestionText(fallbackCopy(s), s).blocked, false);
});
