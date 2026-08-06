// Render core: drives a GPU headless Chrome via raw CDP (no puppeteer dep) to
// produce a Mockup Studio video from a normalized recipe. Screencasts the live
// target site (incl. its WebGL hero — real GPU only), optionally scrolls to a
// recipe-specified target with one smooth pre-measured glide, renders the 3D
// device scene + WebCodecs CFR export, and returns the WebM as a Buffer.
//
// Host-agnostic: Chrome binary + GPU flags come from env so the same image runs
// on Cloud Run / Fly / Modal / Runpod with only config changes.

import { spawn } from 'node:child_process';
import { rmSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { buildSceneHtml } from './scene.mjs';
import { normalizeRecipe, isValidUrl } from './recipe.mjs';
// Extracted (moved, not rewritten — see that file's own header comment) into
// a shared module so the NEW Studio device-screen-live capture path
// (art-render.mjs → live-site-capture.mjs's captureDeviceLiveFrames) reuses
// this exact, proven probe/readiness/settle logic instead of re-deriving it.
// Byte-identical behavior here: same functions, same call sites, only their
// definition moved.
import {
  CAPTURE_VIEWPORTS, probeExpression, waitForCaptureReady, settleStuckPage,
  chromeGpuLaunchArgs, probeGpuRenderer,
} from './live-site-capture.mjs';

const CHROME_PATH = process.env.CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; // local default; Linux containers set CHROME_PATH

const USE_XVFB = /^(1|true|yes)$/i.test(process.env.USE_XVFB || '');
const DEVTOOLS_TIMEOUT_MS = 45000;

function minimalCdpClient(url) {
  const ws = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); }
    else if (m.method) { for (const l of listeners) l(m); }
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  return { ready, send, on: (fn) => listeners.push(fn), close: () => ws.close() };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function removeUserDataDir(userDataDir) {
  try {
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (err) {
    console.warn(`[cleanup] could not remove ${userDataDir}: ${err.message}`);
  }
}

async function stopChrome(chrome, userDataDir) {
  if (!chrome || chrome.exitCode !== null || chrome.signalCode) {
    removeUserDataDir(userDataDir);
    return;
  }

  await new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceKill);
      resolve();
    };
    const forceKill = setTimeout(() => {
      try { chrome.kill('SIGKILL'); } catch {}
    }, 2500);

    chrome.once('exit', done);

    try { chrome.kill('SIGTERM'); } catch { done(); }
  });

  removeUserDataDir(userDataDir);
}

function spawnChrome(userDataDir, chromeEnv) {
  const chrome = spawn(CHROME_PATH, [
    ...chromeGpuLaunchArgs(),
    '--hide-scrollbars', '--mute-audio', '--window-size=1440,900',
    '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], env: chromeEnv });
  chrome.stderr.on('data', d => { const text = String(d).trim(); if (text) console.warn(`[chrome] ${text}`); });
  return chrome;
}

function waitForDevToolsEndpoint(chrome) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let settled = false;
    const cleanup = () => {
      clearTimeout(to);
      chrome.stderr.off('data', onData);
      chrome.off('exit', onExit);
    };
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const to = setTimeout(() => done(reject, new Error(`no DevTools endpoint after ${DEVTOOLS_TIMEOUT_MS}ms`)), DEVTOOLS_TIMEOUT_MS);
    const onData = (d) => {
      buf += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) done(resolve, m[1]);
    };
    const onExit = (code, signal) => done(reject, new Error(`chrome exited ${code ?? signal ?? 'unknown'}`));
    chrome.stderr.on('data', onData);
    chrome.on('exit', onExit);
  });
}

async function launchChromeAndWait(chromeEnv, userDataDirBase) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const userDataDir = `${userDataDirBase}-${attempt}`;
    const chrome = spawnChrome(userDataDir, chromeEnv);
    try {
      console.warn(`[chrome] waiting for DevTools endpoint, timeout=${DEVTOOLS_TIMEOUT_MS}ms attempt=${attempt}`);
      const wsUrl = await waitForDevToolsEndpoint(chrome);
      return { chrome, userDataDir, wsUrl };
    } catch (err) {
      lastErr = err;
      console.warn(`[chrome] launch attempt ${attempt} failed: ${err.message}`);
      await stopChrome(chrome, userDataDir);
    }
  }
  throw lastErr || new Error('chrome launch failed');
}

/**
 * Render one mockup video from a recipe (see recipe.mjs). Returns { buffer, info }.
 */
export async function renderVideo(rawRecipe = {}) {
  const recipe = normalizeRecipe(rawRecipe);
  if (!isValidUrl(recipe.url)) throw new Error('valid http(s) url required');
  console.log(`[env] mode=${recipe.environment.mode} preset=${recipe.environment.preset} hue=${recipe.environment.hue} sat=${recipe.environment.saturation} bright=${recipe.environment.brightness}`);
  const { seconds, width, height } = recipe.output;
  const captureViewport = CAPTURE_VIEWPORTS[recipe.device.viewport] || CAPTURE_VIEWPORTS.desktop;
  const captureMs = Math.round(seconds * 1000 + 600);
  const userDataDirBase = `/tmp/studio-render-${process.pid}-${Date.now()}`;

  let xvfb = null;
  const chromeEnv = { ...process.env };
  if (USE_XVFB) {
    const display = `:${90 + (process.pid % 10)}`;
    xvfb = spawn('Xvfb', [display, '-screen', '0', `${width}x${height}x24`, '-nolisten', 'tcp', '-ac'], { stdio: ['ignore', 'ignore', 'pipe'] });
    xvfb.stderr.on('data', d => { const text = String(d).trim(); if (text) console.warn(`[xvfb] ${text}`); });
    chromeEnv.DISPLAY = display;
    await sleep(500);
  }

  let server, cdp, chrome, userDataDir;
  try {
    const launched = await launchChromeAndWait(chromeEnv, userDataDirBase);
    chrome = launched.chrome;
    userDataDir = launched.userDataDir;
    const wsUrl = launched.wsUrl;

    cdp = minimalCdpClient(wsUrl);
    await cdp.ready;
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: captureViewport.width,
      height: captureViewport.height,
      deviceScaleFactor: 1,
      mobile: captureViewport.mobile,
      screenWidth: captureViewport.width,
      screenHeight: captureViewport.height,
    }, sessionId);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: captureViewport.touch }, sessionId).catch(() => {});

    // Screencast the live site.
    const live = [];
    cdp.on(m => { if (m.method === 'Page.screencastFrame' && m.sessionId === sessionId) { live.push('data:image/jpeg;base64,' + m.params.data); cdp.send('Page.screencastFrameAck', { sessionId: m.params.sessionId }, sessionId).catch(() => {}); } });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.navigate', { url: recipe.url }, sessionId);
    await sleep(recipe.capture.warmupMs);
    let readiness = await waitForCaptureReady(cdp, sessionId, recipe.capture);
    ({ readiness } = await settleStuckPage(cdp, sessionId, recipe.capture, readiness));
    console.warn(`[ready] ${readiness.ready ? 'ready' : 'timeout'} after ${recipe.capture.warmupMs + (readiness.waitedMs || 0)}ms (${readiness.reason || 'unknown'})`);

    // GPU ground-truth: what backs WebGL in the page Chrome just loaded?
    // (probeGpuRenderer, extracted to live-site-capture.mjs — see this
    // checkpoint's own header comment there for why.)
    const glRenderer = (await probeGpuRenderer(cdp, sessionId, { logPrefix: '[gpu]', blankWhat: 'hero' })).renderer;

    // Pre-measure the scroll target off-camera (if the recipe has one).
    let targetY = 0, scrollInfo = null;
    if (recipe.scroll) {
      const probe = await cdp.send('Runtime.evaluate', { expression: probeExpression(recipe.scroll), awaitPromise: true, returnByValue: true }, sessionId).then(r => r.result.value).catch(() => ({ y: 0, how: 'err' }));
      targetY = Number(probe.y) || 0; scrollInfo = probe;
      console.warn(`[scroll] target ${JSON.stringify(recipe.scroll.target)} → ${probe.how} @ scrollY=${targetY}`);
      await sleep(350); // let the page re-settle at top before capture
    }

    // Capture: load-in, then ONE smooth pre-measured scroll to the target.
    // everyNthFrame:1 grabs every composited frame of the smooth scroll — the
    // scroll is already dense/uniform (rAF smoothstep), so under-sampling here was
    // the source of the "twitchy" playback (scene.mjs maps output frames to the
    // NEAREST captured frame; too few captured frames → each repeats for several
    // output frames → visible chunky scroll). Capturing every frame keeps
    // playableCount ≥ output frames so the 1:1 mapping stays smooth to the bottom.
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 85,
      maxWidth: captureViewport.width,
      maxHeight: captureViewport.height,
      everyNthFrame: 1,
    }, sessionId);
    if (recipe.scroll) {
      const startMs = Math.round(recipe.scroll.startAt * seconds * 1000);
      const arriveMs = Math.round(recipe.scroll.arriveAt * seconds * 1000);
      const durMs = Math.max(500, arriveMs - startMs);
      // Single smooth scroll to the pre-measured target. For scroll-to-end the
      // probe pre-warms the page so targetY is the FULL settled bottom — a fixed
      // target means constant, continuous motion through every section (no jumps).
      await sleep(startMs);
      const smooth = `(()=>{const start=performance.now(),dur=${durMs},ty=${targetY},y0=window.scrollY||0;function step(now){let p=Math.min(1,(now-start)/dur);p=p*p*(3-2*p);window.scrollTo(0,Math.round(y0+(ty-y0)*p));if(p<1)requestAnimationFrame(step);}requestAnimationFrame(step);})()`;
      await cdp.send('Runtime.evaluate', { expression: smooth }, sessionId).catch(() => {});
      await sleep(captureMs - startMs);
    } else {
      await sleep(captureMs);
    }
    await cdp.send('Page.stopScreencast', {}, sessionId);
    if (!live.length) throw new Error('no frames captured from target site');

    // Serve the scene + frames over loopback (secure context → WebCodecs).
    let resolveUpload;
    const uploaded = new Promise((res) => { resolveUpload = res; });
    const sceneHtml = buildSceneHtml(recipe);
    server = createServer((req, res) => {
      if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(sceneHtml); return; }
      if (req.url === '/frames') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ live })); return; }
      if (req.url === '/upload' && req.method === 'POST') { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => { res.writeHead(200); res.end('ok'); resolveUpload(Buffer.concat(chunks)); }); return; }
      if (/^\/env\/[\w-]+\.webp$/.test(req.url)) {
        try {
          const data = readFileSync(join(__dirname, 'assets/environments', req.url.slice(5)));
          res.writeHead(200, { 'content-type': 'image/webp', 'cache-control': 'no-store' }); res.end(data);
        } catch { res.writeHead(404); res.end(); }
        return;
      }
      res.writeHead(404); res.end();
    });
    const port = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));

    // Render on GPU.
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` }, sessionId);
    const start = Date.now();
    const poll = async () => (await cdp.send('Runtime.evaluate', { expression: 'window.__DONE===true?(window.__ERR||"ok"):null', returnByValue: true }, sessionId)).result.value;
    let status = null;
    while (!(status = await poll())) { if (Date.now() - start > 120000) { status = 'TIMEOUT'; break; } await sleep(300); }
    if (status !== 'ok') throw new Error('render failed: ' + status);

    const buffer = await Promise.race([uploaded, sleep(15000).then(() => { throw new Error('upload timeout'); })]);
    const info = JSON.parse((await cdp.send('Runtime.evaluate', { expression: 'JSON.stringify(window.__RESULT)', returnByValue: true }, sessionId)).result.value || '{}');
    return { buffer, info: { ...info, liveCaptured: live.length, glRenderer, scroll: scrollInfo, readiness, viewport: recipe.device.viewport, seconds, fps: recipe.output.fps } };
  } finally {
    try { cdp?.close(); } catch {}
    try { server?.close(); } catch {}
    await stopChrome(chrome, userDataDir);
    try { xvfb?.kill('SIGTERM'); } catch {}
  }
}
