// Strategy slots: pillar mapping, Chicago->UTC slot times across the DST change,
// the always-present reply slot, strategy ordering, Tier 1 request, and the
// plan-day hoursFromNow fix (Chicago clock was being read as UTC).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pillarFor, slotsFromPlan, planSlots, STRATEGY_PRIORITY, TIER_1_MAX_POSTS } from '../daily-loop/slots.js';
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
  const none = slotsFromPlan(planOf('2026-10-10', []));
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
