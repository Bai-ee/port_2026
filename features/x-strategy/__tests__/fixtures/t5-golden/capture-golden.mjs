// One-off golden capture of the PRE-T5 behaviour of the quote-targets route's `content-plan` and
// `refresh-analysis` (logic copied verbatim from app/api/dashboard/quote-targets/route.js at that point: static
// committed-corpus imports, no plan doc). Run: node features/x-strategy/__tests__/fixtures/t5-golden/capture-golden.mjs
// The outputs next to this file are what t5-golden.test.js holds the new code to, byte for byte, when no plan exists.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../..');
const rd = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const FROZEN_NOW = Date.parse('2026-10-11T15:00:00.000Z');
Date.now = () => FROZEN_NOW;

const { buildDayPlan } = await import(path.join(ROOT, 'features/x-content-inventory/plan-day.js'));
const { projectDayPlan } = await import(path.join(ROOT, 'features/x-content-inventory/day-plan-projection.js'));
const { summarizeCorpus, compareToBenchmark, resolveXGrowthProfile, resolveTier } = await import(path.join(ROOT, 'features/x-benchmark/index.js'));
const { buildCalendar } = await import(path.join(ROOT, 'features/x-benchmark/build-calendar.js'));

const own = rd('docs/audits/bai-ee-x-corpus.json');
const bench = rd('docs/audits/seb-design-x-corpus.json');
const packages = rd('features/x-content-inventory/content-packages.json');
const date = '2026-10-11';

// handleContentPlan, pre-T5 (body.posts missing -> 5)
for (const posts of [5, 8, 3]) {
  const plan = buildDayPlan({ corpusRows: own, benchmarkRows: bench, packages, date, posts });
  writeFileSync(path.join(HERE, `content-plan-posts${posts}.json`), `${JSON.stringify({ ok: true, plan, seeded: true, summary: projectDayPlan(plan, { posts }).summary }, null, 2)}\n`);
}

// handleRefreshAnalysis, pre-T5: stat blocks as ingest wrote them (summarizeCorpus of the same rows)
const profile = resolveXGrowthProfile({ config: { ownHandle: 'bai_ee', benchmarkHandles: ['seb__design'] } });
const ownCorpus = { handle: 'bai_ee', stats: summarizeCorpus(own, { handle: 'bai_ee' }), meta: {} };
const benchmarks = [{ handle: 'seb__design', stats: summarizeCorpus(bench, { handle: 'seb__design' }), meta: {} }];
const reports = benchmarks.map((b) => compareToBenchmark({ own: ownCorpus.stats, benchmark: b.stats })).filter((r) => Array.isArray(r.gaps));
const primary = reports[0];
const tier = resolveTier({ tierOverride: profile.tierOverride, currentAuthoredPerDay: ownCorpus.stats?.cadence?.authoredPerActiveDay });
const calendar = buildCalendar({ report: primary, ownStats: ownCorpus.stats, tier, profile, days: 15, startDate: date });
const report = { ...primary, tier, alternates: reports.slice(1).map((r) => ({ benchmarkHandle: r.benchmarkHandle, gaps: r.gaps, projection: r.projection })) };
writeFileSync(path.join(HERE, 'refresh-analysis.json'), `${JSON.stringify({ ok: true, report, calendar, tier }, null, 2)}\n`);
console.log('golden written');
