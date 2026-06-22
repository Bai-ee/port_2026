// HTTP service wrapping renderVideo(). Vercel calls POST /render with a shared
// secret; returns the WebM bytes. Concurrency-capped to protect GPU spend.

import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderVideo } from './render.mjs';

// Headless Chromium here has no proprietary H.264 encoder, so scene.mjs falls
// back to VP9/WebM. X (and most social platforms) only accept H.264/MP4, so we
// transcode WebM → MP4 with ffmpeg before returning the bytes. Video-only
// (renders carry no audio); faststart + yuv420p for broad/web compatibility.
async function transcodeWebmToMp4(webmBuffer) {
  const base = join(tmpdir(), `studio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const inPath = `${base}.webm`;
  const outPath = `${base}.mp4`;
  await writeFile(inPath, webmBuffer);
  try {
    await new Promise((resolve, reject) => {
      execFile('ffmpeg', [
        '-y', '-i', inPath,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
        outPath,
      ], { timeout: 120000, maxBuffer: 1024 * 1024 }, (err, _out, stderr) => {
        if (err) reject(new Error(`ffmpeg failed: ${err.message} ${String(stderr).slice(-400)}`));
        else resolve();
      });
    });
    return await readFile(outPath);
  } finally {
    unlink(inPath).catch(() => {});
    unlink(outPath).catch(() => {});
  }
}

// One-time GPU/driver diagnostic at boot. Tells us from Cloud Run logs whether the
// L4 + its Vulkan ICD are actually reachable inside the container (the prerequisite
// for ANGLE-Vulkan to drive WebGL instead of falling back to SwiftShader).
function bootGpuDiag() {
  const run = (cmd, args) => new Promise(r => {
    execFile(cmd, args, { timeout: 8000 }, (e, out, err) => r(e ? `(${cmd} unavailable: ${e.message})` : String(out || err).trim()));
  });
  const grepLibs = () => new Promise(r => {
    execFile('bash', ['-lc', "ls -1 /usr/local/nvidia/lib64 2>/dev/null | grep -iE 'egl|glx|vulkan|gles' | tr '\\n' ' '"], { timeout: 8000 }, (e, out) => r(e ? `(err: ${e.message})` : String(out).trim() || '(none)'));
  });
  Promise.all([
    run('nvidia-smi', ['-L']),
    run('vulkaninfo', ['--summary']),
    run('ls', ['-1', '/usr/share/vulkan/icd.d']),
    grepLibs(),
  ]).then(([smi, vk, icd, libs]) => {
    console.log(`[diag] LD_LIBRARY_PATH=${process.env.LD_LIBRARY_PATH || '(unset)'}`);
    console.log(`[diag] nvidia-smi: ${smi.split('\n')[0]}`);
    console.log(`[diag] nvidia GL/EGL/Vulkan libs: ${libs}`);
    console.log(`[diag] vulkan ICDs: ${icd.replace(/\n/g, ', ')}`);
    const gpuLine = (vk.match(/GPU\d.*|deviceName\s*=.*/i) || ['(no GPU line)'])[0];
    console.log(`[diag] vulkaninfo: ${gpuLine}`);
  }).catch(e => console.log(`[diag] failed: ${e.message}`));
}

const PORT = Number(process.env.PORT) || 8080;
const SECRET = process.env.RENDER_SHARED_SECRET || '';
const MAX_CONCURRENCY = Math.max(1, Number(process.env.MAX_CONCURRENCY) || 1);
const EXIT_AFTER_RENDER = /^(1|true|yes)$/i.test(process.env.EXIT_AFTER_RENDER || '');

// Hard caps live in recipe.mjs (normalizeRecipe clamps seconds/fps/res/etc.),
// so a bad request can't run away with GPU time.
let active = 0;
let shuttingDown = false;
let server;

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'cache-control': 'no-store', ...headers });
  res.end(body);
}

function shutdownSoon(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${reason}`);
  const forceExit = setTimeout(() => process.exit(0), 5000);
  server?.close(() => {
    clearTimeout(forceExit);
    process.exit(0);
  });
}

function exitAfterResponse(res, reason) {
  if (!EXIT_AFTER_RENDER) return;
  res.once('finish', () => {
    setTimeout(() => shutdownSoon(reason), 250);
  });
}

function sendRender(res, code, body, headers = {}) {
  send(res, code, body, headers);
  exitAfterResponse(res, 'render request complete');
}

server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, JSON.stringify({ ok: true, active, max: MAX_CONCURRENCY, exitAfterRender: EXIT_AFTER_RENDER }), { 'content-type': 'application/json' });

  if (req.method !== 'POST' || req.url !== '/render') return send(res, 404, 'not found');
  if (shuttingDown) return sendRender(res, 503, JSON.stringify({ error: 'shutting down' }), { 'content-type': 'application/json' });

  if (SECRET && req.headers['x-render-secret'] !== SECRET) return sendRender(res, 401, JSON.stringify({ error: 'unauthorized' }), { 'content-type': 'application/json' });
  if (active >= MAX_CONCURRENCY) return sendRender(res, 429, JSON.stringify({ error: 'busy', active }), { 'content-type': 'application/json' });

  let body = '';
  req.on('data', c => { body += c; if (body.length > 262144) req.destroy(); }); // recipes carry a camera track — allow 256KB
  req.on('end', async () => {
    let recipe;
    try { recipe = JSON.parse(body || '{}'); } catch { return sendRender(res, 400, JSON.stringify({ error: 'invalid json' }), { 'content-type': 'application/json' }); }
    if (!/^https?:\/\/\S+$/i.test(String(recipe.url || ''))) return sendRender(res, 400, JSON.stringify({ error: 'valid url required' }), { 'content-type': 'application/json' });

    active += 1;
    const t0 = Date.now();
    try {
      let { buffer, info } = await renderVideo(recipe); // normalizeRecipe clamps inside
      // Transcode WebM → MP4 so the stored asset is X-postable. Best-effort: if
      // ffmpeg fails, fall back to shipping the original WebM rather than failing
      // the whole render.
      if (info.container === 'webm') {
        try {
          const t1 = Date.now();
          buffer = await transcodeWebmToMp4(buffer);
          info = { ...info, container: 'mp4', transcoded: 'webm->mp4', transcodeMs: Date.now() - t1, sizeKB: Math.round(buffer.length / 1024) };
          console.log(`[render] transcoded webm->mp4 in ${info.transcodeMs}ms (${info.sizeKB}KB)`);
        } catch (txErr) {
          info = { ...info, transcodeError: String(txErr.message || txErr) };
          console.error(`[render] transcode failed, shipping webm: ${txErr.message}`);
        }
      }
      const videoContentType = info.container === 'webm' ? 'video/webm' : 'video/mp4';
      // Strip CR/LF so a multi-line ffmpeg error in `info` can't corrupt the header.
      const infoHeader = JSON.stringify(info).replace(/[\r\n]+/g, ' ');
      sendRender(res, 200, buffer, { 'content-type': videoContentType, 'x-render-ms': String(Date.now() - t0), 'x-render-info': infoHeader });
      console.log(`[render] ok ${recipe.url} ${Date.now() - t0}ms ${JSON.stringify(info)}`);
    } catch (err) {
      sendRender(res, 500, JSON.stringify({ error: String(err.message || err) }), { 'content-type': 'application/json' });
      console.error(`[render] fail ${recipe.url}: ${err.message}`);
    } finally {
      active -= 1;
    }
  });
});

process.once('SIGTERM', () => shutdownSoon('SIGTERM'));
process.once('SIGINT', () => shutdownSoon('SIGINT'));

server.listen(PORT, () => console.log(`studio-render listening on :${PORT} (max concurrency ${MAX_CONCURRENCY}, auth ${SECRET ? 'on' : 'OFF'}, exit after render ${EXIT_AFTER_RENDER ? 'on' : 'off'})`));
bootGpuDiag();
