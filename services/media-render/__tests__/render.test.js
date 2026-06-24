/**
 * Fixture-driven render test.
 *
 * If ffmpeg/ffprobe are on PATH, this really renders an MP4 from the committed
 * fixtures and asserts the output exists, is non-zero, and is 720x720.
 * If ffmpeg is absent, the render test SKIPS with a clear message (it is an
 * environment requirement, not a code failure). MediaStore unit tests run
 * regardless.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { renderRemix, LocalMediaStore, safeRelative } from '../index.js';

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'client-acme', 'media');

async function hasBinary(bin) {
  try {
    await execFileP(bin, ['-version']);
    return true;
  } catch {
    return false;
  }
}

async function probeDimensions(filePath) {
  const { stdout } = await execFileP('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0',
    filePath,
  ]);
  const [w, h] = stdout.trim().split(',').map((n) => parseInt(n, 10));
  return { width: w, height: h };
}

// --- MediaStore unit tests (no ffmpeg required) ---

test('MediaStore lists client-scoped folders and files', async () => {
  const store = new LocalMediaStore({ clientId: 'acme', rootDir: FIXTURE_ROOT });
  const folders = await store.listFolders();
  assert.ok(folders.includes('skyline'), 'expected skyline folder');
  assert.ok(folders.includes('neighborhood'), 'expected neighborhood folder');

  const files = await store.listFiles('skyline');
  assert.ok(files.some((f) => f.endsWith('.mp4')), 'expected a video in skyline');
  assert.equal(store.storagePrefix, 'clients/acme/media');
});

test('safeRelative rejects absolute paths and traversal', () => {
  assert.throws(() => safeRelative('/etc/passwd'), /Absolute/);
  assert.throws(() => safeRelative('../../secret'), /traversal/i);
  assert.equal(safeRelative('skyline/clip1.mp4'), path.join('skyline', 'clip1.mp4'));
});

// --- Render test (requires ffmpeg) ---

test('renderRemix produces a 720x720 MP4 from fixtures', async (t) => {
  const ffmpegOk = await hasBinary('ffmpeg');
  const ffprobeOk = await hasBinary('ffprobe');
  if (!ffmpegOk || !ffprobeOk) {
    t.skip('ffmpeg/ffprobe not on PATH — install a full FFmpeg build to run the render test');
    return;
  }

  // Render into an isolated temp dir so the committed fixtures stay clean.
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'media-render-test-'));
  const tmpMedia = path.join(tmpRoot, 'media');
  await fs.cp(path.join(FIXTURE_ROOT, 'source'), path.join(tmpMedia, 'source'), { recursive: true });

  const store = new LocalMediaStore({ clientId: 'acme', rootDir: tmpMedia });

  const recipe = {
    durationSeconds: 30,
    output: { width: 720, height: 720, fps: 30, format: 'mp4' },
    sourceFolders: ['skyline', 'neighborhood', 'stills'],
    filter: { key: 'look_hard_bw_street_doc', intensity: 0.8 },
    arweaveAudioUrl: 'store:audio/track.m4a',
  };

  const result = await renderRemix({
    clientId: 'acme',
    recipe,
    store,
    outputPath: 'job-test.mp4',
  });

  const stats = await fs.stat(result.absolutePath);
  assert.ok(stats.size > 0, 'output MP4 should be non-zero');
  assert.equal(result.contentType, 'video/mp4');
  assert.equal(result.storagePath, 'clients/acme/media/generated/job-test.mp4');

  const dims = await probeDimensions(result.absolutePath);
  assert.equal(dims.width, 720, 'output width should be 720');
  assert.equal(dims.height, 720, 'output height should be 720');

  await fs.rm(tmpRoot, { recursive: true, force: true });
});
