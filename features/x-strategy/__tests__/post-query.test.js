import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePost, queryPosts, quotedUrlOf, postedUrlOf, kindOf, countByKind } from '../post-query.js';
import { runReadTool, READ_TOOL_NAMES } from '../agent/tools.js';

const NOW = Date.parse('2026-10-17T12:00:00Z');
const Q = 'https://x.com/alice/status/1234567890123';

const fixtures = {
  fillQuote: { id: 'fq', status: 'draft', content: 'my take [add your take]', source: 'daily-fill', fillKind: 'quote', reviewOn: '2026-10-17', bucketId: 'design', needsStory: true,
    expiresAt: '2026-10-18T00:00:00Z', sourceRef: { kind: 'quote-target', url: 'https://twitter.com/alice/status/1234567890123?s=20', id: '1234567890123', handle: 'alice' } },
  fillQuoteNoUrl: { id: 'fq2', status: 'draft', content: 'x', sourceRef: { kind: 'quote-target', id: '9999999999', handle: 'bob' } },
  loopQuote: { id: 'lq', status: 'scheduled', scheduledAt: '2026-10-19T15:00:00Z', content: 'hot take', source: 'daily-loop', sourceRef: { kind: 'daily-loop', suggestionType: 'quote-react', opportunityUrl: Q } },
  loopReply: { id: 'lr', status: 'draft', content: 'reply', replyTo: { url: Q, author: 'alice' }, sourceRef: { kind: 'daily-loop', suggestionType: 'reply', opportunityUrl: Q } },
  textQuote: { id: 'tq', status: 'draft', content: `Great thread\n\n${Q}`, source: 'quote-targets' },
  repost: { id: 'rp', status: 'scheduled', scheduledAt: '2026-10-20T03:00:00Z', kind: 'repost', content: 'Repost @alice x', repostOf: { tweetId: '1234567890123', url: 'https://x.com/i/status/1234567890123', author: 'alice' } },
  defensive: { id: 'df', status: 'draft', content: 'a', quoteTweetId: '5555555555' },
  original: { id: 'og', status: 'approved', content: 'plain post, see https://example.com', scheduledAt: '2026-10-18T14:00:00Z', mediaUrl: 'https://m/x.mp4', mediaType: 'video' },
  postedApi: { id: 'pa', status: 'posted', content: 'done', twitterId: '1888888888', postedAt: '2026-10-10T10:00:00Z' },
  postedManual: { id: 'pm', status: 'posted', content: 'done', permalink: 'https://x.com/me/status/1777777777?x=1' },
};

test('kind + quotedUrl from every carrier', () => {
  assert.equal(quotedUrlOf(fixtures.fillQuote), Q);
  assert.equal(quotedUrlOf(fixtures.fillQuoteNoUrl), 'https://x.com/bob/status/9999999999');
  assert.equal(quotedUrlOf(fixtures.loopQuote), Q);
  assert.equal(quotedUrlOf(fixtures.textQuote), Q);
  assert.equal(quotedUrlOf(fixtures.defensive), 'https://x.com/i/status/5555555555');
  assert.equal(quotedUrlOf(fixtures.original), null);
  assert.equal(kindOf(fixtures.loopReply), 'reply');
  assert.equal(quotedUrlOf(fixtures.loopReply), null);
  assert.equal(kindOf(fixtures.repost), 'repost');
  assert.equal(quotedUrlOf(fixtures.repost), null);
  assert.equal(kindOf(fixtures.original), 'original');
});

test('repost, reply and posted links', () => {
  const r = normalizePost(fixtures.repost, { now: NOW });
  assert.equal(r.repostOfUrl, 'https://x.com/alice/status/1234567890123');
  assert.equal(normalizePost(fixtures.loopReply, { now: NOW }).replyToUrl, Q);
  assert.equal(postedUrlOf(fixtures.postedApi), 'https://x.com/i/status/1888888888');
  assert.equal(postedUrlOf(fixtures.postedManual), 'https://x.com/me/status/1777777777');
  assert.equal(postedUrlOf(fixtures.original), null);
});

test('day uses America/Chicago for scheduledAt, reviewOn otherwise; window flag on open quote drafts', () => {
  assert.equal(normalizePost(fixtures.repost, { now: NOW }).day, '2026-10-19'); // 03:00Z = previous evening CT
  assert.equal(normalizePost(fixtures.fillQuote, { now: NOW }).day, '2026-10-17');
  assert.equal(normalizePost(fixtures.fillQuote, { now: NOW }).windowOpen, true);
  assert.equal(normalizePost(fixtures.fillQuote, { now: Date.parse('2026-10-19T00:00:00Z') }).windowOpen, false);
  assert.equal(normalizePost(fixtures.original, { now: NOW }).windowOpen, null);
  const o = normalizePost(fixtures.original, { now: NOW });
  assert.deepEqual(o.media, { hasMedia: true, type: 'video' });
  assert.equal(normalizePost(fixtures.fillQuote, { now: NOW }).bucket, 'design');
  assert.equal(normalizePost({ id: 'x', content: 'a'.repeat(500) }, { now: NOW }).text.length, 200);
});

const all = Object.values(fixtures);

test('queryPosts filters by kind, day range, status, flags, text and limit', () => {
  const quotes = queryPosts(all, { kind: 'quote' }, { now: NOW });
  assert.deepEqual(quotes.rows.map((r) => r.id).sort(), ['df', 'fq', 'fq2', 'lq', 'tq']);
  assert.ok(quotes.rows.every((r) => r.quotedUrl));
  const week = queryPosts(all, { kind: 'quote', from: '2026-10-17', to: '2026-10-23' }, { now: NOW });
  assert.deepEqual(week.rows.map((r) => r.id), ['fq', 'lq']); // undated drafts never match a date filter
  assert.deepEqual(queryPosts(all, { kind: 'repost' }, { now: NOW }).rows.map((r) => r.id), ['rp']);
  assert.deepEqual(queryPosts(all, { status: ['posted'] }, { now: NOW }).rows.map((r) => r.id).sort(), ['pa', 'pm']);
  assert.deepEqual(queryPosts(all, { hasMedia: true }, { now: NOW }).rows.map((r) => r.id), ['og']);
  assert.deepEqual(queryPosts(all, { needsStory: true }, { now: NOW }).rows.map((r) => r.id), ['fq']);
  assert.deepEqual(queryPosts(all, { fillKind: 'quote' }, { now: NOW }).rows.map((r) => r.id), ['fq']);
  assert.deepEqual(queryPosts(all, { bucket: 'design' }, { now: NOW }).rows.map((r) => r.id), ['fq']);
  assert.deepEqual(queryPosts(all, { text: 'alice/status' }, { now: NOW }).rows.map((r) => r.id).sort(), ['fq', 'lq', 'lr', 'rp', 'tq']);
  const lim = queryPosts(all, { limit: 2 }, { now: NOW });
  assert.equal(lim.returned, 2); assert.equal(lim.total, all.length);
  assert.equal(queryPosts(all, { limit: 9999 }, { now: NOW }).returned, all.length);
  assert.equal(queryPosts(null, {}).total, 0);
  assert.deepEqual(countByKind(all, { now: NOW }), { quote: 5, repost: 1, reply: 1, original: 3 });
});

test('find_posts read tool: registered, wired to readPostsForQuery, closed over client, "not available" without a reader', async () => {
  assert.ok(READ_TOOL_NAMES.includes('find_posts'));
  const out = await runReadTool('find_posts', { kind: 'quote', clientId: 'evil' }, { now: () => NOW, readPostsForQuery: async () => all });
  assert.equal(out.total, 5);
  assert.equal(out.rows[0].quotedUrl.startsWith('https://x.com/'), true);
  assert.deepEqual(await runReadTool('find_posts', {}, {}), { error: 'not available' });
  const p = await runReadTool('get_post', { postId: 'lq' }, { readPost: async () => fixtures.loopQuote });
  assert.equal(p.kind, 'quote'); assert.equal(p.quotedUrl, Q);
});
