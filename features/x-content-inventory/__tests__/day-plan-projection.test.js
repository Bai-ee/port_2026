import test from 'node:test';
import assert from 'node:assert/strict';
import { projectDayPlan, slotState, STORY_PREVIEW_CHARS } from '../day-plan-projection.js';

// A slot's state is read at three places in the terminal view. The card reads it
// once, from here, so these are the cases that keep the two views honest.
test('slotState — a scan slot is a scan slot even with nothing attached', () => {
  assert.equal(slotState({ source: 'scan', type: 'quote-react' }), 'scan');
});

test('slotState — a ledger slot with a story is filled, without one is empty', () => {
  assert.equal(slotState({ source: 'ledger', story: 'a past winner' }), 'ledger');
  assert.equal(slotState({ source: 'ledger', story: null }), 'empty');
});

test('slotState — an inventory slot needs a packageId, or it is a gap', () => {
  assert.equal(slotState({ source: 'inventory', packageId: 'rec-001' }), 'inventory');
  assert.equal(slotState({ source: 'inventory', packageId: null }), 'gap');
});

test('an empty ledger slot is not counted as an inventory gap', () => {
  // The distinction is the whole point: "no eligible past winner" is not a
  // shortfall in the inventory and must not inflate the number the card shows
  // as the thing to go make.
  const out = projectDayPlan({
    slots: [{ slot: 'A', source: 'ledger', story: null, matchReason: 'no eligible past winner' }],
    gaps: [],
  });
  assert.equal(out.summary.empty, 1);
  assert.equal(out.summary.gaps, 0);
  assert.equal(out.slots[0].state, 'empty');
});

test('each route into a slot is counted separately, not rolled into one filled count', () => {
  const out = projectDayPlan({
    slots: [
      { slot: 'A', source: 'inventory', packageId: 'p1' },
      { slot: 'B', source: 'scan' },
      { slot: 'C', source: 'ledger', story: 'past winner' },
      { slot: 'D', source: 'inventory', packageId: null },
      { slot: 'E', source: 'scan' },
    ],
    gaps: [{ slot: 'D', type: 'original-showcase', need: 'a VIDEO package from: C1' }],
    // plan.filled would say 1 of 5 here — a workable day reading as two-fifths built.
    filled: 1,
  });
  assert.deepEqual(
    {
      inv: out.summary.fromInventory,
      led: out.summary.fromLedger,
      scan: out.summary.fromScan,
      gaps: out.summary.gaps,
    },
    { inv: 1, led: 1, scan: 2, gaps: 1 },
  );
  assert.equal(out.summary.slots, 5);
});

test('an adopted slot carries its reason to the card', () => {
  // The adoption floor is a proposed change to a shared module, applied outside
  // it. A card that renders the moved slot without saying so presents a
  // proposal as the plan.
  const out = projectDayPlan({
    slots: [{
      slot: 'C', source: 'ledger', story: 'x', type: 'self-quote',
      adopted: true, adoptedFrom: 'original-text', adoptReason: 'benchmark runs self-quote at 2.49% share but 1.67× lift',
    }],
  });
  assert.equal(out.slots[0].adopted, true);
  assert.equal(out.slots[0].adoptedFrom, 'original-text');
  assert.match(out.slots[0].adoptReason, /1\.67/);
  assert.equal(out.summary.adopted, 1);
});

test('story is flattened and truncated for the wire', () => {
  const long = `${'a'.repeat(400)}`;
  const out = projectDayPlan({
    slots: [
      { slot: 'A', source: 'inventory', packageId: 'p1', story: long },
      { slot: 'B', source: 'inventory', packageId: 'p2', story: 'line one\n\nline  two' },
    ],
  });
  assert.equal(out.slots[0].story.length, STORY_PREVIEW_CHARS);
  assert.ok(out.slots[0].story.endsWith('…'));
  assert.equal(out.slots[1].story, 'line one line two');
});

test('inventory issues keep only the rows that still need a human', () => {
  const out = projectDayPlan({
    audit: {
      total: 3,
      valid: 2,
      bySeries: { C1: 2, C3: 1 },
      results: [
        { id: 'clean', ok: true, errors: [], warnings: [] },
        { id: 'thin', ok: true, errors: [], warnings: ['story is very short'] },
        { id: 'broken', ok: false, errors: ['missing series'], warnings: [] },
      ],
    },
    slots: [],
  });
  assert.equal(out.inventory.total, 3);
  assert.equal(out.inventory.valid, 2);
  assert.equal(out.inventory.invalid, 1);
  assert.deepEqual(out.inventory.issues.map((i) => i.id), ['thin', 'broken']);
});

test('benchmarked is false when no benchmark corpus was loaded', () => {
  // Without a gap report buildCalendar falls back to the account's current mix.
  // The card has to be able to say so rather than implying a measured plan.
  assert.equal(projectDayPlan({ slots: [] }).benchmarked, false);
  assert.equal(projectDayPlan({ slots: [], benchStats: { byType: {} } }).benchmarked, true);
});

test('never throws on junk', () => {
  for (const junk of [undefined, null, {}, { slots: null }, { slots: [null] }, { gaps: 'nope' }]) {
    assert.doesNotThrow(() => projectDayPlan(junk));
  }
  const out = projectDayPlan({ slots: [null] });
  assert.equal(out.slots.length, 1);
  assert.equal(out.slots[0].state, 'gap');
});
