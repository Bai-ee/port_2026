// planSlots: a request above the runner's Tier-1 ceiling is clamped AND reported as a gap (never silent).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSlots, TIER_1_MAX_POSTS } from '../daily-loop/slots.js';

const DATE = '2026-10-10';
const NOW = Date.parse('2026-10-10T15:00:00Z');
const LETTERS = 'ABCDEFGHIJ'.split('');
const stub = (seen) => ({ posts, date }) => {
  seen.push(posts);
  const n = posts ?? 4;
  return { date, report: null, slots: Array.from({ length: n }, (_, i) => ({ slot: LETTERS[i], timeCT: `${String(8 + i).padStart(2, '0')}:00`, type: 'original-text', lane: 'work', dynamic: false })) };
};
const run = (posts) => {
  const seen = [];
  const out = planSlots({ buildDayPlan: stub(seen), input: { date: DATE, now: NOW, ...(posts === undefined ? {} : { posts }) } });
  return { out, seen };
};

test('posts=9 plans exactly 7 and reports a plan-clamped gap naming both numbers', () => {
  const { out, seen } = run(9);
  assert.equal(seen[0], TIER_1_MAX_POSTS);
  assert.equal(out.slots.filter((s) => s.source !== 'daily-minimum').length, 7);
  assert.equal(out.strategySource.authoredPerDay, 7);
  const gap = out.gaps.find((g) => g.code === 'plan-clamped');
  assert.ok(gap, 'plan-clamped gap present');
  assert.match(gap.message, /9 posts\/day/);
  assert.match(gap.message, /at most 7/);
});

test('posts at or below the ceiling (and unset) produce no plan-clamped gap', () => {
  for (const p of [1, 7, undefined]) {
    assert.equal(run(p).out.gaps.some((g) => g.code === 'plan-clamped'), false, `posts=${p}`);
  }
  assert.equal(run(7).out.strategySource.authoredPerDay, 7);
});
