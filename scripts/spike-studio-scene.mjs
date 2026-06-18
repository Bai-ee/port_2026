#!/usr/bin/env node
// Spike #2 — QUALITY proof for headless Mockup Studio capture.
//
// Renders a faithful replica of the REAL studio scene (device mockup + glass +
// PMREM RoomEnvironment IBL + 9000-pt animated loop + dust + ACES tonemapping)
// inside Browserless cloud Chromium, runs a real camera template, records via
// MediaRecorder, and returns the WebM here so we can judge SwiftShader quality
// BEFORE committing to the full build.
//
// Self-contained: no auth, no tunnel, no deploy. THREE loads from esm.sh inside
// the headless page. Screen = synthetic landing-page canvas (no CORS).
//
// Run: node scripts/spike-studio-scene.mjs [templateId] [seconds]
//   e.g. node scripts/spike-studio-scene.mjs spiral-in 6
// Writes: scripts/spike-studio.webm

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

function loadEnv() {
  if (process.env.BROWSERLESS_TOKEN) return;
  try {
    const raw = readFileSync(join(repoRoot, '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (!process.env[m[1]]) process.env[m[1]] = val;
    }
  } catch { /* rely on process.env */ }
}
loadEnv();

const TOKEN = String(process.env.BROWSERLESS_TOKEN || '').trim();
const BASE = String(process.env.BROWSERLESS_BASE_URL || 'https://production-sfo.browserless.io').trim().replace(/\/+$/, '');
if (!TOKEN) { console.error('✗ BROWSERLESS_TOKEN not found.'); process.exit(1); }

const TEMPLATE_ID = process.argv[2] || 'spiral-in'; // kept for label only; motion is single A→B
const SECONDS = Math.max(1, Math.min(8, Number(process.argv[3]) || 4));      // total clip length
const MOVE_SECONDS = Math.max(0.5, Math.min(SECONDS, Number(process.argv[4]) || 1.5)); // A→B duration, rest holds
const FPS = Math.max(24, Math.min(30, Number(process.argv[5]) || 30));
const SITE_URL = process.env.SPIKE_SITE_URL || 'https://hitloop.agency';
const CAPTURE_MS = Math.max(1000, Math.min(6000, Number(process.env.SPIKE_CAPTURE_MS) || 3500)); // post-DCL load-capture window

// ── In-page scene (string, runs inside headless Chromium as a module) ─────────
// Mirrors app/dashboard/studio/page.jsx scene + camera math 1:1 on the parts
// that stress the GPU. Differences from prod are intentional and noted.
const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#0b0b0f;overflow:hidden}
  #stage{position:fixed;inset:0}
</style></head><body>
<div id="stage"></div>
<script type="module">
  window.__RESULT = null; window.__DONE = false; window.__ERR = null;
  const TEMPLATE_ID = ${JSON.stringify(TEMPLATE_ID)};
  const SECONDS = ${SECONDS};
  const MOVE_SECONDS = ${MOVE_SECONDS};    // single A→B move; clip holds on B after
  const FPS = ${FPS};                      // fixed output fps (CFR via WebCodecs)
  const CANVAS_W = 2048, CANVAS_H = 1280;  // slightly above the 1920 sample
  const LOOP_OVERRIDE = 9000;              // prod loop density (faithful)

  const _t = []; let _last = performance.now();
  const _mark = (n) => { const x = performance.now(); _t.push(n + '=' + Math.round(x - _last) + 'ms'); _last = x; };
  try {
    const THREE = await import('https://esm.sh/three@0.160.0');
    const { RoomEnvironment } = await import('https://esm.sh/three@0.160.0/examples/jsm/environments/RoomEnvironment.js');
    const { RoundedBoxGeometry } = await import('https://esm.sh/three@0.160.0/examples/jsm/geometries/RoundedBoxGeometry.js');
    _mark('esm-import');

    // ── Constants copied verbatim from page.jsx ──
    const VIEWPORTS = {
      desktop: { width: 1440, height: 900, bezel: 30, depth: 40, corner: 26, screenCorner: 14, camZ: 2700, label: 'DESKTOP' },
      mobile:  { width: 390,  height: 844, bezel: 18, depth: 24, corner: 64, screenCorner: 48, camZ: 1500, label: 'MOBILE' },
      tablet:  { width: 768,  height: 1024, bezel: 24, depth: 26, corner: 48, screenCorner: 32, camZ: 1900, label: 'TABLET' },
    };
    const DEG = Math.PI / 180;
    const templatePose = (vp, [rF, az, el, txF = 0, tyF = 0]) => {
      const r = vp.camZ * rF;
      return { px: r*Math.sin(az*DEG)*Math.cos(el*DEG), py: r*Math.sin(el*DEG), pz: r*Math.cos(az*DEG)*Math.cos(el*DEG), tx: txF*vp.width*0.5, ty: tyF*vp.height*0.5, tz: 0 };
    };
    const CAMERA_TEMPLATES = [
      { id:'hero-push', seconds:10, keys:[[2.2,-16,14],[1.4,-9,8],[0.85,-4,4],[0.34,-1,1,0,0,0.8],[0.34,0,0,0,0.15],[0.7,3,3],[1.4,9,8,0,0,0.5],[2.0,14,12]] },
      { id:'orbit-reveal', seconds:10, keys:[[1.5,-75,8],[1.15,-40,10],[0.4,-12,4,-0.55,0.35,0.6],[1.2,5,9],[0.4,18,4,0.55,-0.35,0.6],[1.2,45,10],[1.5,70,8],[1.3,40,8]] },
      { id:'spiral-in', seconds:10, keys:[[2.3,-130,26],[1.8,-90,20],[1.35,-55,15],[0.95,-28,10],[0.6,-10,5],[0.32,0,2,0,0,1.0],[0.32,4,1,0.2,0.1],[0.8,12,4]] },
      { id:'whip-arc', seconds:6, keys:[[1.4,-65,5],[0.35,-25,6,-0.6,0.4,0.3],[1.2,10,10],[0.3,35,4,0.6,0.4,0.3],[1.3,60,5],[0.32,20,-4,0.5,-0.45,0.3],[1.1,-15,8],[0.5,-40,4,-0.4,-0.3]] },
    ];
    const buildTemplateKeyframes = (tpl, vpId) => {
      const vp = VIEWPORTS[vpId] || VIEWPORTS.desktop;
      const totalUnits = (tpl.keys.length - 1) + tpl.keys.reduce((s,k)=>s+(k[5]||0),0);
      const kf = []; let unit = 0;
      tpl.keys.forEach((k,i) => {
        const pose = templatePose(vp, k);
        kf.push({ t: unit/totalUnits, ...pose });
        if (k[5]) { unit += k[5]; kf.push({ t: unit/totalUnits, ...pose }); }
        unit += 1;
      });
      return kf;
    };

    const vpId = 'desktop';
    const vp = VIEWPORTS[vpId];
    // Single featured transition: readable medium framing (A, screen legible so
    // the load is visible) → close near-head-on detail (B).
    const A_KEY = [1.05, -14, 10];
    const B_KEY = [0.62, -3, 3];
    const keyframes = [ { t:0, ...templatePose(vp, A_KEY) }, { t:1, ...templatePose(vp, B_KEY) } ];

    // applyPath — smoothstep per segment, identical to page.jsx
    const applyPath = (u, camera, target) => {
      const s = keyframes;
      const set = (k) => { camera.position.set(k.px,k.py,k.pz); target.set(k.tx,k.ty,k.tz); };
      if (u <= s[0].t) return set(s[0]);
      if (u >= s[s.length-1].t) return set(s[s.length-1]);
      let i = 0; while (i < s.length-2 && s[i+1].t < u) i++;
      const a = s[i], b = s[i+1];
      let t = (u - a.t) / Math.max(1e-6, b.t - a.t);
      t = t*t*(3-2*t);
      const L = (p,q) => p + (q-p)*t;
      camera.position.set(L(a.px,b.px), L(a.py,b.py), L(a.pz,b.pz));
      target.set(L(a.tx,b.tx), L(a.ty,b.ty), L(a.tz,b.tz));
    };

    // ── Renderer / scene (matches page.jsx) ──
    const stage = document.getElementById('stage');
    const scene = new THREE.Scene();
    // near=10 (not 1) + far=20000 tightens depth precision to kill screen/glass
    // z-fighting; far still clears the 14000-radius sky dome.
    const camera = new THREE.PerspectiveCamera(38, CANVAS_W/CANVAS_H, 10, 20000);
    const target = new THREE.Vector3(0,0,0);
    const glRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    glRenderer.setPixelRatio(1);
    glRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    glRenderer.toneMappingExposure = 1.05;
    glRenderer.setSize(CANVAS_W, CANVAS_H, false);
    stage.appendChild(glRenderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const keyL = new THREE.DirectionalLight(0xffffff, 1.2); keyL.position.set(600,900,800); scene.add(keyL);
    const rimL = new THREE.DirectionalLight(0x88ffee, 0.5); rimL.position.set(-800,300,-600); scene.add(rimL);

    const pmrem = new THREE.PMREMGenerator(glRenderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    // Sky dome — HITLOOP gradient baked on canvas
    const skyMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, toneMapped:false, depthWrite:false });
    {
      const c = document.createElement('canvas'); c.width=2048; c.height=1024; const x=c.getContext('2d');
      x.fillStyle='#ffffff'; x.fillRect(0,0,2048,1024);
      let g=x.createRadialGradient(370,225,0,370,225,1440); g.addColorStop(0,'rgba(196,124,86,0.26)'); g.addColorStop(0.62,'rgba(196,124,86,0)'); x.fillStyle=g; x.fillRect(0,0,2048,1024);
      g=x.createRadialGradient(1600,717,0,1600,717,1640); g.addColorStop(0,'rgba(102,184,164,0.22)'); g.addColorStop(0.66,'rgba(102,184,164,0)'); x.fillStyle=g; x.fillRect(0,0,2048,1024);
      g=x.createLinearGradient(0,0,2048,1024); g.addColorStop(0,'rgba(214,191,123,0.16)'); g.addColorStop(0.38,'rgba(255,255,255,0)'); g.addColorStop(1,'rgba(171,148,218,0.18)'); x.fillStyle=g; x.fillRect(0,0,2048,1024);
      const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; skyMat.map=t;
    }
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(14000,48,32), skyMat));

    // Dust sprite + 500 points
    const dustSprite = (()=>{ const c=document.createElement('canvas'); c.width=c.height=64; const x=c.getContext('2d'); const g=x.createRadialGradient(32,32,0,32,32,32); g.addColorStop(0,'rgba(255,255,255,0.9)'); g.addColorStop(1,'rgba(255,255,255,0)'); x.fillStyle=g; x.fillRect(0,0,64,64); const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; return t; })();
    const DUST=500, dustGeo=new THREE.BufferGeometry(), dustPos=new Float32Array(DUST*3);
    for (let i=0;i<DUST;i++){ const a=(i*137.508)%360*(Math.PI/180); const rr=1200+((i*911)%4800); dustPos[i*3]=Math.cos(a)*rr; dustPos[i*3+1]=(((i*389)%3600)-1800); dustPos[i*3+2]=Math.sin(a)*rr; }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos,3));
    const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map:dustSprite, size:26, transparent:true, opacity:0.35, depthWrite:false, color:0xab94da }));
    scene.add(dust);

    // 9000-pt animated loop ring
    const LOOP=LOOP_OVERRIDE, LOOP_BASE=2600, loopGeo=new THREE.BufferGeometry();
    loopGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LOOP*3),3));
    loopGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(LOOP*3),3));
    const loopPts = new THREE.Points(loopGeo, new THREE.PointsMaterial({ size:20, vertexColors:true, map:dustSprite, transparent:true, opacity:0.85, depthWrite:false }));
    loopPts.frustumCulled = false;
    const loopGroup = new THREE.Group(); loopGroup.add(loopPts); loopGroup.position.set(0,0,-1400); loopGroup.scale.setScalar(1.6); scene.add(loopGroup);
    const loopColor = new THREE.Color(), GOLDEN = 2.39996322972865332;
    const updateLoop = (time) => {
      const pos=loopGeo.attributes.position.array, col=loopGeo.attributes.color.array;
      const R=0.5, r=0.1, r1=R+r*0.2*Math.sin(time*0.5);
      for (let i=0;i<LOOP;i++){ const t=i/LOOP; const u=i*GOLDEN+time*0.05; const phi=Math.acos(1-2*t); const v=phi*2+time*0.4;
        const x4=r1*Math.cos(u), y4=r1*Math.sin(u), z4=r*Math.cos(v), w4=r*Math.sin(v), d=2-w4, i3=i*3;
        pos[i3]=(x4/d)*LOOP_BASE; pos[i3+1]=(y4/d)*LOOP_BASE; pos[i3+2]=(z4/d)*LOOP_BASE*0.8;
        loopColor.setHSL((0.36+t*0.8+time*0.02)%1,0.75,0.42); col[i3]=loopColor.r; col[i3+1]=loopColor.g; col[i3+2]=loopColor.b; }
      loopGeo.attributes.position.needsUpdate=true; loopGeo.attributes.color.needsUpdate=true;
    };

    // Real hitloop.agency screenshot, injected as window.__SCREENSHOT (jpeg
    // data URL) by the driver before this module runs. Poll briefly in case the
    // inject lands just after THREE finishes importing.
    // Animated screen: a 2D canvas re-drawn each rendered frame. During the move
    // it plays the captured site-load frames; the final move frame swaps to the
    // crisp hi-res static shot so the hold reads sharp.
    const maxAniso = glRenderer.capabilities.getMaxAnisotropy();
    for (let i=0;i<60 && window.__LOADFRAMES===undefined && !window.__SCREENSHOT;i++) await new Promise(r=>setTimeout(r,100));
    const screenCanvas=document.createElement('canvas'); screenCanvas.width=vp.width; screenCanvas.height=vp.height;
    const sctx=screenCanvas.getContext('2d'); sctx.fillStyle='#0e1116'; sctx.fillRect(0,0,vp.width,vp.height);
    const screenTex=new THREE.CanvasTexture(screenCanvas);
    // No mipmaps — the screen ~fills the view, and per-frame mip regen is slow on
    // SwiftShader. LinearFilter keeps per-frame texture upload cheap.
    screenTex.colorSpace=THREE.SRGBColorSpace; screenTex.anisotropy=maxAniso; screenTex.generateMipmaps=false; screenTex.minFilter=THREE.LinearFilter;
    const decodeUrl=async(u)=>{ if(!u) return null; const im=new Image(); im.src=u; try{await im.decode();}catch{return null;} return im; };
    const liveFrames=(await Promise.all((window.__LOADFRAMES||[]).map(decodeUrl))).filter(Boolean);
    const staticImg=await decodeUrl(window.__SCREENSHOT);
    const drawScreen=(img)=>{ if(!img) return; sctx.fillStyle='#fff'; sctx.fillRect(0,0,vp.width,vp.height); sctx.drawImage(img,0,0,vp.width,vp.height); screenTex.needsUpdate=true; };
    drawScreen(liveFrames[0]||staticImg);

    // Build device (desktop) — matches buildDevice geometry/materials
    const roundedRect = (W,H,r) => {
      const hw=W/2, hh=H/2, s=new THREE.Shape();
      s.moveTo(-hw+r,-hh); s.lineTo(hw-r,-hh); s.quadraticCurveTo(hw,-hh,hw,-hh+r);
      s.lineTo(hw,hh-r); s.quadraticCurveTo(hw,hh,hw-r,hh); s.lineTo(-hw+r,hh); s.quadraticCurveTo(-hw,hh,-hw,hh-r);
      s.lineTo(-hw,-hh+r); s.quadraticCurveTo(-hw,-hh,-hw+r,-hh);
      const g=new THREE.ShapeGeometry(s,24), uv=g.attributes.uv;
      for (let i=0;i<uv.count;i++) uv.setXY(i,(uv.getX(i)+hw)/W,(uv.getY(i)+hh)/H);
      return g;
    };
    const { width:W, height:H, bezel:B, depth:D, corner, screenCorner } = vp;
    const alumMat = new THREE.MeshPhysicalMaterial({ color:0xd6d8da, metalness:0.9, roughness:0.34, envMapIntensity:1.5 });
    const glassMat = new THREE.MeshPhysicalMaterial({ color:0x050507, roughness:0.06, metalness:0.1, clearcoat:1, clearcoatRoughness:0.03, envMapIntensity:1.2 });
    const dg = new THREE.Group(); scene.add(dg);
    const body = new THREE.Mesh(new RoundedBoxGeometry(W+B*2,H+B*2,D,5,Math.min(corner,D/2-1)), alumMat); body.position.z=-D/2-1; dg.add(body);
    const face = new THREE.Mesh(roundedRect(W+B*2-6,H+B*2-6,Math.max(screenCorner,corner*0.7)), glassMat); face.position.z=0.4; dg.add(face);
    const arm = new THREE.Mesh(new RoundedBoxGeometry(150,320,20,4,9), alumMat); arm.position.set(0,-(H/2+B+130),-D-24); arm.rotation.x=-0.12; dg.add(arm);
    const foot = new THREE.Mesh(new RoundedBoxGeometry(360,14,250,4,7), alumMat); foot.position.set(0,-(H/2+B+280),-D+60); dg.add(foot);
    const screenMat = new THREE.MeshBasicMaterial({ map:screenTex, toneMapped:false, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2 });
    const screen = new THREE.Mesh(roundedRect(W,H,screenCorner), screenMat); screen.position.z=4; dg.add(screen);

    // Open on first pose
    applyPath(0, camera, target); camera.lookAt(target);
    _mark('scene-build');

    // ── Encode (WebCodecs + webm-muxer) ──
    // Explicit fixed-fps timestamps → true CFR, so the hold phase holds exactly.
    // Only the MOVE frames are 3D-rendered; HOLD frames re-encode the unchanged
    // canvas (near-zero GPU cost) — this is what makes a full-res 4s clip fit.
    let renderer='unknown'; { const gl=glRenderer.getContext(); const dbg=gl.getExtension('WEBGL_debug_renderer_info'); renderer=dbg?gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL):'unknown'; }
    try {
      const { Muxer, ArrayBufferTarget } = await import('https://esm.sh/webm-muxer@5.0.3');

      // Pick a supported VP9/VP8 codec config.
      const candidates = [
        { codec:'vp09.00.31.08', mux:'V_VP9' },
        { codec:'vp09.00.10.08', mux:'V_VP9' },
        { codec:'vp8',           mux:'V_VP8' },
      ];
      let chosen=null;
      for (const c of candidates) {
        const sup = await VideoEncoder.isConfigSupported({ codec:c.codec, width:CANVAS_W, height:CANVAS_H, bitrate:14_000_000, framerate:FPS });
        if (sup.supported) { chosen=c; break; }
      }
      if (!chosen) { window.__RESULT={ ok:false, renderer, reason:'no VP8/VP9 VideoEncoder config' }; window.__DONE=true; }
      else {
        const muxer = new Muxer({ target:new ArrayBufferTarget(), video:{ codec:chosen.mux, width:CANVAS_W, height:CANVAS_H, frameRate:FPS } });
        const encoder = new VideoEncoder({ output:(chunk,meta)=>muxer.addVideoChunk(chunk,meta), error:(e)=>{ window.__ERR='encoder: '+e.message; } });
        encoder.configure({ codec:chosen.codec, width:CANVAS_W, height:CANVAS_H, bitrate:14_000_000, framerate:FPS, latencyMode:'quality' });

        const totalFrames = Math.max(2, Math.round(FPS * SECONDS));
        const moveFrames  = Math.max(1, Math.round(FPS * MOVE_SECONDS));
        const frameDurUs  = Math.round(1_000_000 / FPS);
        const yield1 = () => new Promise(r=>setTimeout(r,0));
        const t0=performance.now();
        let rendered=0;

        for (let f=0; f<totalFrames; f++) {
          if (f <= moveFrames) {
            const u = f/moveFrames;                 // 0..1 across the move
            // Live site: play load frames across the move; last move frame
            // settles on the crisp static shot for the hold.
            if (f===moveFrames) drawScreen(staticImg || liveFrames[liveFrames.length-1]);
            else if (liveFrames.length) drawScreen(liveFrames[Math.min(liveFrames.length-1, Math.floor(u*(liveFrames.length-1)))]);
            const sceneTime = u*MOVE_SECONDS;
            dust.rotation.y = sceneTime*0.008;
            updateLoop(sceneTime);
            applyPath(u, camera, target); camera.lookAt(target);
            glRenderer.render(scene, camera);
            rendered++;
          }
          // else: HOLD — canvas already shows pose B's last frame, just re-encode it.
          const frame = new VideoFrame(glRenderer.domElement, { timestamp: f*frameDurUs, duration: frameDurUs });
          encoder.encode(frame, { keyFrame: f % FPS === 0 });
          frame.close();
          if (f % 8 === 0) await yield1();          // keep the event loop breathing
        }
        const renderMs = performance.now()-t0;
        _mark('render+encode-loop');
        await encoder.flush();
        muxer.finalize();
        _mark('flush+finalize');

        const bytes = new Uint8Array(muxer.target.buffer);
        let bin=''; const CH=0x8000; for (let i=0;i<bytes.length;i+=CH) bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+CH));
        window.__RESULT={ ok:true, renderer, codec:chosen.codec, template:'A→B', seconds:SECONDS, moveSeconds:MOVE_SECONDS, fps:FPS,
          totalFrames, renderedFrames:rendered, heldFrames: totalFrames-rendered,
          msPerRenderedFrame: Math.round(renderMs/Math.max(1,rendered)), renderSeconds: Math.round(renderMs/100)/10,
          inPageTimings: _t, size:bytes.length, b64:btoa(bin) };
        window.__DONE=true;
      }
    } catch (e) {
      window.__ERR = 'encode path: ' + String(e && e.stack || e); window.__DONE = true;
    }
  } catch (e) {
    window.__ERR = String(e && e.stack || e); window.__DONE = true;
  }
</script></body></html>`;

// Browserless /function body — drives the page, waits, extracts result.
// Single /function call does it all: screencast the load, grab a crisp 2× hold
// shot, then render. domcontentloaded + a bounded capture window keeps the site
// phase short (waitUntil:'load' can hang on modern sites).
const fnCode = `
export default async function ({ page }) {
  const T = []; let last = Date.now();
  const mark = (name) => { const n = Date.now(); T.push(name + '=' + (n - last) + 'ms'); last = n; };

  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const liveFrames = [];
  const client = await page.target().createCDPSession();
  client.on('Page.screencastFrame', async (e) => {
    try { liveFrames.push('data:image/jpeg;base64,' + e.data); } catch {}
    try { await client.send('Page.screencastFrameAck', { sessionId: e.sessionId }); } catch {}
  });
  await client.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1 }).catch(() => {});
  await page.goto(${JSON.stringify(SITE_URL)}, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, ${CAPTURE_MS})); // capture the intro window
  await client.send('Page.stopScreencast').catch(() => {});
  mark('nav+screencast');

  // The last screencast frame IS the fully-loaded site — use it for the hold.
  // (A separate page.screenshot() of hitloop takes ~32s — the page never idles.)
  const SHOT = liveFrames.length ? liveFrames[liveFrames.length - 1] : null;
  let distinctFrames = liveFrames.length ? 1 : 0;
  for (let i = 1; i < liveFrames.length; i++) if (liveFrames[i] !== liveFrames[i - 1]) distinctFrames++;

  // hitloop's CSP would block the esm.sh THREE import after setContent. Bounce to
  // a permissive https origin (still a secure context for WebCodecs) first.
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
  mark('csp-reset');

  await page.setContent(${JSON.stringify(PAGE_HTML)}, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate((shot, lf) => { window.__SCREENSHOT = shot; window.__LOADFRAMES = lf; }, SHOT, liveFrames);
  mark('setContent+inject');

  await page.waitForFunction('window.__DONE === true', { timeout: 48000, polling: 250 });
  mark('scene+render+encode');
  const err = await page.evaluate(() => window.__ERR);
  const result = await page.evaluate(() => window.__RESULT);
  return { data: { err, result, hadShot: !!SHOT, loadFrames: liveFrames.length, distinctFrames, timings: T }, type: 'application/json' };
}
`;

console.log(`→ one-call: screencast load + render ${SITE_URL}`);

const endpoint = `${BASE}/function?token=${encodeURIComponent(TOKEN)}&timeout=60000`;
console.log(`→ template=${TEMPLATE_ID} seconds=${SECONDS} fps=${FPS} site=${SITE_URL}  POST ${BASE}/function`);
const t0 = Date.now();

let res;
try {
  res = await fetch(endpoint, {
    method: 'POST',
    signal: AbortSignal.timeout(70000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: fnCode }),
  });
} catch (err) { console.error(`✗ Request failed: ${err.message}`); process.exit(1); }

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
if (!res.ok) { console.error(`✗ HTTP ${res.status} after ${elapsed}s\n${(await res.text().catch(()=>'')).slice(0,800)}`); process.exit(1); }

const payload = await res.json().catch(() => null);
const data = payload?.data ?? payload;
if (data?.err) { console.error(`✗ In-page error after ${elapsed}s:\n${data.err}`); process.exit(1); }
const r = data?.result;
if (!r) { console.error('✗ No result:', JSON.stringify(payload).slice(0,400)); process.exit(1); }

console.log(`\n── Real-scene headless capture, CFR via WebCodecs (${elapsed}s wall) ──`);
console.log(`GL renderer  : ${r.renderer}`);
console.log(`Real screen  : ${SITE_URL} — ${data.loadFrames || 0} load frames, ${data.distinctFrames || 0} DISTINCT (motion ${(data.distinctFrames||0) > 3 ? 'YES' : 'NONE — site static headless'})`);
console.log(`Motion       : ${r.template}  ${r.moveSeconds}s move + ${(r.seconds - r.moveSeconds).toFixed(1)}s hold = ${r.seconds}s @ ${r.fps}fps`);
console.log(`Frames       : ${r.totalFrames} total — ${r.renderedFrames} rendered, ${r.heldFrames} held (re-encoded only)`);
console.log(`Render time  : ${r.renderSeconds}s  (${r.msPerRenderedFrame} ms/rendered frame)`);
console.log(`Codec        : ${r.codec}`);
console.log(`WebM size    : ${(r.size/1024/1024).toFixed(2)} MB`);
if (data.timings) console.log(`Fn phases    : ${data.timings.join('  ')}`);
if (r.inPageTimings) console.log(`In-page      : ${r.inPageTimings.join('  ')}`);

if (r.ok && r.b64) {
  const out = join(__dirname, 'spike-studio.webm');
  writeFileSync(out, Buffer.from(r.b64, 'base64'));
  console.log(`\n✓ Wrote ${out}  (true ${r.fps}fps CFR — no re-encode needed)`);
  const cap = 50; // usable render budget inside the 60s function cap
  const maxRendered = Math.floor((cap*1000)/r.msPerRenderedFrame);
  console.log(`  Budget: ~${maxRendered} rendered frames (~${(maxRendered/r.fps).toFixed(1)}s of MOVE) fit one ${cap}s call; hold time is ~free.`);
  if (r.renderSeconds > cap) console.log(`  ⚠ Render (${r.renderSeconds}s) over ${cap}s cap — shorten the move.`);
} else {
  console.error(`\n✗ No video produced (reason: ${r.reason || 'unknown'}).`);
  process.exit(1);
}
