import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadContentContext, summarizeContentContext, resolveCalendarEngineConfig,
} from '../load-content-context.js';
import { loadDailyLoopInputs } from '../../x-content-inventory/daily-loop/inputs.js';
import { mergeEngineConfig } from '../../x-content-inventory/engine-quota.js';

const NOW = Date.parse('2026-10-11T18:00:00Z'); // 2026-10-11 in Central
const HOUR = 3_600_000;
const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();

// Minimal Firestore fake: dashboard_state/{id}, clients/{id}/client_brain/current, x_content_packages.
function fakeDb({ state = {}, brains = {}, packages = {} } = {}) {
  const snap = (id, data) => ({ id, exists: data !== undefined, data: () => data });
  return {
    collection(name) {
      if (name === 'x_content_packages') {
        // Fixture rows default to the test client; where('clientId', ...) filters like Firestore.
        const own = (d) => d && { clientId: 'A', ...d };
        const mk = (rows) => { const q = { where: (f, _op, v) => mk(rows.filter(([, d]) => d[f] === v)), select: () => q, get: async () => ({ docs: rows.map(([id, d]) => snap(id, d)) }) }; return q; };
        const q = mk(Object.entries(packages).map(([id, d]) => [id, own(d)]));
        return { ...q, doc: (id) => ({ id, get: async () => snap(id, own(packages[id])) }) };
      }
      return {
        doc(id) {
          return {
            get: async () => snap(id, name === 'dashboard_state' ? state[id] : undefined),
            collection: (sub) => ({ doc: () => ({ get: async () => snap('current', sub === 'client_brain' ? brains[id] : undefined) }) }),
          };
        },
      };
    },
    getAll: async (...refs) => Promise.all(refs.map((r) => r.get())),
  };
}

const approvedBrain = (extra = {}) => ({ status: 'approved', version: 3, updatedAtIso: '2026-10-01T00:00:00Z', ...extra });
const todayPlan = (extra = {}) => ({ today: { date: '2026-10-11' }, items: [], generatedAt: '2026-10-10T00:00:00Z', postsPerDay: 4, ...extra });
const planDoc = (plan = {}, version = 2) => ({ version, updatedAt: '2026-10-09T00:00:00Z', plan });

function mkDeps({ db, plan = null, brainCtx = 'VOICE', brainThrows = false } = {}) {
  const counts = { plan: 0, brain: 0 };
  return {
    counts,
    deps: {
      db: db || fakeDb({ brains: { A: approvedBrain() } }),
      readPlanDoc: async () => { counts.plan += 1; return plan; },
      loadBrainContext: async () => { counts.brain += 1; if (brainThrows) throw new Error('brain boom'); return brainCtx; },
    },
  };
}
const byId = (ctx, id) => ctx.inputs.find((i) => i.id === id);

test('1. runner and chat resolve identical hash, plan version and input ids', async () => {
  const db = fakeDb({
    state: { A: { strategyBuilder: { lastPlan: todayPlan() }, marketingBrief: { quoteTargets: { generatedAt: iso(NOW - HOUR) } } } },
    brains: { A: approvedBrain() }, packages: { p1: { title: 'x' } },
  });
  const plan = planDoc({ authoredPerDay: 4 }, 7);
  const runner = (await loadContentContext(mkDeps({ db, plan }).deps, { clientId: 'A', now: NOW })).raw;
  assert.ok(runner);
  const ctxRunner = await loadContentContext(mkDeps({ db, plan }).deps, { clientId: 'A', now: NOW });
  const chat = summarizeContentContext(await loadContentContext(mkDeps({ db, plan }).deps, { clientId: 'A', now: NOW }));
  assert.equal(chat.versions.hash, ctxRunner.versions.hash);
  assert.equal(chat.plan.version, ctxRunner.plan.version);
  assert.equal(chat.plan.version, 7);
  assert.deepEqual(chat.inputs.map((i) => i.id), ctxRunner.inputs.map((i) => i.id));
  assert.deepEqual(chat.inputs, ctxRunner.inputs);
  assert.equal('raw' in chat, false);
  assert.equal('packages' in chat, false);
});

test('1b. the hash changes when a decisive input changes', async () => {
  const a = await loadContentContext(mkDeps({ plan: planDoc({ authoredPerDay: 4 }, 1) }).deps, { clientId: 'A', now: NOW });
  const b = await loadContentContext(mkDeps({ plan: planDoc({ authoredPerDay: 4 }, 2) }).deps, { clientId: 'A', now: NOW });
  assert.notEqual(a.versions.hash, b.versions.hash);
});

test('2. the plan doc is read exactly once per call', async () => {
  const { deps, counts } = mkDeps({ plan: planDoc({ authoredPerDay: 3 }) });
  await loadContentContext(deps, { clientId: 'A', now: NOW });
  assert.equal(counts.plan, 1);
  await loadContentContext(deps, { clientId: 'A', now: NOW });
  assert.equal(counts.plan, 2);
});

test('3. absent plan doc: default source, caveat, no planInputs, raw identical to the legacy loader', async () => {
  const buildDayPlan = () => ({});
  const corpora = { own: [{ utc: '2026-10-10T00:00:00Z', text: 'hi', type: 'original' }], benchmark: null };
  const { deps } = mkDeps({ plan: null });
  const ctx = await loadContentContext({ ...deps, buildDayPlan }, { clientId: 'A', now: NOW, corpora });
  assert.equal(ctx.plan.source, 'default');
  assert.match(byId(ctx, 'plan').caveats.join(' '), /No saved plan/);
  assert.ok(ctx.raw.strategyInputs, 'spine inputs present');
  assert.equal('planInputs' in ctx.raw.strategyInputs, false);
  const legacy = await loadDailyLoopInputs({ db: deps.db, loadBrainContext: deps.loadBrainContext, buildDayPlan, readPlanDoc: async () => null }, { clientId: 'A', now: NOW, corpora });
  assert.deepEqual(ctx.raw, legacy);
});

test('4. draft Brain is unusable, explained, and its context is never loaded', async () => {
  const db = fakeDb({ brains: { A: { status: 'draft' } } });
  const { deps, counts } = mkDeps({ db });
  const ctx = await loadContentContext(deps, { clientId: 'A', now: NOW });
  const brain = byId(ctx, 'brain');
  assert.equal(brain.usable, false);
  const text = brain.caveats.join(' ');
  assert.match(text, /not used/);
  assert.match(text, /not approved brand output/);
  assert.equal(counts.brain, 0);
  assert.equal(ctx.raw.brain.context, '');
});

test('5. approved Brain whose loader throws is unusable with the error surfaced, never empty-as-approved', async () => {
  const { deps } = mkDeps({ brainThrows: true });
  const ctx = await loadContentContext(deps, { clientId: 'A', now: NOW });
  const brain = byId(ctx, 'brain');
  assert.equal(brain.usable, false);
  assert.match(brain.caveats.join(' '), /brain boom/);
  assert.equal(ctx.raw.brain.context, '');
});

test('5b. approved Brain with an empty context is also unusable with a caveat', async () => {
  const { deps } = mkDeps({ brainCtx: '' });
  const brain = byId(await loadContentContext(deps, { clientId: 'A', now: NOW }), 'brain');
  assert.equal(brain.usable, false);
  assert.match(brain.caveats.join(' '), /no context/i);
});

test('6. wrong-client isolation; missing clientId throws', async () => {
  const db = fakeDb({
    state: {
      A: { strategyBuilder: { lastPlan: todayPlan({ marker: 'A-PLAN' }) } },
      B: { strategyBuilder: { lastPlan: todayPlan({ marker: 'B-PLAN' }) } },
    },
    brains: { A: approvedBrain({ version: 11 }), B: approvedBrain({ version: 22 }) },
  });
  const plans = { A: planDoc({ authoredPerDay: 2 }, 100), B: planDoc({ authoredPerDay: 6 }, 200) };
  const deps = {
    db,
    readPlanDoc: async (id) => plans[id] ?? null,
    loadBrainContext: async (id) => `CTX-${id}`,
  };
  const a = await loadContentContext(deps, { clientId: 'A', now: NOW });
  assert.equal(a.raw.strategyPlan.marker, 'A-PLAN');
  assert.equal(a.raw.brain.version, 11);
  assert.equal(a.raw.brain.context, 'CTX-A');
  assert.equal(a.plan.version, 100);
  assert.equal(a.plan.inputs.authoredPerDay, 2);
  assert.doesNotMatch(JSON.stringify(a), /B-PLAN|CTX-B/);
  await assert.rejects(() => loadContentContext(deps, { now: NOW }), /requires clientId/);
  await assert.rejects(() => loadContentContext(deps), /requires clientId/);
});

test('7. stale Strategy Builder plan is excluded; per-day mismatch says the plan wins', async () => {
  const stale = { today: { date: '2026-09-01' }, items: [{ scheduledAt: '2026-09-02T10:00:00Z' }], postsPerDay: 4 };
  const db = fakeDb({ state: { A: { strategyBuilder: { lastPlan: stale } } }, brains: { A: approvedBrain() } });
  const ctx = await loadContentContext(mkDeps({ db }).deps, { clientId: 'A', now: NOW });
  const sb = byId(ctx, 'strategy-builder');
  assert.equal(sb.usable, false);
  assert.match(sb.caveats.join(' '), /Excluded/);

  const db2 = fakeDb({ state: { A: { strategyBuilder: { lastPlan: todayPlan({ postsPerDay: 5 }) } } }, brains: { A: approvedBrain() } });
  const ctx2 = await loadContentContext(mkDeps({ db: db2, plan: planDoc({ authoredPerDay: 3 }) }).deps, { clientId: 'A', now: NOW });
  const sb2 = byId(ctx2, 'strategy-builder');
  assert.equal(sb2.usable, true);
  assert.match(sb2.caveats.join(' '), /The plan wins/);

  const ctx3 = await loadContentContext(mkDeps({ db: db2, plan: planDoc({ authoredPerDay: 5 }) }).deps, { clientId: 'A', now: NOW });
  assert.deepEqual(byId(ctx3, 'strategy-builder').caveats, []);
});

test('8. authoredPerDay 8 notes the runner cap of 7', async () => {
  const ctx = await loadContentContext(mkDeps({ plan: planDoc({ authoredPerDay: 8 }) }).deps, { clientId: 'A', now: NOW });
  const cav = byId(ctx, 'plan').caveats.join(' ');
  assert.match(cav, /8 posts\/day/);
  assert.match(cav, /caps at 7/);
  const ok = await loadContentContext(mkDeps({ plan: planDoc({ authoredPerDay: 7 }) }).deps, { clientId: 'A', now: NOW });
  assert.deepEqual(byId(ok, 'plan').caveats, []);
});

test('9. stale scan, stale own corpus, client inventory scope', async () => {
  const db = fakeDb({
    state: { A: { marketingBrief: { quoteTargets: { generatedAt: iso(NOW - 49 * HOUR) } } } },
    brains: { A: approvedBrain() },
  });
  const corpora = { own: [{ utc: iso(NOW - 10 * DAY), text: 'old', type: 'original' }] };
  const ctx = await loadContentContext(mkDeps({ db }).deps, { clientId: 'A', now: NOW, corpora });
  const scan = byId(ctx, 'scan');
  assert.equal(scan.usable, false);
  assert.match(scan.caveats.join(' '), /49h old/);
  assert.match(byId(ctx, 'corpora').caveats.join(' '), /stale after 7d/);
  assert.equal(byId(ctx, 'inventory').scope, 'client');
  assert.doesNotMatch(byId(ctx, 'inventory').caveats.join(' '), /not client-scoped/);

  const fresh = fakeDb({ state: { A: { marketingBrief: { quoteTargets: { generatedAt: iso(NOW - 47 * HOUR) } } } }, brains: { A: approvedBrain() } });
  const ctx2 = await loadContentContext(mkDeps({ db: fresh }).deps, { clientId: 'A', now: NOW, corpora: { own: [{ utc: iso(NOW - 6 * DAY), text: 'new', type: 'original' }] } });
  assert.equal(byId(ctx2, 'scan').usable, true);
  assert.doesNotMatch(byId(ctx2, 'corpora').caveats.join(' '), /stale/);
});

test('10. calendar config: plan engineTargets win; no plan doc equals the legacy merge', () => {
  const legacy = { authored: { targetPerDay: 2 } };
  const withPlan = resolveCalendarEngineConfig({
    planDoc: planDoc({ engineTargets: { authored: { targetPerDay: 5 } } }),
    legacyOverrides: legacy,
  });
  assert.equal(withPlan.authored.targetPerDay, 5);
  assert.deepEqual(withPlan, mergeEngineConfig({ authored: { targetPerDay: 5 } }));
  assert.deepEqual(resolveCalendarEngineConfig({ planDoc: null, legacyOverrides: legacy }), mergeEngineConfig(legacy));
  assert.deepEqual(resolveCalendarEngineConfig({ planDoc: undefined, legacyOverrides: undefined }), mergeEngineConfig(undefined));
});

test('10b. a plan doc WITHOUT engineTargets falls back to the legacy overrides', () => {
  const legacy = { authored: { targetPerDay: 2 } };
  assert.deepEqual(resolveCalendarEngineConfig({ planDoc: planDoc({ authoredPerDay: 3 }), legacyOverrides: legacy }), mergeEngineConfig(legacy));
  assert.deepEqual(resolveCalendarEngineConfig({ planDoc: planDoc({ engineTargets: {} }), legacyOverrides: legacy }), mergeEngineConfig(legacy));
});
