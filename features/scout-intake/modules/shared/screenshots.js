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
}) {
  const variants = fullPageOnly
    ? FULL_PAGE_SCREENSHOT_VARIANTS
    : includeFullPage ? undefined : VIEWPORT_SCREENSHOT_VARIANTS;
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
