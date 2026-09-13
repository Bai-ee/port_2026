import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDayPlan, VEIN_SCORE_TOLERANCE, MAX_COMPOSED_LEN } from '../day-plan.js';

const NOW = Date.parse('2026-09-10T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../');
const realCalendar = JSON.parse(readFileSync(path.join(REPO, 'docs/audits/x-calendar-15day.json'), 'utf8'));

// --- tiny synthetic calendar, easier to reason about than the real one -----
function makeCalendar(slots) {
  return { days: [{ day: 1, weekday: 'Mon', theme: 'test day', slots }] };
}

const slotA = { slot: 'A', timeCT: '07:00', type: 'quote-react', lane: 'craft', copy: 'caption a', brief: 'b', asset: null, selfReply: null, guard: { hardBlock: false } };
const slotB = { slot: 'B', timeCT: '09:00', type: 'quote-react', lane: 'work', copy: 'caption b', brief: 'b', asset: null, selfReply: null, guard: { hardBlock: false } };
const slotC = { slot: 'C', timeCT: '10:30', type: 'original-showcase', lane: 'craft', copy: 'showcase copy', brief: null, asset: 'clip', selfReply: 'reply', score: 0.2, guard: { hardBlock: false } };

function cand(id, overrides = {}) {
  return {
    id,
    url: `https://x.com/someone/status/${id}`,
    author: 'someone',
    authorName: 'Someone',
    text: 'a post',
    createdAt: hoursAgo(2),
    ageHours: 2,
    likes: 100,
    reposts: 10,
    replies: 5,
    engagement: 115,
    velocity: 50,
    windowOpen: true,
    vein: null,
    hasMedia: true,
    score: 0.5,
    reasons: ['moving'],
    ...overrides,
  };
}

test('quote-react slots get candidates; other types never do', () => {
  const calendar = makeCalendar([slotA, slotB, slotC]);
  const quoteTargets = { generatedAt: new Date(NOW).toISOString(), candidates: [cand('1'), cand('2')] };
  const plan = buildDayPlan({ calendar, quoteTargets, dayNumber: 1, now: NOW });

  const a = plan.slots.find((s) => s.slot === 'A');
  const b = plan.slots.find((s) => s.slot === 'B');
  const c = plan.slots.find((s) => s.slot === 'C');
  assert.ok(a.candidate, 'quote-react slot A got a candidate');
  assert.ok(b.candidate, 'quote-react slot B got a candidate');
  assert.equal(c.candidate, null, 'non quote-react slot never gets a candidate');
  assert.equal(c.status, 'planned');
  assert.equal(c.composedCopy, null);
});

test('highest score assigned first; no candidate reused within a day', () => {
  const calendar = makeCalendar([slotA, slotB]);
  const low = cand('low', { score: 0.2, vein: null });
  const high = cand('high', { score: 0.9, vein: null });
  const quoteTargets = { generatedAt: new Date(NOW).toISOString(), candidates: [low, high] };
  const plan = buildDayPlan({ calendar, quoteTargets, dayNumber: 1, now: NOW });

  const a = plan.slots.find((s) => s.slot === 'A'); // earliest timeCT, first pick
  const b = plan.slots.find((s) => s.slot === 'B');
  assert.equal(a.candidate.id, 'high', 'the earliest slot gets the top-scoring candidate');
  assert.equal(b.candidate.id, 'low', 'the leftover candidate fills the next slot');
  assert.notEqual(a.candidate.id, b.candidate.id, 'a candidate is never reused within the day');
});

test('vein affinity applied when within tolerance, score still wins when not', () => {
  // Case 1: vein match is close enough (within VEIN_SCORE_TOLERANCE) -> vein wins.
  const calendarA = makeCalendar([slotA]); // slotA lane = 'craft'
  const offVein = cand('off', { score: 0.6, vein: 'work' });
  const onVein = cand('on', { score: 0.6 - VEIN_SCORE_TOLERANCE + 0.01, vein: 'craft' });
  const planClose = buildDayPlan({
    calendar: calendarA,
    quoteTargets: { generatedAt: new Date(NOW).toISOString(), candidates: [offVein, onVein] },
    dayNumber: 1,
    now: NOW,
  });
  const slotClose = planClose.slots.find((s) => s.slot === 'A');
  assert.equal(slotClose.candidate.id, 'on');
  assert.equal(slotClose.fillReason, 'vein match craft');

  // Case 2: vein match is too far below top score -> score dominates.
  const weakOnVein = cand('weak', { score: 0.6 - VEIN_SCORE_TOLERANCE - 0.1, vein: 'craft' });
  const planFar = buildDayPlan({
    calendar: calendarA,
    quoteTargets: { generatedAt: new Date(NOW).toISOString(), candidates: [offVein, weakOnVein] },
    dayNumber: 1,
    now: NOW,
  });
  const slotFar = planFar.slots.find((s) => s.slot === 'A');
  assert.equal(slotFar.candidate.id, 'off', 'score dominates over a weak vein match');
  assert.equal(slotFar.fillReason, 'top score');

  // Case 3: no vein-matching candidate exists at all -> explicit fallback reason.
  const planNone = buildDayPlan({
    calendar: calendarA,
    quoteTargets: { generatedAt: new Date(NOW).toISOString(), candidates: [cand('x', { vein: 'music', score: 0.7 })] },
    dayNumber: 1,
    now: NOW,
  });
  const slotNone = planNone.slots.find((s) => s.slot === 'A');
  assert.equal(slotNone.fillReason, 'fallback: no vein match');
});

test('unfilled slots still render with status needs-candidate', () => {
  const calendar = makeCalendar([slotA, slotB]);
  const quoteTargets = { generatedAt: new Date(NOW).toISOString(), candidates: [cand('only')] };
  const plan = buildDayPlan({ calendar, quoteTargets, dayNumber: 1, now: NOW });

  // 'ready' = candidate matched, draft not yet created. Nothing is 'drafted'
  // until the operator acts, and drafted candidates are excluded from assignment.
  const filled = plan.slots.filter((s) => s.status === 'ready');
  const unfilled = plan.slots.filter((s) => s.status === 'needs-candidate');
  assert.equal(filled.length, 1);
  assert.equal(unfilled.length, 1);
  assert.equal(unfilled[0].candidate, null);
  assert.equal(unfilled[0].fillReason, 'no candidate available');
  assert.equal(plan.coverage.quoteSlots, 2);
  assert.equal(plan.coverage.quoteSlotsFilled, 1);
  assert.equal(plan.coverage.unfilled, 1);
});

test('a stale (window-closed) candidate is only used as a last resort', () => {
  const calendar = makeCalendar([slotA, slotB]);
  const fresh = cand('fresh', { windowOpen: true, score: 0.3 });
  const stale = cand('stale', { windowOpen: false, score: 0.9 });
  const plan = buildDayPlan({
    calendar,
    quoteTargets: { generatedAt: new Date(NOW).toISOString(), candidates: [fresh, stale] },
    dayNumber: 1,
    now: NOW,
  });
  const a = plan.slots.find((s) => s.slot === 'A');
  const b = plan.slots.find((s) => s.slot === 'B');
  // The fresh (lower-scoring) candidate is preferred over the stale one, even
  // though the stale one scores higher, until nothing fresh is left.
  assert.equal(a.candidate.id, 'fresh');
  assert.equal(b.candidate.id, 'stale');
  assert.equal(b.fillReason, 'stale candidate — window closed');
});

test('composedCopy ends with the candidate URL and total is <=280, truncating the caption when needed', () => {
  const calendar = makeCalendar([slotA]);
  const shortCand = cand('short', { url: 'https://x.com/a/status/1' });
  const shortPlan = buildDayPlan({
    calendar,
    quoteTargets: { generatedAt: new Date(NOW).toISOString(), candidates: [shortCand] },
    dayNumber: 1,
    now: NOW,
  });
  const shortSlot = shortPlan.slots.find((s) => s.slot === 'A');
  assert.equal(shortSlot.composedCopy, 'caption a\n\nhttps://x.com/a/status/1');
  assert.ok(shortSlot.composedCopy.length <= MAX_COMPOSED_LEN);

  const longCopySlot = { ...slotA, copy: 'x'.repeat(400) };
  const longCandidate = cand('long', { url: 'https://x.com/somebody/status/1234567890123' });
  const longPlan = buildDayPlan({
    calendar: makeCalendar([longCopySlot]),
    quoteTargets: { generatedAt: new Date(NOW).toISOString(), candidates: [longCandidate] },
    dayNumber: 1,
    now: NOW,
  });
  const longSlot = longPlan.slots.find((s) => s.slot === 'A');
  assert.ok(longSlot.composedCopy.length <= MAX_COMPOSED_LEN, 'truncated to fit 280');
  assert.ok(longSlot.composedCopy.endsWith(longCandidate.url), 'the URL is never truncated');
});

test('existingDraftIds excludes candidates from assignment and from usableCount', () => {
  const calendar = makeCalendar([slotA]);
  const quoteTargets = {
    generatedAt: new Date(NOW).toISOString(),
    candidates: [cand('already-drafted', { score: 0.99 }), cand('fresh-one', { score: 0.4 })],
  };
  const plan = buildDayPlan({
    calendar,
    quoteTargets,
    dayNumber: 1,
    now: NOW,
    existingDraftIds: new Set(['already-drafted']),
  });
  const a = plan.slots.find((s) => s.slot === 'A');
  assert.equal(a.candidate.id, 'fresh-one', 'the already-drafted candidate is skipped entirely');
  assert.equal(plan.scan.usableCount, 1);

  // Also accepts a plain array.
  const planArr = buildDayPlan({ calendar, quoteTargets, dayNumber: 1, now: NOW, existingDraftIds: ['already-drafted'] });
  assert.equal(planArr.scan.usableCount, 1);
});

test('stale scan detection at the 12h boundary', () => {
  const calendar = makeCalendar([slotA]);
  const quoteTargets12h = { generatedAt: hoursAgo(12), candidates: [] };
  const atBoundary = buildDayPlan({ calendar, quoteTargets: quoteTargets12h, dayNumber: 1, now: NOW });
  assert.equal(atBoundary.scan.stale, false, 'exactly 12h old is not yet stale ("older than 12h")');
  assert.equal(atBoundary.scan.ageHours, 12);

  const quoteTargetsOver = { generatedAt: hoursAgo(12.1), candidates: [] };
  const overBoundary = buildDayPlan({ calendar, quoteTargets: quoteTargetsOver, dayNumber: 1, now: NOW });
  assert.equal(overBoundary.scan.stale, true);
});

test('missing or invalid generatedAt is stale with a null ageHours', () => {
  const calendar = makeCalendar([slotA]);
  for (const generatedAt of [undefined, null, 'not a date', 12345]) {
    const plan = buildDayPlan({ calendar, quoteTargets: { generatedAt, candidates: [] }, dayNumber: 1, now: NOW });
    assert.equal(plan.scan.ageHours, null);
    assert.equal(plan.scan.stale, true);
  }
});

test('null/undefined/malformed input never throws and returns a valid shape', () => {
  for (const bad of [undefined, null, {}, { calendar: null, quoteTargets: null }, { calendar: 'nope', quoteTargets: 42 }, 'garbage', 5]) {
    const plan = buildDayPlan(bad);
    assert.equal(typeof plan, 'object');
    assert.ok(Array.isArray(plan.slots));
    assert.deepEqual(plan.slots, []);
    assert.equal(plan.coverage.quoteSlots, 0);
    assert.equal(plan.coverage.quoteSlotsFilled, 0);
    assert.equal(plan.coverage.unfilled, 0);
  }
  // buildDayPlan() with zero args must also not throw.
  assert.doesNotThrow(() => buildDayPlan());
});

test('a malformed candidate list and malformed slots do not throw and are skipped safely', () => {
  const calendar = makeCalendar([slotA, null, { slot: 'Z' }]);
  const quoteTargets = { generatedAt: new Date(NOW).toISOString(), candidates: [null, 'nope', 42, cand('ok')] };
  assert.doesNotThrow(() => buildDayPlan({ calendar, quoteTargets, dayNumber: 1, now: NOW }));
  const plan = buildDayPlan({ calendar, quoteTargets, dayNumber: 1, now: NOW });
  assert.equal(plan.slots.length, 3);
  assert.equal(plan.scan.candidateCount, 4, 'candidateCount reflects the raw array length, malformed entries included');
});

test('an unmatched dayNumber still returns a well-formed empty plan', () => {
  const calendar = makeCalendar([slotA]);
  const plan = buildDayPlan({ calendar, quoteTargets: {}, dayNumber: 999, now: NOW });
  assert.equal(plan.day, 999);
  assert.equal(plan.weekday, null);
  assert.equal(plan.theme, null);
  assert.deepEqual(plan.slots, []);
  assert.equal(plan.coverage.quoteSlots, 0);
});

test('a real case loaded from docs/audits/x-calendar-15day.json day 1', () => {
  // Day 1 has three quote-react slots: A (craft, 07:00), B (work, 09:00), D (work, 13:00).
  const quoteTargets = {
    generatedAt: new Date(NOW - 3 * 3_600_000).toISOString(),
    candidates: [
      cand('craft-1', { vein: 'craft', score: 0.6, createdAt: hoursAgo(4), ageHours: 4 }),
      cand('work-1', { vein: 'work', score: 0.55, createdAt: hoursAgo(6), ageHours: 6 }),
      cand('unrelated', { vein: 'music', score: 0.7, createdAt: hoursAgo(2), ageHours: 2 }),
    ],
  };
  const plan = buildDayPlan({ calendar: realCalendar, quoteTargets, dayNumber: 1, now: NOW });

  assert.equal(plan.day, 1);
  assert.equal(plan.weekday, 'Mon');
  assert.equal(plan.theme, "cloth that isn't fabric");
  assert.equal(plan.slots.length, 8, 'all 8 daily slots are present');
  assert.equal(plan.coverage.quoteSlots, 3);
  assert.equal(plan.coverage.quoteSlotsFilled, 3, 'three candidates exactly cover the three quote-react slots');
  assert.equal(plan.coverage.unfilled, 0);

  const nonQuote = plan.slots.filter((s) => s.type !== 'quote-react');
  assert.ok(nonQuote.every((s) => s.candidate === null && s.status === 'planned'));

  const usedIds = plan.slots.filter((s) => s.candidate).map((s) => s.candidate.id);
  assert.equal(new Set(usedIds).size, usedIds.length, 'no candidate reused across the real day');
});
