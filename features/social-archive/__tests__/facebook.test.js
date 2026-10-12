import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readerFromMap } from '../fs-reader.js';
import { sanitizeEntry } from '../schema.js';
import { createHash } from 'node:crypto';
import { ADAPTER, detect, parse, parseFbDate, zonedToUtcIso, unescapeHtml, splitFbMeta } from '../adapters/facebook.js';

const FX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '__fixtures__', 'facebook');
const fx = (n) => fs.readFileSync(path.join(FX, n), 'utf8');
const pageFiles = () => ({
  'posts/posts_1.html': fx('posts_1.html'),
  'photos_and_videos/album/0.html': fx('album_0.html'),
  'events/events.html': fx('events.html'),
  'page_profile_information/no-data.txt': 'none',
});
const run = (files = pageFiles(), extra = {}) => parse({ reader: readerFromMap(files), account: 'Test Page', archiveName: 'fb-test', ...extra });

test('ADAPTER id', () => assert.equal(ADAPTER, 'facebook-html'));

test('detect true/false', () => {
  assert.equal(detect(readerFromMap(pageFiles())), true);
  assert.equal(detect(readerFromMap({ 'events/events.html': fx('events.html') })), true);
  assert.equal(detect(readerFromMap({})), false);
  assert.equal(detect(readerFromMap({ 'data/tweets.js': 'x', 'posts/posts_1.html': '<html>' })), false);
  assert.equal(detect(readerFromMap({ 'messages/inbox/a.html': 'x' })), false);
});

test('timezone: summer (CDT) and winter (CST) convert to UTC', () => {
  assert.equal(parseFbDate('Jul 4, 2019, 9:05 PM'), '2019-07-05T02:05:00.000Z');
  assert.equal(parseFbDate('Jan 15, 2019, 8:30 AM'), '2019-01-15T14:30:00.000Z');
  assert.equal(parseFbDate('Dec 1, 2019, 12:00 AM'), '2019-12-01T06:00:00.000Z');
  assert.equal(parseFbDate('Jun 2, 2019, 12:30 PM', 'UTC'), '2019-06-02T12:30:00.000Z');
  // DST boundary: 2019-03-10 02:00 local jumps; 3:30 AM is CDT
  assert.equal(zonedToUtcIso({ y: 2019, mo: 2, d: 10, h: 3, mi: 30 }, 'America/Chicago'), '2019-03-10T08:30:00.000Z');
  assert.equal(parseFbDate('garbage'), null);
});

test('posts: text, media, timestamps, boilerplate excluded', () => {
  const { entries, stats } = run();
  const posts = entries.filter((e) => e.kind === 'post');
  const summer = posts.find((e) => e.text.startsWith('Summer night'));
  assert.ok(summer);
  assert.equal(summer.ts, '2019-07-05T02:05:00.000Z');
  assert.equal(summer.tsKind, 'posted');
  assert.equal(summer.tsSource, 'facebook-posts-html');
  assert.equal(summer.tsConfidence, 'medium');
  assert.equal(summer.audience, 'public');
  assert.equal(summer.text, 'Summer night at the fake venue Some Friend & crew.\nInfo: https://example.com/t');
  assert.deepEqual(summer.media.map((m) => m.relPath), ['photos_and_videos/AlbumOne_abc/p1_n_111.jpg', 'photos_and_videos/AlbumOne_abc/p2_n_222.jpg']);
  assert.ok(!/Updated|Caption duplicate|Upload IP|Fake Group/.test(summer.text));
  // media-only post, link-only post, video post
  const photo = posts.find((e) => e.ts === '2019-01-15T14:30:00.000Z');
  assert.equal(photo.text, '');
  assert.equal(photo.media.length, 1);
  assert.equal(posts.find((e) => e.text === 'https://youtu.be/fakeid').media.length, 0);
  const vid = posts.find((e) => e.text === 'Clip time');
  assert.deepEqual(vid.media, [{ type: 'video', relPath: 'photos_and_videos/videos/clip_444.mp4' }]);
  assert.equal(vid.ts, '2019-12-02T05:59:00.000Z');
  // skipped bookkeeping
  assert.equal(stats.skipped['post-empty'], 1);
  assert.equal(stats.skipped['post-no-timestamp'], 1);
  assert.equal(stats.skipped['duplicate-platformId'], 1);
});

test('data: URIs and fbcdn srcs are never media', () => {
  const { entries } = run();
  for (const e of entries) for (const m of e.media) {
    assert.ok(m.relPath.startsWith('photos_and_videos/'), m.relPath);
    assert.ok(!m.relPath.includes('fbcdn') && !m.relPath.startsWith('data:') && !m.relPath.includes('thumbnails/'));
  }
});

test('albums: per-photo upload time, album title, caption; post-carried photo skipped only on same path and day', () => {
  const { entries, stats } = run();
  const media = entries.filter((e) => e.kind === 'media');
  // p1 on Jul 4 2019 (same local day as the post carrying it) is skipped; p1 on Aug 9 is kept; p5 kept.
  assert.equal(media.length, 2);
  const aug = media.find((e) => e.ts === '2019-08-10T02:00:00.000Z');
  assert.equal(aug.album, 'Album One & Friends');
  assert.equal(aug.tsSource, 'facebook-album-html');
  assert.equal(aug.tsKind, 'posted');
  assert.deepEqual(aug.media.map((m) => m.relPath), ['photos_and_videos/AlbumOne_abc/p1_n_111.jpg']);
  assert.equal(aug.text, '');
  const winter = media.find((e) => e.ts === '2018-12-20T21:15:00.000Z');
  assert.equal(winter.text, 'Winter Pal caption <3');
  assert.equal(stats.skipped['album-photo-carried-by-post'], 1);
  assert.ok(!media.some((e) => /203\.0\.113/.test(e.text)));
});

test('events: start time, place, description', () => {
  const { entries, stats } = run();
  const ev = entries.filter((e) => e.kind === 'event');
  assert.equal(ev.length, 2);
  const fake = ev.find((e) => e.place === 'Fake Hall, Testville');
  assert.equal(fake.ts, '2020-03-14T02:00:00.000Z'); // 9 PM CDT (UTC-5) on Mar 13
  assert.equal(fake.tsKind, 'event');
  assert.equal(fake.tsSource, 'facebook-events-html');
  assert.ok(fake.text.startsWith('/// FAKE NIGHT ///'));
  assert.ok(fake.text.includes('Come dance.'));
  const online = ev.find((e) => e.place === 'Online');
  assert.equal(online.ts, '2020-04-22T01:00:00.000Z');
  assert.equal(stats.skipped['event-no-start'], 1);
});

test('tz option and audience for personal exports', () => {
  const files = pageFiles();
  delete files['page_profile_information/no-data.txt'];
  const { entries } = run(files, { tz: 'UTC' });
  const p = entries.find((e) => e.text.startsWith('Summer night'));
  assert.equal(p.ts, '2019-07-04T21:05:00.000Z');
  assert.equal(p.tsConfidence, 'high');
  assert.equal(p.audience, 'unknown');
});

test('missing files tolerated', () => {
  const r = run({ 'page_profile_information/x': '1' });
  assert.deepEqual(r.entries, []);
  assert.equal(r.stats.entries, 0);
  assert.ok(r.warnings.length >= 1);
  const onlyEvents = run({ 'events/events.html': fx('events.html') });
  assert.equal(onlyEvents.stats.byKind.event, 2);
});

test('allowlist: DMs and other folders are never read', () => {
  const reads = [];
  const base = readerFromMap({ ...pageFiles(), 'messages/inbox/x/message_1.html': 'SECRET', 'comments/comments.html': 'SECRET', 'ads_and_businesses/a.html': 'SECRET' });
  const reader = { ...base, read: (rel) => { reads.push(rel); return base.read(rel); } };
  parse({ reader, account: 'Test Page', archiveName: 'fb-test' });
  assert.ok(reads.length > 0);
  for (const r of reads) assert.match(r, /^(posts\/|photos_and_videos\/album\/|events\/events\.html)/);
});

test('deterministic and stats consistent; entries pass sanitizeEntry', () => {
  const a = run();
  const b = run();
  assert.deepEqual(a.entries.map((e) => e.platformId), b.entries.map((e) => e.platformId));
  assert.equal(new Set(a.entries.map((e) => e.platformId)).size, a.entries.length);
  assert.equal(a.stats.entries, a.entries.length);
  assert.equal(a.stats.byKind.post + a.stats.byKind.media + a.stats.byKind.event, a.entries.length);
  assert.equal(a.stats.withMedia, a.entries.filter((e) => e.media.length).length);
  for (const e of a.entries) {
    const { entry, error } = sanitizeEntry(e, { archiveName: 'fb-test' });
    assert.ok(entry, error);
  }
});

test('unescapeHtml', () => assert.equal(unescapeHtml('a &amp; b &#064;c &#x41; &quot;d&quot; &#039;'), "a & b @c A \"d\" '"));

// --- check-in / tag metadata lines (not the owner's words) ---
const BLOCK = (body, date = 'Aug 23, 2018, 5:00 PM') => `<div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder"><div class="_3-96 _2pio _2lek _2lel">Test Page was at East Room.</div><div class="_3-96 _2let"><div><div class="_2pin"><div>${body}</div></div></div></div><div class="_3-94 _2lem">${date}</div></div>`;
const postsHtml = (...blocks) => `<html><body><div role="main">${blocks.join('')}</div></body></html>`;

test('splitFbMeta moves tag/place/address lines out of the text', () => {
  const out = splitFbMeta(['Great night.', 'You tagged Ana Ruiz, Ben Lo and Cy Day', 'Place: East Room (41.92396, -87.6994)', 'Address: 2354 N Milwaukee, Chicago, Illinois 60647']);
  assert.deepEqual(out.lines, ['Great night.']);
  assert.equal(out.place, 'East Room');
  assert.deepEqual(out.peopleTagged, ['Ana Ruiz', 'Ben Lo', 'Cy Day']);
  const own = splitFbMeta(['with rotating residents SOLD & friends', 'Starts at 9pm']);
  assert.deepEqual(own.lines, ['with rotating residents SOLD & friends', 'Starts at 9pm']);
  assert.equal(own.place, '');
});

test('posts: check-in lines become place/peopleTagged; text keeps only the owner words', () => {
  const html = postsHtml(
    BLOCK('Much love to the crew.<br />You tagged Ana Ruiz and Ben Lo<br /><br />Place: East Room (41.92396, -87.6994)<br />Address: 2354 N Milwaukee, Chicago, Illinois 60647'),
    BLOCK('You tagged Cy Day<br />Place: East Room (41.92396, -87.6994)<br />Address: 2354 N Milwaukee, Chicago, Illinois 60647', 'Aug 23, 2018, 6:00 PM'),
  );
  const { entries } = run({ 'posts/posts_1.html': html, 'page_profile_information/no-data.txt': 'none' });
  const [a, b] = entries.sort((x, y) => (x.ts < y.ts ? -1 : 1));
  assert.equal(a.text, 'Much love to the crew.');
  assert.equal(a.place, 'East Room');
  assert.deepEqual(a.peopleTagged, ['Ana Ruiz', 'Ben Lo']);
  assert.equal(b.text, '');
  assert.equal(b.place, 'East Room');
  const { entry: stored } = sanitizeEntry(a, { archiveName: 'fb-test' });
  assert.equal(stored.place, 'East Room');
  assert.deepEqual(stored.peopleTagged, ['Ana Ruiz', 'Ben Lo']);
});

test('posts: platformId hashes the raw text, so ids do not change when metadata is split out', () => {
  const body = 'Much love.<br />Place: East Room (41.92396, -87.6994)';
  const { entries } = run({ 'posts/posts_1.html': postsHtml(BLOCK(body)), 'page_profile_information/no-data.txt': 'none' });
  const ts = entries[0].ts;
  const raw = 'Much love.\nPlace: East Room (41.92396, -87.6994)';
  assert.equal(entries[0].platformId, `post:${createHash('sha1').update(`${ts}|${raw.slice(0, 80)}|`).digest('hex')}`);
});
