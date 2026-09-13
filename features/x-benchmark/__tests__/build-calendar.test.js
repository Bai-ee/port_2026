import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCalendar, allocateSlots, pickHours, POSTS_PER_OCCUPIED_HOUR } from '../build-calendar.js';
import { summarizeCorpus } from '../summarize.js';
import { compareToBenchmark } from '../compare.js';
import { resolveTier } from '../profile.js';
import { buildDayPlan } from '../../x-quote-targets/day-plan.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const load = (f) => JSON.parse(readFileSync(path.join(REPO, 'docs/audits', f), 'utf8'));
const seb = summarizeCorpus(load('seb-design-x-corpus.json'), { handle: 'seb__design' });
const baiee = summarizeCorpus(load('bai-ee-x-corpus.json'), { handle: 'bai_ee' });
const report = compareToBenchmark({ own: baiee, benchmark: seb });
const tier = resolveTier({ currentAuthoredPerDay: baiee.cadence.authoredPerActiveDay });

const calendar = buildCalendar({
  report,
  ownStats: baiee,
  tier,
  profile: { lanes: ['craft', 'work', 'music'] },
  days: 15,
  startDate: '2026-09-15',
});

test('the generated calendar is the shape day-plan already consumes', () => {
  // The contract that lets this replace the hand-written JSON without touching
  // the merge logic.
  const plan = buildDayPlan({ calendar, dayNumber: 1, candidates: [], now: Date.parse('2026-09-15T12:00:00Z') });
  assert.equal(plan.slots.length, calendar.days[0].slots.length);
  assert.ok(plan.slots.every((s) => typeof s.type === 'string' && typeof s.timeCT === 'string'));
});

test('slot count comes from the tier, not the benchmark', () => {
  // The benchmark publishes 9.1 authored posts a day. Handing that to an
  // account currently at 1.4 is the spike-then-stop failure mode.
  assert.equal(calendar.meta.slotsPerDay, tier.authoredPerDay);
  assert.ok(calendar.meta.slotsPerDay < seb.cadence.authoredPerActiveDay);
  for (const day of calendar.days) assert.equal(day.slots.length, tier.authoredPerDay);
});

test('hours come from the account\'s own history, never the benchmark\'s', () => {
  // Clock hours are not comparable across accounts — different timezones,
  // different audiences. This is the one cross-account comparison the data
  // explicitly does not support.
  assert.equal(calendar.meta.hoursSource, 'own-history');
  const ownBest = baiee.byHour.filter((h) => h.n >= 3).sort((a, b) => b.lift - a.lift).map((h) => h.hour);
  for (const hour of calendar.meta.hours) assert.ok(ownBest.includes(hour), `hour ${hour} is not one of the account's own`);
});

test('an account with no history gets sane defaults rather than an empty day', () => {
  const empty = summarizeCorpus([], { handle: 'new' });
  const cal = buildCalendar({ report: {}, ownStats: empty, tier: { tier: 1, authoredPerDay: 4 } });
  assert.equal(cal.meta.hoursSource, 'defaults');
  assert.equal(cal.days[0].slots.length, 4);
  assert.ok(cal.days[0].slots.every((s) => /^\d{2}:\d{2}$/.test(s.timeCT)));
});

test('hours are added as volume grows, rather than stacking one hour deeper', () => {
  // Measured: the benchmark runs ~2 posts per occupied hour and is DENSER than
  // the client, so density is not the lever. The generator holds density and
  // adds hours.
  const small = buildCalendar({ report, ownStats: baiee, tier: { tier: 1, authoredPerDay: 4 } });
  const large = buildCalendar({ report, ownStats: baiee, tier: { tier: 4, authoredPerDay: 16 } });
  assert.ok(large.meta.occupiedHours > small.meta.occupiedHours);
  assert.equal(small.meta.occupiedHours, Math.ceil(4 / POSTS_PER_OCCUPIED_HOUR));
  assert.equal(large.meta.occupiedHours, Math.ceil(16 / POSTS_PER_OCCUPIED_HOUR));
});

test('the type mix is the report\'s actionable target, not the benchmark\'s raw shares', () => {
  assert.deepEqual(calendar.meta.targetMix, report.projection.targetMix);
  // The account's best type is held at its own (higher) share rather than cut
  // to the benchmark's.
  assert.ok(calendar.meta.targetMix['original-showcase'] > seb.byType['original-showcase'].share);
});

test('with no comparison available it falls back to the account\'s own mix', () => {
  const cal = buildCalendar({ report: {}, ownStats: baiee, tier: { tier: 1, authoredPerDay: 4 } });
  assert.ok(Object.keys(cal.meta.targetMix).length > 0);
  assert.equal(cal.meta.targetMix['original-showcase'], baiee.byType['original-showcase'].share);
});

test('slot allocation sums to the slot count exactly', () => {
  for (const slots of [1, 3, 4, 8, 12, 16]) {
    const alloc = allocateSlots({ a: 50, b: 30, c: 20 }, slots);
    const total = Object.values(alloc).reduce((x, y) => x + y, 0);
    assert.equal(total, slots, `allocation for ${slots} slots summed to ${total}`);
  }
});

test('a small share still earns a slot once the day is big enough', () => {
  const small = allocateSlots({ big: 90, small: 10 }, 4);
  assert.equal(small.small ?? 0, 0, 'a 10% type does not fit in a 4-slot day');
  const large = allocateSlots({ big: 90, small: 10 }, 12);
  assert.ok((large.small ?? 0) >= 1, 'it does fit in a 12-slot day');
});

test('quote-react slots are marked dynamic and the rest are not', () => {
  const flat = calendar.days.flatMap((d) => d.slots);
  for (const slot of flat) {
    assert.equal(slot.dynamic, slot.type === 'quote-react' || slot.type === 'quote-commentary');
  }
  assert.ok(flat.some((s) => s.dynamic), 'a calendar with no dynamic slot has nothing for the scan to fill');
});

test('types rotate across days so one slot is not the same type forever', () => {
  const firstSlotTypes = new Set(calendar.days.map((d) => d.slots[0].type));
  assert.ok(firstSlotTypes.size > 1);
});

test('generation is deterministic', () => {
  const again = buildCalendar({
    report, ownStats: baiee, tier, profile: { lanes: ['craft', 'work', 'music'] }, days: 15, startDate: '2026-09-15',
  });
  assert.deepEqual(again, calendar, 'same inputs must always produce the same calendar');
});

test('weekdays follow the start date when one is given', () => {
  assert.equal(calendar.days[0].weekday, 'Tue', '2026-09-15 is a Tuesday');
  assert.equal(calendar.days[6].weekday, 'Mon');
  const undated = buildCalendar({ report, ownStats: baiee, tier });
  assert.equal(undated.days[0].weekday, null, 'no start date must not invent one');
});

test('pickHours never returns duplicates or fewer than asked', () => {
  const hours = pickHours(baiee, 8);
  assert.equal(hours.length, 8);
  assert.equal(new Set(hours).size, 8);
  assert.deepEqual(hours, [...hours].sort((a, b) => a - b));
});

test('never throws on junk', () => {
  for (const input of [{}, { report: null, ownStats: 'x', tier: 42 }]) {
    const cal = buildCalendar(input);
    assert.ok(Array.isArray(cal.days) && cal.days.length > 0);
  }
});
