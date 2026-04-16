import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');
const { getDashboardBootstrap } = require('../../../../api/_lib/client-provisioning.cjs');

// Admin · Recent brief_runs for the signed-in admin's client.
//
// Returns the last N runs trimmed to the fields useful for triage:
//   runId, status, attempts, trigger, sourceUrl, startedAt, completedAt,
//   error, warnings (grouped by stage + full list)
//
// Reads from clients/{clientId}/brief_runs (the per-client mirror) ordered
// by createdAt desc. Admin-gated.

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function deepSerialize(v) {
  if (v == null) return v;
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (typeof v === 'object' && typeof v._seconds === 'number') {
    return new Date(v._seconds * 1000 + Math.floor((v._nanoseconds || 0) / 1e6)).toISOString();
  }
  if (Array.isArray(v)) return v.map(deepSerialize);
  if (typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = deepSerialize(val);
    return out;
  }
  return v;
}

function groupWarnings(warnings) {
  const byStage = {};
  const list = Array.isArray(warnings) ? warnings : [];
  for (const w of list) {
    const stage = w?.stage || 'unknown';
    (byStage[stage] = byStage[stage] || []).push(w);
  }
  return { count: list.length, byStage };
}

export async function GET(request) {
  let decoded;
  try {
    decoded = await verifyAdminRequest(makeReqShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unauthorized.' }, 401);
  }

  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '5', 10), 1), 20);

  let clientId = null;
  try {
    const bootstrap = await getDashboardBootstrap(decoded.uid);
    clientId = bootstrap?.userProfile?.clientId || null;
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Bootstrap failed.' }, 500);
  }

  if (!clientId) return json({ clientId: null, runs: [] });

  let snap;
  try {
    snap = await fb.adminDb
      .collection('clients').doc(clientId)
      .collection('brief_runs')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
  } catch (err) {
    return json({ error: `Firestore query failed: ${err.message}` }, 500);
  }

  const runs = snap.docs.map((doc) => {
    const d = doc.data() || {};
    return {
      runId:         d.runId || d.id || doc.id,
      status:        d.status || null,
      attempts:      typeof d.attempts === 'number' ? d.attempts : null,
      trigger:       d.trigger || null,
      sourceUrl:     d.sourceUrl || null,
      createdAt:     d.createdAt || null,
      startedAt:     d.startedAt || null,
      completedAt:   d.completedAt || null,
      pipelineType:  d.pipelineType || null,
      error:         d.error || null,
      warningCount:  Array.isArray(d.warnings) ? d.warnings.length : 0,
      warnings:      groupWarnings(d.warnings),
      hasSummary:    Boolean(d.summary),
      artifactCount: Array.isArray(d.artifactRefs) ? d.artifactRefs.length : 0,
    };
  });

  return json(deepSerialize({ clientId, limit, runs }));
}
