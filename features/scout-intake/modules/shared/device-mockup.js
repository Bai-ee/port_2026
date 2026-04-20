'use strict';

const { generateWebsiteMockupArtifact } = require('../../../../api/_lib/device-mockup.cjs');

async function runDeviceMockup({ clientId, runId, websiteUrl, screenshotArtifactRefs, screenshotBuffersByVariant = null }) {
  try {
    const result = await generateWebsiteMockupArtifact({
      clientId,
      runId,
      websiteUrl,
      screenshotArtifactRefs,
      screenshotBuffersByVariant,
    });
    if (!result?.ok) {
      return {
        ok: false,
        warning: result?.warning || { type: 'warning', code: 'mockup_generation_failed', message: 'Mockup generation failed.', stage: 'compose' },
      };
    }
    return { ok: true, artifactRef: result.artifactRef };
  } catch (err) {
    return {
      ok: false,
      warning: { type: 'warning', code: 'mockup_generation_failed', message: `Mockup generation failed: ${err.message}`, stage: 'compose' },
    };
  }
}

module.exports = { runDeviceMockup };
