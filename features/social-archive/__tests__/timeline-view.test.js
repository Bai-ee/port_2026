import test from 'node:test';
import assert from 'node:assert/strict';
import { isCompleteDay, latestDayFor, dayCountLabel } from '../timeline-view.js';

const NOW = new Date('2026-10-12T12:00:00Z');

test('isCompleteDay rejects partial years typed into a date input', () => {
  for (const v of ['0002-06-14', '0020-06-14', '0201-06-14', '1989-12-31', '2028-01-01']) {
    assert.equal(isCompleteDay(v, NOW), false, v);
  }
});

test('isCompleteDay accepts real days and rejects malformed ones', () => {
  assert.equal(isCompleteDay('2019-06-14', NOW), true);
  assert.equal(isCompleteDay('2027-01-01', NOW), true);
  assert.equal(isCompleteDay('2019-02-30', NOW), false);
  assert.equal(isCompleteDay('', NOW), false);
  assert.equal(isCompleteDay('2019-6-14', NOW), false);
});

test('latestDayFor picks the newest archive day for a platform', () => {
  const archives = [
    { platform: 'facebook', lastTs: '2020-06-18T06:31:00Z' },
    { platform: 'instagram', lastTs: '2026-05-08T10:00:00Z' },
    { platform: 'facebook', lastTs: '2019-01-01T00:00:00Z' },
    { platform: 'x' },
  ];
  assert.equal(latestDayFor(archives, 'facebook'), '2020-06-18');
  assert.equal(latestDayFor(archives, ''), '2026-05-08');
  assert.equal(latestDayFor(archives, 'x'), '');
  assert.equal(latestDayFor(null, ''), '');
});

test('dayCountLabel shows the filtered count when a platform hides entries', () => {
  assert.equal(dayCountLabel(1, 1), '1 entry');
  assert.equal(dayCountLabel(3, 3, 'Facebook'), '3 entries');
  assert.equal(dayCountLabel(0, 1, 'Facebook'), '0 Facebook entries of 1');
  assert.equal(dayCountLabel(1, 4, 'Instagram'), '1 Instagram entry of 4');
});
