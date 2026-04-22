'use strict';

const { runSiteFetch } = require('./shared/site-fetch');
const { runStyleGuide } = require('./shared/style-guide');
const { sampleVisualPalette } = require('../visual-palette-sampler');
const fb = require('../../../api/_lib/firebase-admin.cjs');

const CARD_ID = 'style-guide';

// Read the best available homepage image for palette sampling.
// Priority matches design-evaluation (viewport desktop > composite mockup > full-page).
async function loadHomepageImageUrl(clientId) {
  if (!clientId) return null;
  try {
    const snap = await fb.adminDb.collection('dashboard_state').doc(clientId).get();
    if (!snap.exists) return null;
    const artifacts = snap.data()?.artifacts || {};
    const viewport = artifacts.homepageScreenshots || {};
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

async function runStyleGuideModule({ clientId, websiteUrl, onProgress = null }) {
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

  // Step 2: Sample ground-truth palette from the homepage screenshot if one
  // has already been captured (multi-device-view card). Non-fatal — on miss,
  // extraction falls back to CSS-only.
  let visualPalette = null;
  const homepageImageUrl = await loadHomepageImageUrl(clientId);
  if (homepageImageUrl) {
    await emit('analyze', 'Sample homepage colors…');
    const sampled = await sampleVisualPalette({ imageUrl: homepageImageUrl });
    if (sampled.ok) {
      visualPalette = sampled.palette;
    } else {
      warningCodes.push('visual_palette_sample_failed');
      warnings.push({
        type: 'warning',
        code: 'visual_palette_sample_failed',
        message: sampled.error || 'Homepage palette sampling failed.',
        stage: 'analyze',
      });
    }
  }

  // Step 3: design system extraction + style guide synthesis.
  await emit('analyze', 'Extract colors, typography, and layout…');
  const sgResult = await runStyleGuide({ evidence, visualPalette });
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
