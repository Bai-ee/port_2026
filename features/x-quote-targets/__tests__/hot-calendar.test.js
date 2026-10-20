import test from 'node:test';
import assert from 'node:assert/strict';
import { hotPicksToTargets, hotScanForLoop, quoteSlotTimes, quotesLeftToday, assignQuoteSlots, windowHoursOf } from '../hot-calendar.js';

const NOW = Date.parse('2026-10-20T18:00:00Z');
const iso = (h) => new Date(NOW - h * 3_600_000).toISOString();
const pick = (id, rank, o = {}) => ({ id, lane: 'design', windowHours: 36, url: `https://x.com/a${id}/status/${id}`, author: `a${id}`, text: 't', createdAt: iso(5), rank, momentum: 'new', fit: 0.8, angle: 'craft', why: 'w', ...o });

test('hotPicksToTargets: rank order, passed and expired picks dropped, per-pick window', () => {
  const hot = { picks: { design: [pick('1', 0.5), pick('2', 0.9), pick('3', 0.7, { createdAt: iso(40) })], music: [pick('4', 0.6, { lane: 'music', windowHours: 72, createdAt: iso(60) })] }, dismissed: ['1'] };
  assert.deepEqual(hotPicksToTargets(hot, { now: NOW }).map((t) => t.id), ['2', '4']);
  assert.deepEqual(hotPicksToTargets(null, { now: NOW }), []);
  assert.deepEqual(hotPicksToTargets({ dismissed: ['x'] }, { now: NOW }), [], 'a dismiss-only doc (no scan yet) is empty');
  assert.equal(windowHoursOf({}), 36);
});

test('hotScanForLoop: daily-loop scan input from hot picks only', () => {
  assert.equal(hotScanForLoop(null), null);
  const s = hotScanForLoop({ scannedAt: iso(1), picks: { design: [pick('1', 0.9)], music: [] } }, { now: NOW });
  assert.equal(s.generatedAt, iso(1));
  assert.deepEqual(s.candidates.map((c) => [c.id, c.vein, c.author]), [['1', 'design', 'a1']]);
});

test('quoteSlotTimes: slots whose note says quote; else 07:00 / 11:00', () => {
  assert.deepEqual(quoteSlotTimes({ slots: [{ time: '07:00', note: 'quote-react' }, { time: '09:00', note: 'showcase' }, { time: '11:00', note: 'Quote react' }] }), ['07:00', '11:00']);
  assert.deepEqual(quoteSlotTimes(null), ['07:00', '11:00']);
});

test('quotesLeftToday: scan count when from today (CT), never above 4 - saved quote posts', () => {
  assert.equal(quotesLeftToday({ scannedAt: iso(2), quotesLeftToday: 3 }, { now: NOW }), 3);
  assert.equal(quotesLeftToday({ scannedAt: iso(30), quotesLeftToday: 0 }, { now: NOW }), 4);
  assert.equal(quotesLeftToday({ scannedAt: iso(2), quotesLeftToday: 3 }, { now: NOW, quotePostsToday: 2 }), 2);
  assert.equal(quotesLeftToday(null, { now: NOW, quotePostsToday: 9 }), 0);
});

test('assignQuoteSlots: next open slots first (posted ones skipped), the rest are extra', () => {
  const t = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(assignQuoteSlots(t).map((x) => [x.slotTime, x.slotKind]), [['07:00', 'baseline'], ['11:00', 'baseline'], [null, 'extra']]);
  assert.deepEqual(assignQuoteSlots(t, { quotesPostedToday: 1, left: 3 }).map((x) => [x.slotTime, x.slotKind, x.quotesLeftToday]), [['11:00', 'baseline', 3], [null, 'extra', 3], [null, 'extra', 3]]);
});
