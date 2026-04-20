'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { downloadArtifactToFile, saveBufferArtifact } = require('./storage-artifacts.cjs');

const TEMPLATE_PATH = path.join(process.cwd(), 'api', '_lib', 'assets', 'device_template.png');

const REQUIRED_VARIANTS = {
  desktop: 'desktop',
  ipad: 'tablet',
  iphone: 'mobile',
};

const SCREEN_BOXES = {
  desktop: { left: 159, top: 145, width: 707, height: 418, radius: 0 },
  ipad: { left: 887, top: 308, width: 298, height: 437, radius: 7 },
  iphone: { left: 1254, top: 470, width: 138, height: 307, radius: 11 },
};
const DOWNLOAD_RETRY_DELAYS_MS = [400, 900, 1800, 3200];

function buildWarning(code, message, extra = {}) {
  return {
    type: 'warning',
    code,
    message,
    ...extra,
  };
}

function roundedRectSvg(width, height, radius) {
  const safeRadius = Math.max(0, Math.min(radius || 0, Math.floor(Math.min(width, height) / 2)));
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect x="0" y="0" width="${width}" height="${height}" rx="${safeRadius}" ry="${safeRadius}" fill="white"/>` +
    `</svg>`
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadArtifactToFileWithRetry({
  bucketName,
  storagePath,
  destination,
}) {
  let lastError = null;
  for (let attempt = 0; attempt <= DOWNLOAD_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await downloadArtifactToFile({ bucketName, storagePath, destination });
      return destination;
    } catch (error) {
      lastError = error;
      if (attempt === DOWNLOAD_RETRY_DELAYS_MS.length) break;
      await sleep(DOWNLOAD_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError || new Error('Artifact download failed.');
}

async function renderScreenBuffer(input, box) {
  let pipeline = sharp(input)
    .resize(box.width, box.height, {
      fit: 'cover',
      position: 'north',
    })
    .png();

  if (box.radius > 0) {
    pipeline = pipeline.composite([
      {
        input: roundedRectSvg(box.width, box.height, box.radius),
        blend: 'dest-in',
      },
    ]);
  }

  return pipeline.toBuffer();
}

async function generateWebsiteMockupArtifact({
  clientId,
  runId,
  websiteUrl,
  screenshotArtifactRefs,
  screenshotBuffersByVariant = null,
}) {
  const artifacts = Array.isArray(screenshotArtifactRefs) ? screenshotArtifactRefs : [];
  const byVariant = Object.fromEntries(
    artifacts
      .filter((artifact) => artifact?.type === 'website_homepage_screenshot' && artifact?.variant)
      .map((artifact) => [artifact.variant, artifact])
  );

  const missing = Object.entries(REQUIRED_VARIANTS)
    .filter(([, sourceVariant]) => !byVariant[sourceVariant])
    .map(([targetName]) => targetName);

  if (missing.length > 0) {
    return {
      ok: false,
      warning: buildWarning(
        'mockup_source_missing',
        `Mockup generation skipped because required screenshots are missing: ${missing.join(', ')}.`
      ),
    };
  }

  const hasInMemoryBuffers = Object.values(REQUIRED_VARIANTS).every((sourceVariant) =>
    screenshotBuffersByVariant && Buffer.isBuffer(screenshotBuffersByVariant[sourceVariant])
  );
  const tempRoot = hasInMemoryBuffers ? null : await fs.mkdtemp(path.join(os.tmpdir(), 'device-mockup-'));
  const inputDir = tempRoot ? path.join(tempRoot, runId) : null;
  const capturedAt = new Date().toISOString();

  try {
    const composites = await Promise.all(
      Object.entries(SCREEN_BOXES).map(async ([deviceName, box]) => {
        const inMemoryBuffer =
          screenshotBuffersByVariant &&
          Buffer.isBuffer(screenshotBuffersByVariant[REQUIRED_VARIANTS[deviceName]])
            ? screenshotBuffersByVariant[REQUIRED_VARIANTS[deviceName]]
            : null;
        let source = inMemoryBuffer;
        if (!source) {
          if (!inputDir) {
            throw new Error(`Missing in-memory screenshot buffer for ${deviceName}.`);
          }
          await fs.mkdir(inputDir, { recursive: true });
          const artifact = byVariant[REQUIRED_VARIANTS[deviceName]];
          const destination = path.join(inputDir, `${deviceName}.png`);
          await downloadArtifactToFileWithRetry({
            bucketName: artifact.bucket || null,
            storagePath: artifact.storagePath,
            destination,
          });
          source = destination;
        }
        return {
        input: await renderScreenBuffer(source, box),
        left: box.left,
        top: box.top,
        };
      })
    );

    const buffer = await sharp(TEMPLATE_PATH)
      .composite(composites)
      .png()
      .toBuffer();

    const storagePath = path.posix.join(
      'clients',
      clientId,
      'brief-runs',
      runId,
      'artifacts',
      'homepage-device-mockup.png'
    );

    const stored = await saveBufferArtifact({
      storagePath,
      buffer,
      contentType: 'image/png',
      metadata: {
        artifactType: 'website_homepage_device_mockup',
        clientId,
        runId,
        sourceUrl: websiteUrl,
        capturedAt,
        sourceVariants: Object.values(REQUIRED_VARIANTS).join(','),
      },
    });

    return {
      ok: true,
      artifactRef: {
        type: 'website_homepage_device_mockup',
        storageProvider: 'firebase-storage',
        bucket: stored.bucket,
        storagePath: stored.storagePath,
        contentType: stored.contentType,
        sizeBytes: stored.sizeBytes,
        sourceUrl: websiteUrl,
        capturedAt,
        downloadUrl: stored.downloadUrl,
        sourceVariants: Object.values(REQUIRED_VARIANTS),
      },
    };
  } catch (error) {
    console.error('[device-mockup] compose failed', {
      clientId,
      runId,
      message: error?.message,
      stack: error?.stack,
    });
    return {
      ok: false,
      warning: buildWarning(
        'mockup_generation_failed',
        `Mockup generation failed: ${error.message}`,
        { stage: 'compose', detail: error?.stack || null }
      ),
    };
  } finally {
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
}

module.exports = {
  generateWebsiteMockupArtifact,
};
