import { NextResponse } from 'next/server';
import { createRequire } from 'module';

// Runs 4 analysis modules in parallel against a prospect's website.
// Multi-device screenshots (Browserless) + PageSpeed is the bottleneck — ~40s worst case.
export const maxDuration = 120;

const require = createRequire(import.meta.url);
const fb                    = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');

const { runMultiDeviceView }      = require('../../../../features/scout-intake/modules/multi-device-view');
const { runSeoPerformance }       = require('../../../../features/scout-intake/modules/seo-performance');
const { runAgentReadinessModule } = require('../../../../features/scout-intake/modules/agent-readiness');
const { runSocialPreview }        = require('../../../../features/scout-intake/modules/social-preview');

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function normalizeWebsiteUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try { return new URL(candidate).toString(); } catch { return null; }
}

// POST /api/leadgen/onboard
//   body: { placeId: string }
//   → runs 4 analysis modules against the prospect's website, persists results
export async function POST(request) {
  // Auth
  try {
    await verifyRequestUser(makeReqShim(request));
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  let body;
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const placeId = String(body?.placeId || '').trim();
  if (!placeId) {
    return NextResponse.json({ error: 'Provide placeId.' }, { status: 400 });
  }

  // Read prospect
  const prospectRef = fb.adminDb.collection('leadgen_prospects').doc(placeId);
  const snap = await prospectRef.get();
  if (!snap.exists) {
    return NextResponse.json({ error: `Prospect not found: ${placeId}` }, { status: 404 });
  }
  const prospect = snap.data();

  const websiteUrl = normalizeWebsiteUrl(prospect.website);
  if (!websiteUrl) {
    return NextResponse.json({ error: 'Prospect has no valid website URL.' }, { status: 400 });
  }

  const runId   = crypto.randomUUID();
  const clientId = `leadgen_${placeId}`;

  // Mark as onboarding immediately so the UI can show a loading state
  await prospectRef.update({
    stage: 'onboarding',
    onboardStartedAt: new Date().toISOString(),
  });

  // Run all 4 modules in parallel
  const [mdvResult, seoResult, arResult, spResult] = await Promise.all([
    runMultiDeviceView({ clientId, runId, websiteUrl, onProgress: null }).catch((err) => ({
      ok: false, cardId: 'multi-device-view', status: 'failed',
      errorCode: 'mdv_threw', errorMessage: err.message, warningCodes: [], artifacts: [],
    })),
    runSeoPerformance({ clientId, websiteUrl, onProgress: null }).catch((err) => ({
      ok: false, cardId: 'seo-performance', status: 'failed',
      errorCode: 'seo_threw', errorMessage: err.message, warningCodes: [], artifacts: [],
    })),
    runAgentReadinessModule({ websiteUrl, onProgress: null }).catch((err) => ({
      ok: false, cardId: 'agent-readiness', status: 'failed',
      errorCode: 'ar_threw', errorMessage: err.message, warningCodes: [], artifacts: [],
    })),
    runSocialPreview({ websiteUrl, onProgress: null }).catch((err) => ({
      ok: false, cardId: 'social-preview', status: 'failed',
      errorCode: 'sp_threw', errorMessage: err.message, warningCodes: [], artifacts: [],
    })),
  ]);

  // PSI scores live at result.pagespeed.scores — store just the scores to keep doc size small
  const psiScores = seoResult.result?.pagespeed?.scores || null;

  const onboard = {
    multiDeviceView: {
      status:     mdvResult.status,
      mockupUrl:  mdvResult.result?.mockupUrl  || null,
      desktopUrl: mdvResult.result?.desktopUrl || null,
      tabletUrl:  mdvResult.result?.tabletUrl  || null,
      mobileUrl:  mdvResult.result?.mobileUrl  || null,
      artifacts:  mdvResult.artifacts || [],
      warnings:   mdvResult.warningCodes || [],
    },
    seoPerformance: {
      status:    seoResult.status,
      pagespeed: psiScores,
      warnings:  seoResult.warningCodes || [],
    },
    agentReadiness: {
      status:      arResult.status,
      score:       arResult.result?.agentReadiness?.score   ?? null,
      verdict:     arResult.result?.agentReadiness?.verdict  || null,
      dimensions:  arResult.result?.agentReadiness?.dimensions || null,
      checks:      arResult.result?.agentReadiness?.checks    || [],
      findings:    arResult.result?.agentReadiness?.findings  || [],
      customFixes: arResult.result?.agentReadiness?.customFixes || {},
      warnings:    arResult.warningCodes || [],
    },
    socialPreview: {
      status:   spResult.status,
      siteMeta: spResult.result?.siteMeta || null,
      warnings: spResult.warningCodes || [],
    },
  };

  await prospectRef.update({
    stage:               'audited',
    onboardCompletedAt:  new Date().toISOString(),
    onboardRunId:        runId,
    onboard,
  });

  return NextResponse.json({ ok: true, placeId, runId, onboard });
}
