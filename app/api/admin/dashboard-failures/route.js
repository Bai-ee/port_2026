import { NextResponse } from 'next/server';
import { createRequire } from 'module';

// Admin-only surface for open dashboard-creation-failure incidents (Phase 6,
// docs/plans/DASHBOARD_CREATION_FAILURE_UX_CLAUDE_PLAN.md). Thin wrapper —
// the actual Firestore logic (list/requeue/resolve, audit trail) lives in
// api/_lib/dashboard-failure-incidents.cjs, which has its own unit tests.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);
const { buildAuthRequestShim, verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');
const { listOpenIncidents, requeueIncident, resolveIncident } = require('../../../../api/_lib/dashboard-failure-incidents.cjs');

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(request) {
  try {
    await verifyAdminRequest(buildAuthRequestShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unauthorized.' }, 401);
  }
  try {
    const incidents = await listOpenIncidents();
    return json({ incidents });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Failed to load incidents.' }, 500);
  }
}

export async function POST(request) {
  let decoded;
  try {
    decoded = await verifyAdminRequest(buildAuthRequestShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Forbidden.' }, 403);
  }
  const adminEmail = decoded.email;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const { action, clientId } = body || {};
  if (!clientId) return json({ error: 'clientId is required.' }, 400);

  if (action === 'requeue') {
    const runId = body.runId;
    if (!runId) return json({ error: 'runId is required.' }, 400);
    try {
      const result = await requeueIncident({ clientId, runId, adminEmail });
      return json({ ok: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes('not found') ? 404 : 409;
      return json({ error: message }, status);
    }
  }

  if (action === 'resolve') {
    const { incidentId, note } = body;
    if (!incidentId) return json({ error: 'incidentId is required.' }, 400);
    try {
      const result = await resolveIncident({ clientId, incidentId, note, adminEmail });
      return json({ ok: true, ...result });
    } catch (err) {
      const status = err?.status || 500;
      return json({ error: err instanceof Error ? err.message : 'Failed to resolve incident.' }, status);
    }
  }

  return json({ error: `Unknown action: ${action}` }, 400);
}
