// art-scene.mjs — Slice 4c (Studio Roadmap). Builds the HTML/JS payload a
// headless browser runs to render one art-scene-v2 recipe, deterministically,
// at a fixed timestep. Node-side only: this module never touches a DOM or
// WebGL context itself — `buildSceneHtml()` returns a plain string; three.js
// only ever runs INSIDE the browser page that string becomes (see
// art-render.mjs, which serves it locally and drives it via Playwright).
//
// Mirrors the EXISTING Video Promo pipeline's own naming convention
// (`scene.mjs` exports `buildSceneHtml`) for consistency, but is otherwise a
// completely separate, parallel implementation — nothing here is imported
// by, or imports, recipe.mjs/scene.mjs/render.mjs/server.mjs. That pipeline
// drives a spawned Chrome via raw CDP (`render.mjs`'s own header comment:
// "no puppeteer dep"); this module's counterpart (`art-render.mjs`) uses
// Playwright instead — a deliberate choice, not an oversight: Playwright is
// already a proven, installed dependency (Slice 4b's spike, and
// services/site-clone's own established usage), and nothing about "preserve
// the existing Video Promo pipeline" requires this NEW, separate pipeline to
// share its browser-automation mechanism.
//
// ── Scope of this first real-content pass (deliberately bounded) ──────────
// Implements: the cloth verlet simulation (buildCloth/applyPins/applyRumple/
// stepCloth — faithful ports of ClothStudio.jsx's own pure math, EXCLUDING
// world.grab/world.poke, both interactive-only and never part of
// captureSceneRecipe), a seeded bump-grain texture (fixes the SECOND
// Math.random() gap the Slice 4b checkpoint found — makeGrainCanvas's real
// formula, now driven by mulberry32 + the recipe's own lookSeed), the real
// artwork image (both built-in ids, front/back mirrored exactly like
// ClothStudio's own mirrorTex), lighting cans (SpotLights, real az/el→
// position formula), camera (shotCam when `use:true`, else the default fixed
// view — see "Known limitation" below), and a solid-color background.
//
// FPS-independent, exact-target-step simulation (Codex re-review fix): the
// cloth solver always advances at the fixed `PHYSICS_DT=1/60` ClothStudio.jsx
// itself uses, but the NUMBER of steps taken before each captured frame is
// computed from that frame's exact target simulated time
// (`Math.round((frameIndex+1) * 60 / fps)` cumulative steps), never a fixed
// per-frame step count — a 1-second render reaches the same 60 total
// physics steps (and therefore the same simulated time) at 24fps, 30fps, or
// any other fps. See art-render.mjs's cross-fps regression test.
//
// Deliberately NOT yet implemented (documented, not silently dropped — see
// the Slice 4c checkpoint's own field table, and art-render.mjs's
// `checkCapabilities` for the enforcement side of this): the catalog
// element types (`extraInstances` — "one factory at a time" per the SSOT
// plan, next up for a future slice; this INCLUDES data-only glass
// duplicates — only the PRIMARY glass-petal-sphere, RECIPE.glass, is
// rendered here as of the Phase 5 glass-parity pass); the custom
// holographic GLSL shader patch behind
// holoIntensity/holoScale/bandFreq/hueShift/sparkle/specTint (this pass maps
// only the material fields MeshPhysicalMaterial supports natively:
// baseColor, finish→roughness's rough/glossy/satin/matte curve, roughness,
// metalness, clearcoat, coatRoughness, sheen, iridescence); the post-fx
// composer (bloom/grain-vignette shader/treatments/Diffusion Camera);
// scene-preset (`bgMode:'scene'`) and image (`bgMode:'image'`) backgrounds
// (fall back to solid `bgColor`); the HUD and shot-cam frame overlay.
//
// ── Known limitation: no orbit-camera angle in the recipe ──────────────────
// captureSceneRecipe() has no field for "what angle was the live orbit
// camera looking from" — only `shotCam` (an explicit second camera) carries
// a real az/el/dist/fov. When `shotCam.use` is false, this renderer (like
// ClothStudio.jsx's own initial mount) uses the same fixed default view
// (0, 0, 2.6) looking at the origin. This is a genuine recipe-contract gap,
// not something this render module can fix — flagged for whoever next
// touches the recipe contract, not silently worked around here.

import { resolveEffectiveScene, sceneAssetRequirements } from './art-scene-def.mjs';
// Diffusion Camera (Phase B, "Interrupted export recovery") — the vendored,
// byte-identical DIFFUSION_SHADER/TREATMENT_SHADER (scripts/vendor-
// diffusion-camera.mjs extracts them straight from ClothStudio.jsx's own
// module-scope consts — see that script's header for why extraction, not a
// ClothStudio.jsx import, was chosen: these shaders live inside the
// component file, not an importable module). Imported here (Node-side) and
// embedded as JSON literals into the generated page below — the SAME
// "vendor + embed as JSON" pattern this function already uses for
// RECIPE/EFFECTIVE_SCENE — rather than copied into the workDir as their own
// browser-loaded file, since they never vary per-recipe and are pure data
// (no functions), unlike diffusion-focus.js below.
import { DIFFUSION_SHADER, TREATMENT_SHADER } from './vendor/diffusion-shaders.mjs';

const DEG = Math.PI / 180;
const PHYSICS_DT = 1 / 60; // matches ClothStudio.jsx's own DT exactly (fidelity, not arbitrary)

function escapeForInlineScript(json) {
  // Standard </script>-breakout guard for JSON embedded inside a <script>
  // tag. Recipe fields are already strictly validated/clamped by
  // art-recipe.mjs's normalizeArtSceneRecipe before they ever reach this
  // function, but this module treats that as defense-in-depth, not as
  // permission to skip its own safe-embedding discipline.
  return json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

/**
 * Returns the full HTML document a headless page loads to render `recipe`
 * (an already-normalized art-scene-v2 recipe — see art-recipe.mjs; this
 * function does NOT re-validate it, and does NOT capability-check it — see
 * art-render.mjs's `checkCapabilities`, called before this is ever invoked).
 * `fps` drives the exact-target-step physics calculation (see header
 * comment) — there is no per-frame physics-step count to configure anymore.
 * `artworkFileName` is a relative path (served alongside this HTML by
 * art-render.mjs's local static server) to the resolved built-in artwork
 * image for `recipe.artworkId`.
 */
export function buildSceneHtml({
  recipe, width, height, fps, artworkFileName, deviceScreenStillFileName = null, frameRender = null,
  // Timeline (Phase C, "Interrupted export recovery") — the SERVER-REDUCED
  // scroll/posY keyframe track (services/studio-render/art-timeline.mjs's
  // sanitizeArtTimeline, called by the route BEFORE this ever runs): `null`
  // (or a shape with zero keyframes) whenever no timeline was submitted —
  // every branch below treats that identically to "no timeline at all".
  timeline = null,
  // Live website frames on the device screen (STUDIO-DETERMINISTIC-FINAL-
  // RENDER-SONNET-HANDOFF.md checkpoint) — LOCAL files art-render.mjs
  // already captured (live-site-capture.mjs's captureDeviceLiveFrames) and
  // copied alongside this page, in capture order. Empty whenever the
  // recipe doesn't request a live device screen — every branch below then
  // behaves exactly as before this feature existed.
  deviceLiveFrameFileNames = [],
  // The REAL pixel dimensions the frames above were captured at (so the
  // canvas the frames are drawn into matches their aspect exactly — see
  // live-site-capture.mjs's CAPTURE_VIEWPORTS). Only meaningful alongside a
  // non-empty deviceLiveFrameFileNames.
  deviceLiveCaptureViewportPx = null,
  // Total OUTPUT frame count this render will produce (fps*durationSeconds,
  // already validated by validateRenderParams before this is called) — the
  // no-timeline live-frame pacing formula needs it to map "how far through
  // the whole clip is this output frame" to "which captured frame". `null`
  // for inspectScene (which never calls __renderFrame, so it's unused there).
  totalFrames = null,
}) {
  // Defense in depth: art-render.mjs's own validateRenderParams already
  // rejects bad values before calling this function, but width/height/fps
  // get string-interpolated directly into generated <script> code below —
  // this function must never trust that its caller validated first (Codex
  // re-review, P2: "no untrusted value can be interpolated into generated
  // HTML without numeric validation").
  if (!Number.isFinite(width) || !Number.isInteger(width) || width <= 0) {
    throw new Error(`width must be a positive finite integer (got ${JSON.stringify(width)}).`);
  }
  if (!Number.isFinite(height) || !Number.isInteger(height) || height <= 0) {
    throw new Error(`height must be a positive finite integer (got ${JSON.stringify(height)}).`);
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`fps must be a positive finite number (got ${JSON.stringify(fps)}).`);
  }
  // Capture Frame parity: a framed render draws the STAGE at the boosted
  // source resolution (camera composed at the stage aspect the user saw)
  // and each captured frame is a pure region copy of the crop rect at
  // native target resolution — never a stretched full-canvas render, never
  // an upscaled crop (see art-scene-def.mjs resolveFrameRender). Every
  // value is server-derived and validated here before interpolation.
  if (frameRender) {
    for (const key of ['sourceWidth', 'sourceHeight', 'targetWidth', 'targetHeight']) {
      const v = frameRender[key];
      if (!Number.isFinite(v) || !Number.isInteger(v) || v <= 0) {
        throw new Error(`frameRender.${key} must be a positive finite integer (got ${JSON.stringify(v)}).`);
      }
    }
    if (frameRender.targetWidth !== width || frameRender.targetHeight !== height) {
      throw new Error('frameRender target dimensions must equal the requested width/height.');
    }
  }
  // Timeline (Phase C) — defensive validation of the ALREADY-REDUCED shape
  // (services/studio-render/art-timeline.mjs's sanitizeArtTimeline; never
  // trust that the caller validated first, same discipline as width/height/
  // fps/frameRender above). A shape with zero keyframes is normalized to
  // `null` here — every downstream branch only ever needs to check
  // truthiness, not also re-check `.keyframes.length`.
  let activeTimeline = null;
  if (timeline && Array.isArray(timeline.keyframes) && timeline.keyframes.length > 0) {
    if (!Number.isFinite(timeline.totalSeconds) || timeline.totalSeconds <= 0) {
      throw new Error(`timeline.totalSeconds must be a positive finite number (got ${JSON.stringify(timeline.totalSeconds)}).`);
    }
    timeline.keyframes.forEach((kf, i) => {
      if (!kf || typeof kf !== 'object' || !Number.isFinite(kf.t) || !kf.scroll
        || !Number.isFinite(kf.scroll.scrollPosition) || !Number.isFinite(kf.scroll.posY)) {
        throw new Error(`timeline.keyframes[${i}] must be {t:number, scroll:{scrollPosition:number, posY:number}} (got ${JSON.stringify(kf)}).`);
      }
    });
    activeTimeline = timeline;
  }
  // Live website frames (device-screen-live) — defensive validation, same
  // discipline as frameRender/timeline above: never trust the caller
  // validated first, even though art-render.mjs's own capture step is the
  // only real producer of this list today. Filenames are server-generated
  // (`live-frame-NNNN.jpg`, art-render.mjs) — the allowlisted pattern check
  // is defense-in-depth, not a response to any known untrusted input.
  const liveFrameNamePattern = /^[\w.-]+\.jpg$/;
  if (!Array.isArray(deviceLiveFrameFileNames) || deviceLiveFrameFileNames.some((f) => typeof f !== 'string' || !liveFrameNamePattern.test(f))) {
    throw new Error('deviceLiveFrameFileNames must be an array of plain "*.jpg" local filenames.');
  }
  if (deviceLiveFrameFileNames.length && (
    !deviceLiveCaptureViewportPx
    || !Number.isFinite(deviceLiveCaptureViewportPx.width) || deviceLiveCaptureViewportPx.width <= 0
    || !Number.isFinite(deviceLiveCaptureViewportPx.height) || deviceLiveCaptureViewportPx.height <= 0
  )) {
    throw new Error('deviceLiveCaptureViewportPx must be {width,height} whenever deviceLiveFrameFileNames is non-empty.');
  }
  if (totalFrames != null && (!Number.isFinite(totalFrames) || !Number.isInteger(totalFrames) || totalFrames <= 0)) {
    throw new Error(`totalFrames must be a positive finite integer or null (got ${JSON.stringify(totalFrames)}).`);
  }
  const canvasWidth = frameRender ? frameRender.sourceWidth : width;
  const canvasHeight = frameRender ? frameRender.sourceHeight : height;
  const frameRenderJson = escapeForInlineScript(JSON.stringify(frameRender));
  const recipeJson = escapeForInlineScript(JSON.stringify(recipe));
  const artworkUrlJson = escapeForInlineScript(JSON.stringify(artworkFileName ? `./${artworkFileName}` : null));
  // Diffusion Camera (Phase B) — the vendored shader objects, embedded once
  // per page regardless of whether this recipe's diffusionCamera is
  // enabled (same "always available, conditionally constructed" discipline
  // every other always-imported addon in this page follows).
  const diffusionShaderJson = escapeForInlineScript(JSON.stringify(DIFFUSION_SHADER));
  const treatmentShaderJson = escapeForInlineScript(JSON.stringify(TREATMENT_SHADER));
  // Timeline (Phase C) — embedded once, exactly like RECIPE above; `null`
  // whenever no timeline is active.
  const timelineJson = escapeForInlineScript(JSON.stringify(activeTimeline));

  // Scene background (Slice B/C): compose the effective scene HERE — the
  // exact same resolveEffectiveScene the capability check used — and
  // rewrite its asset references to the local file basenames art-render.mjs
  // copies alongside this page. null for every non-'scene' bgMode.
  let effectiveScene = null;
  if (recipe?.bgMode === 'scene') {
    const composed = resolveEffectiveScene(recipe);
    const requirements = sceneAssetRequirements(composed);
    const localName = (publicUrl) => `./${String(publicUrl).split('/').pop()}`;
    effectiveScene = {
      ...composed,
      panoLocal: requirements.pano ? localName(requirements.pano) : null,
      groundTexMapLocal: requirements.groundTex ? localName(requirements.groundTex.map) : null,
      groundTexRoughLocal: requirements.groundTex ? localName(requirements.groundTex.rough) : null,
      groundTexRepeat: requirements.groundTex?.repeat ?? 1,
    };
  }
  const effectiveSceneJsonValue = escapeForInlineScript(JSON.stringify(effectiveScene));
  // Pinned device-screen still (Slice F2) — a LOCAL file art-render.mjs
  // copied alongside this page; null when the recipe pins nothing.
  const screenStillUrlJson = escapeForInlineScript(JSON.stringify(deviceScreenStillFileName ? `./${deviceScreenStillFileName}` : null));
  // Live website frames (device-screen-live) — the LOCAL relative URLs for
  // each captured frame, in capture order; empty array when not active.
  const deviceLiveFrameUrlsJson = escapeForInlineScript(JSON.stringify(deviceLiveFrameFileNames.map((f) => `./${f}`)));
  const deviceLiveViewportJson = escapeForInlineScript(JSON.stringify(deviceLiveCaptureViewportPx));
  const totalFramesJson = escapeForInlineScript(JSON.stringify(totalFrames));

  return `<!doctype html>
<html>
<head><meta charset="utf-8"><style>html,body{margin:0;background:#000}</style></head>
<body>
<canvas id="c" width="${canvasWidth}" height="${canvasHeight}"></canvas>
<script type="importmap">
{"imports": {"three": "./three.module.min.js"}}
</script>
<script type="module">
import * as THREE from './three.module.min.js';
// RoomEnvironment/RGBELoader (Phase 5, STUDIO-DETERMINISTIC-FINAL-RENDER-
// SONNET-HANDOFF.md, environment/IBL parity) — the official three.js
// examples/jsm addons (node_modules/three/examples/jsm/..., copied
// byte-identical by art-render.mjs — see that file's own comment), NOT
// three-stdlib: three-stdlib's own single-file bundle (index.js) aggregates
// its ENTIRE library via ~460 further relative imports, impractical to
// vendor for two classes; these two official-examples files each import
// ONLY from bare 'three' (resolved by the importmap above) and nothing
// else, so they're genuinely standalone.
import { RoomEnvironment } from './RoomEnvironment.js';
import { RGBELoader } from './RGBELoader.js';
// mergeVertices (glass-petal-sphere parity) — same official-examples addon
// pattern as the two above (imports ONLY bare 'three', genuinely
// standalone); copied alongside this page by art-render.mjs.
import { mergeVertices } from './BufferGeometryUtils.js';
// RoundedBoxGeometry (Slice F1) — the device factory destructures it from
// ctx.stdlib; same official-examples addon pattern as the imports above.
import { RoundedBoxGeometry } from './RoundedBoxGeometry.js';
// T-shirt primary (Slice E) — the vendored elements closure imported
// DIRECTLY (true reuse, zero drift): the EXACT hanging-tshirt factory the
// live Studio runs (topology, panel materials, grain, print shader,
// hanger), the exact mat/phys/anim/tshirtPrint mapping, and the exact sim.
// Every module in this closure is pure local ESM (no bare 'three' import —
// THREE arrives via the factory ctx), copied to ./elements/ by
// art-render.mjs.
import { getFactory, tshirtSimParams, deviceBottomLocalY } from './elements/factories.js';
import { buildPrimaryTshirtInstanceRaw, PRIMARY_ARTWORK_LOGO_ID } from './elements/primary-cloth.js';
import { normalizeElementInstance } from './elements/schema.js';
import { stepSim as tshirtStepSim, SIM_DT as TSHIRT_SIM_DT } from './elements/tshirt-mesh.js';
// Diffusion Camera (Phase B) — the exact official three.js examples/jsm
// postprocessing addons ClothStudio.jsx's own composer chain uses (not a
// reimplementation), copied preserving their real postprocessing/+shaders/
// directory split by art-render.mjs (see that file's own comment for why —
// EffectComposer.js imports CopyShader.js via '../shaders/CopyShader.js').
import { EffectComposer } from './postprocessing/EffectComposer.js';
import { RenderPass } from './postprocessing/RenderPass.js';
import { ShaderPass } from './postprocessing/ShaderPass.js';
// diffusion-focus.js (Phase B) — the vendored, byte-identical, zero-import
// pure module (app/dashboard/studio/diffusion-focus.js) — the SAME focal-
// target resolution + CoC/blur-math code the live Studio's render loop
// runs, not a mirror. Copied alongside this page by art-render.mjs.
import {
  DIFFUSION_FOCAL_ORIGIN, DIFFUSION_FOCAL_MANUAL, DIFFUSION_FOCAL_PRIMARY_ARTWORK,
  resolveFocalTargetId, cameraSpaceForwardDistance,
} from './diffusion-focus.js';
// Timeline (Phase C correction, "exact smoothstep-eased parity") — the
// vendored, byte-identical app/dashboard/studio/timeline.js (true reuse,
// not a port): resolveTimelineScrollAt below calls the EXACT SAME
// straddling-pair resolver the live client's stepTimelinePlayback calls,
// so this reduced two-scalar server track gets the exact same
// smoothstep-eased blend and edge-case handling as the live preview.
// Copied alongside this page by art-render.mjs (scripts/vendor-timeline.mjs);
// drift-guarded by __tests__/timeline-vendor.test.mjs.
import { resolveTrackState } from './timeline.js';

const RECIPE = ${recipeJson};
const ARTWORK_URL = ${artworkUrlJson};
const PHYSICS_DT = ${PHYSICS_DT};
const FPS = ${fps};
const DEG = Math.PI / 180;
// Diffusion Camera shader source (Phase B) — vendored verbatim from
// ClothStudio.jsx (scripts/vendor-diffusion-camera.mjs); embedded as JSON
// literals, exactly like RECIPE above.
const DIFFUSION_SHADER = ${diffusionShaderJson};
const TREATMENT_SHADER = ${treatmentShaderJson};
// Timeline (Phase C, "Interrupted export recovery") — the server-reduced
// scroll/posY keyframe track, or null when no timeline is active. See
// resolveTimelineScrollAt below (near __renderFrame) for how it's applied.
const TIMELINE = ${timelineJson};
// Live website frames (device-screen-live, STUDIO-DETERMINISTIC-FINAL-
// RENDER-SONNET-HANDOFF.md checkpoint) — local relative URLs to frames
// art-render.mjs already captured + copied alongside this page, in capture
// order; empty whenever this recipe doesn't request a live device screen.
// See awaitDeviceLiveFrames/ensureDeviceLiveFrame/drawDeviceLiveFrame (near
// the device block) for how they become the screen texture — decoded ON
// DEMAND, never all at once — and __renderFrame's IS_DEVICE branch for the
// per-output-frame selection formula.
const DEVICE_LIVE_FRAME_URLS = ${deviceLiveFrameUrlsJson};
const DEVICE_LIVE_VIEWPORT_PX = ${deviceLiveViewportJson};
// Total OUTPUT frame count (fps*durationSeconds) — only used by the
// no-timeline live-frame pacing formula (resolveTimelineScrollAt already
// covers the timeline case, which doesn't need this).
const TOTAL_FRAMES = ${totalFramesJson};

// mulberry32 — verbatim copy of app/dashboard/studio/elements/randomize.js's
// implementation (proven in the Slice 4b spike; same reasoning for why this
// plain unbundled page can't import that file directly).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Seeded stand-in for ClothStudio.jsx's real makeGrainCanvas() (Slice 4b
// finding #2: that function uses raw Math.random()). Identical formula
// (118 + floor(rand()*60) + floor(rand()*60)), seeded by the recipe's own
// lookSeed so the SAME recipe always produces the SAME bump texture.
function makeSeededGrainTexture(seed) {
  const rand = mulberry32(seed);
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 118 + Math.floor(rand() * 60) + Math.floor(rand() * 60);
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

// Mirror a texture horizontally for the back face — verbatim technique from
// ClothStudio.jsx's own mirrorTex (clone + wrapS RepeatWrapping + repeat.x=-1).
function mirrorTex(tex) {
  const t = tex.clone();
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.x = -1;
  t.needsUpdate = true;
  return t;
}

// Loads the resolved local artwork image (art-render.mjs already copied it
// alongside this page — see that file's BUILTIN_ARTWORK_ASSETS) and resolves
// once it's actually decoded. Local file only, no network beyond 127.0.0.1.
function loadArtworkTexture(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      resolve(tex);
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ── Cloth verlet simulation — faithful port of ClothStudio.jsx's own
// buildCloth/applyPins/applyRumple/step (pure math, no randomness, no
// wall-clock reads). world.grab (pointer-drag) and world.poke (the
// Math.random()-seeded impulse the Slice 4c checkpoint's correction
// documents) are BOTH excluded — interactive-only, never part of
// captureSceneRecipe, so a recipe-driven render never needs them.
const CLOTH_ASPECTS = { portrait: { w: 1.20, h: 1.60 }, square: { w: 1.42, h: 1.42 }, landscape: { w: 1.72, h: 1.08 } };
const PERF_SEGS = { high: 88, medium: 60, low: 36 };

// clothAspect==='auto' — verbatim port of ClothStudio.jsx's own
// world.buildCloth auto-shape branch: ratio clamped to [0.38, 2.6],
// ch = sqrt(1.92 / ratio), cw = ch * ratio. Falls through to the normal
// CLOTH_ASPECTS lookup (→ portrait) when 'auto' is requested but no
// artworkRatio is available — same edge-case behavior as the real function,
// not a bug.
function buildCloth({ clothAspect, perf, artworkRatio }) {
  let cw, ch;
  if (clothAspect === 'auto' && artworkRatio) {
    const r = Math.min(2.6, Math.max(0.38, artworkRatio));
    ch = Math.sqrt(1.92 / r);
    cw = ch * r;
  } else {
    ({ w: cw, h: ch } = CLOTH_ASPECTS[clothAspect] || CLOTH_ASPECTS.portrait);
  }
  const base = PERF_SEGS[perf] || 60;
  const longest = Math.max(cw, ch);
  const segX = Math.max(12, Math.round(base * cw / longest));
  const segY = Math.max(12, Math.round(base * ch / longest));

  const geometry = new THREE.PlaneGeometry(cw, ch, segX, segY);
  const pos = geometry.attributes.position;
  const count = pos.count;
  const prev = new Float32Array(count * 3);
  const orig = new Float32Array(count * 3);
  prev.set(pos.array); orig.set(pos.array);

  const cols = segX + 1, rows = segY + 1;
  const idx = (x, y) => y * cols + x;
  const restX = cw / segX, restY = ch / segY;
  const restD = Math.hypot(restX, restY);
  const constraints = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (x < cols - 1) constraints.push([idx(x, y), idx(x + 1, y), restX]);
      if (y < rows - 1) constraints.push([idx(x, y), idx(x, y + 1), restY]);
      if (x < cols - 1 && y < rows - 1) {
        constraints.push([idx(x, y), idx(x + 1, y + 1), restD]);
        constraints.push([idx(x + 1, y), idx(x, y + 1), restD]);
      }
      if (x < cols - 2) constraints.push([idx(x, y), idx(x + 2, y), restX * 2]);
      if (y < rows - 2) constraints.push([idx(x, y), idx(x, y + 2), restY * 2]);
    }
  }
  return { geometry, prev, orig, constraints, cols, rows, count, cw, ch, pins: new Set() };
}

function applyPins(cloth, pinMode) {
  const pins = new Set();
  const top = (x) => x;
  const bottom = (x) => (cloth.rows - 1) * cloth.cols + x;
  if (pinMode === 'free-float') { /* no pins */ }
  else if (pinMode === 'top-edge') { for (let x = 0; x < cloth.cols; x += 1) pins.add(top(x)); }
  else if (pinMode === 'top-corners') { pins.add(top(0)); pins.add(top(cloth.cols - 1)); }
  else { pins.add(top(0)); pins.add(top(cloth.cols - 1)); pins.add(bottom(0)); pins.add(bottom(cloth.cols - 1)); }
  cloth.pins = pins;
}

function applyRumple(cloth, amount) {
  const arr = cloth.geometry.attributes.position.array;
  const a = (amount ?? 0) * 0.22;
  for (let i = 0; i < cloth.count; i += 1) {
    const i3 = i * 3;
    if (cloth.pins.has(i)) {
      arr[i3] = cloth.orig[i3]; arr[i3 + 1] = cloth.orig[i3 + 1]; arr[i3 + 2] = cloth.orig[i3 + 2];
    } else {
      const ox = cloth.orig[i3], oy = cloth.orig[i3 + 1];
      arr[i3] = ox + a * 0.35 * Math.sin(oy * 4.1 + 2.2);
      arr[i3 + 1] = oy + a * 0.3 * Math.cos(ox * 3.7 + 1.1);
      arr[i3 + 2] = cloth.orig[i3 + 2] + a * (
        0.55 * Math.sin(ox * 3.1 + 1.7) * Math.cos(oy * 2.3 + 0.6)
        + 0.3 * Math.sin(ox * 6.7 + 4.2) * Math.cos(oy * 5.1 + 2.8)
        + 0.2 * Math.sin(ox * 11.3 + 0.9) * Math.cos(oy * 9.7 + 5.5)
      );
    }
    cloth.prev[i3] = arr[i3]; cloth.prev[i3 + 1] = arr[i3 + 1]; cloth.prev[i3 + 2] = arr[i3 + 2];
  }
  cloth.geometry.attributes.position.needsUpdate = true;
  cloth.geometry.computeVertexNormals();
}

function stepCloth(cloth, phys, anim, t) {
  const arr = cloth.geometry.attributes.position.array;
  const prev = cloth.prev;
  const damp = phys.damping;
  const g = phys.pinMode === 'free-float' ? 0 : -phys.gravity * 0.28;
  const amp = anim.on ? anim.turbulence * 2.4 : 0;
  const ws = anim.speed || 1;
  const gust = 0.5 + 0.5 * Math.sin(t * ws * 1.25);
  const dt2 = PHYSICS_DT * PHYSICS_DT;

  for (let i = 0; i < cloth.count; i += 1) {
    if (cloth.pins.has(i)) continue;
    const ix = i * 3;
    const x = arr[ix], y = arr[ix + 1], z = arr[ix + 2];
    const wz = amp * (0.45 + 0.55 * gust) * (
      0.7 * Math.sin(x * 2.3 + t * ws * 1.7) * Math.cos(y * 1.9 + t * ws * 1.3)
      + 0.35 * Math.sin(x * 5.1 - t * ws * 2.3) * Math.cos(y * 4.3 + t * ws * 1.9)
    );
    const wx = amp * 0.3 * Math.sin(t * ws * 0.8 + y * 2.6) * Math.cos(x * 1.7 + t * ws * 0.6);
    const wy = amp * 0.18 * Math.sin(t * ws * 0.7 + x * 2.1);
    const vx = (x - prev[ix]) * damp;
    const vy = (y - prev[ix + 1]) * damp;
    const vz = (z - prev[ix + 2]) * damp;
    prev[ix] = x; prev[ix + 1] = y; prev[ix + 2] = z;
    arr[ix] = x + vx + wx * dt2;
    arr[ix + 1] = y + vy + (g + wy) * dt2;
    arr[ix + 2] = z + vz + wz * dt2;
  }

  const stiff = 0.5 * phys.stiffness;
  const iters = 5;
  for (let it = 0; it < iters; it += 1) {
    for (let ci = 0; ci < cloth.constraints.length; ci += 1) {
      const [a, b, rest] = cloth.constraints[ci];
      const ax = a * 3, bx = b * 3;
      const dx = arr[bx] - arr[ax], dy = arr[bx + 1] - arr[ax + 1], dz = arr[bx + 2] - arr[ax + 2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      const diff = ((dist - rest) / dist) * stiff;
      const ox = dx * diff, oy = dy * diff, oz = dz * diff;
      arr[ax] += ox; arr[ax + 1] += oy; arr[ax + 2] += oz;
      arr[bx] -= ox; arr[bx + 1] -= oy; arr[bx + 2] -= oz;
    }
    for (const pi of cloth.pins) {
      const ix = pi * 3;
      arr[ix] = cloth.orig[ix]; arr[ix + 1] = cloth.orig[ix + 1]; arr[ix + 2] = cloth.orig[ix + 2];
      prev[ix] = cloth.orig[ix]; prev[ix + 1] = cloth.orig[ix + 1]; prev[ix + 2] = cloth.orig[ix + 2];
    }
  }

  if (phys.pinMode === 'free-float') {
    const k = (phys.rebound ?? 0.18) * 0.02;
    if (k > 0) {
      for (let i = 0; i < cloth.count; i += 1) {
        const ix3 = i * 3;
        arr[ix3] += (cloth.orig[ix3] - arr[ix3]) * k;
        arr[ix3 + 1] += (cloth.orig[ix3 + 1] - arr[ix3 + 1]) * k;
        arr[ix3 + 2] += (cloth.orig[ix3 + 2] - arr[ix3 + 2]) * k;
      }
    }
  }

  cloth.geometry.attributes.position.needsUpdate = true;
  cloth.geometry.computeVertexNormals();
}

// ── Scene assembly ──────────────────────────────────────────────────────
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(${canvasWidth}, ${canvasHeight}, false);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Shadows (Codex Slice-B/C P1 correction — scene floors could never match
// Studio without them): the live Studio enables the shadow pipeline
// globally at renderer creation (ClothStudio.jsx ~L3277), light can 0
// carries the one configured shadow caster, the front cloth casts, and the
// ground receives — all ported verbatim below. Outside scene mode the
// ground (the only receiver) stays invisible, so this changes nothing
// visible for color-background renders, exactly like the live Studio.
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// ── WebGL context-loss watch (black-frame race) ────────────────────────────
// A lost WebGL context does not throw and does not fire a page error: every
// draw silently no-ops and the canvas reads back as pure black, so a render
// that hits one emits BLANK FRAMES and still reports success. three.js
// registers its own 'webglcontextlost' handler that calls preventDefault(),
// so Chromium restores the context and three re-initializes — which is why
// the symptom is a run of leading black frames that then quietly starts
// working, not a hard failure. Counted here and enforced in __renderFrame:
// "a sourced screen either renders its source or the render fails" applies to
// the whole frame just as much as to one texture.
let glContextLostCount = 0;
let glContextRestoredCount = 0;
canvas.addEventListener('webglcontextlost', () => {
  glContextLostCount += 1;
  console.error('[art-scene] webglcontextlost #' + glContextLostCount);
}, false);
canvas.addEventListener('webglcontextrestored', () => {
  glContextRestoredCount += 1;
  console.error('[art-scene] webglcontextrestored #' + glContextRestoredCount);
}, false);
window.__glInspection = {
  get contextLostCount() { return glContextLostCount; },
  get contextRestoredCount() { return glContextRestoredCount; },
  get contextCurrentlyLost() { return renderer.getContext().isContextLost(); },
};

const scene = new THREE.Scene();
// ── Background (Slice B/C scene parity). bgMode 'scene' draws the composed
// effective scene: procedural backdrop immediately (below), the pano plate
// swapped in before frame zero (setupSceneBackground). 'image'/
// 'transparent' are capability-rejected upstream; anything else is the
// plain solid color. EFFECTIVE_SCENE is composed SERVER-SIDE from the
// vendored preset tables + the recipe's sanitized sceneTweaks
// (art-scene-def.mjs resolveEffectiveScene — the same composition the
// capability check judged), with asset URLs already rewritten to this
// page's own local copies.
const EFFECTIVE_SCENE = ${effectiveSceneJsonValue};
const SCREEN_STILL_URL = ${screenStillUrlJson};
// Capture Frame crop (parity round) — null for frameId 'off'. When set,
// the canvas above is the boosted SOURCE stage; each captured frame is a
// pure drawImage region copy of cropRect into this fixed target-size
// canvas: native resolution by construction, no scaling of content, and
// no HUD/label/filmstrip/dimming code exists in this page at all.
const FRAME_RENDER = ${frameRenderJson};
const frameExportCanvas = FRAME_RENDER ? (() => {
  const c = document.createElement('canvas');
  c.width = FRAME_RENDER.targetWidth; c.height = FRAME_RENDER.targetHeight;
  return c;
})() : null;
const sceneSeedValue = Number.isFinite(RECIPE.sceneSeed) ? RECIPE.sceneSeed : 1;
if (!(RECIPE.bgMode === 'scene' && EFFECTIVE_SCENE)) {
  scene.background = new THREE.Color(RECIPE.bgColor || '#000000');
}

// Verbatim port of ClothStudio.jsx's paintSceneBackdrop, with ONE
// deliberate change: the 4200-speckle film-grain pass uses a mulberry32
// PRNG seeded from the recipe's own sceneSeed instead of raw Math.random()
// (Codex Slice-B constraint — the same seeded-stand-in discipline
// makeSeededGrainTexture above already established for the bump texture).
function paintSceneBackdrop(cfg, rand) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 1024;
  const x = c.getContext('2d');
  const grad = x.createLinearGradient(0, 0, 0, 1024);
  if (cfg.type === 'sunset') {
    grad.addColorStop(0, cfg.top); grad.addColorStop(0.55, cfg.mid); grad.addColorStop(1, cfg.bottom);
  } else {
    grad.addColorStop(0, cfg.top); grad.addColorStop(1, cfg.bottom);
  }
  x.fillStyle = grad; x.fillRect(0, 0, 1024, 1024);
  if (cfg.type === 'sunset' && cfg.sun) {
    const [sx, sy] = cfg.sunAt || [0.5, 0.6];
    const sun = x.createRadialGradient(sx * 1024, sy * 1024, 20, sx * 1024, sy * 1024, 340);
    sun.addColorStop(0, cfg.sun); sun.addColorStop(1, 'rgba(255,180,80,0)');
    x.fillStyle = sun; x.fillRect(0, 0, 1024, 1024);
  }
  if (cfg.glow) {
    const [gx, gy] = cfg.glowAt || [0.5, 0.4];
    const g = x.createRadialGradient(gx * 1024, gy * 1024, 30, gx * 1024, gy * 1024, 700);
    g.addColorStop(0, cfg.glow); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 1024, 1024);
  }
  if (cfg.bars) {
    cfg.bars.forEach((color, i) => {
      const bx = 1024 * (0.18 + i * 0.3);
      const bar = x.createLinearGradient(bx - 60, 0, bx + 60, 0);
      bar.addColorStop(0, 'rgba(0,0,0,0)'); bar.addColorStop(0.5, color); bar.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = bar; x.fillRect(bx - 60, 0, 120, 1024);
    });
  }
  if (cfg.beam) {
    // Fake volumetric cone from the top — sells the spotlight.
    const beam = x.createLinearGradient(0, 0, 0, 1024);
    beam.addColorStop(0, cfg.beam); beam.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = beam;
    x.beginPath();
    x.moveTo(460, 0); x.lineTo(564, 0); x.lineTo(900, 1024); x.lineTo(124, 1024);
    x.closePath(); x.fill();
  }
  // Film grain — seeded (see this function's own header comment).
  x.globalAlpha = 0.05;
  for (let i = 0; i < 4200; i += 1) {
    x.fillStyle = rand() > 0.5 ? '#fff' : '#000';
    x.fillRect(rand() * 1024, rand() * 1024, 1.4, 1.4);
  }
  x.globalAlpha = 1;
  // Vignette
  if (cfg.vignette) {
    const v = x.createRadialGradient(512, 480, 300, 512, 512, 780);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,' + cfg.vignette + ')');
    x.fillStyle = v; x.fillRect(0, 0, 1024, 1024);
  }
  return c;
}

const camera = new THREE.PerspectiveCamera(40, ${canvasWidth} / ${canvasHeight}, 0.05, 60);
if (RECIPE.shotCam?.use) {
  const az = RECIPE.shotCam.az * DEG, el = RECIPE.shotCam.el * DEG, R = RECIPE.shotCam.dist;
  camera.position.set(R * Math.cos(el) * Math.sin(az), R * Math.sin(el), R * Math.cos(el) * Math.cos(az));
  camera.fov = RECIPE.shotCam.fov;
  camera.updateProjectionMatrix();
} else {
  camera.position.set(0, 0, 2.6); // ClothStudio.jsx's own default mount view — see this file's "Known limitation" header comment
}
camera.lookAt(0, 0, 0);

// Lighting cans — real az/el→position formula (ClothStudio.jsx, R=2.8, intensity*14).
const cansGroup = new THREE.Group();
scene.add(cansGroup);
(RECIPE.lightCans || []).forEach((c, i) => {
  const light = new THREE.SpotLight(0xffffff, 0);
  light.angle = 0.7; light.penumbra = 0.7; light.decay = 1.1;
  if (i === 0) {
    // Exact live shadow settings (ClothStudio.jsx ~L3342) — can 0 is the
    // one configured shadow caster, verbatim.
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.bias = -0.0005;
    light.shadow.normalBias = 0.02;
  }
  light.visible = Boolean(c.on) && c.intensity > 0;
  light.color.set(c.color);
  light.intensity = c.intensity * 14;
  const az = (c.az || 0) * DEG, el = (c.el || 0) * DEG, R = 2.8;
  light.position.set(R * Math.cos(el) * Math.sin(az), R * Math.sin(el), R * Math.cos(el) * Math.cos(az));
  light.target.position.set(0, 0, 0);
  cansGroup.add(light); cansGroup.add(light.target);
});

// Ground plane — verbatim ClothStudio.jsx world build (PlaneGeometry 30×30,
// standard material, receiveShadow, hidden by default). Only a scene-mode
// effective scene with a 'ground' color set ever shows it (below), exactly
// like the live Studio.
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 30),
  new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.95, metalness: 0 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -1.15;
ground.receiveShadow = true;
ground.visible = false;
scene.add(ground);

// Scene-mode synchronous application — the procedural backdrop, fog, and
// flat ground state, verbatim from ClothStudio.jsx's bgMode==='scene'
// effect. Pano plate + ground textures are ASYNC assets and load in
// setupSceneBackground() before frame zero — never a mid-render swap.
if (RECIPE.bgMode === 'scene' && EFFECTIVE_SCENE) {
  const sc = EFFECTIVE_SCENE;
  const backdropTex = new THREE.CanvasTexture(paintSceneBackdrop(sc.backdrop || {}, mulberry32(sceneSeedValue)));
  backdropTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = backdropTex;
  scene.fog = sc.fog ? new THREE.FogExp2(new THREE.Color(sc.fog.color).getHex(), sc.fog.density) : null;
  if (sc.ground) {
    ground.visible = true;
    // Desk-style sets raise the floor to meet the surface; stage sets keep
    // the deep floor — same groundY semantics as the live Studio.
    ground.position.y = sc.groundY ?? -1.15;
    // Textured floors carry color in the map (tint defaults white); flat
    // floors use the preset ground color directly.
    ground.material.color.set(sc.groundTexMapLocal ? (sc.groundTint || '#ffffff') : sc.ground);
  }
}

// Cloth material — every NATIVE MeshPhysicalMaterial property ClothStudio.jsx
// itself drives, ported EXACTLY (Codex re-review round 3): the custom holo
// GLSL shader (uHoloIntensity/uHoloScale/uBandFreq/uSatBoost/uSparkle
// uniforms — the actual banding pattern) remains deferred and gated (see
// art-render.mjs's CAPABILITY_CHECKS), but every native-property side effect
// of those same recipe fields — finish→roughness/clearcoat, bump scale,
// front/back bump tiling, sheen/iridescence fixed constants, and the
// specularColor/specularIntensity formula — is genuine three.js material
// math, not custom-shader-dependent, so it's implemented for real rather
// than approximated or gated alongside the shader.
const m = RECIPE.mat || {};

// finish → roughness/clearcoat — verbatim ClothStudio.jsx formula
// (rough=mat.roughness, cc=mat.clearcoat; 'matte' clamps rough up and cuts
// clearcoat; 'satin' nudges rough up and halves clearcoat); 'glossy' (and
// any other/unset finish) leaves both unchanged.
let rough = Number.isFinite(m.roughness) ? m.roughness : 0.85;
let clearcoatValue = Number.isFinite(m.clearcoat) ? m.clearcoat : 1;
if (m.finish === 'matte') { rough = Math.max(rough, 0.7); clearcoatValue *= 0.15; }
else if (m.finish === 'satin') { rough = Math.min(1, rough + 0.28); clearcoatValue *= 0.5; }

// Front/back bump textures — SEPARATE texture instances (never shared by
// reference — .repeat is per-texture, and ClothStudio.jsx itself keeps a
// distinct backBumpTex for exactly this reason). Front tiles
// [bumpTiling, bumpTiling]; back tiles [-bumpTiling, bumpTiling] (mirrored
// X) — verbatim ClothStudio.jsx bumpMap.repeat.set(mirrored ? -tiling : tiling, tiling).
const bumpTiling = Number.isFinite(m.bumpTiling) ? m.bumpTiling : 2.5;
const frontBumpTex = makeSeededGrainTexture(Number.isFinite(RECIPE.lookSeed) ? RECIPE.lookSeed : 1);
frontBumpTex.repeat.set(bumpTiling, bumpTiling);
frontBumpTex.needsUpdate = true;
const backBumpTex = frontBumpTex.clone();
backBumpTex.repeat.set(-bumpTiling, bumpTiling);
backBumpTex.needsUpdate = true;

// specularColor/specularIntensity — a NATIVE MeshPhysicalMaterial property
// pair the custom shader ALSO happens to drive, but this specific formula is
// plain material math needing no shader at all — computed faithfully from
// the real recipe values for every input, not just the gated-supported
// default. At holoIntensity:0 (the supported profile's own default) the
// lerp factor is forced to exactly 0 regardless of specTint/hueShift, so
// specularColor evaluates to pure white and specularIntensity to
// 0.4+0.6*1=1.0 — matching ClothStudio.jsx exactly (verified by test).
const specTint = Number.isFinite(m.specTint) ? m.specTint : 1;
const holoIntensity = Number.isFinite(m.holoIntensity) ? m.holoIntensity : 0;
const hueShift = Number.isFinite(m.hueShift) ? m.hueShift : 0;
const hueCol = new THREE.Color().setHSL(((hueShift % 1) + 1) % 1, 0.85, 0.62);
const specularColor = new THREE.Color(0xffffff).lerp(hueCol, specTint * Math.min(1, holoIntensity * 1.5));
const specularIntensity = 0.4 + 0.6 * specTint;

const material = new THREE.MeshPhysicalMaterial({
  color: m.baseColor || '#ffffff',
  roughness: rough,
  metalness: Number.isFinite(m.metalness) ? m.metalness : 0.5,
  clearcoat: clearcoatValue,
  clearcoatRoughness: Number.isFinite(m.coatRoughness) ? m.coatRoughness : 0.1,
  sheen: Number.isFinite(m.sheen) ? m.sheen : 0,
  // Fixed constants — ClothStudio.jsx's own mkClothMaterial sets these
  // unconditionally, never recipe-driven.
  sheenRoughness: 0.5,
  sheenColor: new THREE.Color(0xffffff),
  iridescence: Number.isFinite(m.iridescence) ? m.iridescence : 0,
  iridescenceIOR: 1.3,
  iridescenceThicknessRange: [120, 480],
  specularColor,
  specularIntensity,
  bumpMap: frontBumpTex,
  bumpScale: (Number.isFinite(m.bump) ? m.bump : 0.26) * 0.014, // verbatim ClothStudio.jsx constant (was 0.02 — a round-2 approximation, now exact)
  side: THREE.FrontSide,
});
const backMaterial = material.clone();
backMaterial.side = THREE.BackSide;
backMaterial.bumpMap = backBumpTex;

// Environment/IBL (Phase 5) — envMapIntensity applied to BOTH front/back
// materials, verbatim ClothStudio.jsx's own applyMatToWorld (the SAME value
// on both — mirrored is only a texture-repeat concern, not an intensity
// one). RECIPE.envIntensity is always already a finite, clamped [0,2.5]
// number by construction (art-recipe.mjs's normalizeScene never lets it
// through unresolved) — no defensive fallback needed here.
material.envMapIntensity = RECIPE.envIntensity;
backMaterial.envMapIntensity = RECIPE.envIntensity;

// ── Primary shape: sheet XOR T-shirt (Slice E) — exactly ONE primary is
// ever built, mirroring ClothStudio.jsx's own sheet-rebuild/tshirt
// lifecycle pair (the sheet effect disposes the flyer for any non-'sheet'
// shape; the tshirt effect owns the garment). clothShape 'device' never
// reaches here (capability-gated, Slice F).
const IS_TSHIRT = RECIPE.clothShape === 'tshirt';
const IS_DEVICE = RECIPE.clothShape === 'device';
let cloth = null;
let clothMesh = null;
let clothMeshBack = null;
if (!IS_TSHIRT && !IS_DEVICE) {
  cloth = buildCloth({ clothAspect: RECIPE.clothAspect, perf: RECIPE.perf, artworkRatio: RECIPE.artworkRatio });
  applyPins(cloth, RECIPE.phys.pinMode);
  applyRumple(cloth, RECIPE.phys.rumple ?? 0.5);
  clothMesh = new THREE.Mesh(cloth.geometry, material);
  clothMesh.castShadow = true; // scene sets catch this on the ground plane (verbatim ClothStudio.jsx — front mesh only)
  clothMeshBack = new THREE.Mesh(cloth.geometry, backMaterial);
  scene.add(clothMesh);
  scene.add(clothMeshBack);
}

// T-shirt primary — driven through the EXACT SAME getFactory('hanging-
// tshirt') create/applyInstance contract the live Studio's dedicated
// primary lifecycle uses (ClothStudio.jsx ~L6839), with the same
// buildPrimaryTshirtInstanceRaw mapping and the primary artwork exposed
// under PRIMARY_ARTWORK_LOGO_ID as the front print's only source. The
// factory does NOT set castShadow on the garment meshes — verbatim live
// behavior, deliberately not "improved" here (Codex Slice-E constraint).
let tshirtEntry = null;
let tshirtParams = null;
let tshirtInstance = null;
if (IS_TSHIRT) {
  const tshirtFactory = getFactory('hanging-tshirt');
  const tshirtCtx = {
    THREE,
    tier: RECIPE.elementQualityTier,
    logoAssetsById: ARTWORK_URL ? { [PRIMARY_ARTWORK_LOGO_ID]: { dataUrl: ARTWORK_URL } } : {},
  };
  const tshirtRoot = tshirtFactory.create(tshirtCtx);
  scene.add(tshirtRoot);
  const rawInstance = buildPrimaryTshirtInstanceRaw({
    mat: RECIPE.mat, phys: RECIPE.phys, anim: RECIPE.anim, tshirtPrint: RECIPE.tshirtPrint, hasArtwork: Boolean(ARTWORK_URL),
  });
  tshirtInstance = normalizeElementInstance(rawInstance, 'hanging-tshirt');
  tshirtFactory.applyInstance(tshirtCtx, tshirtRoot, tshirtInstance);
  tshirtParams = tshirtSimParams(tshirtInstance);
  tshirtEntry = { root: tshirtRoot };
}

// Device primary (Slice F1) — the SHELL with its deterministic procedural
// placeholder screen, via the SAME getFactory('device-mockup') contract the
// live Studio's device lifecycle uses (ClothStudio.jsx ~L6881), including
// the seat-on-floor placement math against the composed scene's own floor.
// Screen sources are FORCED empty here: the capability layer already
// rejected any recipe carrying live/liveUrl/captureUrl/uploadAssetId, and
// the renderer must never fetch a website or reach a browser-local library
// regardless — the F2 pinned-still workflow is what will hand this page a
// durable local image instead.
let deviceEntry = null;
let deviceInstance = null;
// Hoisted out of the IS_DEVICE block below (Phase C) — __renderFrame's own
// per-frame timeline posY override needs the same seat-floor baseline the
// instance was originally placed at; stays 0 (its declared default) for
// every non-device recipe, where it's never read.
let deviceSeatY = 0;
if (IS_DEVICE) {
  const dp = RECIPE.devicePrimary || {};
  const deviceFactory = getFactory('device-mockup');
  const deviceCtx = { THREE, stdlib: { RoundedBoxGeometry }, tier: RECIPE.elementQualityTier, deviceScreenAssetsById: {} };
  const deviceRoot = deviceFactory.create(deviceCtx);
  scene.add(deviceRoot);
  const deviceModelId = (dp.models && dp.models[dp.viewport]) || '';
  const deviceScale = Number.isFinite(dp.scale) ? dp.scale : 1.45;
  const sc = (RECIPE.bgMode === 'scene' && EFFECTIVE_SCENE) ? EFFECTIVE_SCENE : null;
  const seatY = (dp.seatOnFloor && sc && sc.ground)
    ? (sc.groundY ?? -1.15) - deviceBottomLocalY(dp.viewport, deviceModelId) * deviceScale
    : 0;
  deviceSeatY = seatY;
  deviceInstance = normalizeElementInstance({
    id: 'device-primary', type: 'device-mockup', enabled: true, depth: 'hero',
    transform: { position: [0, seatY + (dp.posY || 0), 0], rotation: [0, 0, 0], scale: [deviceScale, deviceScale, deviceScale] },
    material: { color: dp.color, accent: dp.accent, claySoftness: dp.claySoftness, clayColor: dp.clayColor },
    motion: { rotate: dp.sway, speed: dp.swaySpeed },
    appearance: {
      viewport: dp.viewport, model: deviceModelId, finish: dp.finish,
      shellTexture: dp.shellTexture,
      scroll: dp.scroll, scrollSpeed: dp.scrollSpeed,
      scrollPosition: dp.scrollPosition,
      // Pinned still (Slice F2): the LOCAL screen-still file rides the
      // factory's own capture-texture path (deviceSyncScreenTexture —
      // TextureLoader + per-image screenRepeatY scroll fraction), so the
      // pinned screen scrolls/pans exactly like a live capture would.
      // Never a recipe URL: capability already rejected raw sources, and a
      // recipe that pins a still without the local file being present
      // REJECTS in art-render before this page even builds.
      captureUrl: SCREEN_STILL_URL || '', uploadAssetId: '',
    },
  }, 'device-mockup');
  deviceFactory.applyInstance(deviceCtx, deviceRoot, deviceInstance);
  deviceEntry = { root: deviceRoot, factory: deviceFactory };
}

// ── Glass Petal Sphere (Phase 5 parity — the PRIMARY glass element,
// RECIPE.glass; extraInstances glass DUPLICATES stay data-only and remain
// capability-gated). Faithful port of ClothStudio.jsx's own build
// (makePetalGeo/PETALS/glassMat — verbatim constants) plus its two state-
// application effects: visible/scale/clarity→roughness/transmission/tint→
// attenuationColor, and position + rotationOffset (DEGREES) as the rotation
// baseline. The auto-rotate increments live in __renderFrame's fixed-
// timestep loop below — the client integrates rotSpeed*0.5/0.17 rad/s with
// its real raf dt, which is linear in dt, so advancing by PHYSICS_DT per
// solver step reproduces the exact same rotation at every captured
// timestamp. Pure math + fixed constants — no randomness anywhere, so
// determinism needs no seeding.
const GL = RECIPE.glass || {};
let glassGroup = null;
let glassRotBase = null; // rotationOffset baseline in radians — the anchor exact-frame-time rotation is computed from
if (GL.on === true) {
  // Each petal is a partial torus arc whose cross-section stretches across
  // the sphere surface and tapers to sharp tips ("orange peel" blades).
  const makePetalGeo = (R, tube, arc) => {
    let g = new THREE.TorusGeometry(R, tube, 26, 90, arc);
    const gp = g.attributes.position;
    for (let i = 0; i < gp.count; i += 1) {
      const x = gp.getX(i), y = gp.getY(i), z = gp.getZ(i);
      let theta = Math.atan2(y, x);
      if (theta < 0) theta += Math.PI * 2;
      const tt = Math.min(Math.max(theta / arc, 0), 1);
      const taper = Math.pow(Math.sin(tt * Math.PI), 0.65); // sharp tips
      const cx = R * Math.cos(theta), cy = R * Math.sin(theta);
      const ox = (x - cx) * 0.5 * taper;
      const oy = (y - cy) * 0.5 * taper;
      const oz = z * 2.3 * taper; // wide across the sphere → blade shell
      gp.setXYZ(i, cx + ox, cy + oy, oz);
    }
    // Weld the tube's duplicated UV-seam vertices (and collapsed tips)
    // BEFORE normals, position-only (uv + stale normals dropped first) —
    // split verts get split normals and read as a hard seam otherwise.
    // Safe: the transmission material has no maps, nothing reads UVs.
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    g = mergeVertices(g, 1e-4);
    g.computeVertexNormals();
    return g;
  };
  // FrontSide, not DoubleSide — each petal is an OPEN arc, and the five
  // overlapping petals' OUTER surfaces already cover the shell continuously;
  // DoubleSide doubled every transmissive interface and read as opaque
  // frosted mass (see ClothStudio.jsx's own comment on this).
  const glassMat = new THREE.MeshPhysicalMaterial({
    transmission: 1, thickness: 0.7, ior: 1.5,
    roughness: 0.03, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.04,
    attenuationColor: new THREE.Color(0xffffff), attenuationDistance: 1.8,
    side: THREE.FrontSide,
  });
  glassMat.roughness = Number.isFinite(GL.clarity) ? GL.clarity : 0.06;
  glassMat.transmission = Number.isFinite(GL.transmission) ? GL.transmission : 1;
  glassMat.attenuationColor.set(GL.tint || '#ffffff');
  glassMat.color.set('#ffffff');
  const PETALS = [
    { R: 1.02, tube: 0.20, arc: 4.3, rot: [0, 0, 0] },
    { R: 1.06, tube: 0.18, arc: 3.7, rot: [1.15, 0.42, 0.55] },
    { R: 0.99, tube: 0.21, arc: 4.5, rot: [2.2, 1.3, 0.95] },
    { R: 1.08, tube: 0.17, arc: 3.4, rot: [0.6, 2.35, 1.8] },
    { R: 1.03, tube: 0.19, arc: 4.0, rot: [1.75, 0.9, 2.6] },
  ];
  glassGroup = new THREE.Group(); // effects treat it as one object
  PETALS.forEach(({ R, tube, arc, rot }) => {
    const m = new THREE.Mesh(makePetalGeo(R, tube, arc), glassMat);
    m.rotation.set(rot[0], rot[1], rot[2]);
    glassGroup.add(m);
  });
  glassGroup.scale.setScalar(Number.isFinite(GL.scale) && GL.scale ? GL.scale : 1);
  const glPos = Array.isArray(GL.position) ? GL.position : [0, 0, 0];
  glassGroup.position.set(glPos[0] || 0, glPos[1] || 0, glPos[2] || 0);
  const glRot = Array.isArray(GL.rotationOffset) ? GL.rotationOffset : [0, 0, 0];
  glassRotBase = { x: (glRot[0] || 0) * DEG, y: (glRot[1] || 0) * DEG, z: (glRot[2] || 0) * DEG };
  glassGroup.rotation.set(glassRotBase.x, glassRotBase.y, glassRotBase.z);
  scene.add(glassGroup);
}

// ── Diffusion Camera composer (Phase B, "Interrupted export recovery" —
// STUDIO-DETERMINISTIC-FINAL-RENDER-SONNET-HANDOFF.md). Verbatim port of
// ClothStudio.jsx's two-pass finishing chain — RenderPass (renders the raw
// linear scene into a depth-attached target) -> diffusionPass (samples that
// scene, applies the Diffusion Camera depth-of-field blur, OWNS tone-map +
// sRGB encode is deliberately NOT done here — see DIFFUSION_SHADER's own
// tap() comment) -> treatmentPass (tone-maps + sRGB-encodes + is the chain's
// real OUTPUT pass, renderToScreen:true) — using the vendored, byte-
// identical shader source and the exact official EffectComposer/RenderPass/
// ShaderPass classes, never a reimplementation.
//
// ── Composer-activation decision (this phase) ──────────────────────────────
// The composer is constructed and used ONLY when THIS recipe's
// diffusionCamera.enabled is true — never unconditionally. Rationale: 'fx'
// stays capability-gated (CAPABILITY_CHECKS, art-render-validation.mjs), so
// EVERY recipe that reaches this renderer already has bloom off, grain/
// vignette at 0, and treatment 'none' — there is no supported recipe state
// where diffusionCamera is OFF but the composer chain would produce a
// visually different result than the existing direct renderer.render(scene,
// camera) call (three's own tonemap+sRGB-encode pipeline already applies
// identically either way — see below). Building the composer unconditionally
// would only add GPU memory + a redundant render pass for zero visual
// benefit on every non-diffusion render, and would put every one of the
// 260+ pre-existing frame-hash/pixel-exact tests in this suite at risk for
// no reason. The diffusion-OFF path is therefore BYTE-IDENTICAL to before
// this phase — unchanged code, unchanged output.
//
// Why this is honest (not "wired to reproduce a bug"): three.js's own
// WebGLProgram decides whether to compile in the toneMapping()/
// linearToOutputTexel() GLSL chunks per-draw-call based on
// material.toneMapped && currentRenderTarget === null (screen) vs an
// offscreen render target — the EXACT mechanism DIFFUSION_SHADER/
// TREATMENT_SHADER's own header comments describe. A direct
// renderer.render(scene, camera) call and the treatmentPass's fullscreen
// quad draw (both ultimately rendering to the same canvas/renderTarget:null
// destination, through the same renderer with the same toneMapping/
// outputColorSpace settings) receive the IDENTICAL automatic tonemap+encode
// treatment from three itself — nothing here reimplements or approximates
// that pipeline. The only thing genuinely different about the composer path
// is the Diffusion Camera blur DIFFUSION_SHADER itself adds — which is
// exactly the point of building it only when that feature is requested.
const DIFFUSION_ON = Boolean(RECIPE.diffusionCamera && RECIPE.diffusionCamera.enabled === true);
// The Background card's diffusion opt-out (bgFx.diffusion — Phase B: was
// documented as carried-but-inert, never actually normalized by
// art-recipe.mjs until this phase; see that module's own comment).
const BG_FX = RECIPE.bgFx || {};
// The one glass-petal-sphere PRIMARY element id, duplicated here as a
// literal — art-recipe.mjs's own PRIMARY_ELEMENT_ID export is Node-only;
// this browser-generated page can't import it. Cross-checked against the
// real source by __tests__/diffusion-camera-vendor.test.mjs.
const DIFFUSION_PRIMARY_ELEMENT_ID = 'glass-petal-sphere-1';

let diffusionComposer = null;
let diffusionPass = null;
let treatmentPass = null;
let diffuseTarget = null;
const focusScratchVec = new THREE.Vector3();

if (DIFFUSION_ON) {
  // Depth-attachment-free diffuseTarget (verbatim ClothStudio.jsx trap
  // fix, see runFxFinishChain's own comment there): diffusionPass READS
  // fxDepth for its CoC calc while writing color output — writing that
  // output into a target that ALSO carries fxDepth as its own depth
  // attachment is a genuine WebGL rendering-feedback-loop (confirmed live
  // on the client: draws GL_INVALID_OPERATION and silently no-ops, leaving
  // the canvas cleared/black). fxTarget/fxDepth (composer's own ping-pong
  // buffers) and diffuseTarget are therefore two SEPARATE targets.
  const fxTarget = new THREE.WebGLRenderTarget(${canvasWidth}, ${canvasHeight}, {
    type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat,
  });
  const fxDepth = new THREE.DepthTexture(${canvasWidth}, ${canvasHeight});
  fxTarget.depthTexture = fxDepth;
  diffusionComposer = new EffectComposer(renderer, fxTarget);
  // Force renderTarget2 (composer's OWN clone of fxTarget) to share the
  // SAME fxDepth instance as renderTarget1 — WebGLRenderTarget.clone()
  // would otherwise clone the depth texture too, leaving renderTarget2 with
  // a DIFFERENT depth texture than the one diffusionPass reads as tDepth.
  diffusionComposer.renderTarget2.depthTexture?.dispose();
  diffusionComposer.renderTarget2.depthTexture = fxDepth;
  diffusionComposer.setSize(${canvasWidth}, ${canvasHeight});
  diffusionComposer.renderToScreen = false;
  const renderPass = new RenderPass(scene, camera);
  diffusionComposer.addPass(renderPass);
  // No bloomPass: bloom stays capability-gated ('fx'), so every recipe that
  // reaches here already has fx.bloom:false — adding a disabled pass would
  // cost real construction/vendoring for zero effect.

  diffuseTarget = new THREE.WebGLRenderTarget(${canvasWidth}, ${canvasHeight}, {
    type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat,
    depthBuffer: false,
  });
  diffusionPass = new ShaderPass(DIFFUSION_SHADER);
  diffusionPass.renderToScreen = false;
  diffusionPass.uniforms.tDepth.value = fxDepth;
  diffusionPass.uniforms.uFrameCenter.value = new THREE.Vector2(0.5, 0.5);
  diffusionPass.uniforms.uFrameHalf.value = new THREE.Vector2(0.5, 0.5);
  diffusionPass.uniforms.uRes.value = new THREE.Vector2(${canvasWidth}, ${canvasHeight});

  treatmentPass = new ShaderPass(TREATMENT_SHADER);
  treatmentPass.renderToScreen = true;
  treatmentPass.uniforms.tDepth.value = fxDepth;
  treatmentPass.uniforms.uFrameCenter.value = new THREE.Vector2(0.5, 0.5);
  treatmentPass.uniforms.uRes.value = new THREE.Vector2(${canvasWidth}, ${canvasHeight});
  // TREATMENT_SHADER's own uColA/uColB uniform defaults are {value:null} —
  // ShaderPass/UniformsUtils.clone() copies null through as null, it never
  // instantiates a THREE.Color; verbatim client construction
  // (ClothStudio.jsx assigns real THREE.Color instances here too, before
  // any later .setStyle() call).
  treatmentPass.uniforms.uColA.value = new THREE.Color();
  treatmentPass.uniforms.uColB.value = new THREE.Color();
  // Verbatim client defaults (fx.colA/colB — DEFAULT_FX in ClothStudio.jsx);
  // 'fx' stays capability-gated, so a supported recipe's own fx.colA/colB
  // are ALWAYS these defaults, but reading the real recipe values (rather
  // than hardcoding) keeps this honest under allowUnsupportedFeatures:true
  // test-only renders too. LinearSRGBColorSpace matches the client's own
  // setStyle call exactly — treatments run in display space, so ink/paper
  // colours must stay as-authored, not sRGB->linear converted.
  const fxColA = (RECIPE.fx && RECIPE.fx.colA) || '#101014';
  const fxColB = (RECIPE.fx && RECIPE.fx.colB) || '#f4f1ea';
  treatmentPass.uniforms.uColA.value.setStyle(fxColA, THREE.LinearSRGBColorSpace);
  treatmentPass.uniforms.uColB.value.setStyle(fxColB, THREE.LinearSRGBColorSpace);
  treatmentPass.uniforms.uCleanAlphaHole.value = 0; // no live device screen exists server-side
  treatmentPass.uniforms.uT1.value = (RECIPE.fx && RECIPE.fx.t1) || 0;
  treatmentPass.uniforms.uT2.value = (RECIPE.fx && RECIPE.fx.t2) || 0;
  treatmentPass.uniforms.uT3.value = (RECIPE.fx && RECIPE.fx.t3) || 0;

  // Frame-center (Capture Frame parity — verbatim syncFrameUniforms):
  // FRAME_RENDER.cropRect IS computeFrameRect(sourceWidth, sourceHeight,
  // targetWidth/targetHeight) already (art-scene-def.mjs resolveFrameRender
  // calls the SAME function client's syncFrameUniforms does), so this is
  // the exact same formula applied to the exact same inputs.
  if (FRAME_RENDER) {
    const cropRect = FRAME_RENDER.cropRect;
    const sw = FRAME_RENDER.sourceWidth, sh = FRAME_RENDER.sourceHeight;
    const cx = (cropRect.x + cropRect.w / 2) / sw;
    const cy = 1 - (cropRect.y + cropRect.h / 2) / sh;
    diffusionPass.uniforms.uFrameCenter.value.set(cx, cy);
    diffusionPass.uniforms.uFrameHalf.value.set((cropRect.w / 2) / sw, (cropRect.h / 2) / sh);
    treatmentPass.uniforms.uFrameCenter.value.set(cx, cy);
  }
}

// Resolves a focal target id to its CURRENT world position — the imperative
// half of diffusion-focus.js's pure resolution logic, needing this page's
// live scene graph (verbatim ClothStudio.jsx's own
// world.resolveDiffusionFocusWorldPosition). \`targetId\` is assumed ALREADY
// validated by resolveFocalTargetId; this only resolves a position for a
// target already known to be real, still defensively returning null (never
// throwing) if the expected object happens to be absent.
function resolveDiffusionFocusWorldPosition(targetId) {
  if (targetId === DIFFUSION_FOCAL_ORIGIN) return focusScratchVec.set(0, 0, 0);
  if (targetId === DIFFUSION_FOCAL_PRIMARY_ARTWORK) {
    const obj = (tshirtEntry && tshirtEntry.root) || (deviceEntry && deviceEntry.root) || clothMesh;
    if (!obj) return null;
    return obj.getWorldPosition(focusScratchVec);
  }
  if (targetId === DIFFUSION_PRIMARY_ELEMENT_ID) {
    if (!glassGroup) return null;
    return glassGroup.getWorldPosition(focusScratchVec);
  }
  // Every other id would name an extraInstances element — data-only /
  // capability-gated server-side (a normalized recipe's extraInstances is
  // always empty here), so no live object can ever exist for it. Matches
  // what resolveFocalTargetId's own elementInstances:[] fallback already
  // guarantees upstream — this is defense in depth, never reached in
  // practice for a genuinely-created job.
  return null;
}

// Syncs every diffusionPass/treatmentPass uniform from the CURRENT frame's
// state (verbatim client render-loop mapping) and refreshes
// window.__diffusionInspection. Called once synchronously right after
// composer construction (the pre-frame-zero baseline — same pattern
// __glassInspection's rotation baseline uses) and again inside
// __renderFrame after every captured frame's own position/rotation updates,
// so a moving focal target (e.g. rotating glass) stays in focus exactly
// like the live scene.
function syncDiffusionUniforms() {
  const dc = RECIPE.diffusionCamera;
  diffusionPass.uniforms.uDiffusionEnabled.value = 1;
  // 'fx' stays capability-gated, so RECIPE.fx.vignette is always 0 for a
  // genuinely-created job — read the real value anyway (never hardcoded)
  // so this stays honest under allowUnsupportedFeatures:true test renders.
  diffusionPass.uniforms.uVignette.value = (RECIPE.fx && RECIPE.fx.vignette) || 0;
  diffusionPass.uniforms.uBgDiffusion.value = BG_FX.diffusion === false ? 0 : 1;
  diffusionPass.uniforms.uNear.value = camera.near;
  diffusionPass.uniforms.uFar.value = camera.far;

  let resolvedFocalTargetId;
  let focusDistance;
  if (dc.focalTarget === DIFFUSION_FOCAL_MANUAL) {
    resolvedFocalTargetId = DIFFUSION_FOCAL_MANUAL;
    focusDistance = dc.focusDistance;
  } else {
    resolvedFocalTargetId = resolveFocalTargetId(dc.focalTarget, {
      glassOn: GL.on === true,
      primaryArtworkAvailable: Boolean(tshirtEntry || deviceEntry || clothMesh),
      elementInstances: RECIPE.extraInstances || [],
      primaryElementId: DIFFUSION_PRIMARY_ELEMENT_ID,
    });
    const worldPos = resolveDiffusionFocusWorldPosition(resolvedFocalTargetId) || focusScratchVec.set(0, 0, 0);
    camera.updateMatrixWorld();
    focusDistance = cameraSpaceForwardDistance(camera, worldPos);
  }
  diffusionPass.uniforms.uFocusDistance.value = focusDistance;
  diffusionPass.uniforms.uAperture.value = dc.aperture;
  diffusionPass.uniforms.uFalloff.value = dc.falloff;
  diffusionPass.uniforms.uDiffusionRadius.value = dc.diffusionRadius;
  diffusionPass.uniforms.uHighlightBloom.value = dc.highlightBloom;
  diffusionPass.uniforms.uForegroundBias.value = dc.foregroundBias;
  diffusionPass.uniforms.uBackgroundBias.value = dc.backgroundBias;

  // Exposed for tests only — exact resolved state, refreshed every call
  // (pre-frame-zero baseline, then after every captured frame).
  window.__diffusionInspection = {
    enabled: true,
    resolvedFocalTargetId,
    uniforms: {
      uFocusDistance: diffusionPass.uniforms.uFocusDistance.value,
      uAperture: diffusionPass.uniforms.uAperture.value,
      uFalloff: diffusionPass.uniforms.uFalloff.value,
      uDiffusionRadius: diffusionPass.uniforms.uDiffusionRadius.value,
      uHighlightBloom: diffusionPass.uniforms.uHighlightBloom.value,
      uForegroundBias: diffusionPass.uniforms.uForegroundBias.value,
      uBackgroundBias: diffusionPass.uniforms.uBackgroundBias.value,
      uBgDiffusion: diffusionPass.uniforms.uBgDiffusion.value,
      uVignette: diffusionPass.uniforms.uVignette.value,
      uNear: diffusionPass.uniforms.uNear.value,
      uFar: diffusionPass.uniforms.uFar.value,
      uDiffusionEnabled: diffusionPass.uniforms.uDiffusionEnabled.value,
    },
  };
}

window.__diffusionInspection = null;
if (DIFFUSION_ON) syncDiffusionUniforms();

// Exposed for tests only — proves clothAspect:'auto' actually computed a
// distinct (cw, ch) rather than silently falling back to portrait. null in
// T-shirt mode (no sheet exists at all — the no-hidden-sheet guarantee).
window.__clothDimensions = cloth ? { cw: cloth.cw, ch: cloth.ch } : null;

// Exposed for tests only — the exact shadow-pipeline state (Codex Slice-B/C
// P1 regression surface), read off the real renderer/light/mesh instances.
// cansGroup children alternate [light, target, ...] — child 0 is can 0.
const shadowCan0 = cansGroup.children[0];
window.__shadowInspection = {
  shadowMapEnabled: renderer.shadowMap.enabled,
  shadowMapIsPCFSoft: renderer.shadowMap.type === THREE.PCFSoftShadowMap,
  can0CastShadow: Boolean(shadowCan0 && shadowCan0.castShadow),
  can0ShadowMapSize: shadowCan0 && shadowCan0.shadow ? [shadowCan0.shadow.mapSize.x, shadowCan0.shadow.mapSize.y] : null,
  can0ShadowBias: shadowCan0 && shadowCan0.shadow ? shadowCan0.shadow.bias : null,
  can0ShadowNormalBias: shadowCan0 && shadowCan0.shadow ? shadowCan0.shadow.normalBias : null,
  clothCastShadow: Boolean(clothMesh && clothMesh.castShadow),
  clothBackCastShadow: Boolean(clothMeshBack && clothMeshBack.castShadow),
  groundReceiveShadow: ground.receiveShadow,
};

// Exposed for tests only — exact glass state read off the real instances
// (same pattern as __materialInspection below); null when glass is off.
window.__glassInspection = glassGroup ? {
  petalCount: glassGroup.children.length,
  roughness: glassGroup.children[0].material.roughness,
  transmission: glassGroup.children[0].material.transmission,
  attenuationColor: glassGroup.children[0].material.attenuationColor.getHexString(),
  scale: glassGroup.scale.x,
  position: [glassGroup.position.x, glassGroup.position.y, glassGroup.position.z],
  // Refreshed by __renderFrame after every captured frame — before frame
  // zero it is exactly the rotationOffset baseline in radians.
  rotation: [glassGroup.rotation.x, glassGroup.rotation.y, glassGroup.rotation.z],
} : null;

// Exposed for tests only — a lightweight, exact material-property snapshot
// (read directly off the real THREE.Material instances, not re-derived) so
// tests can assert precise values instead of relying only on differing
// frame hashes.
window.__materialInspection = {
  front: {
    roughness: material.roughness,
    clearcoat: material.clearcoat,
    bumpScale: material.bumpScale,
    bumpRepeat: [material.bumpMap.repeat.x, material.bumpMap.repeat.y],
    sheenRoughness: material.sheenRoughness,
    sheenColor: material.sheenColor.getHexString(),
    iridescenceIOR: material.iridescenceIOR,
    iridescenceThicknessRange: [...material.iridescenceThicknessRange],
    specularColor: material.specularColor.getHexString(),
    specularIntensity: material.specularIntensity,
  },
  back: {
    bumpRepeat: [backMaterial.bumpMap.repeat.x, backMaterial.bumpMap.repeat.y],
  },
};

// Renderer/shader warm-up — addresses the Slice 4b checkpoint's observed
// (once, unreproduced) cold-start anomaly, where the very first render in a
// freshly-launched headless page appeared not to reflect the scene's actual
// state. Renders the CURRENT (pre-simulation) frame repeatedly WITHOUT
// advancing physicsStep, forcing shader compilation/texture upload to
// happen before the real, captured frame sequence begins — the simulation
// clock a captured "frame 0" sees is therefore always physicsStep===0,
// regardless of how many warm-up renders preceded it.
window.__warmup = function warmup(times) {
  for (let i = 0; i < times; i += 1) {
    // Diffusion Camera (Phase B): warm up the SAME composer chain a
    // captured frame will run, so its own ShaderMaterial compiles ahead of
    // frame zero exactly like every other material here — the composer
    // path is otherwise the one render path this warm-up loop wouldn't
    // exercise at all.
    if (DIFFUSION_ON) {
      syncDiffusionUniforms();
      diffusionComposer.render();
      diffusionPass.render(renderer, diffuseTarget, diffusionComposer.readBuffer);
      treatmentPass.render(renderer, null, diffuseTarget);
    } else {
      renderer.render(scene, camera);
    }
  }
};

// Timeline device-scroll/posY tween (Phase C, "Interrupted export
// recovery"; corrected — "exact smoothstep-eased parity" checkpoint — a
// review found the FIRST pass's piecewise-LINEAR interpolation moved
// visibly differently from the live timeline preview, which eases every
// segment with smoothstep before lerping — app/dashboard/studio/timeline.js's
// own stepTimelinePlayback/blendRecipes call chain). TRUE REUSE, not a
// reimplementation: resolveTrackState (imported above from the vendored,
// byte-identical './timeline.js') is the EXACT SAME straddling-pair
// resolver the live client calls — sorted keys, clamp before-first/
// after-last, exactly-on-a-keyframe snap, duplicate-t "hold" keyframes
// (the camera-templates "parking" pattern) held via the same
// \`Math.max(1e-6, span)\` floor rather than a divide-by-zero, and the
// per-segment blend it returns is already smoothstep-eased. This function
// only does the final lerp of the two reduced scroll scalars
// (scrollPosition, posY) using that eased blend — exact at both endpoints
// (blend<=0 -> the \`from\` keyframe's own value, blend>=1 -> the \`to\`
// keyframe's own value) rather than trusting float arithmetic to land
// exactly there, same discipline as timeline.js's own blendOrbitPose.
// Returns null whenever no timeline is active — every call site below
// then falls back to RECIPE.devicePrimary's own static dial value, the
// same timelineOverride-or-liveRef fallback shape ClothStudio.jsx's own
// render loop uses.
function resolveTimelineScrollAt(frameIndex) {
  if (!TIMELINE) return null;
  const kfs = TIMELINE.keyframes;
  const total = TIMELINE.totalSeconds > 0 ? TIMELINE.totalSeconds : 1;
  const tFrame = (frameIndex + 1) / FPS;
  const u = Math.min(1, Math.max(0, tFrame / total));
  const state = resolveTrackState({ keyframes: kfs }, u);
  const a = kfs[state.fromIndex].scroll;
  const b = kfs[state.toIndex].scroll;
  const bl = state.blend;
  const lerp = (k) => (bl <= 0 ? a[k] : bl >= 1 ? b[k] : a[k] + (b[k] - a[k]) * bl);
  return { scrollPosition: lerp('scrollPosition'), posY: lerp('posY') };
}

// physicsStep counts TOTAL cloth-solver steps executed so far. Each
// captured frame advances it to its EXACT target cumulative step count —
// Math.round((frameIndex+1) * 60 / FPS) — never a fixed per-frame count, so
// a render's total elapsed simulated time depends only on fps*duration,
// never on fps alone (Codex re-review fix).
// async ONLY because of the live device screen: captured website frames are
// now decoded on demand (see ensureDeviceLiveFrame) instead of all being held
// resident, and a decode is inherently asynchronous. Every caller already
// awaits this (page.evaluate resolves the returned promise), and the awaited
// work is a pure decode of a fixed local file — no frame's rendered pixels
// depend on when it resolves, so determinism is untouched. Recipes without a
// live device screen never hit an await at all.
let physicsStep = 0;
window.__renderFrame = async function renderFrame(frameIndex) {
  const targetSteps = Math.round((frameIndex + 1) * 60 / FPS);
  while (physicsStep < targetSteps) {
    if (cloth) {
      stepCloth(cloth, RECIPE.phys, RECIPE.anim, physicsStep * PHYSICS_DT);
    } else if (tshirtEntry && tshirtInstance.motion.rotate) {
      // Codex Slice-E correction: the garment sim advances by calling the
      // exported stepSim(..., SIM_DT) once per missing physics step on this
      // EXACT target-step schedule — never advanceSim(dt), whose
      // three-step catch-up cap is a live-preview affordance that silently
      // LOSES simulation time below 20fps. Same iterations (4) and grab
      // (null — interactive-only) as the live factory's own animate call.
      // motion.rotate false = MOTION off — the sim freezes exactly where it
      // is, verbatim tshirtAnimate.
      tshirtStepSim(tshirtEntry.root.userData.sim, tshirtParams, TSHIRT_SIM_DT, 4, null);
    }
    physicsStep += 1;
  }
  if (tshirtEntry) {
    // Per-captured-frame geometry sync — verbatim the tail of the factory's
    // own tshirtAnimate (position upload + recomputed normals).
    const { frontGeo, backGeo } = tshirtEntry.root.userData;
    frontGeo.attributes.position.needsUpdate = true;
    backGeo.attributes.position.needsUpdate = true;
    frontGeo.computeVertexNormals();
    backGeo.computeVertexNormals();
  }
  if (deviceEntry) {
    // Timeline scroll/posY (Phase C) — written BEFORE factory.animate,
    // exactly like ClothStudio.jsx's own render loop (the userData override
    // is set AFTER stepTimelinePlayback, read by deviceAnimate's own branch
    // order — AUTO SCROLL wins and ignores this override entirely,
    // unmodified here: deviceAnimate itself decides, this only ever SETS
    // the override). null (no active timeline) clears the override so
    // deviceAnimate falls back to RECIPE.devicePrimary's own dial value —
    // the same self-clearing contract the live scene relies on.
    const timelineScroll = resolveTimelineScrollAt(frameIndex);
    deviceEntry.root.userData.scrollPositionOverride = timelineScroll ? timelineScroll.scrollPosition : undefined;
    deviceEntry.root.position.y = deviceSeatY + (timelineScroll && Number.isFinite(timelineScroll.posY) ? timelineScroll.posY : (RECIPE.devicePrimary.posY || 0));
    if (window.__deviceInspection) {
      window.__deviceInspection.timelineScrollApplied = timelineScroll;
    }
    // Device sway/scroll — the factory's own deviceAnimate is a pure
    // function of absolute elapsed time (sin sway, smoothstep ping-pong
    // scroll; no dt integration, no randomness), so driving it with EXACT
    // frame time reproduces the live look deterministically at any fps —
    // the same exact-frame-time discipline as the glass auto-rotate.
    deviceEntry.factory.animate(deviceEntry.root, deviceInstance, (frameIndex + 1) / FPS, 0);
    // Live website frames (device-screen-live) — select + draw whichever
    // captured frame this OUTPUT frame maps to. Timeline-driven when a
    // timeline is active (scrollPosition directly selects the frame index —
    // "the straightforward version": a linear top-to-bottom capture, so
    // scrollPosition 0..1 maps onto captured-frame 0..last exactly like it
    // maps onto scroll-range 0..1 during capture); otherwise a simple
    // linear time-based pass across the WHOLE clip (this render's own
    // durationSeconds/fps, via TOTAL_FRAMES) — the pipeline's own default
    // scroll pacing (render.mjs's own SITE_SPEED:1 equivalent), reused
    // rather than re-derived. deviceAnimate above may have just mutated
    // whatever texture is currently on the screen material's \`.offset.y\`
    // (its own UV-pan scroll trick, meant for the single-tall-image capture
    // path) — the live-frames path never uses UV panning (each frame is a
    // full, separate image), so that offset is reset to (0,0) here.
    const ud = deviceEntry.root.userData;
    if (ud.screenLiveFrameCount) {
      const frameCount = ud.screenLiveFrameCount;
      let liveIdx;
      if (timelineScroll) {
        const sp = Math.min(1, Math.max(0, timelineScroll.scrollPosition));
        liveIdx = Math.round(sp * (frameCount - 1));
      } else {
        const u = (TOTAL_FRAMES && TOTAL_FRAMES > 1) ? frameIndex / (TOTAL_FRAMES - 1) : 0;
        liveIdx = Math.round(Math.min(1, Math.max(0, u)) * (frameCount - 1));
      }
      // The ONLY await in this function — one on-demand decode of the single
      // captured website frame this output frame maps to (a cache hit when
      // consecutive output frames share it). See ensureDeviceLiveFrame.
      await drawDeviceLiveFrame(liveIdx);
      if (ud.screenLiveTexture) ud.screenLiveTexture.offset.set(0, 0);
      if (window.__deviceInspection) window.__deviceInspection.liveFrameIndexApplied = liveIdx;
    }
  }
  // Glass auto-rotate — computed from EXACT frame time, never accumulated
  // through the 60Hz cloth steps (Codex glass-parity P2: at 24fps the
  // rounded step schedule alternates 3/2 steps per frame, which would give
  // alternating 50ms/33ms rotation increments instead of the uniform
  // 41.67ms a real frame clock has; the cloth solver NEEDS the rounded
  // 60Hz stepping for simulation fidelity, a rigid rotation does not).
  // rotation = rotationOffset baseline + rotSpeed*(0.5|0.17) rad/s × t,
  // t = (frameIndex+1)/FPS — identical to ClothStudio.jsx's raf integral
  // (linear in dt) at every captured timestamp, at ANY fps. Absolute
  // assignment (not +=), so the baseline is preserved exactly and no
  // floating-point accumulation drift is possible.
  if (glassGroup && GL.rotate) {
    const glassRotSpeed = Number.isFinite(GL.rotSpeed) ? GL.rotSpeed : 0.4;
    const tFrame = (frameIndex + 1) / FPS;
    glassGroup.rotation.z = glassRotBase.z + glassRotSpeed * 0.5 * tFrame;
    glassGroup.rotation.x = glassRotBase.x + glassRotSpeed * 0.17 * tFrame;
  }
  if (glassGroup && window.__glassInspection) {
    window.__glassInspection.rotation = [glassGroup.rotation.x, glassGroup.rotation.y, glassGroup.rotation.z];
  }
  // Diffusion Camera composer (Phase B) — resolve this frame's focal
  // target/uniforms AFTER every position/rotation update above (a moving
  // target, e.g. rotating glass, must resolve against ITS current-frame
  // transform), then run the exact two-pass RenderPass -> diffusionPass ->
  // treatmentPass chain. See this block's own construction-site comment for
  // the composer-activation decision (DIFFUSION_ON only) — the diffusion-
  // OFF branch below is the byte-unchanged direct render.
  if (DIFFUSION_ON) {
    syncDiffusionUniforms();
    diffusionComposer.render();
    diffusionPass.render(renderer, diffuseTarget, diffusionComposer.readBuffer);
    treatmentPass.render(renderer, null, diffuseTarget);
  } else {
    renderer.render(scene, camera);
  }
  // Blank-frame guard (black-frame race) — checked AFTER this frame's draw and
  // BEFORE its readback, so it covers a context lost before OR during this
  // frame. A lost context makes every draw a silent no-op and the canvas read
  // back pure black while the render still reports success; three.js's own
  // handler calls preventDefault(), so Chromium restores the context a few
  // seconds later and the clip quietly starts working mid-way. Measured on
  // this machine: the first 1920x1080 render launched right after a live-site
  // capture browser has run lost its context before frame zero and emitted 67
  // black frames before recovering, twice reproducibly. Refusing the frame is
  // the same discipline the sourced-screen paths already hold ("either it
  // genuinely renders its source or the render fails"), applied to the whole
  // frame. Deliberately fails the ENTIRE render rather than retrying here: the
  // frames already written during the loss are blank, and a fixed-timestep
  // sequence cannot be resumed part-way.
  if (glContextLostCount > 0) {
    throw new Error(
      'WebGL context was lost during frame capture (frame ' + frameIndex + '; ' + glContextLostCount + ' loss event(s), '
      + glContextRestoredCount + ' restore(s), currently '
      + (renderer.getContext().isContextLost() ? 'LOST' : 'restored')
      + '). Every frame drawn while the context was lost reads back blank, so this render is discarded rather than delivered black.',
    );
  }
  if (FRAME_RENDER) {
    const r = FRAME_RENDER.cropRect;
    const ctx2d = frameExportCanvas.getContext('2d');
    ctx2d.clearRect(0, 0, frameExportCanvas.width, frameExportCanvas.height);
    ctx2d.drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, frameExportCanvas.width, frameExportCanvas.height);
    return frameExportCanvas.toDataURL('image/png');
  }
  return canvas.toDataURL('image/png');
};

// Test-only (Capture Frame parity round): the FULL source stage as rendered
// for the LAST captured frame — lets a test prove the delivered frame is a
// pure region copy of the crop rect (decode both, compare the crop region's
// exact pixels) with no overlay/dim/label ever composited.
window.__captureSourceFrame = function captureSourceFrame() {
  return canvas.toDataURL('image/png');
};
window.__frameInspection = FRAME_RENDER ? {
  sourceWidth: FRAME_RENDER.sourceWidth,
  sourceHeight: FRAME_RENDER.sourceHeight,
  cropRect: FRAME_RENDER.cropRect,
  targetWidth: FRAME_RENDER.targetWidth,
  targetHeight: FRAME_RENDER.targetHeight,
} : null;

// Environment/IBL (Phase 5) — 'room' (or any id not in this map) is the
// built-in PROCEDURAL RoomEnvironment (PMREMGenerator.fromScene is fully
// synchronous, zero network/asset dependency — deterministic by
// construction, same reasoning ClothStudio.jsx's own setEnvironment uses it
// as the default/fallback). sunset/dusk/hall/night load a REAL local .hdr
// file (art-render.mjs copies exactly the one file this recipe's envId
// needs alongside this page — 127.0.0.1-only, never external network).
// Verbatim ClothStudio.jsx ENV_PRESETS' own url mapping (art-scene.mjs's
// header comment for this whole module documents why small constant lists
// like this are duplicated rather than imported). A \`Map\`, not a plain
// object — same "confirm each envId resolves only to its allowlisted local
// HDR asset" hardening as art-render.mjs's BUILTIN_ENV_HDR_ASSETS (see that
// constant's own comment for the full \`{}['__proto__']\` footgun this
// avoids): \`Map#get\` has no prototype-chain lookup, so an absent/malicious
// envId is ALWAYS \`undefined\`, never an inherited Object.prototype value.
const ENV_HDR_URLS = new Map([
  ['sunset', './venice_sunset_1k.hdr'],
  ['dusk', './qwantani_dusk_2_1k.hdr'],
  ['hall', './dancing_hall_1k.hdr'],
  ['night', './moonless_golf_1k.hdr'],
]);

/**
 * Resolves scene.environment before frame zero. envIntensity===0 means the
 * environment map contributes NOTHING to any material regardless of which
 * one would have loaded (material.envMapIntensity=0 above already makes
 * this exactly true) — skipped entirely rather than doing pointless asset
 * I/O for a value that can never be visible, same "genuinely inert, not
 * carried" discipline art-recipe.mjs's own normalizeScene docstring uses
 * for other fields. A real HDR load failure REJECTS (never silently
 * substitutes a different environment and calls it done) — a Final Render
 * must be exactly right, not "close enough"; ClothStudio.jsx's own live-
 * preview fallback-on-error is a UX choice for an interactive session, not
 * one this deterministic, must-match-exactly server pipeline should mirror.
 */
// GPU-resource disposal (fast-follow review, post-Environment/IBL-parity):
// PMREMGenerator allocates its OWN internal WebGL resources (a ping-pong
// render target, blur/cubemap/equirect materials — see three.js's own
// PMREMGenerator.dispose()) separate from the OUTPUT render target/texture
// it returns; disposing the generator does NOT touch that output texture,
// which is exactly why it's safe to call pmrem.dispose() right after
// extracting \`.texture\` and keep using the texture for the rest of the
// render (the same pattern three.js's own official examples use). The
// try/finally guarantees this runs even if the RGBE load/decode throws
// partway through. The raw equirectangular HDR texture (\`hdr\`) is disposed
// the moment PMREM has converted it — never held onto once its one-time
// conversion is done.
//
// Cross-job accumulation: NOT POSSIBLE today regardless of in-page
// disposal discipline — art-render.mjs launches a FRESH \`chromium.launch()\`
// process per render and unconditionally \`browser.close()\`s it in its own
// finally block (never a pooled/reused browser or page across jobs), so
// every GPU/WebGL resource this whole page ever allocated is released by
// the OS process teardown after each render regardless. The disposal here
// is still correct practice (bounds PEAK memory within one render, and
// keeps this code trivially safe if a future change ever did introduce
// browser/page pooling) — not a fix for a currently-real leak.
// A scene-mode pano plate overrides the envId environment entirely — the
// pano's own PMREM IBL becomes scene.environment so materials reflect the
// same room the scene stands in, exactly like ClothStudio.jsx's
// envOverriddenByPano. When that's the case, loading the envId HDR would be
// pointless work whose result is immediately overwritten — skip it.
const PANO_OVERRIDES_ENV = Boolean(RECIPE.bgMode === 'scene' && EFFECTIVE_SCENE && EFFECTIVE_SCENE.panoLocal);

async function setupEnvironment() {
  if (PANO_OVERRIDES_ENV) return;
  if (RECIPE.envIntensity === 0) return;
  const pmrem = new THREE.PMREMGenerator(renderer);
  try {
    const hdrUrl = ENV_HDR_URLS.get(RECIPE.envId);
    if (!hdrUrl) {
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      return;
    }
    const hdr = await new RGBELoader().loadAsync(hdrUrl);
    scene.environment = pmrem.fromEquirectangular(hdr).texture;
    hdr.dispose();
  } finally {
    pmrem.dispose();
  }
}

/**
 * Scene-mode ASYNC assets, all resolved before frame zero (Slice B/C —
 * "load all required assets before frame zero"): the 360° pano plate
 * (HDR via RGBELoader, webp via TextureLoader+SRGB) applied as a true
 * equirect sky with blur/intensity/rotationY and matched PMREM IBL, and the
 * ground texture map/rough pair with the surface's own repeat + anisotropy.
 * A load failure REJECTS the whole ready-gate — a Final Render must be
 * exactly right, never a silent procedural-only downgrade (same discipline
 * as setupEnvironment above).
 */
async function setupSceneBackground() {
  if (!(RECIPE.bgMode === 'scene' && EFFECTIVE_SCENE)) return;
  const sc = EFFECTIVE_SCENE;
  if (sc.panoLocal) {
    let raw;
    if (/\\.hdr$/i.test(sc.panoLocal)) {
      raw = await new RGBELoader().loadAsync(sc.panoLocal);
    } else {
      raw = await new THREE.TextureLoader().loadAsync(sc.panoLocal);
      raw.colorSpace = THREE.SRGBColorSpace;
    }
    raw.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = raw;
    scene.backgroundBlurriness = sc.panoBlur || 0;
    scene.backgroundIntensity = sc.panoIntensity ?? 1;
    if (scene.backgroundRotation) scene.backgroundRotation.set(0, ((sc.panoRotY || 0) * Math.PI) / 180, 0);
    // Matched IBL from the same plate — overrides the envId environment
    // (see PANO_OVERRIDES_ENV above). Generator disposed immediately after
    // extracting the output texture, same pattern as setupEnvironment.
    const pmrem = new THREE.PMREMGenerator(renderer);
    try {
      scene.environment = pmrem.fromEquirectangular(raw).texture;
    } finally {
      pmrem.dispose();
    }
  }
  if (sc.groundTexMapLocal) {
    const loader = new THREE.TextureLoader();
    const [map, rough] = await Promise.all([
      loader.loadAsync(sc.groundTexMapLocal),
      loader.loadAsync(sc.groundTexRoughLocal),
    ]);
    map.colorSpace = THREE.SRGBColorSpace;
    [map, rough].forEach((t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(sc.groundTexRepeat, sc.groundTexRepeat);
      t.anisotropy = 8;
    });
    ground.material.map = map;
    ground.material.roughnessMap = rough;
    ground.material.needsUpdate = true;
  }
}

/**
 * T-shirt front print (Slice E) — applyInstance above already fired the
 * factory's own race-guarded async print load (tshirtLoadLogo). This waits
 * for it to genuinely land before frame zero: logoUrlLoaded is set ONLY
 * on a successful decode, so a failed load times out and REJECTS the whole
 * ready-gate — a shirt that was supposed to carry the artwork never
 * silently renders blank (same never-silently-downgrade discipline as
 * setupEnvironment/setupSceneBackground).
 */
async function awaitTshirtPrint() {
  if (!tshirtEntry || !ARTWORK_URL) return;
  const deadlineMs = Date.now() + 30000;
  while (tshirtEntry.root.userData.logoUrlLoaded !== ARTWORK_URL) {
    if (Date.now() > deadlineMs) throw new Error('T-shirt front print failed to load before frame zero.');
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
}

/**
 * Pinned device-screen still (Slice F2) — applyInstance above already fired
 * the factory's own async capture-texture load (deviceSyncScreenTexture).
 * Success = userData.screenCaptureTexture installed as the live screen map.
 * The factory signals a FAILED load by resetting appliedScreenKey to null —
 * detected here and rejected immediately (with a timeout backstop), so a
 * pinned screen either genuinely renders its pinned content before frame
 * zero or the whole render fails. Never a silent placeholder.
 */
async function awaitDeviceScreenStill() {
  if (!deviceEntry || !SCREEN_STILL_URL) return;
  const ud = deviceEntry.root.userData;
  const deadlineMs = Date.now() + 30000;
  for (;;) {
    if (ud.screenCaptureTexture && ud.screenMaterial && ud.screenMaterial.map === ud.screenCaptureTexture) return;
    if (ud.appliedScreenKey === null) throw new Error('Pinned device-screen still failed to decode before frame zero.');
    if (Date.now() > deadlineMs) throw new Error('Pinned device-screen still did not finish loading before frame zero.');
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
}

// A 1x1 fully transparent GIF — assigned to an evicted frame's \`src\` below
// so Chromium drops that frame's decoded bitmap immediately (a plain
// reference drop leaves reclamation to GC timing, which is exactly what the
// memory ceiling below cannot rely on). Chosen over removeAttribute('src')
// / src='' because both can issue a real (failing) request and pollute the
// page console channel art-render.mjs watches; a data: URI never does.
const DEVICE_LIVE_FRAME_BLANK_SRC = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * Decodes captured live-website frame \`idx\` on demand and returns it, keeping
 * at most DEVICE_LIVE_FRAME_CACHE_LIMIT decoded frames resident (see
 * awaitDeviceLiveFrames' header for why holding them all is not an option).
 * Insertion-ordered Map = LRU: a hit is re-inserted to refresh its recency,
 * the oldest entry is evicted and explicitly blanked once the cache is over
 * its limit.
 *
 * A decode failure REJECTS with the offending frame index + URL named — a
 * sourced screen never silently renders a blank or a stale neighbouring
 * frame (same discipline as awaitDeviceScreenStill / awaitTshirtPrint).
 */
const DEVICE_LIVE_FRAME_CACHE_LIMIT = 4;
async function ensureDeviceLiveFrame(idx) {
  const ud = deviceEntry.root.userData;
  const cache = ud.screenLiveCache;
  const cached = cache.get(idx);
  if (cached) {
    cache.delete(idx);
    cache.set(idx, cached);
    return cached;
  }
  const url = DEVICE_LIVE_FRAME_URLS[idx];
  if (!url) throw new Error('Live device-screen frame ' + idx + ' is out of range (' + DEVICE_LIVE_FRAME_URLS.length + ' captured frames).');
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch (err) {
    throw new Error('Live device-screen frame ' + idx + ' (' + url + ') failed to decode: ' + ((err && err.message) || err));
  }
  // Evict BEFORE inserting, so DEVICE_LIVE_FRAME_CACHE_LIMIT is a true
  // ceiling on how many decoded frames exist at once rather than LIMIT+1.
  while (cache.size >= DEVICE_LIVE_FRAME_CACHE_LIMIT) {
    const oldestIdx = cache.keys().next().value;
    const oldest = cache.get(oldestIdx);
    cache.delete(oldestIdx);
    try { oldest.src = DEVICE_LIVE_FRAME_BLANK_SRC; } catch { /* best-effort release; the dropped reference still lets GC reclaim it */ }
  }
  cache.set(idx, img);
  if (cache.size > (ud.screenLiveResidentPeak || 0)) ud.screenLiveResidentPeak = cache.size;
  // Same "static baseline in the literal, refreshed live thereafter" pattern
  // as __deviceInspection.liveFrameIndexApplied (the literal is only built
  // after the ready gate, so this is a no-op for the frame-zero preload).
  if (window.__deviceInspection) window.__deviceInspection.liveFrameResidentPeak = ud.screenLiveResidentPeak;
  return img;
}

/**
 * Draws captured live-website frame \`idx\` into the device screen's dedicated
 * canvas texture — a plain full-canvas image blit (never a UV-repeat/offset
 * pan; that trick is the single-tall-image pinned-still mechanism's own,
 * genuinely different, screen source). Awaits that frame's decode first (see
 * ensureDeviceLiveFrame); the blit itself, and therefore every rendered
 * pixel, is unchanged from when every frame was decoded up front.
 */
async function drawDeviceLiveFrame(idx) {
  const ud = deviceEntry.root.userData;
  if (!ud.screenLiveCtx) return;
  const img = await ensureDeviceLiveFrame(idx);
  const c = ud.screenLiveCanvas;
  ud.screenLiveCtx.drawImage(img, 0, 0, c.width, c.height);
  ud.screenLiveTexture.needsUpdate = true;
}

/**
 * Live website frames on the device screen (STUDIO-DETERMINISTIC-FINAL-
 * RENDER-SONNET-HANDOFF.md checkpoint) — builds a dedicated canvas +
 * CanvasTexture sized to the REAL capture viewport (DEVICE_LIVE_VIEWPORT_PX,
 * so the image is never stretched/distorted) and installs it as the screen
 * material's map — overriding the factory's own placeholder/UV-pan capture
 * path entirely for this recipe (they are mutually exclusive screen sources;
 * a recipe that somehow carried both would have this one win, since it
 * applies last, in Promise.all order below — not a supported combination
 * either way).
 *
 * ONLY the frame the screen shows at frame zero is decoded here. Every
 * other captured frame is decoded on demand by ensureDeviceLiveFrame, which
 * keeps at most DEVICE_LIVE_FRAME_CACHE_LIMIT of them resident.
 *
 * WHY (measured, real hitloop.agency capture at 1440x900): this function
 * used to decode EVERY captured frame up front and retain all of them in one
 * array. A decoded 1440x900 bitmap is ~5MB, so a 5-second 30fps render (150
 * captured frames) pinned ~750MB of decoded image data inside the page. Past
 * roughly 24 frames the page hit its own resource ceiling and further
 * decodes rejected with "The source image cannot be decoded" — on files
 * independently verified byte-valid (every one of a failing 72-frame set
 * decoded cleanly through sharp). Because that rejection happened inside the
 * ready-gate's async chain, __sceneReady was never set and the only outward
 * symptom was art-render.mjs's 120s waitForFunction timeout. Batching the
 * up-front decodes (the previous mitigation) bounded decode CONCURRENCY but
 * not RETENTION, so it did not move the ceiling. The render loop only ever
 * needs the single frame the current output frame maps to, so nothing is
 * gained by holding the rest.
 *
 * A decode failure on ANY frame still fails the render loudly with that
 * frame named — at the ready-gate for frame zero's frame (Promise.all below
 * rejects, exactly as before), and mid-render for any later one (the
 * rejection propagates out of window.__renderFrame). Same "a sourced screen
 * must render its source or fail" discipline as awaitDeviceScreenStill
 * above; these are local files on disk by this point, not network fetches.
 */
async function awaitDeviceLiveFrames() {
  if (!deviceEntry || !DEVICE_LIVE_FRAME_URLS.length) return;
  const ud = deviceEntry.root.userData;
  ud.screenLiveCache = new Map();
  ud.screenLiveFrameCount = DEVICE_LIVE_FRAME_URLS.length;
  ud.screenLiveResidentPeak = 0;
  const vpPx = DEVICE_LIVE_VIEWPORT_PX || { width: 1440, height: 900 };
  const canvas2d = document.createElement('canvas');
  canvas2d.width = vpPx.width;
  canvas2d.height = vpPx.height;
  const ctx2d = canvas2d.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas2d);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  ud.screenLiveCanvas = canvas2d;
  ud.screenLiveCtx = ctx2d;
  ud.screenLiveTexture = tex;
  if (ud.screenMaterial) {
    if (ud.screenMaterial.map && ud.screenMaterial.map !== ud.screenTexture) ud.screenMaterial.map.dispose();
    ud.screenMaterial.map = tex;
    ud.screenMaterial.needsUpdate = true;
  }
  // The screen's pre-frame-zero content — captured frame 0, decoded and
  // blitted BEFORE __sceneReady, so the ready gate still genuinely means
  // "ready to render frame zero" and the warm-up renders that precede frame
  // zero see real captured content rather than an empty canvas. Frame zero
  // itself can select a different captured frame (a timeline's own
  // scrollPosition at t=0); __renderFrame awaits whichever frame it selects
  // before drawing, so no captured frame is ever rendered from a
  // not-yet-decoded image.
  await drawDeviceLiveFrame(0);
}

(async () => {
  // Environment + artwork + scene-background assets load in parallel —
  // independent assets, no ordering dependency between them (the pano's
  // environment override can never race setupEnvironment: when a pano is
  // present, setupEnvironment short-circuits entirely — see
  // PANO_OVERRIDES_ENV); all must resolve before frame zero (Promise.all
  // rejects the whole IIFE, and therefore never sets __sceneReady, if any
  // fails).
  const artworkPromise = ARTWORK_URL ? loadArtworkTexture(ARTWORK_URL) : Promise.resolve(null);
  const [tex] = await Promise.all([artworkPromise, setupEnvironment(), setupSceneBackground(), awaitTshirtPrint(), awaitDeviceScreenStill(), awaitDeviceLiveFrames()]);
  if (tex) {
    material.map = tex; material.needsUpdate = true;
    backMaterial.map = mirrorTex(tex); backMaterial.needsUpdate = true;
  }
  // Test-only T-shirt snapshot (Slice E) — read AFTER the print await, so
  // printReady reflects exactly what frame zero renders. The
  // sheet/no-hidden-sheet flags are the XOR regression surface.
  window.__tshirtInspection = tshirtEntry ? (() => {
    const ud = tshirtEntry.root.userData;
    const u = ud.logoUniforms;
    const meshes = ud.motion.children.filter((c) => c.isMesh);
    return {
      sheetBuilt: Boolean(cloth),
      vertexCount: ud.sim ? ud.sim.position.length / 3 : 0,
      printReady: u ? u.uHasLogo.value === 1 : false,
      printX: u ? u.uLogoX.value : null,
      printY: u ? u.uLogoY.value : null,
      printScale: u ? u.uLogoScale.value : null,
      printRotationRad: u ? u.uLogoRotation.value : null,
      printOpacity: u ? u.uLogoOpacity.value : null,
      backHasPrintShader: Boolean(meshes[1] && meshes[1].material.userData.logoUniforms),
      hangerVisible: Boolean(ud.hanger && ud.hanger.visible),
      frontCastShadow: Boolean(meshes[0] && meshes[0].castShadow),
      backCastShadow: Boolean(meshes[1] && meshes[1].castShadow),
    };
  })() : null;
  // Test-only device snapshot (Slice F1) — proves the shell rendered with
  // its deterministic placeholder and NOTHING else: screenKey '' means no
  // capture/upload source was ever resolved, placeholderActive means the
  // screen material's map IS the procedural placeholder texture the
  // factory's own rebuild installed.
  window.__deviceInspection = deviceEntry ? {
    sheetBuilt: Boolean(cloth),
    screenKey: deviceEntry.root.userData.appliedScreenKey ?? '',
    placeholderActive: Boolean(deviceEntry.root.userData.screenMaterial
      && deviceEntry.root.userData.screenMaterial.map === deviceEntry.root.userData.screenTexture),
    // Pinned still (Slice F2): true only when the decoded still texture IS
    // the live screen map (read after the ready-gate, so this reflects
    // exactly what frame zero renders).
    screenStillActive: Boolean(SCREEN_STILL_URL && deviceEntry.root.userData.screenCaptureTexture
      && deviceEntry.root.userData.screenMaterial
      && deviceEntry.root.userData.screenMaterial.map === deviceEntry.root.userData.screenCaptureTexture),
    screenRepeatY: deviceEntry.root.userData.screenRepeatY ?? null,
    // Live website frames (device-screen-live): true only when the decoded
    // live-frame canvas texture IS the live screen map (read after the
    // ready-gate, same pattern as screenStillActive above).
    liveFramesActive: Boolean(DEVICE_LIVE_FRAME_URLS.length && deviceEntry.root.userData.screenLiveTexture
      && deviceEntry.root.userData.screenMaterial
      && deviceEntry.root.userData.screenMaterial.map === deviceEntry.root.userData.screenLiveTexture),
    liveFrameCount: deviceEntry.root.userData.screenLiveFrameCount || 0,
    // Peak number of DECODED captured frames held resident at once — the
    // memory-ceiling regression surface (this used to be every captured
    // frame; it is now bounded by DEVICE_LIVE_FRAME_CACHE_LIMIT). Refreshed
    // by ensureDeviceLiveFrame, read back per render by art-render.mjs.
    liveFrameResidentPeak: deviceEntry.root.userData.screenLiveResidentPeak ?? null,
    positionY: deviceEntry.root.position.y,
    scale: deviceEntry.root.scale.x,
    swayOn: deviceInstance.motion.rotate,
    // Timeline (Phase C) — refreshed by __renderFrame after every captured
    // frame (same "static baseline before frame zero, live thereafter"
    // pattern __glassInspection.rotation uses); inspectScene never calls
    // __renderFrame, so this stays null there — see resolveTimelineScrollAt's
    // own header.
    timelineScrollApplied: null,
    // Which captured live frame __renderFrame last selected — refreshed
    // every frame, same pattern as timelineScrollApplied above.
    liveFrameIndexApplied: null,
  } : null;
  // Test-only scene-background snapshot (same pattern as
  // __materialInspection) — read AFTER every async asset has landed, so it
  // reflects exactly what frame zero will render.
  window.__sceneBackgroundInspection = RECIPE.bgMode === 'scene' && EFFECTIVE_SCENE ? {
    backgroundKind: scene.background && scene.background.isTexture ? (EFFECTIVE_SCENE.panoLocal ? 'pano' : 'backdrop') : 'none',
    backgroundBlurriness: scene.backgroundBlurriness || 0,
    backgroundIntensity: scene.backgroundIntensity ?? 1,
    backgroundRotationY: scene.backgroundRotation ? scene.backgroundRotation.y : 0,
    environmentIsPanoIbl: PANO_OVERRIDES_ENV,
    fogDensity: scene.fog ? scene.fog.density : null,
    groundVisible: ground.visible,
    groundY: ground.position.y,
    groundColor: ground.material.color.getHexString(),
    groundHasTexture: Boolean(ground.material.map),
    groundRepeat: ground.material.map ? ground.material.map.repeat.x : null,
  } : null;
  window.__sceneReady = true;
})();
</script>
</body>
</html>`;
}
