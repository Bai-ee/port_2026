'use strict';

// dashboard-failure-incidents.cjs — admin-only read/resolve surface for open
// dashboard-creation-failure incidents (Phase 6, docs/plans/
// DASHBOARD_CREATION_FAILURE_UX_CLAUDE_PLAN.md). The route
// (app/api/admin/dashboard-failures/route.js) is a thin wrapper: auth-check,
// parse the body, call one of these, shape the response — the actual
// Firestore logic lives here so it's unit-testable, matching this repo's
// convention (api/_lib/*.cjs tested; route handlers thin and untested).
//
// Both admin actions clear bootstrap.creationFailure for the client — the
// sole thing DashboardCreationFailedModal gates on:
//   - requeueIncident: reuses run-lifecycle.cjs's existing requeueRun() —
//     flips the run back to 'queued', clears errorState/client.status.
//     Kicking the worker so the client sees the terminal go 'running'
//     promptly (rather than waiting on the cron backstop) is the CALLER's
//     job (client-side, mirroring AdminPage.jsx's existing handleRunNow) —
//     a server-side self-fetch to /api/worker/run-brief would need the
//     digest-self-origin.cjs SSO-bypass treatment; a plain browser fetch
//     from an already-authenticated admin session does not.
//   - resolveIncident: marks the SAME errorState 'resolved' with
//     resolvedAt/resolvedBy and restores the client to active status without
//     changing the failed run's history.
//
// Both append a durable audit event (with an optional note for a manual
// resolve) below dashboard_failure_incidents/{incidentId}/events. The parent
// document is a latest-state summary only; events are never overwritten. This
// collection is deliberately never part of the client-facing allow-list
// (api/_lib/client-provisioning.cjs buildCreationFailureProjection).

const fb = require('./firebase-admin.cjs');
const { requeueRun } = require('./run-lifecycle.cjs');

// --- test seam (mirrors run-lifecycle.cjs's failRun seam) -------------------
let _testCtx = null;
function __setTestContext(ctx) { _testCtx = ctx; }
function ctx() { return _testCtx || fb; }

async function listOpenIncidents() {
  const store = ctx();
  // A single dot-path equality filter on a nested map field — well-defined,
  // automatically indexed by Firestore, no composite index needed (unlike
  // combining it with a second filter or an orderBy on a different field).
  // The `kind` check is done in JS just below rather than as a second
  // `.where()`, since this codebase has no existing precedent confirming two
  // chained dot-path equality filters behave the same way in production
  // (a single-field dot-path filter does, per social-approval.cjs's
  // `.where('clientId','==',x).where('redeemedAt','==',null)` precedent for
  // the "no composite index needed for pure-equality filters" half of this).
  const snapshot = await store.adminDb
    .collection('dashboard_state')
    .where('errorState.status', '==', 'open')
    .get();

  const openDocs = snapshot.docs.filter((doc) => doc.data()?.errorState?.kind === 'dashboard_creation_failed');

  const incidents = await Promise.all(openDocs.map(async (doc) => {
    const clientId = doc.id;
    const errorState = doc.data()?.errorState || {};
    const [clientSnap, runSnap] = await Promise.all([
      store.adminDb.collection('clients').doc(clientId).get(),
      errorState.runId ? store.adminDb.collection('brief_runs').doc(errorState.runId).get() : Promise.resolve(null),
    ]);
    const clientData = clientSnap.exists ? clientSnap.data() : {};
    const runData = runSnap?.exists ? runSnap.data() : {};
    return {
      clientId,
      companyName: clientData.companyName || null,
      websiteUrl: clientData.websiteUrl || null,
      ownerEmail: clientData.ownerEmail || null,
      incidentId: errorState.incidentId || null,
      runId: errorState.runId || null,
      publicCode: errorState.publicCode || null,
      publicStage: errorState.publicStage || null,
      publicMessage: errorState.publicMessage || null,
      failedAt: errorState.failedAt || null,
      notification: errorState.notification || null,
      // Admin-only diagnostic — read live from brief_runs, never persisted
      // onto the client-facing errorState and never sent through bootstrap.
      internalError: runData.error || null,
      attempts: runData.attempts ?? null,
    };
  }));

  incidents.sort((a, b) => new Date(b.failedAt || 0) - new Date(a.failedAt || 0));
  return incidents;
}

// Best-effort audit trail — must never block or fail the resolution action
// itself, which has already committed to Firestore by the time this runs.
async function writeAuditRecord({ incident, resolution, adminEmail, note, resolvedAt }) {
  const store = ctx();
  try {
    const incidentRef = store.adminDb.collection('dashboard_failure_incidents').doc(incident.incidentId || incident.runId);
    const auditEvent = {
      incidentId: incident.incidentId || null,
      runId: incident.runId || null,
      clientId: incident.clientId,
      publicCode: incident.publicCode || null,
      publicStage: incident.publicStage || null,
      resolution,
      resolvedAt,
      resolvedBy: adminEmail,
      note: note || null,
      createdAt: store.FieldValue.serverTimestamp(),
    };
    // Keep a convenient latest-state summary while preserving the complete
    // operator history as append-only event documents.
    await Promise.all([
      incidentRef.set({
        incidentId: auditEvent.incidentId,
        runId: auditEvent.runId,
        clientId: auditEvent.clientId,
        publicCode: auditEvent.publicCode,
        publicStage: auditEvent.publicStage,
        latestResolution: resolution,
        latestResolvedAt: resolvedAt,
        latestResolvedBy: adminEmail,
        latestNote: note || null,
        updatedAt: store.FieldValue.serverTimestamp(),
      }, { merge: true }),
      incidentRef.collection('events').add(auditEvent),
    ]);
  } catch (err) {
    console.warn('[dashboard-failure-incidents] audit write failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * @param {{clientId:string, runId:string, adminEmail:string}} args
 * @param {{requeueRunFn?:Function}} [opts] - test injection point for requeueRun
 */
async function requeueIncident({ clientId, runId, adminEmail }, opts = {}) {
  const requeueRunFn = opts.requeueRunFn || requeueRun;
  const store = ctx();
  // Snapshot BEFORE requeueRun clears errorState, so the audit record still
  // has the incident's identifying fields.
  const stateSnap = await store.adminDb.collection('dashboard_state').doc(clientId).get();
  const errorState = stateSnap.exists ? stateSnap.data()?.errorState : null;
  const result = await requeueRunFn(String(runId));
  const resolvedAt = new Date().toISOString();
  await writeAuditRecord({
    incident: {
      incidentId: errorState?.incidentId || runId,
      runId,
      clientId,
      publicCode: errorState?.publicCode,
      publicStage: errorState?.publicStage,
    },
    resolution: 'requeued',
    adminEmail,
    note: null,
    resolvedAt,
  });
  return result;
}

async function resolveIncident({ clientId, incidentId, note, adminEmail }) {
  const store = ctx();
  const stateRef = store.adminDb.collection('dashboard_state').doc(clientId);
  const stateSnap = await stateRef.get();
  const errorState = stateSnap.exists ? stateSnap.data()?.errorState : null;
  // Re-check status==='open' here rather than trusting the caller's stale
  // list view — a second admin tab, or a client retry landing in between,
  // may have already moved this incident on.
  if (!errorState || errorState.incidentId !== incidentId || errorState.status !== 'open') {
    const err = new Error('Incident not found or already resolved.');
    err.status = 404;
    throw err;
  }
  const resolvedAt = new Date().toISOString();
  // Full errorState object with only status/resolvedAt/resolvedBy
  // overridden — Firestore's merge:true is shallow at the top level, so
  // writing a bare {errorState:{status:...}} would replace the whole map and
  // drop kind/incidentId/publicCode/etc (same class of bug caught in Phase
  // 2's notification write — see run-lifecycle.cjs's notifyHardFailure).
  await Promise.all([
    stateRef.set({
      errorState: { ...errorState, status: 'resolved', resolvedAt, resolvedBy: adminEmail },
    }, { merge: true }),
    // A manual resolution means the incident was repaired outside this failed
    // run. Keep the run history failed, but return the client record to the
    // same usable active state as a requeue ultimately does.
    store.adminDb.collection('clients').doc(clientId).set({
      status: 'active',
      updatedAt: store.FieldValue.serverTimestamp(),
    }, { merge: true }),
  ]);
  await writeAuditRecord({
    incident: { incidentId, runId: errorState.runId, clientId, publicCode: errorState.publicCode, publicStage: errorState.publicStage },
    resolution: 'manual',
    adminEmail,
    note,
    resolvedAt,
  });
  return { resolvedAt };
}

module.exports = {
  listOpenIncidents,
  requeueIncident,
  resolveIncident,
  __setTestContext,
};
