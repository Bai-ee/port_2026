'use strict';

const { persistWebsiteScreenshotArtifact } = require('../../../../api/_lib/browserless.cjs');

async function runScreenshots({ clientId, runId, websiteUrl }) {
  try {
    const result = await persistWebsiteScreenshotArtifact({ clientId, runId, websiteUrl });
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
