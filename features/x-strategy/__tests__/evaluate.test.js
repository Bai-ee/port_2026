import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate } from '../evaluate.js';
import { DEFAULT_PLAN, tierForAuthoredPerDay } from '../contracts.js';
import { buildRowsMeta } from '../corpus-rows.js';
import { summarizeCorpus, compareToBenchmark, resolveTier } from '../../x-benchmark/index.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../../docs/audits/${f}`, import.meta.url), 'utf8'));
const OWN = load('bai-ee-x-corpus.json');
const SEB = load('seb-design-x-corpus.json');
const NOW = Date.parse('2026-10-11T12:00:00Z');
const DAY = 86400000;

const row = (i, over = {}) => ({
  id: String(i), utc: new Date(Date.parse('2026-09-01T10:00:00Z') + i * 3600000).toISOString(),
  dateLocal: `2026-09-${String(1 + (i % 25)).padStart(2, '0')}`, hourLocal: 10 + (i % 8),
  type: i % 3 ? 'original-text' : 'original-showcase', media: 'none', topics: [], chars: 80 + i,
  likes: i % 7, reposts: 0, replies: 0, views: 100 + i, ...over,
});
const synth = (n, over) => Array.from({ length: n }, (_, i) => row(i, over));
const meta = (rows, pulledAt) => buildRowsMeta(rows, { pulledAt, source: 'bird' });
const run = (o = {}) => evaluate({
  ownHandle: 'bai_ee', ownRows: OWN, ownMeta: null,
  benchmarks: [{ handle: 'seb__design', rows: SEB, meta: null }], plan: null, now: NOW, ...o,
});
const codes = (v, code) => v.caveats.filter((c) => c.code === code);

test('matches direct summarize/compare on committed corpora', () => {
  const v = run();
  const so = summarizeCorpus(OWN, { handle: 'bai_ee' });
  const sb = summarizeCorpus(SEB, { handle: 'seb__design' });
  const direct = compareToBenchmark({ own: so, benchmark: sb });
  assert.deepEqual(v.own.cadence, so.cadence);
  assert.deepEqual(v.own.byType, so.byType);
  assert.deepEqual(v.benchmarks[0].cadence, sb.cadence);
  assert.deepEqual(v.gaps.map((g) => g.id), direct.gaps.slice(0, 8).map((g) => g.id));
  assert.deepEqual(v.gaps, direct.gaps.slice(0, 8));
  assert.equal(v.own.rows, OWN.length);
  assert.equal(v.benchmarks[0].rows, SEB.length);
  assert.equal(v.gapsAgainst, 'seb__design');
  assert.deepEqual(v.recommendedTier, resolveTier({ currentAuthoredPerDay: so.cadence.authoredPerActiveDay }));
});

test('no plan -> DEFAULT_PLAN baseline, planSource default; both tiers exposed', () => {
  const v = run();
  assert.equal(v.planSource, 'default');
  assert.equal(v.baselinePlan.authoredPerDay, DEFAULT_PLAN.authoredPerDay);
  assert.deepEqual(v.baselinePlan.typeFloors, DEFAULT_PLAN.typeFloors);
  assert.equal(v.currentTier, tierForAuthoredPerDay(DEFAULT_PLAN.authoredPerDay));
  assert.equal(v.recommendedTier.source, 'next-step');
  assert.equal(v.baselinePlan.recommended.tier, v.recommendedTier.tier);
});

test('plan doc values flow to baselinePlan; primary picks plan.benchmarkPrimary', () => {
  const other = synth(80);
  const v = run({
    plan: { authoredPerDay: 8, typeFloors: { 'quote-react': 2 }, benchmarkPrimary: '@Other_Acct' },
    benchmarks: [{ handle: 'seb__design', rows: SEB, meta: null }, { handle: 'other_acct', rows: other, meta: null }],
  });
  assert.equal(v.planSource, 'plan-doc');
  assert.equal(v.baselinePlan.authoredPerDay, 8);
  assert.equal(v.baselinePlan.tier, 2);
  assert.equal(v.currentTier, 2);
  assert.deepEqual(v.baselinePlan.typeFloors, { 'quote-react': 2 });
  assert.equal(v.gapsAgainst, 'other_acct');
  assert.equal(v.benchmarks.length, 2);
});

test('likes-only: present when views missing, absent at coverage >= 50%', () => {
  const noViews = synth(100, { views: null });
  const v1 = run({ ownRows: noViews, ownMeta: meta(noViews, new Date(NOW).toISOString()) });
  const c = codes(v1, 'likes-only');
  assert.ok(c.some((x) => x.handle === 'bai_ee' && /own/.test(x.message)));
  const full = synth(100);
  const v2 = run({ ownRows: full, ownMeta: meta(full, new Date(NOW).toISOString()) });
  assert.equal(codes(v2, 'likes-only').filter((x) => x.handle === 'bai_ee').length, 0);
  const half = synth(100).map((r, i) => (i < 50 ? r : { ...r, views: null }));
  assert.equal(codes(run({ ownRows: half, ownMeta: meta(half, null) }), 'likes-only').filter((x) => x.handle === 'bai_ee').length, 0);
  // benchmark named separately (committed seb corpus has ~20% views)
  const b = codes(run(), 'likes-only').find((x) => x.handle === 'seb__design');
  assert.ok(b && /benchmark/.test(b.message));
});

test('few-rows under 60, not at 60', () => {
  const r59 = synth(59);
  const r60 = synth(60);
  assert.equal(codes(run({ ownRows: r59, ownMeta: meta(r59, null) }), 'few-rows').filter((c) => c.handle === 'bai_ee').length, 1);
  assert.equal(codes(run({ ownRows: r60, ownMeta: meta(r60, null) }), 'few-rows').filter((c) => c.handle === 'bai_ee').length, 0);
});

test('stale boundary: exactly 7d fresh, just over stale; null pulledAt stale as committed data', () => {
  const rows = synth(80);
  const at = (ms) => run({ ownRows: rows, ownMeta: meta(rows, new Date(NOW - ms).toISOString()) });
  const own = (v) => codes(v, 'stale').filter((c) => c.handle === 'bai_ee');
  assert.equal(own(at(7 * DAY)).length, 0);
  assert.equal(at(7 * DAY).own.stale, false);
  assert.equal(own(at(7 * DAY + 1000)).length, 1);
  assert.equal(at(7 * DAY + 1000).own.stale, true);
  const committed = run({ ownRows: rows, ownMeta: meta(rows, null) });
  assert.equal(committed.own.stale, true);
  assert.equal(committed.own.ageDays, null);
  assert.match(own(committed)[0].message, /committed data, refresh to update/);
  assert.ok(committed.own.cadence && committed.gaps.length > 0); // still evaluates
});

test('fresh bird data evaluates with no stale caveat for own', () => {
  const rows = synth(80);
  const v = run({ ownRows: rows, ownMeta: meta(rows, new Date(NOW - DAY).toISOString()) });
  assert.equal(v.own.source, 'bird');
  assert.equal(v.own.ageDays, 1);
  assert.equal(codes(v, 'stale').filter((c) => c.handle === 'bai_ee').length, 0);
});

test('benchmark with 0 rows: needsRefresh, no throw, gaps use other benchmark', () => {
  const v = run({ benchmarks: [{ handle: 'empty_one', rows: [], meta: null }, { handle: 'seb__design', rows: SEB, meta: null }] });
  assert.deepEqual(v.needsRefresh, ['empty_one']);
  const e = v.benchmarks.find((b) => b.handle === 'empty_one');
  assert.equal(e.rows, 0);
  assert.equal(e.cadence, null);
  assert.equal(v.gapsAgainst, 'seb__design');
  assert.ok(v.gaps.length > 0);
  const only = run({ benchmarks: [{ handle: 'empty_one', rows: undefined, meta: null }] });
  assert.deepEqual(only.gaps, []);
  assert.equal(only.gapsAgainst, null);
});

test('own with 0 rows: needsRefresh, empty gaps, no throw', () => {
  const v = run({ ownRows: [], ownMeta: null });
  assert.deepEqual(v.needsRefresh, ['bai_ee']);
  assert.equal(v.own.rows, 0);
  assert.deepEqual(v.gaps, []);
  assert.equal(v.recommendedTier.tier, 1);
  assert.equal(evaluate({}).own.rows, 0);
});

test('quote-react caveat when in gap list or benchmark runs it; absent otherwise', () => {
  assert.equal(codes(run(), 'quote-react-undervalued').length, 1);
  const bare = synth(80);
  const v = run({ ownRows: bare, benchmarks: [{ handle: 'x_acct', rows: bare, meta: null }] });
  assert.equal(codes(v, 'quote-react-undervalued').length, 0);
  const qr = synth(80, { type: 'quote-react' });
  assert.equal(codes(run({ benchmarks: [{ handle: 'qr_acct', rows: qr, meta: null }] }), 'quote-react-undervalued').length, 1);
});

test('deterministic given now; inputs not mutated', () => {
  const ownCopy = JSON.stringify(OWN);
  const planIn = { authoredPerDay: 8, typeFloors: { 'quote-react': 1 }, benchmarkPrimary: 'seb__design' };
  const planCopy = JSON.stringify(planIn);
  const m = meta(OWN, '2026-10-10T00:00:00.000Z');
  const mCopy = JSON.stringify(m);
  const a = run({ plan: planIn, ownMeta: m });
  const b = run({ plan: planIn, ownMeta: m });
  assert.deepEqual(a, b);
  assert.equal(a.generatedAt, new Date(NOW).toISOString());
  assert.equal(JSON.stringify(OWN), ownCopy);
  assert.equal(JSON.stringify(planIn), planCopy);
  assert.equal(JSON.stringify(m), mCopy);
  a.baselinePlan.typeFloors.x = 1; // output is detached from the plan input
  assert.equal(JSON.stringify(planIn), planCopy);
});

test('handle normalization: case, @, duplicates, own dropped from benchmarks', () => {
  const v = run({
    ownHandle: ' @Bai_EE ',
    benchmarks: [{ handle: '@SEB__Design', rows: SEB, meta: null }, { handle: 'seb__design', rows: SEB, meta: null }, { handle: 'BAI_ee', rows: OWN, meta: null }],
    plan: { benchmarkPrimary: 'SEB__design' },
  });
  assert.equal(v.own.handle, 'bai_ee');
  assert.deepEqual(v.benchmarks.map((b) => b.handle), ['seb__design']);
  assert.equal(v.gapsAgainst, 'seb__design');
});
