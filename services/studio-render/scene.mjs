// Builds the in-browser scene page from a normalized recipe. Runs inside headless
// Chrome (GPU): imports THREE, builds the 3D device + HITLOOP scene, plays the
// captured live-site frames on the screen, runs the recipe's camera keyframe
// track across the whole clip, and encodes a true-CFR MP4 (H.264) via WebCodecs.
// MP4 is required so the clip can be posted directly to X (which rejects WebM).
// Fetches captured frames from /frames and POSTs the finished mp4 to /upload.

const VIEWPORTS = {
  desktop: { width: 1440, height: 900, bezel: 30, depth: 40, corner: 26, screenCorner: 14, camZ: 2700, stand: true },
  mobile: { width: 390, height: 844, bezel: 18, depth: 24, corner: 64, screenCorner: 48, camZ: 1500, pod: true },
  tablet: { width: 768, height: 1024, bezel: 24, depth: 26, corner: 48, screenCorner: 32, camZ: 1900, pod: true },
};

export function buildSceneHtml(recipe, {
  threeVersion = '0.160.0',
  mp4MuxerVersion = '5.1.5',
  webmMuxerVersion = '2.1.2',
  bitrate = 16_000_000,
} = {}) {
  const o = recipe.output;
  const vp = VIEWPORTS[recipe.device.viewport] || VIEWPORTS.desktop;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#0b0b0f;overflow:hidden}#stage{position:fixed;inset:0}
</style></head><body><div id="stage"></div>
<script type="module">
  window.__DONE=false; window.__ERR=null; window.__RESULT=null;
  const SECONDS=${o.seconds}, FPS=${o.fps}, CANVAS_W=${o.width}, CANVAS_H=${o.height}, SITE_SPEED=${o.siteSpeed};
  const LOOP_ON=${recipe.device.loop ? 'true' : 'false'};
  const VP=${JSON.stringify(vp)};
  const CAMERA_TRACK=${JSON.stringify(recipe.cameraTrack)};
  try {
    const THREE = await import('https://esm.sh/three@${threeVersion}');
    const { RoomEnvironment } = await import('https://esm.sh/three@${threeVersion}/examples/jsm/environments/RoomEnvironment.js');
    const { RoundedBoxGeometry } = await import('https://esm.sh/three@${threeVersion}/examples/jsm/geometries/RoundedBoxGeometry.js');
    const { Muxer, ArrayBufferTarget } = await import('https://esm.sh/mp4-muxer@${mp4MuxerVersion}');

    const DEG=Math.PI/180;
    const pose=(p)=>{ const [rF,az,el,txF=0,tyF=0]=p; const r=VP.camZ*rF; return { px:r*Math.sin(az*DEG)*Math.cos(el*DEG), py:r*Math.sin(el*DEG), pz:r*Math.cos(az*DEG)*Math.cos(el*DEG), tx:txF*VP.width*0.5, ty:tyF*VP.height*0.5, tz:0 }; };
    const keys=CAMERA_TRACK.map(k=>({t:k.t,...pose(k.pose)})).sort((a,b)=>a.t-b.t);
    const applyPath=(u,camera,target)=>{ const s=keys; const set=k=>{camera.position.set(k.px,k.py,k.pz);target.set(k.tx,k.ty,k.tz);};
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
    const pmrem=new THREE.PMREMGenerator(glRenderer);
    scene.environment=pmrem.fromScene(new RoomEnvironment(),0.04).texture;

    const ENV=${JSON.stringify(recipe.environment)};
    const skyMat=new THREE.MeshBasicMaterial({side:THREE.BackSide,toneMapped:false,depthWrite:false});
    { const c=document.createElement('canvas'); c.width=2048;c.height=1024; const x=c.getContext('2d');
      const envMode=ENV?.mode||'gradient';
      const grade=(h,s,b)=>[h?'hue-rotate('+h+'deg)':'',s!=null&&s!==1?'saturate('+s+')':'',b!=null&&b!==1?'brightness('+b+')':''].filter(Boolean).join(' ')||'none';
      const PHOTO_PRESETS=['airport-terminal','desk','loft'];
      window.__envDiag={loaded:false,err:null};
      if(envMode==='preset'&&PHOTO_PRESETS.includes(ENV?.preset)){
        x.filter=grade(ENV?.hue,ENV?.saturation,ENV?.brightness);
        try{
          const img=await new Promise((res,rej)=>{const im=new Image();im.onload=()=>res(im);im.onerror=(e)=>rej(new Error('env img load failed: '+e?.type));im.src='/env/'+ENV.preset+'.webp';});
          x.drawImage(img,0,0,2048,1024); window.__envDiag.loaded=true;
        }catch(err_){
          window.__envDiag.err=String(err_?.message||err_); x.fillStyle='#e8eaec'; x.fillRect(0,0,2048,1024);
        }
      } else if(envMode==='image'&&ENV?.imageDataUrl){
        x.filter=grade(ENV?.hue,ENV?.saturation,ENV?.brightness);
        try{
          const img=await new Promise((res,rej)=>{const im=new Image();im.onload=()=>res(im);im.onerror=(e)=>rej(new Error('background img load failed: '+e?.type));im.src=ENV.imageDataUrl;});
          x.fillStyle='#0c0e14'; x.fillRect(0,0,2048,1024);
          const ar=(img.naturalWidth||img.width||1)/(img.naturalHeight||img.height||1);
          let dw=2048,dh=2048/ar; if(dh<1024){dh=1024;dw=1024*ar;}
          x.drawImage(img,(2048-dw)/2,(1024-dh)/2,dw,dh); window.__envDiag.loaded=true;
        }catch(err_){
          window.__envDiag.err=String(err_?.message||err_); x.fillStyle='#11141a'; x.fillRect(0,0,2048,1024);
        }
      } else if(envMode==='preset'){
        const ENV_STOPS={'studio':[['#f4f3f0',0],['#e2dfd9',0.6],['#cfccc5',1]],'sunset':[['#241433',0],['#7a3b2e',0.5],['#e8a25a',0.82],['#f6d8a4',1]]};
        const stops=ENV_STOPS[ENV?.preset]||ENV_STOPS['studio'];
        x.filter=grade(ENV?.hue,ENV?.saturation,ENV?.brightness);
        const g=x.createLinearGradient(0,0,0,1024); stops.forEach(([col,pos])=>g.addColorStop(pos,col)); x.fillStyle=g; x.fillRect(0,0,2048,1024);
      } else if(envMode==='color'){
        x.filter=grade(ENV?.hue,ENV?.saturation,ENV?.brightness);
        x.fillStyle=ENV?.color||'#11141a'; x.fillRect(0,0,2048,1024);
      } else {
        x.fillStyle='#fff'; x.fillRect(0,0,2048,1024);
        let g=x.createRadialGradient(370,225,0,370,225,1440); g.addColorStop(0,'rgba(196,124,86,0.26)'); g.addColorStop(0.62,'rgba(196,124,86,0)'); x.fillStyle=g; x.fillRect(0,0,2048,1024);
        g=x.createRadialGradient(1600,717,0,1600,717,1640); g.addColorStop(0,'rgba(102,184,164,0.22)'); g.addColorStop(0.66,'rgba(102,184,164,0)'); x.fillStyle=g; x.fillRect(0,0,2048,1024);
        g=x.createLinearGradient(0,0,2048,1024); g.addColorStop(0,'rgba(214,191,123,0.16)'); g.addColorStop(0.38,'rgba(255,255,255,0)'); g.addColorStop(1,'rgba(171,148,218,0.18)'); x.fillStyle=g; x.fillRect(0,0,2048,1024);
      }
      const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; skyMat.map=t;
      if(ENV?.reflections!==false&&envMode!=='gradient'){
        const eqt=new THREE.CanvasTexture(c); eqt.mapping=THREE.EquirectangularReflectionMapping; eqt.colorSpace=THREE.SRGBColorSpace;
        scene.environment=pmrem.fromEquirectangular(eqt).texture; eqt.dispose();
      }
    }
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(14000,48,32),skyMat));

    const dustSprite=(()=>{ const c=document.createElement('canvas'); c.width=c.height=64; const x=c.getContext('2d'); const g=x.createRadialGradient(32,32,0,32,32,32); g.addColorStop(0,'rgba(255,255,255,0.9)'); g.addColorStop(1,'rgba(255,255,255,0)'); x.fillStyle=g; x.fillRect(0,0,64,64); const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; return t; })();
    const DUST=500,dustGeo=new THREE.BufferGeometry(),dustPos=new Float32Array(DUST*3);
    for(let i=0;i<DUST;i++){ const a=(i*137.508)%360*(Math.PI/180); const rr=1200+((i*911)%4800); dustPos[i*3]=Math.cos(a)*rr; dustPos[i*3+1]=(((i*389)%3600)-1800); dustPos[i*3+2]=Math.sin(a)*rr; }
    dustGeo.setAttribute('position',new THREE.BufferAttribute(dustPos,3));
    const dust=new THREE.Points(dustGeo,new THREE.PointsMaterial({map:dustSprite,size:26,transparent:true,opacity:0.35,depthWrite:false,color:0xab94da})); scene.add(dust);

    let updateLoop=()=>{};
    if(LOOP_ON){
      const LOOP=9000,LOOP_BASE=2600,loopGeo=new THREE.BufferGeometry();
      loopGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(LOOP*3),3));
      loopGeo.setAttribute('color',new THREE.BufferAttribute(new Float32Array(LOOP*3),3));
      const loopPts=new THREE.Points(loopGeo,new THREE.PointsMaterial({size:20,vertexColors:true,map:dustSprite,transparent:true,opacity:0.85,depthWrite:false})); loopPts.frustumCulled=false;
      const loopGroup=new THREE.Group(); loopGroup.add(loopPts); loopGroup.position.set(0,0,-1400); loopGroup.scale.setScalar(1.6); scene.add(loopGroup);
      const loopColor=new THREE.Color(),GOLDEN=2.39996322972865332;
      updateLoop=(time)=>{ const pos=loopGeo.attributes.position.array,col=loopGeo.attributes.color.array; const R=0.5,r=0.1,r1=R+r*0.2*Math.sin(time*0.5);
        for(let i=0;i<LOOP;i++){ const t=i/LOOP; const u=i*GOLDEN+time*0.05; const phi=Math.acos(1-2*t); const v=phi*2+time*0.4;
          const x4=r1*Math.cos(u),y4=r1*Math.sin(u),z4=r*Math.cos(v),w4=r*Math.sin(v),d=2-w4,i3=i*3;
          pos[i3]=(x4/d)*LOOP_BASE; pos[i3+1]=(y4/d)*LOOP_BASE; pos[i3+2]=(z4/d)*LOOP_BASE*0.8;
          loopColor.setHSL((0.36+t*0.8+time*0.02)%1,0.75,0.42); col[i3]=loopColor.r;col[i3+1]=loopColor.g;col[i3+2]=loopColor.b; }
        loopGeo.attributes.position.needsUpdate=true; loopGeo.attributes.color.needsUpdate=true; };
    }

    const data = await fetch('/frames').then(r=>r.json());
    const liveImgs=[]; for(const u of (data.live||[])){ const im=new Image(); im.src=u; try{await im.decode(); liveImgs.push(im);}catch{} }
    const LIVE_FRAME_START_RATIO = 0.15;
    const liveFrameStart = liveImgs.length > 1
      ? Math.min(liveImgs.length - 1, Math.max(0, Math.floor(liveImgs.length * LIVE_FRAME_START_RATIO)))
      : 0;
    const screenCanvas=document.createElement('canvas'); screenCanvas.width=VP.width; screenCanvas.height=VP.height;
    const sctx=screenCanvas.getContext('2d'); sctx.fillStyle='#fff'; sctx.fillRect(0,0,VP.width,VP.height);
    const screenTex=new THREE.CanvasTexture(screenCanvas); screenTex.colorSpace=THREE.SRGBColorSpace; screenTex.anisotropy=glRenderer.capabilities.getMaxAnisotropy(); screenTex.generateMipmaps=false; screenTex.minFilter=THREE.LinearFilter;
    const drawScreen=(img)=>{ if(!img)return; sctx.fillStyle='#fff'; sctx.fillRect(0,0,VP.width,VP.height); sctx.drawImage(img,0,0,VP.width,VP.height); screenTex.needsUpdate=true; };
    drawScreen(liveImgs[liveFrameStart] || liveImgs[0]);

    const roundedRect=(W,H,r)=>{ const hw=W/2,hh=H/2,s=new THREE.Shape();
      s.moveTo(-hw+r,-hh);s.lineTo(hw-r,-hh);s.quadraticCurveTo(hw,-hh,hw,-hh+r);s.lineTo(hw,hh-r);s.quadraticCurveTo(hw,hh,hw-r,hh);s.lineTo(-hw+r,hh);s.quadraticCurveTo(-hw,hh,-hw,hh-r);s.lineTo(-hw,-hh+r);s.quadraticCurveTo(-hw,-hh,-hw+r,-hh);
      const g=new THREE.ShapeGeometry(s,24),uv=g.attributes.uv; for(let i=0;i<uv.count;i++)uv.setXY(i,(uv.getX(i)+hw)/W,(uv.getY(i)+hh)/H); return g; };
    const {width:W,height:H,bezel:B,depth:D,corner,screenCorner}=VP;
    const alumMat=new THREE.MeshPhysicalMaterial({color:${recipe.device.viewport === 'mobile' ? '0x8e8a84' : '0xd6d8da'},metalness:0.9,roughness:0.34,envMapIntensity:1.5});
    const glassMat=new THREE.MeshPhysicalMaterial({color:0x050507,roughness:0.06,metalness:0.1,clearcoat:1,clearcoatRoughness:0.03,envMapIntensity:1.2});
    const dg=new THREE.Group(); scene.add(dg);
    const body=new THREE.Mesh(new RoundedBoxGeometry(W+B*2,H+B*2,D,5,Math.min(corner,D/2-1)),alumMat); body.position.z=-D/2-1; dg.add(body);
    const face=new THREE.Mesh(roundedRect(W+B*2-6,H+B*2-6,Math.max(screenCorner,corner*0.7)),glassMat); face.position.z=0.4; dg.add(face);
    if(VP.stand){ const arm=new THREE.Mesh(new RoundedBoxGeometry(150,320,20,4,9),alumMat); arm.position.set(0,-(H/2+B+130),-D-24); arm.rotation.x=-0.12; dg.add(arm);
      const foot=new THREE.Mesh(new RoundedBoxGeometry(360,14,250,4,7),alumMat); foot.position.set(0,-(H/2+B+280),-D+60); dg.add(foot); }
    if(VP.pod){ const pod=new THREE.Mesh(new RoundedBoxGeometry(96,96,8,3,20),alumMat); pod.position.set(-(W/2+B)+70,(H/2+B)-70,-D-3); dg.add(pod);
      const lens=new THREE.Mesh(new THREE.CylinderGeometry(20,20,7,32),new THREE.MeshPhysicalMaterial({color:0x101418,roughness:0.05,metalness:0.4,clearcoat:1})); lens.rotation.x=Math.PI/2; lens.position.set(-(W/2+B)+70,(H/2+B)-70,-D-8); dg.add(lens); }
    const screenMat=new THREE.MeshBasicMaterial({map:screenTex,toneMapped:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
    const screen=new THREE.Mesh(roundedRect(W,H,screenCorner),screenMat); screen.position.z=4; dg.add(screen);

    applyPath(0,camera,target); camera.lookAt(target);

    // Try H.264 (MP4) first; fall back to VP9 (WebM) for GPU environments without H.264 encoder.
    const h264cfgs=[{codec:'avc1.640028',mux:'avc'},{codec:'avc1.4d0028',mux:'avc'},{codec:'avc1.42001f',mux:'avc'}];
    let avcChosen=null; for(const c of h264cfgs){ const s=await VideoEncoder.isConfigSupported({codec:c.codec,width:CANVAS_W,height:CANVAS_H,bitrate:${bitrate},framerate:FPS,avc:{format:'avc'}}); if(s.supported){avcChosen=c;break;} }
    let vp9ok=false; if(!avcChosen){ const s=await VideoEncoder.isConfigSupported({codec:'vp09.00.10.08',width:CANVAS_W,height:CANVAS_H,bitrate:${bitrate},framerate:FPS}); vp9ok=!!s.supported; }
    if(!avcChosen&&!vp9ok){ window.__ERR='no supported video encoder (tried H.264 + VP9)'; window.__DONE=true; }
    else {
      const useWebm=!avcChosen;
      let muxer,encoder;
      if(!useWebm){
        muxer=new Muxer({target:new ArrayBufferTarget(),fastStart:'in-memory',video:{codec:avcChosen.mux,width:CANVAS_W,height:CANVAS_H}});
        encoder=new VideoEncoder({output:(ch,m)=>muxer.addVideoChunk(ch,m),error:e=>{window.__ERR='enc:'+e.message;}});
        encoder.configure({codec:avcChosen.codec,width:CANVAS_W,height:CANVAS_H,bitrate:${bitrate},framerate:FPS,avc:{format:'avc'},latencyMode:'quality'});
      } else {
        // webm-muxer v2.x API: target is the string 'buffer'; finalize() returns the ArrayBuffer.
        const _wm=await import('https://esm.sh/webm-muxer@${webmMuxerVersion}/es2022/webm-muxer.mjs');
        const WMuxer=_wm.default?.default||_wm.default||_wm.Muxer;
        if(typeof WMuxer!=='function'){throw new Error('webm-muxer Muxer not found: '+typeof WMuxer);}
        muxer=new WMuxer({target:'buffer',firstTimestampBehavior:'offset',video:{codec:'V_VP9',width:CANVAS_W,height:CANVAS_H,frameRate:FPS}});
        encoder=new VideoEncoder({output:(ch,m)=>muxer.addVideoChunk(ch,m),error:e=>{window.__ERR='enc:'+e.message;}});
        encoder.configure({codec:'vp09.00.10.08',width:CANVAS_W,height:CANVAS_H,bitrate:${bitrate},framerate:FPS,latencyMode:'quality'});
      }
      const total=Math.max(2,Math.round(FPS*SECONDS)), durUs=Math.round(1e6/FPS);
      const t0=performance.now();
      for(let f=0; f<total; f++){
        const camU=f/(total-1);
        const sceneTime=f/FPS;
        if(liveImgs.length){
          const playableCount=Math.max(1, liveImgs.length - liveFrameStart);
          const idx=liveFrameStart + (Math.floor((f/(total-1))*Math.max(0, playableCount-1)*SITE_SPEED)%playableCount);
          drawScreen(liveImgs[idx]);
        }
        dust.rotation.y=sceneTime*0.008; updateLoop(sceneTime);
        applyPath(camU,camera,target); camera.lookAt(target);
        glRenderer.render(scene,camera);
        const vf=new VideoFrame(glRenderer.domElement,{timestamp:f*durUs,duration:durUs});
        encoder.encode(vf,{keyFrame:f%FPS===0}); vf.close();
        if(f%6===0) await new Promise(r=>setTimeout(r,0));
      }
      const renderMs=performance.now()-t0;
      await encoder.flush();
      const finalBuf=muxer.finalize(); // v2: returns ArrayBuffer; mp4-muxer: returns undefined (uses target.buffer)
      const bytes=useWebm?new Uint8Array(finalBuf):new Uint8Array(muxer.target.buffer);
      await fetch('/upload',{method:'POST',headers:{'content-type':'application/octet-stream'},body:bytes});
      const chosenCodec=useWebm?'vp09.00.10.08':avcChosen.codec;
      window.__RESULT={ frames:total, liveImgs:liveImgs.length, liveFrameStart, msPerFrame:Math.round(renderMs/total), sizeKB:Math.round(bytes.length/1024), codec:chosenCodec, container:useWebm?'webm':'mp4', envMode:ENV?.mode, envPreset:ENV?.preset, envImgLoaded:window.__envDiag?.loaded, envImgErr:window.__envDiag?.err };
      window.__DONE=true;
    }
  } catch(e){ window.__ERR=String(e&&e.stack||e); window.__DONE=true; }
</script></body></html>`;
}

export { VIEWPORTS };
