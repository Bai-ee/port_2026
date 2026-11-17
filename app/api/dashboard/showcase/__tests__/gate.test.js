// Route-level gate for Site Showcase: verifyRequestUser -> isAdminEmail -> getEffectiveClientContext ->
// requirePilotOwner -> SHOWCASE_CLIENTS. Auth/context are stubbed on the CJS exports BEFORE the route is imported;
// Firestore is the in-memory fake and fetch is stubbed. No network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test, { beforeEach, afterEach } from 'node:test';
import { createRequire } from 'node:module';
import '../../../archive/__tests__/esm-next-server-shim.mjs';

const require = createRequire(import.meta.url);
const auth = require('../../../../../api/_lib/auth.cjs');
const provisioning = require('../../../../../api/_lib/client-provisioning.cjs');
const fb = require('../../../../../api/_lib/firebase-admin.cjs');
const { makeFakeContext } = require('../../../../../api/_lib/__tests__/fake-firestore.cjs');

const OWNER_UID = 'owner-uid';
const HL_CLIENT = 'bryan-balli-WUoltG84';
const UE_CLIENT = 'ue-client';
let who;
let resolvedClient;
let admin;
let ctx;
let fetchCalls;
const realEnv = { ...process.env };
const realFetch = globalThis.fetch;
const realVerify = auth.verifyRequestUser;
const realIsAdmin = auth.isAdminEmail;
const realCtx = provisioning.getEffectiveClientContext;
const dbDescriptor = Object.getOwnPropertyDescriptor(fb, 'adminDb');

auth.verifyRequestUser = async () => {
  if (!who) throw Object.assign(new Error('Unauthorized.'), { status: 401 });
  return { uid: who.uid, email: `${who.uid}@example.com` };
};
auth.isAdminEmail = async () => admin;
provisioning.getEffectiveClientContext = async () => ({ clientId: resolvedClient });

const route = await import('../route.js');

beforeEach(() => {
  who = { uid: OWNER_UID };
  resolvedClient = HL_CLIENT;
  admin = true;
  ctx = makeFakeContext();
  fetchCalls = [];
  globalThis.fetch = async (url, init) => { fetchCalls.push({ url, init }); return { ok: true, status: 200 }; };
  Object.defineProperty(fb, 'adminDb', { configurable: true, get: () => ctx.adminDb });
  process.env.PILOT_OWNER_UIDS = OWNER_UID;
  process.env.PILOT_CLIENT_IDS = `${HL_CLIENT},${UE_CLIENT}`;
  process.env.VERCEL_ENV = 'production';
  process.env.SHOWCASE_RENDER_URL = 'https://showcase.example.test';
  process.env.SHOWCASE_RENDER_SECRET = 'shh';
  delete process.env.SHOWCASE_MAX_RENDERS_PER_DAY;
});
afterEach(() => {
  Object.defineProperty(fb, 'adminDb', dbDescriptor);
  globalThis.fetch = realFetch;
  process.env = { ...realEnv };
});
test.after(() => {
  auth.verifyRequestUser = realVerify;
  auth.isAdminEmail = realIsAdmin;
  provisioning.getEffectiveClientContext = realCtx;
});

const hdr = { authorization: 'Bearer t', 'content-type': 'application/json' };
const get = async (qs) => {
  const res = await route.GET(new Request(`http://localhost/api/dashboard/showcase?${qs}`, { headers: hdr }));
  return { status: res.status, body: await res.json() };
};
const create = async (body = { focusId: 'hero-line', format: 'square', theme: 'dark' }) => {
  const res = await route.POST(new Request('http://localhost/api/dashboard/showcase?action=create', {
    method: 'POST', headers: hdr, body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
};
const writes = () => [...ctx.adminDb._store.entries()].filter(([, m]) => m.size).map(([c]) => c);
const dayKey = () => new Date().toISOString().slice(0, 10);

test('unauthenticated => 401', async () => {
  who = null;
  assert.equal((await get('action=options')).status, 401);
  assert.equal((await create()).status, 401);
});

test('non-admin => 403', async () => {
  admin = false;
  assert.equal((await get('action=options')).status, 403);
  assert.equal((await create()).status, 403);
  assert.deepEqual(writes(), []);
});

test('admin who is not the pilot owner => 403', async () => {
  who = { uid: 'other-admin' };
  assert.equal((await get('action=list')).status, 403);
  assert.equal((await create()).status, 403);
  assert.deepEqual(writes(), []);
});

test('pilot client that is not allowlisted for showcase (UE) => 403, nothing written', async () => {
  resolvedClient = UE_CLIENT;
  const r = await create();
  assert.equal(r.status, 403);
  assert.equal((await get('action=options')).status, 403);
  assert.deepEqual(writes(), []);
  assert.equal(fetchCalls.length, 0);
});

test('render URL or secret unset => 503 before any write', async () => {
  delete process.env.SHOWCASE_RENDER_URL;
  assert.equal((await create()).status, 503);
  process.env.SHOWCASE_RENDER_URL = 'https://showcase.example.test';
  delete process.env.SHOWCASE_RENDER_SECRET;
  assert.equal((await create()).status, 503);
  assert.deepEqual(writes(), []);
});

test('create writes the queued job + guard and triggers the service', async () => {
  const r = await create();
  assert.equal(r.status, 202);
  assert.match(r.body.jobId, /^sc_[a-z0-9]+_[0-9a-f]{8}$/);
  const job = ctx.adminDb._raw('showcase_jobs', r.body.jobId);
  assert.equal(job.status, 'queued');
  assert.equal(job.clientId, HL_CLIENT);
  assert.equal(job.videoClient, 'hitloop');
  assert.equal(job.createdBy, OWNER_UID);
  assert.equal(job.dayKey, dayKey());
  assert.deepEqual(ctx.adminDb._raw('showcase_state', HL_CLIENT), { dayKey: dayKey(), count: 1, activeJobId: r.body.jobId });
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'https://showcase.example.test/render');
  assert.equal(fetchCalls[0].init.headers['x-render-secret'], 'shh');
  assert.deepEqual(JSON.parse(fetchCalls[0].init.body), { jobId: r.body.jobId });
});

test('a failed trigger is swallowed', async () => {
  globalThis.fetch = async () => { throw new Error('aborted'); };
  assert.equal((await create()).status, 202);
});

test('invalid focus/format/theme => 400, nothing written', async () => {
  assert.equal((await create({ focusId: 'nope', format: 'square' })).status, 400);
  assert.equal((await create({ focusId: 'hero-line', format: 'square', theme: 'neon' })).status, 400);
  assert.deepEqual(writes(), []);
});

test('active job under 20 minutes => 409', async () => {
  const first = await create();
  assert.equal(first.status, 202);
  const second = await create();
  assert.equal(second.status, 409);
  assert.equal(second.body.jobId, first.body.jobId);
  assert.equal(ctx.adminDb._raw('showcase_state', HL_CLIENT).count, 1);
});

test('active job older than 20 minutes is failed "timed out" and a new one is queued', async () => {
  const old = new Date(Date.now() - 21 * 60 * 1000).toISOString();
  ctx.adminDb._patch('showcase_jobs', 'sc_old_000001', { jobId: 'sc_old_000001', clientId: HL_CLIENT, status: 'rendering', createdAt: old });
  ctx.adminDb._patch('showcase_state', HL_CLIENT, { dayKey: dayKey(), count: 1, activeJobId: 'sc_old_000001' });
  const r = await create();
  assert.equal(r.status, 202);
  const oldJob = ctx.adminDb._raw('showcase_jobs', 'sc_old_000001');
  assert.equal(oldJob.status, 'failed');
  assert.equal(oldJob.error.message, 'timed out');
  assert.equal(ctx.adminDb._raw('showcase_state', HL_CLIENT).count, 2);
});

test('daily cap => 429 (default 6, env override)', async () => {
  ctx.adminDb._patch('showcase_state', HL_CLIENT, { dayKey: dayKey(), count: 6, activeJobId: null });
  assert.equal((await create()).status, 429);
  ctx.adminDb._patch('showcase_state', HL_CLIENT, { dayKey: dayKey(), count: 2, activeJobId: null });
  process.env.SHOWCASE_MAX_RENDERS_PER_DAY = '2';
  assert.equal((await create()).status, 429);
  delete process.env.SHOWCASE_MAX_RENDERS_PER_DAY;
  assert.equal((await create()).status, 202);
});

test('a previous day count does not block', async () => {
  ctx.adminDb._patch('showcase_state', HL_CLIENT, { dayKey: '2000-01-01', count: 99, activeJobId: null });
  assert.equal((await create()).status, 202);
  assert.equal(ctx.adminDb._raw('showcase_state', HL_CLIENT).count, 1);
});

test('options returns three options and the quota', async () => {
  const r = await get('action=options');
  assert.equal(r.status, 200);
  assert.equal(r.body.options.length, 3);
  assert.deepEqual(r.body.quota, { used: 0, max: 6 });
});

test('status hides createdBy, 404s another client, re-triggers a stale queued job', async () => {
  const stale = new Date(Date.now() - 60 * 1000).toISOString();
  ctx.adminDb._patch('showcase_jobs', 'sc_mine_00001', { jobId: 'sc_mine_00001', clientId: HL_CLIENT, status: 'queued', createdBy: OWNER_UID, createdAt: new Date().toISOString(), triggerAt: stale });
  ctx.adminDb._patch('showcase_jobs', 'sc_other_0001', { jobId: 'sc_other_0001', clientId: 'someone-else', status: 'queued', createdAt: new Date().toISOString(), triggerAt: stale });
  const mine = await get('action=status&jobId=sc_mine_00001');
  assert.equal(mine.status, 200);
  assert.equal('createdBy' in mine.body.job, false);
  assert.equal(fetchCalls.length, 1);
  assert.equal((await get('action=status&jobId=sc_other_0001')).status, 404);
  assert.equal((await get('action=status&jobId=bad')).status, 400);
});

test('status fails a job active for over 20 minutes', async () => {
  const old = new Date(Date.now() - 25 * 60 * 1000).toISOString();
  ctx.adminDb._patch('showcase_jobs', 'sc_slow_00001', { jobId: 'sc_slow_00001', clientId: HL_CLIENT, status: 'rendering', createdAt: old, triggerAt: old });
  const r = await get('action=status&jobId=sc_slow_00001');
  assert.equal(r.body.job.status, 'failed');
  assert.equal(ctx.adminDb._raw('showcase_jobs', 'sc_slow_00001').status, 'failed');
});

test('list fails an active job older than 20 minutes', async () => {
  const old = new Date(Date.now() - 25 * 60 * 1000).toISOString();
  ctx.adminDb._patch('showcase_jobs', 'sc_old_list01', { jobId: 'sc_old_list01', clientId: HL_CLIENT, status: 'queued', createdAt: old });
  const r = await get('action=list');
  assert.equal(r.body.jobs[0].status, 'failed');
  assert.equal(ctx.adminDb._raw('showcase_jobs', 'sc_old_list01').error.message, 'timed out');
});

test('timeout write re-checks inside the transaction: a job that finished meanwhile is not overwritten', async () => {
  const old = new Date(Date.now() - 25 * 60 * 1000).toISOString();
  ctx.adminDb._patch('showcase_jobs', 'sc_race_00001', { jobId: 'sc_race_00001', clientId: HL_CLIENT, status: 'rendering', createdAt: old });
  // The status read sees "rendering"; the job completes before the transaction body runs.
  const realRun = ctx.adminDb.runTransaction.bind(ctx.adminDb);
  ctx.adminDb.runTransaction = (fn) => {
    ctx.adminDb._patch('showcase_jobs', 'sc_race_00001', { status: 'done' });
    return realRun(fn);
  };
  const r = await get('action=status&jobId=sc_race_00001');
  assert.equal(r.body.job.status, 'done');
  assert.equal(ctx.adminDb._raw('showcase_jobs', 'sc_race_00001').status, 'done');
});

test('a non-2xx trigger response warns with the status only', async () => {
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  globalThis.fetch = async () => ({ ok: false, status: 401 });
  try { assert.equal((await create()).status, 202); } finally { console.warn = realWarn; }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /HTTP 401/);
  assert.doesNotMatch(warnings[0], /shh|example\.test/);
});

test('list returns only this client jobs, newest first, without createdBy', async () => {
  ctx.adminDb._patch('showcase_jobs', 'sc_a_000001', { jobId: 'sc_a_000001', clientId: HL_CLIENT, status: 'done', createdBy: 'x', createdAt: '2026-11-01T00:00:00.000Z' });
  ctx.adminDb._patch('showcase_jobs', 'sc_b_000001', { jobId: 'sc_b_000001', clientId: 'other', status: 'done', createdAt: '2026-11-02T00:00:00.000Z' });
  ctx.adminDb._patch('showcase_jobs', 'sc_c_000001', { jobId: 'sc_c_000001', clientId: HL_CLIENT, status: 'done', createdAt: '2026-11-03T00:00:00.000Z' });
  const r = await get('action=list');
  assert.deepEqual(r.body.jobs.map((j) => j.jobId), ['sc_c_000001', 'sc_a_000001']);
  assert.ok(r.body.jobs.every((j) => !('createdBy' in j)));
});

test('route source does not touch the media job queue', () => {
  const src = fs.readFileSync(new URL('../route.js', import.meta.url), 'utf8');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /media-jobs/);
  assert.doesNotMatch(code, /media_jobs|media_queue_locks/);
});
