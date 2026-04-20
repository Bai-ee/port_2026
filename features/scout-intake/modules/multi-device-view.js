'use strict';

const { runSiteFetch } = require('./shared/site-fetch');
const { runScreenshots } = require('./shared/screenshots');
const { runDeviceMockup } = require('./shared/device-mockup');

const CARD_ID = 'multi-device-view';

async function runMultiDeviceView({ clientId, runId, websiteUrl }) {
  const warningCodes = [];
  const artifactRefs = [];

  // Step 1: site fetch (degraded evidence is acceptable)
  const fetchResult = await runSiteFetch({ websiteUrl });
  if (!fetchResult.ok && fetchResult.warning) {
    warningCodes.push(fetchResult.warning.code);
  }
  const evidence = fetchResult.evidence;

  // Step 2: screenshots
  const screenshotResult = await runScreenshots({ clientId, runId, websiteUrl, evidence });
  if (screenshotResult.ok) {
    artifactRefs.push(...screenshotResult.artifactRefs);
    for (const w of screenshotResult.warnings || []) warningCodes.push(w.code);
  } else {
    const code = screenshotResult.warning?.code || 'website_screenshot_failed';
    return {
      ok: false,
      cardId: CARD_ID,
      status: 'failed',
      errorCode: code,
      errorMessage: screenshotResult.warning?.message || 'Screenshot capture failed.',
      warningCodes: [code],
      artifacts: [],
    };
  }

  // Step 3: device mockup (requires screenshot refs)
  const screenshotRefs = artifactRefs.filter((a) => a?.type === 'website_homepage_screenshot');
  if (screenshotRefs.length === 0) {
    return {
      ok: false,
      cardId: CARD_ID,
      status: 'failed',
      errorCode: 'no_screenshot_refs',
      errorMessage: 'No screenshot refs available for mockup generation.',
      warningCodes,
      artifacts: artifactRefs,
    };
  }

  const mockupResult = await runDeviceMockup({
    clientId, runId, websiteUrl,
    screenshotArtifactRefs: artifactRefs,
  });

  if (mockupResult.ok && mockupResult.artifactRef) {
    artifactRefs.push(mockupResult.artifactRef);
  } else if (mockupResult.warning) {
    warningCodes.push(mockupResult.warning.code);
  }

  // Build result URLs from artifact refs
  const findUrl = (variant) =>
    artifactRefs.find((a) => a?.type === 'website_homepage_screenshot' && a?.variant === variant)?.downloadUrl || null;

  const mockupArtifact = artifactRefs.find((a) => a?.type === 'website_homepage_device_mockup') || null;

  return {
    ok: true,
    cardId: CARD_ID,
    status: 'succeeded',
    warningCodes,
    artifacts: artifactRefs,
    result: {
      mockupUrl:  mockupArtifact?.downloadUrl || null,
      desktopUrl: findUrl('desktop'),
      tabletUrl:  findUrl('tablet'),
      mobileUrl:  findUrl('mobile'),
    },
  };
}

module.exports = { runMultiDeviceView };
