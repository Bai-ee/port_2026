'use client';

// Mockup Studio — 3D desktop/phone/tablet mockup with the live site embedded
// as an interactive iframe (CSS3D). Browser security forbids rasterizing an
// iframe into canvas, so capture is two-path:
//   1. CAPTURE HI-RES → server-side browserless screenshot (deviceScaleFactor
//      up to 3) persisted as a studio_capture artifact for the image pipeline.
//   2. RENDER SCENE → swaps the screen to the captured texture, renders the
//      WebGL mockup at export scale, downloads + persists the PNG.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../AuthContext';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900,  bezel: 30, depth: 46, stand: true,  camZ: 2700, label: 'DESKTOP' },
  mobile:  { width: 390,  height: 844,  bezel: 16, depth: 22, stand: false, camZ: 1500, label: 'MOBILE' },
  tablet:  { width: 768,  height: 1024, bezel: 22, depth: 28, stand: false, camZ: 1900, label: 'TABLET' },
};

const BACKDROPS = {
  graphite: { bg: 0x101014, ground: 0x16161c, label: 'GRAPHITE' },
  studio:   { bg: 0xe8e6e0, ground: 0xd8d5cc, label: 'STUDIO' },
  midnight: { bg: 0x050510, ground: 0x0a0a18, label: 'MIDNIGHT' },
  teal:     { bg: 0x0a2a28, ground: 0x0d3330, label: 'TEAL' },
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

  const [url, setUrl] = useState('');
  const [loadedUrl, setLoadedUrl] = useState('');
  const [viewportId, setViewportId] = useState('desktop');
  const [backdropId, setBackdropId] = useState('graphite');
  const [interactMode, setInteractMode] = useState(false);
  const [screenMode, setScreenMode] = useState('live'); // 'live' | 'texture'
  const [textureRef, setTextureRef] = useState(null);   // capture ref currently on screen
  const [fullPage, setFullPage] = useState(false);
  const [scale, setScale] = useState(2);
  const [captures, setCaptures] = useState([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  // Latest UI state, readable from the async three.js builder without re-running it.
  const stateRef = useRef({});
  stateRef.current = { loadedUrl, viewportId, backdropId, interactMode };

  useEffect(() => {
    if (!loading && !user) router.replace('/');
  }, [user, loading, router]);

  // Seed URL from ?url= query param.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('url');
    if (q) { setUrl(q); setLoadedUrl(q); }
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
      const { OrbitControls, CSS3DRenderer, CSS3DObject } = await import('three-stdlib');
      if (disposed) return;

      const w = stage.clientWidth;
      const h = stage.clientHeight;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, w / h, 1, 30000);
      camera.position.set(0, 160, VIEWPORTS.desktop.camZ);

      const glRenderer = new THREE.WebGLRenderer({ antialias: true });
      glRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      glRenderer.setSize(w, h, false);
      Object.assign(glRenderer.domElement.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
      stage.appendChild(glRenderer.domElement);

      const cssRenderer = new CSS3DRenderer();
      cssRenderer.setSize(w, h);
      Object.assign(cssRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
      stage.appendChild(cssRenderer.domElement);

      scene.add(new THREE.AmbientLight(0xffffff, 1.1));
      const key = new THREE.DirectionalLight(0xffffff, 1.4);
      key.position.set(600, 900, 800);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0x88ffee, 0.5);
      rim.position.set(-800, 300, -600);
      scene.add(rim);

      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(40000, 40000),
        new THREE.MeshStandardMaterial({ color: 0x16161c, roughness: 0.95 })
      );
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);

      const deviceGroup = new THREE.Group();
      scene.add(deviceGroup);

      // Live site iframe — lives in the CSS3D layer, swapped per viewport.
      const iframeWrap = document.createElement('div');
      iframeWrap.id = 'studio-live-iframe-wrap';
      iframeWrap.style.pointerEvents = 'none'; // ORBIT default — INTERACT toggles to auto
      const iframe = document.createElement('iframe');
      Object.assign(iframe.style, { width: '100%', height: '100%', border: '0', background: '#fff', display: 'block' });
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
      iframeWrap.appendChild(iframe);
      let cssObject = null;

      const controls = new OrbitControls(camera, glRenderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.target.set(0, 0, 0);
      controls.minDistance = 500;
      controls.maxDistance = 8000;

      const world = {
        THREE, scene, camera, glRenderer, cssRenderer, controls,
        deviceGroup, iframe, iframeWrap, cssObject,
        screenPlane: null, screenMaterial: null, texture: null,
        ground, groundMaterial: ground.material,
        stageW: w, stageH: h,
      };
      worldRef.current = world;

      // Build (or rebuild) the device mockup for a viewport preset.
      world.buildDevice = (vpId) => {
        const vp = VIEWPORTS[vpId];
        const { width: W, height: H, bezel: B, depth: D } = vp;

        // tear down previous
        while (deviceGroup.children.length) {
          const c = deviceGroup.children.pop();
          c.traverse?.((n) => { n.geometry?.dispose(); n.material?.dispose?.(); });
          deviceGroup.remove(c);
        }
        if (world.cssObject) { scene.remove(world.cssObject); world.cssObject = null; }

        const bezelMat = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.4, metalness: 0.6 });
        const bezelBox = new THREE.Mesh(new THREE.BoxGeometry(W + B * 2, H + B * 2, D), bezelMat);
        bezelBox.position.z = -D / 2 - 2;
        deviceGroup.add(bezelBox);

        if (vp.stand) {
          const standMat = new THREE.MeshStandardMaterial({ color: 0x26262e, roughness: 0.5, metalness: 0.5 });
          const neck = new THREE.Mesh(new THREE.BoxGeometry(90, 260, 40), standMat);
          neck.position.set(0, -(H / 2 + B + 110), -D - 22);
          deviceGroup.add(neck);
          const base = new THREE.Mesh(new THREE.CylinderGeometry(220, 240, 18, 48), standMat);
          base.position.set(0, -(H / 2 + B + 240), -D + 30);
          deviceGroup.add(base);
        }

        // Textured screen plane — drives the WebGL "scene render" export.
        world.screenMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, map: world.texture || null });
        world.screenPlane = new THREE.Mesh(new THREE.PlaneGeometry(W, H), world.screenMaterial);
        world.screenPlane.position.z = 1;
        deviceGroup.add(world.screenPlane);

        // Live iframe layer, aligned to the screen plane.
        Object.assign(iframeWrap.style, { width: `${W}px`, height: `${H}px`, background: '#fff' });
        world.cssObject = new CSS3DObject(iframeWrap);
        world.cssObject.position.set(0, 0, 2);
        scene.add(world.cssObject);

        // Sit the device on the ground.
        const lift = vp.stand ? H / 2 + B + 250 : H / 2 + B + 60;
        deviceGroup.position.y = lift;
        world.cssObject.position.y = lift;
        ground.position.y = 0;
        controls.target.set(0, lift, 0);
        camera.position.set(0, lift + 60, vp.camZ);
      };

      // Apply UI state that may have been set before this async build finished.
      const init = stateRef.current;
      world.buildDevice(init.viewportId || 'desktop');
      if (init.loadedUrl) iframe.src = init.loadedUrl;
      const bd = BACKDROPS[init.backdropId] || BACKDROPS.graphite;
      scene.background = new THREE.Color(bd.bg);
      world.groundMaterial.color.set(bd.ground);
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

      const tick = () => {
        if (disposed) return;
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
    setScreenMode('live');
    setTextureRef(null);
  }, [viewportId]);

  useEffect(() => {
    const w = worldRef.current;
    if (!w) return;
    const b = BACKDROPS[backdropId];
    w.scene.background = new w.THREE.Color(b.bg);
    w.groundMaterial.color.set(b.ground);
  }, [backdropId]);

  useEffect(() => {
    const w = worldRef.current;
    if (!w) return;
    w.iframeWrap.style.pointerEvents = interactMode ? 'auto' : 'none';
    w.cssRenderer.domElement.style.pointerEvents = interactMode ? 'auto' : 'none';
  }, [interactMode]);

  useEffect(() => {
    const w = worldRef.current;
    if (!w) return;
    const live = screenMode === 'live';
    w.iframeWrap.style.visibility = live ? 'visible' : 'hidden';
    if (w.screenPlane) w.screenPlane.visible = true;
  }, [screenMode]);

  // ── Captures ──────────────────────────────────────────────────────────────
  const refreshCaptures = useCallback(async () => {
    try {
      const res = await authedFetch('/api/dashboard/studio-capture');
      const data = await res.json();
      if (res.ok) setCaptures(data.captures || []);
    } catch { /* list is non-critical */ }
  }, [authedFetch]);

  useEffect(() => { if (user) refreshCaptures(); }, [user, refreshCaptures]);

  const captureHiRes = useCallback(async () => {
    if (busy) return;
    const target = (url || loadedUrl).trim();
    if (!/^https?:\/\//i.test(target)) { setStatus('Enter a valid http(s) URL first.'); return; }
    setBusy(true);
    setStatus(`Capturing ${viewportId} @ ${scale}x via browserless…`);
    try {
      const res = await authedFetch('/api/dashboard/studio-capture', {
        method: 'POST',
        body: JSON.stringify({ action: 'capture', url: target, viewportId, fullPage, scale }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setCaptures((prev) => [data.capture, ...prev]);
      setStatus(`Captured ${data.capture.viewportLabel} — ${(data.capture.sizeBytes / 1024).toFixed(0)}KB. Saved to pipeline.`);
      if (!fullPage) await applyScreenTexture(data.capture);
    } catch (err) {
      setStatus(`Capture failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }, [busy, url, loadedUrl, viewportId, fullPage, scale, authedFetch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load a stored capture as the WebGL screen texture (same-origin via proxy).
  const applyScreenTexture = useCallback(async (capture) => {
    const w = worldRef.current;
    if (!w || !capture?.storagePath) return;
    setStatus('Loading screen texture…');
    try {
      const res = await authedFetch(`/api/dashboard/studio-capture?proxy=1&path=${encodeURIComponent(capture.storagePath)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const bitmap = await createImageBitmap(blob);
      const tex = new w.THREE.CanvasTexture(bitmap);
      tex.colorSpace = w.THREE.SRGBColorSpace;
      w.texture?.dispose?.();
      w.texture = tex;
      if (w.screenMaterial) {
        w.screenMaterial.map = tex;
        w.screenMaterial.color.set(0xffffff);
        w.screenMaterial.needsUpdate = true;
      }
      setTextureRef(capture);
      setScreenMode('texture');
      setStatus('Screen textured — orbit to frame, then RENDER SCENE.');
    } catch (err) {
      setStatus(`Texture load failed: ${err.message}`);
    }
  }, [authedFetch]);

  // Render the WebGL mockup at export scale → download + persist.
  const renderScene = useCallback(async () => {
    const w = worldRef.current;
    if (!w || busy) return;
    if (screenMode !== 'texture' || !w.texture) {
      setStatus('Screen needs a texture first — run CAPTURE HI-RES (iframes cannot be rasterized).');
      return;
    }
    setBusy(true);
    setStatus('Rendering scene…');
    try {
      const k = 3; // export multiplier over stage size
      const { glRenderer, scene, camera, stageW, stageH } = w;
      const prevRatio = glRenderer.getPixelRatio();
      glRenderer.setPixelRatio(1);
      glRenderer.setSize(stageW * k, stageH * k, false);
      glRenderer.render(scene, camera);
      const dataUrl = glRenderer.domElement.toDataURL('image/jpeg', 0.92);
      glRenderer.setPixelRatio(prevRatio);
      glRenderer.setSize(stageW, stageH, false);

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
      setStatus(`Scene render: downloaded locally, save failed (${err.message}).`);
    } finally {
      setBusy(false);
    }
  }, [busy, screenMode, viewportId, backdropId, authedFetch]);

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
          onKeyDown={(e) => { if (e.key === 'Enter') { setLoadedUrl(url.trim()); setScreenMode('live'); } }}
          placeholder="https://client-site.com"
          style={{ flex: '1 1 220px', minWidth: 180, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 4, color: '#e4e4e7', fontFamily: 'monospace', fontSize: 11, padding: '6px 8px' }}
        />
        <button style={ui.btn()} onClick={() => { setLoadedUrl(url.trim()); setScreenMode('live'); }}>LOAD</button>

        {Object.keys(VIEWPORTS).map((id) => (
          <button key={id} style={ui.btn(viewportId === id)} onClick={() => setViewportId(id)}>{VIEWPORTS[id].label}</button>
        ))}

        <button style={ui.btn(interactMode)} onClick={() => setInteractMode((v) => !v)} title="Toggle between orbiting the camera and interacting with the live site">
          {interactMode ? 'INTERACT ✓' : 'ORBIT'}
        </button>

        <select value={backdropId} onChange={(e) => setBackdropId(e.target.value)} style={{ ...ui.btn(), appearance: 'none' }}>
          {Object.keys(BACKDROPS).map((id) => <option key={id} value={id}>{BACKDROPS[id].label}</option>)}
        </select>

        <select value={scale} onChange={(e) => setScale(Number(e.target.value))} style={{ ...ui.btn(), appearance: 'none' }} title="Capture density (deviceScaleFactor)">
          <option value={1}>1X</option><option value={2}>2X</option><option value={3}>3X</option>
        </select>

        <label style={{ ...ui.label, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={fullPage} onChange={(e) => setFullPage(e.target.checked)} /> FULL PAGE
        </label>

        <button style={{ ...ui.btn(true), opacity: busy ? 0.5 : 1 }} disabled={busy} onClick={captureHiRes}>CAPTURE HI-RES</button>
        <button style={{ ...ui.btn(screenMode === 'texture'), opacity: busy ? 0.5 : 1 }} disabled={busy} onClick={renderScene}>RENDER SCENE</button>
        {screenMode === 'texture' ? (
          <button style={ui.btn()} onClick={() => setScreenMode('live')}>BACK TO LIVE</button>
        ) : null}
      </div>

      {/* Stage + captures rail */}
      <div id="studio-main-row" style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div id="studio-stage-shell" ref={stageRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }} />

        <div id="studio-captures-panel" style={{ width: 196, borderLeft: '1px solid rgba(255,255,255,0.08)', overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 8, background: '#0e0e11' }}>
          <span style={ui.label}>CAPTURES · {captures.length}</span>
          {captures.map((c, i) => (
            <div key={c.storagePath || i} style={{ border: '1px solid ' + (textureRef?.storagePath === c.storagePath ? '#14b8a6' : 'rgba(255,255,255,0.1)'), borderRadius: 4, overflow: 'hidden' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.downloadUrl} alt={c.viewportLabel || c.label || 'capture'} style={{ width: '100%', display: 'block', maxHeight: 120, objectFit: 'cover', background: '#000' }} />
              <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ ...ui.label, color: '#a1a1aa' }}>{c.viewportLabel || c.label || c.variant}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {c.type === 'studio_capture' ? (
                    <button style={{ ...ui.btn(), padding: '3px 6px', fontSize: 9 }} onClick={() => applyScreenTexture(c)}>SCREEN</button>
                  ) : null}
                  <a href={c.downloadUrl} target="_blank" rel="noreferrer" style={{ ...ui.btn(), padding: '3px 6px', fontSize: 9, textDecoration: 'none' }}>OPEN</a>
                </div>
              </div>
            </div>
          ))}
          {!captures.length ? <span style={{ ...ui.label, color: '#52525b' }}>No captures yet.</span> : null}
        </div>
      </div>

      {/* Status bar */}
      <div id="studio-status-bar" style={{ padding: '6px 12px', borderTop: '1px solid rgba(255,255,255,0.08)', background: '#0e0e11', minHeight: 28 }}>
        <span style={{ ...ui.label, color: status.toLowerCase().includes('fail') ? '#f87171' : '#a1a1aa' }}>
          {status || (interactMode
            ? 'INTERACT mode — click & scroll the live site on the screen. Note: some sites block embedding (X-Frame-Options); hi-res capture works regardless.'
            : 'ORBIT mode — drag to rotate, wheel to zoom. LOAD a URL, frame the shot, CAPTURE HI-RES, then RENDER SCENE for a 3D promo image.')}
        </span>
      </div>
    </div>
  );
}
