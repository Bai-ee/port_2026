// live-site-capture.mjs — shared live-website screencast-capture logic.
//
// Two consumers:
//  1. render.mjs (the LIVE, deployed Video Promo / Mockup Video pipeline) —
//     imports the pure, CDP-client-agnostic helpers below (CAPTURE_VIEWPORTS,
//     probeExpression, captureReadinessExpression, settleStuckPageExpression,
//     waitForCaptureReady, shouldSettleStuckPage, settleStuckPage, sleep).
//     These are moved here VERBATIM from render.mjs (byte-identical logic,
//     just relocated) — render.mjs's own renderVideo() behavior is
//     unchanged; only WHERE these functions are defined changed. This is a
//     mechanical extraction, not a rewrite (STUDIO-DETERMINISTIC-FINAL-
//     RENDER-SONNET-HANDOFF.md's "Live website frames on the device screen"
//     checkpoint explains why: reuse render.mjs's own proven capture
//     reasoning for the NEW device-screen-live path below, rather than
//     re-deriving it, without touching render.mjs's own capture orchestration
//     code in place).
//  2. art-render.mjs (the Proof/Final Render pipeline) — via the NEW
//     `captureDeviceLiveFrames` export, which drives a Playwright-owned CDP
//     session (no raw WebSocket client, no Browserless) through the same
//     probe/readiness/settle sequence render.mjs's own renderVideo() uses,
//     to capture a REAL scrolling frame sequence for a device scene's
//     screen. Everything below this module's first half (the extracted
//     helpers) is reused unmodified by both consumers.
//
//     "Live capture fluidity fixes" checkpoint (STUDIO-DETERMINISTIC-FINAL-
//     RENDER-SONNET-HANDOFF.md) replaced the original compositor-cadence
//     `Page.startScreencast` + one continuous eased-scroll approach with a
//     paced, DETERMINISTIC stepped capture (`computeCapturePlan` + the step
//     loop inside `captureDeviceLiveFrames`) plus a reset-and-verify scroll
//     reset and a paint-stability readiness strengthener for canvas/WebGL
//     pages — see that checkpoint for the full bug list/evidence/numbers.

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

// ── GPU launch flags — moved verbatim from render.mjs's own module-scope
// consts + spawnChrome() ("Live capture GPU acceleration" checkpoint,
// STUDIO-DETERMINISTIC-FINAL-RENDER-SONNET-HANDOFF.md). render.mjs's own
// header comment: "GPU flags. Linux+NVIDIA typically wants angle=vulkan or
// gl; macOS wants metal. Override entirely with CHROME_FLAGS (comma-
// separated) per host." — unchanged reasoning, only relocated so the NEW
// device-screen-live capture path (captureDeviceLiveFrames below) launches
// its OWN dedicated browser with the EXACT SAME GPU-enabling flag set,
// rather than a second hand-copied literal that could drift. Headless
// Chromium/Chrome defaults to SwiftShader/llvmpipe SOFTWARE WebGL unless
// explicitly told to use a real GPU backend — this is what made a WebGL-hero
// live target (e.g. hitloop.agency) impractically slow to capture before
// this checkpoint (root cause + measured before/after in that checkpoint).
const DEFAULT_CHROME_ANGLE_FLAGS = (process.platform === 'darwin')
  ? ['--use-angle=metal']
  : ['--use-angle=vulkan', '--enable-features=Vulkan', '--no-sandbox'];

export function resolveChromeAngleFlags() {
  return process.env.CHROME_FLAGS
    ? process.env.CHROME_FLAGS.split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_CHROME_ANGLE_FLAGS;
}

// The full GPU-enabling flag list a headless launch needs: '--headless=new'
// (the modern headless mode — GPU acceleration is not reliably available
// under the legacy '--headless' mode), '--enable-gpu'/'--ignore-gpu-blocklist'
// (headless Chromium/Chrome's own internal GPU blocklist otherwise forces a
// software fallback even when a real backend IS available on the host), plus
// the platform ANGLE backend above. Both render.mjs's raw-spawn launch and
// this module's own Playwright launch (captureDeviceLiveFrames) build their
// args from this ONE function so the two consumers never carry two copies
// that could silently drift apart.
export function chromeGpuLaunchArgs() {
  return ['--headless=new', '--enable-gpu', '--ignore-gpu-blocklist', ...resolveChromeAngleFlags()];
}

// ── GPU renderer probe — moved verbatim from render.mjs's own renderVideo()
// (same checkpoint). This is the ground-truth check: what actually backs
// WebGL in the page Chrome just loaded? SwiftShader/llvmpipe => software (a
// WebGL-dependent element renders blank or, for the live-capture path,
// simply renders VERY slowly under contention). ANGLE talking to a real
// backend (Metal/Vulkan/D3D/GL over a real GPU) => real GPU. Logged so a
// capture's fidelity/cost is diagnosable from logs, never a silent guess —
// and (device-screen-live path only) carried into the returned capture
// metadata so a caller can surface it too (never a silent multi-minute
// crawl with no visible explanation).
export function gpuRendererProbeExpression() {
  return `(()=>{try{const c=document.createElement('canvas');const gl=c.getContext('webgl2')||c.getContext('webgl');if(!gl)return'NO-WEBGL';const d=gl.getExtension('WEBGL_debug_renderer_info');return d?gl.getParameter(d.UNMASKED_RENDERER_WEBGL):'unknown-renderer';}catch(e){return'probe-err:'+e.message}})()`;
}

// Verbatim from render.mjs's own inline regex.
export function isSoftwareRenderer(renderer) {
  return /swiftshader|llvmpipe|software/i.test(String(renderer));
}

/**
 * Runs the GPU renderer probe against an already-navigated page and logs the
 * result. `logPrefix`/`blankWhat` let each consumer keep its own established
 * log wording (render.mjs: '[gpu]' / "hero will be blank"; the device-live
 * capture path: '[device-live-capture]' / "device screen will be blank") —
 * the ⚠ SOFTWARE / ✓ GPU shape is otherwise identical. Never throws — a
 * probe failure (e.g. the page navigated away mid-check) is logged and
 * returned as `{ renderer: 'unknown', software: null }`, exactly as
 * render.mjs's own original inline try/catch already did (it never let a
 * probe failure fail the whole render).
 */
export async function probeGpuRenderer(cdp, sessionId, { logPrefix = '[gpu]', blankWhat = 'hero' } = {}) {
  let renderer = 'unknown';
  let software = null;
  try {
    const res = await cdp.send('Runtime.evaluate', { expression: gpuRendererProbeExpression(), returnByValue: true }, sessionId);
    renderer = res.result?.value;
    software = isSoftwareRenderer(renderer);
    console.warn(`${logPrefix} WebGL renderer: ${renderer} ${software ? `⚠ SOFTWARE (${blankWhat} will be blank)` : '✓ GPU'}`);
  } catch (err) {
    console.warn(`${logPrefix} renderer probe failed: ${err.message}`);
  }
  return { renderer, software };
}

// Capture viewport table — moved verbatim from render.mjs's renderVideo()
// (was a function-local const there; relocated to module scope here so both
// consumers share the exact same numbers, never two copies that could
// drift).
export const CAPTURE_VIEWPORTS = {
  desktop: { width: 1440, height: 900, mobile: false, touch: false },
  mobile: { width: 390, height: 844, mobile: true, touch: true },
  tablet: { width: 768, height: 1024, mobile: true, touch: true },
};

// In-page probe: physically scroll the recipe's target element to center and
// return the scrollY that does it — resolves pinned/stacked layouts where an
// element's document offset != its reveal scroll position. Falls back to a
// percent of the page. Always resets to top before returning.
//
// Verbatim from render.mjs (see that file's own header comment for the full
// per-line rationale — unchanged here, moved only).
export function probeExpression(scroll) {
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

// Verbatim from render.mjs.
export function captureReadinessExpression() {
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

// Verbatim from render.mjs.
export function settleStuckPageExpression() {
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

// Verbatim from render.mjs. `cdp` is any client exposing
// `send(method, params, sessionId)` returning a Promise of the CDP result —
// render.mjs's own raw-WebSocket client and the Playwright-CDPSession
// adapter below (see `playwrightCdpAdapter`) both satisfy this shape.
export async function waitForCaptureReady(cdp, sessionId, capture) {
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
    // eslint-disable-next-line no-await-in-loop -- sequential polling loop, matches render.mjs.
    await sleep(capture.pollMs);
  }
  return { ...(last || {}), ready: false, waitedMs: Date.now() - start, timedOut: true };
}

// Verbatim from render.mjs.
export function shouldSettleStuckPage(readiness) {
  if (!readiness || readiness.skipped) return false;
  if (readiness.timedOut || readiness.ready === false) return true;
  const noPaintedMedia = !readiness.loadedImages && !readiness.largeMedia && !readiness.canvasOrVideo;
  return Boolean(noPaintedMedia && readiness.bgVisuals && readiness.textChars && readiness.now > 1500);
}

// Verbatim from render.mjs.
export async function settleStuckPage(cdp, sessionId, capture, readiness) {
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

// ── NEW: device-screen-live capture (Studio Final Render) ──────────────────
//
// Drives a dedicated, short-lived Playwright Chromium page through the same
// probe → warmup → readiness → settle sequence render.mjs's renderVideo()
// runs for the Video Promo pipeline, adapted to a Playwright CDPSession
// instead of a raw WebSocket client (no Browserless, no new dependency —
// Playwright is already this service's own dependency), then hands off to a
// deterministic, paced scroll-step capture (see the "Live capture fluidity
// fixes" checkpoint below). Returns a REAL frame sequence (JPEG data URLs)
// the caller (art-render.mjs) writes to its render's workDir and feeds to
// art-scene.mjs's device screen as a genuine scrolling video, not a single
// static capture.
//
// DI seam: art-render.mjs never calls this function directly — it goes
// through `_internals.captureDeviceLiveFrames` there, so a test can replace
// the whole thing with a synthetic-frame fake and never touch the network
// (see art-render.test.mjs's "device-screen-live" tests).

// ── Fluid live-capture pacing/cadence tunables ("Live capture fluidity
// fixes" checkpoint) — every number here is referenced by name in that
// checkpoint's writeup, with the measured evidence that produced it. Pure,
// exported, and unit-tested (live-site-capture.test.mjs) via
// `computeCapturePlan` below, independent of any browser/network.
export const LIVE_CAPTURE_PACING = {
  // Bug #2 ("the whole page in one clip reads as a jump-cut, not a scroll").
  // Caps the APPARENT scroll speed to a fixed number of viewport-heights per
  // second rather than always cramming the page's full scrollable height
  // into the clip. 0.5 vh/s is a comfortable, readable auto-scroll pace
  // (roughly half a screen of content settles per second) — for a 900px-tall
  // desktop viewport that's ~450px/s, vs. the ~1000+ px/s a 6297px page
  // crammed into ~5.3s previously produced. A tall page gets a partial,
  // legible pass instead of a blurred full-page one; a short page still
  // covers its whole height comfortably within any clip ≥ a couple seconds.
  SCROLL_SPEED_VIEWPORTS_PER_SEC: 0.5,
  // Bug #3 ("enough captured frames, mapped monotonically") — REVISED in the
  // "Live capture fluidity fixes, round 2" pass. The first pass shipped
  // CAPTURE_OVERSAMPLE:2 (2 candidate captured frames per output frame),
  // reasoning that extra candidates would cushion the existing nearest-index
  // mapping in art-scene.mjs against rounding artifacts. Measured evidence
  // from the real acceptance run proved the ACTUAL defect was upstream of
  // that: a fixed per-step settle wait is a heuristic, not a guarantee the
  // compositor had actually painted the new scroll position before
  // `Page.captureScreenshot` ran — on a GPU-heavy page (hitloop.agency,
  // headless SwiftShader software WebGL) this produced captured frames that
  // were byte-identical to the previous step, immediately followed by a
  // "catch-up" jump once painting caught up (measured on the wiki control:
  // 16/179 transitions frozen at 0.00px, 3/179 doubled to 8.45px, against an
  // intended uniform ~5.64px step — exactly the "near-zero next to a big
  // jump" pattern the acceptance forbids). That is fixed at its source by
  // the stale-frame retry in the capture loop below (never accept a step's
  // screenshot as final when the scroll target genuinely moved but the
  // pixels did not — see MAX_STALE_CAPTURE_RETRIES), which makes EVERY
  // captured frame genuinely represent its own distinct scroll position by
  // construction — an oversample cushion is no longer doing useful work, it
  // was only ever masking (not fixing) 2:1 index-mapping artifacts that
  // don't occur once each captured frame is individually correct. Set to 1
  // (exact 1:1 with the output frame count) so every output frame maps to
  // its own dedicated, uniquely-captured frame, and so the added per-step
  // retry cost (which a GPU-heavy page pays disproportionately) is not
  // doubled on top of an oversample that no longer earns its wall-clock
  // cost. See the checkpoint's "round 2" section for the measured timing
  // this traded off against.
  CAPTURE_OVERSAMPLE: 1,
  // A short clip still gets smooth motion instead of a handful of jerky
  // steps.
  MIN_CAPTURE_FRAMES: 24,
  // Bounds real wall-clock capture time (each step is a real CDP round trip
  // + settle wait, now possibly plus bounded stale-frame retries — see
  // STEP_SETTLE_MS/MAX_STALE_CAPTURE_RETRIES below). With oversample now 1,
  // this only binds for an extreme fps*duration combination (e.g. 60fps at
  // 15s = 900 desired frames) — documented as a known limitation there:
  // still monotonic and evenly distributed, just lower temporal resolution.
  MAX_CAPTURE_FRAMES: 360,
};

/**
 * Pure planning function (bugs #1-#3) — no browser/network. Computes how far
 * to scroll (clamped + paced) and how many discrete frames to capture, given
 * only numbers already measured/known. Exported and unit-tested directly.
 */
export function computeCapturePlan({ viewportHeight, maxScrollTop, captureSeconds, fps }) {
  const {
    SCROLL_SPEED_VIEWPORTS_PER_SEC, CAPTURE_OVERSAMPLE, MIN_CAPTURE_FRAMES, MAX_CAPTURE_FRAMES,
  } = LIVE_CAPTURE_PACING;
  const vh = Math.max(0, Number(viewportHeight) || 0);
  const seconds = Math.max(0, Number(captureSeconds) || 0);
  const measuredMax = Math.max(0, Number(maxScrollTop) || 0);
  const paceLimitPx = vh * SCROLL_SPEED_VIEWPORTS_PER_SEC * seconds;
  // Bug #1: the travel distance is ALWAYS clamped to the true, freshly
  // measured max scroll extent — a scroll target that exceeds the page's own
  // maximum silently clamps inside the browser, which is exactly what
  // produced the degenerate/inverted travel this checkpoint fixes.
  const travel = Math.max(0, Math.min(measuredMax, paceLimitPx));
  const desiredOutputFrames = Math.max(1, Math.round(seconds * (Number(fps) || 30)));
  const captureFrameCount = Math.min(
    MAX_CAPTURE_FRAMES,
    Math.max(MIN_CAPTURE_FRAMES, Math.round(desiredOutputFrames * CAPTURE_OVERSAMPLE)),
  );
  return {
    travel, paceLimitPx, maxScrollTop: measuredMax, desiredOutputFrames, captureFrameCount,
  };
}

// ── Reset-and-verify (bug #1/#4) — "guarantee scrollTop===0, verified by
// reading it back, not assumed" immediately before capture starts. Re-issues
// scrollTo(0,0) every poll so anything that scrolls the page back down mid-
// settle (lazy content, layout shift) gets corrected, not just asked once.
const RESET_VERIFY_MAX_MS = 2000;
const RESET_VERIFY_POLL_MS = 60;
// Extra fixed settle AFTER the native readback confirms 0 — generic across
// any scroll-smoothing implementation the target page might run (Lenis,
// Locomotive, GSAP ScrollSmoother, ...): these commonly use eased "catch up"
// durations in the ~0.8-1.2s range (this repo's own SmoothScroll.jsx uses
// Lenis with `duration: 1`, which was the actual live evidence behind the
// observed footer-then-hero reversal — the native scrollY reset instantly,
// but the site's own smoothed/lerped visual position had not yet caught up
// when the old code started capturing). We cannot detect or control an
// external site's own scroll implementation, so this is a fixed conservative
// buffer, not a library-specific hook.
const POST_RESET_SETTLE_MS = 1200;

export async function resetScrollAndVerify(cdp, sessionId, opts = {}) {
  const maxWaitMs = opts.maxWaitMs ?? RESET_VERIFY_MAX_MS;
  const pollMs = opts.pollMs ?? RESET_VERIFY_POLL_MS;
  const start = Date.now();
  let lastY = null;
  while (Date.now() - start <= maxWaitMs) {
    await cdp.send('Runtime.evaluate', { expression: 'window.scrollTo(0,0)' }, sessionId).catch(() => {});
    // eslint-disable-next-line no-await-in-loop -- sequential polling loop, matches waitForCaptureReady's own established pattern in this file.
    const res = await cdp.send('Runtime.evaluate', {
      expression: '(window.scrollY||(document.scrollingElement&&document.scrollingElement.scrollTop)||0)',
      returnByValue: true,
    }, sessionId).catch(() => null);
    lastY = res && res.result ? Number(res.result.value) || 0 : null;
    if (lastY === 0) return { ok: true, waitedMs: Date.now() - start, lastY: 0 };
    // eslint-disable-next-line no-await-in-loop
    await sleep(pollMs);
  }
  return { ok: false, waitedMs: Date.now() - start, lastY };
}

// ── Paint-stability readiness strengthener (bug #2 in the ACCEPTANCE list —
// "Readiness for canvas/WebGL sites") — additive only. Existing
// captureReadinessExpression() signals (textChars/loadedImages/headingVisible
// etc.) are untouched and still decide readiness for ordinary DOM sites
// exactly as before (this never runs for them — see shouldCheckPaintStability
// below). For a page that only passed readiness via the weak
// bgVisuals/largeMedia/canvasOrVideo fallback (every DOM-text signal reads
// zero — the exact hitloop.agency evidence: textChars:0, textBlocks:0,
// belowChromeText:0, headingVisible:false), this takes successive JPEG
// screenshots spaced `sampleIntervalMs` apart and requires
// `requiredStableSamples` consecutive near-identical frames (a cheap,
// dependency-free byte-sampled fingerprint diff, not a full JPEG decode —
// good enough to detect "still visibly loading/animating in" vs "settled")
// before treating the page as genuinely ready to capture. Best-effort: a
// page that never stabilizes within maxWaitMs still proceeds (capture is not
// hard-blocked forever), but the timeout is recorded in the returned
// readiness for the acceptance evidence.
export function jpegFingerprintDiff(aB64, bB64) {
  if (!aB64 || !bB64) return 1;
  if (aB64 === bB64) return 0;
  const lenDiff = Math.abs(aB64.length - bB64.length) / Math.max(aB64.length, bB64.length, 1);
  const len = Math.min(aB64.length, bB64.length);
  const samples = 96;
  const step = Math.max(1, Math.floor(len / samples));
  let differing = 0;
  let compared = 0;
  for (let i = 0; i < len; i += step) {
    compared += 1;
    if (aB64[i] !== bB64[i]) differing += 1;
  }
  const sampleRatio = compared ? differing / compared : 1;
  return Math.max(lenDiff, sampleRatio);
}

export function shouldCheckPaintStability(readiness) {
  if (!readiness || readiness.ready !== true) return false;
  const hasTextSignal = Boolean(readiness.headingVisible)
    || Number(readiness.textChars) > 0
    || Number(readiness.belowChromeText) > 0;
  return !hasTextSignal;
}

const DEFAULT_PAINT_STABILITY = {
  enabled: true, maxWaitMs: 4000, sampleIntervalMs: 350, requiredStableSamples: 2, diffThreshold: 0.02,
};

export async function waitForPaintStability(cdp, sessionId, options) {
  const o = { ...DEFAULT_PAINT_STABILITY, ...(options || {}) };
  if (o.enabled === false) return { checked: false, stable: null };
  const start = Date.now();
  let prev = null;
  let stableCount = 0;
  let samples = 0;
  while (Date.now() - start <= o.maxWaitMs) {
    // eslint-disable-next-line no-await-in-loop -- sequential polling loop, matches waitForCaptureReady's own established pattern in this file.
    const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 50 }, sessionId).catch(() => null);
    const data = shot?.data || null;
    samples += 1;
    if (data && prev != null) {
      const diff = jpegFingerprintDiff(prev, data);
      if (diff <= o.diffThreshold) {
        stableCount += 1;
        if (stableCount >= o.requiredStableSamples) {
          return {
            checked: true, stable: true, waitedMs: Date.now() - start, samples,
          };
        }
      } else {
        stableCount = 0;
      }
    }
    if (data) prev = data;
    // eslint-disable-next-line no-await-in-loop
    await sleep(o.sampleIntervalMs);
  }
  return {
    checked: true, stable: false, timedOut: true, waitedMs: Date.now() - start, samples,
  };
}

// Extra settle after each deterministic scroll step, on top of the double
// requestAnimationFrame wait (bug #3 — pacing for a step-driven capture, not
// compositor cadence). 2 rAFs guarantee the compositor has painted the new
// scroll position at least once; +40ms is a conservative pad for
// scroll-linked JS (lerped/eased libraries, lazy-mount observers) to begin
// visibly tracking the new position. This does not require FULL convergence
// of any easing library between steps — under a steady, monotonically
// advancing target (exactly what the linear step schedule below produces),
// a first-order lag (which is what eased "catch-up" scrolling amounts to)
// settles into a constant phase delay, so the STEADY-STATE portion of the
// clip still shows near-constant per-frame deltas even though each step
// doesn't wait for full settle — verified empirically against the real
// hitloop.agency site in this checkpoint's acceptance run (see the delta
// statistics there).
const STEP_SETTLE_MS = 40;

// ── "Live capture fluidity fixes, round 2" — paint-commit race + hang
// safety (coordinator-flagged: measured 16/179 frozen transitions on the
// wiki control's own fluidity_analysis.json, and the hitloop.agency
// acceptance run made no visible progress for 15+ real minutes). ──────────
//
// Every CDP call inside the per-step loop below is wrapped in `raceTimeout`
// — never lets a single unresponsive call (a GPU-saturated page's main
// thread can genuinely starve an injected requestAnimationFrame callback
// for a long time under headless software WebGL) hang the whole capture
// forever. `raceTimeout` never rejects — it resolves `null` on timeout,
// exactly the same "best-effort, caller checks for a value" shape every
// `.catch(() => null)` call in this file already uses, so no caller needed
// to change its own null-handling.
// Raised from an initial 8000ms after real measurement against
// hitloop.agency (a GPU-saturated page under headless SwiftShader software
// WebGL — see the checkpoint's own CPU evidence) showed 8s was too TIGHT: a
// live smoke test lost every single step's frame to this exact timeout
// (`step 1..4/60 — 0 frames so far`) even though the SAME site's own
// individual CDP calls DO eventually complete given enough real time (the
// round-1 acceptance run captured real frames with no per-call ceiling at
// all, just a very slow overall wall-clock time). 45s is generous enough to
// let a genuinely slow-but-real call complete instead of being discarded,
// while still bounding the pathological true-hang case this constant exists
// to guard against (a starved rAF callback that would otherwise never
// resolve) to a finite, if large, ceiling per call.
const STEP_CDP_TIMEOUT_MS = 45000;

function raceTimeout(promise, ms) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve(null); }
    }, ms);
    promise.then(
      (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } },
      () => { if (!settled) { settled = true; clearTimeout(timer); resolve(null); } },
    );
  });
}

// Stale-frame retry (the actual fix for the measured 0px-then-jump defect):
// a fixed settle wait is a heuristic, not a hard guarantee the compositor
// painted the new scroll position before `Page.captureScreenshot` ran. When
// the scroll TARGET genuinely changed from the previous step but the
// captured PIXELS did not, the paint has not committed yet — retry the
// SCREENSHOT (never the scroll, which is already correctly set) with extra
// settle time. Bounded (MAX_STALE_CAPTURE_RETRIES) so a step can never
// retry forever; STALE_FRAME_DIFF_THRESHOLD reuses the same cheap
// byte-sampled fingerprint diff the paint-stability checker uses — a JPEG
// re-encode of literally unchanged pixels is deterministic, so a genuine
// duplicate diffs to (very close to) 0.
const MAX_STALE_CAPTURE_RETRIES = 6;
const STALE_RETRY_SETTLE_MS = 80;
const STALE_FRAME_DIFF_THRESHOLD = 0.01;

// ── "Live capture GPU acceleration" checkpoint — overall capture wall-clock
// budget. STEP_CDP_TIMEOUT_MS (above) only bounds a single CDP call; it does
// NOT bound the whole capture, so a page that is consistently slow (every
// call individually completes, just slowly) could previously run for many
// minutes with the caller seeing nothing but per-step progress logs (this is
// exactly what the owner observed and rejected: "the owner watched a render
// sit for many minutes"). This is the fix: the step loop below checks total
// elapsed time against `maxCaptureMs` and, if exceeded, THROWS a clear error
// carrying the measured numbers (elapsed time, steps/frames captured so far,
// the GPU probe result) instead of continuing indefinitely — "fails honestly
// with the measured numbers rather than hanging." 240s leaves generous room
// inside the render job's own TOTAL_RENDER_DEADLINE_MS (600s,
// proof-render-jobs.cjs) for the rest of the pipeline (per-frame scene
// render + ffmpeg encode) to still run after this pre-pass.
const MAX_CAPTURE_WALL_CLOCK_MS = 240000;

const DEFAULT_CAPTURE = {
  warmupMs: 400,
  pollMs: 200,
  maxReadyWaitMs: 8000,
  waitForReady: true,
  settleStuckPage: true,
  paintStability: { ...DEFAULT_PAINT_STABILITY },
  // Overridable ONLY so tests can shrink real-world settle timings without
  // touching the production defaults above (same established pattern as
  // warmupMs/pollMs) — production always gets these exact values unless a
  // caller explicitly overrides `capture`, which no production caller does.
  postResetSettleMs: POST_RESET_SETTLE_MS,
  stepSettleMs: STEP_SETTLE_MS,
  resetVerify: { maxWaitMs: RESET_VERIFY_MAX_MS, pollMs: RESET_VERIFY_POLL_MS },
  stepCdpTimeoutMs: STEP_CDP_TIMEOUT_MS,
  maxStaleCaptureRetries: MAX_STALE_CAPTURE_RETRIES,
  staleRetrySettleMs: STALE_RETRY_SETTLE_MS,
  staleFrameDiffThreshold: STALE_FRAME_DIFF_THRESHOLD,
  maxCaptureMs: MAX_CAPTURE_WALL_CLOCK_MS,
};

function playwrightCdpAdapter(session) {
  // Adapts a Playwright CDPSession (send(method, params) — already scoped to
  // one target, no sessionId) to the `send(method, params, sessionId)` shape
  // every extracted helper above expects; the ignored third argument is what
  // makes those helpers work completely unmodified for this new caller.
  return { send: (method, params) => session.send(method, params) };
}

/**
 * Captures a real, scrolling frame sequence from `url` using Playwright's own
 * Chromium (no Browserless, no external CDP process). "Live capture fluidity
 * fixes" checkpoint: scrolls in discrete, DETERMINISTIC steps (not a single
 * continuous eased scroll driven concurrently with a compositor-cadence
 * screencast) — each step sets an exact scroll position, settles briefly,
 * and captures exactly one `Page.captureScreenshot` frame, so the captured
 * sequence is strictly ordered, monotonic, and its count is a known,
 * pre-computed quantity (`computeCapturePlan`) rather than whatever the
 * compositor happened to emit. Travel distance is clamped to the page's own
 * true (freshly measured, post-prewarm) max scroll extent and paced to a
 * fixed viewport-heights/second speed — see `LIVE_CAPTURE_PACING`.
 *
 * Returns `{ frames, scrollInfo, readiness, viewport }` — `frames` is an
 * array of `data:image/jpeg;base64,...` strings in capture order (frame 0 is
 * always the top of the page — scrollTop 0 is verified by readback, not
 * assumed, before step 0). Throws if navigation fails or zero frames are
 * captured (a live-sourced screen is never rendered blank — the caller must
 * fail the whole render, not substitute a placeholder).
 */
export async function captureDeviceLiveFrames({
  url, viewport = 'desktop', seconds = 6, fps = 30, scrollPercent = 100,
  capture = {}, launchChromium, signal,
}) {
  if (typeof launchChromium !== 'function') {
    throw new Error('captureDeviceLiveFrames requires a launchChromium({headless,args}) function (DI seam — see art-render.mjs\'s _internals).');
  }
  const cap = {
    ...DEFAULT_CAPTURE,
    ...capture,
    paintStability: { ...DEFAULT_CAPTURE.paintStability, ...(capture.paintStability || {}) },
  };
  const vp = CAPTURE_VIEWPORTS[viewport] || CAPTURE_VIEWPORTS.desktop;
  const captureSeconds = Math.max(0.5, Number(seconds) || 6);

  const browser = await launchChromium();
  let page;
  try {
    if (signal?.aborted) throw new Error('Live capture aborted before starting.');
    page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    const session = await page.context().newCDPSession(page);
    const cdp = playwrightCdpAdapter(session);

    const t0 = Date.now();
    await cdp.send('Page.enable', {});
    await cdp.send('Runtime.enable', {});
    await cdp.send('Page.navigate', { url });
    console.warn(`[device-live-capture] navigating to ${url} (viewport=${viewport} ${vp.width}x${vp.height})`);
    await sleep(cap.warmupMs);
    let readiness = await waitForCaptureReady(cdp, undefined, cap);
    ({ readiness } = await settleStuckPage(cdp, undefined, cap, readiness));
    console.warn(`[device-live-capture] ready=${Boolean(readiness.ready)} after ${Date.now() - t0}ms (${readiness.reason || 'unknown'})`);

    // "Live capture GPU acceleration" checkpoint — GPU ground-truth for the
    // capture browser itself (probeGpuRenderer, same helper render.mjs's own
    // proven Video Promo pipeline uses — see this module's own header
    // comment on that function). A WebGL-hero live target rendered under
    // SOFTWARE WebGL is what made this path impractically slow before this
    // checkpoint (root cause: the capture browser was launched with no GPU
    // flags at all — see art-render.mjs's `_internals.captureDeviceLiveFrames`
    // launchChromium, now fixed). Logged AND carried into the returned
    // capture metadata (`gpu`) — never a silent slow crawl with no visible
    // explanation.
    const gpuProbe = await probeGpuRenderer(cdp, undefined, { logPrefix: '[device-live-capture]', blankWhat: 'device screen' });

    // Bug #2 (readiness) — strengthen confidence for canvas/WebGL pages
    // (every DOM-text signal reads zero) with a paint-stability pass; a
    // no-op for ordinary DOM sites (shouldCheckPaintStability returns false
    // whenever real text/heading signals already fired — unchanged path).
    let paintStability = null;
    if (shouldCheckPaintStability(readiness)) {
      paintStability = await waitForPaintStability(cdp, undefined, cap.paintStability);
      console.warn(`[device-live-capture] paint-stability stable=${paintStability.stable} after ${paintStability.waitedMs}ms (${paintStability.samples} samples)`);
    }
    readiness = { ...readiness, paintStability };

    // Prewarm only — triggers lazy-loaded content exactly like render.mjs's
    // own proven walk. Its returned `y` is deliberately NOT trusted as the
    // scroll target (bug #1: that measurement can already be stale relative
    // to the page's real height by the time it would be used) — only
    // `probe.how` is kept, for evidence/logging.
    const probe = await cdp.send('Runtime.evaluate', {
      expression: probeExpression({ target: { percent: scrollPercent } }),
      awaitPromise: true,
      returnByValue: true,
    }).then((r) => r.result.value).catch(() => ({ y: 0, how: 'err' }));

    // Bug #1 + #4 — reset to scrollTop 0 and VERIFY it by reading back (never
    // assumed), then wait a fixed settle buffer for any scroll-smoothing
    // library's own lagged visual state to catch up, THEN measure the true
    // max scroll extent fresh, right here (not reused from the probe's own
    // earlier, differently-timed measurement, and not reused from the
    // readiness snapshot taken before prewarm).
    const reset = await resetScrollAndVerify(cdp, undefined, cap.resetVerify);
    await sleep(cap.postResetSettleMs);
    const measured = await cdp.send('Runtime.evaluate', {
      expression: '(()=>{const de=document.scrollingElement||document.documentElement;return {scrollHeight:de.scrollHeight, maxScrollTop:Math.max(0,de.scrollHeight-innerHeight)};})()',
      returnByValue: true,
    }).then((r) => r.result.value).catch(() => ({ scrollHeight: 0, maxScrollTop: 0 }));

    const plan = computeCapturePlan({
      viewportHeight: vp.height, maxScrollTop: measured.maxScrollTop, captureSeconds, fps,
    });
    console.warn(`[device-live-capture] scroll plan: travel=${plan.travel}px (maxScrollTop=${plan.maxScrollTop}px, paceLimit=${Math.round(plan.paceLimitPx)}px) over ${plan.captureFrameCount} steps (desired output frames=${plan.desiredOutputFrames}), reset.ok=${reset.ok}`);

    // Bug #3 + #4 — deterministic stepped capture: exact scroll targets in
    // strictly non-decreasing order, one screenshot per step, guaranteeing
    // frame 0 === scrollTop 0 (the top of the page) by construction. Every
    // CDP call is timeout-guarded (raceTimeout — never hangs the capture
    // forever) and a step whose paint hasn't visibly committed yet is
    // retried (bounded) rather than accepted as a silent duplicate.
    const frames = [];
    let prevTargetY = null;
    let prevFrameData = null;
    let totalStaleRetries = 0;
    const stepLogEveryMs = 5000;
    let lastStepLog = t0;
    for (let i = 0; i < plan.captureFrameCount; i += 1) {
      if (signal?.aborted) throw new Error('Live capture aborted mid-capture.');
      // Overall capture wall-clock budget (MAX_CAPTURE_WALL_CLOCK_MS) — see
      // that constant's own header comment. Checked once per step (not
      // inside raceTimeout, which only bounds ONE call) so a page whose
      // every individual CDP call completes, just slowly, still can't run
      // unbounded: fail honestly with exactly what was measured instead of
      // hanging.
      const elapsedMs = Date.now() - t0;
      if (elapsedMs > cap.maxCaptureMs) {
        throw new Error(
          `Live capture of ${url} exceeded its overall budget (${cap.maxCaptureMs}ms) after ${elapsedMs}ms: `
          + `captured ${frames.length}/${plan.captureFrameCount} steps (${totalStaleRetries} stale-retries) before stopping. `
          + `GPU: ${gpuProbe.renderer} (${gpuProbe.software ? 'SOFTWARE' : 'GPU'}). `
          + 'This is a measured, honest failure — not a hang.',
        );
      }
      const frac = plan.captureFrameCount > 1 ? i / (plan.captureFrameCount - 1) : 0;
      const targetY = Math.round(plan.travel * frac);
      // eslint-disable-next-line no-await-in-loop -- deliberately sequential: each step's capture depends on the previous step's scroll having been applied and painted.
      await raceTimeout(cdp.send('Runtime.evaluate', { expression: `window.scrollTo(0, ${targetY})` }, undefined), cap.stepCdpTimeoutMs);
      // eslint-disable-next-line no-await-in-loop
      await raceTimeout(cdp.send('Runtime.evaluate', {
        expression: 'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',
        awaitPromise: true,
      }, undefined), cap.stepCdpTimeoutMs);
      // eslint-disable-next-line no-await-in-loop
      await sleep(cap.stepSettleMs);
      // eslint-disable-next-line no-await-in-loop
      const shot = await raceTimeout(cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 }, undefined), cap.stepCdpTimeoutMs);
      let data = shot?.data || null;

      // Stale-frame retry — see the constants' own header comment above for
      // the full rationale/evidence. Only engages when the TARGET genuinely
      // moved (never spins on a legitimately-static travel:0 page, where
      // every target is 0 by construction and a repeated frame is correct,
      // not stale).
      const targetChanged = prevTargetY === null || targetY !== prevTargetY;
      let staleRetries = 0;
      while (
        targetChanged && data && prevFrameData
        && jpegFingerprintDiff(prevFrameData, data) <= cap.staleFrameDiffThreshold
        && staleRetries < cap.maxStaleCaptureRetries
      ) {
        // eslint-disable-next-line no-await-in-loop -- bounded retry, deliberately sequential (each retry's outcome decides whether another is needed).
        await sleep(cap.staleRetrySettleMs);
        // eslint-disable-next-line no-await-in-loop
        const retryShot = await raceTimeout(cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 }, undefined), cap.stepCdpTimeoutMs);
        if (retryShot?.data) data = retryShot.data;
        staleRetries += 1;
      }
      totalStaleRetries += staleRetries;

      if (data) { frames.push(`data:image/jpeg;base64,${data}`); prevFrameData = data; }
      prevTargetY = targetY;

      if (Date.now() - lastStepLog >= stepLogEveryMs || i === plan.captureFrameCount - 1) {
        lastStepLog = Date.now();
        console.warn(`[device-live-capture] step ${i + 1}/${plan.captureFrameCount} (y=${targetY}px) — ${frames.length} frames so far, ${totalStaleRetries} stale-retries so far, ${Date.now() - t0}ms elapsed`);
      }
    }

    if (!frames.length) throw new Error(`no frames captured from ${url}`);
    console.warn(`[device-live-capture] captured ${frames.length} frames from ${url} in ${Date.now() - t0}ms total (${totalStaleRetries} total stale-frame retries, gpu=${gpuProbe.software ? 'SOFTWARE' : 'GPU'})`);
    return {
      frames,
      scrollInfo: {
        y: plan.travel, how: 'paced-stepped', maxScrollTop: plan.maxScrollTop, probeHow: probe.how, resetOk: reset.ok, staleRetryTotal: totalStaleRetries,
      },
      readiness,
      viewport: { width: vp.width, height: vp.height },
      gpu: gpuProbe,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
