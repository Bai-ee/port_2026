import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');
const _bsPath = require.resolve('../../../../features/scout-intake/modules/brand-system.js');
function loadBrandSystem() {
  if (process.env.NODE_ENV !== 'production') delete require.cache[_bsPath];
  return require('../../../../features/scout-intake/modules/brand-system.js');
}

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

/**
 * GET /api/brand-system/scan
 *
 * Reads the signed-in user's dashboard_state, runs the brand-system mapper,
 * and returns { filled, gaps, completeness, homepageScreenshotUrl }.
 * No writes.
 */
export async function GET(request) {
  let decoded;
  try {
    decoded = await verifyRequestUser(makeReqShim(request));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unauthorized.' },
      { status: 401, headers: { 'cache-control': 'no-store' } }
    );
  }

  let context;
  try {
    context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Forbidden.' }, { status: err.status || 403, headers: { 'cache-control': 'no-store' } });
  }
  if (!context.userProfile) {
    return NextResponse.json({ error: 'No user record.' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  const clientId = context.clientId || null;
  if (!clientId) {
    return NextResponse.json({ error: 'No clientId on user record.' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }

  const [stateSnap, clientSnap] = await Promise.all([
    fb.adminDb.collection('dashboard_state').doc(clientId).get(),
    fb.adminDb.collection('clients').doc(clientId).get(),
  ]);

  const dashboardState = stateSnap.exists ? stateSnap.data() : {};
  const client = clientSnap.exists ? clientSnap.data() : null;

  const mapperInput = {
    snapshot:        dashboardState.snapshot        || {},
    analyzerOutputs: dashboardState.analyzerOutputs || {},
    siteMeta:        dashboardState.siteMeta        || {},
    userUploads:     dashboardState.userUploads     || {},
    artifacts:       dashboardState.artifacts       || {},
    client,
  };

  const { mapPipelineToBrandSystem, GAP_DEFS } = loadBrandSystem();
  const result = mapPipelineToBrandSystem(mapperInput);

  // Compact gap definitions — sent to client for history reconstruction on rerun.
  const allGapDefs = GAP_DEFS.map((g) => ({
    id:              g.id,
    phase:           g.phase,
    question:        g.label,
    type:            g.type,
    choices:         g.choices || null,
    hint:            g.hint   || null,
    showsScreenshot: g.showsScreenshot || false,
    required:        !!g.required,
    maxFiles:        g.maxFiles || null,
  }));

  // Surface homepage screenshot URL so Phase 1 UI can display it.
  // Artifacts store objects with a `downloadUrl` field — never the raw object.
  const art = dashboardState.artifacts || {};
  const homepageScreenshotUrl =
    art.homepageScreenshots?.desktop?.downloadUrl
    || art.fullPageScreenshots?.desktop?.downloadUrl
    || art.homepageScreenshot?.downloadUrl
    || art.homepageDeviceMockup?.downloadUrl
    || null;

  return NextResponse.json(
    {
      clientId,
      ...result,
      homepageScreenshotUrl,
      lastRun:          dashboardState.brandSystem || null,
      allGapDefs,
      previousUploads:  dashboardState.userUploads?.brandSystem || null,
    },
    { headers: { 'cache-control': 'no-store' } }
  );
}
