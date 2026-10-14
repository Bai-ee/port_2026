// CHARACTERIZATION: pins engine-quota day/week counting, buildDayPlan -> planSlots input wiring, and the Tier-1 clamp TODAY.
// Fixed `now`/date everywhere. Not a spec; "CURRENT (known gap)" = behaviour the content-management work plans to change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { allocateEngines, mergeEngineConfig, DEFAULT_ENGINE_CONFIG } from '../engine-quota.js';
import { buildDayPlan } from '../plan-day.js';
import { planSlots, TIER_1_MAX_POSTS } from '../daily-loop/slots.js';
import { MAX_SUGGESTIONS } from '../daily-loop/config.js';
import { runDailyLoop } from '../daily-loop.js';
import { createMemoryRunStore } from '../daily-run-store.js';
import { resolvePlanInputs } from '../../x-strategy/plan-inputs.js';
import { normalizePlan } from '../../x-strategy/plan-state.js';

const rd = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const FX = rd('./fixtures/daily-loop-replay.json');
const OWN = rd('../../../docs/audits/bai-ee-x-corpus.json');
const BENCH = rd('../../../docs/audits/seb-design-x-corpus.json');
const OWNER = 'fixture-client-a';

const NOW = Date.parse('2026-10-06T06:00:00Z');
const DATE = '2026-10-06';
const DAY = 86_400_000;
const slot = (n, timeCT, type) => ({ slot: String.fromCharCode(64 + n), timeCT, type, lane: 'music', hoursFromNow: 48 });
const FOUR = [slot(1, '09:00', 'original-showcase'), slot(2, '11:00', 'original-text'), slot(3, '13:00', 'original-showcase'), slot(4, '15:00', 'quote-react')];
const alloc = (over = {}) => allocateEngines({ slots: FOUR, now: NOW, date: DATE, ...over });
const sig = (r) => r.slots.map((s) => `${s.slot}:${s.timeCT}:${s.engine}:${s.engineSkipped ? 'skip' : 'ok'}`).join('|');

// --- (4) engine-quota counting --------------------------------------------------------------

test('counts come only from rows with a parseable postedAt and a known engine', () => {
  const posted = [{ engine: 'record', postedAt: NOW - 60_000 }, { engine: 'identity', postedAt: '2026-10-06T01:00:00Z' }];
  const r = alloc({ recentPosts: posted });
  // Both rows are on DATE (UTC), so they count toward today's tally in counts/weekly before allocation adds the slots.
  assert.ok(r.counts.record >= 1);
  assert.ok(r.weekly.record >= 1);
  const noise = alloc({ recentPosts: [{ engine: 'bogus', postedAt: NOW - 1000 }, { engine: 'record' }, { engine: 'record', postedAt: 'nope' }, null] });
  assert.equal(sig(noise), sig(alloc()));
});

test('CURRENT (known gap): SCHEDULED rows are invisible - a queue of scheduled posts (no postedAt) changes nothing', () => {
  const scheduled = Array.from({ length: 6 }, (_, i) => ({ engine: 'record', status: 'scheduled', scheduledAt: `2026-10-06T${String(14 + i).padStart(2, '0')}:00:00Z` }));
  assert.equal(sig(alloc({ recentPosts: scheduled })), sig(alloc()));
  assert.deepEqual(alloc({ recentPosts: scheduled }).counts, alloc().counts);
});

test('CURRENT (known gap): a row with status scheduled still counts if it carries a postedAt - status is never read', () => {
  const sneaky = Array.from({ length: 6 }, () => ({ engine: 'identity', status: 'scheduled', postedAt: NOW - 3_600_000 }));
  const r = alloc({ recentPosts: sneaky });
  assert.notEqual(sig(r), sig(alloc()));
});

test('day window is [date 00:00Z, +24h); week window is the 7 days ending at end of date; older/newer rows are ignored', () => {
  const base = sig(alloc());
  const outside = [
    { engine: 'ue', postedAt: Date.parse(DATE + 'T00:00:00Z') - 7 * DAY }, // 7 days before day start: outside week (week starts dayEnd - 7d = DATE-6d)
    { engine: 'ue', postedAt: Date.parse(DATE + 'T00:00:00Z') + DAY },      // next day
  ];
  assert.equal(sig(alloc({ recentPosts: outside })), base);
  assert.equal(alloc({ recentPosts: outside }).weekly.ue, alloc().weekly.ue);
  const inWeek = alloc({ recentPosts: [{ engine: 'ue', postedAt: Date.parse(DATE + 'T00:00:00Z') - 6 * DAY }] });
  assert.equal(inWeek.weekly.ue, alloc().weekly.ue + 1);
  assert.equal(inWeek.counts.ue, alloc().counts.ue, 'a week-old post does not count toward today');
});

test('posted rows today use up the daily authored cap (capPerDay 6) and push spacing', () => {
  const six = Array.from({ length: 6 }, (_, i) => ({ engine: 'identity', postedAt: Date.parse(DATE + 'T00:00:00Z') + (i + 1) * 60_000 }));
  const r = alloc({ recentPosts: six });
  assert.ok(r.slots.every((s) => s.engineSkipped), 'cap reached: every slot skipped');
  assert.match(r.slots[0].engineReason, /over the daily cap of 6/);
});

test('allocation is deterministic for a fixed now/date', () => {
  assert.equal(sig(alloc()), sig(alloc()));
  assert.equal(JSON.stringify(alloc()), JSON.stringify(alloc()));
});

test('buildDayPlan forwards recentPosts to allocateEngines: posted rows are seen, scheduled rows are not', () => {
  const input = { date: DATE, now: NOW, packages: [], corpusRows: OWN, benchmarkRows: BENCH, handle: 'bai_ee' };
  const base = buildDayPlan(input);
  const scheduledOnly = buildDayPlan({ ...input, recentPosts: Array.from({ length: 6 }, () => ({ engine: 'identity', status: 'scheduled', scheduledAt: '2026-10-06T14:00:00Z' })) });
  assert.deepEqual(scheduledOnly.slots.map((s) => [s.slot, s.timeCT, s.engine]), base.slots.map((s) => [s.slot, s.timeCT, s.engine]));
  const posted = buildDayPlan({ ...input, recentPosts: Array.from({ length: 6 }, (_, i) => ({ engine: 'identity', postedAt: Date.parse(DATE + 'T00:00:00Z') + (i + 1) * 60_000 })) });
  assert.notDeepEqual(posted.slots.map((s) => [s.slot, s.timeCT, s.engine]), base.slots.map((s) => [s.slot, s.timeCT, s.engine]));
});

test('CURRENT (known gap): planSlots passes NO recentPosts to buildDayPlan - it forwards only the caller input (+ clamped posts)', () => {
  const seen = [];
  const stub = (input) => { seen.push(input); return { date: DATE, slots: [], report: null }; };
  planSlots({ buildDayPlan: stub, input: { packages: [], date: DATE, now: NOW } });
  assert.equal('recentPosts' in seen[0], false);
  assert.deepEqual(Object.keys(seen[0]).sort(), ['date', 'now', 'packages', 'posts']);
  assert.equal(seen[0].posts, undefined);
});

test('CURRENT (known gap): the daily-loop run builds its plan input without recentPosts, so posted/scheduled history never reaches the quota layer', async () => {
  const seen = [];
  const spy = (input) => { seen.push(input); return buildDayPlan(input); };
  const inputs = { ...FX, strategyInputs: { buildDayPlan: spy, planInput: { corpusRows: OWN, benchmarkRows: BENCH, packages: FX.packages }, ownPosts: OWN, ownHandle: 'bai_ee' } };
  await runDailyLoop({ now: () => Date.parse(FX.now), store: createMemoryRunStore(), readInputs: async () => inputs }, { clientId: OWNER, inputSource: 'fixture' });
  assert.ok(seen.length >= 1);
  for (const i of seen) assert.equal('recentPosts' in i, false);
});

test('default engine config is untouched by merge with undefined (what planSlots effectively uses today)', () => {
  assert.deepEqual(mergeEngineConfig(undefined), DEFAULT_ENGINE_CONFIG);
});

// --- (5) Tier-1 clamp + MAX_SUGGESTIONS -----------------------------------------------------

test('constants: TIER_1_MAX_POSTS is 7 and MAX_SUGGESTIONS is 5', () => {
  assert.equal(TIER_1_MAX_POSTS, 7);
  assert.equal(MAX_SUGGESTIONS, 5);
});

test('planSlots clamps the requested posts: 1..7 pass through, 8+ is cut to 7, unset/invalid/<1 means undefined (engine default)', () => {
  const asked = (posts) => {
    const seen = [];
    planSlots({ buildDayPlan: (i) => { seen.push(i.posts); return { date: DATE, slots: [], report: null }; }, input: { date: DATE, now: NOW, ...(posts === '__none__' ? {} : { posts }) } });
    return seen[0];
  };
  assert.equal(asked(1), 1);
  assert.equal(asked(7), 7);
  assert.equal(asked(8), 7);
  assert.equal(asked(16), 7);
  assert.equal(asked(100), 7);
  assert.equal(asked('__none__'), undefined);
  assert.equal(asked(0), undefined);
  assert.equal(asked(-3), undefined);
  assert.equal(asked(NaN), undefined);
  assert.equal(asked(3.5), 3.5, 'non-integers pass through unrounded');
});

const planDoc = (plan, version = 1) => ({ version, plan: normalizePlan(plan) });
const genWithPlan = (doc) => runDailyLoop(
  { now: () => Date.parse(FX.now), store: createMemoryRunStore(), readInputs: async () => ({ ...FX, strategyInputs: { buildDayPlan, planInput: { corpusRows: OWN, benchmarkRows: BENCH, packages: FX.packages }, ownPosts: OWN, ownHandle: 'bai_ee', planInputs: resolvePlanInputs(doc) } }) },
  { clientId: OWNER, inputSource: 'fixture' },
);

test('CURRENT (known gap): a Strategy plan authoredPerDay of 8+ is silently cut to 7 (resolvePlanInputs keeps 8..16; planSlots clamps)', async () => {
  for (const n of [8, 12, 16]) {
    const doc = planDoc({ authoredPerDay: n });
    assert.equal(resolvePlanInputs(doc).posts, n, `resolvePlanInputs keeps ${n}`);
    const { run } = await genWithPlan(doc);
    assert.equal(run.strategySource.postsRequested, 7, `plan of ${n} -> requested 7`);
    assert.ok(run.strategySource.authoredPerDay <= 7, `authored ${run.strategySource.authoredPerDay}`);
    assert.equal(run.strategySource.tier, 1);
  }
});

test('a plan of 7 or fewer is requested as-is', async () => {
  for (const n of [3, 7]) {
    const { run } = await genWithPlan(planDoc({ authoredPerDay: n }));
    assert.equal(run.strategySource.postsRequested, n);
  }
});

test('MAX_SUGGESTIONS: a full 7-post day still yields at most 3 suggestions', async () => {
  const { run } = await genWithPlan(planDoc({ authoredPerDay: 7 }));
  assert.ok(run.suggestions.length <= MAX_SUGGESTIONS);
  assert.ok(run.suggestions.length >= 1);
});
