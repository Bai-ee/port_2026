#!/usr/bin/env node
// Spike: verify Browserless cloud Chromium can run WebGL + MediaRecorder and
// return a non-empty WebM. This isolates the single biggest risk for the
// headless Mockup Studio auto-capture feature BEFORE building anything.
//
// Run: node scripts/spike-browserless-webgl.mjs
// Writes: scripts/spike-output.webm  (if recording succeeds)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// ── Load BROWSERLESS_* from process.env, falling back to .env.local ──────────
function loadEnv() {
  if (process.env.BROWSERLESS_TOKEN) return;
  try {
    const raw = readFileSync(join(repoRoot, '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* no .env.local — rely on process.env */
  }
}
loadEnv();

const TOKEN = String(process.env.BROWSERLESS_TOKEN || '').trim();
const BASE = String(process.env.BROWSERLESS_BASE_URL || 'https://production-sfo.browserless.io')
  .trim()
  .replace(/\/+$/, '');

if (!TOKEN) {
  console.error('✗ BROWSERLESS_TOKEN not found in env or .env.local');
  process.exit(1);
}

// ── Browserless /function payload ────────────────────────────────────────────
// Runs in their cloud Chromium. Builds a canvas, queries the WebGL renderer
// string (tells us GPU vs SwiftShader), animates ~3s, records via MediaRecorder.
const code = `
export default async function ({ page }) {
  await page.setContent('<!doctype html><html><body style="margin:0"><canvas id="c" width="640" height="360"></canvas></body></html>');
  const result = await page.evaluate(async () => {
    const canvas = document.getElementById('c');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const webglSupported = !!gl;
    let renderer = 'none';
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
    }
    const recSupported = typeof MediaRecorder !== 'undefined' && typeof canvas.captureStream === 'function';
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      .find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) || null;

    const diag = { webglSupported, renderer, recSupported, mime, size: 0, b64: null, frames: 0 };
    if (!gl || !recSupported || !mime) return diag;

    const stream = canvas.captureStream(30);
    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2000000 });
    const done = new Promise((resolve) => {
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = resolve;
    });
    rec.start(100);

    let frames = 0;
    const start = performance.now();
    await new Promise((resolve) => {
      function frame() {
        const t = (performance.now() - start) / 1000;
        gl.clearColor(Math.abs(Math.sin(t * 2)), 0.2, 0.5, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        frames++;
        if (t < 3) requestAnimationFrame(frame);
        else { rec.stop(); resolve(); }
      }
      requestAnimationFrame(frame);
    });
    await done;

    const blob = new Blob(chunks, { type: mime });
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    diag.size = bytes.length;
    diag.frames = frames;
    diag.b64 = btoa(bin);
    return diag;
  });
  return { data: result, type: 'application/json' };
}
`;

const endpoint = `${BASE}/function?token=${encodeURIComponent(TOKEN)}&timeout=60000`;

console.log(`→ POST ${BASE}/function  (60s timeout)`);
const t0 = Date.now();

let res;
try {
  res = await fetch(endpoint, {
    method: 'POST',
    signal: AbortSignal.timeout(70000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
} catch (err) {
  console.error(`✗ Request failed: ${err.message}`);
  process.exit(1);
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

if (!res.ok) {
  const body = await res.text().catch(() => '');
  console.error(`✗ HTTP ${res.status} after ${elapsed}s\n${body.slice(0, 600)}`);
  process.exit(1);
}

const payload = await res.json().catch(() => null);
const data = payload?.data ?? payload;
if (!data) {
  console.error('✗ No data in response:', JSON.stringify(payload).slice(0, 400));
  process.exit(1);
}

console.log(`\n── Browserless cloud Chromium capability (${elapsed}s) ──`);
console.log(`WebGL supported : ${data.webglSupported}`);
console.log(`GL renderer     : ${data.renderer}`);
console.log(`MediaRecorder   : ${data.recSupported}`);
console.log(`WebM mime       : ${data.mime || 'NONE'}`);
console.log(`Frames rendered : ${data.frames}`);
console.log(`WebM size       : ${(data.size / 1024).toFixed(1)} KB`);

if (data.size > 0 && data.b64) {
  const out = join(__dirname, 'spike-output.webm');
  writeFileSync(out, Buffer.from(data.b64, 'base64'));
  console.log(`\n✓ Wrote ${out} — open it to judge frame quality.`);
  const swiftshader = /swiftshader|software|llvmpipe/i.test(data.renderer || '');
  console.log(swiftshader
    ? '\n⚠ Renderer is SOFTWARE (SwiftShader). WebGL works but may be slow/janky for the real scene. Judge spike-output.webm before committing to Option A.'
    : '\n✓ Hardware-ish renderer reported. Promising for Option A.');
} else {
  console.error('\n✗ Empty recording — MediaRecorder/WebGL path not viable in this Browserless plan. Pivot to Option C (frame-by-frame + ffmpeg).');
  process.exit(1);
}
