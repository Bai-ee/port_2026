'use strict';

const { runSiteFetch } = require('./shared/site-fetch');
const { runStyleGuide } = require('./shared/style-guide');

const CARD_ID = 'style-guide';

async function runStyleGuideModule({ websiteUrl, onProgress = null }) {
  const warningCodes = [];
  const warnings = [];
  const emit = async (stage, label, extra = {}) => {
    if (!onProgress) return;
    try { await onProgress(stage, label, { moduleId: CARD_ID, ...extra }); } catch {}
  };

  // Step 1: site fetch — needed so the extractor has HTML + stylesheet evidence.
  await emit('fetch', 'Connect to website and collect stylesheets…');
  const fetchResult = await runSiteFetch({ websiteUrl });
  if (!fetchResult.ok && fetchResult.warning) {
    warningCodes.push(fetchResult.warning.code);
    warnings.push(fetchResult.warning);
  }
  const evidence = fetchResult.evidence;

  // Step 2: design system extraction + style guide synthesis.
  await emit('analyze', 'Extract colors, typography, and layout…');
  const sgResult = await runStyleGuide({ evidence });
  if (!sgResult.ok || !sgResult.styleGuide) {
    const code = 'style_guide_extraction_failed';
    const warning = {
      type: 'warning',
      code,
      message: sgResult.error || 'Design system extraction returned no style guide.',
      stage: 'analyze',
    };
    warningCodes.push(code);
    warnings.push(warning);
    await emit('error', warning.message);
    return {
      ok: false,
      cardId: CARD_ID,
      status: 'failed',
      errorCode: code,
      errorMessage: warning.message,
      warningCodes,
      warnings,
      artifacts: [],
    };
  }

  await emit('normalize', 'Write brand snapshot…');
  return {
    ok: true,
    cardId: CARD_ID,
    status: 'succeeded',
    warningCodes,
    warnings,
    artifacts: [],
    result: { styleGuide: sgResult.styleGuide },
  };
}

module.exports = { runStyleGuideModule };
