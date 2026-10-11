import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTER, detect, parse } from '../adapters/instagram.js';
import { readerFromDir, readerFromMap } from '../fs-reader.js';
import { sanitizeEntry } from '../schema.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '__fixtures__', 'instagram', 'html');
const rd = () => readerFromDir(FIX);
const run = (opts = {}) => parse({ reader: rd(), account: 'fixture_ig', archiveName: 'ig-html', ...opts });
const by = (r, fn) => r.entries.find(fn);

test('detect: true for the HTML flavor, false for unrelated roots', () => {
  assert.equal(ADAPTER, 'instagram');
  assert.equal(detect(rd()), true);
  assert.equal(detect(readerFromMap({ 'your_instagram_activity/media/stories.html': '<html></html>' })), true);
  assert.equal(detect(readerFromMap({ 'your_instagram_activity/media/reels.html': '<html></html>' })), true);
  assert.equal(detect(readerFromMap({ 'your_instagram_activity/media/other_stuff.html': 'x' })), false);
  assert.equal(detect(readerFromMap({ 'your_instagram_activity/messages/inbox/a.html': 'x' })), false);
});

test('post: caption entity-decoded + mojibake fixed, tagged people, tz-converted time, medium confidence', () => {
  const r = run();
  const p = by(r, (e) => e.media[0]?.relPath === 'media/posts/201809/solo.jpg');
  assert.equal(p.kind, 'post');
  assert.equal(p.text, 'Café morning @friend & #coffee "best"\nsecond line');
  assert.equal(p.ts, '2018-09-03T18:40:00.000Z'); // 1:40 pm CDT
  assert.equal(p.tsKind, 'posted');
  assert.equal(p.tsSource, 'instagram-posts-html');
  assert.equal(p.tsConfidence, 'medium');
  assert.equal(p.audience, 'public');
  assert.deepEqual(p.peopleTagged, ['alice.x', 'bob_y']);
  assert.equal(p.source.file, 'your_instagram_activity/media/posts_1.html');
  assert.match(r.warnings.join('\n'), /assumed America\/Chicago/);
});

test('carousel is ONE entry with several media in order', () => {
  const c = by(run(), (e) => e.text === 'Carousel caption');
  assert.deepEqual(c.media.map((m) => [m.type, m.relPath]), [
    ['image', 'media/posts/201809/c1.jpg'], ['video', 'media/posts/201809/c2.mp4'], ['image', 'media/posts/201809/c3.jpg'],
  ]);
  assert.equal(c.ts, '2018-12-04T22:26:00.000Z'); // CST
});

test('tz conversion is DST-aware, honors the tz argument, and UTC upgrades confidence', () => {
  const r = run();
  assert.equal(by(r, (e) => e.text === 'Winter post at noon').ts, '2019-01-15T18:00:00.000Z');
  assert.equal(by(r, (e) => e.text === 'Summer post at noon').ts, '2019-07-15T17:00:00.000Z');
  assert.equal(by(r, (e) => e.media[0]?.relPath === 'media/posts/201910/nocap.jpg').ts, '2019-10-01T05:05:00.000Z'); // 12:05 am CDT
  const ny = run({ tz: 'America/New_York' });
  assert.equal(by(ny, (e) => e.text === 'Summer post at noon').ts, '2019-07-15T16:00:00.000Z');
  const utc = run({ tz: 'UTC' });
  const w = by(utc, (e) => e.text === 'Winter post at noon');
  assert.equal(w.ts, '2019-01-15T12:00:00.000Z');
  assert.equal(w.tsConfidence, 'high');
  assert.equal(utc.warnings.length, 0);
});

test('posts.html: duplicates of posts_1 (same media) dropped, unique items kept; bad rows counted', () => {
  const r = run();
  assert.equal(r.entries.filter((e) => e.media.some((m) => m.relPath === 'media/posts/201809/solo.jpg')).length, 1);
  assert.ok(by(r, (e) => e.text === 'Only in posts.html'));
  assert.equal(by(r, (e) => e.text === 'Only in posts.html').source.file, 'your_instagram_activity/media/posts.html');
  assert.equal(r.stats.skipped.duplicate, 1);
  assert.equal(r.stats.skipped['no-timestamp'], 2); // 'not a date' + event with empty Start Time
  assert.equal(r.stats.skipped.empty, 1); // no caption, no media
});

test('stories: kind story, audience unknown; reels; archived; igtv; profile photo; other content', () => {
  const r = run();
  const stories = r.entries.filter((e) => e.kind === 'story');
  assert.equal(stories.length, 2);
  assert.ok(stories.every((s) => s.audience === 'unknown' && s.tsSource === 'instagram-stories-html'));
  assert.equal(by(r, (e) => e.text === 'story text').media[0].type, 'image');
  assert.equal(stories.find((s) => !s.text).media[0].type, 'video');
  const reel = by(r, (e) => e.kind === 'reel');
  assert.equal(reel.text, 'reel caption #loop');
  assert.equal(reel.tsSource, 'instagram-reels-html');
  assert.equal(reel.ts, '2021-04-08T19:30:00.000Z');
  const arch = by(r, (e) => e.text === 'Archived one');
  assert.equal(arch.kind, 'post');
  assert.equal(arch.place, 'Belmont Harbor');
  assert.equal(arch.tsSource, 'instagram-archived-posts-html');
  assert.equal(by(r, (e) => e.text === 'long video').tsSource, 'instagram-igtv-html');
  const pp = by(r, (e) => e.kind === 'media');
  assert.equal(pp.tsSource, 'instagram-profile-photos-html');
  assert.equal(by(r, (e) => e.text === 'Other content caption').tsSource, 'instagram-other-content-html');
});

test('reposts: kind post + relation repost, EMPTY text, never the other account\'s words', () => {
  const r = run();
  const reps = r.entries.filter((e) => e.relation?.type === 'repost');
  assert.equal(reps.length, 2);
  for (const e of reps) {
    assert.equal(e.kind, 'post');
    assert.equal(e.text, '');
    assert.deepEqual(e.media, []);
    assert.equal(e.tsSource, 'instagram-reposts-html');
  }
  assert.deepEqual(reps.map((e) => e.relation.targetId).sort(), ['AAA111bbb', 'CCC222ddd']);
  assert.equal(reps.find((e) => e.relation.targetId === 'AAA111bbb').ts, '2026-05-08T00:15:00.000Z'); // footer time, not the 2126 expiry
  assert.ok(!JSON.stringify(r.entries).includes('SOMEONE ELSES WORDS'));
  assert.ok(!JSON.stringify(r.entries).includes('MORE OF THEIR WORDS'));
});

test('events: Start Time is the timestamp (tsKind event); nameless event skipped', () => {
  const r = run();
  const ev = by(r, (e) => e.kind === 'event');
  assert.equal(r.entries.filter((e) => e.kind === 'event').length, 1);
  assert.equal(ev.text, 'Show Night & Day\nDoors at 3');
  assert.equal(ev.ts, '2023-10-05T20:00:00.000Z');
  assert.equal(ev.tsKind, 'event');
  assert.equal(ev.tsSource, 'instagram-events-html');
});

test('missing media files are counted, refs kept', () => {
  const r = run();
  assert.equal(r.stats.mediaMissing, r.entries.reduce((n, e) => n + e.media.length, 0));
  assert.ok(r.stats.mediaMissing > 0);
  assert.equal(r.stats.withMedia, r.entries.filter((e) => e.media.length).length);
});

test('allowlist: messages, likes and unlisted html are never read', () => {
  const base = rd();
  const spy = [];
  parse({ reader: { ...base, read: (p) => { spy.push(p); return base.read(p); } }, account: 'a', archiveName: 'b' });
  const read = [...new Set(spy)].sort();
  assert.deepEqual(read, [
    'your_instagram_activity/events/your_events.html',
    'your_instagram_activity/media/archived_posts.html',
    'your_instagram_activity/media/igtv_videos.html',
    'your_instagram_activity/media/other_content.html',
    'your_instagram_activity/media/posts.html',
    'your_instagram_activity/media/posts_1.html',
    'your_instagram_activity/media/profile_photos.html',
    'your_instagram_activity/media/reels.html',
    'your_instagram_activity/media/reposts.html',
    'your_instagram_activity/media/stories.html',
  ]);
  assert.ok(!read.some((p) => /messages|likes|other_stuff/.test(p)));
});

test('deterministic and sanitizeEntry accepts every entry', () => {
  const a = run();
  assert.deepEqual(a, run());
  const ids = new Set();
  for (const e of a.entries) {
    const { entry, error } = sanitizeEntry(e, { archiveName: 'ig-html' });
    assert.equal(error, undefined);
    ids.add(entry.id);
  }
  assert.equal(ids.size, a.entries.length);
});

test('tolerates missing HTML files', () => {
  const r = parse({ reader: readerFromMap({ 'your_instagram_activity/media/stories.html': '<html><main></main></html>' }), account: 'a', archiveName: 'b' });
  assert.equal(r.entries.length, 0);
});
