import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getDashboardBootstrap } = require('../../../../api/_lib/client-provisioning.cjs');
const { renderBriefHtml } = require('../../../../features/scout-intake/brief-renderer');

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function htmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'content-type':  'text/html; charset=utf-8',
      // Prevent browser / Next.js from serving a stale render after a new
      // pipeline run completes.
      'cache-control': 'no-store, max-age=0',
      'pragma':        'no-cache',
    },
  });
}

function errorPage(status, message) {
  return htmlResponse(
    `<!doctype html><meta charset="utf-8"><title>${message}</title><pre style="font:14px/1.5 system-ui;padding:24px;">${message}</pre>`,
    status
  );
}

/**
 * GET /api/dashboard/brief-preview
 *
 * Reads bootstrap (dashboard_state + intelligence) and re-renders through
 * the live brief-renderer.js. Lets you preview the current design against
 * the last run without re-running the pipeline.
 */
export async function GET(request) {
  let decoded;
  try {
    decoded = await verifyRequestUser(makeReqShim(request));
  } catch (err) {
    return errorPage(401, err instanceof Error ? err.message : 'Unauthorized.');
  }

  const bootstrap = await getDashboardBootstrap(decoded.uid);
  const clientId = bootstrap?.userProfile?.clientId || null;
  const dash = bootstrap?.dashboardState || null;
  if (!clientId) return errorPage(404, 'No client record for user.');
  if (!dash) return errorPage(404, 'No dashboard_state for client — run the pipeline first.');

  // Optional run-level detail (warnings, cost) from the latest brief_run.
  let runCostData = null;
  let runWarnings = 0;
  let runStyleGuideCost = null;
  let runScribeCost = null;
  if (dash.latestRunId) {
    try {
      const briefSnap = await fb.adminDb
        .collection('clients').doc(clientId)
        .collection('brief_runs').doc(dash.latestRunId)
        .get();
      if (briefSnap.exists) {
        const brun = briefSnap.data() || {};
        runCostData = brun.summary?.runCostData || null;
        runWarnings = Array.isArray(brun.warnings) ? brun.warnings.length : 0;
        runStyleGuideCost = brun.styleGuideCost || null;
        runScribeCost = brun.scribe?.cost || null;
      }
    } catch { /* non-fatal */ }
  }

  const scribe = dash.scribe || null;
  if (!scribe || !scribe.brief) {
    return errorPage(
      404,
      'This run has no scribe output yet — re-run the pipeline after the Scribe stage was added.'
    );
  }

  const snapshot = dash.snapshot || null;
  const mockupUrl = dash.artifacts?.homepageDeviceMockup?.downloadUrl
    || dash.artifacts?.homepageScreenshot?.downloadUrl
    || null;

  const seoAudit = bootstrap?.intelligence?.dashboardSeoAudit ?? dash.seoAudit ?? null;
  const psiSummary = bootstrap?.intelligence?.psiSummary || null;

  const html = renderBriefHtml({
    brief:           scribe.brief,
    scribeCards:     scribe.cards || {},
    snapshot,
    signals:         dash.signals || null,
    strategy:        dash.strategy || null,
    outputsPreview:  dash.outputsPreview || null,
    siteMeta:        dash.siteMeta || null,
    styleGuide:      snapshot?.visualIdentity?.styleGuide || null,
    pagespeed:       seoAudit,
    psiSummary,
    mockupUrl,
    userContext:     null,
    runMeta: {
      pagesFetched: null,
      pageTypes:    [],
      thin:         null,
      warningCount: runWarnings,
      costs: {
        synth:      runCostData?.estimatedCostUsd ?? null,
        styleGuide: runStyleGuideCost?.estimatedCostUsd ?? null,
        scribe:     runScribeCost?.estimatedCostUsd ?? null,
      },
    },
    websiteUrl:  bootstrap?.client?.websiteUrl || null,
    clientId,
    userEmail:   bootstrap?.userProfile?.email || decoded?.email || null,
    generatedAt: new Date().toISOString(),
    tier:        dash.tier || 'free',
  });

  return htmlResponse(html);
}
