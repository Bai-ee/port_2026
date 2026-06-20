import { after, NextResponse } from 'next/server';
import { createRequire } from 'module';

export const maxDuration = 300;

const require = createRequire(import.meta.url);
const fb = require('../../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../../api/_lib/client-provisioning.cjs');
const { FALLBACK_BRIEF_SITE } = require('../../../../../api/_lib/brief-fallback.cjs');

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

async function resolveContext(request) {
  const decoded = await verifyRequestUser(makeReqShim(request));
  const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  if (!context.userProfile) { const e = new Error('No user record.'); e.status = 404; throw e; }
  if (!context.clientId) { const e = new Error('No clientId on user record.'); e.status = 404; throw e; }
  return { decoded, context };
}

// Run the NARROW Creative Brief: a free-tier-intake run (trigger 'creative-brief')
// that the worker scopes to the deliverable assets only — multi-device-view +
// social-preview + the studio video render + the onboarding summary. It skips
// SEO / agent-readiness / design-eval, brand/scout synthesis, and the scout-brief
// market-intel chain (see app/api/worker/run-brief/route.js).
export async function POST(request) {
  let decoded, context;
  try {
    ({ decoded, context } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  const configSnap = await fb.adminDb.collection('client_configs').doc(context.clientId).get();
  const clientConfig = configSnap.exists ? (configSnap.data() || {}) : {};

  // Legacy clients without a module config: seed the default set so the worker's
  // modular branch runs.
  if (!clientConfig.moduleConfig) {
    const { getDefaultModuleConfig } = require('../../../../../features/scout-intake/module-registry');
    await fb.adminDb.collection('client_configs').doc(context.clientId).set(
      { moduleConfig: getDefaultModuleConfig(), updatedAt: fb.FieldValue.serverTimestamp() },
      { merge: true }
    );
  }

  // Own site → render it; website-less clients fall back to the templated site
  // so they still get a Creative Brief (assets only; brand data untouched).
  const ownSiteUrl = clientConfig?.sourceInputs?.websiteUrl || clientConfig?.websiteUrl || null;
  const sourceUrl = ownSiteUrl || FALLBACK_BRIEF_SITE;

  const runRef = fb.adminDb.collection('brief_runs').doc();
  const runId = runRef.id;
  const queuedAt = fb.FieldValue.serverTimestamp();
  const payload = {
    runId,
    id: runId,
    clientId: context.clientId,
    requestedByUid: decoded.uid,
    trigger: 'creative-brief',
    source: 'user',
    status: 'queued',
    pipelineType: 'free-tier-intake',
    usesFallbackSite: !ownSiteUrl,
    attempts: 0,
    workerLease: null,
    startedAt: null,
    completedAt: null,
    error: null,
    summary: null,
    artifactRefs: [],
    providerUsage: null,
    moduleSnapshot: null,
    sourceUrl,
    createdAt: queuedAt,
    updatedAt: queuedAt,
  };

  await Promise.all([
    runRef.set(payload),
    fb.adminDb.collection('clients').doc(context.clientId).collection('brief_runs').doc(runId).set(payload),
    fb.adminDb.collection('clients').doc(context.clientId).set(
      { latestRunId: runId, latestRunStatus: 'queued', updatedAt: queuedAt },
      { merge: true }
    ),
    fb.adminDb.collection('dashboard_state').doc(context.clientId).set(
      {
        latestRunId: runId,
        latestRunStatus: 'queued',
        modules: {
          'marketing-brief': { enabled: true, status: 'queued', lastRunId: runId },
        },
        updatedAt: queuedAt,
        errorState: null,
      },
      { merge: true }
    ),
  ]);

  const proto = request.headers.get('x-forwarded-proto') || 'http';
  const host = request.headers.get('host') || 'localhost:3000';
  const workerUrl = `${proto}://${host}/api/worker/run-brief`;
  after(async () => {
    try {
      const response = await fetch(workerUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-worker-secret': process.env.WORKER_SECRET || '' },
        body: JSON.stringify({ runId }),
        cache: 'no-store',
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        console.error(`[CREATIVE-BRIEF] worker trigger failed for ${context.clientId}: ${response.status} ${detail.trim()}`);
      }
    } catch (err) {
      console.warn(`[CREATIVE-BRIEF] worker trigger threw for ${context.clientId}: ${err?.message}`);
    }
  });

  return json({ ok: true, runId, queued: true });
}
