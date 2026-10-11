import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTER, detect, parse, fixMojibake } from '../adapters/instagram.js';
import { readerFromDir, readerFromMap } from '../fs-reader.js';
import { sanitizeEntry } from '../schema.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '__fixtures__', 'instagram');
const rd = (n) => readerFromDir(path.join(FIX, n));
const run = (reader) => parse({ reader, account: 'fixture_ig', archiveName: 'ig-fixture' });

test('adapter id and detect', () => {
  assert.equal(ADAPTER, 'instagram');
  for (const n of ['new', 'old', 'legacy']) assert.equal(detect(rd(n)), true, n);
  assert.equal(detect(readerFromMap({ 'data/tweets.js': 'x' })), false);
  assert.equal(detect(readerFromMap({ 'media.json': '{"unrelated":1}' })), false);
  assert.equal(detect(readerFromMap({})), false);
});

test('fixMojibake repairs only clean round-trips', () => {
  assert.equal(fixMojibake('â\u0080\u0099'), '’');
  assert.equal(fixMojibake('CafÃ©'), 'Café');
  assert.equal(fixMojibake('ð\u009f\u0098\u0080'), '\u{1F600}');
  assert.equal(fixMojibake('plain ascii'), 'plain ascii');
  assert.equal(fixMojibake('already fine ’ \u{1F600}'), 'already fine ’ \u{1F600}');
  assert.equal(fixMojibake('café'), 'café'); // lone latin-1 char is not valid UTF-8: untouched
  assert.equal(fixMojibake('â\u0080'), 'â\u0080'); // truncated sequence: untouched
  assert.equal(fixMojibake(''), '');
  assert.equal(fixMojibake(null), null);
});

test('new layout: single post, mojibake caption, EXIF takenAt only on the media item', () => {
  const r = run(rd('new'));
  const solo = r.entries.find((e) => e.media[0]?.relPath === 'media/posts/201809/solo.jpg');
  assert.equal(solo.text, 'Café morning ’s best \u{1F600}');
  assert.equal(solo.kind, 'post');
  assert.equal(solo.ts, '2018-09-03T18:40:00.000Z');
  assert.equal(solo.tsKind, 'posted');
  assert.equal(solo.tsSource, 'instagram-posts-json');
  assert.equal(solo.tsConfidence, 'high');
  assert.equal(solo.audience, 'public');
  assert.equal(solo.media[0].takenAt, '2018-08-30T09:15:00.000Z');
  assert.equal(solo.platformId, '1536000000:media/posts/201809/solo.jpg');
  assert.equal(solo.source.file, 'your_instagram_activity/media/posts_1.json');
});

test('carousel is ONE entry with several media; post-level caption wins', () => {
  const r = run(rd('new'));
  const c = r.entries.find((e) => e.text === 'Carousel caption');
  assert.equal(c.media.length, 2);
  assert.deepEqual(c.media.map((m) => m.type), ['image', 'video']);
  assert.equal(c.media[0].takenAt, undefined);
  assert.equal(c.ts, '2018-09-04T22:26:40.000Z');
});

test('stories and reels', () => {
  const r = run(rd('new'));
  const stories = r.entries.filter((e) => e.kind === 'story');
  assert.equal(stories.length, 2);
  assert.equal(stories[0].audience, 'unknown');
  assert.equal(stories[0].tsSource, 'instagram-stories-json');
  assert.equal(stories[0].text, 'story text');
  const reel = r.entries.find((e) => e.kind === 'reel');
  assert.equal(reel.text, 'reel caption');
  assert.equal(reel.media[0].type, 'video');
  assert.equal(reel.tsSource, 'instagram-reels-json');
  assert.equal(r.stats.byKind.post, 2);
});

test('bad rows counted: duplicate, no timestamp, empty; missing media counted', () => {
  const r = run(rd('new'));
  assert.deepEqual(r.stats.skipped, { duplicate: 1, 'no-timestamp': 2 });
  assert.equal(r.stats.entries, 5);
  assert.equal(r.stats.withMedia, 5);
  assert.equal(r.stats.mediaMissing, 5); // only solo.jpg exists in the fixture tree
});

test('old layout (content/): posts + stories; bad reels.json is a warning, not a throw', () => {
  const r = run(rd('old'));
  assert.equal(r.entries.length, 2);
  assert.equal(r.entries.find((e) => e.kind === 'post').ts, '2017-01-01T00:00:00.000Z');
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /content\/reels\.json: bad JSON/);
});

test('legacy media.json: photos, videos, stories', () => {
  const r = run(rd('legacy'));
  assert.equal(r.entries.length, 3);
  const photo = r.entries.find((e) => e.media[0].relPath === 'photos/201605/a.jpg');
  assert.equal(photo.text, 'legacy photo ’');
  assert.equal(photo.ts, '2016-05-04T10:00:00.000Z');
  assert.equal(photo.tsSource, 'instagram-media-json');
  assert.equal(r.entries.find((e) => e.media[0].type === 'video').kind, 'post');
  assert.equal(r.entries.find((e) => e.kind === 'story').audience, 'unknown');
});

test('allowlist: messages and unrelated files are never read', () => {
  const base = rd('new');
  const spy = [];
  parse({ reader: { ...base, read: (p) => { spy.push(p); return base.read(p); } }, account: 'a', archiveName: 'b' });
  assert.deepEqual([...new Set(spy)].sort(), [
    'your_instagram_activity/media/posts_1.json',
    'your_instagram_activity/media/reels.json',
    'your_instagram_activity/media/stories.json',
  ]);
});

test('tolerates missing files and bad JSON', () => {
  const empty = run(readerFromMap({}));
  assert.equal(empty.entries.length, 0);
  assert.ok(empty.warnings.length);
  const bad = run(readerFromMap({ 'content/posts_1.json': '{nope' }));
  assert.equal(bad.entries.length, 0);
  assert.match(bad.warnings[0], /bad JSON/);
});

test('deterministic and sanitizeEntry accepts every entry', () => {
  for (const n of ['new', 'old', 'legacy']) {
    const a = run(rd(n));
    assert.deepEqual(a, run(rd(n)));
    for (const e of a.entries) {
      const { entry, error } = sanitizeEntry(e, { archiveName: 'ig-fixture' });
      assert.equal(error, undefined);
      assert.ok(entry.id);
    }
  }
});
