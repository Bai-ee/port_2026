import test from 'node:test';
import assert from 'node:assert/strict';
import { onThisDay, hasEventDate, describeEventDate } from '../throwback.js';

const it = (id, facets, extra = {}) => ({ id, facets, ...extra });
const items = [
  it('a', { eventMonthDay: '11-15', eventYear: 2018, eventDate: '2018-11-15' }),
  it('b', { eventMonthDay: '11-17' }),
  it('c', { eventMonthDay: '11-30' }),
  it('d', { eventDates: [{ monthDay: '11-13', year: 2010, yearSource: 'printed' }] }),
  it('e', { eraYear: 1997 }, { capturedAt: '2015-11-15T00:00:00Z' }),
];

test('onThisDay: window, year ignored, annotations, capturedAt ignored', () => {
  const r = onThisDay(items, '2026-11-15');
  assert.deepEqual(r.map((x) => x.item.id), ['a', 'd', 'b']);
  assert.deepEqual(r[0], { item: items[0], monthDay: '11-15', yearsAgo: 8, yearKnown: true });
  assert.deepEqual([r[1].yearsAgo, r[1].yearKnown], [16, true]);
  assert.deepEqual([r[2].yearsAgo, r[2].yearKnown], [null, false]);
  assert.deepEqual(onThisDay(items, '2026-11-15', { windowDays: 0 }).map((x) => x.item.id), ['a']);
});

test('onThisDay: Dec/Jan wrap uses the anniversary year', () => {
  const list = [it('x', { eventMonthDay: '12-30', eventYear: 2018 }), it('y', { eventMonthDay: '01-02', eventYear: 2020 })];
  const r = onThisDay(list, '2026-01-01');
  assert.deepEqual(r.map((x) => x.item.id).sort(), ['x', 'y']);
  assert.equal(r.find((x) => x.item.id === 'x').yearsAgo, 7);
  assert.equal(r.find((x) => x.item.id === 'y').yearsAgo, 6);
  assert.deepEqual(onThisDay(list, '2026-06-01'), []);
});

test('onThisDay: Feb 29 events show in non-leap years and leap years', () => {
  const list = [it('l', { eventMonthDay: '02-29', eventYear: 2016 })];
  assert.equal(onThisDay(list, '2027-02-28', { windowDays: 0 }).length, 1);
  assert.equal(onThisDay(list, '2027-03-02').length, 1);
  assert.equal(onThisDay(list, '2028-02-29', { windowDays: 0 })[0].yearsAgo, 12);
  assert.equal(onThisDay(list, '2027-03-05').length, 0);
});

test('onThisDay: bad inputs', () => {
  assert.deepEqual(onThisDay(items, 'nope'), []);
  assert.deepEqual(onThisDay(null, '2026-01-01'), []);
  assert.deepEqual(onThisDay(items, '2026-02-30'), []);
});

test('hasEventDate', () => {
  assert.equal(hasEventDate(items[0]), true);
  assert.equal(hasEventDate(items[3]), true);
  assert.equal(hasEventDate(items[4]), false);
});

test('describeEventDate copy variants', () => {
  assert.equal(describeEventDate({ eraYear: 1997 }), null);
  assert.deepEqual(describeEventDate({ eventDate: '2018-11-15', eventYear: 2018, eventYearSource: 'weekday', eventDateRaw: 'THURSDAY 11/15', eventDates: [{ monthDay: '11-15', year: 2018, yearSource: 'weekday', weekday: 'thursday' }] }),
    { line: 'Event date: Nov 15, 2018 · inferred from Thursday', printed: 'Printed: "THURSDAY 11/15"' });
  assert.equal(describeEventDate({ eventMonthDay: '11-15' }).line, 'Event date: Nov 15 · year unknown');
  assert.equal(describeEventDate({ eventMonthDay: '11-15', eventYearCandidates: [2012, 2018] }).line, 'Event date: Nov 15 · year could be 2012 or 2018');
  assert.equal(describeEventDate({ eventDate: '2018-11-15', eventYearSource: 'printed' }).line, 'Event date: Nov 15, 2018');
  assert.equal(describeEventDate({ eventMonthDay: '11-15' }).printed, null);
});
