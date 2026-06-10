import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../../api/_lib/client-provisioning.cjs');

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
    await fb.adminDb.collection('dashboard_state').doc(context.clientId).set(
      { snapshot: { brandOverview } },
      { merge: true }
    );
  } catch (err) {
    return json({ error: `Firestore error: ${err.message}` }, 500);
  }

  return json({ ok: true, brandOverview });
}
