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
    '--headless=new', '--enable-gpu', '--ignore-gpu-blocklist', ...CHROME_FLAGS,
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
    if(!el){
      // Scroll-to-end / percent target: pre-walk the whole document off-camera so
      // lazy media + scroll-triggered sections load and the measured height is the
      // FULL settled height. Without this, height is short at load time → the
      // capture-time scroll stops short, and content loading mid-scroll makes the
      // target jump (skipped sections). After pre-warm the height is stable, so a
      // single fixed-target smooth scroll covers every section continuously.
      let last=-1,stable=0;
      for(let i=0;i<300;i++){
        const h=de.scrollHeight, maxTop=Math.max(0,h-innerHeight);
        window.scrollTo(0,Math.min(maxTop,Math.round((i+1)*innerHeight*0.85)));
        await new Promise(rs=>requestAnimationFrame(rs));
        const atBottom=(window.scrollY||de.scrollTop||0)+innerHeight>=h-2;
        if(h===last){ if(atBottom && ++stable>=3) break; } else stable=0;
        last=h;
      }
      await new Promise(rs=>setTimeout(rs,150));
      const maxTop=Math.max(0,de.scrollHeight-innerHeight);
      const y=Math.round(maxTop*((PCT==null?55:PCT)/100));
      window.scrollTo(0,0);
      return {y,how:'percent-prewarmed'};
    }
    for(let i=0;i<600;i++){ const r=el.getBoundingClientRect(); const tgt=ALIGN==='top'?innerHeight*0.12:innerHeight/2; const off=(r.top+(ALIGN==='top'?0:r.height/2))-tgt; if(Math.abs(off)<6)break; window.scrollBy(0,Math.sign(off)*Math.min(400,Math.max(20,Math.abs(off)*0.5))); await new Promise(rs=>requestAnimationFrame(rs)); }
    const y=Math.round(window.scrollY||de.scrollTop||0); window.scrollTo(0,0); return {y,how};
  })()`;
}

function captureReadinessExpression() {
  return `(()=>{
    const now=performance.now();
    const vw=Math.max(1,innerWidth||0), vh=Math.max(1,innerHeight||0);
    const de=document.scrollingElement||document.documentElement;
    const body=document.body;
    const readyState=document.readyState;
    const norm=s=>(s||'').replace(/\\s+/g,' ').trim();
    const intersects=r=>r&&r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<vh*0.96&&r.left<vw;
    const area=r=>Math.max(0,Math.min(r.right,vw)-Math.max(r.left,0))*Math.max(0,Math.min(r.bottom,vh)-Math.max(r.top,0));
    const styleVisible=(el)=>{
      for(let n=el;n&&n.nodeType===1;n=n.parentElement){
        const cs=getComputedStyle(n);
        if(cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity||1)<0.05)return false;
        if(n===body||n===document.documentElement)break;
      }
      return true;
    };
    const visible=(el)=>{
      const r=el.getBoundingClientRect();
      if(!intersects(r))return null;
      const cs=getComputedStyle(el);
      if(!styleVisible(el))return null;
      const a=area(r);
      return a>24?{r,cs,a}:null;
    };
    let textChars=0, textBlocks=0, headingVisible=false, belowChromeText=0;
    const walker=document.createTreeWalker(body||document.documentElement,NodeFilter.SHOW_TEXT,{
      acceptNode(node){
        const txt=norm(node.nodeValue);
        if(txt.length<16)return NodeFilter.FILTER_REJECT;
        const el=node.parentElement;
        if(!el||el.closest('script,style,noscript,template,svg,nav'))return NodeFilter.FILTER_REJECT;
        if(!styleVisible(el))return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    for(let node=walker.nextNode(),i=0;node&&i<900;node=walker.nextNode(),i++){
      const el=node.parentElement;
      const range=document.createRange();
      range.selectNodeContents(node);
      const rects=Array.from(range.getClientRects()).filter(intersects);
      range.detach();
      if(!rects.length)continue;
      const painted=rects.reduce((sum,r)=>sum+area(r),0);
      if(painted<24)continue;
      const txt=norm(node.nodeValue);
      const clipped=Math.min(txt.length,160);
      textChars+=clipped; textBlocks+=1;
      const heading=el.closest('h1,h2,h3,[role="heading"]');
      if(heading&&rects.some(r=>r.bottom>70))headingVisible=true;
      if(rects.some(r=>r.bottom>120))belowChromeText+=clipped;
      if(textChars>420)break;
    }
    let loadedImages=0, largeMedia=0, canvasOrVideo=0, bgVisuals=0;
    for(const el of Array.from(document.querySelectorAll('img,video,canvas,svg,picture')).slice(0,500)){
      const v=visible(el); if(!v||v.a<9000)continue;
      const tag=el.tagName.toLowerCase();
      if(tag==='img'){
        if(el.complete&&el.naturalWidth>=220&&el.naturalHeight>=120){loadedImages+=1;largeMedia+=1;}
      }else if(tag==='video'){
        if(el.readyState>=1||v.a>50000){canvasOrVideo+=1;largeMedia+=1;}
      }else if(tag==='canvas'||tag==='svg'){
        canvasOrVideo+=1; largeMedia+=1;
      }else if(tag==='picture'){
        const img=el.querySelector('img');
        if(img&&img.complete&&img.naturalWidth>=220&&img.naturalHeight>=120){loadedImages+=1;largeMedia+=1;}
      }
      if(largeMedia>=3)break;
    }
    const isNonBlankColor=(color)=>{
      const m=String(color||'').match(/rgba?\\(([^)]+)\\)/i);
      if(!m)return false;
      const parts=m[1].split(',').map(p=>Number(String(p).trim()));
      const [r,g,b,a=1]=parts;
      if(a===0)return false;
      return !(r>=245&&g>=245&&b>=245);
    };
    const bgImageReady=(bg)=>{
      const urls=Array.from(String(bg||'').matchAll(/url\\([\"']?([^\"')]+)[\"']?\\)/g)).map(m=>{try{return new URL(m[1],location.href).href;}catch{return m[1];}});
      if(!urls.length)return Boolean(bg&&bg!=='none');
      const entries=performance.getEntriesByType('resource')||[];
      return urls.some(u=>entries.some(e=>e.name===u&&e.responseEnd>0)||Array.from(document.images).some(img=>img.currentSrc===u&&img.complete));
    };
    for(const el of Array.from(document.querySelectorAll('main,section,article,header,div')).slice(0,1200)){
      const v=visible(el); if(!v||v.a<45000)continue;
      const bg=v.cs.backgroundImage||'';
      const bgColor=v.cs.backgroundColor||'';
      const cls=String(el.className||'').toLowerCase();
      const id=String(el.id||'').toLowerCase();
      const hasBgImage=Boolean(bg&&bg!=='none');
      const hasReadyBgImage=hasBgImage&&bgImageReady(bg);
      if(hasReadyBgImage){bgVisuals+=1;}
      if((cls.includes('hero')||id.includes('hero'))&&(hasReadyBgImage||isNonBlankColor(bgColor)&&v.a>120000))bgVisuals+=1;
      if(bgVisuals>=3)break;
    }
    const allText=norm(body?.innerText||'').toLowerCase();
    const onlyLoading=/^(loading|loading\\.|loading\\.\\.\\.|please wait|just a moment|one moment)$/i.test(allText);
    const hasDocumentSize=Boolean(body)&&de.scrollHeight>Math.min(240,vh*0.6);
    const meaningfulText=headingVisible||belowChromeText>=90||textChars>=160;
    const strongVisual=largeMedia>0||canvasOrVideo>0;
    const meaningfulVisual=strongVisual||bgVisuals>0&&(meaningfulText||now>2500);
    const ready=hasDocumentSize&&(readyState==='interactive'||readyState==='complete')&&!onlyLoading&&(meaningfulText||meaningfulVisual);
    let reason='waiting-for-visible-content';
    if(ready)reason=meaningfulText&&meaningfulVisual?'text-and-visual-ready':meaningfulText?'text-ready':'visual-ready';
    else if(!hasDocumentSize)reason='document-too-small';
    else if(onlyLoading)reason='loading-screen-visible';
    else if(readyState==='loading')reason='document-loading';
    return {ready,reason,readyState,now,textChars,textBlocks,belowChromeText,headingVisible,loadedImages,largeMedia,canvasOrVideo,bgVisuals,viewport:{width:vw,height:vh},scrollHeight:de.scrollHeight};
  })()`;
}

function settleStuckPageExpression() {
  return `(async()=>{
    const changed={loadersHidden:0,lazyImages:0,forcedVisible:0,events:0};
    const hideSelectors=[
      '.tp-loader','.rs-loader','.rev_slider_wrapper .tp-loader',
      '.swiper-lazy-preloader','.elementor-loading','.preloader',
      '[class*="loading-spinner"]','[class*="lazy-preloader"]'
    ];
    for(const el of document.querySelectorAll(hideSelectors.join(','))){
      el.style.setProperty('display','none','important');
      el.style.setProperty('visibility','hidden','important');
      el.style.setProperty('opacity','0','important');
      changed.loadersHidden++;
    }
    for(const img of document.querySelectorAll('img')){
      const lazy=img.getAttribute('data-lazyload')||img.getAttribute('data-lazy-src')||img.getAttribute('data-src')||img.getAttribute('data-orig-src');
      if(lazy&&!img.currentSrc){ img.src=lazy; changed.lazyImages++; }
      img.loading='eager';
      img.decoding='sync';
    }
    const showSelectors=[
      '.rev_slider','.rev_slider_wrapper','.tp-revslider-mainul','.tp-revslider-slidesli',
      '.tp-caption','.tp-parallax-wrap','.tp-loop-wrap','.tp-mask-wrap',
      '.rev-slidebg','.tp-bgimg','.rs-background-video-layer'
    ];
    for(const el of document.querySelectorAll(showSelectors.join(','))){
      el.style.setProperty('visibility','visible','important');
      el.style.setProperty('opacity','1','important');
      if(el.classList.contains('tp-revslider-slidesli')||el.classList.contains('rev_slider')){
        el.style.setProperty('display','block','important');
      }
      changed.forcedVisible++;
    }
    const fire=(target,name)=>{try{target.dispatchEvent(new Event(name));changed.events++;}catch{}};
    fire(document,'DOMContentLoaded');
    fire(window,'load');
    fire(window,'resize');
    fire(window,'scroll');
    try {
      if(window.jQuery){
        window.jQuery(window).trigger('load').trigger('resize').trigger('scroll');
        window.jQuery(document).trigger('ready');
        changed.events+=4;
      }
    } catch {}
    try {
      for(const key of Object.keys(window)){
        const v=window[key];
        if(/^revapi/i.test(key)&&v&&typeof v.revredraw==='function'){ v.revredraw(); changed.events++; }
      }
    } catch {}
    try { window.scrollBy(0,1); window.scrollTo(0,0); changed.events+=2; } catch {}
    await new Promise(r=>setTimeout(r,900));
    return changed;
  })()`;
}

async function waitForCaptureReady(cdp, sessionId, capture) {
  if (capture.waitForReady === false || capture.maxReadyWaitMs <= 0) {
    return { ready: true, skipped: true, waitedMs: 0, reason: 'readiness-disabled' };
  }

  const start = Date.now();
  let last = null;
  while (Date.now() - start <= capture.maxReadyWaitMs) {
    try {
      const res = await cdp.send('Runtime.evaluate', {
        expression: captureReadinessExpression(),
        returnByValue: true,
      }, sessionId);
      last = res.result?.value || null;
      if (last?.ready) {
        return { ...last, waitedMs: Date.now() - start, timedOut: false };
      }
    } catch (err) {
      last = { ready: false, reason: 'readiness-probe-error', error: err.message };
    }
    await sleep(capture.pollMs);
  }
  return { ...(last || {}), ready: false, waitedMs: Date.now() - start, timedOut: true };
}

function shouldSettleStuckPage(readiness) {
  if (!readiness || readiness.skipped) return false;
  if (readiness.timedOut || readiness.ready === false) return true;
  const noPaintedMedia = !readiness.loadedImages && !readiness.largeMedia && !readiness.canvasOrVideo;
  return Boolean(noPaintedMedia && readiness.bgVisuals && readiness.textChars && readiness.now > 1500);
}

async function settleStuckPage(cdp, sessionId, capture, readiness) {
  if (capture.settleStuckPage === false || !shouldSettleStuckPage(readiness)) {
    return { readiness, settle: null };
  }
  let settle = null;
  try {
    await cdp.send('Page.stopLoading', {}, sessionId).catch(() => {});
    await sleep(350);
    const res = await cdp.send('Runtime.evaluate', {
      expression: settleStuckPageExpression(),
      awaitPromise: true,
      returnByValue: true,
    }, sessionId);
    settle = res.result?.value || null;
  } catch (err) {
    settle = { error: err.message };
  }
  const after = await waitForCaptureReady(cdp, sessionId, {
    ...capture,
    maxReadyWaitMs: Math.min(3500, Math.max(1000, capture.maxReadyWaitMs || 0)),
  });
  return { readiness: { ...after, beforeSettle: readiness, settle }, settle };
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
    // everyNthFrame:1 grabs every composited frame of the smooth scroll — the
    // scroll is already dense/uniform (rAF smoothstep), so under-sampling here was
    // the source of the "twitchy" playback (scene.mjs maps output frames to the
    // NEAREST captured frame; too few captured frames → each repeats for several
    // output frames → visible chunky scroll). Capturing every frame keeps
    // playableCount ≥ output frames so the 1:1 mapping stays smooth to the bottom.
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1 }, sessionId);
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
