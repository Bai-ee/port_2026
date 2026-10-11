import assert from 'node:assert/strict';
import test from 'node:test';
import {
  entryId, dayOf, isIsoDay, sanitizeEntry, sanitizeMedia, extractTextEntities, voiceFeatures, TEXT_MAX, MEDIA_MAX,
} from '../schema.js';

const raw = (o = {}) => ({
  platform: 'facebook', account: 'Housepit CHI', platformId: 'p1', kind: 'post',
  ts: '2019-05-24T20:30:00Z', tsKind: 'posted', tsSource: 'facebook-posts-html', text: 'hello', ...o,
});

test('entryId is deterministic and varies by platformId/account/platform', () => {
  const a = entryId({ platform: 'x', account: 'Bai Ee', platformId: '1' });
  assert.equal(a, entryId({ platform: 'x', account: 'Bai Ee', platformId: '1' }));
  assert.match(a, /^x-bai-ee-[0-9a-f]{12}$/);
  assert.notEqual(a, entryId({ platform: 'x', account: 'Bai Ee', platformId: '2' }));
  assert.notEqual(a, entryId({ platform: 'x', account: 'Other', platformId: '1' }));
});

test('dayOf / isIsoDay', () => {
  assert.equal(dayOf('2019-05-24T23:59:59Z'), '2019-05-24');
  assert.equal(dayOf('nope'), null);
  assert.equal(dayOf(''), null);
  assert.equal(isIsoDay('2019-02-30'), false);
  assert.equal(isIsoDay('2019-05-24'), true);
  assert.equal(isIsoDay('2019-5-24'), false);
});

test('sanitizeEntry accepts a valid entry with derived fields', () => {
  const { entry, error } = sanitizeEntry(raw({ text: 'Hi #House @bob https://a.co/x.' }), { archiveName: 'fb1' });
  assert.equal(error, undefined);
  assert.equal(entry.day, '2019-05-24');
  assert.equal(entry.ts, '2019-05-24T20:30:00.000Z');
  assert.equal(entry.audience, 'unknown');
  assert.equal(entry.tsConfidence, 'medium');
  assert.equal(entry.source.archive, 'fb1');
  assert.deepEqual(entry.hashtags, ['house']);
  assert.deepEqual(entry.mentions, ['bob']);
  assert.deepEqual(entry.links, ['https://a.co/x']);
  assert.equal(entry.id, entryId({ platform: 'facebook', account: 'Housepit CHI', platformId: 'p1' }));
});

test('sanitizeEntry reject reasons', () => {
  assert.equal(sanitizeEntry(null).error, 'not-an-object');
  assert.equal(sanitizeEntry(raw({ platform: 'tiktok' })).error, 'bad-platform');
  assert.equal(sanitizeEntry(raw({ account: '  ' })).error, 'missing-account');
  assert.equal(sanitizeEntry(raw({ platformId: '' })).error, 'missing-platformId');
  assert.equal(sanitizeEntry(raw({ ts: 'garbage' })).error, 'bad-timestamp');
  assert.equal(sanitizeEntry(raw({ tsKind: 'modified' })).error, 'bad-tsKind');
  assert.equal(sanitizeEntry(raw({ tsSource: '' })).error, 'bad-tsSource');
  for (const s of ['mtime', 'capturedAt', 'ctime', 'file-date', 'downloaded', 'MTIME']) {
    assert.equal(sanitizeEntry(raw({ tsSource: s })).error, 'bad-tsSource', s);
  }
});

test('timestamp range limits', () => {
  assert.equal(sanitizeEntry(raw({ ts: '1989-12-31T23:59:59Z' })).error, 'timestamp-out-of-range');
  assert.equal(sanitizeEntry(raw({ ts: '1990-01-01T00:00:00Z' })).error, undefined);
  const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
  assert.equal(sanitizeEntry(raw({ ts: future })).error, 'timestamp-out-of-range');
  const soon = new Date(Date.now() + 3_600_000).toISOString();
  assert.equal(sanitizeEntry(raw({ ts: soon })).error, undefined);
});

test('text trimming at TEXT_MAX sets textTruncated; entities come from full text', () => {
  const long = `${'a'.repeat(TEXT_MAX)} #late`;
  const { entry } = sanitizeEntry(raw({ text: long }));
  assert.equal(entry.text.length, TEXT_MAX);
  assert.equal(entry.textTruncated, true);
  assert.deepEqual(entry.hashtags, ['late']);
  const exact = sanitizeEntry(raw({ text: 'b'.repeat(TEXT_MAX) })).entry;
  assert.equal(exact.textTruncated, false);
  assert.equal(sanitizeEntry(raw({ text: '  x \r\n' })).entry.text, 'x');
});

test('extractTextEntities dedupes, lowercases, ignores email-ish @ and url fragments', () => {
  const e = extractTextEntities('#Foo #foo @Al @al mail me a@b.com https://x.io/p#frag, ok!');
  assert.deepEqual(e.hashtags, ['foo']);
  assert.deepEqual(e.mentions, ['al']);
  assert.deepEqual(e.links, ['https://x.io/p#frag']);
});

test('media sanitizing: rejects .., normalizes paths, types, cap', () => {
  assert.equal(sanitizeMedia({ relPath: '../etc/passwd' }), null);
  assert.equal(sanitizeMedia({ relPath: 'a/../b.jpg' }), null);
  assert.equal(sanitizeMedia({ relPath: '' }), null);
  assert.equal(sanitizeMedia(null), null);
  assert.deepEqual(sanitizeMedia({ relPath: '.\\photos\\a.JPG' }), { type: 'image', relPath: 'photos/a.JPG' });
  assert.equal(sanitizeMedia({ uri: '/v/clip.mp4' }).type, 'video');
  assert.equal(sanitizeMedia({ relPath: 'a.jpg', takenAt: '2018-01-01T00:00:00Z' }).takenAt, '2018-01-01T00:00:00.000Z');
  assert.equal('takenAt' in sanitizeMedia({ relPath: 'a.jpg', takenAt: 'bad' }), false);
  const many = Array.from({ length: MEDIA_MAX + 5 }, (_, i) => ({ relPath: `m${i}.jpg` }));
  const { entry } = sanitizeEntry(raw({ media: [...many, { relPath: '../x.jpg' }] }));
  assert.equal(entry.media.length, MEDIA_MAX);
});

test('audience defaults to unknown; invalid values too; valid kept', () => {
  assert.equal(sanitizeEntry(raw()).entry.audience, 'unknown');
  assert.equal(sanitizeEntry(raw({ audience: 'everyone' })).entry.audience, 'unknown');
  assert.equal(sanitizeEntry(raw({ audience: 'public' })).entry.audience, 'public');
});

test('optional fields: relation, engagement, permalink, kind default', () => {
  const { entry } = sanitizeEntry(raw({
    kind: 'weird', relation: { type: 'quote', targetId: 't9' }, engagement: { likes: '5', views: -1, junk: 3 },
    permalink: 'javascript:alert(1)',
  }));
  assert.equal(entry.kind, 'post');
  assert.deepEqual(entry.relation, { type: 'quote', targetId: 't9' });
  assert.deepEqual(entry.engagement, { likes: 5 });
  assert.equal('permalink' in entry, false);
  assert.equal(sanitizeEntry(raw({ permalink: 'https://x.com/a' })).entry.permalink, 'https://x.com/a');
});

test('voiceFeatures basics', () => {
  const f = voiceFeatures('lol what? Nice 😀 #a https://x.co');
  assert.equal(f.question, true);
  assert.equal(f.exclaim, false);
  assert.equal(f.lowerStart, true);
  assert.equal(f.emoji, 1);
  assert.equal(f.hashtags, 1);
  assert.equal(f.links, 1);
  assert.equal(voiceFeatures('').len, 0);
});
