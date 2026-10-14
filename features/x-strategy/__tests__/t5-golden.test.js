// T5 golden: with NO plan doc, every consumer must produce byte-identical output to the pre-T5 code.
// Fixtures in fixtures/t5-golden/ were captured BEFORE any T5 change (capture-*.mjs are the recipes; day-view and the
// daily-run replay were captured by running the real CLIs with the clock frozen by freeze-clock.mjs).
//
// NOTE on rows: the golden compares the committed-json source (injected loader = the committed files). Live output uses
// fresher Firestore rows where they exist, by design - that is not a regression and is not compared here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContentPlanHandlers } from '../content-plan.js';
import { createMemoryCorpusStore } from '../corpus-store.js';
import { createMemoryPlanStore } from '../plan-store.js';
import { resolvePlanInputs } from '../plan-inputs.js';
import { planSlots } from '../../x-content-inventory/daily-loop/slots.js';
import { buildDayPlan } from '../../x-content-inventory/plan-day.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const G = path.join(HERE, 'fixtures/t5-golden');
const text = (f) => readFileSync(path.join(G, f), 'utf8');
const json = (f) => JSON.parse(text(f));
const repoJson = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const pretty = (v) => `${JSON.stringify(v, null, 2)}\n`;
const FROZEN_NOW = Date.parse('2026-10-11T15:00:00.000Z');
const PRELOAD = path.join(G, 'freeze-clock.mjs');

function run(script, args) {
  const r = spawnSync(process.execPath, ['--import', PRELOAD, path.join(ROOT, script), ...args], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test('day-view output (json + text; default, 4, 8 posts) is byte-identical to the pre-T5 golden', () => {
  for (const p of ['default', '4', '8']) {
    const extra = p === 'default' ? [] : ['--posts', p];
    assert.equal(run('scripts/x-content/day-view.mjs', ['--date', '2026-10-11', ...extra, '--json']), text(`day-view-json-${p}.json`), `json ${p}`);
    assert.equal(run('scripts/x-content/day-view.mjs', ['--date', '2026-10-11', ...extra]), text(`day-view-text-${p}.txt`), `text ${p}`);
  }
});

import { summarizeCorpus } from '../../x-benchmark/summarize.js';
import { DATE, REFRESH_CASES, CONTENT_PLAN_CASES, makeLegacyReaders } from './fixtures/t5-golden/legacy-cases.mjs';

// legacy-golden.json = outputs of the PRE-T5 route functions (extracted verbatim from `git show 5cfce1e9:` the route)
// for the inputs in legacy-cases.mjs. With no plan doc the new handlers must reproduce them exactly, including the
// `corpora` metadata, the 400/409 errors and the saved gap report.
const LEGACY = json('legacy-golden.json');
// The pre-T5 code defaulted buildDayPlan's `now` to Date.now(); the golden was captured with that clock frozen.
const realNow = Date.now;
before(() => { Date.now = () => FROZEN_NOW; });
after(() => { Date.now = realNow; });

function handlers({ config, planStore = createMemoryPlanStore() } = {}) {
  const own = repoJson('docs/audits/bai-ee-x-corpus.json');
  const bench = repoJson('docs/audits/seb-design-x-corpus.json');
  const packages = repoJson('features/x-content-inventory/content-packages.json');
  const saved = [];
  const readers = makeLegacyReaders({ own, bench, summarizeCorpus });
  const h = createContentPlanHandlers({
    corpusStore: createMemoryCorpusStore(), // must NOT be consulted on the legacy path
    planStore,
    readXGrowthConfig: async () => config ?? null,
    readInventory: async () => ({ packages, seeded: true }),
    legacyRows: { own, benchmark: bench },
    ...readers,
    saveGapReport: async (clientId, out) => { saved.push({ clientId, out }); },
    clock: () => FROZEN_NOW,
  });
  return { ...h, planStore, saved };
}

// Multi-client Phase 4.4: the legacy no-plan path serves ONLY the client whose own handle is the committed corpus's
// account (@bai_ee). For that client the output is still byte-identical to the pre-T5 golden (lanes ignored);
// any other client (no profile, another handle) gets a 409 instead of the owner's corpora.
const HOME_CONFIG = { ownHandle: 'bai_ee', benchmarkHandles: ['seb__design'] };

test('content-plan with NO plan doc equals the pre-T5 route output for the committed corpus\'s own account', async () => {
  for (const [name, c] of Object.entries(CONTENT_PLAN_CASES)) {
    const home = c.config?.ownHandle === 'bai_ee' ? c.config : { ...HOME_CONFIG, ...(c.config?.lanes ? { lanes: c.config.lanes } : {}) };
    const got = await handlers({ config: home }).contentPlan({ clientId: 'c1' }, c.body);
    assert.equal('planSource' in got, false, `${name}: no plan fields on the legacy path`);
    assert.equal(pretty(got), pretty(LEGACY.contentPlan[name]), name);
  }
  // and the original committed-corpus goldens (5 default, 8, 3)
  for (const [posts, file] of [[undefined, 'content-plan-posts5.json'], [8, 'content-plan-posts8.json'], [3, 'content-plan-posts3.json']]) {
    const got = await handlers({ config: HOME_CONFIG }).contentPlan({ clientId: 'c1' }, { date: DATE, ...(posts ? { posts } : {}) });
    assert.equal(pretty(got), text(file), file);
  }
});

test('content-plan with NO plan doc refuses any client whose own handle is not the committed corpus\'s account', async () => {
  for (const [name, c] of Object.entries(CONTENT_PLAN_CASES)) {
    if (c.config?.ownHandle === 'bai_ee') continue;
    await assert.rejects(handlers({ config: c.config }).contentPlan({ clientId: 'c1' }, c.body),
      (e) => e.status === 409 && /No Strategy plan yet/.test(e.message), name);
  }
});

test('refresh-analysis with NO plan doc equals the pre-T5 output byte for byte, incl. corpora, errors and the saved report', async () => {
  for (const [name, config] of Object.entries(REFRESH_CASES)) {
    const h = handlers({ config });
    const want = LEGACY.refresh[name];
    if (want.error) {
      await assert.rejects(h.refreshAnalysis({ clientId: 'c1' }), (e) => e.status === want.error.status && e.message === want.error.message, name);
      assert.equal(h.saved.length, 0, `${name}: nothing saved on error`);
      continue;
    }
    const got = await h.refreshAnalysis({ clientId: 'c1' });
    assert.equal('planSource' in got, false, `${name}: no plan fields on the legacy path`);
    assert.equal(pretty(got), pretty(want.result), name);
    assert.equal(h.saved.length, 1);
    assert.equal(pretty(h.saved[0].out), pretty(want.saved), `${name}: saved gap report`);
  }
  assert.ok(LEGACY.refresh['profile-default'].result.report.corpora.own.source === 'ingest', 'golden really carries corpora');
});

test('a plan doc switches to the new behaviour (planSource/planVersion present, 409 pointing at Refresh)', async () => {
  const planStore = createMemoryPlanStore();
  await planStore.apply('c1', { changes: { authoredPerDay: 3 }, expectedVersion: 0, by: 'test', source: 'manual', now: FROZEN_NOW });
  const h = handlers({ config: HOME_CONFIG, planStore });
  const out = await h.contentPlan({ clientId: 'c1' }, { date: DATE, posts: 8 });
  assert.equal(out.planSource, 'plan-doc');
  assert.equal(out.plan.slots.length, 3);
  const ra = await h.refreshAnalysis({ clientId: 'c1' });
  assert.equal(ra.planSource, 'plan-doc');
});

test('planSlots with resolvePlanInputs(null) equals the pre-T5 planSlots output for every cadence', () => {
  const golden = json('plan-slots.json');
  const base = {
    corpusRows: repoJson('docs/audits/bai-ee-x-corpus.json'), benchmarkRows: repoJson('docs/audits/seb-design-x-corpus.json'),
    packages: repoJson('features/x-content-inventory/content-packages.json'), date: '2026-10-11', now: FROZEN_NOW,
  };
  const r = resolvePlanInputs(null);
  for (const posts of [undefined, 3, 5, 6, 8]) {
    const out = planSlots({ buildDayPlan, input: { ...base, posts: posts ?? r.posts }, typeFloors: r.typeFloors, typeCaps: r.typeCaps });
    assert.equal(pretty({ slots: out.slots, strategySource: out.strategySource }), pretty(golden[String(posts)]), `posts ${posts}`);
  }
});

test('daily-run replay (stdout + run doc) is byte-identical to the pre-T5 golden', () => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), 't5-replay-')), 'run.json');
  const stdout = run('scripts/x-content/daily-run.mjs', ['--replay', 'features/x-content-inventory/__tests__/fixtures/daily-loop-replay.json', '--out', out]);
  const strip = (s) => s.split('\n').filter((l) => !l.startsWith('replay output:')).join('\n');
  assert.equal(strip(stdout), strip(text('daily-replay-stdout.txt')));
  assert.equal(readFileSync(out, 'utf8'), text('daily-replay-run.json'));
});
