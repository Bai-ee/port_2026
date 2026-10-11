import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTER, detect, parse, parseJsAssignment, parseTweetDate } from '../adapters/x.js';
import { readerFromDir, readerFromMap } from '../fs-reader.js';
import { sanitizeEntry } from '../schema.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '__fixtures__', 'x');
const modern = () => readerFromDir(path.join(FIX, 'modern'));
const legacy = () => readerFromDir(path.join(FIX, 'legacy'));
const run = (reader) => parse({ reader, account: 'Fixture User', archiveName: 'x-fixture' });
const byId = (r, id) => r.entries.find((e) => e.platformId === id);

test('adapter id and detect', () => {
  assert.equal(ADAPTER, 'x-archive');
  assert.equal(detect(modern()), true);
  assert.equal(detect(legacy()), true);
  assert.equal(detect(readerFromMap({ 'posts/posts_1.html': '<html>' })), false);
  assert.equal(detect(readerFromMap({})), false);
});

test('date parsing is explicit UTC and honours offsets', () => {
  assert.equal(parseTweetDate('Wed Oct 10 20:19:24 +0000 2018'), '2018-10-10T20:19:24.000Z');
  assert.equal(parseTweetDate('Thu Oct 11 08:00:00 +0200 2018'), '2018-10-11T06:00:00.000Z');
  assert.equal(parseTweetDate('2018-10-10 20:19:24 +0000'), '2018-10-10T20:19:24.000Z');
  assert.equal(parseTweetDate('nonsense'), null);
});

test('parseJsAssignment strips the prefix without eval', () => {
  assert.deepEqual(parseJsAssignment('window.YTD.x.part0 = [ {"a":1} ]'), [{ a: 1 }]);
  assert.deepEqual(parseJsAssignment('Grailbird.data.t =\n [1,2];'), [1, 2]);
  assert.throws(() => parseJsAssignment('window.x = {"a":1}'));
});

test('modern export: plain post, URL expansion, entities decoded', () => {
  const r = run(modern());
  const e = byId(r, '1001');
  assert.equal(e.text, 'Plain post about lamps & shelves https://example.invalid/lamps #design @friend');
  assert.equal(e.kind, 'post');
  assert.equal(e.ts, '2018-10-10T20:19:24.000Z');
  assert.equal(e.tsKind, 'posted');
  assert.equal(e.tsSource, 'x-tweets-js');
  assert.equal(e.tsConfidence, 'high');
  assert.equal(e.audience, 'public');
  assert.deepEqual(e.engagement, { likes: 3, reposts: 1 });
  assert.equal(e.permalink, 'https://x.com/fixture_user/status/1001');
  assert.equal(e.source.file, 'data/tweets.js');
  assert.equal(e.relation, undefined);
});

test('media is mapped by tweet-id prefix, only to files that exist', () => {
  const r = run(modern());
  assert.deepEqual(byId(r, '1002').media, [{ type: 'image', relPath: 'data/tweets_media/1002-AAAA.jpg' }]);
  assert.equal(byId(r, '1002').text, 'Photo post');
  assert.deepEqual(byId(r, '1003').media, [{ type: 'video', relPath: 'data/tweets_media/1003-BBBB.mp4' }]);
  assert.deepEqual(byId(r, '1001').media, []);
  const all = r.entries.flatMap((e) => e.media.map((m) => m.relPath));
  assert.ok(!all.some((p) => /ORPHAN|NOTMINE/.test(p)));
  assert.equal(r.stats.withMedia, 2);
});

test('relations: reply, quote, repost (repost stores no text)', () => {
  const r = run(modern());
  assert.deepEqual(byId(r, '1004').relation, { type: 'reply', targetId: '999' });
  assert.deepEqual(byId(r, '1005').relation, { type: 'quote', targetId: '888' });
  const rt = byId(r, '1006');
  assert.deepEqual(rt.relation, { type: 'repost' });
  assert.equal(rt.text, '');
  assert.equal(rt.engagement, undefined);
  assert.equal(rt.media.length, 0);
});

test('bad rows are counted, duplicates dropped, DMs and likes never read', () => {
  const r = run(modern());
  assert.deepEqual(r.stats.skipped, { 'bad-created-at': 1, 'no-id': 1, duplicate: 1 });
  assert.equal(r.stats.entries, 6);
  assert.equal(r.stats.byKind.post, 6);
  assert.ok(!JSON.stringify(r.entries).includes('PRIVATE'));
  const spy = [];
  const base = modern();
  parse({ reader: { ...base, read: (p) => { spy.push(p); return base.read(p); } }, account: 'a', archiveName: 'b' });
  assert.deepEqual([...new Set(spy)].sort(), ['data/account.js', 'data/tweets.js']);
});

test('legacy: Grailbird data/js/tweets, tweet.js, tweet_media, no handle = no permalink', () => {
  const r = run(legacy());
  assert.equal(r.entries.length, 3);
  const a = byId(r, '2001');
  assert.equal(a.text, 'Old export tweet https://example.invalid/old');
  assert.equal(a.ts, '2018-10-10T20:19:24.000Z');
  assert.deepEqual(a.engagement, { likes: 7, reposts: 0 });
  assert.deepEqual(a.media, [{ type: 'image', relPath: 'data/tweet_media/2001-OLD.png' }]);
  assert.equal(a.permalink, undefined);
  assert.deepEqual(byId(r, '2002').relation, { type: 'reply', targetId: '777' });
  assert.equal(byId(r, '3001').source.file, 'data/tweet.js');
});

test('tolerates missing files and bad JSON with warnings, never throws', () => {
  const empty = run(readerFromMap({}));
  assert.equal(empty.entries.length, 0);
  assert.ok(empty.warnings.length);
  const bad = run(readerFromMap({ 'data/tweets.js': 'window.YTD.tweets.part0 = [ {oops', 'data/account.js': 'garbage' }));
  assert.equal(bad.entries.length, 0);
  assert.equal(bad.warnings.length, 2);
});

test('deterministic and sanitizeEntry accepts every entry', () => {
  const a = run(modern());
  const b = run(modern());
  assert.deepEqual(a, b);
  for (const e of a.entries) {
    const { entry, error } = sanitizeEntry(e, { archiveName: 'x-fixture' });
    assert.equal(error, undefined);
    assert.ok(entry.id.startsWith('x-fixture-user-'));
  }
});
