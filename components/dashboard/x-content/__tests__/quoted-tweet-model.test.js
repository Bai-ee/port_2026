import test from 'node:test';
import assert from 'node:assert/strict';
import {
  quotedRefOf, localQuotedPreview, needsQuotedLookup, quotedLookupBody, quotedDateLabel, quotedCardView,
} from '../quoted-tweet-model.js';
import { parseStatusUrl, findQuotedCandidate, buildQuotedPreview } from '../../../../features/x-quote-targets/quoted-preview.js';
import { buildMonthCalendar } from '../../../../features/x-content-inventory/month-calendar.js';

const URL1 = 'https://x.com/seb__design/status/1234567890123';
const requote = {
  kind: 'requote', id: 'requote:1234567890123', quoteTargetId: '1234567890123', quotedUrl: URL1, handle: 'seb__design', quotedHandle: 'seb__design',
  quotedText: 'Original text', text: 'Original text', quotedAuthorName: 'Seb', quotedHasMedia: true, createdAt: '2026-10-17T10:00:00.000Z',
};

test('parseStatusUrl canonicalizes, and /i/status has no handle', () => {
  assert.deepEqual(parseStatusUrl('https://twitter.com/Foo/statuses/12345678?s=20'), { handle: 'Foo', id: '12345678', url: 'https://x.com/Foo/status/12345678' });
  assert.equal(parseStatusUrl('https://x.com/i/status/12345678').handle, null);
  assert.equal(parseStatusUrl('https://example.com/a/status/12345678'), null);
  assert.equal(parseStatusUrl(''), null);
});

test('findQuotedCandidate matches by id or url, dismissed or not', () => {
  const list = [{ id: '1', url: 'https://x.com/a/status/11111' }, { id: 'x', url: 'https://x.com/b/status/22222' }];
  assert.equal(findQuotedCandidate(list, '22222').id, 'x');
  assert.equal(findQuotedCandidate(list, '1').url, 'https://x.com/a/status/11111');
  assert.equal(findQuotedCandidate(list, '999'), null);
  assert.equal(findQuotedCandidate(null, '1'), null);
});

test('buildQuotedPreview: found vs url-only fallback; string and object authors', () => {
  const f = buildQuotedPreview({ url: URL1, candidate: { id: '1234567890123', author: 'seb__design', authorName: 'Seb', text: 'hi', createdAt: '2026-10-17T10:00:00Z', hasMedia: true } });
  assert.deepEqual([f.found, f.handle, f.authorName, f.text, f.hasMedia, f.mediaUrl], [true, 'seb__design', 'Seb', 'hi', true, null]);
  const o = buildQuotedPreview({ url: URL1, candidate: { author: { username: 'zed', name: 'Zed' }, text: 't' } });
  assert.deepEqual([o.handle, o.authorName], ['zed', 'Zed']);
  const u = buildQuotedPreview({ url: URL1 });
  assert.deepEqual([u.found, u.text, u.handle, u.url], [false, null, 'seb__design', URL1]);
  assert.equal(buildQuotedPreview({ url: 'nope' }), null);
});

test('requote row: ref, inline preview, no server lookup needed', () => {
  assert.equal(quotedRefOf(requote).id, '1234567890123');
  const p = localQuotedPreview(requote);
  assert.deepEqual([p.found, p.text, p.authorName, p.hasMedia], [true, 'Original text', 'Seb', true]);
  assert.equal(needsQuotedLookup(requote), false);
});

test('saved quote post: URL from sourceRef or trailing URL; lookup goes by post id', () => {
  const viaRef = { id: 'p1', status: 'draft', content: 'my take', sourceRef: { kind: 'quote-target', url: URL1, id: '1234567890123' } };
  assert.equal(quotedRefOf(viaRef).url, URL1);
  assert.equal(needsQuotedLookup(viaRef), true);
  assert.deepEqual(quotedLookupBody(viaRef), { postId: 'p1' });
  const viaText = { id: 'p2', content: `my take\n\n${URL1}` };
  assert.equal(quotedRefOf(viaText).id, '1234567890123');
});

test('rows that quote nothing render nothing', () => {
  assert.equal(quotedRefOf({ id: 'p', content: 'plain post' }), null);
  assert.equal(quotedRefOf({ kind: 'suggestion', quotedUrl: null }), null);
  assert.equal(quotedRefOf({ id: 'p', replyTo: { url: URL1 }, content: URL1 }), null);
  assert.equal(quotedRefOf({ kind: 'repost', content: URL1 }), null);
  assert.equal(quotedRefOf(null), null);
  assert.equal(needsQuotedLookup({ id: 'p', content: 'x' }), false);
  assert.equal(quotedLookupBody({ id: 'p', content: 'x' }), null);
});

test('quotedCardView: full, name-less and text-less fallbacks', () => {
  const v = quotedCardView(localQuotedPreview(requote));
  assert.deepEqual([v.displayName, v.handleLabel, v.dateLabel, v.hasText, v.openUrl, v.summaryLabel], ['Seb', '@seb__design', 'Oct 17, 2026', true, URL1, 'Quoting @seb__design']);
  assert.match(v.mediaNote, /image or video/);
  const bare = quotedCardView(buildQuotedPreview({ url: URL1 }));
  assert.deepEqual([bare.displayName, bare.handleLabel, bare.hasText], ['@seb__design', '', false]);
  assert.match(bare.missingNote, /Open it on X/);
  assert.equal(quotedCardView(null), null);
  assert.equal(quotedDateLabel('garbage'), '');
});

test('month calendar requote row carries the quoted fields (read-only projection)', () => {
  const now = Date.parse('2026-10-18T15:00:00Z');
  const cal = buildMonthCalendar({
    posts: [], month: '2026-10', now,
    quoteTargets: [{ id: '1234567890123', url: URL1, handle: 'seb__design', text: 'Original text', createdAt: '2026-10-18T10:00:00Z', authorName: 'Seb', hasMedia: true }],
  });
  const row = cal.weeks.flat().flatMap((d) => d.posts).find((r) => r.kind === 'requote');
  assert.ok(row, 'requote row present');
  assert.deepEqual([row.quotedText, row.quotedAuthorName, row.quotedHasMedia, row.quotedUrl], ['Original text', 'Seb', true, URL1]);
  assert.equal(localQuotedPreview(row).found, true);
});
