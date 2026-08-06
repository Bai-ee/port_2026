// proof-render-dispatch.test.js — P1-A (Production lifecycle hardening
// round). Pure, dependency-injected tests — no real network call (a fake
// fetchImpl is always supplied to the 'local' strategy), no live Firestore
// needed at all (this module never touches it). Covers: env-driven strategy
// selection, the local/direct-POST path's exact request shape, and the
// "never throws, always best-effort" contract every mode must honor so a
// dispatch problem can never fail or block job creation.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const dispatch = require('../proof-render-dispatch.cjs');

const LOCAL_ENV = { PROOF_RENDER_WORKER_URL: 'http://127.0.0.1:8080', PROOF_RENDER_SHARED_SECRET: 'test-secret' };
const CLOUD_ENV = { PROOF_RENDER_TASKS_QUEUE: 'projects/p/locations/l/queues/q' };

// ── resolveDispatchMode ──────────────────────────────────────────────────

test('resolveDispatchMode is "none" when nothing is configured', () => {
  assert.equal(dispatch.resolveDispatchMode({}), 'none');
});

test('resolveDispatchMode is "none" when only ONE of URL/secret is set — never a half-configured local dispatch', () => {
  assert.equal(dispatch.resolveDispatchMode({ PROOF_RENDER_WORKER_URL: 'http://x' }), 'none');
  assert.equal(dispatch.resolveDispatchMode({ PROOF_RENDER_SHARED_SECRET: 'x' }), 'none');
});

test('resolveDispatchMode is "local" when both PROOF_RENDER_WORKER_URL and PROOF_RENDER_SHARED_SECRET are set', () => {
  assert.equal(dispatch.resolveDispatchMode(LOCAL_ENV), 'local');
});

test('resolveDispatchMode is "cloud-tasks" when PROOF_RENDER_TASKS_QUEUE is set — takes priority over a local config that also happens to be present', () => {
  assert.equal(dispatch.resolveDispatchMode(CLOUD_ENV), 'cloud-tasks');
  assert.equal(dispatch.resolveDispatchMode({ ...CLOUD_ENV, ...LOCAL_ENV }), 'cloud-tasks');
});

// ── local/direct-POST strategy ───────────────────────────────────────────

test('dispatchProofRenderJob (local mode) POSTs /run on the configured worker URL with the shared-secret header', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200 };
  };
  await dispatch.dispatchProofRenderJob('job-123', { env: LOCAL_ENV, fetchImpl });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:8080/run');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers['x-proof-render-secret'], 'test-secret');
});

test('dispatchProofRenderJob (local mode) strips a trailing slash from PROOF_RENDER_WORKER_URL', async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return { ok: true, status: 200 }; };
  await dispatch.dispatchProofRenderJob('job-123', {
    env: { ...LOCAL_ENV, PROOF_RENDER_WORKER_URL: 'http://127.0.0.1:8080/' }, fetchImpl,
  });
  assert.equal(calls[0], 'http://127.0.0.1:8080/run');
});

test('dispatchProofRenderJob (local mode) never throws when the fetch itself rejects (network failure) — dispatch is best-effort only', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  await assert.doesNotReject(() => dispatch.dispatchProofRenderJob('job-123', { env: LOCAL_ENV, fetchImpl }));
});

test('dispatchProofRenderJob (local mode) never throws on a non-2xx response, including the worker\'s own busy 409/429', async () => {
  for (const status of [401, 409, 429, 500]) {
    const fetchImpl = async () => ({ ok: false, status });
    await assert.doesNotReject(() => dispatch.dispatchProofRenderJob('job-123', { env: LOCAL_ENV, fetchImpl }));
  }
});

test('dispatchProofRenderJob is a true no-op in "none" mode — no fetch call is ever made', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { ok: true, status: 200 }; };
  await dispatch.dispatchProofRenderJob('job-123', { env: {}, fetchImpl });
  assert.equal(called, false);
});

// ── cloud-tasks strategy (Phase 7 item 1 — IMPLEMENTED: one HTTP task per
// dispatch targeting the worker's /run, created via the Cloud Tasks REST
// API; queue-level retries own durability). Fully DI'd — fake fetch + fake
// token getter, zero real network/auth. ───────────────────────────────────

const FULL_CLOUD_ENV = {
  PROOF_RENDER_TASKS_QUEUE: 'projects/p/locations/l/queues/q',
  PROOF_RENDER_WORKER_URL: 'https://proof.example.run.app/',
  PROOF_RENDER_SHARED_SECRET: 'test-secret',
  PROOF_RENDER_TASKS_INVOKER_SA: 'proof-invoker@p.iam.gserviceaccount.com',
};

test('dispatchViaCloudTasks creates exactly the right task: queue URL, bearer auth, worker /run target with the shared-secret header, dispatch deadline — and image of the body never carries job internals', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, text: async () => '' }; };
  await dispatch._internals.dispatchViaCloudTasks('job-123', FULL_CLOUD_ENV, { fetchImpl, getTokenImpl: async () => 'fake-token' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://cloudtasks.googleapis.com/v2/projects/p/locations/l/queues/q/tasks');
  assert.equal(calls[0].init.headers.authorization, 'Bearer fake-token');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.task.httpRequest.httpMethod, 'POST');
  assert.equal(body.task.httpRequest.url, 'https://proof.example.run.app/run', 'trailing slash on the worker URL must not produce a double slash');
  assert.equal(body.task.httpRequest.headers['x-proof-render-secret'], 'test-secret');
  assert.equal(body.task.dispatchDeadline, '900s', "must outlive the worker's own ~660s request budget");
  assert.equal(body.task.scheduleTime, undefined, 'plain job-creation dispatch delivers ASAP');
  // OIDC (Codex Phase 7 review, P1): the worker is a PRIVATE Cloud Run
  // service — without this token Cloud Run IAM rejects the request before
  // /run ever sees the shared secret.
  assert.deepEqual(body.task.httpRequest.oidcToken, {
    serviceAccountEmail: 'proof-invoker@p.iam.gserviceaccount.com',
    audience: 'https://proof.example.run.app',
  });
  // Dedup (Codex Phase 7 review, P2): deterministic per-job task name.
  assert.equal(body.task.name, 'projects/p/locations/l/queues/q/tasks/job-job-123');
});

test('a 409 ALREADY_EXISTS on task creation is SUCCESS — the deterministic name is the dedup mechanism, a replay must not fail dispatch', async () => {
  await assert.doesNotReject(() => dispatch._internals.dispatchViaCloudTasks('job-123', FULL_CLOUD_ENV, {
    fetchImpl: async () => ({ ok: false, status: 409, text: async () => 'ALREADY_EXISTS' }),
    getTokenImpl: async () => 't',
  }));
});

test('a missing PROOF_RENDER_TASKS_INVOKER_SA fails loudly — a task without an OIDC token can never reach the private worker', async () => {
  await assert.rejects(
    () => dispatch._internals.dispatchViaCloudTasks('j', { ...FULL_CLOUD_ENV, PROOF_RENDER_TASKS_INVOKER_SA: '' }, { fetchImpl: async () => ({ ok: true, status: 200, text: async () => '' }), getTokenImpl: async () => 't' }),
    /PROOF_RENDER_TASKS_INVOKER_SA/,
  );
});

test('dispatchViaCloudTasks passes scheduleTime through when given — the delayed-retryAt redelivery hook', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, text: async () => '' }; };
  await dispatch._internals.dispatchViaCloudTasks('job-123', FULL_CLOUD_ENV, { fetchImpl, getTokenImpl: async () => 't', scheduleTime: '2026-08-03T14:00:00Z' });
  assert.equal(JSON.parse(calls[0].init.body).task.scheduleTime, '2026-08-03T14:00:00Z');
});

test('dispatchViaCloudTasks fails loudly on bad config — malformed queue name, missing worker URL/secret, failed token, non-2xx create', async () => {
  const okFetch = async () => ({ ok: true, status: 200, text: async () => '' });
  const token = async () => 't';
  await assert.rejects(() => dispatch._internals.dispatchViaCloudTasks('j', { ...FULL_CLOUD_ENV, PROOF_RENDER_TASKS_QUEUE: 'my-queue' }, { fetchImpl: okFetch, getTokenImpl: token }), /full queue name/);
  await assert.rejects(() => dispatch._internals.dispatchViaCloudTasks('j', { ...FULL_CLOUD_ENV, PROOF_RENDER_WORKER_URL: '' }, { fetchImpl: okFetch, getTokenImpl: token }), /PROOF_RENDER_WORKER_URL/);
  await assert.rejects(() => dispatch._internals.dispatchViaCloudTasks('j', { ...FULL_CLOUD_ENV, PROOF_RENDER_SHARED_SECRET: '' }, { fetchImpl: okFetch, getTokenImpl: token }), /PROOF_RENDER_SHARED_SECRET/);
  await assert.rejects(() => dispatch._internals.dispatchViaCloudTasks('j', FULL_CLOUD_ENV, { fetchImpl: okFetch, getTokenImpl: async () => null }), /access token/);
  await assert.rejects(() => dispatch._internals.dispatchViaCloudTasks('j', FULL_CLOUD_ENV, { fetchImpl: async () => ({ ok: false, status: 403, text: async () => 'PERMISSION_DENIED' }), getTokenImpl: token }), /403.*PERMISSION_DENIED/s);
});

test('dispatchProofRenderJob returns an OBSERVABLE status — never throws, never silently acks a failed dispatch (Codex Phase 7 review, P1)', async () => {
  const none = await dispatch.dispatchProofRenderJob('job-123', { env: {} });
  assert.deepEqual(none, { mode: 'none', dispatched: false, reason: 'not-configured' });

  const failed = await dispatch.dispatchProofRenderJob('job-123', { env: CLOUD_ENV });
  assert.equal(failed.mode, 'cloud-tasks');
  assert.equal(failed.dispatched, false, 'a misconfigured cloud dispatch must be visibly undelivered, not a silent success');
  assert.ok(failed.error, 'the failure reason travels to the caller (sanitized message, no secrets)');

  const ok = await dispatch.dispatchProofRenderJob('job-123', {
    env: LOCAL_ENV,
    fetchImpl: async () => ({ ok: true, status: 200 }),
  });
  assert.deepEqual(ok, { mode: 'local', dispatched: true });
});
