'use strict';

const { runSiteFetch } = require('./shared/site-fetch');
const { runAiSeo } = require('./shared/ai-seo');
const { runAgentReady } = require('../agent-ready/index');
const { runCloudflareScan } = require('../agent-ready/cloudflare-scan');
const { generateCustomFixes } = require('../agent-ready/llm-fix-generator');

const CARD_ID = 'agent-readiness';

async function runAgentReadinessModule({ websiteUrl, onProgress = null }) {
  const warningCodes = [];
  const emit = async (stage, label, extra = {}) => {
    if (!onProgress) return;
    try { await onProgress(stage, label, { moduleId: CARD_ID, ...extra }); } catch {}
  };

  // Step 1: site fetch — evidence reused by runAgentReady for structured-data check
  await emit('fetch', 'Connect to website…');
  const fetchResult = await runSiteFetch({ websiteUrl });
  if (!fetchResult.ok && fetchResult.warning) {
    warningCodes.push(fetchResult.warning.code);
  }
  const evidence = fetchResult?.evidence || null;

  // Step 2: agent-ready probes + AI SEO + Cloudflare scan in parallel (Phase 7)
  await emit('agent-ready', 'Probe agent-readiness signals…');
  const [agentReadyResult, aiSeoResult, cfScan] = await Promise.all([
    runAgentReady({ websiteUrl, evidence }),
    runAiSeo({ websiteUrl }),
    runCloudflareScan({ websiteUrl, evidence }),
  ]);

  if (!agentReadyResult.ok) warningCodes.push('agent_ready_failed');
  if (aiSeoResult.warning) warningCodes.push(aiSeoResult.warning.code);

  await emit('ai-seo', 'Run AI visibility check…');

  const aiSeoOk = aiSeoResult.ok && !aiSeoResult.skipped;

  // Both probes failed — nothing to show
  if (!agentReadyResult.ok && !aiSeoOk) {
    const code = warningCodes[0] || 'agent_readiness_no_data';
    return {
      ok: false,
      cardId: CARD_ID,
      status: 'failed',
      errorCode: code,
      errorMessage: 'Neither agent-readiness probe nor AI visibility audit produced data.',
      warningCodes,
      artifacts: [],
    };
  }

  // Step 3: LLM-generated custom fix prompts for failed checks (Phase 8)
  await emit('normalize', 'Generate custom fix recommendations…');
  let customFixes = {};
  if (agentReadyResult.ok) {
    const failedChecks = (agentReadyResult.checks || []).filter(
      (c) => (c.status === 'fail' || c.status === 'warn' || c.status === 'na') && c.fixId
    );
    if (failedChecks.length > 0) {
      customFixes = await generateCustomFixes({ websiteUrl, failedChecks, evidence });
    }
  }

  await emit('normalize', 'Write agent-readiness module…');
  return {
    ok: true,
    cardId: CARD_ID,
    status: 'succeeded',
    warningCodes,
    artifacts: [],
    result: {
      agentReadiness: agentReadyResult.ok ? {
        score:       agentReadyResult.score,
        dimensions:  agentReadyResult.dimensions,
        verdict:     agentReadyResult.verdict,
        readiness:   agentReadyResult.readiness,
        checks:      agentReadyResult.checks,
        findings:    agentReadyResult.findings,
        highlights:  agentReadyResult.highlights,
        customFixes,
        cfSignals:   cfScan.cfSignals || {},
        cfFindings:  cfScan.findings  || [],
      } : null,
      aiSeoAudit: aiSeoOk ? aiSeoResult.aiSeoAudit : null,
    },
  };
}

module.exports = { runAgentReadinessModule };
