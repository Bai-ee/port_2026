'use client';

// Mockup Studio — ONE 3D scene, one camera. The live site is real HTML in 3D:
// a CSS3D (matrix3d) iframe projected by the same camera as the WebGL device
// mockup, so orbiting and interacting happen in the same scene. Browser
// security forbids rasterizing live iframe HTML into canvas, so RENDER SCENE
// transparently: captures the URL hi-res server-side (browserless), textures
// the screen with it, renders the scene at export scale, then restores the
// live iframe. CAPTURE HI-RES alone just feeds flat shots to the pipeline.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import gsap from 'gsap';
import { useAuth } from '../../../AuthContext';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900,  bezel: 30, depth: 40, corner: 26, screenCorner: 14, camZ: 2700, label: 'DESKTOP' },
  mobile:  { width: 390,  height: 844,  bezel: 18, depth: 24, corner: 64, screenCorner: 48, camZ: 1500, label: 'MOBILE' },
  tablet:  { width: 768,  height: 1024, bezel: 24, depth: 26, corner: 48, screenCorner: 32, camZ: 1900, label: 'TABLET' },
};

const BACKDROPS = {
  home:     { home: true,                      label: 'HITLOOP' }, // homepage hero gradient
  graphite: { bg: 0x101014, ground: 0x16161c, label: 'GRAPHITE' },
  studio:   { bg: 0xe8e6e0, ground: 0xd8d5cc, label: 'STUDIO' },
  midnight: { bg: 0x050510, ground: 0x0a0a18, label: 'MIDNIGHT' },
  teal:     { bg: 0x0a2a28, ground: 0x0d3330, label: 'TEAL' },
};

// Whatever the user dials in becomes the default next visit.
const SETTINGS_KEY = 'mockup-studio-defaults-v1';
const loadSavedDefaults = () => {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch { return {}; }
};

// ── Camera animation templates ───────────────────────────────────────────────
// Each template is 8 authored poses:
// [radiusFactor, azimuthDeg, elevationDeg, targetXFrac?, targetYFrac?, hold?]
// Radius scales from the viewport's camZ and targets from its screen size, so
// the same move reads correctly on desktop, mobile, and tablet. Small radius
// factors (≤0.45) push past the screen edge — corner targets (±0.5..0.7) plus
// a small radius zoom INTO a corner until it fills the frame. `hold` parks
// the camera at that pose for that many travel-units before the next move
// (implemented as a duplicate keyframe further down the track).
const DEG = Math.PI / 180;
const templatePose = (vp, [rF, az, el, txF = 0, tyF = 0]) => {
  const r = vp.camZ * rF;
  return {
    px: r * Math.sin(az * DEG) * Math.cos(el * DEG),
    py: r * Math.sin(el * DEG),
    pz: r * Math.cos(az * DEG) * Math.cos(el * DEG),
    tx: txF * vp.width * 0.5,
    ty: tyF * vp.height * 0.5,
    tz: 0,
  };
};

const CAMERA_TEMPLATES = [
  { id: 'hero-push', label: 'HERO PUSH-IN', theme: 'CINEMATIC', intensity: 'MEDIUM', seconds: 10,
    keys: [[2.2, -16, 14], [1.4, -9, 8], [0.85, -4, 4], [0.34, -1, 1, 0, 0, 0.8], [0.34, 0, 0, 0, 0.15], [0.7, 3, 3], [1.4, 9, 8, 0, 0, 0.5], [2.0, 14, 12]] },
  { id: 'orbit-reveal', label: 'ORBIT REVEAL', theme: 'SHOWCASE', intensity: 'BOLD', seconds: 10,
    keys: [[1.5, -75, 8], [1.15, -40, 10], [0.4, -12, 4, -0.55, 0.35, 0.6], [1.2, 5, 9], [0.4, 18, 4, 0.55, -0.35, 0.6], [1.2, 45, 10], [1.5, 70, 8], [1.3, 40, 8]] },
  { id: 'rise-settle', label: 'RISE & SETTLE', theme: 'CALM', intensity: 'SUBTLE', seconds: 10,
    keys: [[1.6, 0, -18], [1.45, 1, -11], [1.3, 2, -5], [1.1, 2, 0], [0.85, 1, 3, 0, 0, 0.7], [0.7, 0, 4, 0, 0.1, 0.9], [0.95, 0, 5], [1.2, 0, 6]] },
  { id: 'whip-arc', label: 'WHIP ARC', theme: 'ENERGETIC', intensity: 'BOLD', seconds: 6,
    keys: [[1.4, -65, 5], [0.35, -25, 6, -0.6, 0.4, 0.3], [1.2, 10, 10], [0.3, 35, 4, 0.6, 0.4, 0.3], [1.3, 60, 5], [0.32, 20, -4, 0.5, -0.45, 0.3], [1.1, -15, 8], [0.5, -40, 4, -0.4, -0.3]] },
  { id: 'slow-drift', label: 'SLOW DRIFT', theme: 'AMBIENT', intensity: 'SUBTLE', seconds: 15,
    keys: [[1.6, -12, 6], [1.4, -8, 7], [1.15, -4, 8], [0.9, -1, 7, 0, 0.1, 0.8], [0.75, 2, 6, 0.1, 0, 1.0], [0.9, 5, 5], [1.2, 8, 5], [1.45, 10, 5]] },
  { id: 'spiral-in', label: 'SPIRAL IN', theme: 'LAUNCH', intensity: 'BOLD', seconds: 10,
    keys: [[2.3, -130, 26], [1.8, -90, 20], [1.35, -55, 15], [0.95, -28, 10], [0.6, -10, 5], [0.32, 0, 2, 0, 0, 1.0], [0.32, 4, 1, 0.2, 0.1], [0.8, 12, 4]] },
  { id: 'top-drop', label: 'TOP DROP', theme: 'DRAMATIC', intensity: 'MEDIUM', seconds: 6,
    keys: [[1.9, 0, 60], [1.5, -2, 45], [1.0, -3, 28], [0.5, -2, 12, -0.5, 0.5, 0.5], [0.3, 0, 4, -0.6, 0.6, 0.6], [0.7, 0, 4, 0, 0.2], [1.1, 0, 6, 0, 0, 0.4], [1.25, 0, 5]] },
  { id: 'close-pan', label: 'CORNER TOUR', theme: 'DETAIL', intensity: 'BOLD', seconds: 15,
    keys: [[0.32, -4, 3, -0.7, 0.55, 0.7], [0.3, -2, 2, -0.65, 0.5], [0.3, 0, 2, 0.65, 0.5, 0.7], [0.3, 2, 0, 0.7, 0.45], [0.3, 3, -2, 0.65, -0.5, 0.7], [0.3, 2, -2, -0.6, -0.5], [0.32, 0, -1, -0.7, -0.55, 0.7], [0.9, 0, 3]] },
  { id: 'pull-reveal', label: 'PULL REVEAL', theme: 'LAUNCH', intensity: 'MEDIUM', seconds: 10,
    keys: [[0.28, 0, 1, -0.6, 0.5, 0.8], [0.4, 2, 2, -0.3, 0.3], [0.6, 5, 3], [0.9, 8, 5], [1.3, 11, 8], [1.7, 14, 10], [2.1, 16, 11, 0, 0, 0.5], [2.3, 17, 12]] },
  { id: 'low-hero', label: 'LOW HERO', theme: 'EPIC', intensity: 'BOLD', seconds: 10,
    keys: [[1.6, -55, -24], [1.3, -30, -16], [0.45, -10, -8, -0.5, -0.4, 0.5], [1.2, 0, -10], [0.45, 12, -8, 0.5, -0.4, 0.5], [1.3, 30, -16], [1.6, 55, -24, 0, 0, 0.4], [1.4, 40, -20]] },
  { id: 'breathe', label: 'BREATHE', theme: 'AMBIENT', intensity: 'SUBTLE', seconds: 15,
    keys: [[1.5, 0, 5], [0.8, 1, 5, 0, 0, 0.6], [1.4, 0, 6], [0.7, -1, 6, 0, 0.1, 0.6], [1.45, -1, 5], [0.65, 0, 5, 0, 0, 0.6], [1.4, 0, 6], [1.5, 0, 5]] },
  { id: 'showcase-loop', label: 'SHOWCASE LOOP', theme: 'AD SPOT', intensity: 'MEDIUM', seconds: 10,
    keys: [[1.5, 0, 6], [1.25, 35, 12], [0.45, 15, 6, 0.3, 0.2, 0.5], [1.3, -20, 14], [0.4, 0, 3, 0, 0, 0.7], [1.3, -45, 10], [1.25, -25, 8], [1.5, 0, 6]] },
];

const buildTemplateKeyframes = (tpl, vpId) => {
  const vp = VIEWPORTS[vpId] || VIEWPORTS.desktop;
  const totalUnits = (tpl.keys.length - 1) + tpl.keys.reduce((sum, k) => sum + (k[5] || 0), 0);
  const kf = [];
  let unit = 0;
  tpl.keys.forEach((k, i) => {
    const pose = templatePose(vp, k);
    kf.push({ id: `tpl-${tpl.id}-${i}a`, t: unit / totalUnits, ...pose });
    if (k[5]) {
      unit += k[5];
      kf.push({ id: `tpl-${tpl.id}-${i}b`, t: unit / totalUnits, ...pose });
    }
    unit += 1;
  });
  return kf;
};

const getSupportedVideoMimeType = () => {
  if (typeof MediaRecorder === 'undefined') return '';
  return [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ].find((type) => MediaRecorder.isTypeSupported(type)) || '';
};

const ui = {
  btn: (active = false) => ({
    background: active ? '#14b8a6' : 'rgba(255,255,255,0.06)',
    color: active ? '#06211e' : '#d4d4d8',
    border: '1px solid ' + (active ? '#14b8a6' : 'rgba(255,255,255,0.14)'),
    borderRadius: 4,
    padding: '6px 10px',
    fontSize: 10,
    fontFamily: 'monospace',
    letterSpacing: '0.08em',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  }),
  label: { fontSize: 9, fontFamily: 'monospace', letterSpacing: '0.12em', color: '#71717a' },
};

export default function StudioPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const stageRef = useRef(null);
  // Mutable three.js world — built once, mutated by handlers.
  const worldRef = useRef(null);

  // Settings persist to localStorage — the current setup is the next default.
  const [saved] = useState(loadSavedDefaults);

  const [url, setUrl] = useState('');
  const [loadedUrl, setLoadedUrl] = useState('');
  const [viewportId, setViewportId] = useState(saved.viewportId in VIEWPORTS ? saved.viewportId : 'desktop');
  const [backdropId, setBackdropId] = useState(saved.backdropId in BACKDROPS ? saved.backdropId : 'home');
  const [interactMode, setInteractMode] = useState(false);
  const [fullPage, setFullPage] = useState(false);
  // Gradient adjust — repaints the sky dome live for contrast control.
  const [hue, setHue] = useState(saved.hue ?? 0);
  const [sat, setSat] = useState(saved.sat ?? 1);
  const [bright, setBright] = useState(saved.bright ?? 1);
  // Homepage particle-torus "loop" element, positioned behind the device.
  const [loopCfg, setLoopCfg] = useState({ on: true, size: 1.6, x: 0, y: 0, z: -1400, opacity: 1, ...(saved.loopCfg || {}) });
  // Camera keyframe timeline. Each key: { id, t: 0..1 position on the track,
  // camera pose }. Dragging a key left/right retimes the segments around it.
  const [keyframes, setKeyframes] = useState([]);
  const [playing, setPlaying] = useState(false);
  const [totalSeconds, setTotalSeconds] = useState(saved.totalSeconds || 6);
  const [scrubVal, setScrubVal] = useState(0);
  const [selectedKeyId, setSelectedKeyId] = useState(null);
  // Scene opens already loaded with the most extreme template so the first
  // frame reads as a dramatic shot, not a flat front-on view.
  const [templateId, setTemplateId] = useState('spiral-in');
	  const keyframesRef = useRef([]);
	  const playTweenRef = useRef(null);
	  const trackRef = useRef(null);
	  const dragRef = useRef(null); // { keyId } while dragging a marker, { scrub: true } while scrubbing
	  const autoVideoRequestedRef = useRef(false);
	  const [scale, setScale] = useState(saved.scale || 2);
	  const [captures, setCaptures] = useState([]);
	  const [busy, setBusy] = useState(false);
	  const [status, setStatus] = useState('');
	  const [worldReady, setWorldReady] = useState(false);

  // Latest UI state, readable from the async three.js builder without re-running it.
  const stateRef = useRef({});
  stateRef.current = { loadedUrl, viewportId, backdropId, interactMode, hue, sat, bright, loopCfg, templateId };

  useEffect(() => { keyframesRef.current = keyframes; }, [keyframes]);

  useEffect(() => {
    if (!loading && !user) router.replace('/');
  }, [user, loading, router]);

  // Debounced save — current settings become the defaults for the next visit.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ viewportId, backdropId, hue, sat, bright, loopCfg, scale, totalSeconds }));
      } catch { /* storage full/blocked is non-critical */ }
    }, 250);
    return () => clearTimeout(id);
  }, [viewportId, backdropId, hue, sat, bright, loopCfg, scale, totalSeconds]);

  // Seed URL from ?url= query param; default to this app's own homepage —
  // same-origin always iframes (no X-Frame-Options block).
	  useEffect(() => {
	    const params = new URLSearchParams(window.location.search);
	    const q = params.get('url');
	    const qViewport = params.get('viewport');
	    const qBackdrop = params.get('backdrop');
	    const qTemplate = params.get('template');
	    const seed = q || `${window.location.origin}/`;
	    setUrl(seed);
	    setLoadedUrl(seed);
	    if (qViewport && VIEWPORTS[qViewport]) setViewportId(qViewport);
	    if (qBackdrop && BACKDROPS[qBackdrop]) setBackdropId(qBackdrop);
	    if (qTemplate && CAMERA_TEMPLATES.some((tpl) => tpl.id === qTemplate)) setTemplateId(qTemplate);
	    autoVideoRequestedRef.current = params.get('autovideo') === '1';
	  }, []);

  const authedFetch = useCallback(async (path, init = {}) => {
    const token = await user.getIdToken();
    return fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    });
  }, [user]);

  // ── Three.js world ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user || !stageRef.current) return;
    let disposed = false;
    let raf = 0;
    const stage = stageRef.current;

    (async () => {
      const THREE = await import('three');
      const { OrbitControls, CSS3DRenderer, CSS3DObject, RoomEnvironment, RoundedBoxGeometry } = await import('three-stdlib');
      if (disposed) return;

      // Rounded-rect plane with normalized UVs (ShapeGeometry UVs are raw
      // vertex coords, so they must be remapped to 0..1 for the screen map).
      const roundedRectGeometry = (W, H, r) => {
        const hw = W / 2, hh = H / 2;
        const s = new THREE.Shape();
        s.moveTo(-hw + r, -hh);
        s.lineTo(hw - r, -hh); s.quadraticCurveTo(hw, -hh, hw, -hh + r);
        s.lineTo(hw, hh - r);  s.quadraticCurveTo(hw, hh, hw - r, hh);
        s.lineTo(-hw + r, hh); s.quadraticCurveTo(-hw, hh, -hw, hh - r);
        s.lineTo(-hw, -hh + r); s.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
        const g = new THREE.ShapeGeometry(s, 24);
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i += 1) {
          uv.setXY(i, (uv.getX(i) + hw) / W, (uv.getY(i) + hh) / H);
        }
        return g;
      };

      const w = stage.clientWidth;
      const h = stage.clientHeight;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, w / h, 1, 30000);
      camera.position.set(0, 160, VIEWPORTS.desktop.camZ);

      const glRenderer = new THREE.WebGLRenderer({ antialias: true });
      glRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      glRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      glRenderer.toneMappingExposure = 1.05;
      glRenderer.setSize(w, h, false);
      Object.assign(glRenderer.domElement.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
      stage.appendChild(glRenderer.domElement);

      const cssRenderer = new CSS3DRenderer();
      cssRenderer.setSize(w, h);
      Object.assign(cssRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
      stage.appendChild(cssRenderer.domElement);

      scene.add(new THREE.AmbientLight(0xffffff, 0.7));
      const key = new THREE.DirectionalLight(0xffffff, 1.2);
      key.position.set(600, 900, 800);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0x88ffee, 0.5);
      rim.position.set(-800, 300, -600);
      scene.add(rim);

      // Image-based lighting — makes glass + bezel reflections read as hi-end.
      const pmrem = new THREE.PMREMGenerator(glRenderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

      // Gradient sky dome — no floor, no horizon line. A dome (vs flat
      // scene.background) gives parallax while orbiting, so it feels spatial.
      const skyMaterial = new THREE.MeshBasicMaterial({
        side: THREE.BackSide,
        toneMapped: false,
        depthWrite: false,
      });
      const sky = new THREE.Mesh(new THREE.SphereGeometry(14000, 48, 32), skyMaterial);
      scene.add(sky);

      // Atmospheric dust — soft additive particles, very slow drift.
      const dustSprite = (() => {
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const x = c.getContext('2d');
        const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, 'rgba(255,255,255,0.9)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g;
        x.fillRect(0, 0, 64, 64);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      })();
      const dustGeo = new THREE.BufferGeometry();
      const DUST_COUNT = 500;
      const dustPos = new Float32Array(DUST_COUNT * 3);
      for (let i = 0; i < DUST_COUNT; i += 1) {
        // deterministic pseudo-random scatter in a big shell around the device
        const a = (i * 137.508) % 360 * (Math.PI / 180);
        const rr = 1200 + ((i * 911) % 4800);
        dustPos[i * 3] = Math.cos(a) * rr;
        dustPos[i * 3 + 1] = (((i * 389) % 3600) - 1800);
        dustPos[i * 3 + 2] = Math.sin(a) * rr;
      }
      dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
      const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
        map: dustSprite,
        size: 26,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      scene.add(dust);

      // Homepage "loop" — the 4D-torus particle ring from ox.jsx, rebuilt as a
      // lightweight Points cloud (same stereographic projection + HSL cycle).
      const LOOP_COUNT = 9000;
      const LOOP_BASE = 2600; // world-units multiplier — ring radius ≈ 715 at size 1
      const loopGeo = new THREE.BufferGeometry();
      loopGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LOOP_COUNT * 3), 3));
      loopGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(LOOP_COUNT * 3), 3));
      const loopMat = new THREE.PointsMaterial({
        size: 20,
        vertexColors: true,
        map: dustSprite,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      });
      const loopPoints = new THREE.Points(loopGeo, loopMat);
      loopPoints.frustumCulled = false;
      const loopGroup = new THREE.Group();
      loopGroup.add(loopPoints);
      scene.add(loopGroup);

      const loopColor = new THREE.Color();
      const GOLDEN = 2.39996322972865332;
      const updateLoop = (time) => {
        if (!loopGroup.visible) return;
        const pos = loopGeo.attributes.position.array;
        const col = loopGeo.attributes.color.array;
        const R = 0.5, r = 0.1;
        const r1 = R + r * 0.2 * Math.sin(time * 0.5);
        for (let i = 0; i < LOOP_COUNT; i += 1) {
          const t = i / LOOP_COUNT;
          const u = i * GOLDEN + time * 0.05;
          const phi = Math.acos(1 - 2 * t);
          const v = phi * 2 + time * 0.4;
          const x4 = r1 * Math.cos(u), y4 = r1 * Math.sin(u);
          const z4 = r * Math.cos(v),  w4 = r * Math.sin(v);
          const d = 2 - w4;
          const i3 = i * 3;
          pos[i3]     = (x4 / d) * LOOP_BASE;
          pos[i3 + 1] = (y4 / d) * LOOP_BASE;
          pos[i3 + 2] = (z4 / d) * LOOP_BASE * 0.8;
          loopColor.setHSL((0.36 + t * 0.8 + time * 0.02) % 1, 0.75, 0.42);
          col[i3] = loopColor.r; col[i3 + 1] = loopColor.g; col[i3 + 2] = loopColor.b;
        }
        loopGeo.attributes.position.needsUpdate = true;
        loopGeo.attributes.color.needsUpdate = true;
      };

      const applyLoop = (cfg = {}) => {
        loopGroup.visible = cfg.on !== false;
        loopGroup.position.set(cfg.x || 0, cfg.y || 0, cfg.z ?? -1400);
        loopGroup.scale.setScalar(cfg.size || 1);
        loopMat.opacity = cfg.opacity ?? 0.85;
      };

      const deviceGroup = new THREE.Group();
      scene.add(deviceGroup);

      // Live site iframe — lives in the CSS3D layer, swapped per viewport.
      const iframeWrap = document.createElement('div');
      iframeWrap.id = 'studio-live-iframe-wrap';
      iframeWrap.style.pointerEvents = 'none'; // ORBIT default — INTERACT toggles to auto
      const iframe = document.createElement('iframe');
      Object.assign(iframe.style, { width: '100%', height: '100%', border: '0', background: '#fff', display: 'block' });
      iframeWrap.appendChild(iframe);
      let cssObject = null;

      const controls = new OrbitControls(camera, glRenderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.target.set(0, 0, 0);
      controls.minDistance = 180; // below the tightest template zoom (0.28 × mobile camZ ≈ 420) so playback end doesn't snap the camera out
      controls.maxDistance = 8000;

      const world = {
        THREE, scene, camera, glRenderer, cssRenderer, controls,
        deviceGroup, iframe, iframeWrap, cssObject,
        screenPlane: null, screenMaterial: null, texture: null,
        sky, skyMaterial, dust,
        updateLoop, applyLoop,
        stageW: w, stageH: h,
	      };
	      worldRef.current = world;
	      setWorldReady(true);

      // Build (or rebuild) the device mockup for a viewport preset.
      // Paints the sky dome. 'home' redraws the homepage hero gradient
      // (HomePage.jsx heroGradientStyle) on canvas — baked into the scene so
      // RENDER SCENE exports carry it; a DOM/CSS gradient behind the canvas
      // would not. Color backdrops get a deep-space radial vignette instead
      // of a flat fill.
      world.applyBackdrop = (id, adjust = {}) => {
        const b = BACKDROPS[id] || BACKDROPS.home;
        const c = document.createElement('canvas');
        c.width = 2048; c.height = 1024;
        const x = c.getContext('2d');
        // Live contrast control — shift/saturate/dim the whole gradient.
        x.filter = `hue-rotate(${adjust.hue || 0}deg) saturate(${adjust.sat ?? 1}) brightness(${adjust.bright ?? 1})`;
        if (b.home) {
          x.fillStyle = '#ffffff';
          x.fillRect(0, 0, 2048, 1024);
          let g = x.createRadialGradient(370, 225, 0, 370, 225, 1440);
          g.addColorStop(0, 'rgba(196,124,86,0.26)');
          g.addColorStop(0.62, 'rgba(196,124,86,0)');
          x.fillStyle = g; x.fillRect(0, 0, 2048, 1024);
          g = x.createRadialGradient(1600, 717, 0, 1600, 717, 1640);
          g.addColorStop(0, 'rgba(102,184,164,0.22)');
          g.addColorStop(0.66, 'rgba(102,184,164,0)');
          x.fillStyle = g; x.fillRect(0, 0, 2048, 1024);
          g = x.createLinearGradient(0, 0, 2048, 1024);
          g.addColorStop(0, 'rgba(214,191,123,0.16)');
          g.addColorStop(0.38, 'rgba(255,255,255,0)');
          g.addColorStop(1, 'rgba(171,148,218,0.18)');
          x.fillStyle = g; x.fillRect(0, 0, 2048, 1024);
        } else {
          const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
          const g = x.createRadialGradient(1024, 512, 0, 1024, 512, 1300);
          g.addColorStop(0, hex(b.bg));
          g.addColorStop(1, hex(b.ground));
          x.fillStyle = g;
          x.fillRect(0, 0, 2048, 1024);
        }
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        world.skyMaterial.map?.dispose?.();
        world.skyMaterial.map = t;
        world.skyMaterial.needsUpdate = true;
        // Dust reads better tinted-on-light / additive-white-on-dark.
        world.dust.material.color.set(b.home ? 0xab94da : 0xffffff);
        world.dust.material.opacity = b.home ? 0.35 : 0.5;
        world.dust.material.blending = b.home ? THREE.NormalBlending : THREE.AdditiveBlending;
        world.dust.material.needsUpdate = true;
      };

      world.buildDevice = (vpId) => {
        const vp = VIEWPORTS[vpId];
        const { width: W, height: H, bezel: B, depth: D, corner, screenCorner } = vp;

        // tear down previous
        while (deviceGroup.children.length) {
          const c = deviceGroup.children.pop();
          c.traverse?.((n) => { n.geometry?.dispose(); n.material?.dispose?.(); });
          deviceGroup.remove(c);
        }
        if (world.cssObject) { scene.remove(world.cssObject); world.cssObject = null; }

        // Photoreal Apple-hardware look: brushed-aluminum body (titanium tint
        // on mobile), edge-to-edge cover glass, per-device details below.
        const alumMat = new THREE.MeshPhysicalMaterial({
          color: vpId === 'mobile' ? 0x8e8a84 : 0xd6d8da,
          metalness: 0.9,
          roughness: vpId === 'mobile' ? 0.42 : 0.34,
          envMapIntensity: 1.5,
        });
        const glassMat = new THREE.MeshPhysicalMaterial({
          color: 0x050507,
          roughness: 0.06,
          metalness: 0.1,
          clearcoat: 1,
          clearcoatRoughness: 0.03,
          envMapIntensity: 1.2,
        });
        const lensMat = new THREE.MeshPhysicalMaterial({ color: 0x101418, roughness: 0.05, metalness: 0.4, clearcoat: 1 });

        const body = new THREE.Mesh(
          new RoundedBoxGeometry(W + B * 2, H + B * 2, D, 5, Math.min(corner, D / 2 - 1)),
          alumMat
        );
        body.position.z = -D / 2 - 1;
        deviceGroup.add(body);

        const face = new THREE.Mesh(
          roundedRectGeometry(W + B * 2 - 6, H + B * 2 - 6, Math.max(screenCorner, corner * 0.7)),
          glassMat
        );
        face.position.z = 0.4;
        deviceGroup.add(face);

        if (vpId === 'desktop') {
          // Studio-Display stand: tilted aluminum arm + flat rounded foot.
          const arm = new THREE.Mesh(new RoundedBoxGeometry(150, 320, 20, 4, 9), alumMat);
          arm.position.set(0, -(H / 2 + B + 130), -D - 24);
          arm.rotation.x = -0.12;
          deviceGroup.add(arm);
          const foot = new THREE.Mesh(new RoundedBoxGeometry(360, 14, 250, 4, 7), alumMat);
          foot.position.set(0, -(H / 2 + B + 280), -D + 60);
          deviceGroup.add(foot);
        }

        if (vpId === 'mobile') {
          // iPhone-style side buttons + rear camera plateau with three lenses.
          const sideButton = (height, y, side) => {
            const m = new THREE.Mesh(new RoundedBoxGeometry(10, height, D * 0.55, 2, 4), alumMat);
            m.position.set(side * (W / 2 + B + 3), y, -D / 2);
            deviceGroup.add(m);
          };
          sideButton(95, H * 0.16, 1);        // power
          sideButton(34, H * 0.22 + 86, -1);  // action
          sideButton(52, H * 0.22, -1);       // volume up
          sideButton(52, H * 0.22 - 70, -1);  // volume down
          const plateau = new THREE.Mesh(new RoundedBoxGeometry(170, 170, 10, 3, 26), alumMat);
          plateau.position.set(-(W / 2 + B) + 105, (H / 2 + B) - 105, -D - 4);
          deviceGroup.add(plateau);
          [[-32, 32], [-32, -32], [36, 0]].forEach(([lx, ly]) => {
            const lens = new THREE.Mesh(new THREE.CylinderGeometry(26, 26, 8, 32), lensMat);
            lens.rotation.x = Math.PI / 2;
            lens.position.set(-(W / 2 + B) + 105 + lx, (H / 2 + B) - 105 + ly, -D - 10);
            deviceGroup.add(lens);
          });
        }

        if (vpId === 'tablet') {
          // iPad-style rear camera pod, single lens.
          const camPod = new THREE.Mesh(new RoundedBoxGeometry(96, 96, 8, 3, 20), alumMat);
          camPod.position.set(-(W / 2 + B) + 70, (H / 2 + B) - 70, -D - 3);
          deviceGroup.add(camPod);
          const lens = new THREE.Mesh(new THREE.CylinderGeometry(20, 20, 7, 32), lensMat);
          lens.rotation.x = Math.PI / 2;
          lens.position.set(-(W / 2 + B) + 70, (H / 2 + B) - 70, -D - 8);
          deviceGroup.add(lens);
        }

        // Textured screen — rounded corners to match the live iframe.
        // toneMapped:false keeps the screenshot's true colors under ACES.
        world.screenMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, map: world.texture || null, toneMapped: false });
        world.screenPlane = new THREE.Mesh(roundedRectGeometry(W, H, screenCorner), world.screenMaterial);
        world.screenPlane.position.z = 1;
        deviceGroup.add(world.screenPlane);

        // Live iframe layer, aligned to the screen plane.
        Object.assign(iframeWrap.style, {
          width: `${W}px`,
          height: `${H}px`,
          background: '#fff',
          borderRadius: `${screenCorner}px`,
          overflow: 'hidden',
        });
        world.cssObject = new CSS3DObject(iframeWrap);
        world.cssObject.position.set(0, 0, 2);
        scene.add(world.cssObject);

        // Float the device in space, centered on the camera target.
        deviceGroup.position.y = 0;
        world.cssObject.position.y = 0;
        controls.target.set(0, 0, 0);
        camera.position.set(0, 80, vp.camZ);
      };

      // Apply UI state that may have been set before this async build finished.
      const init = stateRef.current;
      world.buildDevice(init.viewportId || 'desktop');
      if (init.loadedUrl) iframe.src = init.loadedUrl;
      world.applyBackdrop(init.backdropId, init);
      world.applyLoop(init.loopCfg);
      // buildDevice parks the camera front-on; if a template is active, open on
      // its first pose so the scene loads mid-shot instead of flat.
      const initTpl = CAMERA_TEMPLATES.find((t) => t.id === init.templateId);
      if (initTpl) {
        const pose = templatePose(VIEWPORTS[init.viewportId || 'desktop'], initTpl.keys[0]);
        camera.position.set(pose.px, pose.py, pose.pz);
        controls.target.set(pose.tx, pose.ty, pose.tz);
      }
      iframeWrap.style.pointerEvents = init.interactMode ? 'auto' : 'none';
      cssRenderer.domElement.style.pointerEvents = init.interactMode ? 'auto' : 'none';

      const onResize = () => {
        const nw = stage.clientWidth, nh = stage.clientHeight;
        world.stageW = nw; world.stageH = nh;
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
        glRenderer.setSize(nw, nh, false);
        cssRenderer.setSize(nw, nh);
      };
      window.addEventListener('resize', onResize);

      const clock = new THREE.Clock();
      const tick = () => {
        if (disposed) return;
        const t = clock.getElapsedTime();
        dust.rotation.y = t * 0.008;
        updateLoop(t);
        controls.update();
        glRenderer.render(scene, camera);
        cssRenderer.render(scene, camera);
        raf = requestAnimationFrame(tick);
      };
      tick();

      world.cleanup = () => {
        window.removeEventListener('resize', onResize);
        cancelAnimationFrame(raf);
        controls.dispose();
        glRenderer.dispose();
        glRenderer.domElement.remove();
        cssRenderer.domElement.remove();
      };
    })();

	    return () => {
	      disposed = true;
	      setWorldReady(false);
	      worldRef.current?.cleanup?.();
	      worldRef.current = null;
	    };
    // Built once per auth'd mount — viewport/backdrop/url changes mutate the world below.
  }, [user]);

  // ── World mutations from UI state ────────────────────────────────────────
  useEffect(() => {
    const w = worldRef.current;
    if (w?.iframe && loadedUrl) w.iframe.src = loadedUrl;
  }, [loadedUrl, viewportId]);

  useEffect(() => {
    worldRef.current?.buildDevice?.(viewportId);
  }, [viewportId]);

  useEffect(() => {
    worldRef.current?.applyBackdrop?.(backdropId, { hue, sat, bright });
  }, [backdropId, hue, sat, bright]);

  useEffect(() => {
    worldRef.current?.applyLoop?.(loopCfg);
  }, [loopCfg]);

  useEffect(() => {
    const w = worldRef.current;
    if (!w) return;
    w.iframeWrap.style.pointerEvents = interactMode ? 'auto' : 'none';
    w.cssRenderer.domElement.style.pointerEvents = interactMode ? 'auto' : 'none';
  }, [interactMode]);

  // ── Camera keyframe timeline ──────────────────────────────────────────────
  // Keys live at normalized track positions (t: 0..1) over a total duration.
  // The camera pose at playhead u interpolates the two keys straddling u with
  // smoothstep — so spacing between markers IS the speed between poses.
  const applyPath = useCallback((u) => {
    const w = worldRef.current;
    const kf = keyframesRef.current;
    if (!w || !kf.length) return;
    const sorted = [...kf].sort((a, b) => a.t - b.t);
    const setPose = (k) => {
      w.camera.position.set(k.px, k.py, k.pz);
      w.controls.target.set(k.tx, k.ty, k.tz);
    };
    if (u <= sorted[0].t) return setPose(sorted[0]);
    if (u >= sorted[sorted.length - 1].t) return setPose(sorted[sorted.length - 1]);
    let i = 0;
    while (i < sorted.length - 2 && sorted[i + 1].t < u) i += 1;
    const a = sorted[i], b = sorted[i + 1];
    const span = Math.max(1e-6, b.t - a.t);
    let t = (u - a.t) / span;
    t = t * t * (3 - 2 * t); // smoothstep per segment
    const L = (p, q) => p + (q - p) * t;
    w.camera.position.set(L(a.px, b.px), L(a.py, b.py), L(a.pz, b.pz));
    w.controls.target.set(L(a.tx, b.tx), L(a.ty, b.ty), L(a.tz, b.tz));
  }, []);

  // Add a key at the playhead from the current camera pose.
  const addKeyframe = useCallback(() => {
    const w = worldRef.current;
    if (!w) return;
    const p = w.camera.position, t = w.controls.target;
    const id = `k${Date.now()}`;
    setKeyframes((prev) => {
      // Nudge off any existing key at the same spot so both stay grabbable.
      let kt = scrubVal;
      while (prev.some((k) => Math.abs(k.t - kt) < 0.01)) kt = Math.min(1, kt + 0.03);
      return [...prev, { id, t: kt, px: p.x, py: p.y, pz: p.z, tx: t.x, ty: t.y, tz: t.z }];
    });
    setSelectedKeyId(id);
    setTemplateId(''); // manual edit — stop re-syncing to the template on viewport change
    setStatus(`Keyframe set at ${(scrubVal * 100).toFixed(0)}% of the timeline.`);
  }, [scrubVal]);

  const deleteSelectedKeyframe = useCallback(() => {
    if (!selectedKeyId) return;
    setKeyframes((prev) => prev.filter((k) => k.id !== selectedKeyId));
    setSelectedKeyId(null);
    setTemplateId('');
  }, [selectedKeyId]);

  // Apply a camera template: 8 keys spread evenly across the timeline, scaled
  // to the active viewport. Re-applied automatically when the viewport
  // changes so the same move works across desktop/mobile/tablet.
  const applyTemplate = useCallback((tplId) => {
    const tpl = CAMERA_TEMPLATES.find((t) => t.id === tplId);
    if (!tpl) return;
    playTweenRef.current?.kill();
    playTweenRef.current = null;
    setPlaying(false);
    const w = worldRef.current;
    if (w) w.controls.enabled = true;
    // Timeline units: 1 per travel segment + each pose's hold.
    const kf = buildTemplateKeyframes(tpl, viewportId);
    setKeyframes(kf);
    setSelectedKeyId(null);
    setTotalSeconds(tpl.seconds);
    setScrubVal(0);
    if (w) {
      w.camera.position.set(kf[0].px, kf[0].py, kf[0].pz);
      w.controls.target.set(kf[0].tx, kf[0].ty, kf[0].tz);
    }
    const holdCount = tpl.keys.filter((k) => k[5]).length;
    setStatus(`Template "${tpl.label}" loaded — ${tpl.keys.length} poses${holdCount ? ` (${holdCount} holds)` : ''} · ${tpl.theme} · ${tpl.intensity} · ${tpl.seconds}s.`);
  }, [viewportId]);

  useEffect(() => {
    if (templateId) applyTemplate(templateId);
  }, [templateId, applyTemplate]);

  const scrubTo = useCallback((u) => {
    if (playing) return;
    const clamped = Math.min(1, Math.max(0, u));
    setScrubVal(clamped);
    applyPath(clamped);
  }, [playing, applyPath]);

  const stopTimeline = useCallback(() => {
    playTweenRef.current?.kill();
    playTweenRef.current = null;
    setPlaying(false);
    const w = worldRef.current;
    if (w) w.controls.enabled = true;
  }, []);

  // Play from the playhead to the end of the track.
  const playTimeline = useCallback(() => {
    const w = worldRef.current;
    if (!w || keyframesRef.current.length < 2 || playing) return;
    const startU = scrubVal >= 0.999 ? 0 : scrubVal;
    setPlaying(true);
    w.controls.enabled = false;
    const proxy = { u: startU };
    playTweenRef.current = gsap.to(proxy, {
      u: 1,
      duration: totalSeconds * (1 - startU),
      ease: 'none', // easing happens per segment inside applyPath
      onUpdate: () => { applyPath(proxy.u); setScrubVal(proxy.u); },
      onComplete: () => { setPlaying(false); w.controls.enabled = true; },
    });
  }, [playing, scrubVal, totalSeconds, applyPath]);

  // Track pointer logic — drag a marker to retime it, drag empty track to scrub.
  const trackUFromEvent = useCallback((e) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  }, []);

  const onTrackPointerDown = useCallback((e) => {
    if (playing) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const keyId = e.target.dataset?.keyId;
    if (keyId) {
      dragRef.current = { keyId, moved: false };
      setSelectedKeyId(keyId);
    } else {
      dragRef.current = { scrub: true };
      scrubTo(trackUFromEvent(e));
    }
  }, [playing, scrubTo, trackUFromEvent]);

  const onTrackPointerMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const u = trackUFromEvent(e);
    if (drag.scrub) { scrubTo(u); return; }
    drag.moved = true;
    setKeyframes((prev) => prev.map((k) => (k.id === drag.keyId ? { ...k, t: u } : k)));
  }, [scrubTo, trackUFromEvent]);

  const onTrackPointerUp = useCallback((e) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.keyId && !drag.moved) {
      // Plain click on a marker — jump the playhead (and camera) to it.
      const k = keyframesRef.current.find((kf) => kf.id === drag.keyId);
      if (k) scrubTo(k.t);
    }
  }, [scrubTo]);

  // ── Captures ──────────────────────────────────────────────────────────────
  const refreshCaptures = useCallback(async () => {
    try {
      const res = await authedFetch('/api/dashboard/studio-capture');
      const data = await res.json();
      if (res.ok) setCaptures(data.captures || []);
    } catch { /* list is non-critical */ }
  }, [authedFetch]);

  useEffect(() => { if (user) refreshCaptures(); }, [user, refreshCaptures]);

  // Server-side hi-res capture of the loaded URL. Returns the capture ref.
  const requestCapture = useCallback(async ({ wantFullPage }) => {
    const target = (loadedUrl || url).trim();
    if (!/^https?:\/\//i.test(target)) throw new Error('Enter a valid http(s) URL first.');
    const res = await authedFetch('/api/dashboard/studio-capture', {
      method: 'POST',
      body: JSON.stringify({ action: 'capture', url: target, viewportId, fullPage: wantFullPage, scale }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    setCaptures((prev) => [data.capture, ...prev]);
    return data.capture;
  }, [loadedUrl, url, viewportId, scale, authedFetch]);

  const captureHiRes = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setStatus(`Capturing ${viewportId} @ ${scale}x via browserless…`);
    try {
      const capture = await requestCapture({ wantFullPage: fullPage });
      setStatus(`Captured ${capture.viewportLabel} — ${(capture.sizeBytes / 1024).toFixed(0)}KB. Saved to pipeline.`);
    } catch (err) {
      setStatus(`Capture failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }, [busy, viewportId, scale, fullPage, requestCapture]);

  // Load a stored capture as the screen texture (same-origin via proxy).
  const loadScreenTexture = useCallback(async (capture) => {
    const w = worldRef.current;
    if (!w || !capture?.storagePath) throw new Error('No capture to texture from.');
    const res = await authedFetch(`/api/dashboard/studio-capture?proxy=1&path=${encodeURIComponent(capture.storagePath)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bitmap = await createImageBitmap(await res.blob());
    const tex = new w.THREE.CanvasTexture(bitmap);
    tex.colorSpace = w.THREE.SRGBColorSpace;
    w.texture?.dispose?.();
    w.texture = tex;
    if (w.screenMaterial) {
      w.screenMaterial.map = tex;
      w.screenMaterial.color.set(0xffffff);
      w.screenMaterial.needsUpdate = true;
    }
  }, [authedFetch]);

  // One-click scene export: capture the live URL hi-res, texture the screen,
  // render the full 3D scene at export scale, restore the live iframe. The
  // texture swap exists only because live iframe HTML can't be rasterized.
  const renderScene = useCallback(async () => {
    const w = worldRef.current;
    if (!w || busy) return;
    setBusy(true);
    try {
      setStatus(`Rendering scene — capturing screen @ ${scale}x…`);
      const capture = await requestCapture({ wantFullPage: false });
      setStatus('Texturing screen…');
      await loadScreenTexture(capture);

      w.iframeWrap.style.visibility = 'hidden';
      const k = 3; // export multiplier over stage size
      const { glRenderer, scene, camera, stageW, stageH } = w;
      const prevRatio = glRenderer.getPixelRatio();
      glRenderer.setPixelRatio(1);
      glRenderer.setSize(stageW * k, stageH * k, false);
      glRenderer.render(scene, camera);
      const dataUrl = glRenderer.domElement.toDataURL('image/jpeg', 0.92);
      glRenderer.setPixelRatio(prevRatio);
      glRenderer.setSize(stageW, stageH, false);
      w.iframeWrap.style.visibility = 'visible';

      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `mockup-scene-${viewportId}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`;
      a.click();

      setStatus('Scene downloaded — saving to pipeline…');
      const res = await authedFetch('/api/dashboard/studio-capture', {
        method: 'POST',
        body: JSON.stringify({ action: 'upload-scene', dataUrl, label: `3D ${VIEWPORTS[viewportId].label} · ${BACKDROPS[backdropId].label}` }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setCaptures((prev) => [data.capture, ...prev]);
      setStatus('Scene render saved to pipeline.');
    } catch (err) {
      if (worldRef.current) worldRef.current.iframeWrap.style.visibility = 'visible';
      setStatus(`Scene render failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }, [busy, scale, viewportId, backdropId, requestCapture, loadScreenTexture, authedFetch]);

  const createVideo = useCallback(async () => {
    const w = worldRef.current;
    if (!w || busy) return;
    if (typeof MediaRecorder === 'undefined' || typeof w.glRenderer.domElement.captureStream !== 'function') {
      setStatus('Video recording is not supported in this browser.');
      return;
    }

    let stream = null;
    let recorder = null;
    let tween = null;
    setBusy(true);
    try {
      playTweenRef.current?.kill();
      playTweenRef.current = null;
      const activeTemplate = CAMERA_TEMPLATES.find((t) => t.id === templateId)
        || CAMERA_TEMPLATES.find((t) => t.id === 'spiral-in')
        || CAMERA_TEMPLATES[0];
      const shouldUseTemplate = Boolean(activeTemplate && (templateId || keyframesRef.current.length < 2));
      const videoKeyframes = shouldUseTemplate
        ? buildTemplateKeyframes(activeTemplate, viewportId)
        : [...keyframesRef.current].sort((a, b) => a.t - b.t);
      const videoSeconds = shouldUseTemplate ? activeTemplate.seconds : totalSeconds;
      if (videoKeyframes.length < 2) throw new Error('Add at least two camera keys or choose a template.');

      if (shouldUseTemplate) {
        keyframesRef.current = videoKeyframes;
        setKeyframes(videoKeyframes);
        setTemplateId(activeTemplate.id);
        setTotalSeconds(videoSeconds);
      }

      setStatus(`Creating video — capturing ${viewportId} screen @ ${scale}x…`);
      let capture;
      try {
        capture = await requestCapture({ wantFullPage: false });
      } catch (captureErr) {
        const viewportNeedle = String(viewportId || '').toLowerCase();
        const fallback = captures.find((item) => {
          if (!item || item.type === 'studio_video' || !item.downloadUrl) return false;
          const matchesViewport =
            item.viewportId === viewportId ||
            String(item.variant || '').toLowerCase().includes(viewportNeedle) ||
            String(item.viewportLabel || '').toLowerCase().includes(viewportNeedle);
          return matchesViewport;
        }) || captures.find((item) => item?.type !== 'studio_video' && item?.downloadUrl);
        if (!fallback) throw captureErr;
        capture = fallback;
        setStatus(`Live capture failed (${captureErr.message}). Reusing saved ${fallback.label || fallback.viewportLabel || 'Studio image'}…`);
      }
      setStatus('Texturing screen for video…');
      await loadScreenTexture(capture);

      const mimeType = getSupportedVideoMimeType();
      if (!mimeType) throw new Error('No supported WebM encoder is available in this browser.');

      const chunks = [];
      stream = w.glRenderer.domElement.captureStream(30);
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2000000 });
      const recordingDone = new Promise((resolve, reject) => {
        recorder.ondataavailable = (event) => {
          if (event.data?.size) chunks.push(event.data);
        };
        recorder.onerror = () => reject(recorder.error || new Error('Video recorder failed.'));
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      });

      w.iframeWrap.style.visibility = 'hidden';
      w.controls.enabled = false;
      setPlaying(true);
      setScrubVal(0);
      applyPath(0);
      w.controls.update();
      w.glRenderer.render(w.scene, w.camera);

      recorder.start(250);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      setStatus(`Recording ${videoSeconds}s ${VIEWPORTS[viewportId].label} mockup video…`);
      const proxy = { u: 0 };
      await new Promise((resolve) => {
        tween = gsap.to(proxy, {
          u: 1,
          duration: videoSeconds,
          ease: 'none',
          onUpdate: () => {
            applyPath(proxy.u);
            setScrubVal(proxy.u);
            w.controls.update();
            w.glRenderer.render(w.scene, w.camera);
          },
          onComplete: resolve,
        });
      });

      if (recorder.state !== 'inactive') recorder.stop();
      const blob = await recordingDone;
      if (!blob.size) throw new Error('Recorder produced an empty video.');

      setStatus(`Uploading video — ${(blob.size / 1024 / 1024).toFixed(1)}MB…`);
      const label = `${VIEWPORTS[viewportId].label} video · ${activeTemplate?.label || 'CUSTOM'} · ${BACKDROPS[backdropId].label}`;
      const token = await user.getIdToken();
      const form = new FormData();
      form.append('action', 'upload-video');
      form.append('video', blob, `mockup-video-${viewportId}-${Date.now()}.webm`);
      form.append('label', label);
      form.append('viewportId', viewportId);
      form.append('backdropId', backdropId);
      form.append('templateId', activeTemplate?.id || '');
      form.append('durationSeconds', String(videoSeconds));
      form.append('sourceUrl', loadedUrl || url);
      const res = await fetch('/api/dashboard/studio-capture', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setCaptures((prev) => [data.capture, ...prev]);
      setStatus('Video saved to pipeline and attached to Mockup Studio.');
    } catch (err) {
      setStatus(`Video failed: ${err.message}`);
    } finally {
      tween?.kill?.();
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      stream?.getTracks?.().forEach((track) => track.stop());
      if (worldRef.current) {
        worldRef.current.iframeWrap.style.visibility = 'visible';
        worldRef.current.controls.enabled = true;
      }
      setPlaying(false);
      setBusy(false);
    }
  }, [busy, templateId, viewportId, totalSeconds, scale, backdropId, loadedUrl, url, captures, requestCapture, loadScreenTexture, applyPath, user]);

  useEffect(() => {
    if (!autoVideoRequestedRef.current || !worldReady || !loadedUrl || busy || !user) return undefined;
    autoVideoRequestedRef.current = false;
    const timeout = window.setTimeout(() => {
      createVideo();
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [worldReady, loadedUrl, busy, user, createVideo]);

  if (loading || !user) return null;

  return (
    <div id="studio-page-shell" style={{ position: 'fixed', inset: 0, background: '#0a0a0c', display: 'flex', flexDirection: 'column', zIndex: 50 }}>
      {/* Toolbar */}
      <div id="studio-toolbar-row" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)', flexWrap: 'wrap', background: '#0e0e11' }}>
        <button style={ui.btn()} onClick={() => router.push('/dashboard')}>← DASH</button>
        <span style={{ ...ui.label, color: '#14b8a6' }}>MOCKUP STUDIO</span>

        <input
          id="studio-url-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') setLoadedUrl(url.trim()); }}
          placeholder="https://client-site.com"
          style={{ flex: '1 1 220px', minWidth: 180, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 4, color: '#e4e4e7', fontFamily: 'monospace', fontSize: 11, padding: '6px 8px' }}
        />
        <button style={ui.btn()} onClick={() => setLoadedUrl(url.trim())}>LOAD</button>

        {Object.keys(VIEWPORTS).map((id) => (
          <button key={id} style={ui.btn(viewportId === id)} onClick={() => setViewportId(id)}>{VIEWPORTS[id].label}</button>
        ))}

        <button style={ui.btn(interactMode)} onClick={() => setInteractMode((v) => !v)} title="Toggle between orbiting the camera and interacting with the live site">
          {interactMode ? 'INTERACT ✓' : 'ORBIT'}
        </button>

        <select value={scale} onChange={(e) => setScale(Number(e.target.value))} style={{ ...ui.btn(), appearance: 'none' }} title="Capture density (deviceScaleFactor)">
          <option value={1}>1X</option><option value={2}>2X</option><option value={3}>3X</option>
        </select>

        <label style={{ ...ui.label, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={fullPage} onChange={(e) => setFullPage(e.target.checked)} /> FULL PAGE
        </label>

        <button style={{ ...ui.btn(), opacity: busy ? 0.5 : 1 }} disabled={busy} onClick={captureHiRes}>CAPTURE HI-RES</button>
        <button style={{ ...ui.btn(true), opacity: busy ? 0.5 : 1 }} disabled={busy} onClick={renderScene}>RENDER SCENE</button>
        <button style={{ ...ui.btn(true), opacity: busy ? 0.5 : 1 }} disabled={busy} onClick={createVideo}>CREATE VIDEO</button>
      </div>

      {/* Stage + captures rail */}
      <div id="studio-main-row" style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <div id="studio-stage-shell" ref={stageRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }} />

          {/* Environment editor — repaints the sky gradient live */}
          <div id="studio-env-panel" style={{ position: 'absolute', top: 10, left: 10, zIndex: 10, width: 190, maxHeight: 'calc(100% - 20px)', overflowY: 'auto', padding: 10, borderRadius: 6, background: 'rgba(10,10,14,0.78)', border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ ...ui.label, color: '#14b8a6' }}>ENVIRONMENT</span>
            <select value={backdropId} onChange={(e) => setBackdropId(e.target.value)} style={{ ...ui.btn(), appearance: 'none', width: '100%' }}>
              {Object.keys(BACKDROPS).map((id) => <option key={id} value={id}>{BACKDROPS[id].label}</option>)}
            </select>
            {[
              { key: 'hue', label: 'HUE SHIFT', min: 0, max: 360, step: 1, value: hue, set: setHue, fmt: (v) => `${v}°` },
              { key: 'sat', label: 'SATURATION', min: 0, max: 2, step: 0.05, value: sat, set: setSat, fmt: (v) => `${Math.round(v * 100)}%` },
              { key: 'bright', label: 'BRIGHTNESS', min: 0.4, max: 1.6, step: 0.05, value: bright, set: setBright, fmt: (v) => `${Math.round(v * 100)}%` },
            ].map((s) => (
              <label key={s.key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ ...ui.label, display: 'flex', justifyContent: 'space-between' }}>{s.label}<span style={{ color: '#d4d4d8' }}>{s.fmt(s.value)}</span></span>
                <input type="range" min={s.min} max={s.max} step={s.step} value={s.value} onChange={(e) => s.set(Number(e.target.value))} style={{ width: '100%', accentColor: '#14b8a6' }} />
              </label>
            ))}
            <button style={{ ...ui.btn(), padding: '4px 8px' }} onClick={() => { setHue(0); setSat(1); setBright(1); }}>RESET</button>

            <span style={{ ...ui.label, color: '#14b8a6', marginTop: 4 }}>
              LOOP ELEMENT
              <button style={{ ...ui.btn(loopCfg.on), padding: '2px 6px', fontSize: 8, marginLeft: 8 }} onClick={() => setLoopCfg((c) => ({ ...c, on: !c.on }))}>
                {loopCfg.on ? 'ON' : 'OFF'}
              </button>
            </span>
            {[
              { key: 'size',    label: 'SIZE',     min: 0.2,   max: 4,    step: 0.05, fmt: (v) => `${v.toFixed(2)}x` },
              { key: 'x',       label: 'HORIZONTAL', min: -2500, max: 2500, step: 10, fmt: (v) => `${v}` },
              { key: 'y',       label: 'VERTICAL',   min: -1800, max: 1800, step: 10, fmt: (v) => `${v}` },
              { key: 'z',       label: 'DEPTH',      min: -6000, max: -200, step: 20, fmt: (v) => `${v}` },
              { key: 'opacity', label: 'OPACITY',    min: 0,     max: 1,    step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
            ].map((s) => (
              <label key={s.key} style={{ display: 'flex', flexDirection: 'column', gap: 2, opacity: loopCfg.on ? 1 : 0.4 }}>
                <span style={{ ...ui.label, display: 'flex', justifyContent: 'space-between' }}>{s.label}<span style={{ color: '#d4d4d8' }}>{s.fmt(loopCfg[s.key])}</span></span>
                <input
                  type="range" min={s.min} max={s.max} step={s.step} value={loopCfg[s.key]}
                  disabled={!loopCfg.on}
                  onChange={(e) => { const v = Number(e.target.value); setLoopCfg((c) => ({ ...c, [s.key]: v })); }}
                  style={{ width: '100%', accentColor: '#14b8a6' }}
                />
              </label>
            ))}
          </div>
        </div>

        <div id="studio-captures-panel" style={{ width: 196, borderLeft: '1px solid rgba(255,255,255,0.08)', overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 8, background: '#0e0e11' }}>
          <span style={ui.label}>CAPTURES · {captures.length}</span>
          {captures.map((c, i) => {
            const isVideo = c.type === 'studio_video' || String(c.contentType || '').startsWith('video/');
            return (
              <div key={c.storagePath || i} style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, overflow: 'hidden' }}>
                {isVideo ? (
                  <video src={c.downloadUrl} controls muted playsInline preload="metadata" style={{ width: '100%', display: 'block', maxHeight: 120, objectFit: 'cover', background: '#000' }} />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.downloadUrl} alt={c.viewportLabel || c.label || 'capture'} style={{ width: '100%', display: 'block', maxHeight: 120, objectFit: 'cover', background: '#000' }} />
                )}
                <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ ...ui.label, color: '#a1a1aa' }}>{c.viewportLabel || c.label || c.variant}</span>
                  <a href={c.downloadUrl} target="_blank" rel="noreferrer" style={{ ...ui.btn(), padding: '3px 6px', fontSize: 9, textDecoration: 'none', alignSelf: 'flex-start' }}>OPEN</a>
                </div>
              </div>
            );
          })}
          {!captures.length ? <span style={{ ...ui.label, color: '#52525b' }}>No captures yet.</span> : null}
        </div>
      </div>

      {/* Camera timeline — markers sit at their time position; drag to retime */}
      <div id="studio-timeline-row" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,0.08)', background: '#0e0e11' }}>
        <span style={{ ...ui.label, color: '#14b8a6' }}>TIMELINE</span>
        <button style={ui.btn()} onClick={addKeyframe} title="Add a keyframe at the playhead from the current camera">+ KEY</button>
        <button
          style={{ ...ui.btn(playing), opacity: keyframes.length < 2 ? 0.4 : 1 }}
          disabled={keyframes.length < 2}
          onClick={playing ? stopTimeline : playTimeline}
        >
          {playing ? '■ STOP' : '▶ PLAY'}
        </button>
        <select value={totalSeconds} onChange={(e) => setTotalSeconds(Number(e.target.value))} style={{ ...ui.btn(), appearance: 'none' }} title="Total timeline duration">
          <option value={3}>3S</option><option value={6}>6S</option><option value={10}>10S</option><option value={15}>15S</option><option value={20}>20S</option>
        </select>
        <select
          id="studio-camera-template-select"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          style={{ ...ui.btn(!!templateId), appearance: 'none', maxWidth: 220 }}
          title="Camera animation templates — 8 keyframes, scaled to the active device"
        >
          <option value="">TEMPLATE…</option>
          {CAMERA_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>{`${t.label} · ${t.theme} · ${t.intensity}`}</option>
          ))}
        </select>

        <div
          id="studio-timeline-track"
          ref={trackRef}
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
          onPointerUp={onTrackPointerUp}
          style={{ flex: 1, position: 'relative', height: 30, borderRadius: 5, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', cursor: playing ? 'default' : 'crosshair', touchAction: 'none', userSelect: 'none' }}
        >
          {/* elapsed fill */}
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${scrubVal * 100}%`, background: 'rgba(20,184,166,0.12)', borderRadius: 5, pointerEvents: 'none' }} />
          {/* playhead */}
          <div style={{ position: 'absolute', left: `${scrubVal * 100}%`, top: 0, bottom: 0, width: 2, marginLeft: -1, background: '#14b8a6', pointerEvents: 'none' }} />
          {/* keyframe markers */}
          {keyframes.map((k) => (
            <div
              key={k.id}
              data-key-id={k.id}
              title={`${(k.t * totalSeconds).toFixed(1)}s — drag to retime, click to jump`}
              style={{
                position: 'absolute',
                left: `${k.t * 100}%`,
                top: '50%',
                width: 13,
                height: 13,
                marginLeft: -6.5,
                marginTop: -6.5,
                transform: 'rotate(45deg)',
                background: selectedKeyId === k.id ? '#14b8a6' : '#e4e4e7',
                border: '2px solid ' + (selectedKeyId === k.id ? '#fff' : 'rgba(0,0,0,0.5)'),
                borderRadius: 3,
                cursor: 'grab',
              }}
            />
          ))}
        </div>

        <span style={{ ...ui.label, minWidth: 64, textAlign: 'right' }}>{(scrubVal * totalSeconds).toFixed(1)}S / {totalSeconds}S</span>
        {selectedKeyId ? (
          <button style={{ ...ui.btn(), color: '#f87171' }} onClick={deleteSelectedKeyframe}>DEL KEY</button>
        ) : null}
      </div>

      {/* Status bar */}
      <div id="studio-status-bar" style={{ padding: '6px 12px', borderTop: '1px solid rgba(255,255,255,0.08)', background: '#0e0e11', minHeight: 28 }}>
        <span style={{ ...ui.label, color: status.toLowerCase().includes('fail') ? '#f87171' : '#a1a1aa' }}>
          {status || (interactMode
            ? 'INTERACT mode — click & scroll the live site on the screen. Note: some sites block embedding (X-Frame-Options); RENDER SCENE works regardless.'
            : 'ORBIT mode — drag to rotate, wheel to zoom. LOAD a URL, frame the shot, then RENDER SCENE for a 3D promo image (CAPTURE HI-RES for flat shots).')}
        </span>
      </div>
    </div>
  );
}
