import test from 'node:test';
import assert from 'node:assert/strict';
import { fsTimestampToDate, termArrCount, termItemLines } from '../format-utils.js';

test('fsTimestampToDate: null/undefined input returns null', () => {
  assert.strictEqual(fsTimestampToDate(null), null);
  assert.strictEqual(fsTimestampToDate(undefined), null);
});

test('fsTimestampToDate: a live Firestore Timestamp (toDate()) branch', () => {
  const fakeTimestamp = { toDate: () => new Date('2026-01-01T00:00:00.000Z') };
  const d = fsTimestampToDate(fakeTimestamp);
  assert.strictEqual(d.toISOString(), '2026-01-01T00:00:00.000Z');
});

test('fsTimestampToDate: client-SDK plain object ({seconds}) branch', () => {
  const d = fsTimestampToDate({ seconds: 1735689600 });
  assert.strictEqual(d.toISOString(), '2025-01-01T00:00:00.000Z');
});

test('fsTimestampToDate: admin-SDK JSON object ({_seconds}) branch', () => {
  const d = fsTimestampToDate({ _seconds: 1735689600 });
  assert.strictEqual(d.toISOString(), '2025-01-01T00:00:00.000Z');
});

test('fsTimestampToDate: invalid date shape returns null instead of an Invalid Date', () => {
  assert.strictEqual(fsTimestampToDate({ notADate: true }), null);
  assert.strictEqual(fsTimestampToDate('not-a-real-date-string'), null);
});

test('termArrCount: counts arrays, treats non-arrays as 0', () => {
  assert.strictEqual(termArrCount([1, 2, 3]), 3);
  assert.strictEqual(termArrCount([]), 0);
  assert.strictEqual(termArrCount(null), 0);
  assert.strictEqual(termArrCount(undefined), 0);
  assert.strictEqual(termArrCount('not an array'), 0);
});

test('termItemLines: extracts a display label per item, capped at max, dropping empty labels', () => {
  const items = [
    { title: 'First signal' },
    { headline: 'Second signal' },
    {}, // no usable text field -> filtered out
    { name: 'Fourth signal' },
    { summary: 'Fifth signal (beyond default max of 4)' },
  ];
  const lines = termItemLines(items, '· web');
  assert.strictEqual(lines.length, 3); // {} produced no text and was filtered; slice(0,4) caps input to first 4
  assert.deepStrictEqual(lines[0], { type: 'dim', prefix: '· web', text: 'First signal' });
  assert.deepStrictEqual(lines[2], { type: 'dim', prefix: '· web', text: 'Fourth signal' });
});
