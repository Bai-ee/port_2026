import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const fb = require('../../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../../api/_lib/client-provisioning.cjs');
const { checkRateLimit, getClientIp } = require('../../../../../api/_lib/rate-limit.cjs');
const { readClientBrainDoc } = require('../../../../../features/client-brain/store.cjs');
const { logUsage } = require('../../../../../api/_lib/usage-logger.cjs');
const { runProofBuilder } = require('../../../../../features/intelligence/analysis-recipes/run-proof-builder.js');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const RATE_LIMIT_WINDOW_SECONDS = 60 * 10;
const RATE_LIMIT_REQUESTS_PER_CLIENT = 20; // generous — iterative plan/finalize is expected UX

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

// Stable id for one opportunity — same input always hashes to the same id, so
// a re-run (e.g. after answering questions) overwrites the same stored plan
// rather than growing unbounded state.
function opportunityIdFor(opportunity) {
  const key = String(opportunity?.url || '').trim()
    || `${opportunity?.person || ''}|${opportunity?.currentTrigger || ''}`;
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

function arr(v, limit = 12) {
  return (Array.isArray(v) ? v : []).map((s) => String(s || '').trim()).filter(Boolean).slice(0, limit);
}

// Trimmed, structured proof context — NOT the shared loadClientBrainContext
// string helper, because that flattens to prose and drops testimonials/
// workHistory (features/client-brain/store.cjs buildUseForContext only
// surfaces proof.projects + proof.metrics). Proof Builder needs the discrete
// evidence items to reference by title, so it reads the structured brain
// directly and only uses it when approved (same gate loadClientBrainContext
// applies elsewhere: unapproved/absent -> no context, never invented).
async function loadProofClientContext(clientId) {
  if (!clientId) return null;
  let brain;
  try {
    brain = await readClientBrainDoc(clientId);
  } catch {
    return null;
  }
  if (!brain || brain.status !== 'approved') return null;

  const identity = brain.identity || {};
  const positioning = brain.positioning || {};
  const offers = brain.offers || {};
  const proof = brain.proof || {};
  const voice = brain.voice || {};

  return {
    identity: {
      name: identity.name || '',
      category: identity.category || '',
      description: identity.description || '',
    },
    positioning: {
      oneLiner: positioning.oneLiner || positioning.authorityPosition || '',
      differentiation: arr(positioning.differentiation),
      valueProps: arr(positioning.valueProps),
    },
    offers: {
      services: arr(offers.services),
      callsToAction: arr(offers.callsToAction),
    },
    proof: {
      projects: arr(proof.projects, 20),
      metrics: arr(proof.metrics, 20),
      testimonials: arr(proof.testimonials, 20),
      workHistory: arr(proof.workHistory, 20),
    },
    voiceTone: voice.toneSummary || '',
  };
}

/**
 * POST /api/dashboard/opportunity-signals/proof-builder
 *
 * The evidence-before-response layer for a single selected Opportunity
 * Signals item. Never drafts a reply/post/email — only decides what proof
 * the client has (or needs) before any response could be marked ready.
 * See docs/plans/OPPORTUNITY-SIGNALS-PROOF-BUILDER-PLAN.md.
 */
export async function POST(request) {
  let clientId;
  try {
    const decoded = await verifyRequestUser(makeReqShim(request));
    const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
    if (!context.userProfile) return json({ error: 'No user record.' }, 404);
    clientId = context.clientId || null;
    if (!clientId) return json({ error: 'No clientId on user record.' }, 404);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unauthorized.' }, err?.status || 401);
  }

  const ip = getClientIp(request);
  const rl = await checkRateLimit({
    key: `dashboard:${clientId}:proof-builder:${ip}`,
    limit: RATE_LIMIT_REQUESTS_PER_CLIENT,
    windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
  });
  if (!rl.allowed) return json({ error: 'Too many Proof Builder runs. Try again later.' }, 429);

  let body = {};
  try { body = await request.json(); } catch { /* empty */ }
  const opportunity = body?.opportunity && typeof body.opportunity === 'object' ? body.opportunity : null;
  if (!opportunity) return json({ error: 'No opportunity supplied.' }, 400);
  const sourceItem = body?.sourceItem && typeof body.sourceItem === 'object' ? body.sourceItem : null;
  const answers = body?.answers && typeof body.answers === 'object' ? body.answers : {};
  const mode = body?.mode === 'finalize' ? 'finalize' : 'plan';

  const opportunityId = opportunityIdFor(opportunity);
  const clientContext = await loadProofClientContext(clientId);

  const content = { opportunity, sourceItem, clientContext, answers, mode };
  const result = await runProofBuilder({ content, opportunityId });

  if (result.costUsd) {
    await logUsage({
      module: 'market-insights',
      action: 'proof-builder',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      costUsd: result.costUsd,
      clientId,
      metadata: { opportunityId, mode, hasClientContext: Boolean(clientContext) },
    }).catch(() => {});
  }

  if (!result.ok) return json({ ok: false, error: result.error || 'Proof Builder failed.' }, 502);

  const generatedAt = new Date().toISOString();
  try {
    await fb.adminDb.collection('dashboard_state').doc(clientId).set(
      {
        marketingBrief: {
          latestProofBuilder: { opportunityId, proofPlan: result.proofPlan, generatedAt },
        },
        updatedAt: fb.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch { /* non-fatal — the client still gets the plan back */ }

  return json({ ok: true, proofPlan: result.proofPlan, generatedAt });
}
