import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');
const { runScoutTest } = require('../../../../features/scout-intake/scout-test');

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

const ALLOWED_PLATFORMS = new Set(['web', 'x', 'reddit', 'instagram']);

/**
 * POST /api/dashboard/scout-test  { platform: 'web' | 'x' | 'reddit' | 'instagram' }
 *
 * Runs a single source's live search for the signed-in user's client and
 * returns sample results — WITHOUT running the full brief pipeline. Successful
 * results are persisted as latest source-test evidence so downstream analyzers
 * can use the same proven data the operator just saw.
 */
export async function POST(request) {
  let decoded;
  try {
    decoded = await verifyRequestUser(makeReqShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unauthorized.' }, 401);
  }

  let context;
  try {
    context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  } catch (err) {
    return json({ error: err.message || 'Forbidden.' }, err.status || 403);
  }
  if (!context.userProfile) return json({ error: 'No user record.' }, 404);
  const clientId = context.clientId || null;
  if (!clientId) return json({ error: 'No clientId on user record.' }, 404);

  let body = {};
  try { body = await request.json(); } catch { /* empty body */ }
  const platform = String(body.platform || '').toLowerCase();
  if (!ALLOWED_PLATFORMS.has(platform)) {
    return json({ error: `Unsupported platform "${platform}". Use web, x, reddit, or instagram.` }, 400);
  }

  const configSnap = await fb.adminDb.collection('client_configs').doc(clientId).get();
  const clientConfig = configSnap.exists ? (configSnap.data() || {}) : {};

  try {
    const result = await runScoutTest({ clientId, platform, clientConfig });
    if (result?.ok) {
      // Firestore rejects `undefined` and `.set()` validates SYNCHRONOUSLY (so a
      // trailing `.catch` would NOT catch it — it would 500 the whole test). Strip
      // undefined via a JSON round-trip and wrap in a real try/catch so a persist
      // hiccup can never break the test response. `updatedAt` stays outside the
      // round-trip to preserve the serverTimestamp sentinel.
      try {
        const entry = JSON.parse(JSON.stringify({
          items: Array.isArray(result.items) ? result.items.slice(0, 20) : [],
          count: Number.isFinite(result.count) ? result.count : (Array.isArray(result.items) ? result.items.length : 0),
          costUsd: Number.isFinite(result.costUsd) ? result.costUsd : 0,
          ms: Number.isFinite(result.ms) ? result.ms : null,
          meta: result.meta || null,
          generatedAt: new Date().toISOString(),
        }));
        await fb.adminDb.collection('dashboard_state').doc(clientId).set({
          marketingBrief: { reportSnapshot: { platformTests: { [platform]: entry } } },
          updatedAt: fb.FieldValue.serverTimestamp(),
        }, { merge: true });
      } catch (persistErr) {
        console.warn('[scout-test] platformTests persist skipped:', persistErr?.message || persistErr);
      }
    }
    return json(result); // 200 even on empty/ok:false so the UI can show the message
  } catch (err) {
    return json({ ok: false, platform, items: [], count: 0, error: err.message || 'Test search failed.' }, 500);
  }
}
