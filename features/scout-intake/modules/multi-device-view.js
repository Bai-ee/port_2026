'use strict';

const { runSiteFetch } = require('./shared/site-fetch');
const { runScreenshots } = require('./shared/screenshots');
const { runDeviceMockup } = require('./shared/device-mockup');

const CARD_ID = 'multi-device-view';

async function runMultiDeviceView({
  clientId,
  runId,
  websiteUrl,
  onProgress = null,
  skipScreenshots = false,
  existingScreenshotRefs = null,
}) {
  const warningCodes = [];
  const warnings = [];
  const artifactRefs = [];
  const emit = async (stage, label, extra = {}) => {
    if (!onProgress) return;
    try { await onProgress(stage, label, { moduleId: CARD_ID, ...extra }); } catch {}
  };

  // Mockup-only retry path: skip site-fetch + browserless capture entirely and
  // feed the existing viewport screenshot refs straight to the mockup composer.
  if (skipScreenshots && Array.isArray(existingScreenshotRefs) && existingScreenshotRefs.length > 0) {
    await emit('compose', 'Reusing existing screenshots — rebuilding mockup only…');
    const reuseRefs = existingScreenshotRefs.filter(
      (a) => a?.type === 'website_homepage_screenshot' && a?.variant && !String(a.variant).endsWith('-full')
    );
    artifactRefs.push(...reuseRefs);

    await emit('compose', 'Build device mockup…');
    const mockupResult = await runDeviceMockup({
      clientId, runId, websiteUrl,
      screenshotArtifactRefs: reuseRefs,
    });
    if (mockupResult.ok && mockupResult.artifactRef) {
      artifactRefs.push(mockupResult.artifactRef);
      await emit('compose', 'Device mockup generated.');
    } else if (mockupResult.warning) {
      warningCodes.push(mockupResult.warning.code);
      warnings.push(mockupResult.warning);
      // Mockup rebuild is the sole purpose of this path — report failure so the
      // terminal and module status reflect that nothing new was produced.
      await emit('error', `Mockup rebuild failed: ${mockupResult.warning.message || mockupResult.warning.code}`);
      return {
        ok: false,
        cardId: CARD_ID,
        status: 'failed',
        errorCode: mockupResult.warning.code || 'mockup_generation_failed',
        errorMessage: mockupResult.warning.message || 'Mockup rebuild failed.',
        warningCodes,
        warnings,
        artifacts: reuseRefs,
      };
    }

    const mockupArtifact = artifactRefs.find((a) => a?.type === 'website_homepage_device_mockup') || null;
    const findUrl = (variant) =>
      artifactRefs.find((a) => a?.type === 'website_homepage_screenshot' && a?.variant === variant)?.downloadUrl || null;

    await emit('normalize', 'Write layout module…');
    return {
      ok: true,
      cardId: CARD_ID,
      status: 'succeeded',
      warningCodes,
      warnings,
      artifacts: artifactRefs,
      result: {
        mockupUrl:  mockupArtifact?.downloadUrl || null,
        desktopUrl: findUrl('desktop'),
        tabletUrl:  findUrl('tablet'),
        mobileUrl:  findUrl('mobile'),
      },
    };
  }

  // Step 1: site fetch (degraded evidence is acceptable)
  await emit('fetch', 'Connect to website…');
  const fetchResult = await runSiteFetch({ websiteUrl });
  if (!fetchResult.ok && fetchResult.warning) {
    warningCodes.push(fetchResult.warning.code);
    warnings.push(fetchResult.warning);
  }
  const evidence = fetchResult.evidence;

  // Step 2: screenshots
  await emit('capture', 'Capture homepage screenshots…');
  const screenshotResult = await runScreenshots({
    clientId,
    runId,
    websiteUrl,
    includeBuffers: true,
    includeBufferVariants: ['desktop', 'tablet', 'mobile'],
    onVariantProgress: async ({ phase, variant }) => {
      if (!variant?.label) return;
      if (phase === 'start') {
        await emit('capture', `Capture ${variant.label.toLowerCase()} screenshot…`);
      } else if (phase === 'stored') {
        await emit('capture', `${variant.label} screenshot captured.`);
      }
    },
  });
  if (screenshotResult.ok) {
    artifactRefs.push(...screenshotResult.artifactRefs);
    for (const w of screenshotResult.warnings || []) {
      warningCodes.push(w.code);
      warnings.push(w);
    }
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

  await emit('compose', 'Build device mockup…');
  const mockupResult = await runDeviceMockup({
    clientId, runId, websiteUrl,
    screenshotArtifactRefs: artifactRefs,
    screenshotBuffersByVariant: Object.fromEntries(
      artifactRefs
        .filter((a) => a?.type === 'website_homepage_screenshot' && Buffer.isBuffer(a.buffer))
        .map((a) => [a.variant, a.buffer])
    ),
  });

  for (const artifact of artifactRefs) {
    if (artifact && Object.prototype.hasOwnProperty.call(artifact, 'buffer')) {
      delete artifact.buffer;
    }
  }

  if (mockupResult.ok && mockupResult.artifactRef) {
    artifactRefs.push(mockupResult.artifactRef);
  } else if (mockupResult.warning) {
    warningCodes.push(mockupResult.warning.code);
    warnings.push(mockupResult.warning);
  }

  // Build result URLs from artifact refs
  const findUrl = (variant) =>
    artifactRefs.find((a) => a?.type === 'website_homepage_screenshot' && a?.variant === variant)?.downloadUrl || null;

  const mockupArtifact = artifactRefs.find((a) => a?.type === 'website_homepage_device_mockup') || null;

  await emit('normalize', 'Write layout module…');

  return {
    ok: true,
    cardId: CARD_ID,
    status: 'succeeded',
    warningCodes,
    warnings,
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
