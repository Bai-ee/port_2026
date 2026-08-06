// serve-and-capture.mjs — Slice 4b feasibility spike driver. LOCAL ONLY: a
// 127.0.0.1-bound static file server (no external network) + a headless
// Playwright Chromium instance (no Cloud Run, no GPU, no billing). Proves
// scene.html's fixed-timestep + seeded-texture pattern renders byte-
// identical frames across repeated runs.
//
// Not imported by, and does not modify, recipe.mjs/scene.mjs/render.mjs/
// server.mjs (the live Video Promo pipeline) or ClothStudio.jsx.

import { createServer } from 'node:http';
import { readFile, mkdtemp, cp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THREE_MODULE_SRC = path.resolve(__dirname, '../../../node_modules/three/build/three.module.min.js');

const CONTENT_TYPES = { '.html': 'text/html', '.js': 'text/javascript' };

async function startLocalStaticServer(rootDir) {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = new URL(req.url, 'http://127.0.0.1').pathname;
      const filePath = path.join(rootDir, decodeURIComponent(urlPath));
      if (!filePath.startsWith(rootDir)) { res.writeHead(403); res.end(); return; }
      const body = await readFile(filePath);
      res.writeHead(200, { 'content-type': CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

/**
 * Runs `scene.html` headlessly for `frameCount` fixed-timestep frames at the
 * given seed, returning each frame's PNG data URL plus a sha256 hash of each.
 * Every internal step (temp dir, static server, browser) is local-only and
 * torn down before returning.
 */
export async function runHeadlessFixedTimestepSpike({ seed = 1, frameCount = 5 } = {}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'studio-render-spike-4b-'));
  let server;
  let browser;
  try {
    await cp(path.join(__dirname, 'scene.html'), path.join(tempDir, 'scene.html'));
    await cp(THREE_MODULE_SRC, path.join(tempDir, 'three.module.min.js'));

    ({ server } = await startLocalStaticServer(tempDir));
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/scene.html?seed=${seed}`);
    await page.waitForFunction(() => window.__sceneReady === true);

    const frames = [];
    for (let i = 0; i < frameCount; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- frames must render in
      // strict sequence (each depends only on its own frame index, but the
      // page's WebGL context is single-threaded/stateful; no benefit to
      // parallelizing and real risk of readback races if we did).
      const dataUrl = await page.evaluate((idx) => window.__renderFrame(idx), i);
      frames.push(dataUrl);
    }

    const hashes = frames.map((dataUrl) => createHash('sha256').update(dataUrl).digest('hex'));
    return { frames, hashes };
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(tempDir, { recursive: true, force: true });
  }
}
