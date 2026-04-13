'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');
const { downloadArtifactToFile, saveBufferArtifact } = require('./storage-artifacts.cjs');

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT_PATH = path.join(ROOT, 'scripts', 'generate_device_mockup.py');
const TEMPLATE_PATH = path.join(ROOT, 'public', 'img', 'device_template.png');
const SCRIPT_TIMEOUT_MS = 90_000;
const PYTHON_BIN = require('fs').existsSync(path.join(ROOT, '.venv', 'bin', 'python3'))
  ? path.join(ROOT, '.venv', 'bin', 'python3')
  : 'python3';

const REQUIRED_VARIANTS = {
  desktop: 'desktop',
  ipad: 'ipad',
  iphone: 'mobile',
};

function buildWarning(code, message, extra = {}) {
  return {
    type: 'warning',
    code,
    message,
    ...extra,
  };
}

async function generateWebsiteMockupArtifact({
  clientId,
  runId,
  websiteUrl,
  screenshotArtifactRefs,
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

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'device-mockup-'));
  const inputDir = path.join(tempRoot, 'input');
  const outputDir = path.join(tempRoot, 'output');
  const localOutputPath = path.join(outputDir, 'final_mockup.png');
  const capturedAt = new Date().toISOString();

  try {
    await fs.mkdir(inputDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });

    await Promise.all(
      Object.entries(REQUIRED_VARIANTS).map(([targetName, sourceVariant]) => {
        const artifact = byVariant[sourceVariant];
        return downloadArtifactToFile({
          bucketName: artifact.bucket || null,
          storagePath: artifact.storagePath,
          destination: path.join(inputDir, `${targetName}.png`),
        });
      })
    );

    await execFileAsync(
      PYTHON_BIN,
      [
        SCRIPT_PATH,
        '--desktop', path.join(inputDir, 'desktop.png'),
        '--ipad', path.join(inputDir, 'ipad.png'),
        '--iphone', path.join(inputDir, 'iphone.png'),
        '--template', TEMPLATE_PATH,
        '--output', localOutputPath,
      ],
      {
        cwd: ROOT,
        timeout: SCRIPT_TIMEOUT_MS,
      }
    );

    const buffer = await fs.readFile(localOutputPath);
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
        localPublicPath: '/output/final_mockup.png',
      },
    };
  } catch (error) {
    return {
      ok: false,
      warning: buildWarning(
        'mockup_generation_failed',
        `Mockup generation failed: ${error.message}`,
        { stage: 'compose' }
      ),
    };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  generateWebsiteMockupArtifact,
};
