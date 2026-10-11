import test from 'node:test';
import assert from 'node:assert/strict';
import { DISCOGS_ACTIONS, handleDiscogsAction } from '../actions.js';

// Minimal Firestore fake: docs, subcollections, where('==')+limit queries.
function makeDb() {
  const cols = new Map();
  const col = (n) => { if (!cols.has(n)) cols.set(n, new Map()); return cols.get(n); };
  const FieldValue = { serverTimestamp: () => ({ __ts: true }) };
  const apply = (patch) => {
    const out = {};
    for (const [k, v] of Object.entries(patch)) {
      out[k] = v && typeof v === 'object' && '__ts' in v ? new Date().toISOString() : structuredClone(v);
    }
    return out;
  };
  const docRef = (n, id) => ({
    id,
    async get() { const d = col(n).get(id); return { id, exists: d !== undefined, data: () => (d ? structuredClone(d) : undefined) }; },
    async set(data) { col(n).set(id, apply(data)); },
    async delete() { col(n).delete(id); },
    collection: (sub) => collectionRef(`${n}/${id}/${sub}`),
  });
  const query = (n, spec = {}) => ({
    where: (f, op, v) => query(n, { ...spec, wheres: [...(spec.wheres || []), [f, v]] }),
    limit: (l) => query(n, { ...spec, lim: l }),
    async get() {
      let rows = [...col(n).entries()].map(([id, data]) => ({ id, data }));
      for (const [f, v] of spec.wheres || []) rows = rows.filter((r) => r.data[f] === v);
      if (spec.lim) rows = rows.slice(0, spec.lim);
      return { docs: rows.map((r) => ({ id: r.id, data: () => structuredClone(r.data) })) };
    },
  });
  const collectionRef = (n) => ({ doc: (id) => docRef(n, id), ...query(n) });
  return { FieldValue, cols, collection: collectionRef };
}

const NOW = 1_700_000_000_000;
function setup({ online = true, caps = ['ANALYZE_FACETS', 'DISCOGS_PLAN', 'DISCOGS_APPLY', 'DISCOGS_UNDO'], register = true } = {}) {
  const db = makeDb();
  let i = 0;
  const deps = { db, fieldValue: db.FieldValue, now: () => NOW, randomId: () => `cmd-${++i}` };
  if (register) {
    db.cols.set('archive_workers', new Map([
      ['mac-analyzer', { lastHeartbeatAt: new Date(online ? NOW - 1000 : NOW - 10 * 60_000).toISOString(), capabilities: caps, localThumbBase: 'http://127.0.0.1:8777' }],
      ['mac', {}],
    ]));
    db.cols.set('archive_workers/mac/sources', new Map([['s1', { label: 'NAS', root: '/Volumes/bryan' }]]));
  }
  return { db, deps };
}
const run = (deps, action, body = {}) => handleDiscogsAction(deps, action, body, { email: 'me@x.com' });
const cmds = (db) => db.cols.get('archive_commands');
const rejects = (p, status, re) => assert.rejects(p, (e) => e.status === status && (!re || re.test(e.message)));

const cand = (releaseId, extra = {}) => ({ releaseId, title: `T${releaseId}`, catno: 'C', label: 'L', year: 1999, formats: ['LP'], score: 0.9, reasons: ['x'], ...extra });
const row = (groupId, action, extra = {}) => ({
  groupId, files: [`${groupId}.jpg`], images: 1, videos: 0, read: { artist: 'A', title: 'T', label: 'L', catno: 'C', year: 1999 },
  candidates: [cand(101), cand(102)], best: action === 'add' ? 101 : null, action, reason: 'r', catnoExact: true, ...extra,
});
const ROWS = [row('g-add', 'add'), row('g-review', 'review'), row('g-owned', 'already-owned'), row('g-unread', 'skip-unreadable', { read: null, candidates: [] })];

/** Seed a finished plan command. */
function seedPlan(db, { id = 'plan-cmd', planId = 'P1', state = 'COMPLETE', rows = ROWS, createdAt = '2026-01-01T00:00:00.000Z', workerId = 'mac-analyzer' } = {}) {
  if (!cmds(db)) db.cols.set('archive_commands', new Map());
  cmds(db).set(id, {
    id, type: 'DISCOGS_PLAN', state, workerId, sourceId: 's1', relativePath: 'discogs', createdAt,
    result: { planId, sourceId: 's1', relativePath: 'discogs', summary: { groups: rows.length, add: 1, alreadyOwned: 1, review: 1, unreadable: 1 }, rows, spentUsd: 0.2, capReached: false, remaining: 0 },
  });
}
function seedCmd(db, id, fields) {
  if (!cmds(db)) db.cols.set('archive_commands', new Map());
  cmds(db).set(id, { id, workerId: 'mac-analyzer', sourceId: 's1', ...fields });
}
const byGroup = (r) => Object.fromEntries(r.rows.map((x) => [x.groupId, x]));

test('DISCOGS_ACTIONS lists all eight actions', () => {
  assert.deepEqual(DISCOGS_ACTIONS, ['discogs-status', 'discogs-plan', 'discogs-jobs', 'discogs-cancel', 'discogs-records', 'discogs-decide', 'discogs-apply', 'discogs-undo']);
  return rejects(run(setup().deps, 'discogs-nope'), 400);
});

test('status: reports online, supportsDiscogs, thumb base and sources', async () => {
  const { deps } = setup();
  const r = await run(deps, 'discogs-status');
  assert.deepEqual({ ok: r.ok, online: r.online, workerId: r.workerId, supportsDiscogs: r.supportsDiscogs, localThumbBase: r.localThumbBase }, { ok: true, online: true, workerId: 'mac-analyzer', supportsDiscogs: true, localThumbBase: 'http://127.0.0.1:8777' });
  assert.deepEqual(r.sources.map((s) => s.id), ['s1']);
  const old = await run(setup({ caps: ['ANALYZE_FACETS'] }).deps, 'discogs-status');
  assert.equal(old.supportsDiscogs, false);
  const none = await run(setup({ register: false }).deps, 'discogs-status');
  assert.deepEqual({ online: none.online, workerId: none.workerId, supportsDiscogs: none.supportsDiscogs }, { online: false, workerId: null, supportsDiscogs: false });
});

test('plan: queues DISCOGS_PLAN with defaults', async () => {
  const { db, deps } = setup();
  const r = await run(deps, 'discogs-plan', { sourceId: 's1', relativePath: 'discogs/batch1' });
  assert.deepEqual(r, { ok: true, commandId: 'cmd-1' });
  const c = cmds(db).get('cmd-1');
  assert.equal(c.type, 'DISCOGS_PLAN'); assert.equal(c.state, 'QUEUED'); assert.equal(c.workerId, 'mac-analyzer');
  assert.deepEqual([c.sourceId, c.relativePath, c.limit, c.capUsd, c.requestedBy], ['s1', 'discogs/batch1', 300, 2, 'me@x.com']);
});

test('plan: validation and analyzer gating', async () => {
  const { deps } = setup();
  await rejects(run(deps, 'discogs-plan', { relativePath: 'x' }), 400, /sourceId/);
  await rejects(run(deps, 'discogs-plan', { sourceId: 's1', relativePath: '/abs' }), 400);
  await rejects(run(deps, 'discogs-plan', { sourceId: 's1', relativePath: 'a/../b' }), 400);
  await rejects(run(deps, 'discogs-plan', { sourceId: 's1', relativePath: 'x', limit: 301 }), 400);
  await rejects(run(deps, 'discogs-plan', { sourceId: 's1', relativePath: 'x', limit: 0 }), 400);
  await rejects(run(deps, 'discogs-plan', { sourceId: 's1', relativePath: 'x', capUsd: 0 }), 400);
  await rejects(run(deps, 'discogs-plan', { sourceId: 's1', relativePath: 'x', capUsd: 20.5 }), 400);
  const ok = await run(deps, 'discogs-plan', { sourceId: 's1', relativePath: 'x', limit: 5, capUsd: 20 });
  assert.equal(cmds(deps.db).get(ok.commandId).limit, 5);
  assert.equal(cmds(deps.db).get(ok.commandId).capUsd, 20);

  const q = { sourceId: 's1', relativePath: 'x' };
  await rejects(run(setup({ register: false }).deps, 'discogs-plan', q), 409);
  await rejects(run(setup({ online: false }).deps, 'discogs-plan', q), 409, /offline/);
  await rejects(run(setup({ caps: ['ANALYZE_FACETS'] }).deps, 'discogs-plan', q), 409, /Discogs support/);
});

test('jobs: only DISCOGS types, shaped, newest first, max 10', async () => {
  const { db, deps } = setup();
  seedCmd(db, 'a1', { type: 'ANALYZE_FACETS', state: 'COMPLETE', createdAt: '2026-01-05T00:00:00.000Z' });
  seedPlan(db, { id: 'p1', createdAt: '2026-01-01T00:00:00.000Z' });
  cmds(db).get('p1').capUsd = 2;
  seedCmd(db, 'ap1', {
    type: 'DISCOGS_APPLY', state: 'COMPLETE', planId: 'P1', createdAt: '2026-01-02T00:00:00.000Z',
    result: { journal: 'P1-applied-1.jsonl', applied: [{ groupId: 'g-add', releaseId: 101, instanceId: 7 }], skipped: [{}], errors: [] },
  });
  seedCmd(db, 'un1', { type: 'DISCOGS_UNDO', state: 'RUNNING', applyCommandId: 'ap1', createdAt: '2026-01-03T00:00:00.000Z', result: { progress: { phase: 'removing', done: 0, total: 1, spentUsd: 0 } } });
  const r = await run(deps, 'discogs-jobs');
  assert.deepEqual(r.jobs.map((j) => j.id), ['un1', 'ap1', 'p1']);
  const [undo, applyJob, planJob] = r.jobs;
  assert.equal(undo.applyCommandId, 'ap1'); assert.equal(undo.progress.phase, 'removing');
  assert.deepEqual(applyJob.counts, { applied: 1, skipped: 1, removed: 0, errors: 0 });
  assert.equal(applyJob.journal, 'P1-applied-1.jsonl'); assert.equal(applyJob.planId, 'P1');
  assert.equal(planJob.planId, 'P1'); assert.equal(planJob.spentUsd, 0.2); assert.equal(planJob.capUsd, 2);
  assert.equal(planJob.summary.groups, 4); assert.equal(planJob.relativePath, 'discogs');

  for (let i = 0; i < 12; i += 1) seedCmd(db, `x${i}`, { type: 'DISCOGS_PLAN', state: 'FAILED', error: 'boom', createdAt: `2026-02-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` });
  const big = await run(deps, 'discogs-jobs');
  assert.equal(big.jobs.length, 10); assert.equal(big.jobs[0].id, 'x11'); assert.equal(big.jobs[0].error, 'boom');
  assert.deepEqual((await run(setup({ register: false }).deps, 'discogs-jobs')).jobs, []);
});

test('cancel: queues CANCEL_JOB with targetCommandId and commandId; only Discogs jobs', async () => {
  const { db, deps } = setup();
  seedPlan(db, { id: 'p1', state: 'RUNNING' });
  seedCmd(db, 'an1', { type: 'ANALYZE_FACETS', state: 'RUNNING' });
  await rejects(run(deps, 'discogs-cancel', {}), 400);
  await rejects(run(deps, 'discogs-cancel', { commandId: 'missing' }), 404);
  await rejects(run(deps, 'discogs-cancel', { commandId: 'an1' }), 404);
  const r = await run(deps, 'discogs-cancel', { commandId: 'p1' });
  assert.equal(r.ok, true);
  const c = cmds(db).get(r.commandId);
  assert.deepEqual([c.type, c.workerId, c.targetCommandId, c.commandId, c.state], ['CANCEL_JOB', 'mac-analyzer', 'p1', 'p1', 'QUEUED']);
});

test('records: no analyzer or no plan -> empty', async () => {
  assert.deepEqual(await run(setup({ register: false }).deps, 'discogs-records'), { ok: true, plan: null, rows: [] });
  const { db, deps } = setup();
  seedCmd(db, 'p0', { type: 'DISCOGS_PLAN', state: 'RUNNING', createdAt: '2026-01-01T00:00:00.000Z' });
  assert.deepEqual(await run(deps, 'discogs-records'), { ok: true, plan: null, rows: [] });
});

test('records: picks latest plan with rows, honours planId, accepts cancelled partials', async () => {
  const { db, deps } = setup();
  seedPlan(db, { id: 'old', planId: 'P-old', createdAt: '2026-01-01T00:00:00.000Z' });
  seedPlan(db, { id: 'mid', planId: 'P-mid', createdAt: '2026-01-02T00:00:00.000Z' });
  seedCmd(db, 'running', { type: 'DISCOGS_PLAN', state: 'RUNNING', createdAt: '2026-01-04T00:00:00.000Z', result: { progress: {} } });
  let r = await run(deps, 'discogs-records');
  assert.equal(r.plan.planId, 'P-mid'); assert.equal(r.plan.commandId, 'mid');
  assert.deepEqual([r.plan.sourceId, r.plan.relativePath, r.plan.capReached, r.plan.remaining], ['s1', 'discogs', false, 0]);
  assert.equal(r.rows.length, 4);

  r = await run(deps, 'discogs-records', { planId: 'P-old' });
  assert.equal(r.plan.commandId, 'old');
  assert.deepEqual(await run(deps, 'discogs-records', { planId: 'nope' }), { ok: true, plan: null, rows: [] });

  // A cancelled plan (FAILED) that still carries partial rows wins when newest.
  seedPlan(db, { id: 'cancelled', planId: 'P-cancel', state: 'FAILED', rows: [row('c1', 'add')], createdAt: '2026-01-05T00:00:00.000Z' });
  cmds(db).get('cancelled').result.capReached = true; cmds(db).get('cancelled').result.remaining = 40;
  r = await run(deps, 'discogs-records');
  assert.equal(r.plan.planId, 'P-cancel'); assert.equal(r.plan.capReached, true); assert.equal(r.plan.remaining, 40);
  assert.deepEqual(r.rows.map((x) => x.groupId), ['c1']);
});

test('records: base statuses ready / review / owned / unreadable; decision accept makes review ready', async () => {
  const { db, deps } = setup();
  seedPlan(db);
  let g = byGroup(await run(deps, 'discogs-records'));
  assert.deepEqual([g['g-add'].status, g['g-review'].status, g['g-owned'].status, g['g-unread'].status], ['ready', 'review', 'owned', 'unreadable']);
  assert.equal(g['g-add'].decision, null); assert.equal(g['g-add'].added, null);

  await run(deps, 'discogs-decide', { groupId: 'g-review', decision: 'accept', releaseId: 102 });
  await run(deps, 'discogs-decide', { groupId: 'g-add', decision: 'skip' });
  g = byGroup(await run(deps, 'discogs-records'));
  assert.equal(g['g-review'].status, 'ready'); assert.equal(g['g-review'].decision.releaseId, 102);
  assert.equal(g['g-add'].status, 'skipped'); assert.equal(g['g-add'].decision.decision, 'skip');
});

test('records: adding (active apply), added (complete apply), and back after a COMPLETE undo', async () => {
  const { db, deps } = setup();
  seedPlan(db);
  seedCmd(db, 'ap1', { type: 'DISCOGS_APPLY', state: 'RUNNING', planId: 'P1', items: [{ groupId: 'g-add', releaseId: 101 }], createdAt: '2026-01-02T00:00:00.000Z' });
  assert.equal(byGroup(await run(deps, 'discogs-records'))['g-add'].status, 'adding');

  cmds(db).get('ap1').state = 'COMPLETE';
  cmds(db).get('ap1').result = { journal: 'P1-applied-1.jsonl', applied: [{ groupId: 'g-add', releaseId: 101, instanceId: 55 }], skipped: [], errors: [] };
  const added = byGroup(await run(deps, 'discogs-records'))['g-add'];
  assert.equal(added.status, 'added');
  assert.deepEqual(added.added, { releaseId: 101, instanceId: 55, applyCommandId: 'ap1', journal: 'P1-applied-1.jsonl' });

  // Undo still running: still added.
  seedCmd(db, 'un1', { type: 'DISCOGS_UNDO', state: 'RUNNING', applyCommandId: 'ap1', createdAt: '2026-01-03T00:00:00.000Z' });
  assert.equal(byGroup(await run(deps, 'discogs-records'))['g-add'].status, 'added');

  cmds(db).get('un1').state = 'COMPLETE';
  cmds(db).get('un1').result = { journal: 'P1-applied-1.jsonl', removed: [{ groupId: 'g-add', releaseId: 101, instanceId: 55 }], errors: [] };
  const back = byGroup(await run(deps, 'discogs-records'))['g-add'];
  assert.equal(back.status, 'ready'); assert.equal(back.added, null);
});

test('records: an apply from another plan does not mark rows added', async () => {
  const { db, deps } = setup();
  seedPlan(db);
  seedCmd(db, 'apX', { type: 'DISCOGS_APPLY', state: 'COMPLETE', planId: 'OTHER', createdAt: '2026-01-02T00:00:00.000Z', result: { journal: 'j-applied.jsonl', applied: [{ groupId: 'g-add', releaseId: 101, instanceId: 1 }] } });
  assert.equal(byGroup(await run(deps, 'discogs-records'))['g-add'].status, 'ready');
});

test('decide: accept a listed candidate, manual override, and invalid input', async () => {
  const { db, deps } = setup();
  seedPlan(db);
  const dec = () => db.cols.get('discogs_decisions');

  const r = await run(deps, 'discogs-decide', { groupId: 'g-review', decision: 'accept', releaseId: 101 });
  assert.deepEqual(r, { ok: true, groupId: 'g-review', decision: 'accept', releaseId: 101 });
  const d = dec().get('g-review');
  assert.deepEqual([d.groupId, d.decision, d.releaseId, d.planId, d.by, d.manual], ['g-review', 'accept', 101, 'P1', 'me@x.com', false]);
  assert.ok(d.at);

  await rejects(run(deps, 'discogs-decide', { groupId: 'g-review', decision: 'accept', releaseId: 999 }), 400, /candidates/);
  await run(deps, 'discogs-decide', { groupId: 'g-review', decision: 'accept', releaseId: 999, manual: true });
  assert.equal(dec().get('g-review').releaseId, 999); assert.equal(dec().get('g-review').manual, true);

  await rejects(run(deps, 'discogs-decide', { groupId: 'g-review', decision: 'accept' }), 400, /releaseId/);
  await rejects(run(deps, 'discogs-decide', { groupId: 'g-review', decision: 'accept', releaseId: 1.5 }), 400);
  await rejects(run(deps, 'discogs-decide', { groupId: 'g-review', decision: 'accept', releaseId: -3, manual: true }), 400);
  await rejects(run(deps, 'discogs-decide', { groupId: 'no-such', decision: 'accept', releaseId: 101 }), 404);
  await rejects(run(deps, 'discogs-decide', { groupId: 'g-review', decision: 'maybe' }), 400);
  await rejects(run(deps, 'discogs-decide', { decision: 'skip' }), 400);

  await run(deps, 'discogs-decide', { groupId: 'g-review', decision: 'skip' });
  assert.equal(dec().get('g-review').decision, 'skip'); assert.equal(dec().get('g-review').releaseId, null);
  await run(deps, 'discogs-decide', { groupId: 'g-review', decision: 'reset' });
  assert.equal(dec().has('g-review'), false);
});

test('apply: builds items from best + accepted decision, queues DISCOGS_APPLY', async () => {
  const { db, deps } = setup();
  seedPlan(db);
  await run(deps, 'discogs-decide', { groupId: 'g-review', decision: 'accept', releaseId: 102 });
  const r = await run(deps, 'discogs-apply', { planId: 'P1', groupIds: ['g-add', 'g-review'], notes: true });
  assert.deepEqual([r.ok, r.count], [true, 2]);
  const c = cmds(db).get(r.commandId);
  assert.deepEqual([c.type, c.state, c.workerId, c.planId, c.notes, c.folderId, c.sourceId, c.relativePath], ['DISCOGS_APPLY', 'QUEUED', 'mac-analyzer', 'P1', true, 1, 's1', 'discogs']);
  assert.deepEqual(c.items, [{ groupId: 'g-add', releaseId: 101 }, { groupId: 'g-review', releaseId: 102 }]);

  // Accepted decision beats row.best (first apply failed, so g-add is free again).
  c.state = 'FAILED'; cmds(db).set(r.commandId, c);
  await run(deps, 'discogs-decide', { groupId: 'g-add', decision: 'accept', releaseId: 102 });
  const r2 = await run(deps, 'discogs-apply', { planId: 'P1', groupIds: ['g-add'] });
  assert.deepEqual(cmds(db).get(r2.commandId).items, [{ groupId: 'g-add', releaseId: 102 }]);
  assert.equal(cmds(db).get(r2.commandId).notes, false);
});

test('apply: rejects review-without-decision, skipped, owned, unreadable, unknown, already added/adding', async () => {
  const { db, deps } = setup();
  seedPlan(db);
  await rejects(run(deps, 'discogs-apply', { planId: 'P1', groupIds: ['g-review'] }), 400, /g-review/);
  await rejects(run(deps, 'discogs-apply', { planId: 'P1', groupIds: ['g-owned', 'g-unread', 'ghost'] }), 400, /g-owned.*g-unread.*ghost/);
  await run(deps, 'discogs-decide', { groupId: 'g-add', decision: 'skip' });
  await rejects(run(deps, 'discogs-apply', { planId: 'P1', groupIds: ['g-add'] }), 400, /skipped/);
  await run(deps, 'discogs-decide', { groupId: 'g-add', decision: 'reset' });

  seedCmd(db, 'ap1', { type: 'DISCOGS_APPLY', state: 'QUEUED', planId: 'P1', items: [{ groupId: 'g-add', releaseId: 101 }], createdAt: '2026-01-02T00:00:00.000Z' });
  await rejects(run(deps, 'discogs-apply', { planId: 'P1', groupIds: ['g-add'] }), 400, /already added/);
  cmds(db).get('ap1').state = 'COMPLETE';
  cmds(db).get('ap1').result = { journal: 'j-applied.jsonl', applied: [{ groupId: 'g-add', releaseId: 101, instanceId: 1 }] };
  await rejects(run(deps, 'discogs-apply', { planId: 'P1', groupIds: ['g-add'] }), 400, /already added/);
  // Nothing extra queued by failed attempts.
  assert.equal([...cmds(db).values()].filter((c) => c.type === 'DISCOGS_APPLY').length, 1);
});

test('apply: input validation, caps, plan lookup and analyzer gating', async () => {
  const { db, deps } = setup();
  seedPlan(db);
  await rejects(run(deps, 'discogs-apply', { groupIds: ['g-add'] }), 400, /planId/);
  await rejects(run(deps, 'discogs-apply', { planId: 'P1' }), 400, /groupIds/);
  await rejects(run(deps, 'discogs-apply', { planId: 'P1', groupIds: [] }), 400);
  await rejects(run(deps, 'discogs-apply', { planId: 'P1', groupIds: Array.from({ length: 101 }, (_, i) => `g${i}`) }), 400, /100/);
  await rejects(run(deps, 'discogs-apply', { planId: 'NOPE', groupIds: ['g-add'] }), 404);
  const off = setup({ online: false }); seedPlan(off.db);
  await rejects(run(off.deps, 'discogs-apply', { planId: 'P1', groupIds: ['g-add'] }), 409);
});

test('undo: requires a COMPLETE apply with a journal; queues DISCOGS_UNDO', async () => {
  const { db, deps } = setup();
  seedPlan(db);
  seedCmd(db, 'ap-run', { type: 'DISCOGS_APPLY', state: 'RUNNING', planId: 'P1' });
  seedCmd(db, 'ap-nojournal', { type: 'DISCOGS_APPLY', state: 'COMPLETE', planId: 'P1', result: { applied: [] } });
  seedCmd(db, 'ap-ok', { type: 'DISCOGS_APPLY', state: 'COMPLETE', planId: 'P1', result: { journal: 'P1-applied-9.jsonl', applied: [] } });

  await rejects(run(deps, 'discogs-undo', {}), 400);
  await rejects(run(deps, 'discogs-undo', { applyCommandId: 'missing' }), 404);
  await rejects(run(deps, 'discogs-undo', { applyCommandId: 'p1' }), 404);
  await rejects(run(deps, 'discogs-undo', { applyCommandId: 'ap-run' }), 409);
  await rejects(run(deps, 'discogs-undo', { applyCommandId: 'ap-nojournal' }), 409);

  const r = await run(deps, 'discogs-undo', { applyCommandId: 'ap-ok' });
  assert.equal(r.ok, true);
  const c = cmds(db).get(r.commandId);
  assert.deepEqual([c.type, c.state, c.workerId, c.journal, c.applyCommandId], ['DISCOGS_UNDO', 'QUEUED', 'mac-analyzer', 'P1-applied-9.jsonl', 'ap-ok']);

  const off = setup({ online: false });
  seedCmd(off.db, 'ap-ok', { type: 'DISCOGS_APPLY', state: 'COMPLETE', result: { journal: 'j-applied.jsonl' } });
  await rejects(run(off.deps, 'discogs-undo', { applyCommandId: 'ap-ok' }), 409);
});
