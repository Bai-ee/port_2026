'use strict';

// design-evaluation.js — Module runner for the Design Evaluation card.
//
// Pipeline:
//   1. Fetch site evidence (HTML + stylesheets).
//   2. Extract design-system tokens (shared style-guide extractor).
//   3. Run the `design-evaluation` skill against the tokens + evidence.
//   4. Return the skill output so the dashboard can render DESIGN.md.
//
// Persisted shape (via projectModuleResult):
//   - result.styleGuide         → snapshot.visualIdentity.styleGuide
//   - result.analyzerOutput     → analyzerOutputs['design-evaluation']

const { runSiteFetch }   = require('./shared/site-fetch');
const { runStyleGuide }  = require('./shared/style-guide');
const { runSkill, buildSourcePayloads } = require('../skills/_runner');
const { CARD_CONTRACT }  = require('../card-contract');
const fb                 = require('../../../api/_lib/firebase-admin.cjs');

const CARD_ID   = 'design-evaluation';
const SKILL_ID  = 'design-evaluation';

/**
 * Read the homepage mockup URL from dashboard_state, if present.
 *
 * Priority:
 *   1. Viewport desktop screenshot  (fits Anthropic's 8000px dimension cap)
 *   2. Composite device mockup
 *   3. Desktop full-page screenshot  (last resort — often too tall, may 400)
 *
 * Returns null if nothing has been captured yet.
 */
async function loadHomepageMockupUrl(clientId) {
  if (!clientId) return null;
  try {
    const snap = await fb.adminDb.collection('dashboard_state').doc(clientId).get();
    if (!snap.exists) return null;
    const artifacts = snap.data()?.artifacts || {};
    const viewport  = artifacts.homepageScreenshots || {};
    const viewportDesktop = viewport['desktop']?.downloadUrl
      || artifacts.homepageScreenshot?.downloadUrl
      || null;
    if (viewportDesktop) return viewportDesktop;
    const mockup = artifacts.homepageDeviceMockup?.downloadUrl || null;
    if (mockup) return mockup;
    const fullPage = artifacts.fullPageScreenshots || {};
    return fullPage['desktop-full']?.downloadUrl || null;
  } catch {
    return null;
  }
}

async function runDesignEvaluationModule({ clientId, websiteUrl, onProgress = null }) {
  const warningCodes = [];
  const warnings = [];
  const emit = async (stage, label, extra = {}) => {
    if (!onProgress) return;
    try { await onProgress(stage, label, { moduleId: CARD_ID, ...extra }); } catch {}
  };

  // 1. Site fetch
  await emit('fetch', 'Connect to website and collect stylesheets…');
  const fetchResult = await runSiteFetch({ websiteUrl });
  if (!fetchResult.ok && fetchResult.warning) {
    warningCodes.push(fetchResult.warning.code);
    warnings.push(fetchResult.warning);
  }
  const evidence = fetchResult.evidence;

  // 2. Extract design-system tokens (best-effort — skill handles null).
  await emit('analyze', 'Extract colors, typography, and layout tokens…');
  let styleGuide = null;
  try {
    const sgResult = await runStyleGuide({ evidence });
    styleGuide = sgResult?.styleGuide || null;
    if (!sgResult?.ok && sgResult?.error) {
      const w = { type: 'warning', code: 'style_guide_extraction_degraded', message: sgResult.error, stage: 'analyze' };
      warningCodes.push(w.code);
      warnings.push(w);
    }
  } catch (err) {
    const w = { type: 'warning', code: 'style_guide_extraction_failed', message: err?.message || 'unknown', stage: 'analyze' };
    warningCodes.push(w.code);
    warnings.push(w);
  }

  // 3. Resolve card + run skill
  await emit('synthesize', 'Author DESIGN.md findings and fix roadmap…');
  const card = CARD_CONTRACT.find((c) => c.id === CARD_ID) || null;
  if (!card) {
    const msg = `Card '${CARD_ID}' not found in CARD_CONTRACT.`;
    await emit('error', msg);
    return {
      ok: false, cardId: CARD_ID, status: 'failed',
      errorCode: 'card_not_found', errorMessage: msg,
      warningCodes, warnings, artifacts: [],
    };
  }

  // Look up the homepage mockup if multi-device-view has already run.
  // Passed through as an __image payload so the skill runner turns it into
  // an Anthropic vision block.
  const homepageMockupUrl = await loadHomepageMockupUrl(clientId);
  if (homepageMockupUrl) {
    await emit('analyze', 'Include homepage mockup as visual reference…');
  }

  const sourcePayloads = buildSourcePayloads({
    styleGuide,
    evidence,
    siteMeta: fetchResult?.siteMeta || null,
  });
  if (homepageMockupUrl) {
    sourcePayloads['image.homepageMockup'] = { __image: true, url: homepageMockupUrl };
  }

  let skillResult;
  try {
    skillResult = await runSkill(SKILL_ID, { card, sourcePayloads });
  } catch (err) {
    const msg = err?.message || 'skill invocation threw';
    await emit('error', msg);
    return {
      ok: false, cardId: CARD_ID, status: 'failed',
      errorCode: 'skill_threw', errorMessage: msg,
      warningCodes, warnings, artifacts: [],
    };
  }

  if (!skillResult?.ok || !skillResult.output) {
    const msg = skillResult?.error || 'design-evaluation skill returned no output';
    await emit('error', msg);
    return {
      ok: false, cardId: CARD_ID, status: 'failed',
      errorCode: 'skill_failed', errorMessage: msg,
      warningCodes, warnings, artifacts: [],
    };
  }

  await emit('normalize', 'Persist DESIGN.md evaluation…');
  return {
    ok: true,
    cardId: CARD_ID,
    status: 'succeeded',
    warningCodes,
    warnings,
    artifacts: [],
    result: {
      styleGuide,
      analyzerOutput: skillResult.output,
    },
  };
}

module.exports = { runDesignEvaluationModule };
