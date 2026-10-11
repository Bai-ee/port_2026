// typeCaps (Strategy plan) in slots.js: a cap is the max CALENDAR slots of a type per day; floors win; deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slotsFromPlan, planSlots, capReason, DEFAULT_TYPE_FLOORS } from '../daily-loop/slots.js';

const slot = (letter, timeCT, type, extra = {}) => ({ slot: letter, timeCT, type, lane: 'work', dynamic: type === 'quote-react', ...extra });
const planOf = (slots) => ({ date: '2026-10-10', slots, report: null });
const cal = (slots) => slots.filter((s) => s.source !== 'daily-minimum');
const types = (slots) => cal(slots).map((s) => `${s.letter}:${s.type}`).sort();

const FOUR_QR = [slot('A', '08:00', 'quote-react'), slot('B', '10:00', 'quote-react'), slot('C', '12:00', 'quote-react'), slot('D', '14:00', 'original-showcase')];

test('no caps (and an empty caps map) leave the day exactly as before', () => {
  const none = slotsFromPlan(planOf(FOUR_QR));
  assert.deepEqual(slotsFromPlan(planOf(FOUR_QR), { typeCaps: {} }), none);
  assert.deepEqual(slotsFromPlan(planOf(FOUR_QR), { typeCaps: undefined }), none);
});

test('a cap converts the LATEST surplus slots in place (letter and time kept) to original-text', () => {
  const out = slotsFromPlan(planOf(FOUR_QR), { typeCaps: { 'quote-react': 1 } });
  assert.deepEqual(types(out), ['A:quote-react', 'B:original-text', 'C:original-text', 'D:original-showcase']);
  const b = out.find((s) => s.letter === 'B');
  assert.equal(b.timeCT, '10:00');
  assert.equal(b.capped, true);
  assert.equal(b.fillReason, capReason('quote-react', 1));
  assert.equal(b.pillar, 'P3');
  assert.equal(b.dynamic, false);
  assert.equal(cal(out).length, 4, 'a conversion never changes the day size');
});

test('when the first conversion target is itself capped the next one is used; when none is, the slot is dropped', () => {
  const next = slotsFromPlan(planOf(FOUR_QR), { typeCaps: { 'quote-react': 1, 'original-text': 1 } });
  assert.deepEqual(types(next), ['A:quote-react', 'B:original-showcase', 'C:original-text', 'D:original-showcase']); // latest (C) takes the first target
  const all = { 'quote-react': 1, 'original-text': 0, 'original-showcase': 1, 'self-quote': 0 };
  const dropped = slotsFromPlan(planOf(FOUR_QR), { typeCaps: all });
  assert.deepEqual(types(dropped), ['A:quote-react', 'D:original-showcase']);
});

test('floor + cap interplay: the effective cap is never below the floor', () => {
  const out = slotsFromPlan(planOf(FOUR_QR), { typeFloors: { 'quote-react': 2 }, typeCaps: { 'quote-react': 1 } });
  assert.equal(cal(out).filter((s) => s.type === 'quote-react').length, 2);
  const zero = slotsFromPlan(planOf(FOUR_QR), { typeFloors: {}, typeCaps: { 'quote-react': 0 } });
  assert.equal(cal(zero).filter((s) => s.type === 'quote-react').length, 0);
});

test('a floor still adds a slot, then a cap on ANOTHER type is applied after it', () => {
  const day = [slot('A', '09:00', 'original-text'), slot('B', '11:00', 'original-text'), slot('C', '13:00', 'original-text')];
  const out = slotsFromPlan(planOf(day), { typeFloors: { 'quote-react': 1 }, typeCaps: { 'original-text': 1 } });
  assert.deepEqual(types(out), ['A:original-text', 'B:original-showcase', 'C:quote-react']);
  assert.equal(out.find((s) => s.letter === 'C').floor, true);
});

test('adopted slots are never capped away; an all-adopted surplus stays over the cap', () => {
  const day = [slot('A', '08:00', 'self-quote', { adopted: true }), slot('B', '10:00', 'self-quote', { adopted: true }), slot('C', '12:00', 'self-quote')];
  const out = slotsFromPlan(planOf(day), { typeFloors: {}, typeCaps: { 'self-quote': 1 } });
  assert.deepEqual(cal(out).filter((s) => s.type === 'self-quote').map((s) => s.letter).sort(), ['A', 'B']);
  assert.equal(out.find((s) => s.letter === 'C').type, 'original-text');
});

test('deterministic: key order and input order do not change the result', () => {
  const a = slotsFromPlan(planOf(FOUR_QR), { typeCaps: { 'quote-react': 1, 'original-showcase': 0 } });
  const b = slotsFromPlan(planOf([...FOUR_QR].reverse()), { typeCaps: { 'original-showcase': 0, 'quote-react': 1 } });
  assert.deepEqual(types(a), types(b));
});

test('planSlots: caps ride through, clamp holds, planMeta lands on strategySource only when given', () => {
  const fake = () => planOf(FOUR_QR);
  const plain = planSlots({ buildDayPlan: fake, input: { date: '2026-10-10', posts: 12 }, typeFloors: DEFAULT_TYPE_FLOORS });
  assert.equal('planSource' in plain.strategySource, false);
  const capped = planSlots({
    buildDayPlan: fake, input: { date: '2026-10-10', posts: 12 }, typeCaps: { 'quote-react': 1 },
    planMeta: { planSource: 'plan-doc', planVersion: 4 },
  });
  assert.equal(capped.strategySource.planSource, 'plan-doc');
  assert.equal(capped.strategySource.planVersion, 4);
  assert.equal(capped.strategySource.postsRequested, 7, 'posts above Tier 1 are clamped to 7');
  assert.equal(cal(capped.slots).filter((s) => s.type === 'quote-react').length, 1);
});

test('a converted slot keeps its original engine attribution', () => {
  const day = [slot('A', '08:00', 'quote-react', { engine: 'quote' }), slot('B', '10:00', 'quote-react', { engine: 'quote' }), slot('C', '12:00', 'original-showcase', { engine: 'authored' })];
  const out = slotsFromPlan(planOf(day), { typeFloors: {}, typeCaps: { 'quote-react': 1 } });
  const b = out.find((s) => s.letter === 'B');
  assert.equal(b.type, 'original-text');
  assert.equal(b.engine, 'quote');
});

test('planSlots surfaces a cap-dropped slot as a slot-dropped:<letter>:cap gap; no caps -> no gaps', () => {
  const allCapped = { 'quote-react': 1, 'original-text': 0, 'original-showcase': 1, 'self-quote': 0 };
  const buildDayPlan = () => planOf(FOUR_QR);
  const dropped = planSlots({ buildDayPlan, input: { posts: 4 }, typeFloors: {}, typeCaps: allCapped });
  assert.deepEqual(dropped.gaps.map((g) => g.code).sort(), ['slot-dropped:B:cap', 'slot-dropped:C:cap']);
  assert.match(dropped.gaps[0].message, /dropped/);
  assert.equal(dropped.strategySource.authoredPerDay, 2);
  assert.deepEqual(planSlots({ buildDayPlan, input: { posts: 4 } }).gaps, []);
});
