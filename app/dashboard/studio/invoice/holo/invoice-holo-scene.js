// Invoice Studio HoloPaper — the imperative Three.js world
// (docs/plans/INVOICE-STUDIO-HOLOPAPER-HANDOFF.md §5, Lane S ownership).
//
// A bounded, Invoice-only scene: a single textured, deformable sheet with
// front/back mirrored materials, bounded damped orbit, fixed-step verlet
// cloth motion (cloth-sim.js), pointer grab/fling, and full teardown. Adapts
// only the named ClothStudio.jsx anchors called out in the controlling
// handoff's §5 (OrbitControls setup ~4054, holoUniforms ~4062,
// mkClothMaterial ~4076, world.buildCloth ~4211, world.applyPins ~4268,
// world.applyRumple ~4284, the fixed-step step()/loop() pair ~4521/4785,
// world.grab's pointerdown/pointermove/pointerup ~4402-4516, the
// deviceInteract single-boolean pointer-arbitration pattern ~8016, and the
// full disposal block ~5054) — never imports or mounts ClothStudio itself.
//
// Public API (frozen shape — do not deviate, later phases depend on it):
//   createInvoiceHoloScene(container, { onReady, onContextLost }) => {
//     setTexture(source, { width, height, revision }),
//     setInteractive(boolean),
//     setReducedMotion(boolean),
//     resize(width, height, dpr),
//     resetView(),
//     pause(),
//     resume(),
//     dispose(),
//   }
//
// `three`/`three-stdlib` are dynamically imported INSIDE this function
// (mirroring ClothStudio's own `const THREE = await import('three')`
// pattern), not statically imported at module scope. That keeps this
// module's own static import graph free of Three.js entirely — a bundler
// still splits the dynamic import() into its own chunk, so even a caller
// that statically imports this FILE (e.g. InvoiceHoloSurface.jsx) does not
// cause the Three.js chunk to be fetched until createInvoiceHoloScene() is
// actually CALLED. Standard (non-Holo) mode never calls this function, so
// it pays zero Three.js cost (H8) regardless of how this module itself is
// imported upstream.
//
// createInvoiceHoloScene() itself returns SYNCHRONOUSLY (per the frozen
// contract above) — the async Three.js/scene build runs in a fire-and-
// forget internal init(), matching ClothStudio's own
// `useEffect(() => { (async () => {...})() }, [])` shape. Every public
// method records the caller's latest desired state in a closure variable
// immediately (interactive/reducedMotion/paused/pending texture/pending
// resize) so a call made before init() finishes is never lost — init()
// applies whatever the latest recorded state is once the scene exists.

import {
  buildConstraints, buildPinSet, applyRumple, stepClothSimulation, selectGrabVertices,
} from './cloth-sim.js';
import { createInvoiceHoloMaterial, createInvoiceHoloUniforms } from './holo-material.js';

// ── Frozen Invoice Holo preset ─────────────────────────────────────────
// A "hanging sheet of paper" reading: pinned along the top edge (like a
// page clipped to a board), gentle downward drape, restrained idle sway.
// Not the full multi-preset system ClothStudio has — one fixed preset,
// tuned for legibility and a calm, paper-like feel rather than a showy
// decorative cloth.
const PIN_MODE = 'top-edge';
// US-Letter-ish portrait proportions (11/8.5 ≈ 1.294), matching a typical
// invoice page. The cloth's own aspect is fixed at creation time (resize()
// deliberately only touches the renderer/camera per the contract, never the
// geometry) — a later integration phase that knows the real paper shell's
// box can still visually align the CONTAINER to it; this is the sheet's own
// intrinsic shape.
const SHEET_WIDTH = 1;
const SHEET_HEIGHT = 1.294;
// Segment counts (PlaneGeometry segX/segY) at normal size; halved (see
// computeSegmentCounts) on a narrow/coarse-pointer container. Tuned for a
// visibly smooth drape without being as dense as ClothStudio's own
// decorative presets (which run large 4K exports through the same sim).
const BASE_SEG_X = 26;
const BASE_SEG_Y = 34;
const NARROW_SEGMENT_SCALE = 0.6;
// "Handled paper," not "crumpled paper" — a light rumple so the sheet opens
// looking natural rather than perfectly flat/synthetic, well below
// ClothStudio's own decorative rumple range.
const RUMPLE_AMOUNT = 0.12;
// Ambient idle sway — restrained vs. ClothStudio's decorative defaults;
// this plays only while interactive and not under reduced motion (see
// loop()'s own comment for the full gating rule).
const IDLE_SWAY_AMPLITUDE = 0.55;
const IDLE_SWAY_SPEED = 0.55;
const GRAVITY_ACCEL = -0.16;
const DAMPING = 0.985;
const STIFFNESS = 0.55;
const STIFFNESS_ITERATIONS = 5;
const GRAB_RADIUS_FRACTION = 0.06;
// Bounded damped orbit — same spirit as ClothStudio's own
// minDistance/maxDistance, scaled to this sheet's ~1x1.3 unit size.
const CAMERA_MIN_DISTANCE = 1.1;
const CAMERA_MAX_DISTANCE = 4.5;
const DEFAULT_CAMERA_DISTANCE = 2.2;
// DPR/segment-density narrow-device cap. Detected from the CALLER-SUPPLIED
// container/resize width rather than wiring matchMedia('pointer:coarse')
// ourselves — the container's own box size is a simpler, already-available
// signal (a narrow container on a touch device and a narrow desktop window
// both warrant the same cheaper render), and this file has no reason to
// know about the DOM beyond the one container element it's handed.
const NARROW_WIDTH_THRESHOLD = 560;
const DPR_CAP_NARROW = 1.5;
const DPR_CAP_WIDE = 2;
const FALLBACK_WIDTH = 400;
const FALLBACK_HEIGHT = 520;
const FIXED_DT = 1 / 60;
const MAX_FRAME_DT = 0.1;
const MAX_STEPS_PER_FRAME = 3;

function computeDprCap(width) {
  return width > 0 && width < NARROW_WIDTH_THRESHOLD ? DPR_CAP_NARROW : DPR_CAP_WIDE;
}

function computeSegmentCounts(width) {
  const narrow = width > 0 && width < NARROW_WIDTH_THRESHOLD;
  const scale = narrow ? NARROW_SEGMENT_SCALE : 1;
  return {
    segX: Math.max(8, Math.round(BASE_SEG_X * scale)),
    segY: Math.max(10, Math.round(BASE_SEG_Y * scale)),
  };
}

export function createInvoiceHoloScene(container, { onReady, onContextLost } = {}) {
  if (!container) {
    throw new Error('createInvoiceHoloScene requires a container element');
  }

  let disposed = false;
  let initFailed = false;
  let readyFired = false;
  // ctx holds every real Three.js/GPU object once init() completes; null
  // until then (and again after dispose()). Every method below is written
  // to be a safe no-op / state-recording call whenever ctx is null.
  let ctx = null;

  // Desired state recorded independently of ctx, so a call made before
  // init() finishes (or after a context loss / dispose) is never lost and
  // is applied the moment ctx does exist.
  let interactive = false;
  let reducedMotion = false;
  let paused = false;
  let pendingTexture = null; // { source, meta }
  let lastAppliedRevision = -1;
  let lastSize = { width: 0, height: 0, dpr: 1 };

  function applySizeToRenderer() {
    if (!ctx || !lastSize.width || !lastSize.height) return;
    const cappedDpr = Math.min(lastSize.dpr || 1, computeDprCap(lastSize.width));
    ctx.renderer.setPixelRatio(cappedDpr);
    ctx.renderer.setSize(lastSize.width, lastSize.height, false);
    ctx.camera.aspect = lastSize.width / Math.max(lastSize.height, 1);
    ctx.camera.updateProjectionMatrix();
  }

  function applyInteractiveToRenderer() {
    if (!ctx) return;
    ctx.renderer.domElement.style.pointerEvents = interactive ? 'auto' : 'none';
    if (!interactive && ctx.grab.active) {
      // Turning interaction off mid-grab must not strand the sheet pinned
      // to a pointer that can no longer move it.
      ctx.grab.active = false;
    }
    ctx.controls.enabled = interactive && !ctx.grab.active;
  }

  function disposeCurrentTextures() {
    if (!ctx) return;
    if (ctx.currentTexture) { ctx.currentTexture.dispose(); ctx.currentTexture = null; }
    if (ctx.currentBackTexture) { ctx.currentBackTexture.dispose(); ctx.currentBackTexture = null; }
  }

  function applyTexture(source, meta) {
    if (!ctx) { pendingTexture = { source, meta }; return; }
    const { width, height, revision } = meta || {};
    if (typeof revision === 'number' && revision <= lastAppliedRevision) {
      // Defends against an out-of-order/stale update even though the
      // caller's own texture pipeline is supposed to prevent this
      // (defense in depth — see the interop contract in the handoff).
      return;
    }
    const { THREE } = ctx;
    const tex = new THREE.CanvasTexture(source);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    const backTex = tex.clone();
    backTex.wrapS = THREE.RepeatWrapping;
    backTex.repeat.x = -1;
    backTex.needsUpdate = true;

    disposeCurrentTextures();
    ctx.frontMaterial.map = tex;
    ctx.backMaterial.map = backTex;
    ctx.frontMaterial.needsUpdate = true;
    ctx.backMaterial.needsUpdate = true;
    ctx.currentTexture = tex;
    ctx.currentBackTexture = backTex;
    lastAppliedRevision = typeof revision === 'number' ? revision : lastAppliedRevision + 1;
    // width/height are accepted per the interop contract but this material
    // does not need to resize geometry from them — the sheet's own aspect
    // is fixed (see SHEET_WIDTH/SHEET_HEIGHT above); the texture simply
    // maps onto it. Kept as named destructure (not `void`) so a future pass
    // can use them without re-reading the contract.
    void width; void height;
  }

  function loop() {
    if (disposed || paused || !ctx) return;
    ctx.rafId = requestAnimationFrame(loop);
    const dt = Math.min(ctx.clock.getDelta(), MAX_FRAME_DT);
    const t = ctx.clock.elapsedTime;

    // Motion gating (single source of truth — see the handoff's own
    // setInteractive/setReducedMotion doc comments):
    //   - Non-interactive: cloth stays frozen at its current pose (no
    //     autonomous physics at all) — reads as the "restrained, static-ish
    //     holographic look" the non-interactive overlay mode calls for.
    //     The shader's own time-driven shimmer/sparkle still plays (see
    //     uTime below) since that's a materials effect, not cloth motion.
    //   - Interactive + reduced motion: no ambient idle sway, but a grab
    //     still deforms the sheet (gravity-only accel while dragging) and
    //     orbit still responds — "restrained orbit/grab WITHOUT autonomous
    //     ambient animation layered on top" (H15).
    //   - Interactive + motion allowed: ambient sway plays continuously,
    //     grab/fling both work.
    const grabActive = ctx.grab.active;
    const doAmbientSway = interactive && !reducedMotion;
    const doPhysicsStep = interactive && (grabActive || !reducedMotion);

    if (doPhysicsStep) {
      ctx.accum += dt;
      let steps = 0;
      ctx.frameT = t;
      ctx.frameGust = 0.5 + 0.5 * Math.sin(t * IDLE_SWAY_SPEED * 1.25);
      const accel = doAmbientSway ? ctx.swayAccel : ctx.gravityOnlyAccel;
      while (ctx.accum >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        stepClothSimulation(
          {
            positions: ctx.positions,
            prevPositions: ctx.prev,
            origPositions: ctx.orig,
            constraints: ctx.constraints,
            pins: ctx.pins,
          },
          {
            dt: FIXED_DT, damping: DAMPING, stiffness: STIFFNESS, iterations: STIFFNESS_ITERATIONS, accel, grab: ctx.grab,
          },
        );
        ctx.accum -= FIXED_DT;
        steps += 1;
      }
      if (steps === MAX_STEPS_PER_FRAME) ctx.accum = 0; // shed backlog after a stall instead of spiraling
      ctx.geometry.attributes.position.needsUpdate = true;
      ctx.geometry.computeVertexNormals();
      ctx.geometry.computeBoundingSphere();
    }

    if (!reducedMotion) ctx.holoUniforms.uTime.value = t;

    ctx.controls.update();
    ctx.renderer.render(ctx.scene, ctx.camera);
  }

  function startLoopIfNeeded() {
    if (!ctx || paused || disposed || ctx.rafId) return;
    ctx.clock.getDelta(); // drop the idle-time delta so resuming doesn't jump
    ctx.rafId = requestAnimationFrame(loop);
  }

  async function init() {
    let THREE;
    let stdlib;
    try {
      [THREE, stdlib] = await Promise.all([import('three'), import('three-stdlib')]);
    } catch {
      if (!disposed) {
        initFailed = true;
        if (typeof onContextLost === 'function') onContextLost();
      }
      return;
    }
    if (disposed) return;
    const { OrbitControls } = stdlib;

    const rect = typeof container.getBoundingClientRect === 'function' ? container.getBoundingClientRect() : null;
    const initialWidth = (rect && rect.width) || container.clientWidth || FALLBACK_WIDTH;
    const initialHeight = (rect && rect.height) || container.clientHeight || FALLBACK_HEIGHT;
    lastSize = {
      width: lastSize.width || initialWidth,
      height: lastSize.height || initialHeight,
      dpr: lastSize.dpr || (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1),
    };

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      initFailed = true;
      if (typeof onContextLost === 'function') onContextLost();
      return;
    }
    renderer.setPixelRatio(Math.min(lastSize.dpr, computeDprCap(lastSize.width)));
    renderer.setSize(lastSize.width, lastSize.height, false);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.pointerEvents = interactive ? 'auto' : 'none';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, lastSize.width / Math.max(lastSize.height, 1), 0.05, 60);
    camera.position.set(0, 0, DEFAULT_CAMERA_DISTANCE);

    const hemi = new THREE.HemisphereLight(0xffffff, 0xe4e0da, 0.9);
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(1.2, 1.6, 2.0);
    scene.add(hemi, key);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = CAMERA_MIN_DISTANCE;
    controls.maxDistance = CAMERA_MAX_DISTANCE;
    controls.target.set(0, 0, 0);
    controls.enabled = interactive;

    const holoUniforms = createInvoiceHoloUniforms();
    const frontMaterial = createInvoiceHoloMaterial(THREE, THREE.FrontSide, { holoUniforms });
    const backMaterial = createInvoiceHoloMaterial(THREE, THREE.BackSide, { holoUniforms });

    const { segX, segY } = computeSegmentCounts(lastSize.width);
    const geometry = new THREE.PlaneGeometry(SHEET_WIDTH, SHEET_HEIGHT, segX, segY);
    const positionAttr = geometry.attributes.position;
    const positions = positionAttr.array; // mutated in place every step, matching ClothStudio's own pos.array reuse
    const cols = segX + 1;
    const rows = segY + 1;
    const count = cols * rows;
    const restX = SHEET_WIDTH / segX;
    const restY = SHEET_HEIGHT / segY;
    const constraints = buildConstraints(cols, rows, restX, restY);
    const orig = new Float32Array(positions);
    const prev = new Float32Array(positions);
    const pins = buildPinSet(cols, rows, PIN_MODE);
    applyRumple(positions, prev, orig, pins, count, RUMPLE_AMOUNT);
    positionAttr.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const frontMesh = new THREE.Mesh(geometry, frontMaterial);
    const backMesh = new THREE.Mesh(geometry, backMaterial);
    scene.add(frontMesh, backMesh);

    const grab = {
      active: false, idx: null, w: null, off: null, dist: 0, target: new THREE.Vector3(),
    };
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    const setRayFromEvent = (e) => {
      const rect2 = renderer.domElement.getBoundingClientRect();
      ndc.set(
        ((e.clientX - rect2.left) / rect2.width) * 2 - 1,
        -((e.clientY - rect2.top) / rect2.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
    };
    // Adapted from ClothStudio's own onPointerDown/onPointerMove/onPointerUp
    // (~line 4402-4516): raycast against the front/back mesh pair, tweezer-
    // pinch falloff selection via cloth-sim.js's selectGrabVertices, pointer
    // capture, and controls.enabled arbitration so grab and orbit never
    // fight over the same pointer stream.
    const onPointerDown = (e) => {
      if (!interactive) return;
      setRayFromEvent(e);
      const hit = raycaster.intersectObjects([frontMesh, backMesh], false)[0];
      if (!hit) return; // empty space → orbit
      const radius = Math.max(SHEET_WIDTH, SHEET_HEIGHT) * GRAB_RADIUS_FRACTION;
      const sel = selectGrabVertices(positions, count, pins, hit.point, radius);
      if (!sel.idx.length) return;
      grab.active = true; grab.idx = sel.idx; grab.w = sel.w; grab.off = sel.off;
      grab.dist = hit.distance;
      grab.target.copy(hit.point);
      controls.enabled = false;
      try { renderer.domElement.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
    };
    const onPointerMove = (e) => {
      if (!grab.active) return;
      setRayFromEvent(e);
      const ray = raycaster.ray;
      grab.target.copy(ray.origin).addScaledVector(ray.direction, grab.dist);
    };
    const onPointerUp = (e) => {
      if (!grab.active) return;
      grab.active = false;
      controls.enabled = interactive;
      try { renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      if (reducedMotion && grab.idx) {
        // "disable... fling" under reduced motion (H15): verlet infers
        // velocity from the prev→current delta, so snapping prev=current
        // for exactly the just-released vertices kills residual momentum
        // instead of letting the drag's own speed carry through as a fling.
        for (let k = 0; k < grab.idx.length; k += 1) {
          const ix = grab.idx[k] * 3;
          prev[ix] = positions[ix]; prev[ix + 1] = positions[ix + 1]; prev[ix + 2] = positions[ix + 2];
        }
      }
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    const onContextLostHandler = (e) => {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      if (ctx && ctx.rafId) { cancelAnimationFrame(ctx.rafId); ctx.rafId = 0; }
      if (typeof onContextLost === 'function') onContextLost();
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLostHandler);

    // Idle ambient sway acceleration hook — stable function references (not
    // recreated per-frame) reading frame-local ctx.frameT/ctx.frameGust,
    // set once per rendered frame in loop() above. Adapted from
    // ClothStudio's own step()'s wind-field formulas (~line 4537-4554),
    // restrained to IDLE_SWAY_AMPLITUDE instead of a slider-driven range.
    const swayAccel = (i, x, y, z, out) => {
      const amp = IDLE_SWAY_AMPLITUDE;
      const ws = IDLE_SWAY_SPEED;
      const t = ctx ? ctx.frameT : 0;
      const gust = ctx ? ctx.frameGust : 0.5;
      const wz = amp * (0.45 + 0.55 * gust) * (
        0.7 * Math.sin(x * 2.3 + t * ws * 1.7) * Math.cos(y * 1.9 + t * ws * 1.3)
        + 0.35 * Math.sin(x * 5.1 - t * ws * 2.3) * Math.cos(y * 4.3 + t * ws * 1.9)
      );
      const wx = amp * 0.3 * Math.sin(t * ws * 0.8 + y * 2.6) * Math.cos(x * 1.7 + t * ws * 0.6);
      const wy = amp * 0.18 * Math.sin(t * ws * 0.7 + x * 2.1);
      out.x = wx; out.y = GRAVITY_ACCEL + wy; out.z = wz;
    };
    const gravityOnlyAccel = (i, x, y, z, out) => { out.x = 0; out.y = GRAVITY_ACCEL; out.z = 0; };

    ctx = {
      THREE,
      renderer,
      scene,
      camera,
      controls,
      geometry,
      positions,
      prev,
      orig,
      constraints,
      pins,
      count,
      grab,
      raycaster,
      holoUniforms,
      frontMaterial,
      backMaterial,
      frontMesh,
      backMesh,
      currentTexture: null,
      currentBackTexture: null,
      clock: new THREE.Clock(),
      rafId: 0,
      accum: 0,
      frameT: 0,
      frameGust: 0.5,
      swayAccel,
      gravityOnlyAccel,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onContextLostHandler,
      defaultCameraPosition: camera.position.clone(),
      defaultControlsTarget: controls.target.clone(),
    };

    // Apply whatever the caller already asked for before init() finished.
    applySizeToRenderer();
    applyInteractiveToRenderer();
    if (pendingTexture) {
      const pt = pendingTexture;
      pendingTexture = null;
      applyTexture(pt.source, pt.meta);
    }

    // First frame — render once synchronously so onReady() fires against a
    // scene that has actually painted at least one frame, then start the
    // RAF loop (unless the caller already called pause() before we got
    // here). onReady() intentionally does NOT wait for the first real
    // texture: the scene/renderer being alive and displaying its default
    // placeholder sheet is the honest "ready" signal for this contract —
    // texture delivery is a separate, independently-timed pipeline (Lane
    // R's) that may resolve well after or well before this point, and
    // gating readiness on it would make this scene's own liveness depend on
    // another lane's timing.
    controls.update();
    renderer.render(scene, camera);
    if (!readyFired) {
      readyFired = true;
      if (typeof onReady === 'function') onReady();
    }
    startLoopIfNeeded();
  }

  init();

  return {
    setTexture(source, meta) {
      if (disposed || initFailed) return;
      applyTexture(source, meta);
    },
    setInteractive(next) {
      interactive = next === true;
      if (disposed || initFailed) return;
      applyInteractiveToRenderer();
    },
    setReducedMotion(next) {
      reducedMotion = next === true;
      // Read live each frame in loop() — no immediate ctx mutation needed.
    },
    resize(width, height, dpr) {
      lastSize = {
        width: Number(width) || 0,
        height: Number(height) || 0,
        dpr: Number(dpr) || lastSize.dpr || 1,
      };
      if (disposed || initFailed) return;
      applySizeToRenderer();
    },
    resetView() {
      if (disposed || initFailed || !ctx) return;
      ctx.camera.position.copy(ctx.defaultCameraPosition);
      ctx.controls.target.copy(ctx.defaultControlsTarget);
      ctx.controls.update();
    },
    pause() {
      paused = true;
      if (ctx && ctx.rafId) { cancelAnimationFrame(ctx.rafId); ctx.rafId = 0; }
    },
    resume() {
      paused = false;
      if (disposed || initFailed) return;
      startLoopIfNeeded();
    },
    dispose() {
      disposed = true;
      pendingTexture = null;
      if (!ctx) return;
      const world = ctx;
      ctx = null; // guards re-entrancy: any in-flight call sees ctx===null immediately
      if (world.rafId) cancelAnimationFrame(world.rafId);
      world.renderer.domElement.removeEventListener('pointerdown', world.onPointerDown);
      world.renderer.domElement.removeEventListener('pointermove', world.onPointerMove);
      window.removeEventListener('pointerup', world.onPointerUp);
      world.renderer.domElement.removeEventListener('webglcontextlost', world.onContextLostHandler);
      world.controls.dispose();
      world.currentTexture?.dispose();
      world.currentBackTexture?.dispose();
      world.frontMaterial.map?.dispose();
      world.frontMaterial.dispose();
      world.backMaterial.map?.dispose();
      world.backMaterial.dispose();
      world.geometry.dispose();
      world.renderer.dispose();
      if (world.renderer.domElement.parentNode === container) {
        container.removeChild(world.renderer.domElement);
      }
    },
  };
}

export default createInvoiceHoloScene;
