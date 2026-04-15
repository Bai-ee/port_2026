import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { fetchSiteEvidence } = require('../../../../features/scout-intake/site-fetcher');
const { ensureScoutConfig } = require('../../../../features/scout-intake/scout-config-generator');
const { buildUserContext } = require('../../../../features/scout-intake/user-context');

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

/**
 * POST /api/dashboard/scout-config-regenerate
 *
 * Force-regenerates the signed-in user's scoutConfig. Re-crawls the site so
 * the generator has fresh raw evidence, then runs ensureScoutConfig with
 * force:true to overwrite the cached doc.
 *
 * Cheaper than a full pipeline rerun (no synth / scribe / pdf), slower than
 * a pure read (one fetch + one Haiku call). Typical ~2-4s, ~$0.002.
 */
export async function POST(request) {
  let decoded;
  try {
    decoded = await verifyRequestUser(makeReqShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unauthorized.' }, 401);
  }

  const userSnap = await fb.adminDb.collection('users').doc(decoded.uid).get();
  if (!userSnap.exists) return json({ error: 'No user record.' }, 404);
  const clientId = userSnap.data()?.clientId || null;
  if (!clientId) return json({ error: 'No clientId on user record.' }, 404);

  const [clientSnap, clientConfigSnap, dashSnap] = await Promise.all([
    fb.adminDb.collection('clients').doc(clientId).get(),
    fb.adminDb.collection('client_configs').doc(clientId).get(),
    fb.adminDb.collection('dashboard_state').doc(clientId).get(),
  ]);

  const client = clientSnap.exists ? clientSnap.data() : null;
  const clientConfig = clientConfigSnap.exists ? clientConfigSnap.data() : null;
  const dash = dashSnap.exists ? dashSnap.data() : null;

  const websiteUrl = client?.websiteUrl || clientConfig?.sourceInputs?.websiteUrl || null;
  if (!websiteUrl) return json({ error: 'No websiteUrl on record for this client.' }, 400);

  // Re-crawl so the generator has fresh raw page evidence (h1 / body / meta).
  let evidence;
  try {
    evidence = await fetchSiteEvidence(websiteUrl);
  } catch (err) {
    return json({ error: `Site fetch failed: ${err.message}` }, 500);
  }

  // Build an intake-like object from dashboard_state + current URL so the
  // generator's prompt gets both synth output (when populated) AND raw
  // evidence (always populated if crawl worked).
  const intakeResult = {
    websiteUrl,
    snapshot:       dash?.snapshot || null,
    signals:        dash?.signals || null,
    strategy:       dash?.strategy || null,
    outputsPreview: dash?.outputsPreview || null,
    systemPreview:  dash?.systemPreview || null,
    siteMeta:       dash?.siteMeta || null,
  };

  const userContext = buildUserContext(clientConfig);

  const result = await ensureScoutConfig({
    clientId,
    clientName: client?.displayName || client?.companyName || null,
    intakeResult,
    userContext,
    evidence,
    websiteUrl,
    force: true,
  });

  if (result.error) return json({ error: result.error, scoutConfig: result.scoutConfig }, 500);

  return json({
    ok:          true,
    clientId,
    websiteUrl,
    cost:        result.cost,
    scoutConfig: result.scoutConfig,
  });
}
