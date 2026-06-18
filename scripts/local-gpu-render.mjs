#!/usr/bin/env node
// Full local-GPU render: drive local Chrome (real GPU) via raw CDP. Screencast
// the live, animating target site, then render the 3D device scene with the live
// site playing on the screen, A→B camera move + hold (site keeps animating
// throughout), WebCodecs CFR export. No cloud, no new deps.
//
// localhost (127.0.0.1) is a secure context → WebCodecs available, no CSP issues.
//
// Run: node scripts/local-gpu-render.mjs [url] [seconds] [moveSeconds] [fps]
// Writes: scripts/local-render.webm

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = dirname(fileURLToPath(import.meta.url));
const URL_TARGET = process.argv[2] || 'https://hitloop.agency';
const SECONDS = Math.max(2, Math.min(12, Number(process.argv[3]) || 6));
const MOVE_SECONDS = Math.max(0.5, Math.min(SECONDS, Number(process.argv[4]) || 2.5));
const FPS = Math.max(24, Math.min(60, Number(process.argv[5]) || 30));
const SITE_SPEED = Math.max(0.25, Math.min(4, Number(process.argv[6]) || 1)); // 1 = real-time site playback
const WARMUP_MS = Math.max(0, Number(process.argv[7] ?? 700));  // delay after nav before capture: small = include load-in, large = skip to steady
const CANVAS_W = 1920, CANVAS_H = 1200;
const CAPTURE_MS = Math.round(SECONDS * 1000 + 600); // capture the clip's worth of motion (incl. the load-in)
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// ── Scene page (runs in local Chrome, GPU) ───────────────────────────────────
const SCENE_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#0b0b0f;overflow:hidden}#stage{position:fixed;inset:0}
</style></head><body><div id="stage"></div>
<script type="module">
  window.__DONE=false; window.__ERR=null; window.__RESULT=null;
  const SECONDS=${SECONDS}, MOVE_SECONDS=${MOVE_SECONDS}, FPS=${FPS}, CANVAS_W=${CANVAS_W}, CANVAS_H=${CANVAS_H};
  try {
    const THREE = await import('https://esm.sh/three@0.160.0');
    const { RoomEnvironment } = await import('https://esm.sh/three@0.160.0/examples/jsm/environments/RoomEnvironment.js');
    const { RoundedBoxGeometry } = await import('https://esm.sh/three@0.160.0/examples/jsm/geometries/RoundedBoxGeometry.js');
    const { Muxer, ArrayBufferTarget } = await import('https://esm.sh/webm-muxer@5.0.3');

    const VIEWPORTS = { desktop:{ width:1440,height:900,bezel:30,depth:40,corner:26,screenCorner:14,camZ:2700 } };
    const vp = VIEWPORTS.desktop;
    const DEG=Math.PI/180;
    const templatePose=(vp,[rF,az,el,txF=0,tyF=0])=>{ const r=vp.camZ*rF; return { px:r*Math.sin(az*DEG)*Math.cos(el*DEG), py:r*Math.sin(el*DEG), pz:r*Math.cos(az*DEG)*Math.cos(el*DEG), tx:txF*vp.width*0.5, ty:tyF*vp.height*0.5, tz:0 }; };
    // A→B push-in, then keep moving: rotate around and zoom FLAT (head-on) onto
    // the scrolled-to video-player section at screen center. Never fully stops.
    const PATH=[[0,[1.05,-14,10]],[0.25,[0.62,-3,3]],[0.55,[0.50,14,-3]],[0.82,[0.32,0,0,0,0]],[1,[0.30,0,0,0,0]]];
    const keyframes=PATH.map(([t,k])=>({t,...templatePose(vp,k)}));
    const applyPath=(u,camera,target)=>{ const s=keyframes; const set=k=>{camera.position.set(k.px,k.py,k.pz);target.set(k.tx,k.ty,k.tz);};
      if(u<=s[0].t)return set(s[0]); if(u>=s[s.length-1].t)return set(s[s.length-1]);
      let i=0; while(i<s.length-2&&s[i+1].t<u)i++; const a=s[i],b=s[i+1]; let t=(u-a.t)/Math.max(1e-6,b.t-a.t); t=t*t*(3-2*t);
      const L=(p,q)=>p+(q-p)*t; camera.position.set(L(a.px,b.px),L(a.py,b.py),L(a.pz,b.pz)); target.set(L(a.tx,b.tx),L(a.ty,b.ty),L(a.tz,b.tz)); };

    const stage=document.getElementById('stage');
    const scene=new THREE.Scene();
    const camera=new THREE.PerspectiveCamera(38,CANVAS_W/CANVAS_H,10,20000);
    const target=new THREE.Vector3(0,0,0);
    const glRenderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
    glRenderer.setPixelRatio(1); glRenderer.toneMapping=THREE.ACESFilmicToneMapping; glRenderer.toneMappingExposure=1.05;
    glRenderer.setSize(CANVAS_W,CANVAS_H,false); stage.appendChild(glRenderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff,0.7));
    const kL=new THREE.DirectionalLight(0xffffff,1.2); kL.position.set(600,900,800); scene.add(kL);
    const rL=new THREE.DirectionalLight(0x88ffee,0.5); rL.position.set(-800,300,-600); scene.add(rL);
    const pmrem=new THREE.PMREMGenerator(glRenderer); scene.environment=pmrem.fromScene(new RoomEnvironment(),0.04).texture;

    const skyMat=new THREE.MeshBasicMaterial({side:THREE.BackSide,toneMapped:false,depthWrite:false});
    { const c=document.createElement('canvas'); c.width=2048;c.height=1024; const x=c.getContext('2d');
      x.fillStyle='#fff'; x.fillRect(0,0,2048,1024);
      let g=x.createRadialGradient(370,225,0,370,225,1440); g.addColorStop(0,'rgba(196,124,86,0.26)'); g.addColorStop(0.62,'rgba(196,124,86,0)'); x.fillStyle=g; x.fillRect(0,0,2048,1024);
      g=x.createRadialGradient(1600,717,0,1600,717,1640); g.addColorStop(0,'rgba(102,184,164,0.22)'); g.addColorStop(0.66,'rgba(102,184,164,0)'); x.fillStyle=g; x.fillRect(0,0,2048,1024);
      g=x.createLinearGradient(0,0,2048,1024); g.addColorStop(0,'rgba(214,191,123,0.16)'); g.addColorStop(0.38,'rgba(255,255,255,0)'); g.addColorStop(1,'rgba(171,148,218,0.18)'); x.fillStyle=g; x.fillRect(0,0,2048,1024);
      const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; skyMat.map=t; }
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(14000,48,32),skyMat));

    const dustSprite=(()=>{ const c=document.createElement('canvas'); c.width=c.height=64; const x=c.getContext('2d'); const g=x.createRadialGradient(32,32,0,32,32,32); g.addColorStop(0,'rgba(255,255,255,0.9)'); g.addColorStop(1,'rgba(255,255,255,0)'); x.fillStyle=g; x.fillRect(0,0,64,64); const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; return t; })();
    const DUST=500,dustGeo=new THREE.BufferGeometry(),dustPos=new Float32Array(DUST*3);
    for(let i=0;i<DUST;i++){ const a=(i*137.508)%360*(Math.PI/180); const rr=1200+((i*911)%4800); dustPos[i*3]=Math.cos(a)*rr; dustPos[i*3+1]=(((i*389)%3600)-1800); dustPos[i*3+2]=Math.sin(a)*rr; }
    dustGeo.setAttribute('position',new THREE.BufferAttribute(dustPos,3));
    const dust=new THREE.Points(dustGeo,new THREE.PointsMaterial({map:dustSprite,size:26,transparent:true,opacity:0.35,depthWrite:false,color:0xab94da})); scene.add(dust);

    const LOOP=9000,LOOP_BASE=2600,loopGeo=new THREE.BufferGeometry();
    loopGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(LOOP*3),3));
    loopGeo.setAttribute('color',new THREE.BufferAttribute(new Float32Array(LOOP*3),3));
    const loopPts=new THREE.Points(loopGeo,new THREE.PointsMaterial({size:20,vertexColors:true,map:dustSprite,transparent:true,opacity:0.85,depthWrite:false})); loopPts.frustumCulled=false;
    const loopGroup=new THREE.Group(); loopGroup.add(loopPts); loopGroup.position.set(0,0,-1400); loopGroup.scale.setScalar(1.6); scene.add(loopGroup);
    const loopColor=new THREE.Color(),GOLDEN=2.39996322972865332;
    const updateLoop=(time)=>{ const pos=loopGeo.attributes.position.array,col=loopGeo.attributes.color.array; const R=0.5,r=0.1,r1=R+r*0.2*Math.sin(time*0.5);
      for(let i=0;i<LOOP;i++){ const t=i/LOOP; const u=i*GOLDEN+time*0.05; const phi=Math.acos(1-2*t); const v=phi*2+time*0.4;
        const x4=r1*Math.cos(u),y4=r1*Math.sin(u),z4=r*Math.cos(v),w4=r*Math.sin(v),d=2-w4,i3=i*3;
        pos[i3]=(x4/d)*LOOP_BASE; pos[i3+1]=(y4/d)*LOOP_BASE; pos[i3+2]=(z4/d)*LOOP_BASE*0.8;
        loopColor.setHSL((0.36+t*0.8+time*0.02)%1,0.75,0.42); col[i3]=loopColor.r;col[i3+1]=loopColor.g;col[i3+2]=loopColor.b; }
      loopGeo.attributes.position.needsUpdate=true; loopGeo.attributes.color.needsUpdate=true; };

    // Live site frames (captured by the driver) — play across the whole clip so
    // the site keeps animating even while the camera holds.
    const data = await fetch('/frames').then(r=>r.json());
    const SITE_SPEED=${SITE_SPEED};
    // Decode sequentially — Promise.all of hundreds of Images drops many decodes.
    const liveImgs=[]; for(const u of (data.live||[])){ const im=new Image(); im.src=u; try{await im.decode(); liveImgs.push(im);}catch{} }
    const screenCanvas=document.createElement('canvas'); screenCanvas.width=vp.width; screenCanvas.height=vp.height;
    const sctx=screenCanvas.getContext('2d'); sctx.fillStyle='#fff'; sctx.fillRect(0,0,vp.width,vp.height);
    const screenTex=new THREE.CanvasTexture(screenCanvas); screenTex.colorSpace=THREE.SRGBColorSpace; screenTex.anisotropy=glRenderer.capabilities.getMaxAnisotropy(); screenTex.generateMipmaps=false; screenTex.minFilter=THREE.LinearFilter;
    const drawScreen=(img)=>{ if(!img)return; sctx.fillStyle='#fff'; sctx.fillRect(0,0,vp.width,vp.height); sctx.drawImage(img,0,0,vp.width,vp.height); screenTex.needsUpdate=true; };
    drawScreen(liveImgs[0]);

    const roundedRect=(W,H,r)=>{ const hw=W/2,hh=H/2,s=new THREE.Shape();
      s.moveTo(-hw+r,-hh);s.lineTo(hw-r,-hh);s.quadraticCurveTo(hw,-hh,hw,-hh+r);s.lineTo(hw,hh-r);s.quadraticCurveTo(hw,hh,hw-r,hh);s.lineTo(-hw+r,hh);s.quadraticCurveTo(-hw,hh,-hw,hh-r);s.lineTo(-hw,-hh+r);s.quadraticCurveTo(-hw,-hh,-hw+r,-hh);
      const g=new THREE.ShapeGeometry(s,24),uv=g.attributes.uv; for(let i=0;i<uv.count;i++)uv.setXY(i,(uv.getX(i)+hw)/W,(uv.getY(i)+hh)/H); return g; };
    const {width:W,height:H,bezel:B,depth:D,corner,screenCorner}=vp;
    const alumMat=new THREE.MeshPhysicalMaterial({color:0xd6d8da,metalness:0.9,roughness:0.34,envMapIntensity:1.5});
    const glassMat=new THREE.MeshPhysicalMaterial({color:0x050507,roughness:0.06,metalness:0.1,clearcoat:1,clearcoatRoughness:0.03,envMapIntensity:1.2});
    const dg=new THREE.Group(); scene.add(dg);
    const body=new THREE.Mesh(new RoundedBoxGeometry(W+B*2,H+B*2,D,5,Math.min(corner,D/2-1)),alumMat); body.position.z=-D/2-1; dg.add(body);
    const face=new THREE.Mesh(roundedRect(W+B*2-6,H+B*2-6,Math.max(screenCorner,corner*0.7)),glassMat); face.position.z=0.4; dg.add(face);
    const arm=new THREE.Mesh(new RoundedBoxGeometry(150,320,20,4,9),alumMat); arm.position.set(0,-(H/2+B+130),-D-24); arm.rotation.x=-0.12; dg.add(arm);
    const foot=new THREE.Mesh(new RoundedBoxGeometry(360,14,250,4,7),alumMat); foot.position.set(0,-(H/2+B+280),-D+60); dg.add(foot);
    const screenMat=new THREE.MeshBasicMaterial({map:screenTex,toneMapped:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
    const screen=new THREE.Mesh(roundedRect(W,H,screenCorner),screenMat); screen.position.z=4; dg.add(screen);

    applyPath(0,camera,target); camera.lookAt(target);

    // Encode every frame (GPU is fast enough) — true CFR via WebCodecs.
    const cfg=[{codec:'vp09.00.31.08',mux:'V_VP9'},{codec:'vp09.00.10.08',mux:'V_VP9'},{codec:'vp8',mux:'V_VP8'}];
    let chosen=null; for(const c of cfg){ const s=await VideoEncoder.isConfigSupported({codec:c.codec,width:CANVAS_W,height:CANVAS_H,bitrate:16000000,framerate:FPS}); if(s.supported){chosen=c;break;} }
    if(!chosen){ window.__ERR='no VP8/VP9 encoder'; window.__DONE=true; }
    else {
      const muxer=new Muxer({target:new ArrayBufferTarget(),video:{codec:chosen.mux,width:CANVAS_W,height:CANVAS_H,frameRate:FPS}});
      const encoder=new VideoEncoder({output:(ch,m)=>muxer.addVideoChunk(ch,m),error:e=>{window.__ERR='enc:'+e.message;}});
      encoder.configure({codec:chosen.codec,width:CANVAS_W,height:CANVAS_H,bitrate:16000000,framerate:FPS,latencyMode:'quality'});
      const total=Math.max(2,Math.round(FPS*SECONDS)), moveF=Math.max(1,Math.round(FPS*MOVE_SECONDS)), durUs=Math.round(1e6/FPS);
      const t0=performance.now();
      for(let f=0; f<total; f++){
        const camU=f/(total-1);                       // camera traverses the whole path across the clip (never fully stops)
        const sceneTime=f/FPS;                        // scene + site animate over the WHOLE clip
        // Real-time site playback: captured window spans the same duration as the
        // clip, so 1:1 = real speed. SITE_SPEED scales it (loops if it overruns).
        if(liveImgs.length){ const idx=Math.floor((f/(total-1))*(liveImgs.length-1)*SITE_SPEED)%liveImgs.length; drawScreen(liveImgs[idx]); }
        dust.rotation.y=sceneTime*0.008; updateLoop(sceneTime);
        applyPath(camU,camera,target); camera.lookAt(target);
        glRenderer.render(scene,camera);
        const vf=new VideoFrame(glRenderer.domElement,{timestamp:f*durUs,duration:durUs});
        encoder.encode(vf,{keyFrame:f%FPS===0}); vf.close();
        if(f%6===0) await new Promise(r=>setTimeout(r,0));
      }
      const renderMs=performance.now()-t0;
      await encoder.flush(); muxer.finalize();
      const bytes=new Uint8Array(muxer.target.buffer);
      await fetch('/upload',{method:'POST',headers:{'content-type':'application/octet-stream'},body:bytes});
      window.__RESULT={ frames:total, liveImgs:liveImgs.length, msPerFrame:Math.round(renderMs/total), sizeKB:Math.round(bytes.length/1024), codec:chosen.codec };
      window.__DONE=true;
    }
  } catch(e){ window.__ERR=String(e&&e.stack||e); window.__DONE=true; }
</script></body></html>`;

// ── Launch Chrome (GPU) ──────────────────────────────────────────────────────
const chrome = spawn(CHROME, [
  '--headless=new', '--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist',
  '--hide-scrollbars', '--mute-audio', '--window-size=1440,900',
  '--remote-debugging-port=0', `--user-data-dir=/tmp/gpu-render-${process.pid}-${Date.now()}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

const wsUrl = await new Promise((resolve, reject) => {
  let buf=''; const to=setTimeout(()=>reject(new Error('no DevTools endpoint')),15000);
  chrome.stderr.on('data', d=>{ buf+=d; const m=/DevTools listening on (ws:\/\/\S+)/.exec(buf); if(m){clearTimeout(to);resolve(m[1]);} });
  chrome.on('exit', c=>{clearTimeout(to);reject(new Error('chrome exited '+c));});
});

function makeClient(url){
  const ws=new WebSocket(url); let nextId=1; const pending=new Map(); const listeners=[];
  const ready=new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error('ws error'));});
  ws.onmessage=ev=>{ const m=JSON.parse(ev.data); if(m.id&&pending.has(m.id)){const{resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(new Error(m.error.message)):resolve(m.result);} else if(m.method){for(const l of listeners)l(m);} };
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=nextId++;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  return { ready, send, on:fn=>listeners.push(fn), close:()=>ws.close() };
}

const cdp = makeClient(wsUrl); await cdp.ready;
const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

// ── 1) Screencast the live site loading/animating (GPU → WebGL hero renders) ──
const live = [];
cdp.on(m => { if (m.method==='Page.screencastFrame' && m.sessionId===sessionId) { live.push('data:image/jpeg;base64,'+m.params.data); cdp.send('Page.screencastFrameAck',{sessionId:m.params.sessionId},sessionId).catch(()=>{}); } });
await cdp.send('Page.enable', {}, sessionId);
await cdp.send('Runtime.enable', {}, sessionId);
const B_T = 0.25;        // scroll starts as the camera reaches B
const SCROLL_END = 0.85; // single smooth scroll arrives at target by 85% of the clip, synced with the flat zoom
const SCROLL_SELECTOR = process.env.SCROLL_SELECTOR || '';     // most precise: a CSS selector
const SCROLL_TEXT = process.env.SCROLL_TEXT || 'show reel';    // fallback: visible text to find
const scrollAtMs = Math.round(B_T * SECONDS * 1000);
const scrollDurMs = Math.max(500, Math.round(SCROLL_END * SECONDS * 1000) - scrollAtMs);

console.log(`→ loading ${URL_TARGET}, warming up ${WARMUP_MS}ms…`);
await cdp.send('Page.navigate', { url: URL_TARGET }, sessionId);
await new Promise(r=>setTimeout(r, WARMUP_MS));

// PROBE (before screencast → not captured): physically scroll the target element
// to viewport center and read the resulting scrollY. This resolves the TRUE reveal
// position on pinned/stacked sites (where document offset != scroll position).
// Then reset to top. During capture we replay ONE eased scrollTo this exact Y, so
// the on-screen motion is a single smooth scroll (no per-frame feedback jitter).
const probeScript = `(async()=>{
  const norm=s=>(s||'').replace(/\\s+/g,' ').trim().toLowerCase();
  const SEL=${JSON.stringify(SCROLL_SELECTOR)}, TXT=${JSON.stringify(SCROLL_TEXT)};
  let el=SEL?document.querySelector(SEL):null, how=el?'selector':'none';
  if(!el && TXT){ const want=norm(TXT); let a=Infinity; for(const e of document.querySelectorAll('h1,h2,h3,h4,h5,h6,a,button,p,span,div,section,li')){ if(norm(e.textContent).includes(want)){const r=e.getBoundingClientRect(); if(r.width>0&&r.height>0&&r.width*r.height<a){a=r.width*r.height;el=e;}} } if(el)how='text'; }
  const de=document.scrollingElement||document.documentElement;
  if(!el){ const y=Math.round(Math.max(0,de.scrollHeight-innerHeight)*0.55); window.scrollTo(0,0); return {y,how:'fallback-55%'}; }
  for(let i=0;i<600;i++){ const r=el.getBoundingClientRect(); const off=(r.top+r.height/2)-innerHeight/2; if(Math.abs(off)<6)break; window.scrollBy(0,Math.sign(off)*Math.min(400,Math.max(20,Math.abs(off)*0.5))); await new Promise(rs=>requestAnimationFrame(rs)); }
  const y=Math.round(window.scrollY||de.scrollTop||0);
  window.scrollTo(0,0);
  return {y,how};
})()`;
const probe = await cdp.send('Runtime.evaluate', { expression: probeScript, awaitPromise:true, returnByValue:true }, sessionId).then(r=>r.result.value).catch(()=>({y:0,how:'err'}));
console.log(`  scroll target → ${probe.how}, scrollY=${probe.y}`);
await new Promise(r=>setTimeout(r, 350)); // let the page re-settle at top before capture

console.log(`→ capturing for ${CAPTURE_MS}ms…`);
await cdp.send('Page.startScreencast', { format:'jpeg', quality:85, maxWidth:1440, maxHeight:900, everyNthFrame:2 }, sessionId);
await new Promise(r=>setTimeout(r, scrollAtMs));
// ONE smooth eased scroll from top → the measured target Y over the whole window.
const smoothScroll = `(()=>{const start=performance.now(),dur=${scrollDurMs},ty=${Number(probe.y)||0},y0=window.scrollY||0;
  function step(now){let p=Math.min(1,(now-start)/dur);p=p*p*(3-2*p);window.scrollTo(0,Math.round(y0+(ty-y0)*p));if(p<1)requestAnimationFrame(step);}
  requestAnimationFrame(step);})()`;
await cdp.send('Runtime.evaluate', { expression: smoothScroll }, sessionId).catch(()=>{});
await new Promise(r=>setTimeout(r, CAPTURE_MS - scrollAtMs));
await cdp.send('Page.stopScreencast', {}, sessionId);
console.log(`  captured ${live.length} frames (load-in → settle → auto-scroll)`);

// ── 2) Local server serves the scene + frames, receives the finished webm ──
let resolveUpload; const uploaded = new Promise(r => { resolveUpload = r; });
const server = createServer((req, res) => {
  if (req.url === '/' ) { res.writeHead(200,{'content-type':'text/html'}); res.end(SCENE_HTML); return; }
  if (req.url === '/frames') { res.writeHead(200,{'content-type':'application/json'}); res.end(JSON.stringify({ live })); return; }
  if (req.url === '/upload' && req.method === 'POST') {
    const chunks=[]; req.on('data',c=>chunks.push(c)); req.on('end',()=>{ const buf=Buffer.concat(chunks); writeFileSync(join(OUT,'local-render.webm'),buf); res.writeHead(200); res.end('ok'); resolveUpload(buf.length); }); return;
  }
  res.writeHead(404); res.end();
});
const port = await new Promise(r => server.listen(0,'127.0.0.1',()=>r(server.address().port)));

// ── 3) Render on GPU ──
console.log(`→ rendering scene on GPU (${CANVAS_W}×${CANVAS_H}, ${SECONDS}s @ ${FPS}fps, ${MOVE_SECONDS}s move)…`);
await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` }, sessionId);

const t0 = Date.now();
const poll = async () => (await cdp.send('Runtime.evaluate', { expression:'window.__DONE===true?(window.__ERR||"ok"):null', returnByValue:true }, sessionId)).result.value;
let status=null; while(!(status=await poll())){ if(Date.now()-t0>120000){status='TIMEOUT';break;} await new Promise(r=>setTimeout(r,400)); }

if (status==='ok') {
  const size = await uploaded;
  const r = (await cdp.send('Runtime.evaluate', { expression:'JSON.stringify(window.__RESULT)', returnByValue:true }, sessionId)).result.value;
  const info = JSON.parse(r||'{}');
  console.log(`\n✓ local-render.webm — ${(size/1024/1024).toFixed(2)}MB`);
  console.log(`  ${info.frames} frames @ ${info.msPerFrame} ms/frame · ${info.liveImgs} live site frames · ${info.codec}`);
} else {
  console.error('\n✗ render failed:', status);
}

server.close(); cdp.close(); chrome.kill('SIGKILL'); process.exit(status==='ok'?0:1);
