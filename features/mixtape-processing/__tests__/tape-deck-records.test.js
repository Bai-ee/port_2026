import test from 'node:test';
import assert from 'node:assert/strict';
import { mapReviewDoc, buildTapeDeckPayload, safeAudioUrl, toIso, TAPE_DECK_LIMIT } from '../tape-deck-records.js';

const URL_A = 'https://firebasestorage.googleapis.com/v0/b/human-in-the-loop-a1a19.firebasestorage.app/o/mixtape-reviews%2Fx%2Foriginal.m4a?alt=media&token=t1';
const URL_B = URL_A.replace('original', 'restored');

const doc = (over = {}) => ({
  status: 'published', title: 'Side A', tapeStem: 'side-a', publishedAt: '2026-11-18T10:00:00.000Z',
  durations: { originalS: 3600, trimmedS: 3500 }, cuts: { count: 2, kinds: ['silence'], removedS: 100 },
  chainLabel: 'Clean-up + gentle hiss + air', chain: 'highpass=f=22', chainHash: 'abc',
  diag: { balanceDb: -1.1, humHz: [50], rolloffHz: 11000, lufs: -15.9 }, clip: { startS: 700, lengthS: 60, gainsDb: { original: 0, restored: -1 } },
  urls: { original: URL_A, restored: URL_B }, storagePaths: ['mixtape-reviews/x/original.m4a'], versions: { publish: 1 }, ...over,
});

test('maps a published doc to the whitelisted public shape only', () => {
  const rec = mapReviewDoc('side-a-1234abcd', doc());
  assert.deepEqual(Object.keys(rec).sort(), ['chainLabel', 'clip', 'cuts', 'diag', 'durations', 'id', 'publishedAt', 'tapeStem', 'title', 'urls']);
  assert.deepEqual(rec.clip, { startS: 700, lengthS: 60 });
  const json = JSON.stringify(rec);
  assert.ok(!/storagePaths|chainHash|versions|gainsDb|highpass/.test(json));
});

test('hidden, draft and malformed docs are dropped', () => {
  assert.equal(mapReviewDoc('a', doc({ status: 'hidden' })), null);
  assert.equal(mapReviewDoc('a', doc({ status: undefined })), null);
  assert.equal(mapReviewDoc('', doc()), null);
  assert.equal(mapReviewDoc('a', null), null);
  assert.equal(mapReviewDoc('a', doc({ urls: { original: URL_A } })), null);
});

test('audio urls must be https Firebase Storage urls', () => {
  assert.ok(safeAudioUrl(URL_A));
  assert.equal(safeAudioUrl('http://firebasestorage.googleapis.com/x'), '');
  assert.equal(safeAudioUrl('https://evil.example.com/a.m4a'), '');
  assert.equal(safeAudioUrl('javascript:alert(1)'), '');
  assert.equal(safeAudioUrl('https://firebasestorage.googleapis.com.evil.com/x'), '');
  assert.equal(safeAudioUrl(42), '');
  assert.equal(mapReviewDoc('a', doc({ urls: { original: URL_A, restored: 'https://evil.example.com/r.m4a' } })), null);
});

test('timestamps: Firestore Timestamp, Date, ISO, millis, garbage', () => {
  const iso = '2026-11-18T10:00:00.000Z';
  assert.equal(toIso({ toDate: () => new Date(iso) }), iso);
  assert.equal(toIso(new Date(iso)), iso);
  assert.equal(toIso(iso), iso);
  assert.equal(toIso(Date.parse(iso)), iso);
  assert.equal(toIso('nope'), null);
  assert.equal(toIso(undefined), null);
});

test('missing optional fields get safe defaults; title falls back to the stem', () => {
  const rec = mapReviewDoc('a', { status: 'published', tapeStem: 'stem-x', urls: { original: URL_A, restored: URL_B } });
  assert.equal(rec.title, 'stem-x');
  assert.equal(rec.clip.lengthS, 60);
  assert.deepEqual(rec.diag, { balanceDb: null, humHz: [], rolloffHz: null, lufs: null });
  assert.deepEqual(rec.cuts, { count: null, kinds: [], removedS: null });
});

test('payload sorts newest first, caps at the limit and tolerates junk', () => {
  const docs = [
    { id: 'old', data: doc({ publishedAt: '2026-01-01T00:00:00Z' }) },
    { id: 'new', data: doc({ publishedAt: '2026-11-01T00:00:00Z' }) },
    { id: 'hidden', data: doc({ status: 'hidden' }) },
    null,
  ];
  assert.deepEqual(buildTapeDeckPayload(docs).reviews.map((r) => r.id), ['new', 'old']);
  const many = Array.from({ length: 80 }, (_, i) => ({ id: `t${i}`, data: doc({ publishedAt: new Date(2026, 0, 1 + i).toISOString() }) }));
  assert.equal(buildTapeDeckPayload(many).reviews.length, TAPE_DECK_LIMIT);
  assert.equal(buildTapeDeckPayload(many).reviews[0].id, 't79');
  assert.deepEqual(buildTapeDeckPayload(undefined), { reviews: [] });
});
