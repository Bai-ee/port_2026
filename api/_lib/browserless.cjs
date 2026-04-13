'use strict';

const path = require('path');
const { randomUUID } = require('crypto');
const fb = require('./firebase-admin.cjs');
const { saveBufferArtifact } = require('./storage-artifacts.cjs');

const DEFAULT_BASE_URL = 'https://production-sfo.browserless.io';
const DEFAULT_REQUEST_TIMEOUT_MS = 45000;
const DEFAULT_GOTO_TIMEOUT_MS = 15000;
const DEFAULT_POST_LOAD_WAIT_MS = 1200;
const SCREENSHOT_VARIANTS = [
  {
    id: 'desktop',
    label: 'Desktop',
    storageSuffix: 'desktop',
    viewport: {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
      isLandscape: true,
    },
    primary: true,
  },
  {
    id: 'mobile',
    label: 'Mobile',
    storageSuffix: 'mobile',
    viewport: {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      isLandscape: false,
    },
    primary: false,
  },
  {
    id: 'ipad',
    label: 'iPad',
    storageSuffix: 'ipad',
    viewport: {
      width: 820,
      height: 1180,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      isLandscape: false,
    },
    primary: false,
  },
];

function readOptionalEnvInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getBrowserlessConfig() {
  const token = String(process.env.BROWSERLESS_TOKEN || '').trim();
  if (!token) {
    return {
      enabled: false,
      reason: 'Browserless is not configured.',
    };
  }

  const baseUrl = String(process.env.BROWSERLESS_BASE_URL || DEFAULT_BASE_URL)
    .trim()
    .replace(/\/+$/, '');

  return {
    enabled: true,
    token,
    baseUrl,
    requestTimeoutMs: readOptionalEnvInt('BROWSERLESS_REQUEST_TIMEOUT_MS', DEFAULT_REQUEST_TIMEOUT_MS),
    gotoTimeoutMs: readOptionalEnvInt('BROWSERLESS_GOTO_TIMEOUT_MS', DEFAULT_GOTO_TIMEOUT_MS),
    postLoadWaitMs: readOptionalEnvInt('BROWSERLESS_POST_LOAD_WAIT_MS', DEFAULT_POST_LOAD_WAIT_MS),
  };
}

function buildEndpointUrl(baseUrl, endpoint, token, requestTimeoutMs, variant = null) {
  const url = new URL(`${baseUrl}${endpoint}`);
  url.searchParams.set('token', token);
  url.searchParams.set('timeout', String(requestTimeoutMs));
  if (variant?.viewport) {
    url.searchParams.set('launch', JSON.stringify({ defaultViewport: variant.viewport }));
  }
  return url.toString();
}

function extensionForContentType(contentType) {
  const normalized = String(contentType || '').toLowerCase();
  if (normalized.includes('jpeg')) return 'jpg';
  if (normalized.includes('webp')) return 'webp';
  return 'png';
}

function buildWarning(code, message, extra = {}) {
  return {
    type: 'warning',
    code,
    message,
    ...extra,
  };
}

async function createBrowserlessRequestLog({ clientId, runId, websiteUrl, endpoint, requestTimeoutMs, variant }) {
  const requestId = randomUUID();
  const requestRef = fb.adminDb.collection('browserless_requests').doc(requestId);

  await requestRef.set({
    requestId,
    provider: 'browserless',
    endpoint,
    clientId: clientId || null,
    runId: runId || null,
    sourceUrl: websiteUrl,
    variant: variant?.id || null,
    viewportLabel: variant?.label || null,
    viewport: variant?.viewport || null,
    status: 'started',
    requestTimeoutMs,
    createdAt: fb.FieldValue.serverTimestamp(),
    updatedAt: fb.FieldValue.serverTimestamp(),
  });

  return { requestId, requestRef };
}

async function finalizeBrowserlessRequestLog(requestRef, update) {
  if (!requestRef) return;
  await requestRef.set(
    {
      ...update,
      updatedAt: fb.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function captureScreenshotBuffer({ clientId, runId, targetUrl, variant }) {
  const config = getBrowserlessConfig();
  if (!config.enabled) {
    return {
      ok: false,
      warning: buildWarning(
        'browserless_not_configured',
        'Website screenshot skipped because Browserless is not configured.'
      ),
    };
  }

  const endpoint = buildEndpointUrl(
    config.baseUrl,
    '/screenshot',
    config.token,
    config.requestTimeoutMs,
    variant
  );
  const startedAt = Date.now();
  let requestLog = null;

  try {
    requestLog = await createBrowserlessRequestLog({
      clientId,
      runId,
      websiteUrl: targetUrl,
      endpoint: 'screenshot',
      requestTimeoutMs: config.requestTimeoutMs,
      variant,
    });
  } catch {
    requestLog = null;
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: targetUrl,
        bestAttempt: true,
        gotoOptions: {
          waitUntil: 'networkidle2',
          timeout: config.gotoTimeoutMs,
        },
        waitForTimeout: config.postLoadWaitMs,
        options: {
          fullPage: true,
          type: 'png',
        },
      }),
    });

    if (!response.ok) {
      const snippet = (await response.text().catch(() => '')).slice(0, 300);
      await finalizeBrowserlessRequestLog(requestLog?.requestRef, {
        status: 'failed',
        completedAt: fb.FieldValue.serverTimestamp(),
        durationMs: Date.now() - startedAt,
        httpStatus: response.status,
        ok: false,
        errorMessage: `HTTP ${response.status}`,
        errorDetail: snippet || null,
      });
      return {
        ok: false,
        warning: buildWarning(
          'browserless_http_error',
          `Website screenshot failed with Browserless HTTP ${response.status}.`,
          snippet ? { detail: snippet, requestId: requestLog?.requestId || null } : { requestId: requestLog?.requestId || null }
        ),
      };
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const buffer = Buffer.from(await response.arrayBuffer());

    if (!buffer.length) {
      await finalizeBrowserlessRequestLog(requestLog?.requestRef, {
        status: 'failed',
        completedAt: fb.FieldValue.serverTimestamp(),
        durationMs: Date.now() - startedAt,
        httpStatus: response.status,
        ok: false,
        errorMessage: 'Empty image response',
      });
      return {
        ok: false,
        warning: buildWarning(
          'browserless_empty_response',
          'Website screenshot failed because Browserless returned an empty image.',
          { requestId: requestLog?.requestId || null, variant: variant?.id || null }
        ),
      };
    }

    await finalizeBrowserlessRequestLog(requestLog?.requestRef, {
      status: 'succeeded',
      completedAt: fb.FieldValue.serverTimestamp(),
      durationMs: Date.now() - startedAt,
      httpStatus: response.status,
      ok: true,
      contentType,
      bytesReturned: buffer.length,
    });

    return {
      ok: true,
      buffer,
      contentType,
      extension: extensionForContentType(contentType),
      sizeBytes: buffer.length,
      requestId: requestLog?.requestId || null,
      variant: variant?.id || null,
    };
  } catch (error) {
    await finalizeBrowserlessRequestLog(requestLog?.requestRef, {
      status: 'failed',
      completedAt: fb.FieldValue.serverTimestamp(),
      durationMs: Date.now() - startedAt,
      ok: false,
      errorMessage: error.message,
    });
    throw error;
  }
}

async function persistWebsiteScreenshotArtifact({ clientId, runId, websiteUrl }) {
  const capturedAt = new Date().toISOString();

  try {
    const artifactRefs = [];
    const warnings = [];

    for (const variant of SCREENSHOT_VARIANTS) {
      const screenshot = await captureScreenshotBuffer({
        clientId,
        runId,
        targetUrl: websiteUrl,
        variant,
      });

      if (!screenshot.ok) {
        warnings.push(screenshot.warning);
        continue;
      }

      const artifactPath = path.posix.join(
        'clients',
        clientId,
        'brief-runs',
        runId,
        'artifacts',
        `homepage-screenshot-${variant.storageSuffix}.${screenshot.extension}`
      );

      const stored = await saveBufferArtifact({
        storagePath: artifactPath,
        buffer: screenshot.buffer,
        contentType: screenshot.contentType,
        metadata: {
          artifactType: 'website_homepage_screenshot',
          artifactVariant: variant.id,
          clientId,
          runId,
          sourceUrl: websiteUrl,
          capturedAt,
        },
      });

      artifactRefs.push({
        type: 'website_homepage_screenshot',
        variant: variant.id,
        viewportLabel: variant.label,
        storageProvider: 'firebase-storage',
        bucket: stored.bucket,
        storagePath: stored.storagePath,
        contentType: stored.contentType,
        sizeBytes: stored.sizeBytes,
        sourceUrl: websiteUrl,
        capturedAt,
        browserlessRequestId: screenshot.requestId || null,
        downloadUrl: stored.downloadUrl,
      });
    }

    if (artifactRefs.length === 0) {
      return {
        ok: false,
        warning: warnings[0] || buildWarning(
          'website_screenshot_failed',
          'Website screenshot capture failed for all viewport variants.',
          { stage: 'capture' }
        ),
      };
    }

    const primaryArtifactRef =
      artifactRefs.find((artifact) => artifact.variant === 'desktop') ||
      artifactRefs[0];

    return {
      ok: true,
      artifactRef: primaryArtifactRef,
      artifactRefs,
      warnings,
    };
  } catch (error) {
    return {
      ok: false,
      warning: buildWarning(
        'website_screenshot_failed',
        `Website screenshot capture failed: ${error.message}`,
        { stage: 'capture' }
      ),
    };
  }
}

module.exports = {
  getBrowserlessConfig,
  SCREENSHOT_VARIANTS,
  persistWebsiteScreenshotArtifact,
};
