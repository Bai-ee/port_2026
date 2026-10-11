// Quote slot filler: P1 fit is vein + guard lane, not owned vocabulary.
// Real candidates come from the saved scan fixture; posts marked INVENTED are not real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fillQuoteSlot, QUOTE_WINDOW_HOURS } from '../daily-loop/fill-quote.js';
import { normalizeConversationPost } from '../daily-loop/conversations.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/daily-loop-real-shapes.json', import.meta.url), 'utf8'));
const NOW = Date.parse(fixture.now);
const real = fixture.scan.candidates.map((c) => ({ ...normalizeConversationPost(c, 'scan'), score: c.score }));
const byAuthor = (a) => real.find((c) => c.author === a);
const slot = { letter: 'A', type: 'quote-react', lane: null, pillar: 'P1' };
const isoAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();
// INVENTED: minimal posts for cases the fixture does not cover.
const post = (id, text, extra = {}) => ({ id, text, createdAt: isoAgo(2), likes: 100, score: 0.5, hasMedia: true, ...extra });

test('a watchlist design post fills a quote-react slot with no owned content', () => {
  const r = fillQuoteSlot({ slot, candidates: [byAuthor('SciFiArchives')], now: NOW });
  assert.equal(r.post.author, 'SciFiArchives');
  assert.equal(r.fit.vein, 'retro-analog-preinternet');
  assert.equal(r.related, null);
});

test('a deep-house lifestyle post never fills the slot', () => {
  // INVENTED: shape of the real @Lush_Beauty1 post named in the spine doc.
  const lush = post('1', 'Deep house music is so soothing', { author: 'Lush_Beauty1' });
  const r = fillQuoteSlot({ slot, candidates: [lush], now: NOW });
  assert.equal(r.post, undefined);
  assert.equal(r.gap.code, 'slot-unfilled:A');
  assert.equal(r.gap.reason, '1 candidates, none on a P1 vein');
  assert.equal(r.rejected.offVein, 1);
});

test('a vein match within tolerance beats a higher-scoring off-vein post', () => {
  // applefiles_ is the Grok joke (now rejected); SciFiArchives stands in as the retro top score at its 0.8845.
  const a = { ...byAuthor('SciFiArchives'), score: byAuthor('applefiles_').score };
  const b = byAuthor('rare_jpg'); // 0.5659 japanese: gap 0.32, outside tolerance
  const close = { ...b, score: a.score - 0.1 };
  const vSlot = { ...slot, lane: 'japanese-asian-design' };
  assert.equal(fillQuoteSlot({ slot: vSlot, candidates: [a, close], now: NOW }).post.author, 'rare_jpg');
  assert.equal(fillQuoteSlot({ slot: vSlot, candidates: [a, b], now: NOW }).post.author, 'SciFiArchives');
});

test('casino and hard-blocked posts never fill, even with a scan vein', () => {
  const rug = post('2', 'this one is going to moon, ape in now', { vein: 'retro-analog-preinternet', score: 0.99 });
  const ticker = post('3', '$FOO price target 10x gain from here', { score: 0.99 });
  const r = fillQuoteSlot({ slot, candidates: [rug, ticker], now: NOW });
  assert.equal(r.gap.code, 'slot-unfilled:A');
  assert.equal(r.rejected.blocked, 2);
  const withGood = fillQuoteSlot({ slot, candidates: [rug, byAuthor('SciFiArchives')], now: NOW });
  assert.equal(withGood.post.author, 'SciFiArchives');
});

test('used ids are skipped', () => {
  const first = byAuthor('applefiles_');
  const r = fillQuoteSlot({ slot, candidates: real, now: NOW, usedIds: [first.id] });
  assert.notEqual(r.post.id, first.id);
  assert.equal(r.rejected.used, 1);
});

test('stale candidates are skipped at the named window', () => {
  const stale = post('4', 'Star Wars poster from Japan', { vein: 'retro-analog-preinternet', createdAt: isoAgo(QUOTE_WINDOW_HOURS + 1) });
  const fresh = post('5', 'Star Wars poster from Japan', { vein: 'retro-analog-preinternet', createdAt: isoAgo(QUOTE_WINDOW_HOURS - 1) });
  const r = fillQuoteSlot({ slot, candidates: [stale, fresh], now: NOW });
  assert.equal(r.post.id, '5');
  assert.equal(r.rejected.stale, 1);
  const only = fillQuoteSlot({ slot, candidates: [stale], now: NOW });
  assert.equal(only.gap.reason, 'no fresh candidates');
});

test('empty candidates give a visible gap with a reason', () => {
  const r = fillQuoteSlot({ slot: { ...slot, letter: 'D' }, candidates: [], now: NOW });
  assert.deepEqual(r.gap, { code: 'slot-unfilled:D', reason: 'no candidates' });
});

test('a non-quote slot is a gap, not a fill', () => {
  const r = fillQuoteSlot({ slot: { letter: 'B', type: 'original-text' }, candidates: real, now: NOW });
  assert.match(r.gap.reason, /not a quote slot/);
});

test('related is optional: absent never blocks, a clear match adds a note', () => {
  const p = post('6', 'Cajual Records flyer from Chicago, 1994', { vein: 'retro-analog-preinternet' });
  const pkg = { id: 'pkg1', title: 'Cajual Records flyer', story: '' };
  assert.equal(fillQuoteSlot({ slot, candidates: [p], now: NOW, related: [] }).related, null);
  assert.equal(fillQuoteSlot({ slot, candidates: [p], now: NOW, related: [pkg] }).related.id, 'pkg1');
  // One shared word, or only weak words ("deep house"), is not related.
  const weak = { id: 'pkg2', title: 'Deep House Mix' };
  const q = post('7', 'deep house mix poster', { vein: 'retro-analog-preinternet' });
  const r = fillQuoteSlot({ slot, candidates: [q], now: NOW, related: [weak] });
  assert.equal(r.post.id, '7');
  assert.equal(r.related, null);
});

test('a post addressing an AI bot is rejected addressesBot even with media and a vein', () => {
  // INVENTED: mirrors the real @applefiles_ "Hey @grok, remove the worst Pro ..." shape from the dry run.
  const joke = post('8', 'Hey @grok, remove the worst Pro https://t.co/abc', { author: 'applefiles_', vein: 'retro-analog-preinternet', hasMedia: true, score: 0.99 });
  const mention = post('9', 'asked @ChatGPT to redesign this Star Wars poster', { vein: 'retro-analog-preinternet' });
  const r = fillQuoteSlot({ slot, candidates: [joke, mention], now: NOW });
  assert.equal(r.post, undefined);
  assert.equal(r.rejected.addressesBot, 2);
  assert.match(r.gap.reason, /2 addresses an AI bot/);
});

test('a text-only post from a watchlist account is rejected noMedia', () => {
  const textOnly = post('10', 'Star Wars poster from Japan', { author: 'SciFiArchives', vein: 'retro-analog-preinternet', hasMedia: false });
  const r = fillQuoteSlot({ slot, candidates: [textOnly], now: NOW });
  assert.equal(r.post, undefined);
  assert.equal(r.rejected.noMedia, 1);
  assert.match(r.gap.reason, /1 no media/);
});

test('a non-empty media array counts as media; a media post from a watchlist account fills', () => {
  const withArray = post('11', 'Star Wars poster from Japan', { vein: 'retro-analog-preinternet', hasMedia: undefined, media: [{ type: 'photo' }] });
  assert.equal(fillQuoteSlot({ slot, candidates: [withArray], now: NOW }).post.id, '11');
  const ok = fillQuoteSlot({ slot, candidates: [byAuthor('SciFiArchives')], now: NOW });
  assert.equal(ok.post.author, 'SciFiArchives');
  assert.equal(ok.rejected.noMedia, 0);
  assert.equal(ok.rejected.addressesBot, 0);
});
