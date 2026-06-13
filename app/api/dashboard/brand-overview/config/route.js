import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../../api/_lib/client-provisioning.cjs');
const { applyPositioningBridge } = require('../../../../../features/scout-intake/brand-positioning-bridge');

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

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// Persists user-edited brand overview fields into snapshot.brandOverview. These
// feed the brief context + generated search plan; critical to fill manually when
// there is no website to crawl.
export async function POST(request) {
  let context;
  try {
    ({ context } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }

  // Only write fields actually provided, so a partial save doesn't wipe others.
  const map = {
    businessModel: 600, positioning: 600, targetAudience: 600,
    headline: 200, summary: 1000, industry: 100,
  };
  const brandOverview = {};
  for (const [k, max] of Object.entries(map)) {
    if (k in (body || {})) brandOverview[k] = clean(body[k], max);
  }
  brandOverview.source = 'user';
  brandOverview.updatedAtIso = new Date().toISOString();

  try {
    // Use dot-notation update to avoid Firestore shallow-merge replacing the
    // entire snapshot map and wiping unrelated sub-fields (e.g. visualIdentity).
    await fb.adminDb.collection('dashboard_state').doc(context.clientId).update({
      'snapshot.brandOverview': brandOverview,
    });
  } catch (err) {
    return json({ error: `Firestore error: ${err.message}` }, 500);
  }

  // Mirror to client_configs — the brief pipeline reads brandOverview from
  // clientConfig.snapshot.brandOverview to build the knowledge-base query
  // (runtime.js), so user edits must land there too. Best-effort.
  try {
    const cfgRef = fb.adminDb.collection('client_configs').doc(context.clientId);
    try {
      await cfgRef.update({ 'snapshot.brandOverview': brandOverview });
    } catch {
      await cfgRef.set({ snapshot: { brandOverview } }, { merge: true });
    }
  } catch { /* non-fatal — bridge + dashboard write already succeeded */ }

  // Fire-and-forget: derive sub-layer search terms from positioning and write
  // to scoutConfig.positioningContext so the next brief run gets better queries.
  applyPositioningBridge(context.clientId, brandOverview).catch(() => {});

  return json({ ok: true, brandOverview });
}
