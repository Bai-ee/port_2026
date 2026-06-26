import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { resolveDashboardClientContext } = require('../_context.cjs');
const { getClientBrain } = require('../../../../../features/client-brain/store.cjs');
const fb = require('../../../../../api/_lib/firebase-admin.cjs');

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function POST(request) {
  let context;
  try {
    ({ context } = await resolveDashboardClientContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  try {
    const { brain } = await getClientBrain(context.clientId);
    const [clientSnap, configSnap, dashSnap] = await Promise.all([
      fb.adminDb.collection('clients').doc(context.clientId).get().catch(() => null),
      fb.adminDb.collection('client_configs').doc(context.clientId).get().catch(() => null),
      fb.adminDb.collection('dashboard_state').doc(context.clientId).get().catch(() => null),
    ]);
    const contextPack = brain?.aiContextPack || {};
    const client = clientSnap?.exists ? { id: clientSnap.id, ...(clientSnap.data() || {}) } : { id: context.clientId };
    const clientConfig = configSnap?.exists ? (configSnap.data() || {}) : {};
    const dashboardState = dashSnap?.exists ? (dashSnap.data() || {}) : {};
    const cardConfigs = {
      'marketing-brief': clientConfig.marketingBriefConfig || null,
      'strategy-builder': clientConfig.strategyBuilder || dashboardState.strategyBuilder?.config || null,
      'post-me': dashboardState.socialPosting || dashboardState.socialQueue || null,
      'email-digest': clientConfig.digestConfig || dashboardState.digestConfig || null,
      leadgen: dashboardState.leadgen || null,
    };
    const clientPackage = {
      schemaVersion: 'hitloop.client-package.v1',
      exportedAt: new Date().toISOString(),
      sourceSystem: 'HITLOOP',
      client,
      clientBrain: {
        status: brain?.status || 'draft',
        version: brain?.version || null,
        markdownSource: brain?.markdownSource || '',
        markdownMeta: brain?.markdownMeta || {},
        decisions: brain?.decisions || {},
        intelligence: brain?.decisions?.intelligence || {},
        decisionDrivers: brain?.decisions?.decisionDrivers || [],
        decisionAcquisition: brain?.decisionAcquisition || {},
        completion: brain?.completion || {},
        missingDecisionQueue: brain?.missingDecisionQueue || [],
        cardDefaults: brain?.cardDefaults || {},
        aiContextPack: contextPack,
        sourceRefs: brain?.sourceRefs || [],
        missingData: brain?.missingData || [],
        contradictions: brain?.contradictions || [],
        confidence: brain?.confidence || 'low',
      },
      cardConfigs,
      cardSettingsSnapshot: brain?.cardSettingsSnapshot || {},
      decisionHistory: brain?.decisionHistory || [],
      sourcesManifest: (brain?.sourceRefs || []).map((src) => ({
        id: src.id,
        sourceType: src.sourceType,
        label: src.label,
        enabled: src.enabled !== false,
        url: src.url || null,
        filePath: src.filePath || null,
        trustLevel: src.trustLevel || 'medium',
        freshness: src.freshness || 'unknown',
        relevance: src.relevance || 'medium',
      })),
      artifactsManifest: dashboardState.artifacts || dashboardState.deliverables || [],
    };
    return json({
      ok: true,
      clientId: context.clientId,
      status: brain?.status || 'draft',
      CLIENT_CONTEXT: contextPack.shortContext || '',
      CLIENT_CONTEXT_LONG: contextPack.longContext || '',
      CLIENT_BRAIN_MD: brain?.markdownSource || '',
      markdownMeta: brain?.markdownMeta || {},
      promptRules: contextPack.promptRules || [],
      sourceRefs: brain?.sourceRefs || [],
      decisions: brain?.decisions || {},
      intelligence: brain?.decisions?.intelligence || {},
      decisionDrivers: brain?.decisions?.decisionDrivers || [],
      decisionAcquisition: brain?.decisionAcquisition || {},
      completion: brain?.completion || {},
      missingDecisionQueue: brain?.missingDecisionQueue || [],
      cardDefaults: brain?.cardDefaults || {},
      cardSettingsSnapshot: brain?.cardSettingsSnapshot || {},
      cardConfigs,
      clientPackage,
    });
  } catch (err) {
    return json({ error: err.message || 'Could not export Client Brain.' }, err.status || 500);
  }
}
