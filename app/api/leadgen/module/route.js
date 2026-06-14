import { createRequire } from 'module';

// Single-module runner with NDJSON progress streaming.
// Streams {"type":"progress",...} lines then {"type":"done",...} or {"type":"error",...}.
export const maxDuration = 60;

const require = createRequire(import.meta.url);
const fb                    = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');

const { runMultiDeviceView }        = require('../../../../features/scout-intake/modules/multi-device-view');
const { runSeoPerformance }         = require('../../../../features/scout-intake/modules/seo-performance');
const { runAgentReadinessModule }   = require('../../../../features/scout-intake/modules/agent-readiness');
const { runSocialPreview }          = require('../../../../features/scout-intake/modules/social-preview');
const { runDesignEvaluationModule } = require('../../../../features/scout-intake/modules/design-evaluation');

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

// Convert a raw module result into the shape stored in leadgen_prospects.onboard
function normalizeResult(moduleId, raw) {
  switch (moduleId) {
    case 'multi-device-view':
      return {
        status:     raw.status,
        mockupUrl:  raw.result?.mockupUrl  || null,
        desktopUrl: raw.result?.desktopUrl || null,
        tabletUrl:  raw.result?.tabletUrl  || null,
        mobileUrl:  raw.result?.mobileUrl  || null,
        artifacts:  raw.artifacts || [],
        warnings:   raw.warningCodes || [],
      };
    case 'seo-performance':
      return {
        status:    raw.status,
        pagespeed: raw.result?.pagespeed?.scores || null,
        warnings:  raw.warningCodes || [],
      };
    case 'agent-readiness':
      return {
        status:      raw.status,
        score:       raw.result?.agentReadiness?.score   ?? null,
        verdict:     raw.result?.agentReadiness?.verdict  || null,
        dimensions:  raw.result?.agentReadiness?.dimensions || null,
        checks:      raw.result?.agentReadiness?.checks    || [],
        findings:    raw.result?.agentReadiness?.findings  || [],
        customFixes: raw.result?.agentReadiness?.customFixes || {},
        warnings:    raw.warningCodes || [],
      };
    case 'social-preview':
      return {
        status:   raw.status,
        siteMeta: raw.result?.siteMeta || null,
        warnings: raw.warningCodes || [],
      };
    case 'design-evaluation':
      return {
        status:         raw.status,
        styleGuide:     raw.result?.styleGuide     || null,
        analyzerOutput: raw.result?.analyzerOutput || null,
        warnings:       raw.warningCodes || [],
      };
    default:
      return { status: raw.status, warnings: raw.warningCodes || [] };
  }
}

// Stage ordering — only advance, never regress
const STAGE_ORDER = ['discovered', 'scored', 'onboarding', 'auditing', 'audited', 'generating', 'ready', 'contacted'];
function stageIndex(s) { const i = STAGE_ORDER.indexOf(s); return i === -1 ? 0 : i; }

const STORE_KEY = {
  'multi-device-view':  'onboard.multiDeviceView',
  'seo-performance':    'onboard.seoPerformance',
  'agent-readiness':    'onboard.agentReadiness',
  'social-preview':     'onboard.socialPreview',
  'design-evaluation':  'onboard.designEvaluation',
};

const RUNNERS = {
  'multi-device-view':  (args) => runMultiDeviceView(args),
  'seo-performance':    (args) => runSeoPerformance({ clientId: args.clientId, websiteUrl: args.websiteUrl, onProgress: args.onProgress }),
  'agent-readiness':    (args) => runAgentReadinessModule({ websiteUrl: args.websiteUrl, onProgress: args.onProgress }),
  'social-preview':     (args) => runSocialPreview({ websiteUrl: args.websiteUrl, onProgress: args.onProgress }),
  'design-evaluation':  (args) => runDesignEvaluationModule({ clientId: args.clientId, websiteUrl: args.websiteUrl, onProgress: args.onProgress }),
};

// POST /api/leadgen/module
//   body: { placeId: string, moduleId: string }
//   → streams NDJSON progress lines then final result, persists to Firestore
export async function POST(request) {
  try {
    await verifyAdminRequest(makeReqShim(request));
  } catch {
    return new Response(JSON.stringify({ type: 'error', message: 'Unauthorized.' }) + '\n', {
      status: 401,
      headers: { 'Content-Type': 'application/x-ndjson' },
    });
  }

  let body;
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    return new Response(JSON.stringify({ type: 'error', message: 'Invalid JSON.' }) + '\n', {
      status: 400,
      headers: { 'Content-Type': 'application/x-ndjson' },
    });
  }

  const placeId  = String(body?.placeId  || '').trim();
  const moduleId = String(body?.moduleId || '').trim();

  if (!placeId || !moduleId) {
    return new Response(JSON.stringify({ type: 'error', message: 'Provide placeId and moduleId.' }) + '\n', {
      status: 400,
      headers: { 'Content-Type': 'application/x-ndjson' },
    });
  }

  const runner = RUNNERS[moduleId];
  if (!runner) {
    return new Response(JSON.stringify({ type: 'error', message: `Unknown moduleId: ${moduleId}` }) + '\n', {
      status: 400,
      headers: { 'Content-Type': 'application/x-ndjson' },
    });
  }

  const snap = await fb.adminDb.collection('leadgen_prospects').doc(placeId).get();
  if (!snap.exists) {
    return new Response(JSON.stringify({ type: 'error', message: `Prospect not found: ${placeId}` }) + '\n', {
      status: 404,
      headers: { 'Content-Type': 'application/x-ndjson' },
    });
  }

  const prospect   = snap.data();
  const websiteUrl = normalizeWebsiteUrl(prospect.website);
  if (!websiteUrl) {
    return new Response(JSON.stringify({ type: 'error', message: 'Prospect has no valid website URL.' }) + '\n', {
      status: 400,
      headers: { 'Content-Type': 'application/x-ndjson' },
    });
  }

  const runId    = crypto.randomUUID();
  const clientId = `leadgen_${placeId}`;
  const encoder  = new TextEncoder();

  // Advance to 'onboarding' if the prospect hasn't reached that stage yet
  const prospectRef = fb.adminDb.collection('leadgen_prospects').doc(placeId);
  if (stageIndex(prospect.stage) < stageIndex('onboarding')) {
    await prospectRef.update({ stage: 'onboarding', onboardStartedAt: new Date().toISOString() });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (obj) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch {}
      };

      const onProgress = async (stage, label, extra = {}) => {
        emit({ type: 'progress', stage, label, moduleId: extra.moduleId || moduleId });
      };

      emit({ type: 'start', moduleId, websiteUrl });

      let raw;
      try {
        raw = await runner({ clientId, runId, websiteUrl, onProgress });
      } catch (err) {
        raw = {
          ok: false,
          cardId: moduleId,
          status: 'failed',
          errorCode: 'module_threw',
          errorMessage: err.message,
          warningCodes: [],
          artifacts: [],
        };
      }

      const normalized = normalizeResult(moduleId, raw);
      const storeKey   = STORE_KEY[moduleId];

      if (storeKey) {
        try {
          const update = { [storeKey]: { ...normalized, runAt: new Date().toISOString() } };
          // Re-read current stage so we don't regress a prospect that advanced mid-run
          const freshSnap = await prospectRef.get();
          const currentStage = freshSnap.exists ? freshSnap.data().stage : prospect.stage;
          if (stageIndex(currentStage) < stageIndex('audited')) {
            update.stage = 'audited';
            update.onboardCompletedAt = new Date().toISOString();
          }
          await prospectRef.update(update);
        } catch (err) {
          emit({ type: 'progress', stage: 'persist', label: `Write failed: ${err.message}` });
        }
      }

      emit({
        type:     'done',
        status:   raw.status,
        moduleId,
        result:   normalized,
        warnings: raw.warningCodes || [],
      });

      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
