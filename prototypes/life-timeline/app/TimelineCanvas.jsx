'use client';

import { memo, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

const vertexShader = `
attribute float aTime;
attribute float aBand;
attribute vec2 aTile;
attribute float aMatch;
uniform vec2 uViewport;
uniform vec2 uWindow;
uniform float uSize;
varying vec2 vUv;
varying float vMatch;
void main(){
  vec2 center=vec2(((aTime-uWindow.x)/uWindow.y)*2.0-1.0, (1.0-aBand)*2.0-1.0);
  vec2 corner=position.xy*uSize/uViewport*2.0;
  gl_Position=vec4(center+corner,0.0,1.0);
  vUv=(aTile+vec2(uv.x,1.0-uv.y))/6.0;
  vMatch=aMatch;
}`;
const fragmentShader = `
uniform sampler2D uAtlas;
varying vec2 vUv;
varying float vMatch;
void main(){
  if(vMatch<0.5) discard;
  vec4 pixel=texture2D(uAtlas,vUv);
  gl_FragColor=vec4(pixel.rgb,1.0);
  #include <colorspace_fragment>
}`;

export function tileSize(span) { return Math.min(74, Math.max(4.8, 5.4*Math.pow(216/span,0.57))); }

function TimelineCanvas({ records, matches, view, onHover, onSelect, onViewChange, onReady }) {
  const host = useRef(null);
  const engine = useRef(null);
  const latest = useRef({ records, matches, view, onHover, onSelect, onViewChange, onReady });
  latest.current = { records, matches, view, onHover, onSelect, onViewChange, onReady };
  const [failure,setFailure] = useState('');

  useEffect(()=>{
    let renderer;
    let disposed=false;
    let frame=0;
    let dragging=null;
    let lastTap=0;
    const pointers=new Map();
    let pinch=null;
    const el=host.current;
    try { renderer=new THREE.WebGLRenderer({antialias:false,alpha:true,powerPreference:'low-power'}); }
    catch { setFailure('WebGL is unavailable. Use Contact sheet to explore the sample library.'); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.5));
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.setClearColor(0,0);
    renderer.domElement.setAttribute('aria-label','Photo timeline. Drag to pan, pinch or scroll to zoom. Use the adjacent controls or Contact sheet for keyboard photo selection.');
    renderer.domElement.setAttribute('role','img');
    el.appendChild(renderer.domElement);
    const geometry=new THREE.InstancedBufferGeometry();
    const plane=new THREE.PlaneGeometry(1,1);
    geometry.index=plane.index.clone();
    geometry.setAttribute('position',plane.attributes.position.clone());
    geometry.setAttribute('uv',plane.attributes.uv.clone());
    geometry.instanceCount=records.length;
    const times=new Float32Array(records.length);
    const bands=new Float32Array(records.length);
    const tiles=new Float32Array(records.length*2);
    records.forEach((r,i)=>{times[i]=r.time;bands[i]=r.y;tiles[i*2]=r.slot%6;tiles[i*2+1]=Math.floor(r.slot/6);});
    geometry.setAttribute('aTime',new THREE.InstancedBufferAttribute(times,1));
    geometry.setAttribute('aBand',new THREE.InstancedBufferAttribute(bands,1));
    geometry.setAttribute('aTile',new THREE.InstancedBufferAttribute(tiles,2));
    const active=new THREE.InstancedBufferAttribute(new Float32Array(records.length),1);
    geometry.setAttribute('aMatch',active);
    const uniforms={uAtlas:{value:null},uViewport:{value:new THREE.Vector2(1,1)},uWindow:{value:new THREE.Vector2(0,216)},uSize:{value:6}};
    const material=new THREE.ShaderMaterial({uniforms,vertexShader,fragmentShader,transparent:true,depthTest:false,depthWrite:false});
    const mesh=new THREE.Mesh(geometry,material);
    mesh.frustumCulled=false;
    const scene=new THREE.Scene();scene.add(mesh);
    const camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    const draw=()=>{frame=0;if(!disposed&&uniforms.uAtlas.value)renderer.render(scene,camera);};
    const invalidate=()=>{if(!frame)frame=requestAnimationFrame(draw);};
    let previousMatches=null;
    const update=()=>{
      const {matches:ids,view:v}=latest.current;
      if(ids!==previousMatches){active.array.fill(0);ids.forEach(i=>{active.array[i]=1;});active.needsUpdate=true;previousMatches=ids;}
      uniforms.uWindow.value.set(v.start,v.span);uniforms.uSize.value=tileSize(v.span);invalidate();
    };
    const resize=new ResizeObserver(()=>{
      const {width,height}=el.getBoundingClientRect();renderer.setSize(width,height);uniforms.uViewport.value.set(width,height);invalidate();
    });resize.observe(el);
    const loader=new THREE.TextureLoader();
    const texture=loader.load('/overview.jpg',t=>{
      if(disposed){t.dispose();return;}
      t.colorSpace=THREE.SRGBColorSpace;t.flipY=false;t.generateMipmaps=false;t.minFilter=THREE.LinearFilter;t.magFilter=THREE.LinearFilter;
      uniforms.uAtlas.value=t;invalidate();latest.current.onReady?.();
    },undefined,()=>setFailure('The sample imagery could not load. Reload the page or use Contact sheet.'));
    engine.current={update};update();
    const bounded=(start,span)=>({span:Math.max(0.28,Math.min(216,span)),start:Math.max(0,Math.min(216-span,start))});
    const zoom=(factor,x)=>{
      const v=latest.current.view;
      const nextSpan=Math.max(0.28,Math.min(216,v.span*factor));
      latest.current.onViewChange(bounded(v.start+x*v.span-x*nextSpan,nextSpan));
    };
    const pick=(x,y)=>{
      const rect=el.getBoundingClientRect(), {view:v,matches:ids}=latest.current;
      const time=v.start+x/rect.width*v.span;
      const tolerance=Math.max(tileSize(v.span)/2+2,9);
      let nearest=null,best=Infinity;
      let lo=0,hi=ids.length;
      while(lo<hi){const mid=(lo+hi)>>>1;if(records[ids[mid]].time<time-tolerance/rect.width*v.span)lo=mid+1;else hi=mid;}
      for(let j=lo;j<ids.length;j++){
        const r=records[ids[j]],px=(r.time-v.start)/v.span*rect.width;
        if(px>x+tolerance)break;
        const d=(px-x)**2+(r.y*rect.height-y)**2;
        if(d<best){best=d;nearest=r;}
      }
      return best<tolerance*tolerance?nearest:null;
    };
    const wheel=e=>{e.preventDefault();const r=el.getBoundingClientRect();latest.current.onHover(null);zoom(Math.exp(Math.max(-0.35,Math.min(0.35,e.deltaY*0.0015))),(e.clientX-r.left)/r.width);};
    const down=e=>{
      renderer.domElement.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      dragging={x:e.clientX,y:e.clientY,start:latest.current.view.start,moved:false};
      if(pointers.size===2){const p=[...pointers.values()];pinch={distance:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y),view:{...latest.current.view}};}
    };
    const move=e=>{
      if(pointers.has(e.pointerId))pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      const rect=el.getBoundingClientRect();
      if(pointers.size===2&&pinch){const p=[...pointers.values()];const d=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);const span=Math.max(0.28,Math.min(216,pinch.view.span*pinch.distance/Math.max(1,d)));const fraction=((p[0].x+p[1].x)/2-rect.left)/rect.width;latest.current.onViewChange(bounded(pinch.view.start+fraction*(pinch.view.span-span),span));latest.current.onHover(null);return;}
      if(dragging&&pointers.size){const delta=e.clientX-dragging.x;if(Math.abs(delta)>4||Math.abs(e.clientY-dragging.y)>4)dragging.moved=true;if(dragging.moved){latest.current.onViewChange(bounded(dragging.start-delta/rect.width*latest.current.view.span,latest.current.view.span));latest.current.onHover(null);return;}}
      if(e.pointerType==='touch')return;
      const r=pick(e.clientX-rect.left,e.clientY-rect.top);
      latest.current.onHover(r?{item:r,x:e.clientX-rect.left,y:e.clientY-rect.top}:null);
    };
    const up=e=>{
      const wasPinch=Boolean(pinch);
      pointers.delete(e.pointerId);
      if(dragging&&!dragging.moved&&!wasPinch){const rect=el.getBoundingClientRect();const r=pick(e.clientX-rect.left,e.clientY-rect.top);if(r){latest.current.onSelect(r.index);}else if(Date.now()-lastTap<350){zoom(0.45,(e.clientX-rect.left)/rect.width);}lastTap=Date.now();}
      dragging=null;if(pointers.size<2)pinch=null;
    };
    const leave=()=>{if(!dragging)latest.current.onHover(null);};
    const lost=e=>{e.preventDefault();setFailure('Graphics paused. Use Contact sheet, or reload to restore the photo field.');};
    renderer.domElement.addEventListener('wheel',wheel,{passive:false});renderer.domElement.addEventListener('pointerdown',down);renderer.domElement.addEventListener('pointermove',move);renderer.domElement.addEventListener('pointerup',up);renderer.domElement.addEventListener('pointercancel',up);renderer.domElement.addEventListener('pointerleave',leave);renderer.domElement.addEventListener('webglcontextlost',lost);
    return()=>{
      disposed=true;cancelAnimationFrame(frame);resize.disconnect();engine.current=null;
      renderer.domElement.removeEventListener('wheel',wheel);renderer.domElement.removeEventListener('pointerdown',down);renderer.domElement.removeEventListener('pointermove',move);renderer.domElement.removeEventListener('pointerup',up);renderer.domElement.removeEventListener('pointercancel',up);renderer.domElement.removeEventListener('pointerleave',leave);renderer.domElement.removeEventListener('webglcontextlost',lost);
      texture.dispose();geometry.dispose();plane.dispose();material.dispose();renderer.dispose();renderer.domElement.remove();
    };
  },[records]);

  useEffect(()=>{engine.current?.update();},[matches,view]);
  return <div id="life-photo-field" ref={host} className="life-photo-field">{failure?<div id="life-render-error" className="life-canvas-error" role="alert">{failure}</div>:null}</div>;
}
export default memo(TimelineCanvas);
