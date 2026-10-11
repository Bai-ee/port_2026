// Strategy slots: pillar mapping, Chicago->UTC slot times across the DST change,
// the always-present reply slot, strategy ordering, Tier 1 request, and the
// plan-day hoursFromNow fix (Chicago clock was being read as UTC).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pillarFor, slotsFromPlan, planSlots, STRATEGY_PRIORITY, TIER_1_MAX_POSTS, FLOOR_REASON } from '../daily-loop/slots.js';
import { buildDayPlan } from '../plan-day.js';

const planOf = (date, slots, extra = {}) => ({ date, slots, report: null, ...extra });
const slot = (letter, timeCT, type, lane = 'work') => ({ slot: letter, timeCT, type, lane, dynamic: type === 'quote-react' });

test('pillarFor maps type and lane to P1-P6, null for non-pillar types', () => {
  const cases = [
    [{ type: 'quote-react', lane: 'music' }, 'P1'],
    [{ type: 'quote-commentary', lane: 'craft' }, 'P1'],
    [{ type: 'original-showcase', lane: 'music' }, 'P6'],
    [{ type: 'original-showcase', lane: 'work' }, 'P2'],
    [{ type: 'original-text', lane: 'craft' }, 'P4'],
    [{ type: 'original-text', lane: 'meta' }, 'P5'],
    [{ type: 'original-text', lane: 'work' }, 'P3'],
    [{ type: 'original-text', lane: 'music' }, 'P3'],
    [{ type: 'reply', lane: 'work' }, null],
    [{ type: 'self-quote', lane: 'work' }, null],
    [{ type: 'retweet', lane: 'work' }, null],
  ];
  for (const [input, want] of cases) assert.equal(pillarFor(input), want, JSON.stringify(input));
});

test('slot start times are real UTC across the CDT/CST change', () => {
  const cdt = slotsFromPlan(planOf('2026-10-10', [slot('A', '09:30', 'quote-react')]));
  const cst = slotsFromPlan(planOf('2026-11-02', [slot('A', '09:30', 'quote-react')]));
  assert.equal(cdt.find((s) => s.letter === 'A').startsAt, '2026-10-10T14:30:00.000Z');
  assert.equal(cst.find((s) => s.letter === 'A').startsAt, '2026-11-02T15:30:00.000Z');
});

test('the reply minimum is always a slot, even when the calendar has none', () => {
  const none = slotsFromPlan(planOf('2026-10-10', []), { typeFloors: {} });
  assert.equal(none.length, 1);
  assert.deepEqual([none[0].letter, none[0].type, none[0].source, none[0].startsAt], ['R', 'reply', 'daily-minimum', null]);
});

test('slots come back in strategy order, ties by clock time', () => {
  const out = slotsFromPlan(planOf('2026-10-10', [
    slot('A', '08:00', 'original-text'),
    slot('B', '10:00', 'quote-react'),
    slot('C', '09:00', 'original-showcase'),
    slot('D', '07:00', 'quote-react'),
    slot('E', '12:00', 'retweet'),
  ]));
  assert.deepEqual(out.map((s) => s.letter), ['D', 'B', 'C', 'A', 'R', 'E']);
  assert.equal(out.find((s) => s.letter === 'E').manual, true);
  assert.ok(STRATEGY_PRIORITY['quote-react'] < STRATEGY_PRIORITY['original-showcase']);
});

test('planSlots asks for Tier 1: default left alone, large counts clamped', () => {
  const seen = [];
  const fake = (input) => { seen.push(input.posts); return planOf(input.date, [slot('A', '09:00', 'quote-react')]); };
  planSlots({ buildDayPlan: fake, input: { date: '2026-10-10' } });
  planSlots({ buildDayPlan: fake, input: { date: '2026-10-10', posts: 12 } });
  planSlots({ buildDayPlan: fake, input: { date: '2026-10-10', posts: 5 } });
  assert.deepEqual(seen, [undefined, TIER_1_MAX_POSTS, 5]);
});

test('strategySource reports tier and where the mix came from', () => {
  const fake = (withReport) => () => planOf('2026-10-10', [slot('A', '09:00', 'quote-react')], { report: withReport ? {} : null });
  const own = planSlots({ buildDayPlan: fake(false), input: { date: '2026-10-10' } }).strategySource;
  const gap = planSlots({ buildDayPlan: fake(true), input: { date: '2026-10-10' } }).strategySource;
  assert.equal(own.mixSource, 'own-mix');
  assert.equal(gap.mixSource, 'gap-report');
  assert.equal(own.tier, 1);
  assert.deepEqual(own.slotLetters, ['A', 'R']);
});

test('buildDayPlan hoursFromNow uses the Chicago clock, not UTC', () => {
  // 06:00 CDT = 11:00Z. Every real slot is later today, so none may be 0h away
  // unless its Chicago time has already passed.
  const now = Date.parse('2026-10-10T11:00:00Z');
  const plan = buildDayPlan({ corpusRows: [], packages: [], date: '2026-10-10', now });
  for (const s of plan.slots) {
    const [h, m] = s.timeCT.split(':').map(Number);
    const wantHours = Math.max(0, (h + 5 - 11) + m / 60);
    assert.ok(Math.abs(s.hoursFromNow - wantHours) < 1e-9, `${s.slot} ${s.timeCT}: ${s.hoursFromNow} vs ${wantHours}`);
  }
});

// --- type floor (quote-react >= 1 a day) ---

test('floor: the exact reason text is the contract', () => {
  assert.equal(FLOOR_REASON, "kept: quote-react is for reach; likes-only lift can't see views");
});

test('floor: mix says decrease (no quote-react) on a full day -> lowest-priority slot becomes quote-react, count unchanged', () => {
  const plan = planOf('2026-10-10', [
    slot('A', '09:30', 'original-showcase'), slot('B', '12:30', 'original-text'),
    slot('C', '15:00', 'self-quote'), slot('D', '17:30', 'original-text'),
  ], { report: { projection: { targetMix: { 'original-showcase': 50, 'original-text': 50 } } } });
  const out = slotsFromPlan(plan, { maxSlots: 4 });
  const cal = out.filter((s) => s.source !== 'daily-minimum');
  assert.equal(cal.length, 4);
  const q = out.filter((s) => s.type === 'quote-react');
  assert.equal(q.length, 1);
  // self-quote (priority 5) is the lowest-priority slot; its letter and clock time stay.
  assert.deepEqual([q[0].letter, q[0].timeCT, q[0].startsAt, q[0].pillar], ['C', '15:00', '2026-10-10T20:00:00.000Z', 'P1']);
  assert.equal(q[0].fillReason, FLOOR_REASON);
  assert.equal(out[0].letter, 'C', 'quote-react now fills first');
});

test('floor: a day with room gets an added slot; a day already at the clamp never grows', () => {
  const two = planOf('2026-10-10', [slot('A', '09:30', 'original-showcase'), slot('B', '12:30', 'original-text')]);
  const room = slotsFromPlan(two, { maxSlots: 4 }).filter((s) => s.source !== 'daily-minimum');
  assert.equal(room.length, 3);
  const added = room.find((s) => s.type === 'quote-react');
  assert.deepEqual([added.letter, added.source, added.fillReason], ['C', 'floor', FLOOR_REASON]);
  const full = slotsFromPlan(two, { maxSlots: 2 }).filter((s) => s.source !== 'daily-minimum');
  assert.equal(full.length, 2);
  assert.equal(full.filter((s) => s.type === 'quote-react').length, 1);
});

test('floor: planSlots clamps with the post count, so a full Tier 1 day swaps instead of growing', () => {
  const fake = () => planOf('2026-10-10', [slot('A', '09:30', 'original-showcase'), slot('B', '12:30', 'original-text'), slot('C', '17:30', 'retweet')]);
  const { slots } = planSlots({ buildDayPlan: fake, input: { date: '2026-10-10', posts: 3 } });
  assert.equal(slots.filter((s) => s.source !== 'daily-minimum').length, 3);
  assert.equal(slots.find((s) => s.type === 'quote-react').letter, 'C');
  assert.equal(slots.some((s) => s.type === 'retweet'), false);
});

test('floor: not added when the day already has a quote-react (and no reason is stamped without a decrease)', () => {
  const plan = planOf('2026-10-10', [slot('A', '09:30', 'quote-react'), slot('B', '12:30', 'original-text')]);
  const out = slotsFromPlan(plan, { maxSlots: 2 }).filter((s) => s.source !== 'daily-minimum');
  assert.deepEqual(out.map((s) => s.type).sort(), ['original-text', 'quote-react']);
  assert.equal(out.find((s) => s.type === 'quote-react').fillReason, null);
  assert.equal(out.find((s) => s.type === 'quote-react').floor, undefined);
});

test('floor: a quote-react the gap report wanted gone but that is still on the day is tagged kept', () => {
  const plan = planOf('2026-10-10', [slot('A', '09:30', 'quote-react')], { report: { projection: { targetMix: { 'original-text': 100 } } } });
  const q = slotsFromPlan(plan, { maxSlots: 1 }).find((s) => s.type === 'quote-react');
  assert.equal(q.fillReason, FLOOR_REASON);
});

test('floor: typeFloors is data-driven; {} turns it off, a larger floor is honoured, DST time untouched', () => {
  const plan = planOf('2026-11-02', [slot('A', '09:30', 'original-text'), slot('B', '12:30', 'original-text'), slot('C', '17:30', 'original-text')]);
  assert.equal(slotsFromPlan(plan, { typeFloors: {} }).some((s) => s.type === 'quote-react'), false);
  const two = slotsFromPlan(plan, { typeFloors: { 'quote-react': 2 }, maxSlots: 3 });
  assert.equal(two.filter((s) => s.type === 'quote-react').length, 2);
  // Converted slots keep their own clock time, read in the day's zone (CST on 11-02).
  assert.deepEqual(two.filter((s) => s.type === 'quote-react').map((s) => s.startsAt).sort(), ['2026-11-02T18:30:00.000Z', '2026-11-02T23:30:00.000Z']);
});

test('floor: an adopted slot is never the victim; the next-lowest non-adopted slot is converted', () => {
  const plan = planOf('2026-10-10', [
    slot('A', '09:30', 'original-showcase'), slot('B', '12:30', 'original-text'),
    { ...slot('C', '15:00', 'self-quote'), adopted: true }, slot('D', '17:30', 'original-text'),
  ], { report: { projection: { targetMix: { 'original-showcase': 50, 'original-text': 50 } } } });
  const out = slotsFromPlan(plan, { maxSlots: 4 });
  const self = out.find((s) => s.letter === 'C');
  assert.deepEqual([self.type, self.adopted], ['self-quote', true]);
  const q = out.filter((s) => s.type === 'quote-react');
  assert.equal(q.length, 1);
  assert.notEqual(q[0].letter, 'C');
  assert.equal(q[0].adopted, false);
  assert.equal(out.filter((s) => s.source !== 'daily-minimum').length, 4);
});

test('floor: when every slot is adopted on a full day the floor is not added and the day is unchanged', () => {
  const plan = planOf('2026-10-10', [
    { ...slot('A', '09:30', 'original-showcase'), adopted: true }, { ...slot('B', '12:30', 'original-text'), adopted: true },
  ]);
  const out = slotsFromPlan(plan, { maxSlots: 2 }).filter((s) => s.source !== 'daily-minimum');
  assert.deepEqual(out.map((s) => [s.letter, s.type, s.adopted]).sort(), [['A', 'original-showcase', true], ['B', 'original-text', true]]);
});
