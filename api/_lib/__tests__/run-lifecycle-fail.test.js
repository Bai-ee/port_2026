'use strict';

// Covers Phases 1-2 of docs/plans/DASHBOARD_CREATION_FAILURE_UX_CLAUDE_PLAN.md:
// failRun's dashboard-creation-incident classification, the stale-write
// guard, and the Phase 2 notification wiring. completeRun/claimRun/
// requeueRun etc. are untouched by these phases and stay on the module-level
// `fb` — this file only exercises failRun via the `__setTestContext` seam.
//
// Gate note: the hard-gate fires on ANY failure of the primary creation run,
// not only once `attempts` is exhausted. Nothing in this codebase
// auto-retries a 'failed' run (attempts only advances via the admin-only
// requeueRun), so gating on exhaustion would mean the incident/alert could
// only ever fire after an admin had already manually retried the same run
// twice on their own — see the comment above `hard` in run-lifecycle.cjs.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const runLifecycle = require('../run-lifecycle.cjs');
const { makeFakeContext } = require('./fake-firestore.cjs');

let fakeCtx;

beforeEach(() => {
  fakeCtx = makeFakeContext();
  runLifecycle.__setTestContext(fakeCtx);
});

afterEach(() => {
  runLifecycle.__setTestContext(null);
});

async function seedRunningRun(runId, clientId, overrides = {}) {
  await fakeCtx.adminDb.collection('brief_runs').doc(runId).set({
    runId,
    clientId,
    status: 'running',
    trigger: 'signup',
    pipelineType: 'free-tier-intake',
    attempts: 1,
    ...overrides,
  });
}

async function seedClient(clientId, overrides = {}) {
  await fakeCtx.adminDb.collection('clients').doc(clientId).set({
    clientId,
    status: 'provisioning',
    ...overrides,
  });
}

// ── classifyPublicFailure ────────────────────────────────────────────────────

test('classifyPublicFailure: invalid URL classifies as website_address', () => {
  const { publicStage, publicMessage } = runLifecycle.classifyPublicFailure({ message: 'Invalid URL supplied', stage: 'config' });
  assert.equal(publicStage, 'website_address');
  assert.match(publicMessage, /website address/i);
});

test('classifyPublicFailure: network/timeout errors classify as website_access', () => {
  for (const message of ['ENOTFOUND rositas.com', 'connect ECONNREFUSED', 'request timed out', 'Fetch failed with 503']) {
    const { publicStage } = runLifecycle.classifyPublicFailure({ message, stage: 'pipeline' });
    assert.equal(publicStage, 'website_access', `expected website_access for "${message}"`);
  }
});

test('classifyPublicFailure: screenshot/render errors classify as website_rendering', () => {
  const { publicStage } = runLifecycle.classifyPublicFailure({ message: 'Screenshot capture failed via browserless', stage: 'module' });
  assert.equal(publicStage, 'website_rendering');
});

test('classifyPublicFailure: unrecognized errors fall back to processing', () => {
  const { publicStage, publicMessage } = runLifecycle.classifyPublicFailure({ message: 'Something unexpected happened', stage: 'module' });
  assert.equal(publicStage, 'processing');
  assert.match(publicMessage, /problem while creating/i);
});

test('classifyPublicFailure: never leaks the raw message into publicMessage', () => {
  const secretDetail = 'Anthropic API key sk-ant-super-secret-123 rejected';
  const { publicMessage } = runLifecycle.classifyPublicFailure({ message: secretDetail, stage: 'pipeline' });
  assert.ok(!publicMessage.includes('sk-ant-super-secret-123'));
});

// ── buildIncidentPublicCode ──────────────────────────────────────────────────

test('buildIncidentPublicCode: deterministic and stably formatted', () => {
  const a = runLifecycle.buildIncidentPublicCode('client123-signup');
  const b = runLifecycle.buildIncidentPublicCode('client123-signup');
  assert.equal(a, b);
  assert.match(a, /^HIT-[0-9A-Z]{6}$/);
});

test('buildIncidentPublicCode: different runIds usually produce different codes', () => {
  const a = runLifecycle.buildIncidentPublicCode('client-a-signup');
  const b = runLifecycle.buildIncidentPublicCode('client-b-signup');
  assert.notEqual(a, b);
});

// ── failRun: hard-gate (primary creation run) ───────────────────────────────

test('failRun opens a hard-gated incident for the primary creation run on its very first failure', async () => {
  const runId = 'client-a-signup';
  const clientId = 'client-a';
  await seedRunningRun(runId, clientId, { attempts: 1 }); // NOT exhausted — must still gate
  await seedClient(clientId);

  await runLifecycle.failRun(runId, clientId, { message: 'ENOTFOUND client-a.com', stage: 'pipeline' }, 1);

  const dash = (await fakeCtx.adminDb.collection('dashboard_state').doc(clientId).get()).data();
  assert.equal(dash.errorState.kind, 'dashboard_creation_failed');
  assert.equal(dash.errorState.status, 'open');
  assert.equal(dash.errorState.incidentId, runId);
  assert.equal(dash.errorState.publicStage, 'website_access');
  assert.match(dash.errorState.publicCode, /^HIT-[0-9A-Z]{6}$/);
  assert.equal(dash.errorState.notification.status, 'not_configured');
  assert.ok(!dash.errorState.publicMessage.includes('ENOTFOUND'), 'public message must not leak the raw error');
  assert.equal(dash.errorState.message, dash.errorState.publicMessage, 'message alias must mirror publicMessage');

  const client = (await fakeCtx.adminDb.collection('clients').doc(clientId).get()).data();
  assert.equal(client.status, 'error');

  const run = (await fakeCtx.adminDb.collection('brief_runs').doc(runId).get()).data();
  assert.equal(run.status, 'failed');
  assert.equal(run.error.message, 'ENOTFOUND client-a.com', 'full detail still lands in brief_runs');

  const events = await fakeCtx.adminDb.collection('clients').doc(clientId).collection('brief_runs').doc(runId).collection('events').get();
  assert.equal(events.docs.length, 1);
  const label = events.docs[0].data().label;
  assert.match(label, /Dashboard setup could not be completed/i);
  assert.match(label, /HIT-[0-9A-Z]{6}/);
  assert.ok(!label.includes('ENOTFOUND'), 'client-readable event must not leak raw error detail');
});

test('failRun re-opens the incident (same incidentId) if an admin-requeued primary run fails again', async () => {
  const runId = 'client-b-signup';
  const clientId = 'client-b';
  await seedRunningRun(runId, clientId, { attempts: 1 });
  await seedClient(clientId);

  await runLifecycle.failRun(runId, clientId, { message: 'ENOTFOUND client-b.com', stage: 'pipeline' }, 1);
  const first = (await fakeCtx.adminDb.collection('dashboard_state').doc(clientId).get()).data();
  assert.equal(first.errorState.status, 'open');

  // Admin requeues (back to 'running', attempts bumped) — mirrors requeueRun.
  await fakeCtx.adminDb.collection('brief_runs').doc(runId).set({ status: 'running', attempts: 2 }, { merge: true });
  await runLifecycle.failRun(runId, clientId, { message: 'ENOTFOUND client-b.com again', stage: 'pipeline' }, 2);

  const second = (await fakeCtx.adminDb.collection('dashboard_state').doc(clientId).get()).data();
  assert.equal(second.errorState.status, 'open');
  assert.equal(second.errorState.incidentId, runId, 'same run = same incident id across retries');

  const client = (await fakeCtx.adminDb.collection('clients').doc(clientId).get()).data();
  assert.equal(client.status, 'error');
});

// ── failRun: excluded pipelines never gate an established client ───────────

test('failRun never writes errorState or downgrades status for a module run', async () => {
  const runId = 'module-run-1';
  const clientId = 'client-c';
  await seedRunningRun(runId, clientId, { trigger: 'module-enable', pipelineType: 'module-run' });
  await seedClient(clientId, { status: 'active' });

  await runLifecycle.failRun(runId, clientId, { message: 'module boom', stage: 'module' }, runLifecycle.MAX_ATTEMPTS);

  const dash = (await fakeCtx.adminDb.collection('dashboard_state').doc(clientId).get()).data();
  assert.equal(dash.errorState, undefined, 'module failures must not manufacture a client-facing errorState');
  assert.equal(dash.latestRunStatus, 'failed', 'run tracking still reflects the failure');

  const client = (await fakeCtx.adminDb.collection('clients').doc(clientId).get()).data();
  assert.equal(client.status, 'active', 'an established client must keep its dashboard');
});

test('failRun never gates an established client on a reseed failure', async () => {
  const runId = 'reseed-run-1';
  const clientId = 'client-d';
  await seedRunningRun(runId, clientId, { trigger: 'reseed', pipelineType: 'free-tier-intake' });
  await seedClient(clientId, { status: 'provisioning' });

  await runLifecycle.failRun(runId, clientId, { message: 'ENOTFOUND client-d.com', stage: 'pipeline' }, runLifecycle.MAX_ATTEMPTS);

  const dash = (await fakeCtx.adminDb.collection('dashboard_state').doc(clientId).get()).data();
  assert.equal(dash.errorState, undefined);

  const client = (await fakeCtx.adminDb.collection('clients').doc(clientId).get()).data();
  assert.equal(client.status, 'provisioning', 'status must be left untouched, not downgraded to error');
});

test('failRun respects details.soft — no errorState, no status change, even for a primary run', async () => {
  const runId = 'chain-run-1';
  const clientId = 'client-e';
  await seedRunningRun(runId, clientId, { trigger: 'onboarding-chain' });
  await seedClient(clientId, { status: 'active' });

  await runLifecycle.failRun(runId, clientId, { message: 'chained run failed', stage: 'pipeline' }, 1, { soft: true });

  const dash = (await fakeCtx.adminDb.collection('dashboard_state').doc(clientId).get()).data();
  assert.equal(dash.errorState, undefined);
  assert.equal(dash.latestRunStatus, undefined, 'soft mode does not touch latestRunStatus');

  const client = (await fakeCtx.adminDb.collection('clients').doc(clientId).get()).data();
  assert.equal(client.status, 'active');
});

// ── failRun: stale-write guard ───────────────────────────────────────────────

test('failRun skips a run that was already requeued by an admin (race with a slow worker)', async () => {
  const runId = 'client-f-signup';
  const clientId = 'client-f';
  await seedRunningRun(runId, clientId, { status: 'queued', attempts: 0 });
  await seedClient(clientId, { status: 'provisioning' });

  await runLifecycle.failRun(runId, clientId, { message: 'stale failure from the old worker', stage: 'pipeline' }, runLifecycle.MAX_ATTEMPTS);

  const run = (await fakeCtx.adminDb.collection('brief_runs').doc(runId).get()).data();
  assert.equal(run.status, 'queued', 'the requeue must win — a late failure must not flip it back to failed');

  const dash = (await fakeCtx.adminDb.collection('dashboard_state').doc(clientId).get()).data();
  assert.equal(dash, undefined, 'no incident should be opened for a run that already moved on');
});

// ── failRun: Phase 2 notification wiring ────────────────────────────────────

test('failRun writes a notification outcome onto the SAME incident without clobbering its other fields', async () => {
  const originalApiKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY; // forces the real notifyDashboardFailure to short-circuit to not_configured — no network call
  try {
    const runId = 'client-h-signup';
    const clientId = 'client-h';
    await seedRunningRun(runId, clientId);
    await fakeCtx.adminDb.collection('clients').doc(clientId).set({
      clientId,
      status: 'provisioning',
      companyName: 'Client H Co',
      ownerEmail: 'owner@client-h.com',
      websiteUrl: 'https://client-h.com',
    });

    await runLifecycle.failRun(runId, clientId, { message: 'ENOTFOUND client-h.com', stage: 'pipeline' }, runLifecycle.MAX_ATTEMPTS);

    const dash = (await fakeCtx.adminDb.collection('dashboard_state').doc(clientId).get()).data();
    // The notification follow-up write must never regress the incident shape.
    assert.equal(dash.errorState.kind, 'dashboard_creation_failed');
    assert.equal(dash.errorState.status, 'open');
    assert.equal(dash.errorState.incidentId, runId);
    assert.match(dash.errorState.publicCode, /^HIT-[0-9A-Z]{6}$/);
    // And the real delivery status must have replaced the Phase 1 placeholder.
    assert.equal(dash.errorState.notification.status, 'not_configured');
    assert.ok(dash.errorState.notification.attemptedAt, 'attemptedAt must be stamped even when not configured');

    const client = (await fakeCtx.adminDb.collection('clients').doc(clientId).get()).data();
    assert.equal(client.status, 'error');
  } finally {
    process.env.RESEND_API_KEY = originalApiKey;
  }
});

test('failRun: notifyHardFailure never runs for a non-hard failure (no client read side effect beyond what failRun itself does)', async () => {
  const runId = 'module-run-2';
  const clientId = 'client-i';
  await seedRunningRun(runId, clientId, { trigger: 'module-enable', pipelineType: 'module-run' });
  await seedClient(clientId, { status: 'active' });

  await runLifecycle.failRun(runId, clientId, { message: 'module boom', stage: 'module' }, 1);

  const dash = (await fakeCtx.adminDb.collection('dashboard_state').doc(clientId).get()).data();
  assert.equal(dash.errorState, undefined, 'no notification field should appear when no incident was ever opened');
});

test('failRun skips a run that already succeeded (duplicate worker race)', async () => {
  const runId = 'client-g-signup';
  const clientId = 'client-g';
  await seedRunningRun(runId, clientId, { status: 'succeeded' });
  await seedClient(clientId, { status: 'active' });

  await runLifecycle.failRun(runId, clientId, { message: 'late duplicate failure', stage: 'pipeline' }, runLifecycle.MAX_ATTEMPTS);

  const client = (await fakeCtx.adminDb.collection('clients').doc(clientId).get()).data();
  assert.equal(client.status, 'active', 'an already-succeeded run must not be retroactively failed');
});
