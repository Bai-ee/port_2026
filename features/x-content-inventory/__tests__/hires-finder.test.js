import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findHiresCandidates, isThumbnailPath, photoIds, MIN_SCORE } from '../hires-finder.js';

// Real rows (sanitized to finder fields) from prod x_content_packages, home client.
const REAL = JSON.parse(readFileSync(new URL('./fixtures-hires-real.json', import.meta.url), 'utf8'));
const byId = (id) => REAL.find((p) => p.id === id);
const TARGET = byId('nas-0a15111c26459788');

test('isThumbnailPath: thumbnails dir, _n/_s suffix, <=720px', () => {
  assert.equal(isThumbnailPath(TARGET.nas.relativePath, 720), true);
  assert.equal(isThumbnailPath('a/b/photo_n.jpg', 2000), true);
  assert.equal(isThumbnailPath('a/b/photo_s.jpg', 2000), true);
  assert.equal(isThumbnailPath('a/b/photo_o.jpg', 2048), false);
  assert.equal(isThumbnailPath('a/b/photo_o.jpg', 720), true);
  assert.equal(isThumbnailPath('a/b/photo_o.jpg'), false);
});

test('photoIds reads 12+ digit tokens from the filename only', () => {
  assert.ok(photoIds(TARGET.nas.relativePath).has('10217141824798684'));
  assert.equal(photoIds('x/41027512_n.jpg').size, 0);
});

test('real case: 10/16 East Room thumbnail resolves to a 2048px copy of the same flyer', () => {
  const r = findHiresCandidates(TARGET, REAL);
  assert.deepEqual(r.target, { id: TARGET.id, width: 720, height: 720, isThumbnail: true });
  assert.ok(r.best);
  assert.ok(['nas-37f9fa19bf1dd033', 'nas-f2c58f8e087e449b'].includes(r.best.id), r.best.id);
  assert.equal(r.best.width, 2048);
  assert.ok(r.best.score >= 90);
  assert.ok(r.best.reasons.some((x) => /same event date/.test(x)));
  // every candidate is the 10/16 flyer family and strictly bigger
  for (const c of r.candidates) assert.ok(c.pixels > 720 * 720 && c.score >= MIN_SCORE);
});

test('the 10/30 East Room flyer and the South Dakota flyer never win for the 10/16 target', () => {
  const r = findHiresCandidates(TARGET, REAL, { limit: 20 });
  const ids = r.candidates.map((c) => c.id);
  assert.ok(!ids.includes('nas-02709a917bb773a4'));
  assert.ok(!ids.includes('nas-0d77f0fd31c24d05'), 'same date but different flyer text must not pass the OCR gate');
});

test('equal-size sibling thumbnail is not an upgrade', () => {
  const ids = findHiresCandidates(TARGET, REAL, { limit: 20 }).candidates.map((c) => c.id);
  assert.ok(!ids.includes('nas-0b769ca3e2bb83ee'));
});

test('excludes self, other clients, never-public, other media kind, same sha', () => {
  const big = byId('nas-37f9fa19bf1dd033');
  const pool = [
    { ...big, id: 'self-copy', clientId: 'other-client' },
    { ...big, id: 'never', rights: 'never-public' },
    { ...big, id: 'vid', mediaState: 'video', format: 'video' },
    { ...big, id: 'same-sha', nas: { ...big.nas, sha256: TARGET.nas.sha256 } },
    TARGET,
  ];
  const r = findHiresCandidates(TARGET, pool);
  assert.equal(r.best, null);
});

test('photo id match wins alone (score 100) even with no OCR/date facets and a different crop', () => {
  const orig = {
    id: 'orig', clientId: TARGET.clientId, mediaState: 'still', rights: 'owned', facets: {},
    nas: { sha256: 'x', relativePath: 'FB/photos/99_10217141824798684_123_o.jpg', width: 2048, height: 1365 },
  };
  const r = findHiresCandidates(TARGET, [orig]);
  assert.equal(r.best.id, 'orig');
  assert.equal(r.best.score, 100);
});

test('metadata without matching OCR text never wins (same date, venue, party, title only)', () => {
  const big = byId('nas-37f9fa19bf1dd033');
  const noOcr = { ...big, id: 'meta-only', facets: { ...big.facets, ocrText: 'completely different words about a barbecue' } };
  assert.equal(findHiresCandidates(TARGET, [noOcr]).best, null);
});

test('same text but a different event date is rejected', () => {
  const big = byId('nas-37f9fa19bf1dd033');
  const other = { ...big, id: 'other-date', facets: { ...big.facets, eventDate: '2018-10-30', eventDates: [{ monthDay: '10-30', year: 2018 }] } };
  assert.equal(findHiresCandidates(TARGET, [other]).best, null);
});

test('a cropped banner of the same artwork (different aspect ratio) is rejected', () => {
  const big = byId('nas-37f9fa19bf1dd033');
  const banner = { ...big, id: 'banner', nas: { ...big.nas, width: 1568, height: 590 } };
  assert.equal(findHiresCandidates(TARGET, [banner]).best, null);
});

test('a target that is already large with nothing bigger returns no best; limit is honoured', () => {
  const big = byId('nas-37f9fa19bf1dd033');
  assert.equal(findHiresCandidates(big, REAL).best, null);
  assert.equal(findHiresCandidates(TARGET, REAL, { limit: 2 }).candidates.length, 2);
});

test('degenerate input never throws', () => {
  assert.equal(findHiresCandidates(null, REAL).best, null);
  assert.equal(findHiresCandidates({ id: 'a' }, null).best, null);
});
