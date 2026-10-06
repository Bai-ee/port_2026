import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateStats, buildShowcase, parseWaitlistBody, waitlistToCsv, waitlistDocId, relativeTime, storyFromContent,
} from '../records-helpers.js';

const v = (u) => ({ url: u });
const post = (o) => ({
  source: 'discogs-ingest', status: 'draft', sourceRef: { releaseId: 1, discogsUrl: 'https://www.discogs.com/release/1' },
  content: 'Artist – Title\nLabel · CAT1 · 1999\n\nmy story', mediaType: 'video', mediaUrl: 'm.mp4',
  mediaVariants: { video: { '1x1': v('a.mp4'), '9x16': v('b.mp4') }, image: { '1x1': v('l.jpg') } },
  ...o,
});

test('aggregateStats counts only, ignores non-discogs packages', () => {
  const s = aggregateStats(
    [{ id: 'discogs-1', status: 'idea' }, { id: 'discogs-2', status: 'drafted' }, { id: 'other-3', status: 'idea' }],
    [post({ updatedAt: '2026-10-01T00:00:00Z' }), post({ status: 'posted', updatedAt: '2026-10-03T00:00:00Z' }), post({ status: 'scheduled' })],
  );
  assert.equal(s.recordsProcessed, 2);
  assert.equal(s.clipsRendered, 6);
  assert.equal(s.postsPublished, 1);
  assert.equal(s.postsScheduled, 1);
  assert.equal(s.postsDrafted, 1);
  assert.equal(s.lastProcessedAt, '2026-10-03T00:00:00.000Z');
  assert.deepEqual(s.packagesByStatus, { idea: 1, drafted: 1 });
  assert.equal(JSON.stringify(s).includes('story'), false);
});

test('aggregateStats handles empty input', () => {
  const s = aggregateStats();
  assert.equal(s.recordsProcessed, 0);
  assert.equal(s.lastProcessedAt, null);
});

test('buildShowcase: only posted or showcase; story from content', () => {
  const posts = [post({ status: 'posted', twitterId: '123', postedAt: '2026-10-02T00:00:00Z' }), post({ sourceRef: { releaseId: 2 } }), post({ sourceRef: { releaseId: 3 } })];
  const pkgs = [{ id: 'discogs-3', showcase: true, story: 'pkg story' }];
  const cards = buildShowcase(pkgs, posts);
  assert.equal(cards.length, 2);
  const posted = cards.find((c) => c.releaseId === 1);
  assert.equal(posted.artist, 'Artist');
  assert.equal(posted.title, 'Title');
  assert.equal(posted.meta, 'Label · CAT1 · 1999');
  assert.equal(posted.story, 'my story');
  assert.equal(posted.xUrl, 'https://x.com/i/status/123');
  const show = cards.find((c) => c.releaseId === 3);
  assert.equal(show.story, 'pkg story');
  assert.equal(show.xUrl, null);
});

test('buildShowcase hides placeholder story', () => {
  const [c] = buildShowcase([], [post({ status: 'posted', content: 'A – B\nL · C\n\n[add your memory]' })]);
  assert.equal(c.story, null);
  assert.equal(storyFromContent('A – B\n\n[add your memory]'), null);
});

test('parseWaitlistBody normalises', () => {
  const r = parseWaitlistBody({ email: '  Foo@Bar.COM ', role: 'DJ', collectionSize: '1k–10k', discogsUsername: '@me', utm: { utm_source: 'x', evil: 'y' } });
  assert.equal(r.ok, true);
  assert.equal(r.value.email, 'foo@bar.com');
  assert.equal(r.value.role, 'dj');
  assert.equal(r.value.collectionSize, '1k-10k');
  assert.equal(r.value.discogsUsername, 'me');
  assert.deepEqual(r.value.utm, { utm_source: 'x' });
});

test('parseWaitlistBody rejects bad email, drops honeypot', () => {
  assert.equal(parseWaitlistBody({ email: 'nope' }).ok, false);
  assert.equal(parseWaitlistBody({}).ok, false);
  assert.equal(parseWaitlistBody({ email: 'a@b.co', website: 'spam' }).honeypot, true);
  assert.equal(parseWaitlistBody({ email: 'a@b.co', role: 'wizard' }).value.role, '');
});

test('csv escapes and neutralises formulas; doc id stable', () => {
  const csv = waitlistToCsv([{ email: 'a@b.co', name: '=cmd', note: 'hi, "there"' }]);
  assert.match(csv, /'=cmd/);
  assert.match(csv, /"hi, ""there"""/);
  assert.equal(waitlistDocId('a.b@c.co'), waitlistDocId('a.b@c.co'));
  assert.ok(!waitlistDocId('a/b@c.co').includes('/'));
});

test('relativeTime', () => {
  const now = Date.parse('2026-10-05T12:00:00Z');
  assert.equal(relativeTime('2026-10-05T11:55:00Z', now), '5 min ago');
  assert.equal(relativeTime('2026-10-05T09:00:00Z', now), '3 hr ago');
  assert.equal(relativeTime(null, now), null);
});
