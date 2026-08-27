'use strict';

// Covers Phase 6 of docs/plans/DASHBOARD_CREATION_FAILURE_UX_CLAUDE_PLAN.md:
// the admin list/requeue/resolve surface for open dashboard-creation-failure
// incidents.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const incidents = require('../dashboard-failure-incidents.cjs');
const { makeFakeContext } = require('./fake-firestore.cjs');

let fakeCtx;

beforeEach(() => {
  fakeCtx = makeFakeContext();
  incidents.__setTestContext(fakeCtx);
});

afterEach(() => {
  incidents.__setTestContext(null);
});

const OPEN_ERROR_STATE = {
  kind: 'dashboard_creation_failed',
  status: 'open',
  incidentId: 'client-a-signup',
  runId: 'client-a-signup',
  failedAt: '2026-08-26T00:00:00.000Z',
  publicCode: 'HIT-ABC123',
  publicStage: 'website_access',
  publicMessage: 'We could not reach the website to build your dashboard.',
  message: 'We could not reach the website to build your dashboard.',
  notification: { attemptedAt: '2026-08-26T00:00:05.000Z', status: 'sent' },
  resolvedAt: null,
  resolvedBy: null,
};

async function seedIncident(clientId, overrides = {}) {
  await fakeCtx.adminDb.collection('dashboard_state').doc(clientId).set({
    clientId,
    errorState: { ...OPEN_ERROR_STATE, incidentId: `${clientId}-signup`, runId: `${clientId}-signup`, ...overrides },
  });
  await fakeCtx.adminDb.collection('clients').doc(clientId).set({
    clientId,
    status: 'error',
    companyName: `${clientId} Co`,
    websiteUrl: `https://${clientId}.com`,
    ownerEmail: `owner@${clientId}.com`,
  });
  await fakeCtx.adminDb.collection('brief_runs').doc(`${clientId}-signup`).set({
    runId: `${clientId}-signup`,
    clientId,
    status: 'failed',
    attempts: 3,
    error: { message: 'ENOTFOUND ' + clientId + '.com', stage: 'pipeline' },
  });
}

// ── listOpenIncidents ────────────────────────────────────────────────────────

test('listOpenIncidents: returns an open incident with client info and the full admin diagnostic', async () => {
  await seedIncident('client-a');
  const result = await incidents.listOpenIncidents();
  assert.equal(result.length, 1);
  const [row] = result;
  assert.equal(row.clientId, 'client-a');
  assert.equal(row.companyName, 'client-a Co');
  assert.equal(row.websiteUrl, 'https://client-a.com');
  assert.equal(row.publicCode, 'HIT-ABC123');
  assert.equal(row.internalError.message, 'ENOTFOUND client-a.com');
  assert.equal(row.attempts, 3);
});

test('listOpenIncidents: excludes a resolved incident', async () => {
  await seedIncident('client-b', { status: 'resolved' });
  const result = await incidents.listOpenIncidents();
  assert.equal(result.length, 0);
});

test('listOpenIncidents: excludes an open errorState of a different kind (defensive, forward-compat)', async () => {
  await seedIncident('client-c', { kind: 'something-else' });
  const result = await incidents.listOpenIncidents();
  assert.equal(result.length, 0);
});

test('listOpenIncidents: sorts newest failure first', async () => {
  await seedIncident('client-old', { failedAt: '2026-08-01T00:00:00.000Z' });
  await seedIncident('client-new', { failedAt: '2026-08-20T00:00:00.000Z' });
  const result = await incidents.listOpenIncidents();
  assert.deepEqual(result.map((r) => r.clientId), ['client-new', 'client-old']);
});

// ── requeueIncident ──────────────────────────────────────────────────────────

test('requeueIncident: calls the injected requeueRunFn and appends a "requeued" audit event', async () => {
  await seedIncident('client-d');
  let calledWith = null;
  const fakeRequeueRun = async (runId) => { calledWith = runId; return { ok: true, runId, clientId: 'client-d', status: 'queued' }; };

  const result = await incidents.requeueIncident(
    { clientId: 'client-d', runId: 'client-d-signup', adminEmail: 'admin@hitloop.agency' },
    { requeueRunFn: fakeRequeueRun }
  );

  assert.equal(calledWith, 'client-d-signup');
  assert.equal(result.status, 'queued');

  const events = await fakeCtx.adminDb.collection('dashboard_failure_incidents').doc('client-d-signup').collection('events').get();
  assert.equal(events.docs.length, 1);
  const audit = events.docs[0].data();
  assert.equal(audit.resolution, 'requeued');
  assert.equal(audit.resolvedBy, 'admin@hitloop.agency');
  assert.equal(audit.clientId, 'client-d');
  assert.equal(audit.publicCode, 'HIT-ABC123');
  assert.equal(audit.note, null);
});

test('requeueIncident: propagates a requeueRunFn failure without writing an audit record', async () => {
  await seedIncident('client-e');
  const failingRequeueRun = async () => { throw new Error('Run not found.'); };

  await assert.rejects(
    () => incidents.requeueIncident({ clientId: 'client-e', runId: 'client-e-signup', adminEmail: 'admin@hitloop.agency' }, { requeueRunFn: failingRequeueRun }),
    /not found/
  );

  const audit = await fakeCtx.adminDb.collection('dashboard_failure_incidents').doc('client-e-signup').get();
  assert.equal(audit.exists, false);
});

// ── resolveIncident ──────────────────────────────────────────────────────────

test('resolveIncident: marks the incident resolved WITHOUT losing any other errorState field', async () => {
  await seedIncident('client-f');
  await incidents.resolveIncident({ clientId: 'client-f', incidentId: 'client-f-signup', note: 'Duplicate signup, closing.', adminEmail: 'admin@hitloop.agency' });

  const dash = (await fakeCtx.adminDb.collection('dashboard_state').doc('client-f').get()).data();
  assert.equal(dash.errorState.status, 'resolved');
  assert.equal(dash.errorState.resolvedBy, 'admin@hitloop.agency');
  assert.ok(dash.errorState.resolvedAt);
  // Everything else must survive the merge untouched — this is the exact
  // shallow-merge regression class caught in Phase 2's notification write.
  assert.equal(dash.errorState.kind, 'dashboard_creation_failed');
  assert.equal(dash.errorState.incidentId, 'client-f-signup');
  assert.equal(dash.errorState.publicCode, 'HIT-ABC123');
  assert.equal(dash.errorState.publicStage, 'website_access');
  assert.equal(dash.errorState.notification.status, 'sent');
});

test('resolveIncident: restores client.status to active without rewriting failed run history', async () => {
  await seedIncident('client-g');
  await incidents.resolveIncident({ clientId: 'client-g', incidentId: 'client-g-signup', note: null, adminEmail: 'admin@hitloop.agency' });
  const client = (await fakeCtx.adminDb.collection('clients').doc('client-g').get()).data();
  assert.equal(client.status, 'active');
  const run = (await fakeCtx.adminDb.collection('brief_runs').doc('client-g-signup').get()).data();
  assert.equal(run.status, 'failed');
});

test('resolveIncident: appends a "manual" audit event with the note', async () => {
  await seedIncident('client-h');
  await incidents.resolveIncident({ clientId: 'client-h', incidentId: 'client-h-signup', note: 'Fixed manually, no retry needed.', adminEmail: 'admin@hitloop.agency' });
  const events = await fakeCtx.adminDb.collection('dashboard_failure_incidents').doc('client-h-signup').collection('events').get();
  assert.equal(events.docs.length, 1);
  const audit = events.docs[0].data();
  assert.equal(audit.resolution, 'manual');
  assert.equal(audit.note, 'Fixed manually, no retry needed.');
  assert.equal(audit.resolvedBy, 'admin@hitloop.agency');
});

test('audit history appends a manual resolution after a requeue instead of overwriting it', async () => {
  await seedIncident('client-history');
  const requeue = async (runId) => ({ ok: true, runId, clientId: 'client-history', status: 'queued' });
  await incidents.requeueIncident(
    { clientId: 'client-history', runId: 'client-history-signup', adminEmail: 'first@hitloop.agency' },
    { requeueRunFn: requeue }
  );
  // Re-open the same incident to simulate a requeued primary run failing again.
  await fakeCtx.adminDb.collection('dashboard_state').doc('client-history').set({
    errorState: { ...OPEN_ERROR_STATE, incidentId: 'client-history-signup', runId: 'client-history-signup' },
  }, { merge: true });
  await incidents.resolveIncident({ clientId: 'client-history', incidentId: 'client-history-signup', note: 'Repaired externally.', adminEmail: 'second@hitloop.agency' });

  const events = await fakeCtx.adminDb.collection('dashboard_failure_incidents').doc('client-history-signup').collection('events').get();
  assert.deepEqual(events.docs.map((doc) => doc.data().resolution).sort(), ['manual', 'requeued']);
});

test('resolveIncident: rejects with a 404 status when the incident is already resolved', async () => {
  await seedIncident('client-i', { status: 'resolved' });
  await assert.rejects(
    () => incidents.resolveIncident({ clientId: 'client-i', incidentId: 'client-i-signup', note: null, adminEmail: 'admin@hitloop.agency' }),
    (err) => { assert.equal(err.status, 404); return true; }
  );
});

test('resolveIncident: rejects when the incidentId does not match the client\'s current incident (stale admin view)', async () => {
  await seedIncident('client-j');
  await assert.rejects(
    () => incidents.resolveIncident({ clientId: 'client-j', incidentId: 'some-other-run-id', note: null, adminEmail: 'admin@hitloop.agency' }),
    (err) => { assert.equal(err.status, 404); return true; }
  );
});

test('resolveIncident: rejects when the client has no incident at all', async () => {
  await fakeCtx.adminDb.collection('dashboard_state').doc('client-k').set({ clientId: 'client-k' });
  await assert.rejects(
    () => incidents.resolveIncident({ clientId: 'client-k', incidentId: 'client-k-signup', note: null, adminEmail: 'admin@hitloop.agency' }),
    (err) => { assert.equal(err.status, 404); return true; }
  );
});
