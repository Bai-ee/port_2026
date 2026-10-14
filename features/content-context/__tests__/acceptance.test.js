// Phase 6 acceptance (content-management normalization): the 8 checks of
// docs/plans/CONTENT-MANAGEMENT-NORMALIZATION-MASTER-PLAN.md, end to end with fixtures,
// an in-memory Firestore, and a mock X client. No network, no real X/Anthropic/Firestore.
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const fb = require('../../../api/_lib/firebase-admin.cjs');
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');

const { __setXAdapterDepsForTest } = await import('../../social-posting/adapters/x.js');
const svc = await import('../../social-posting/twitter-service.js');
const { upsertPackage, getPackage } = await import('../../x-content-inventory/store.js');
const { default: seedRows } = await import('../../x-content-inventory/content-packages.json', { with: { type: 'json' } });
const { loadContentContext, summarizeContentContext, resolveCalendarEngineConfig } = await import('../load-content-context.js');
const { buildWeekCalendar, weekDates } = await import('../../x-content-inventory/week-calendar.js');
const { buildMonthCalendar, ctDate } = await import('../../x-content-inventory/month-calendar.js');
const { buildPostResults } = await import('../../x-content-inventory/results.js');
const { runDailyLoop } = await import('../../x-content-inventory/daily-loop.js');
const { createMemoryRunStore, saveSuggestionDraft, editSuggestion } = await import('../../x-content-inventory/daily-run-store.js');
const { buildDayPlan } = await import('../../x-content-inventory/plan-day.js');
const { normalizePlan } = await import('../../x-strategy/plan-state.js');

const rd = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const FX = rd('../../x-content-inventory/__tests__/fixtures/daily-loop-replay.json');
const OWN = rd('../../../docs/audits/bai-ee-x-corpus.json');
const BENCH = rd('../../../docs/audits/seb-design-x-corpus.json');
const OWNER = 'fixture-client-a';
const FX_NOW = Date.parse(FX.now);
const LOCAL = '2026-10-10';

const HOUR = 3_600_000;
const FUTURE = (h = 24) => new Date(Date.now() + h * HOUR).toISOString();
const PAST = () => new Date(Date.now() - HOUR).toISOString();
const PKG = (id, extra = {}) => ({ ...seedRows[1], id, status: 'idea', rights: 'owned', ...extra });

let ctx;
let tweets;
let restoreDeps;
let originalDbDescriptor;
let publisherCalls;
const raw = (id) => ctx.adminDb._raw('social_posts', id);

beforeEach(() => {
  tweets = [];
  publisherCalls = 0;
  originalDbDescriptor = Object.getOwnPropertyDescriptor(fb, 'adminDb');
  ctx = makeFakeContext();
  ctx.adminDb.batch = () => {
    const ops = [];
    return { set: (ref, data, o) => ops.push(() => ref.set(data, o)), delete: (ref) => ops.push(() => ref.delete()), commit: async () => { for (const op of ops) await op(); } };
  };
  const origCollection = ctx.adminDb.collection.bind(ctx.adminDb);
  ctx.adminDb.collection = (name) => {
    const col = origCollection(name);
    const origDoc = col.doc.bind(col);
    col.doc = (docId) => {
      const ref = origDoc(docId);
      ref.create = async (data) => {
        if ((await ref.get()).exists) throw Object.assign(new Error('already exists'), { code: 6 });
        await ref.set(data);
      };
      return ref;
    };
    return col;
  };
  Object.defineProperty(fb, 'adminDb', { configurable: true, get: () => ctx.adminDb });
  restoreDeps = __setXAdapterDepsForTest({
    getClient: async () => {
      publisherCalls += 1;
      return {
        authMode: 'oauth2',
        client: {
          v1: { uploadMedia: async () => 'm1' },
          v2: { tweet: async (payload) => { tweets.push(payload); return { data: { id: `main-${tweets.length}` } }; } },
        },
      };
    },
    fetchMedia: async () => { throw new Error('no media'); },
  });
});

afterEach(() => {
  restoreDeps();
  Object.defineProperty(fb, 'adminDb', originalDbDescriptor);
});

// --- shared fixtures -----------------------------------------------------------

// Daily-loop run with a memory store; saves go through the REAL shared createDraftPostOnce.
async function dailyLoop({ store = createMemoryRunStore(), readInputs = async () => FX, force = false } = {}) {
  const { run } = await runDailyLoop({ now: () => FX_NOW, store, readInputs }, { clientId: OWNER, ...(force ? { force: true } : {}) });
  const key = { clientId: OWNER, localDate: LOCAL, channel: 'x', version: run.version };
  const deps = {
    store, now: () => FX_NOW,
    getPackage: async (id) => FX.packages.find((p) => p.id === id),
    postExists: async (id) => !!(await svc.getSocialPost(OWNER, id).catch(() => null)),
    createDraftPostOnce: svc.createDraftPostOnce,
  };
  return { store, run, key, deps };
}
// An owned-content suggestion (has a package) so clearance / usage write-back can be exercised.
const postable = (run) => run.suggestions.find((s) => s.type !== 'reply');
const packaged = (run) => run.suggestions.find((s) => s.package?.id && s.type !== 'quote' && s.type !== 'reply') || run.suggestions.find((s) => s.package?.id);

function fakeDb({ state = {}, brains = {}, packages = {} } = {}) {
  const snap = (id, data) => ({ id, exists: data !== undefined, data: () => data });
  return {
    collection(name) {
      if (name === 'x_content_packages') {
        const q = { select: () => q, get: async () => ({ docs: Object.entries(packages).map(([id, d]) => snap(id, d)) }) };
        return { ...q, doc: (id) => ({ id, get: async () => snap(id, packages[id]) }) };
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
const planDoc = (plan, version = 1) => ({ version, updatedAt: '2026-10-09T00:00:00Z', plan: normalizePlan(plan) });
const LOADER_NOW = FX_NOW;
const loaderDeps = (doc) => ({
  db: fakeDb({
    state: { [OWNER]: { strategyBuilder: { lastPlan: { today: { date: LOCAL }, items: [], generatedAt: new Date(LOADER_NOW - HOUR).toISOString(), postsPerDay: 4 } }, marketingBrief: { quoteTargets: { generatedAt: new Date(LOADER_NOW - HOUR).toISOString() } } } },
    brains: { [OWNER]: { status: 'approved', version: 3, updatedAtIso: '2026-10-01T00:00:00Z' } },
    packages: Object.fromEntries(FX.packages.map((p) => [p.id, p])),
  }),
  readPlanDoc: async () => doc,
  loadBrainContext: async () => 'VOICE: plain, specific, dry.',
  buildDayPlan,
});
const loadCtx = (doc) => loadContentContext(loaderDeps(doc), {
  clientId: OWNER, now: LOADER_NOW, corpora: { own: OWN.slice(0, 80), benchmark: BENCH.slice(0, 80) },
});

// --- ACCEPT 0 ------------------------------------------------------------------

test('ACCEPT 0: no live X writes - the mock publisher is the only publisher reachable', async () => {
  assert.equal(tweets.length, 0);
  assert.equal(publisherCalls, 0);
  // Everything up to and including scheduling never touches the publisher.
  const { run, key, deps } = await dailyLoop();
  const { postId } = await saveSuggestionDraft(deps, { key, suggestionId: postable(run).id });
  await svc.approveAndSchedule(OWNER, postId, { scheduledAt: FUTURE() });
  await svc.processDuePosts(OWNER); // nothing due
  assert.equal(tweets.length, 0, 'save/approve/schedule must not publish');
  assert.equal(publisherCalls, 0);
  // Only an explicit due sweep reaches the (mock) client, exactly once.
  raw(postId).scheduledAt = PAST();
  await svc.processDuePosts(OWNER);
  assert.equal(tweets.length, 1);
  assert.equal(publisherCalls >= 1, true);
  await svc.processDuePosts(OWNER);
  assert.equal(tweets.length, 1, 'a posted row is never re-sent');
});

// --- ACCEPT 1 ------------------------------------------------------------------

test('ACCEPT 1: context loader names Brain, campaign, plan, corpora, scan and inventory with source + freshness', async () => {
  const c = await loadCtx(planDoc({ authoredPerDay: 4 }, 3));
  const ids = c.inputs.map((i) => i.id);
  for (const id of ['brain', 'plan', 'strategy-builder', 'scan', 'corpora', 'inventory']) assert.ok(ids.includes(id), `missing input ${id}`);
  for (const i of c.inputs) {
    assert.ok(i.source && typeof i.source === 'string', `${i.id} has a source`);
    assert.equal(typeof i.usable, 'boolean', `${i.id} has usable`);
    assert.ok(i.asOf || i.caveats.length > 0, `${i.id} has asOf or an explicit caveat`);
  }
  const by = (id) => c.inputs.find((i) => i.id === id);
  assert.equal(by('brain').usable, true);
  assert.equal(by('plan').version, 3);
  assert.equal(by('scan').usable, true);
  assert.ok(by('corpora').asOf, 'own/benchmark corpora carry freshness');
  assert.ok(c.versions.hash);
  // The chat-safe summary exposes the same list.
  assert.deepEqual(summarizeContentContext(c).inputs.map((i) => i.id), ids);
});

// --- ACCEPT 2 ------------------------------------------------------------------

test('ACCEPT 2: a plan change moves loader version/hash, calendar engine config and daily-loop slot count consistently', async () => {
  const docA = planDoc({ authoredPerDay: 3, engineTargets: { authored: { targetPerDay: 2 } } }, 1);
  const docB = planDoc({ authoredPerDay: 6, engineTargets: { authored: { targetPerDay: 4 } } }, 2);
  const seen = [];
  for (const [doc, perDay, target] of [[docA, 3, 2], [docB, 6, 4]]) {
    const c = await loadCtx(doc);
    const cal = resolveCalendarEngineConfig({ planDoc: doc, legacyOverrides: { authored: { targetPerDay: 99 } } });
    const { run } = await runDailyLoop({
      now: () => FX_NOW, store: createMemoryRunStore(),
      readInputs: async () => ({ ...FX, strategyInputs: c.raw.strategyInputs }),
    }, { clientId: OWNER, inputSource: 'fixture' });
    assert.equal(c.plan.version, doc.version);
    assert.equal(c.plan.inputs.authoredPerDay, perDay);
    assert.equal(cal.authored.targetPerDay, target, 'calendar engine config follows the plan, not legacy overrides');
    assert.deepEqual(c.raw.strategyInputs.planInputs.engineConfig, cal, 'loader and calendar resolve the same engine config');
    assert.equal(run.strategySource.planVersion, doc.version, 'daily-loop records the same plan version');
    assert.equal(run.strategySource.planSource, 'plan-doc');
    assert.equal(run.strategySource.authoredPerDay, perDay, 'slot count follows the plan');
    seen.push({ hash: c.versions.hash, slots: run.strategySource.slotLetters.length });
  }
  assert.notEqual(seen[0].hash, seen[1].hash);
  assert.ok(seen[1].slots > seen[0].slots);
});

// --- ACCEPT 3 ------------------------------------------------------------------

test('ACCEPT 3: every recommendation carries why-now, brand fit and supporting-content fields', async () => {
  const { run } = await dailyLoop();
  assert.ok(run.suggestions.length > 0);
  for (const s of run.suggestions) {
    for (const f of ['now', 'brand', 'content']) {
      assert.equal(typeof s.why?.[f], 'string', `${s.id} why.${f}`);
      assert.ok(s.why[f].trim().length > 0, `${s.id} why.${f} non-empty`);
    }
    assert.ok(s.scores && 'brandFit' in s.scores, 'scores.brandFit field exists');
    assert.ok(s.proposedSlot?.localDate, 'proposed slot present');
  }
  const owned = run.suggestions.filter((s) => s.package);
  assert.ok(owned.length > 0, 'at least one suggestion names supporting content');
  for (const s of owned) assert.ok(s.package.id && s.package.title, 'supporting package id + title');
});

// --- ACCEPT 4 ------------------------------------------------------------------

test('ACCEPT 4: save creates ONE durable draft; approve and schedule act on the SAME id; row count stays 1', async () => {
  const { run, key, deps } = await dailyLoop();
  const id = postable(run).id;
  const a = await saveSuggestionDraft(deps, { key, suggestionId: id });
  const b = await saveSuggestionDraft(deps, { key, suggestionId: id });
  assert.equal(a.postId, b.postId);
  assert.equal(b.existing, true);
  assert.equal((await svc.readSocialQueue(OWNER)).length, 1);
  assert.equal(raw(a.postId).status, 'draft');
  assert.equal(raw(a.postId).lifecycleVersion, 2);

  const approved = await svc.approveDraft(OWNER, a.postId);
  assert.equal(approved.id, a.postId);
  assert.equal(raw(a.postId).status, 'approved');
  const scheduled = await svc.updateSocialPost(OWNER, a.postId, { scheduledAt: FUTURE() });
  assert.equal(scheduled.id, a.postId);
  assert.equal(raw(a.postId).status, 'scheduled');
  assert.equal((await svc.readSocialQueue(OWNER)).length, 1);

  // approveAndSchedule on a second durable draft (same shared producer): same id, one row per draft.
  const second = await svc.ensureDraftPost(OWNER, { idempotencyKey: 'item:second', content: 'Second draft.' });
  const out = await svc.approveAndSchedule(OWNER, second.post.id, { scheduledAt: FUTURE(30) });
  assert.equal(out.id, second.post.id);
  assert.equal((await svc.readSocialQueue(OWNER)).length, 2);
});

// --- ACCEPT 5 ------------------------------------------------------------------

test('ACCEPT 5: regeneration/re-save never overwrites the saved row; revoked clearance blocks scheduling; an edit voids approval', async () => {
  const { run, key, deps, store } = await dailyLoop();
  const s = packaged(run);
  assert.ok(s, 'fixture run has a packaged suggestion');
  await upsertPackage(PKG(s.package.id), { returnPackages: false });

  const { postId } = await saveSuggestionDraft(deps, { key, suggestionId: s.id, text: 'saved wording' });
  await svc.updateSocialPost(OWNER, postId, { content: 'operator edited wording' });
  const before = JSON.stringify(raw(postId));

  // Re-save with different text and a forced regeneration: the row is untouched, no duplicate.
  const again = await saveSuggestionDraft(deps, { key, suggestionId: s.id, text: 'a totally different take' });
  assert.equal(again.postId, postId);
  const forced = await runDailyLoop({ now: () => FX_NOW, store, readInputs: async () => FX }, { clientId: OWNER, force: true });
  assert.equal(forced.run.suggestions.filter((x) => x.id === s.id).length, 1);
  assert.equal(forced.run.suggestions.find((x) => x.id === s.id).socialPostId, postId);
  assert.equal(JSON.stringify(raw(postId)), before, 'saved/edited post preserved byte-for-byte');
  assert.equal(raw(postId).content, 'operator edited wording');
  assert.equal((await svc.readSocialQueue(OWNER)).length, 1);

  // Edit voids approval (v2).
  await svc.approveDraft(OWNER, postId);
  await svc.updateSocialPost(OWNER, postId, { scheduledAt: FUTURE() });
  assert.equal(raw(postId).status, 'scheduled');
  await svc.updateSocialPost(OWNER, postId, { content: 'edited after approval' });
  assert.equal(raw(postId).status, 'draft');
  assert.equal(raw(postId).scheduledAt, null);
  assert.equal(raw(postId).reviewedAt, null);

  // Clearance revoked: approval alone does not let it be scheduled.
  await svc.approveDraft(OWNER, postId);
  await upsertPackage(PKG(s.package.id, { approval: { state: 'rejected' } }), { returnPackages: false });
  await assert.rejects(svc.updateSocialPost(OWNER, postId, { scheduledAt: FUTURE() }), { code: 'clearance-revoked', status: 409 });
  await assert.rejects(svc.approveAndSchedule(OWNER, postId, { scheduledAt: FUTURE() }), { code: 'clearance-revoked' });
  assert.notEqual(raw(postId).status, 'scheduled');
  assert.equal(tweets.length, 0);
});

// --- ACCEPT 6 ------------------------------------------------------------------

test('ACCEPT 6: next-week view keeps unscheduled approved work and shows scheduled work on the correct CT date', async () => {
  const unsched = await svc.createSocialPost(OWNER, { content: 'Approved, no slot yet.', lifecycleVersion: 2, status: 'approved', reviewedAt: new Date().toISOString() });
  const when = FUTURE(24 * 16);
  const sched = await svc.createSocialPost(OWNER, { content: 'Scheduled far out.', lifecycleVersion: 2, status: 'approved', reviewedAt: new Date().toISOString() });
  await svc.updateSocialPost(OWNER, sched.id, { scheduledAt: when });

  const posts = await svc.readSocialQueue(OWNER);
  const expectedDate = ctDate(Date.parse(when));
  const week = buildWeekCalendar({ posts, start: weekDates(expectedDate)[0] });
  assert.ok(week.unscheduled.some((r) => r.id === unsched.id), 'unscheduled approved work survives in a later week');
  const day = week.days.find((d) => d.date === expectedDate);
  assert.ok(day, 'scheduled date is inside the later week');
  assert.ok(day.slots.some((r) => r.id === sched.id), 'scheduled post sits on its CT date');
  assert.ok(!week.unscheduled.some((r) => r.id === sched.id));

  // An earlier week (the current one) does not show the far-out slot but still keeps the unscheduled row.
  const thisWeek = buildWeekCalendar({ posts, start: weekDates(ctDate(Date.now()))[0] });
  assert.ok(thisWeek.unscheduled.some((r) => r.id === unsched.id));
  assert.ok(!thisWeek.days.some((d) => d.slots.some((r) => r.id === sched.id)));

  // Month view agrees on the date.
  const month = buildMonthCalendar({ posts, month: expectedDate.slice(0, 7), now: Date.now() });
  const cell = month.weeks.flat().find((d) => d.date === expectedDate);
  assert.ok(JSON.stringify(cell).includes(sched.id), 'month grid places the scheduled post on the same date');
});

// --- ACCEPT 7 ------------------------------------------------------------------

test('ACCEPT 7: a due v2 post publishes once via the mock client; package usage written back; results show the join', async () => {
  const { run, key, deps } = await dailyLoop();
  const s = packaged(run);
  await upsertPackage(PKG(s.package.id, { postCount: 0 }), { returnPackages: false });
  const { postId } = await saveSuggestionDraft(deps, { key, suggestionId: s.id, text: 'Going out for real (mock).' });
  await svc.approveAndSchedule(OWNER, postId, { scheduledAt: FUTURE() });
  assert.equal(raw(postId).status, 'scheduled');

  raw(postId).scheduledAt = PAST();
  await svc.processDuePosts(OWNER);
  assert.equal(tweets.length, 1, 'mock X received exactly one tweet');
  assert.match(tweets[0].text, /Going out for real/);
  const row = raw(postId);
  assert.equal(row.status, 'posted');
  assert.ok(row.twitterId);

  const pkg = await getPackage(s.package.id);
  assert.ok(pkg.lastPostedAt, 'lastPostedAt written back');
  assert.equal(pkg.postCount, 1);
  assert.equal(pkg.lastTwitterId, row.twitterId);

  const packages = [pkg];
  const res = buildPostResults({ posts: await svc.readSocialQueue(OWNER), packages, now: Date.now() });
  const hit = res.posted.find((r) => r.id === postId);
  assert.ok(hit, 'listed under posted');
  assert.equal(hit.origin.runId, key && `${key.clientId}__${key.localDate}__x__v${key.version}`);
  assert.equal(hit.origin.suggestionId, s.id);
  assert.equal(hit.packageTitle, pkg.title);
  assert.equal(hit.origin.strategyVersion, run.strategySource?.planVersion ?? null);
  assert.equal(hit.metrics, null);
  assert.equal(hit.metricsNote, 'not measured yet');
  assert.equal(res.counts.unmeasured, 1);
});

// --- ACCEPT 8 ------------------------------------------------------------------

test('ACCEPT 8: the daily flow (inspect -> edit -> save -> approve -> choose time -> status) runs on shared services only', async () => {
  // inspect
  const c = await loadCtx(planDoc({ authoredPerDay: 4 }, 1));
  assert.ok(summarizeContentContext(c).inputs.length >= 6);
  const { run, key, deps } = await dailyLoop({ readInputs: async () => ({ ...FX, strategyInputs: c.raw.strategyInputs }) });
  const s = postable(run);
  assert.ok(s.why.now);

  // edit (stored working copy) then save
  const edited = await editSuggestion(deps, { key, suggestionId: s.id, text: 'My own words for today.' });
  assert.equal(edited.reviewState, 'edited');
  const saved = await saveSuggestionDraft(deps, { key, suggestionId: s.id });
  let post = await svc.getSocialPost(OWNER, saved.postId);
  assert.equal(post.status, 'draft');
  assert.ok(post.content.startsWith('My own words'));
  let results = buildPostResults({ posts: await svc.readSocialQueue(OWNER), packages: [], now: Date.now() });
  assert.equal(results.pending.some((r) => r.id === saved.postId), false, 'a draft is not yet pending delivery');

  // approve
  await svc.approveDraft(OWNER, saved.postId, { reviewedBy: 'owner@example.com' });
  post = await svc.getSocialPost(OWNER, saved.postId);
  assert.equal(post.status, 'approved');
  results = buildPostResults({ posts: await svc.readSocialQueue(OWNER), packages: [], now: Date.now() });
  assert.ok(results.pending.some((r) => r.id === saved.postId && r.status === 'approved'));

  // choose time
  const when = FUTURE(48);
  const out = await svc.approveAndSchedule(OWNER, saved.postId, { scheduledAt: when });
  assert.equal(out.id, saved.postId);
  post = await svc.getSocialPost(OWNER, saved.postId);
  assert.equal(post.status, 'scheduled');

  // status
  results = buildPostResults({ posts: await svc.readSocialQueue(OWNER), packages: [], now: Date.now() });
  const pend = results.pending.find((r) => r.id === saved.postId);
  assert.ok(pend);
  assert.equal(pend.status, 'scheduled');
  assert.equal(Date.parse(pend.scheduledAt), Date.parse(when));
  assert.equal(pend.origin.suggestionId, s.id);
  assert.equal((await svc.readSocialQueue(OWNER)).length, 1);
  assert.equal(tweets.length, 0, 'nothing published while the operator is still planning');
});
