'use strict';

const path = require('path');
const { randomUUID } = require('crypto');
const fb = require('./firebase-admin.cjs');
const { saveBufferArtifact } = require('./storage-artifacts.cjs');
const { validateUrl } = require('./safe-fetch.cjs');

const DEFAULT_BASE_URL = 'https://production-sfo.browserless.io';
const DEFAULT_REQUEST_TIMEOUT_MS = 45000;
const DEFAULT_GOTO_TIMEOUT_MS = 15000;
const DEFAULT_POST_LOAD_WAIT_MS = 4000;
const SCREENSHOT_VARIANTS = [
  // Viewport screenshots — used for the multi-device mockup composite
  {
    id: 'desktop',
    label: 'Desktop',
    storageSuffix: 'desktop',
    fullPage: false,
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
    fullPage: false,
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
    id: 'tablet',
    label: 'Tablet',
    storageSuffix: 'tablet',
    fullPage: false,
    viewport: {
      width: 768,
      height: 1024,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      isLandscape: false,
    },
    primary: false,
  },
  // Full-page screenshots — used in the Multi-Device View tabs
  {
    id: 'desktop-full',
    label: 'Desktop Full Page',
    storageSuffix: 'desktop-full',
    fullPage: true,
    viewport: {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
      isLandscape: true,
    },
    primary: false,
  },
  {
    id: 'mobile-full',
    label: 'Mobile Full Page',
    storageSuffix: 'mobile-full',
    fullPage: true,
    viewport: {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      isLandscape: false,
    },
    primary: false,
  },
  {
    id: 'tablet-full',
    label: 'Tablet Full Page',
    storageSuffix: 'tablet-full',
    fullPage: true,
    viewport: {
      width: 768,
      height: 1024,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      isLandscape: false,
    },
    primary: false,
  },
];
const VIEWPORT_SCREENSHOT_VARIANTS = SCREENSHOT_VARIANTS.filter((variant) => !variant.fullPage);
const FULL_PAGE_SCREENSHOT_VARIANTS = SCREENSHOT_VARIANTS.filter((variant) => variant.fullPage);

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

function buildEndpointUrl(baseUrl, endpoint, token, requestTimeoutMs) {
  const url = new URL(`${baseUrl}${endpoint}`);
  url.searchParams.set('token', token);
  url.searchParams.set('timeout', String(requestTimeoutMs));
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

const RETRYABLE_BROWSERLESS_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const BROWSERLESS_MAX_ATTEMPTS = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureScreenshotBuffer(args) {
  const { onAttempt = null } = args || {};
  let lastResult = null;
  let lastError = null;
  for (let attempt = 1; attempt <= BROWSERLESS_MAX_ATTEMPTS; attempt += 1) {
    if (typeof onAttempt === 'function' && attempt > 1) {
      try { await onAttempt({ attempt, total: BROWSERLESS_MAX_ATTEMPTS }); } catch {}
    }
    let result;
    try {
      // eslint-disable-next-line no-await-in-loop
      result = await captureScreenshotBufferOnce({ ...args, attempt });
    } catch (err) {
      // Transport-level failures (AbortSignal timeout, network error) — retry.
      lastError = err;
      if (attempt >= BROWSERLESS_MAX_ATTEMPTS) throw err;
      // eslint-disable-next-line no-await-in-loop
      await sleep(1000 * attempt);
      continue;
    }
    if (result.ok) return result;
    lastResult = result;

    const code = result.warning?.code || '';
    const status = Number(result.warning?.httpStatus);
    const isRetryable =
      code === 'browserless_timeout' ||
      code === 'browserless_empty_response' ||
      (code === 'browserless_http_error' && RETRYABLE_BROWSERLESS_STATUSES.has(status));

    if (!isRetryable || attempt >= BROWSERLESS_MAX_ATTEMPTS) break;
    // eslint-disable-next-line no-await-in-loop
    await sleep(1000 * attempt); // 1s, 2s backoff
  }
  if (lastResult) return lastResult;
  throw lastError || new Error('Browserless capture failed without a result.');
}

async function captureScreenshotBufferOnce({ clientId, runId, targetUrl, variant, attempt = 1 }) {
  try {
    await validateUrl(targetUrl);
  } catch (err) {
    return {
      ok: false,
      warning: buildWarning(
        'unsafe_target_url',
        'Website screenshot skipped because the URL is not a safe public http(s) target.',
        { detail: err.message }
      ),
    };
  }

  // Sentinel: if this line does not show up in server logs, the dev server
  // has not reloaded this module — restart it.
  console.log(`[browserless:v2] capture attempt=${attempt} variant=${variant?.id} url=${targetUrl}`);
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

  // Give slow sites more time on retries — bump goto + request timeouts by 50% per attempt.
  const attemptMultiplier = 1 + 0.5 * (attempt - 1);
  const effectiveRequestTimeoutMs = Math.round(config.requestTimeoutMs * attemptMultiplier);
  const effectiveGotoTimeoutMs = Math.round(config.gotoTimeoutMs * attemptMultiplier);

  const endpoint = buildEndpointUrl(
    config.baseUrl,
    '/screenshot',
    config.token,
    effectiveRequestTimeoutMs
  );
  const startedAt = Date.now();
  let requestLog = null;

  try {
    requestLog = await createBrowserlessRequestLog({
      clientId,
      runId,
      websiteUrl: targetUrl,
      endpoint: 'screenshot',
      requestTimeoutMs: effectiveRequestTimeoutMs,
      variant,
    });
  } catch {
    requestLog = null;
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(effectiveRequestTimeoutMs + 5000),
      headers: {
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: targetUrl,
        bestAttempt: true,
        // Pass viewport in the body — Browserless v2 /screenshot expects it here,
        // not via the `launch` query param. A misplaced launch can queue the
        // request indefinitely and return 408.
        ...(variant?.viewport ? { viewport: variant.viewport } : null),
        gotoOptions: {
          // 'domcontentloaded' resolves reliably in seconds; 'networkidle2'
          // never resolves on modern sites with analytics/websockets/heartbeats.
          // The post-load wait below still lets JS-heavy sites paint before capture.
          waitUntil: attempt === 1 ? 'domcontentloaded' : 'load',
          timeout: effectiveGotoTimeoutMs,
        },
        // Wait for web fonts to finish loading before capture. 'domcontentloaded'
        // fires before custom @font-face files download, so without this the page
        // paints in a fallback font and the snapshot grabs the wrong typeface
        // (e.g. vivaacid.com). document.fonts.ready resolves once all faces are
        // loaded/applied. bestAttempt:true above keeps a timeout here non-fatal —
        // a slow/blocked font still yields a screenshot after the timeout.
        waitForFunction: {
          fn: 'async()=>{try{await document.fonts.ready;return true}catch{return true}}',
          timeout: effectiveGotoTimeoutMs,
        },
        // Extra paint buffer after fonts resolve, for JS-heavy late layout.
        waitForTimeout: config.postLoadWaitMs,
        options: {
          fullPage: Boolean(variant?.fullPage),
          type: 'jpeg',
          quality: 70,
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
          {
            httpStatus: response.status,
            requestId: requestLog?.requestId || null,
            ...(snippet ? { detail: snippet } : null),
          }
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

async function persistWebsiteScreenshotArtifact({
  clientId,
  runId,
  websiteUrl,
  variants = SCREENSHOT_VARIANTS,
  includeBuffers = false,
  includeBufferVariants = null,
  onVariantProgress = null,
}) {
  const capturedAt = new Date().toISOString();

  try {
    const artifactRefs = [];
    const warnings = [];

    for (const [index, variant] of variants.entries()) {
      if (typeof onVariantProgress === 'function') {
        try {
          await onVariantProgress({
            phase: 'start',
            variant,
            index,
            total: variants.length,
          });
        } catch {
          /* non-fatal progress hook */
        }
      }
      let screenshot;
      try {
        screenshot = await captureScreenshotBuffer({
          clientId,
          runId,
          targetUrl: websiteUrl,
          variant,
          onAttempt: async ({ attempt, total }) => {
            if (typeof onVariantProgress !== 'function') return;
            try {
              await onVariantProgress({
                phase: 'retry',
                variant,
                index,
                total: variants.length,
                attempt,
                totalAttempts: total,
              });
            } catch {}
          },
        });
      } catch (err) {
        screenshot = {
          ok: false,
          warning: buildWarning(
            'browserless_timeout',
            `Screenshot timed out for variant ${variant.id}: ${err.message}`,
            { variant: variant.id }
          ),
        };
      }

      if (!screenshot.ok) {
        warnings.push(screenshot.warning);
        if (typeof onVariantProgress === 'function') {
          try {
            await onVariantProgress({
              phase: 'failed',
              variant,
              index,
              total: variants.length,
              warning: screenshot.warning || null,
            });
          } catch {
            /* non-fatal progress hook */
          }
        }
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
        ...(includeBuffers && (!Array.isArray(includeBufferVariants) || includeBufferVariants.includes(variant.id))
          ? { buffer: screenshot.buffer }
          : {}),
      });

      if (typeof onVariantProgress === 'function') {
        try {
          await onVariantProgress({
            phase: 'stored',
            variant,
            index,
            total: variants.length,
          });
        } catch {
          /* non-fatal progress hook */
        }
      }
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

// ── Brief PDF rendering ──────────────────────────────────────────────────────
//
// Posts an HTML document to Browserless /pdf and persists the returned PDF
// buffer as a Firebase Storage artifact. Mirrors the screenshot flow.

function injectPdfPrintCss(html, mode = 'default') {
  if (mode !== 'edge-to-edge') return String(html || '');

  const printCss = `<style id="hitl-pdf-print-css">
@page { size: 1200px 1697px; margin: 0; }
html,
body {
  width: 1200px !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: visible !important;
}
html {
  background: transparent !important;
}
body {
  min-width: 1200px !important;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}
body,
body::before,
body::after,
.shell,
main {
  max-width: none !important;
}
.shell,
main {
  width: 1200px !important;
  margin: 0 !important;
  padding: 0 !important;
}
section.page,
.page,
.pdf-page,
.slide,
[data-pdf-page],
body > header,
main > header,
.shell > header,
body > main > section,
main > section,
.shell > section,
.shell > .section {
  width: 1200px !important;
  max-width: none !important;
  min-height: 1697px !important;
  margin: 0 !important;
  box-sizing: border-box !important;
  break-inside: avoid-page !important;
  page-break-inside: avoid !important;
  break-after: page !important;
  page-break-after: always !important;
  overflow: hidden !important;
}
section.page:last-child,
.page:last-child,
.pdf-page:last-child,
.slide:last-child,
[data-pdf-page]:last-child,
body > header:last-child,
main > header:last-child,
.shell > header:last-child,
body > main > section:last-child,
main > section:last-child,
.shell > section:last-child,
.shell > .section:last-child {
  break-after: auto !important;
  page-break-after: auto !important;
}
img,
svg,
canvas,
video {
  max-width: 100% !important;
}
table {
  break-inside: avoid-page !important;
  page-break-inside: avoid !important;
}
</style>`;
  const body = String(html || '');
  if (/<head[^>]*>/i.test(body)) {
    return body.replace(/<head([^>]*)>/i, `<head$1>\n${printCss}\n`);
  }
  if (/<html[^>]*>/i.test(body)) {
    return body.replace(/<html([^>]*)>/i, `<html$1>\n<head>\n${printCss}\n</head>\n`);
  }
  return `<!doctype html><html><head>${printCss}</head><body>${body}</body></html>`;
}

function pdfOptionsForMode(mode = 'default') {
  if (mode === 'edge-to-edge') {
    return {
      width: '1200px',
      height: '1697px',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      scale: 1,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    };
  }

  return {
    format: 'A4',
    printBackground: true,
    margin: { top: '16mm', right: '14mm', bottom: '16mm', left: '14mm' },
  };
}

async function renderPdfBuffer({ clientId, runId, html, pdfMode = 'default' }) {
  const config = getBrowserlessConfig();
  if (!config.enabled) {
    return {
      ok: false,
      warning: buildWarning(
        'browserless_not_configured',
        'Brief PDF render skipped because Browserless is not configured.'
      ),
    };
  }

  const endpoint = buildEndpointUrl(config.baseUrl, '/pdf', config.token, config.requestTimeoutMs);
  const startedAt = Date.now();
  let requestLog = null;

  try {
    requestLog = await createBrowserlessRequestLog({
      clientId,
      runId,
      websiteUrl: null,
      endpoint: 'pdf',
      requestTimeoutMs: config.requestTimeoutMs,
      variant: null,
    });
  } catch {
    requestLog = null;
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(config.requestTimeoutMs + 5000),
      headers: {
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        html: injectPdfPrintCss(html, pdfMode),
        options: pdfOptionsForMode(pdfMode),
        gotoOptions: { waitUntil: 'networkidle2', timeout: config.gotoTimeoutMs },
        waitForTimeout: config.postLoadWaitMs,
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
          `Brief PDF render failed with Browserless HTTP ${response.status}.`,
          snippet ? { detail: snippet, requestId: requestLog?.requestId || null } : { requestId: requestLog?.requestId || null }
        ),
      };
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (!buffer.length) {
      await finalizeBrowserlessRequestLog(requestLog?.requestRef, {
        status: 'failed',
        completedAt: fb.FieldValue.serverTimestamp(),
        durationMs: Date.now() - startedAt,
        httpStatus: response.status,
        ok: false,
        errorMessage: 'Empty PDF response',
      });
      return {
        ok: false,
        warning: buildWarning(
          'browserless_empty_response',
          'Brief PDF render failed because Browserless returned an empty document.',
          { requestId: requestLog?.requestId || null }
        ),
      };
    }

    await finalizeBrowserlessRequestLog(requestLog?.requestRef, {
      status: 'succeeded',
      completedAt: fb.FieldValue.serverTimestamp(),
      durationMs: Date.now() - startedAt,
      httpStatus: response.status,
      ok: true,
      contentType: 'application/pdf',
      bytesReturned: buffer.length,
    });

    return {
      ok: true,
      buffer,
      contentType: 'application/pdf',
      sizeBytes: buffer.length,
      requestId: requestLog?.requestId || null,
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

function safePdfFileName(fileName) {
  const base = String(fileName || 'brief.pdf')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '');
  const withExtension = /\.pdf$/i.test(base) ? base : `${base || 'brief'}.pdf`;
  return withExtension.slice(0, 140);
}

async function persistBriefPdfArtifact({
  clientId,
  runId,
  html,
  fileName = 'brief.pdf',
  storageClientKey = null,
  storageBriefKey = null,
  pdfMode = 'default',
}) {
  const renderedAt = new Date().toISOString();

  try {
    const rendered = await renderPdfBuffer({ clientId, runId, html, pdfMode });

    if (!rendered.ok) {
      return { ok: false, warning: rendered.warning };
    }

    const storagePath = path.posix.join(
      'clients',
      storageClientKey || clientId,
      'brief-runs',
      storageBriefKey || runId,
      'artifacts',
      safePdfFileName(fileName)
    );

    const stored = await saveBufferArtifact({
      storagePath,
      buffer: rendered.buffer,
      contentType: rendered.contentType,
      metadata: {
        artifactType: 'brief_pdf',
        clientId,
        storageClientKey: storageClientKey || clientId,
        storageBriefKey: storageBriefKey || runId,
        runId,
        fileName: safePdfFileName(fileName),
        renderedAt,
      },
    });

    return {
      ok: true,
      artifactRef: {
        type: 'brief_pdf',
        storageProvider: 'firebase-storage',
        bucket: stored.bucket,
        storagePath: stored.storagePath,
        contentType: stored.contentType,
        fileName: safePdfFileName(fileName),
        sizeBytes: stored.sizeBytes,
        renderedAt,
        browserlessRequestId: rendered.requestId || null,
        downloadUrl: stored.downloadUrl,
      },
    };
  } catch (error) {
    return {
      ok: false,
      warning: buildWarning(
        'brief_pdf_failed',
        `Brief PDF render failed: ${error.message}`,
        { stage: 'brief' }
      ),
    };
  }
}

/**
 * Fetch JS-rendered HTML via Browserless `/content`. Logs every attempt to the
 * `browserless_requests` collection so the OpsOverview dashboard reflects all
 * Browserless usage (not just screenshots and PDFs).
 *
 * Returns { ok: true, html, bytes, durationMs } on success,
 *         { ok: false, reason, durationMs } when Browserless is not configured
 *           or the request fails. Never throws.
 */
async function fetchBrowserlessContent({
  url,
  clientId = null,
  runId = null,
  variant = null,
  gotoTimeoutMs: gotoTimeoutOverride = null,
  postLoadWaitMs: postLoadWaitOverride = null,
} = {}) {
  if (!url) {
    return { ok: false, reason: 'no_url', durationMs: 0 };
  }

  const config = getBrowserlessConfig();
  if (!config.enabled) {
    return { ok: false, reason: config.reason || 'browserless_disabled', durationMs: 0 };
  }

  const endpoint = '/content';
  const endpointUrl = buildEndpointUrl(config.baseUrl, endpoint, config.token, config.requestTimeoutMs);
  const gotoTimeoutMs = Number.isFinite(gotoTimeoutOverride) ? gotoTimeoutOverride : config.gotoTimeoutMs;
  const postLoadWaitMs = Number.isFinite(postLoadWaitOverride) ? postLoadWaitOverride : config.postLoadWaitMs;

  const { requestRef } = await createBrowserlessRequestLog({
    clientId,
    runId,
    websiteUrl: url,
    endpoint,
    requestTimeoutMs: config.requestTimeoutMs,
    variant,
  });

  const startedAt = Date.now();
  try {
    const res = await fetch(endpointUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(config.requestTimeoutMs + 5_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        gotoOptions: { waitUntil: 'domcontentloaded', timeout: gotoTimeoutMs },
        waitForTimeout: postLoadWaitMs,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const durationMs = Date.now() - startedAt;
      await finalizeBrowserlessRequestLog(requestRef, {
        status: 'failed',
        httpStatus: res.status,
        durationMs,
        errorMessage: errText.slice(0, 400) || `HTTP ${res.status}`,
      });
      return { ok: false, reason: `http_${res.status}`, durationMs };
    }

    const html = await res.text();
    const durationMs = Date.now() - startedAt;
    const bytes = Buffer.byteLength(html || '', 'utf8');
    await finalizeBrowserlessRequestLog(requestRef, {
      status: 'succeeded',
      httpStatus: res.status,
      durationMs,
      bytesReturned: bytes,
    });
    return { ok: true, html, bytes, durationMs };

  } catch (err) {
    const durationMs = Date.now() - startedAt;
    await finalizeBrowserlessRequestLog(requestRef, {
      status: 'failed',
      durationMs,
      errorMessage: String(err?.message || err).slice(0, 400),
    });
    return { ok: false, reason: 'fetch_error', durationMs };
  }
}

module.exports = {
  getBrowserlessConfig,
  SCREENSHOT_VARIANTS,
  VIEWPORT_SCREENSHOT_VARIANTS,
  FULL_PAGE_SCREENSHOT_VARIANTS,
  captureScreenshotBuffer,
  persistWebsiteScreenshotArtifact,
  renderPdfBuffer,
  persistBriefPdfArtifact,
  fetchBrowserlessContent,
};
