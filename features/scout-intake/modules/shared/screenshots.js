'use strict';

const {
  persistWebsiteScreenshotArtifact,
  VIEWPORT_SCREENSHOT_VARIANTS,
  FULL_PAGE_SCREENSHOT_VARIANTS,
} = require('../../../../api/_lib/browserless.cjs');

async function runScreenshots({
  clientId,
  runId,
  websiteUrl,
  includeFullPage = true,
  fullPageOnly = false,
  includeBuffers = false,
  includeBufferVariants = null,
  onVariantProgress = null,
  variantIds = null,
}) {
  let variants = fullPageOnly
    ? FULL_PAGE_SCREENSHOT_VARIANTS
    : includeFullPage ? undefined : VIEWPORT_SCREENSHOT_VARIANTS;
  if (Array.isArray(variantIds) && variantIds.length > 0) {
    const base = variants || [...VIEWPORT_SCREENSHOT_VARIANTS, ...FULL_PAGE_SCREENSHOT_VARIANTS];
    const idSet = new Set(variantIds);
    variants = base.filter((v) => idSet.has(v.id));
  }
  try {
    const result = await persistWebsiteScreenshotArtifact({
      clientId,
      runId,
      websiteUrl,
      variants,
      includeBuffers,
      includeBufferVariants,
      onVariantProgress,
    });
    if (!result?.ok) {
      return {
        ok: false,
        warning: result?.warning || { type: 'warning', code: 'screenshot_failed', message: 'Screenshot capture failed.', stage: 'capture' },
        artifactRefs: [],
      };
    }
    const artifactRefs = Array.isArray(result.artifactRefs) && result.artifactRefs.length > 0
      ? result.artifactRefs
      : result.artifactRef ? [result.artifactRef] : [];
    return { ok: true, artifactRefs, warnings: Array.isArray(result.warnings) ? result.warnings : [] };
  } catch (err) {
    return {
      ok: false,
      warning: { type: 'warning', code: 'website_screenshot_failed', message: `Screenshot capture failed: ${err.message}`, stage: 'capture' },
      artifactRefs: [],
    };
  }
}

module.exports = { runScreenshots };
