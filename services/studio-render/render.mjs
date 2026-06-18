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

const CHROME_PATH = process.env.CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; // local default; Linux containers set CHROME_PATH

// GPU flags. Linux+NVIDIA typically wants angle=vulkan or gl; macOS wants metal.
// Override entirely with CHROME_FLAGS (comma-separated) per host.
const DEFAULT_FLAGS = (process.platform === 'darwin')
  ? ['--use-angle=metal']
  : ['--use-angle=vulkan', '--enable-features=Vulkan', '--no-sandbox'];
const CHROME_FLAGS = process.env.CHROME_FLAGS
  ? process.env.CHROME_FLAGS.split(',').map(s => s.trim()).filter(Boolean)
  : DEFAULT_FLAGS;
const USE_XVFB = /^(1|true|yes)$/i.test(process.env.USE_XVFB || '');

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

// In-page probe: physically scroll the recipe's target element to center and
// return the scrollY that does it — resolves pinned/stacked layouts where an
// element's document offset != its reveal scroll position. Falls back to a
// percent of the page. Always resets to top before returning.
function probeExpression(scroll) {
  const sel = scroll?.target?.selector || '';
  const txt = scroll?.target?.text || '';
  const pct = scroll?.target?.percent;
  const align = scroll?.align || 'center';
  return `(async()=>{
    const de=document.scrollingElement||document.documentElement;
    const norm=s=>(s||'').replace(/\\s+/g,' ').trim().toLowerCase();
    const SEL=${JSON.stringify(sel)}, TXT=${JSON.stringify(txt)}, PCT=${pct == null ? 'null' : Number(pct)}, ALIGN=${JSON.stringify(align)};
    let el=SEL?document.querySelector(SEL):null, how=el?'selector':'none';
    if(!el && TXT){ const want=norm(TXT); let a=Infinity; for(const e of document.querySelectorAll('h1,h2,h3,h4,h5,h6,a,button,p,span,div,section,li')){ if(norm(e.textContent).includes(want)){const r=e.getBoundingClientRect(); if(r.width>0&&r.height>0&&r.width*r.height<a){a=r.width*r.height;el=e;}} } if(el)how='text'; }
    if(!el){ const maxTop=Math.max(0,de.scrollHeight-innerHeight); const y=Math.round(maxTop*((PCT==null?55:PCT)/100)); window.scrollTo(0,0); return {y,how:'percent'}; }
    for(let i=0;i<600;i++){ const r=el.getBoundingClientRect(); const tgt=ALIGN==='top'?innerHeight*0.12:innerHeight/2; const off=(r.top+(ALIGN==='top'?0:r.height/2))-tgt; if(Math.abs(off)<6)break; window.scrollBy(0,Math.sign(off)*Math.min(400,Math.max(20,Math.abs(off)*0.5))); await new Promise(rs=>requestAnimationFrame(rs)); }
    const y=Math.round(window.scrollY||de.scrollTop||0); window.scrollTo(0,0); return {y,how};
  })()`;
}

/**
 * Render one mockup video from a recipe (see recipe.mjs). Returns { buffer, info }.
 */
export async function renderVideo(rawRecipe = {}) {
  const recipe = normalizeRecipe(rawRecipe);
  if (!isValidUrl(recipe.url)) throw new Error('valid http(s) url required');
  console.log(`[env] mode=${recipe.environment.mode} preset=${recipe.environment.preset} hue=${recipe.environment.hue} sat=${recipe.environment.saturation} bright=${recipe.environment.brightness}`);
  const { seconds, width, height } = recipe.output;
  const captureMs = Math.round(seconds * 1000 + 600);
  const userDataDir = `/tmp/studio-render-${process.pid}-${Date.now()}`;

  let xvfb = null;
  const chromeEnv = { ...process.env };
  if (USE_XVFB) {
    const display = `:${90 + (process.pid % 10)}`;
    xvfb = spawn('Xvfb', [display, '-screen', '0', `${width}x${height}x24`, '-nolisten', 'tcp', '-ac'], { stdio: ['ignore', 'ignore', 'pipe'] });
    xvfb.stderr.on('data', d => { const text = String(d).trim(); if (text) console.warn(`[xvfb] ${text}`); });
    chromeEnv.DISPLAY = display;
    await sleep(500);
  }

  const chrome = spawn(CHROME_PATH, [
    '--headless=new', '--enable-gpu', '--ignore-gpu-blocklist', ...CHROME_FLAGS,
    '--hide-scrollbars', '--mute-audio', '--window-size=1440,900',
    '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], env: chromeEnv });
  chrome.stderr.on('data', d => { const text = String(d).trim(); if (text) console.warn(`[chrome] ${text}`); });

  let server, cdp;
  try {
    const wsUrl = await new Promise((resolve, reject) => {
      let buf = ''; const to = setTimeout(() => reject(new Error('no DevTools endpoint')), 20000);
      chrome.stderr.on('data', d => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(to); resolve(m[1]); } });
      chrome.on('exit', c => { clearTimeout(to); reject(new Error('chrome exited ' + c)); });
    });

    cdp = minimalCdpClient(wsUrl);
    await cdp.ready;
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

    // Screencast the live site.
    const live = [];
    cdp.on(m => { if (m.method === 'Page.screencastFrame' && m.sessionId === sessionId) { live.push('data:image/jpeg;base64,' + m.params.data); cdp.send('Page.screencastFrameAck', { sessionId: m.params.sessionId }, sessionId).catch(() => {}); } });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.navigate', { url: recipe.url }, sessionId);
    await sleep(recipe.capture.warmupMs);

    // GPU ground-truth: what backs WebGL in the page Chrome just loaded?
    // SwiftShader/llvmpipe => software (WebGL hero renders blank). ANGLE (NVIDIA …)
    // => real GPU. Logged so a render's fidelity is diagnosable from logs.
    let glRenderer = 'unknown';
    try {
      const probe = `(()=>{try{const c=document.createElement('canvas');const gl=c.getContext('webgl2')||c.getContext('webgl');if(!gl)return'NO-WEBGL';const d=gl.getExtension('WEBGL_debug_renderer_info');return d?gl.getParameter(d.UNMASKED_RENDERER_WEBGL):'unknown-renderer';}catch(e){return'probe-err:'+e.message}})()`;
      glRenderer = (await cdp.send('Runtime.evaluate', { expression: probe, returnByValue: true }, sessionId)).result.value;
      const software = /swiftshader|llvmpipe|software/i.test(String(glRenderer));
      console.warn(`[gpu] WebGL renderer: ${glRenderer} ${software ? '⚠ SOFTWARE (hero will be blank)' : '✓ GPU'}`);
    } catch (err) { console.warn(`[gpu] renderer probe failed: ${err.message}`); }

    // Pre-measure the scroll target off-camera (if the recipe has one).
    let targetY = 0, scrollInfo = null;
    if (recipe.scroll) {
      const probe = await cdp.send('Runtime.evaluate', { expression: probeExpression(recipe.scroll), awaitPromise: true, returnByValue: true }, sessionId).then(r => r.result.value).catch(() => ({ y: 0, how: 'err' }));
      targetY = Number(probe.y) || 0; scrollInfo = probe;
      console.warn(`[scroll] target ${JSON.stringify(recipe.scroll.target)} → ${probe.how} @ scrollY=${targetY}`);
      await sleep(350); // let the page re-settle at top before capture
    }

    // Capture: load-in, then ONE smooth pre-measured scroll to the target.
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1440, maxHeight: 900, everyNthFrame: 2 }, sessionId);
    if (recipe.scroll) {
      const startMs = Math.round(recipe.scroll.startAt * seconds * 1000);
      const arriveMs = Math.round(recipe.scroll.arriveAt * seconds * 1000);
      const durMs = Math.max(500, arriveMs - startMs);
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
    return { buffer, info: { ...info, liveCaptured: live.length, glRenderer, scroll: scrollInfo, viewport: recipe.device.viewport, seconds, fps: recipe.output.fps } };
  } finally {
    try { cdp?.close(); } catch {}
    try { server?.close(); } catch {}
    await stopChrome(chrome, userDataDir);
    try { xvfb?.kill('SIGTERM'); } catch {}
  }
}
