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
  fullPagesOnly = false,
}) {
  const warningCodes = [];
  const warnings = [];
  const artifactRefs = [];
  const emit = async (stage, label, extra = {}) => {
    if (!onProgress) return;
    try { await onProgress(stage, label, { moduleId: CARD_ID, ...extra }); } catch {}
  };

  // Full-pages-only retry path: skip site-fetch + viewport capture + mockup
  // composition. Only captures the three full-page screenshots. Preserves the
  // existing mockup and viewport screenshots in dashboard_state.
  if (fullPagesOnly) {
    await emit('capture', 'Capture full-page screenshots only — preserving existing mockup…');
    const fpResult = await runScreenshots({
      clientId,
      runId,
      websiteUrl,
      fullPageOnly: true,
      onVariantProgress: async ({ phase, variant }) => {
        if (!variant?.label) return;
        if (phase === 'start') {
          await emit('capture', `Capture ${variant.label.toLowerCase()}…`);
        } else if (phase === 'stored') {
          await emit('capture', `${variant.label} captured.`);
        }
      },
    });
    if (fpResult.ok) {
      artifactRefs.push(...fpResult.artifactRefs);
      for (const w of fpResult.warnings || []) {
        warningCodes.push(w.code);
        warnings.push(w);
      }
    } else {
      const warning = fpResult.warning || { type: 'warning', code: 'full_page_capture_failed', message: 'Full-page capture failed.', stage: 'capture' };
      warningCodes.push(warning.code);
      warnings.push(warning);
      await emit('error', `Full-page capture failed: ${warning.message || warning.code}`);
      return {
        ok: false,
        cardId: CARD_ID,
        status: 'failed',
        errorCode: warning.code,
        errorMessage: warning.message || 'Full-page capture failed.',
        warningCodes,
        warnings,
        artifacts: [],
      };
    }

    await emit('normalize', 'Write full-page captures…');
    return {
      ok: true,
      cardId: CARD_ID,
      status: 'succeeded',
      warningCodes,
      warnings,
      artifacts: artifactRefs,
      result: {
        // Intentionally null — this path doesn't produce new viewport or mockup
        // artifacts; run-lifecycle preserves existing ones.
        mockupUrl:  null,
        desktopUrl: null,
        tabletUrl:  null,
        mobileUrl:  null,
      },
    };
  }

  // Mockup-only retry path: skip site-fetch + browserless capture entirely and
  // feed the existing viewport screenshot refs straight to the mockup composer.
  if (skipScreenshots && Array.isArray(existingScreenshotRefs) && existingScreenshotRefs.length > 0) {
    await emit('compose', 'Reusing existing screenshots — rebuilding mockup only…');
    const reuseRefs = existingScreenshotRefs.filter(
      (a) => a?.type === 'website_homepage_screenshot' && a?.variant && !String(a.variant).endsWith('-full')
    );

    // Self-heal: if any required viewport is missing from the reused refs,
    // capture only the missing ones before composing — avoids a hard failure
    // when the previous run produced a partial set.
    const REQUIRED = ['desktop', 'tablet', 'mobile'];
    const presentVariants = new Set(reuseRefs.map((a) => a.variant));
    const missingVariants = REQUIRED.filter((v) => !presentVariants.has(v));
    const buffersByVariant = {};

    if (missingVariants.length > 0) {
      await emit(
        'capture',
        `Missing ${missingVariants.join(', ')} — capturing only the missing screenshot${missingVariants.length > 1 ? 's' : ''}…`
      );
      const recapture = await runScreenshots({
        clientId,
        runId,
        websiteUrl,
        includeFullPage: false,
        includeBuffers: true,
        includeBufferVariants: missingVariants,
        variantIds: missingVariants,
        onVariantProgress: async ({ phase, variant, attempt, totalAttempts }) => {
          if (!variant?.label) return;
          if (phase === 'start') {
            await emit('capture', `Capture ${variant.label.toLowerCase()}…`);
          } else if (phase === 'retry') {
            await emit('capture', `Retrying ${variant.label.toLowerCase()} (attempt ${attempt}/${totalAttempts})…`);
          } else if (phase === 'stored') {
            await emit('capture', `${variant.label} captured.`);
          }
        },
      });
      if (!recapture.ok) {
        const warning = recapture.warning || { type: 'warning', code: 'website_screenshot_failed', message: 'Screenshot capture failed.', stage: 'capture' };
        warningCodes.push(warning.code);
        warnings.push(warning);
        await emit('error', `Missing-screenshot recapture failed: ${warning.message || warning.code}`);
        return {
          ok: false,
          cardId: CARD_ID,
          status: 'failed',
          errorCode: warning.code,
          errorMessage: warning.message || 'Missing-screenshot recapture failed.',
          warningCodes,
          warnings,
          artifacts: reuseRefs,
        };
      }
      for (const ref of recapture.artifactRefs) {
        if (ref?.type !== 'website_homepage_screenshot' || !ref?.variant) continue;
        if (String(ref.variant).endsWith('-full')) continue;
        if (Buffer.isBuffer(ref.buffer)) buffersByVariant[ref.variant] = ref.buffer;
        reuseRefs.push(ref);
      }
    }

    artifactRefs.push(...reuseRefs);

    await emit('compose', 'Build device mockup…');
    const mockupResult = await runDeviceMockup({
      clientId, runId, websiteUrl,
      screenshotArtifactRefs: reuseRefs,
      screenshotBuffersByVariant: Object.keys(buffersByVariant).length > 0 ? buffersByVariant : null,
    });

    for (const ref of reuseRefs) {
      if (ref && Object.prototype.hasOwnProperty.call(ref, 'buffer')) delete ref.buffer;
    }
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
