import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../../api/_lib/client-provisioning.cjs');

// Web Stats card config (Website Developer bucket). Owns the analytics settings
// the daily-digest email reads: which GA4 property to pull, which event names
// land in "Key Events", and whether the homepage-interactions block is included.
// Stored at client_configs/{clientId}.webStatsConfig. Empty values mean "use the
// digest route's env/default" so behavior is unchanged until a user sets them.
// See docs/source-of-truth/EMAIL-DIGEST-CARD.md (P2a).

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

// Accepts a string (newline / comma separated) or an array of event names.
function normalizeEventNames(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[\n,]+/);
  return [...new Set(
    raw.map((item) => String(item || '').trim().slice(0, 60)).filter(Boolean)
  )].slice(0, 40);
}

function normalizeWebStatsConfig(body) {
  return {
    // GA4 numeric property id ('' → digest uses GA4_PROPERTY_ID env default).
    ga4PropertyId: String(body?.ga4PropertyId || '').replace(/[^0-9]/g, '').slice(0, 20),
    // Event names for the "Key Events" section ([] → digest uses its default list).
    trackedEvents: normalizeEventNames(body?.trackedEvents),
    // Homepage-interactions block (clicks / scroll / web vitals). Default ON.
    homepageEnabled: body?.homepageEnabled !== false,
    updatedAtIso: new Date().toISOString(),
  };
}

async function resolveContext(request) {
  const decoded = await verifyRequestUser(makeReqShim(request));
  const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  if (!context.userProfile) {
    const err = new Error('No user record.');
    err.status = 404;
    throw err;
  }
  if (!context.clientId) {
    const err = new Error('No clientId on user record.');
    err.status = 404;
    throw err;
  }
  return { decoded, context };
}

export async function GET(request) {
  let context;
  try {
    ({ context } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  const snap = await fb.adminDb.collection('client_configs').doc(context.clientId).get();
  const data = snap.exists ? (snap.data() || {}) : {};
  return json({
    ok: true,
    clientId: context.clientId,
    config: data.webStatsConfig || null,
  });
}

export async function POST(request) {
  let context;
  try {
    ({ context } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const webStatsConfig = normalizeWebStatsConfig(body);

  await fb.adminDb.collection('client_configs').doc(context.clientId).set(
    { webStatsConfig, updatedAt: fb.FieldValue.serverTimestamp() },
    { merge: true }
  );

  return json({ ok: true, clientId: context.clientId, config: webStatsConfig });
}
