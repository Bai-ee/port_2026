// art-render.test.mjs — Slice 4c. Real headless Chromium + real local
// `ffmpeg`/`ffprobe` binaries — LOCAL only (127.0.0.1 static server, no
// external network, no Cloud Run, no GPU requirement, no billing). Slower
// than the pure-logic suites (each test renders and encodes at least one
// real short clip) — kept to a small resolution/duration to stay fast.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { normalizeArtSceneRecipe } from '../art-recipe.mjs';
import { renderArtScene, inspectScene, checkCapabilities, validateWithFfprobe, validateRenderParams, LIMITS, ArtRenderError, BUILTIN_ENV_HDR_ASSETS, _internals } from '../art-render.mjs';
import { FINAL_RENDER_PRESETS, getFinalRenderPreset } from '../art-render-validation.mjs';
import { resolveTrackState } from '../../../app/dashboard/studio/timeline.js';

// Small and fast, but non-trivial: exercises the full cloth-verlet + seeded-
// texture + lighting/camera path, real ffmpeg encode, real ffprobe validate.
const SMALL = { width: 240, height: 240, fps: 12, durationSeconds: 0.5 }; // 6 frames

// The literal normalized DEFAULT includes envIntensity:0.65, which is fully
// SUPPORTED (Phase 5 — environment/IBL is genuinely implemented, no
// capability gate at all), but loading/PMREM-processing a real environment
// on every single test in this file would slow the whole suite down for no
// reason when a test isn't actually about environment lighting. recipeFor
// merges envIntensity:0 by default (still overridable per-call) purely as a
// speed default — setupEnvironment() in art-scene.mjs short-circuits
// entirely at envIntensity:0, skipping all HDR/PMREM work. `rawRecipeFor`
// (below) is the escape hatch for tests that specifically need the
// untouched literal default (envIntensity:0.65, envId:'room' — still cheap,
// since 'room' needs no HDR file, only synchronous procedural PMREM).
function recipeFor(scene) {
  return normalizeArtSceneRecipe({ kind: 'art-scene-v2', schemaVersion: 1, scene: { envIntensity: 0, ...scene } }).recipe;
}
function rawRecipeFor(scene) {
  return normalizeArtSceneRecipe({ kind: 'art-scene-v2', schemaVersion: 1, scene }).recipe;
}

async function withTempOutDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'art-render-test-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('renders a real MP4 + poster locally, validated by ffprobe against the requested dimensions/fps/frame count', async () => {
  await withTempOutDir(async (outDir) => {
    const recipe = recipeFor({ mat: { baseColor: '#7dd3fc' }, lookSeed: 1 });
    const result = await renderArtScene({ recipe, ...SMALL, outDir });
    assert.equal(result.metadata.width, SMALL.width);
    assert.equal(result.metadata.height, SMALL.height);
    assert.equal(result.metadata.codec, 'h264');
    assert.equal(result.metadata.frameCount, 6);
    assert.equal(result.frameHashes.length, 6);
    const mp4 = await readFile(result.mp4Path);
    assert.ok(mp4.length > 1000, 'the MP4 must be a real, non-trivial file');
    const poster = await readFile(result.posterPath);
    assert.ok(poster.length > 500, 'the poster JPEG must be a real, non-trivial file');
  });
});

// ── Repeated independent-run determinism ────────────────────────────────────

test('repeated independent runs (3x) of the same recipe produce byte-identical frame hash sequences and identical ffprobe metadata', async () => {
  const recipe = recipeFor({ mat: { baseColor: '#123456', roughness: 0.4 }, phys: { pinMode: 'top-corners', rumple: 0.7 }, lookSeed: 99 });
  const runs = [];
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- deliberately sequential,
    // independent runs (each its own browser launch + encode), not a race.
    runs.push(await withTempOutDir((outDir) => renderArtScene({ recipe, ...SMALL, outDir })));
  }
  assert.deepEqual(runs[0].frameHashes, runs[1].frameHashes);
  assert.deepEqual(runs[1].frameHashes, runs[2].frameHashes);
  assert.deepEqual(runs[0].metadata, runs[1].metadata);
  assert.deepEqual(runs[1].metadata, runs[2].metadata);
});

test('consecutive frames within one run are NOT all identical (the cloth simulation genuinely animates)', async () => {
  await withTempOutDir(async (outDir) => {
    const recipe = recipeFor({ anim: { on: true, turbulence: 0.8, speed: 1.5 }, lookSeed: 5 });
    const result = await renderArtScene({ recipe, ...SMALL, outDir });
    assert.ok(new Set(result.frameHashes).size > 1, 'a static (non-animating) render would collapse every frame to one hash');
  });
});

// ── Recipe-driven behavior ───────────────────────────────────────────────────

test('two different recipes (different baseColor + seed) produce different frame-0 output; the same recipe reproduces it', async () => {
  const recipeA = recipeFor({ mat: { baseColor: '#ff0000' }, lookSeed: 1 });
  const recipeB = recipeFor({ mat: { baseColor: '#00ff00' }, lookSeed: 2 });
  const [a, b, aAgain] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe: recipeA, ...SMALL, durationSeconds: 1 / 12, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe: recipeB, ...SMALL, durationSeconds: 1 / 12, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe: recipeA, ...SMALL, durationSeconds: 1 / 12, outDir })),
  ]);
  assert.notEqual(a.frameHashes[0], b.frameHashes[0]);
  assert.equal(a.frameHashes[0], aAgain.frameHashes[0]);
});

// ── Renderer warm-up ─────────────────────────────────────────────────────────

test('warm-up frames never leak into the captured simulation: frame 0 is identical whether warmupFrames is 0 or 5', async () => {
  const recipe = recipeFor({ mat: { baseColor: '#7dd3fc' }, lookSeed: 7 });
  const [noWarmup, withWarmup] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe, ...SMALL, warmupFrames: 0, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe, ...SMALL, warmupFrames: 5, outDir })),
  ]);
  assert.deepEqual(noWarmup.frameHashes, withWarmup.frameHashes, 'warm-up must only exercise the render pipeline, never advance the physics clock the captured frames see');
});

// ── ffprobe validation genuinely rejects a mismatch ─────────────────────────

test('ffprobe validation rejects a real file against wrong expected dimensions/fps/frame count, never silently passing', async () => {
  await withTempOutDir(async (outDir) => {
    const recipe = recipeFor({ lookSeed: 3 });
    const result = await renderArtScene({ recipe, ...SMALL, outDir });

    // validateWithFfprobe is async now (Codex re-review round 3: runLocalBinary
    // uses a non-blocking spawn() instead of spawnSync so a heartbeat can keep
    // firing during it) — assert.rejects/doesNotReject, not throws/doesNotThrow.
    await assert.rejects(
      () => validateWithFfprobe({ mp4Path: result.mp4Path, expected: { ...SMALL, width: 999, frameCount: 6 } }),
      (err) => { assert.ok(err instanceof ArtRenderError); assert.match(err.message, /width/); return true; },
    );
    await assert.rejects(
      () => validateWithFfprobe({ mp4Path: result.mp4Path, expected: { ...SMALL, frameCount: 999 } }),
      (err) => { assert.match(err.message, /frameCount/); return true; },
    );
    await assert.rejects(
      () => validateWithFfprobe({ mp4Path: result.mp4Path, expected: { ...SMALL, fps: 999, frameCount: 6 } }),
      (err) => { assert.match(err.message, /fps/); return true; },
    );
    // A fully correct expectation must still pass (sanity — the assertions
    // above aren't just permanently broken).
    await assert.doesNotReject(() => validateWithFfprobe({ mp4Path: result.mp4Path, expected: { ...SMALL, frameCount: 6 } }));
  });
});

// ── FPS-independent simulation (Codex re-review, P1) ────────────────────────
// The cloth solver always advances at the fixed PHYSICS_DT=1/60 ClothStudio.jsx
// itself uses; the NUMBER of steps before each captured frame is computed
// from that frame's exact target simulated time, never a fixed per-frame
// count — so a 1-second render must reach the same 60 total physics steps
// (the same simulated time) regardless of fps.

test('a one-second render reaches the same simulation time at 24fps and 30fps: the final frame is byte-identical', async () => {
  const recipe = recipeFor({ phys: { pinMode: 'top-corners', rumple: 0.7 }, anim: { on: true, turbulence: 0.8, speed: 1.2 }, lookSeed: 11 });
  const dims = { width: 200, height: 200 };
  const [at24, at30] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe, ...dims, fps: 24, durationSeconds: 1, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe, ...dims, fps: 30, durationSeconds: 1, outDir })),
  ]);
  assert.equal(at24.frameHashes.length, 24);
  assert.equal(at30.frameHashes.length, 30);
  assert.equal(
    at24.frameHashes.at(-1), at30.frameHashes.at(-1),
    'both renders advance the cloth solver to exactly 60 total fixed-DT steps by their last frame — the same simulated time — regardless of how many frames that time was split across',
  );
});

test('a half-second render at 24fps and 30fps also reaches the same simulation time (not just at exactly 1 second)', async () => {
  const recipe = recipeFor({ phys: { pinMode: 'free-float', rumple: 0.4 }, anim: { on: true, turbulence: 0.5, speed: 0.8 }, lookSeed: 12 });
  const dims = { width: 200, height: 200, durationSeconds: 0.5 };
  const [at24, at30] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe, ...dims, fps: 24, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe, ...dims, fps: 30, outDir })),
  ]);
  assert.equal(at24.frameHashes.at(-1), at30.frameHashes.at(-1));
});

// ── clothAspect:'auto' (Codex re-review, P1) ────────────────────────────────
// Verbatim port of ClothStudio.jsx's own auto-shape branch: ratio clamped to
// [0.38, 2.6], ch = sqrt(1.92/ratio), cw = ch*ratio.

function expectedAutoDims(ratio) {
  const r = Math.min(2.6, Math.max(0.38, ratio));
  const ch = Math.sqrt(1.92 / r);
  return { cw: ch * r, ch };
}

test('clothAspect:auto with a real artworkRatio computes the exact expected (cw, ch), never falling back to portrait', async () => {
  for (const ratio of [2.0, 0.5, 1.0]) {
    const recipe = recipeFor({ clothAspect: 'auto', artworkRatio: ratio });
    // eslint-disable-next-line no-await-in-loop
    const { clothDimensions } = await inspectScene({ recipe });
    const expected = expectedAutoDims(ratio);
    assert.ok(Math.abs(clothDimensions.cw - expected.cw) < 1e-9, `ratio ${ratio}: cw`);
    assert.ok(Math.abs(clothDimensions.ch - expected.ch) < 1e-9, `ratio ${ratio}: ch`);
    assert.notDeepEqual(clothDimensions, { cw: 1.2, ch: 1.6 }, `ratio ${ratio} must not silently fall back to portrait`);
  }
});

test('clothAspect:auto produces DIFFERENT dimensions for different artworkRatio values', async () => {
  const wide = await inspectScene({ recipe: recipeFor({ clothAspect: 'auto', artworkRatio: 2.0 }) });
  const tall = await inspectScene({ recipe: recipeFor({ clothAspect: 'auto', artworkRatio: 0.5 }) });
  assert.notDeepEqual(wide.clothDimensions, tall.clothDimensions);
});

test('ratio is clamped to [0.38, 2.6] exactly like ClothStudio.jsx', async () => {
  const tooWide = await inspectScene({ recipe: recipeFor({ clothAspect: 'auto', artworkRatio: 99 }) });
  const clampedHigh = expectedAutoDims(2.6);
  assert.ok(Math.abs(tooWide.clothDimensions.cw - clampedHigh.cw) < 1e-9);

  const tooNarrow = await inspectScene({ recipe: recipeFor({ clothAspect: 'auto', artworkRatio: 0.01 }) });
  const clampedLow = expectedAutoDims(0.38);
  assert.ok(Math.abs(tooNarrow.clothDimensions.cw - clampedLow.cw) < 1e-9);
});

test('clothAspect:auto with no artworkRatio falls through to portrait — same edge case as ClothStudio.jsx, not a bug', async () => {
  const recipe = { ...recipeFor({ clothAspect: 'auto' }), artworkRatio: null };
  const { clothDimensions } = await inspectScene({ recipe });
  assert.deepEqual(clothDimensions, { cw: 1.2, ch: 1.6 });
});

// ── Artwork mapping (Codex re-review, P1) ───────────────────────────────────
// Both allowlisted artworkId values resolved to their real shipped assets,
// applied front/back exactly like ClothStudio.jsx's own mirrorTex.

test('brock and viva-program produce different frame output, and each reproduces independently', async () => {
  const brock = recipeFor({ artworkId: 'brock' });
  const viva = recipeFor({ artworkId: 'viva-program' });
  const TINY = { width: 200, height: 200, fps: 10, durationSeconds: 0.1 };
  const [a1, v1, a2, v2] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe: brock, ...TINY, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe: viva, ...TINY, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe: brock, ...TINY, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe: viva, ...TINY, outDir })),
  ]);
  assert.notEqual(a1.frameHashes[0], v1.frameHashes[0], 'brock and viva-program must produce visibly different output');
  assert.equal(a1.frameHashes[0], a2.frameHashes[0], 'brock must reproduce independently across separate runs');
  assert.equal(v1.frameHashes[0], v2.frameHashes[0], 'viva-program must reproduce independently across separate runs');
});

// ── Capability enforcement (Codex re-review, P2) ────────────────────────────
// Never silently return a successful Proof that omitted a requested-but-
// unsupported feature — reject by default, or explicitly report when the
// caller opts into a best-effort render.

test('checkCapabilities reports a fully-supported recipe as supported with an empty list', () => {
  const recipe = recipeFor({});
  assert.deepEqual(checkCapabilities(recipe), { supported: true, unsupportedFeatures: [] });
});

test('a recipe requesting Diffusion Camera is fully supported (Phase B) — the capability gate is gone', () => {
  const recipe = recipeFor({ diffusionCamera: { enabled: true } });
  assert.deepEqual(checkCapabilities(recipe), { supported: true, unsupportedFeatures: [] });
});

test('a recipe requesting extra catalog elements (extraInstances) is rejected by default, and explicitly reported when allowed', async () => {
  const recipe = recipeFor({ extraInstances: [{ id: 'kinetic-rings-1', type: 'kinetic-rings' }] });
  assert.equal(checkCapabilities(recipe).unsupportedFeatures.includes('extraInstances'), true);

  await assert.rejects(
    () => renderArtScene({ recipe, width: 100, height: 100, fps: 10, durationSeconds: 0.1 }),
    (err) => { assert.match(err.message, /extraInstances/); return true; },
  );

  await withTempOutDir(async (outDir) => {
    const result = await renderArtScene({ recipe, width: 100, height: 100, fps: 10, durationSeconds: 0.1, outDir, allowUnsupportedFeatures: true });
    assert.ok(result.capabilities.unsupportedFeatures.includes('extraInstances'));
  });
});

// ── Capability enforcement completion (Codex re-review round 2, P1) ───────
// Every normalized field this render pass does NOT implement must be
// capability-gated — the frame/crop overlay and the custom holographic
// material shader's 7 fields, in addition to the four already covered
// above. Environment/IBL (envId/envIntensity) is now fully implemented
// (Phase 5, STUDIO-DETERMINISTIC-FINAL-RENDER-SONNET-HANDOFF.md) — see the
// "Environment/IBL lighting (Phase 5)" section below for its own coverage,
// replacing the capability-rejection tests that used to live here.

test('the literal DEFAULT normalized recipe (envIntensity:0.65) is now genuinely supported — environment/IBL is implemented, not rejected', () => {
  const recipe = rawRecipeFor({});
  assert.equal(recipe.envIntensity, 0.65, 'sanity: the real normalized default is 0.65, not 0');
  const capabilities = checkCapabilities(recipe);
  assert.equal(capabilities.supported, true);
  assert.ok(!capabilities.unsupportedFeatures.includes('environment'));
});

test('no envIntensity/envId combination is ever reported unsupported under the "environment" feature', () => {
  for (const envIntensity of [0, 0.65, 1, 1.7, 2.5]) {
    for (const envId of ['room', 'sunset', 'dusk', 'hall', 'night', 'not-a-real-id']) {
      const recipe = recipeFor({ envIntensity, envId });
      // eslint-disable-next-line no-await-in-loop
      assert.ok(!checkCapabilities(recipe).unsupportedFeatures.includes('environment'), `envIntensity=${envIntensity} envId=${envId} must never be gated`);
    }
  }
});

// ── Environment/IBL lighting (Phase 5, STUDIO-DETERMINISTIC-FINAL-RENDER-
// SONNET-HANDOFF.md) — real PMREM-processed environment maps, not just a
// capability gate removed. envId:'room' is the built-in procedural
// RoomEnvironment (no file dependency); sunset/dusk/hall/night each load a
// real local .hdr file. envIntensity feeds material.envMapIntensity on
// both cloth materials, verbatim ClothStudio.jsx's own applyMatToWorld.

test('every BUILTIN_ENV_HDR_ASSETS file genuinely exists on disk (sanity — a mistyped path here would silently no-op copyEnvironmentAssets)', () => {
  for (const [envId, filePath] of BUILTIN_ENV_HDR_ASSETS) {
    assert.doesNotThrow(() => readFileSync(filePath), `${envId} -> ${filePath} must exist on disk`);
  }
});

// ── envId allowlist hardening (fast-follow review) — Map#get has no
// prototype-chain lookup, so a prototype-pollution-shaped envId can never
// resolve to an unintended value the way a plain-object `{}[envId]` lookup
// could (`{}['__proto__']`/`{}['constructor']`/`{}['toString']` are all
// truthy via the prototype chain, which would have defeated an `if
// (!hdrSrc) return` fallback for those exact keys).

test('BUILTIN_ENV_HDR_ASSETS is a Map, immune to prototype-chain keys — __proto__/constructor/toString/hasOwnProperty all resolve to undefined, exactly like any other unknown envId', () => {
  assert.ok(BUILTIN_ENV_HDR_ASSETS instanceof Map);
  for (const maliciousKey of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    assert.equal(BUILTIN_ENV_HDR_ASSETS.get(maliciousKey), undefined, `${maliciousKey} must not resolve to anything`);
  }
});

test('every value in BUILTIN_ENV_HDR_ASSETS is a real absolute path inside services/studio-render/assets/hdr/ — never reaching outside this service directory', () => {
  const serviceDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  for (const [envId, filePath] of BUILTIN_ENV_HDR_ASSETS) {
    assert.ok(path.isAbsolute(filePath), `${envId}'s path must be absolute`);
    assert.ok(filePath.startsWith(path.join(serviceDir, 'assets', 'hdr') + path.sep), `${envId} -> ${filePath} must live under services/studio-render/assets/hdr/`);
  }
});

test('an unrecognized/malicious envId submitted end-to-end through normalizeArtSceneRecipe always renders using the safe "room" fallback, never a prototype-chain value', async () => {
  for (const maliciousEnvId of ['__proto__', 'constructor', 'toString', '../../../etc/passwd']) {
    const recipe = recipeFor({ envId: maliciousEnvId, envIntensity: 1 });
    // eslint-disable-next-line no-await-in-loop
    assert.equal(recipe.envId, 'room', `art-recipe.mjs's own enum validation must already reject "${maliciousEnvId}"`);
    // eslint-disable-next-line no-await-in-loop
    await withTempOutDir(async (outDir) => {
      const result = await renderArtScene({ recipe, ...SMALL, outDir });
      assert.equal(result.frameHashes.length, 6, `"${maliciousEnvId}" must still render successfully (as the safe room fallback), never crash or hang`);
    });
  }
});

test('renders successfully with the default procedural room environment (no HDR file, real default envIntensity 0.65)', async () => {
  const recipe = rawRecipeFor({ mat: { baseColor: '#7dd3fc' } });
  assert.equal(recipe.envId, 'room');
  assert.equal(recipe.envIntensity, 0.65);
  await withTempOutDir(async (outDir) => {
    const result = await renderArtScene({ recipe, ...SMALL, outDir });
    assert.equal(result.frameHashes.length, 6);
    assert.equal(result.metadata.frameCount, 6);
  });
});

test('renders successfully with each real-HDR environment preset (sunset/dusk/hall/night)', async () => {
  for (const envId of ['sunset', 'dusk', 'hall', 'night']) {
    const recipe = recipeFor({ mat: { baseColor: '#7dd3fc' }, envId, envIntensity: 1.2 });
    // eslint-disable-next-line no-await-in-loop
    await withTempOutDir(async (outDir) => {
      const result = await renderArtScene({ recipe, ...SMALL, outDir });
      assert.equal(result.frameHashes.length, 6, `${envId} must render the full frame sequence`);
    });
  }
});

// Direct lightCans are strong by default (intensity*14 in art-scene.mjs) and
// would otherwise swamp/tonemap-clip any IBL difference into invisibility —
// all four off isolates envIntensity as the only light source, exactly like
// isolating one variable in a controlled experiment.
const ALL_LIGHT_CANS_OFF = [0, 1, 2, 3].map(() => ({ on: false, color: '#ffffff', intensity: 1, az: 0, el: 0 }));

test('envIntensity genuinely changes the rendered output (frame hashes differ from zero) — proves envMapIntensity is real, not inert', async () => {
  // 0 vs a moderate positive value, not two arbitrary positive values —
  // ACESFilmicToneMapping (verbatim ClothStudio.jsx's own renderer.toneMapping
  // setup) genuinely compresses/saturates a bright default RoomEnvironment's
  // contribution on a reflective material well before envIntensity reaches
  // 2.5, so e.g. 0.2-vs-2.5 can legitimately tonemap to the SAME byte output
  // — a real filmic-tonemapping property this faithfully reproduces from the
  // live Studio renderer, not a bug. off-vs-on is the meaningful, reliable
  // signal that the value is genuinely wired in, confirmed by direct
  // pixel-diff investigation before landing on this comparison.
  const off = recipeFor({ mat: { baseColor: '#7dd3fc', roughness: 0.2, metalness: 0.8 }, envId: 'room', envIntensity: 0, lightCans: ALL_LIGHT_CANS_OFF });
  const on = recipeFor({ mat: { baseColor: '#7dd3fc', roughness: 0.2, metalness: 0.8 }, envId: 'room', envIntensity: 1, lightCans: ALL_LIGHT_CANS_OFF });
  const [offResult, onResult] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe: off, ...SMALL, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe: on, ...SMALL, outDir })),
  ]);
  assert.notEqual(offResult.frameHashes[0], onResult.frameHashes[0], 'envIntensity:0 vs a real positive value must produce visibly different output');
});

test('different envId values at the same nonzero envIntensity genuinely change the rendered output', async () => {
  const room = recipeFor({ mat: { baseColor: '#7dd3fc', roughness: 0.15, metalness: 0.9 }, envId: 'room', envIntensity: 1.5 });
  const sunset = recipeFor({ mat: { baseColor: '#7dd3fc', roughness: 0.15, metalness: 0.9 }, envId: 'sunset', envIntensity: 1.5 });
  const [roomResult, sunsetResult] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe: room, ...SMALL, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe: sunset, ...SMALL, outDir })),
  ]);
  assert.notEqual(roomResult.frameHashes[0], sunsetResult.frameHashes[0], 'the built-in room environment and a real loaded HDR must reflect differently on a highly reflective material');
});

test('envIntensity:0 is visually inert regardless of envId — identical output whether envId is room or a real HDR preset (matches the Studio interpretation: zero contribution)', async () => {
  const withRoom = recipeFor({ mat: { baseColor: '#7dd3fc', roughness: 0.15, metalness: 0.9 }, envId: 'room', envIntensity: 0 });
  const withSunset = recipeFor({ mat: { baseColor: '#7dd3fc', roughness: 0.15, metalness: 0.9 }, envId: 'sunset', envIntensity: 0 });
  const [roomResult, sunsetResult] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe: withRoom, ...SMALL, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe: withSunset, ...SMALL, outDir })),
  ]);
  assert.equal(roomResult.frameHashes[0], sunsetResult.frameHashes[0], 'envIntensity:0 must make envId irrelevant to the rendered pixels — an unused HDR was never even loaded');
});

test('repeated independent runs (3x) of the SAME environment-lit recipe (a real HDR, nonzero envIntensity) produce byte-identical frame hash sequences — determinism holds for IBL, not just physics', async () => {
  const recipe = recipeFor({ mat: { baseColor: '#a78bfa', roughness: 0.25, metalness: 0.7 }, envId: 'dusk', envIntensity: 1.8, phys: { pinMode: 'top-edge' }, lookSeed: 42 });
  const runs = await Promise.all(
    [1, 2, 3].map(() => withTempOutDir((outDir) => renderArtScene({ recipe, ...SMALL, outDir }))),
  );
  assert.deepEqual(runs[0].frameHashes, runs[1].frameHashes);
  assert.deepEqual(runs[1].frameHashes, runs[2].frameHashes);
  assert.deepEqual(runs[0].metadata, runs[1].metadata);
  assert.deepEqual(runs[1].metadata, runs[2].metadata);
});

test('a KNOWN frame is supported (Capture Frame parity round) but a frame render at the WRONG dimensions rejects precisely — dimensions are frame-owned, never caller-negotiated', async () => {
  const recipe = recipeFor({ frameId: 'square' });
  assert.equal(checkCapabilities(recipe).unsupportedFeatures.includes('frame'), false, 'the blanket frame gate is gone — frames genuinely render');
  await assert.rejects(
    () => renderArtScene({ recipe, width: 100, height: 100, fps: 10, durationSeconds: 0.1 }),
    (err) => { assert.match(err.message, /renders at exactly 1080×1080/); return true; },
  );
});

test('frameId:"off" (the default) is within the supported profile', () => {
  const recipe = recipeFor({ frameId: 'off' });
  assert.equal(checkCapabilities(recipe).unsupportedFeatures.includes('frame'), false);
});

test('any of the 7 custom-holographic-shader mat fields off its default is rejected by default and reported when allowed', async () => {
  for (const [field, offDefaultValue] of [['holoIntensity', 0.5], ['holoScale', 20], ['bandFreq', 1], ['saturation', 0.3], ['hueShift', 0.5], ['sparkle', 0.5], ['specTint', 0.2]]) {
    const recipe = recipeFor({ mat: { [field]: offDefaultValue } });
    const capabilities = checkCapabilities(recipe);
    // eslint-disable-next-line no-await-in-loop
    assert.ok(capabilities.unsupportedFeatures.includes('holographicMaterial'), `${field} off its default must be reported unsupported`);
    // eslint-disable-next-line no-await-in-loop
    await assert.rejects(
      () => renderArtScene({ recipe, width: 100, height: 100, fps: 10, durationSeconds: 0.1 }),
      (err) => { assert.match(err.message, /holographicMaterial/); return true; },
    );
  }
});

test('mat fields left at their exact defaults (holo* + baseColor/roughness/etc.) are within the supported profile', () => {
  const recipe = recipeFor({ mat: { baseColor: '#7dd3fc', roughness: 0.3, metalness: 0.7, bump: 1, bumpTiling: 5 } });
  assert.equal(checkCapabilities(recipe).unsupportedFeatures.includes('holographicMaterial'), false);
});

// ── Phase 0.5 gate-bug fix: clothShape/textLayers were previously dropped
// silently (never reached the normalized recipe, never gated) — a
// 'tshirt'/'device' scene rendered as the wrong flat-sheet shape, and hero
// text vanished with no warning. Both must now be rejected by default and
// explicitly reported when allowed, same discipline as every other gate.

test('clothShape "sheet" (the default) is within the supported profile', () => {
  const recipe = recipeFor({ clothShape: 'sheet' });
  assert.equal(checkCapabilities(recipe).unsupportedFeatures.includes('clothShape'), false);
});

test('clothShape "tshirt" (Slice E) and a source-free "device" (Slice F1) are supported; a SOURCED device screen still hard-rejects at render time', async () => {
  assert.equal(checkCapabilities(recipeFor({ clothShape: 'tshirt' })).unsupportedFeatures.includes('clothShape'), false, 'the T-shirt primary genuinely renders');
  assert.deepEqual(checkCapabilities(recipeFor({ clothShape: 'device' })).unsupportedFeatures, [], 'the bare device shell genuinely renders');

  const sourced = recipeFor({ clothShape: 'device', devicePrimary: { captureUrl: 'https://example.com' } });
  await assert.rejects(
    () => renderArtScene({ recipe: sourced, width: 100, height: 100, fps: 10, durationSeconds: 0.1 }),
    (err) => { assert.match(err.message, /device-screen-capture/); return true; },
  );
});

test('an unrecognized clothShape falls back to "sheet" (supported), not an unsupported passthrough value', () => {
  const recipe = recipeFor({ clothShape: 'not-a-real-shape' });
  assert.equal(recipe.clothShape, 'sheet');
  assert.equal(checkCapabilities(recipe).unsupportedFeatures.includes('clothShape'), false);
});

test('an empty/absent textLayers array is within the supported profile', () => {
  assert.equal(checkCapabilities(recipeFor({})).unsupportedFeatures.includes('textLayers'), false);
  assert.equal(checkCapabilities(recipeFor({ textLayers: [] })).unsupportedFeatures.includes('textLayers'), false);
});

test('a textLayers entry left ON (default) is rejected by default and reported when allowed — no text-compositing exists in this render pass yet', async () => {
  const recipe = recipeFor({ textLayers: [{ text: 'HEADLINE' }] }); // no explicit `on` -> defaults ON, same as DEFAULT_TEXT_LAYER.on
  assert.ok(checkCapabilities(recipe).unsupportedFeatures.includes('textLayers'));
  await assert.rejects(
    () => renderArtScene({ recipe, width: 100, height: 100, fps: 10, durationSeconds: 0.1 }),
    (err) => { assert.match(err.message, /textLayers/); return true; },
  );
  await withTempOutDir(async (outDir) => {
    const result = await renderArtScene({ recipe, width: 100, height: 100, fps: 10, durationSeconds: 0.1, outDir, allowUnsupportedFeatures: true });
    assert.ok(result.capabilities.unsupportedFeatures.includes('textLayers'));
  });
});

test('every textLayers entry explicitly off (on:false) is within the supported profile', () => {
  const recipe = recipeFor({ textLayers: [{ text: 'HEADLINE', on: false }, { text: 'SUBLINE', on: false }] });
  assert.equal(checkCapabilities(recipe).unsupportedFeatures.includes('textLayers'), false);
});

// ── bump/bumpTiling are genuinely rendered, not hardcoded (Codex re-review round 2 fix) ──

test('different mat.bump/mat.bumpTiling values genuinely change the rendered output', async () => {
  const low = recipeFor({ mat: { bump: 0, bumpTiling: 1 } });
  const high = recipeFor({ mat: { bump: 1.8, bumpTiling: 10 } });
  const TINY = { width: 200, height: 200, fps: 10, durationSeconds: 0.1 };
  const [a, b] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe: low, ...TINY, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe: high, ...TINY, outDir })),
  ]);
  assert.notEqual(a.frameHashes[0], b.frameHashes[0]);
});

// ── Native MeshPhysicalMaterial parity with ClothStudio.jsx (Codex re-review
// round 3, P1) — exact assertions via window.__materialInspection, not just
// differing frame hashes. ──────────────────────────────────────────────────

test('finish exactly reproduces ClothStudio.jsx\'s roughness/clearcoat formula for matte, satin, and glossy', async () => {
  const BASE_MAT = { roughness: 0.5, clearcoat: 0.8 };
  const [matte, satin, glossy] = await Promise.all([
    inspectScene({ recipe: recipeFor({ mat: { ...BASE_MAT, finish: 'matte' } }) }),
    inspectScene({ recipe: recipeFor({ mat: { ...BASE_MAT, finish: 'satin' } }) }),
    inspectScene({ recipe: recipeFor({ mat: { ...BASE_MAT, finish: 'glossy' } }) }),
  ]);
  assert.equal(matte.materialInspection.front.roughness, Math.max(0.5, 0.7));
  assert.equal(matte.materialInspection.front.clearcoat, 0.8 * 0.15);
  assert.equal(satin.materialInspection.front.roughness, Math.min(1, 0.5 + 0.28));
  assert.equal(satin.materialInspection.front.clearcoat, 0.8 * 0.5);
  assert.equal(glossy.materialInspection.front.roughness, 0.5, 'glossy leaves roughness unchanged');
  assert.equal(glossy.materialInspection.front.clearcoat, 0.8, 'glossy leaves clearcoat unchanged');
});

test('matte clamps a LOW roughness up to 0.7, and satin never exceeds 1 (the formula\'s own clamps, not just the multiplication)', async () => {
  const lowMatte = await inspectScene({ recipe: recipeFor({ mat: { roughness: 0.1, finish: 'matte' } }) });
  assert.equal(lowMatte.materialInspection.front.roughness, 0.7, 'max(0.1, 0.7) = 0.7');
  const highSatin = await inspectScene({ recipe: recipeFor({ mat: { roughness: 0.9, finish: 'satin' } }) });
  assert.equal(highSatin.materialInspection.front.roughness, 1, 'min(1, 0.9+0.28=1.18) clamps to 1');
});

test('bumpScale uses the exact ClothStudio.jsx constant: mat.bump * 0.014', async () => {
  for (const bump of [0, 0.5, 1, 2]) {
    // eslint-disable-next-line no-await-in-loop
    const { materialInspection } = await inspectScene({ recipe: recipeFor({ mat: { bump } }) });
    assert.equal(materialInspection.front.bumpScale, bump * 0.014);
  }
});

test('front and back bump textures are SEPARATE instances: front tiles [bumpTiling, bumpTiling], back tiles [-bumpTiling, bumpTiling]', async () => {
  const { materialInspection } = await inspectScene({ recipe: recipeFor({ mat: { bumpTiling: 6 } }) });
  assert.deepEqual(materialInspection.front.bumpRepeat, [6, 6]);
  assert.deepEqual(materialInspection.back.bumpRepeat, [-6, 6], 'back face must mirror X only, Y stays positive');
});

test('the fixed native material properties match ClothStudio.jsx exactly, regardless of recipe values', async () => {
  const { materialInspection } = await inspectScene({ recipe: recipeFor({ mat: { sheen: 0.3, iridescence: 0.6 } }) });
  assert.equal(materialInspection.front.sheenRoughness, 0.5);
  assert.equal(materialInspection.front.sheenColor, 'ffffff');
  assert.equal(materialInspection.front.iridescenceIOR, 1.3);
  assert.deepEqual(materialInspection.front.iridescenceThicknessRange, [120, 480]);
});

test('specularColor/specularIntensity match ClothStudio.jsx\'s native formula at the supported default profile: white and 1.0', async () => {
  const { materialInspection } = await inspectScene({ recipe: recipeFor({}) });
  assert.equal(materialInspection.front.specularColor, 'ffffff');
  assert.equal(materialInspection.front.specularIntensity, 1);
});

test('specularIntensity follows 0.4 + 0.6*specTint even off the default (native math, independent of the gated custom shader)', async () => {
  const { materialInspection } = await inspectScene({
    recipe: recipeFor({ mat: { specTint: 0.5 } }),
    allowUnsupportedFeatures: true, // specTint off-default trips the gated 'holographicMaterial' capability
  });
  assert.equal(materialInspection.front.specularIntensity, 0.4 + 0.6 * 0.5);
});

test('supported native-material recipes (varied finish/bump/sheen/iridescence, all within the supported profile) remain fully deterministic across independent renders', async () => {
  const recipe = recipeFor({ mat: { finish: 'satin', roughness: 0.4, clearcoat: 0.6, sheen: 0.5, iridescence: 0.4, bump: 1.2, bumpTiling: 5 } });
  const TINY = { width: 200, height: 200, fps: 10, durationSeconds: 0.1 };
  const [a, b] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe, ...TINY, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe, ...TINY, outDir })),
  ]);
  assert.deepEqual(a.frameHashes, b.frameHashes);
});

// ── Local render control validation (Codex re-review round 2, P2) ─────────

test('validateRenderParams rejects strings, NaN, Infinity, negatives, and zero for width/height/fps/durationSeconds/warmupFrames', () => {
  const BASE = { width: 200, height: 200, fps: 10, durationSeconds: 1, warmupFrames: 2 };
  const badValues = ['abc', NaN, Infinity, -Infinity, -1, 0, 1.5];
  for (const field of ['width', 'height', 'fps', 'durationSeconds']) {
    for (const bad of badValues) {
      if (field === 'durationSeconds' && bad === 1.5) continue; // 1.5 is a valid fractional duration
      if (field === 'fps' && bad === 1.5) continue; // fps may be fractional
      assert.throws(
        () => validateRenderParams({ ...BASE, [field]: bad }),
        ArtRenderError,
        `${field}=${JSON.stringify(bad)} must be rejected`,
      );
    }
  }
  for (const bad of ['abc', NaN, Infinity, -1, 1.5]) {
    assert.throws(() => validateRenderParams({ ...BASE, warmupFrames: bad }), ArtRenderError, `warmupFrames=${JSON.stringify(bad)} must be rejected`);
  }
});

test('validateRenderParams rejects excessive dimensions, fps, duration, and warmup values', () => {
  const BASE = { width: 200, height: 200, fps: 10, durationSeconds: 1, warmupFrames: 2 };
  assert.throws(() => validateRenderParams({ ...BASE, width: LIMITS.MAX_DIMENSION + 1 }), ArtRenderError);
  assert.throws(() => validateRenderParams({ ...BASE, height: LIMITS.MAX_DIMENSION + 1 }), ArtRenderError);
  assert.throws(() => validateRenderParams({ ...BASE, fps: LIMITS.MAX_FPS + 1 }), ArtRenderError);
  assert.throws(() => validateRenderParams({ ...BASE, durationSeconds: LIMITS.MAX_DURATION_SECONDS + 1 }), ArtRenderError);
  assert.throws(() => validateRenderParams({ ...BASE, warmupFrames: LIMITS.MAX_WARMUP_FRAMES + 1 }), ArtRenderError);
});

test('validateRenderParams rejects an excessive total frame count even when fps and duration are each individually valid', () => {
  // fps=60 (<= MAX_FPS) and durationSeconds=20 (<= MAX_DURATION_SECONDS) are
  // each individually fine, but their product (1200 frames) exceeds the
  // independent MAX_TOTAL_FRAMES cap (900) — proving that cap isn't just a
  // redundant restatement of the other two.
  assert.throws(
    () => validateRenderParams({ width: 100, height: 100, fps: 60, durationSeconds: 20, warmupFrames: 0 }),
    (err) => { assert.match(err.message, /Total frame count/); return true; },
  );
  // Sanity: a combo just under the cap succeeds and returns the exact count.
  const totalFrames = validateRenderParams({ width: 100, height: 100, fps: 30, durationSeconds: 10, warmupFrames: 0 });
  assert.equal(totalFrames, 300);
});

test('validateRenderParams rejects an excessive pixel-frame work budget even when every individual value is within its own cap', () => {
  // width/height at MAX_DIMENSION, fps=30, duration=30 → exactly 900 frames
  // (at, not over, MAX_TOTAL_FRAMES — so THAT check passes) — but
  // width*height*frames still blows the independent pixel-frame budget.
  assert.throws(
    () => validateRenderParams({ width: LIMITS.MAX_DIMENSION, height: LIMITS.MAX_DIMENSION, fps: 30, durationSeconds: 30, warmupFrames: 0 }),
    (err) => { assert.match(err.message, /pixel-frame work budget/); return true; },
  );
});

// ── Final Render presets (Phase 4) ─────────────────────────────────────────

test('every FINAL_RENDER_PRESETS entry passes validateRenderParams at Studio\'s own max duration option (15s)', () => {
  for (const preset of FINAL_RENDER_PRESETS) {
    const totalFrames = validateRenderParams({ width: preset.width, height: preset.height, fps: preset.fps, durationSeconds: 15, warmupFrames: 3 });
    assert.equal(totalFrames, preset.fps * 15, `${preset.id} must accept a real 15s render`);
  }
});

test('getFinalRenderPreset resolves a known id to its full definition, and returns null for an unknown/missing one', () => {
  const preset = getFinalRenderPreset('landscape-1080p-30');
  assert.deepEqual(preset, { id: 'landscape-1080p-30', label: '1080p Landscape · 30fps', width: 1920, height: 1080, fps: 30 });
  assert.equal(getFinalRenderPreset('not-a-real-preset'), null);
  assert.equal(getFinalRenderPreset(undefined), null);
  assert.equal(getFinalRenderPreset(''), null);
});

test('FINAL_RENDER_PRESETS has no 4K entry — deferred until Phase 6 canary evidence, per the handoff', () => {
  assert.ok(!FINAL_RENDER_PRESETS.some((p) => p.width >= 3840 || p.height >= 3840));
});

test('renderArtScene rejects bad render params before doing any real work (fast, synchronous-ish rejection)', async () => {
  await assert.rejects(
    () => renderArtScene({ recipe: recipeFor({}), width: 'not-a-number', height: 100, fps: 10, durationSeconds: 0.1 }),
    ArtRenderError,
  );
  await assert.rejects(
    () => renderArtScene({ recipe: recipeFor({}), width: 100, height: 100, fps: 10, durationSeconds: 0.1, warmupFrames: -1 }),
    ArtRenderError,
  );
});

// ── Process-lifecycle hardening (Slice 4f) ──────────────────────────────────
// Exercises _internals.runLocalBinary's timeout/SIGTERM/SIGKILL/reap-confirm
// policy and bounded-capture behavior directly, via the narrow
// `_internals.spawn` DI seam and a fully controllable fake child process —
// deterministic, no real hung ffmpeg/ffprobe binary needed.
// `_internals.PROCESS_TIMEOUTS_MS`/`_internals.KILL_GRACE_MS`/
// `_internals.REAP_CONFIRM_MS` are shrunk per-test (restored in `finally`) so
// these run in milliseconds, not minutes.

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killSignals = [];
  child.kill = (signal) => { child.killSignals.push(signal); return true; };
  return child;
}

// Races `promise` against a short delay to prove it has NOT settled yet,
// without ever leaving an unresolved dangling timer if the assertion runs
// after the process exits normally (the delay timer is always cleared).
async function assertStillPending(promise, ms) {
  const SENTINEL = Symbol('still-pending');
  const delay = new Promise((resolve) => { setTimeout(() => resolve(SENTINEL), ms); });
  const winner = await Promise.race([promise.then(() => 'settled', () => 'settled'), delay]);
  assert.equal(winner, SENTINEL, `expected the promise to still be pending after ${ms}ms`);
}

test('_internals.runLocalBinary resolves with the captured stdout on a clean exit (code 0)', async () => {
  const originalSpawn = _internals.spawn;
  const child = makeFakeChild();
  _internals.spawn = () => child;
  try {
    const promise = _internals.runLocalBinary('ffmpeg', ['-y'], 'ffmpeg');
    child.stdout.emit('data', Buffer.from('hello '));
    child.stdout.emit('data', Buffer.from('world'));
    child.emit('close', 0);
    assert.equal(await promise, 'hello world');
    assert.deepEqual(child.killSignals, [], 'a clean exit must never trigger any kill signal');
  } finally {
    _internals.spawn = originalSpawn;
  }
});

test('a nonzero exit code rejects with a typed ArtRenderError carrying the captured stderr', async () => {
  const originalSpawn = _internals.spawn;
  const child = makeFakeChild();
  _internals.spawn = () => child;
  try {
    const promise = _internals.runLocalBinary('ffmpeg', [], 'ffmpeg');
    child.stderr.emit('data', Buffer.from('boom'));
    child.emit('close', 1);
    await assert.rejects(promise, (err) => {
      assert.ok(err instanceof ArtRenderError);
      assert.match(err.message, /exited with status 1/);
      assert.equal(err.details.stderr, 'boom');
      return true;
    });
  } finally {
    _internals.spawn = originalSpawn;
  }
});

test('a synchronous spawn failure rejects immediately with a typed ArtRenderError', async () => {
  const originalSpawn = _internals.spawn;
  _internals.spawn = () => { throw new Error('ENOENT: no such binary'); };
  try {
    await assert.rejects(
      () => _internals.runLocalBinary('nonexistent-binary', [], 'ffmpeg'),
      (err) => { assert.ok(err instanceof ArtRenderError); assert.match(err.message, /failed to start/); return true; },
    );
  } finally {
    _internals.spawn = originalSpawn;
  }
});

test('an asynchronous child "error" event BEFORE any timeout rejects with a typed ArtRenderError', async () => {
  const originalSpawn = _internals.spawn;
  const child = makeFakeChild();
  _internals.spawn = () => child;
  try {
    const promise = _internals.runLocalBinary('ffmpeg', [], 'ffmpeg');
    child.emit('error', new Error('spawn EACCES'));
    await assert.rejects(promise, (err) => { assert.ok(err instanceof ArtRenderError); assert.match(err.message, /failed to start/); return true; });
  } finally {
    _internals.spawn = originalSpawn;
  }
});

test('a timeout sends SIGTERM, and a process that exits (close) inside the grace window settles as CONFIRMED without ever sending SIGKILL', async () => {
  const originalSpawn = _internals.spawn;
  const originalTimeouts = _internals.PROCESS_TIMEOUTS_MS;
  const originalGrace = _internals.KILL_GRACE_MS;
  const child = makeFakeChild();
  _internals.spawn = () => child;
  _internals.PROCESS_TIMEOUTS_MS = { ffmpeg: 20, ffprobe: 20 };
  _internals.KILL_GRACE_MS = 300;
  try {
    const promise = _internals.runLocalBinary('ffmpeg', [], 'ffmpeg');
    // Wait past the 20ms timeout so SIGTERM fires, well inside the 300ms grace window.
    await new Promise((r) => { setTimeout(r, 60); });
    assert.deepEqual(child.killSignals, ['SIGTERM']);
    child.emit('close', null, 'SIGTERM'); // Node's real close signature: (code, signal) — signal-terminated, THIS confirms it
    await assert.rejects(promise, (err) => {
      assert.ok(err instanceof ArtRenderError);
      assert.match(err.message, /timed out after 20ms/);
      assert.match(err.message, /terminated by SIGTERM/);
      assert.match(err.message, /confirmed/);
      assert.equal(err.details.timedOut, true);
      assert.equal(err.details.terminationConfirmed, true);
      assert.equal(err.details.terminationSignal, 'SIGTERM');
      assert.equal(err.details.exitCode, null);
      assert.equal(err.details.forceKilled, false, 'SIGTERM confirmed, not SIGKILL');
      assert.equal(err.details.sigkillAttempted, false, 'SIGKILL was never sent in this scenario');
      return true;
    });
    assert.deepEqual(child.killSignals, ['SIGTERM'], 'SIGKILL must never be sent once the process exits inside the grace window');
  } finally {
    _internals.spawn = originalSpawn;
    _internals.PROCESS_TIMEOUTS_MS = originalTimeouts;
    _internals.KILL_GRACE_MS = originalGrace;
  }
});

test('SIGTERM ignored → SIGKILL sent → a close arriving within the reap window CONFIRMS termination', async () => {
  const originalSpawn = _internals.spawn;
  const originalTimeouts = _internals.PROCESS_TIMEOUTS_MS;
  const originalGrace = _internals.KILL_GRACE_MS;
  const originalReap = _internals.REAP_CONFIRM_MS;
  const child = makeFakeChild(); // ignores SIGTERM — never closes until we say so
  _internals.spawn = () => child;
  _internals.PROCESS_TIMEOUTS_MS = { ffmpeg: 20, ffprobe: 20 };
  _internals.KILL_GRACE_MS = 20;
  _internals.REAP_CONFIRM_MS = 300;
  try {
    const promise = _internals.runLocalBinary('ffmpeg', [], 'ffmpeg');
    // Wait past timeout(20)+grace(20)=40ms so SIGKILL is sent, well inside the 300ms reap window.
    await new Promise((r) => { setTimeout(r, 70); });
    assert.deepEqual(child.killSignals, ['SIGTERM', 'SIGKILL']);
    // The promise must still be pending here — SIGKILL alone is not confirmation.
    await assertStillPending(promise, 40);
    child.emit('close', null, 'SIGKILL'); // the OBSERVED signal is what confirms it, not the mere attempt
    await assert.rejects(promise, (err) => {
      assert.ok(err instanceof ArtRenderError);
      assert.match(err.message, /terminated by SIGKILL/);
      assert.match(err.message, /confirmed/);
      assert.equal(err.details.forceKilled, true);
      assert.equal(err.details.terminationConfirmed, true);
      assert.equal(err.details.terminationSignal, 'SIGKILL');
      assert.equal(err.details.exitCode, null);
      assert.equal(err.details.sigkillAttempted, true);
      return true;
    });
  } finally {
    _internals.spawn = originalSpawn;
    _internals.PROCESS_TIMEOUTS_MS = originalTimeouts;
    _internals.KILL_GRACE_MS = originalGrace;
    _internals.REAP_CONFIRM_MS = originalReap;
  }
});

test('SIGTERM and SIGKILL both ignored (no close ever) → rejects as termination UNCONFIRMED once the reap deadline elapses, never claiming the process was killed', async () => {
  const originalSpawn = _internals.spawn;
  const originalTimeouts = _internals.PROCESS_TIMEOUTS_MS;
  const originalGrace = _internals.KILL_GRACE_MS;
  const originalReap = _internals.REAP_CONFIRM_MS;
  const child = makeFakeChild(); // never emits 'close' at all — a genuinely stuck/unreapable process
  _internals.spawn = () => child;
  _internals.PROCESS_TIMEOUTS_MS = { ffmpeg: 20, ffprobe: 20 };
  _internals.KILL_GRACE_MS = 20;
  _internals.REAP_CONFIRM_MS = 80;
  try {
    const promise = _internals.runLocalBinary('ffmpeg', [], 'ffmpeg');
    // Wait past timeout(20)+grace(20)=40ms so SIGKILL is sent, well before the
    // reap deadline (SIGKILL sent at ~40ms + 80ms reap = ~120ms).
    await new Promise((r) => { setTimeout(r, 70); });
    assert.deepEqual(child.killSignals, ['SIGTERM', 'SIGKILL']);
    await assertStillPending(promise, 30); // well before the reap deadline elapses
    await assert.rejects(promise, (err) => {
      assert.ok(err instanceof ArtRenderError);
      assert.match(err.message, /termination unconfirmed/);
      assert.doesNotMatch(err.message, /terminated by SIG/, 'must never claim confirmed termination it never observed');
      assert.equal(err.details.terminationConfirmed, false);
      assert.equal(err.details.terminationSignal, null);
      assert.equal(err.details.exitCode, null);
      assert.equal(err.details.forceKilled, false, 'unconfirmed must never claim forceKilled just because SIGKILL was attempted');
      assert.equal(err.details.sigkillAttempted, true);
      return true;
    });
    // A late 'close' arriving after settlement must be a harmless no-op —
    // listeners were already detached by settle(), so this must not throw.
    assert.doesNotThrow(() => child.emit('close', null, 'SIGKILL'));
  } finally {
    _internals.spawn = originalSpawn;
    _internals.PROCESS_TIMEOUTS_MS = originalTimeouts;
    _internals.KILL_GRACE_MS = originalGrace;
    _internals.REAP_CONFIRM_MS = originalReap;
  }
});

test('child.kill() returning false (signal not delivered) is handled explicitly, without crashing, and the escalation still proceeds', async () => {
  const originalSpawn = _internals.spawn;
  const originalTimeouts = _internals.PROCESS_TIMEOUTS_MS;
  const originalGrace = _internals.KILL_GRACE_MS;
  const originalReap = _internals.REAP_CONFIRM_MS;
  const child = makeFakeChild();
  child.kill = (signal) => { child.killSignals.push(signal); return false; }; // "not delivered", never throws
  _internals.spawn = () => child;
  _internals.PROCESS_TIMEOUTS_MS = { ffmpeg: 20, ffprobe: 20 };
  _internals.KILL_GRACE_MS = 20;
  _internals.REAP_CONFIRM_MS = 20;
  try {
    const promise = _internals.runLocalBinary('ffmpeg', [], 'ffmpeg');
    await assert.rejects(promise, (err) => {
      assert.ok(err instanceof ArtRenderError);
      assert.match(err.message, /termination unconfirmed/);
      assert.equal(err.details.sigtermOutcome, 'SIGTERM-not-delivered');
      assert.equal(err.details.sigkillOutcome, 'SIGKILL-not-delivered');
      return true;
    });
    assert.deepEqual(child.killSignals, ['SIGTERM', 'SIGKILL'], 'both signals must still be attempted even though neither reports delivered');
  } finally {
    _internals.spawn = originalSpawn;
    _internals.PROCESS_TIMEOUTS_MS = originalTimeouts;
    _internals.KILL_GRACE_MS = originalGrace;
    _internals.REAP_CONFIRM_MS = originalReap;
  }
});

test('child.kill() throwing (e.g. ESRCH) is handled explicitly, without crashing, and the escalation still proceeds', async () => {
  const originalSpawn = _internals.spawn;
  const originalTimeouts = _internals.PROCESS_TIMEOUTS_MS;
  const originalGrace = _internals.KILL_GRACE_MS;
  const originalReap = _internals.REAP_CONFIRM_MS;
  const child = makeFakeChild();
  child.kill = (signal) => { child.killSignals.push(signal); throw new Error('ESRCH: no such process'); };
  _internals.spawn = () => child;
  _internals.PROCESS_TIMEOUTS_MS = { ffmpeg: 20, ffprobe: 20 };
  _internals.KILL_GRACE_MS = 20;
  _internals.REAP_CONFIRM_MS = 20;
  try {
    const promise = _internals.runLocalBinary('ffmpeg', [], 'ffmpeg');
    await assert.rejects(promise, (err) => {
      assert.ok(err instanceof ArtRenderError);
      assert.match(err.message, /termination unconfirmed/);
      assert.match(err.details.sigtermOutcome, /^SIGTERM-threw:/);
      assert.match(err.details.sigkillOutcome, /^SIGKILL-threw:/);
      return true;
    });
    assert.deepEqual(child.killSignals, ['SIGTERM', 'SIGKILL'], 'a throwing kill() must not stop the escalation from attempting SIGKILL next');
  } finally {
    _internals.spawn = originalSpawn;
    _internals.PROCESS_TIMEOUTS_MS = originalTimeouts;
    _internals.KILL_GRACE_MS = originalGrace;
    _internals.REAP_CONFIRM_MS = originalReap;
  }
});

// ── False-attribution guard (Codex re-review, Slice 4f P2): kill() reporting
// failure must never be conflated with the SIGNAL actually observed on
// 'close'. If the process happens to exit naturally (or for an unrelated
// reason) around the same time — rather than never closing at all — the
// message/details must say so honestly, not claim SIGTERM/SIGKILL killed it
// just because this code attempted those signals. ──────────────────────────

test('child.kill() returning false for both signals, followed by a NATURAL close, does not falsely claim SIGTERM/SIGKILL termination', async () => {
  const originalSpawn = _internals.spawn;
  const originalTimeouts = _internals.PROCESS_TIMEOUTS_MS;
  const originalGrace = _internals.KILL_GRACE_MS;
  const originalReap = _internals.REAP_CONFIRM_MS;
  const child = makeFakeChild();
  child.kill = (signal) => { child.killSignals.push(signal); return false; }; // "not delivered" both times
  _internals.spawn = () => child;
  _internals.PROCESS_TIMEOUTS_MS = { ffmpeg: 20, ffprobe: 20 };
  _internals.KILL_GRACE_MS = 20;
  _internals.REAP_CONFIRM_MS = 300; // generous — the natural close must win, not the reap deadline
  try {
    const promise = _internals.runLocalBinary('ffmpeg', [], 'ffmpeg');
    // Wait past timeout(20)+grace(20)=40ms so SIGKILL has been "attempted" (reported false).
    await new Promise((r) => { setTimeout(r, 70); });
    assert.deepEqual(child.killSignals, ['SIGTERM', 'SIGKILL']);
    // The process exits ON ITS OWN — code 0, no signal — well before the 300ms reap deadline.
    child.emit('close', 0, null);
    await assert.rejects(promise, (err) => {
      assert.ok(err instanceof ArtRenderError);
      assert.match(err.message, /not attributable to a signal this code sent/);
      assert.doesNotMatch(err.message, /terminated by SIG/, 'must never claim SIGTERM/SIGKILL killed it — kill() reported failure and the observed signal was null');
      assert.equal(err.details.terminationConfirmed, true, 'a close event WAS observed — exit itself is confirmed');
      assert.equal(err.details.terminationSignal, null);
      assert.equal(err.details.exitCode, 0);
      assert.equal(err.details.forceKilled, false);
      assert.equal(err.details.sigkillAttempted, true, 'SIGKILL was attempted, even though it is not what caused this exit');
      assert.equal(err.details.sigtermOutcome, 'SIGTERM-not-delivered');
      assert.equal(err.details.sigkillOutcome, 'SIGKILL-not-delivered');
      return true;
    });
  } finally {
    _internals.spawn = originalSpawn;
    _internals.PROCESS_TIMEOUTS_MS = originalTimeouts;
    _internals.KILL_GRACE_MS = originalGrace;
    _internals.REAP_CONFIRM_MS = originalReap;
  }
});

test('child.kill() throwing for both signals, followed by a NATURAL close, does not falsely claim SIGTERM/SIGKILL termination', async () => {
  const originalSpawn = _internals.spawn;
  const originalTimeouts = _internals.PROCESS_TIMEOUTS_MS;
  const originalGrace = _internals.KILL_GRACE_MS;
  const originalReap = _internals.REAP_CONFIRM_MS;
  const child = makeFakeChild();
  child.kill = (signal) => { child.killSignals.push(signal); throw new Error('ESRCH: no such process'); };
  _internals.spawn = () => child;
  _internals.PROCESS_TIMEOUTS_MS = { ffmpeg: 20, ffprobe: 20 };
  _internals.KILL_GRACE_MS = 20;
  _internals.REAP_CONFIRM_MS = 300;
  try {
    const promise = _internals.runLocalBinary('ffmpeg', [], 'ffmpeg');
    await new Promise((r) => { setTimeout(r, 70); });
    assert.deepEqual(child.killSignals, ['SIGTERM', 'SIGKILL']);
    // A different, unrelated signal (e.g. the process's own crash handler) —
    // still must not be attributed to OUR SIGTERM/SIGKILL attempts.
    child.emit('close', null, 'SIGSEGV');
    await assert.rejects(promise, (err) => {
      assert.ok(err instanceof ArtRenderError);
      assert.match(err.message, /not attributable to a signal this code sent/);
      assert.doesNotMatch(err.message, /terminated by SIG/);
      assert.equal(err.details.terminationConfirmed, true);
      assert.equal(err.details.terminationSignal, 'SIGSEGV');
      assert.equal(err.details.exitCode, null);
      assert.equal(err.details.forceKilled, false);
      assert.equal(err.details.sigkillAttempted, true);
      assert.match(err.details.sigtermOutcome, /^SIGTERM-threw:/);
      assert.match(err.details.sigkillOutcome, /^SIGKILL-threw:/);
      return true;
    });
  } finally {
    _internals.spawn = originalSpawn;
    _internals.PROCESS_TIMEOUTS_MS = originalTimeouts;
    _internals.KILL_GRACE_MS = originalGrace;
    _internals.REAP_CONFIRM_MS = originalReap;
  }
});

test('an "error" event firing DURING the SIGTERM grace window does not settle the promise or cancel the SIGKILL escalation', async () => {
  const originalSpawn = _internals.spawn;
  const originalTimeouts = _internals.PROCESS_TIMEOUTS_MS;
  const originalGrace = _internals.KILL_GRACE_MS;
  const originalReap = _internals.REAP_CONFIRM_MS;
  const child = makeFakeChild();
  _internals.spawn = () => child;
  _internals.PROCESS_TIMEOUTS_MS = { ffmpeg: 20, ffprobe: 20 };
  _internals.KILL_GRACE_MS = 50;
  _internals.REAP_CONFIRM_MS = 300;
  try {
    const promise = _internals.runLocalBinary('ffmpeg', [], 'ffmpeg');
    await new Promise((r) => { setTimeout(r, 30); }); // past the 20ms timeout: SIGTERM already sent
    child.emit('error', new Error('spurious stream error mid-escalation'));
    await assertStillPending(promise, 15); // the error must NOT have settled it; still well before grace ends at ~70ms
    // Let the grace window elapse (timeout 20 + grace 50 = ~70ms) so SIGKILL is sent, then confirm via close.
    await new Promise((r) => { setTimeout(r, 45); });
    assert.deepEqual(child.killSignals, ['SIGTERM', 'SIGKILL'], 'the escalation must continue past the ignored error event');
    child.emit('close', null, 'SIGKILL');
    await assert.rejects(promise, (err) => {
      assert.match(err.message, /terminated by SIGKILL/);
      assert.equal(err.details.terminationConfirmed, true);
      return true;
    });
  } finally {
    _internals.spawn = originalSpawn;
    _internals.PROCESS_TIMEOUTS_MS = originalTimeouts;
    _internals.KILL_GRACE_MS = originalGrace;
    _internals.REAP_CONFIRM_MS = originalReap;
  }
});

test('after settlement, no listeners remain attached to the child or its stdio streams and no timer is left pending', async () => {
  const originalSpawn = _internals.spawn;
  const child = makeFakeChild();
  _internals.spawn = () => child;
  try {
    const promise = _internals.runLocalBinary('ffmpeg', [], 'ffmpeg');
    child.emit('close', 0);
    await promise;
    assert.equal(child.listenerCount('close'), 0);
    assert.equal(child.listenerCount('error'), 0);
    assert.equal(child.stdout.listenerCount('data'), 0);
    assert.equal(child.stderr.listenerCount('data'), 0);
  } finally {
    _internals.spawn = originalSpawn;
  }
});

test('captured stderr is bounded to a true 64 KiB BYTE cap and keeps the TAIL once it exceeds it (ASCII case)', async () => {
  const originalSpawn = _internals.spawn;
  const child = makeFakeChild();
  _internals.spawn = () => child;
  try {
    const promise = _internals.runLocalBinary('ffmpeg', [], 'ffmpeg');
    child.stderr.emit('data', Buffer.from('x'.repeat(80 * 1024)));
    child.stderr.emit('data', Buffer.from('THE-REAL-ERROR-AT-THE-END'));
    child.emit('close', 1);
    await assert.rejects(promise, (err) => {
      assert.ok(Buffer.byteLength(err.details.stderr, 'utf8') <= 64 * 1024);
      assert.ok(err.details.stderr.endsWith('THE-REAL-ERROR-AT-THE-END'));
      return true;
    });
  } finally {
    _internals.spawn = originalSpawn;
  }
});

test('captured stderr is bounded to a true 64 KiB BYTE cap for MULTIBYTE UTF-8 output, never a 64 KiB CHARACTER cap', async () => {
  const originalSpawn = _internals.spawn;
  const child = makeFakeChild();
  _internals.spawn = () => child;
  try {
    const promise = _internals.runLocalBinary('ffmpeg', [], 'ffmpeg');
    // Each '💥' is a 4-byte UTF-8 sequence (surrogate pair in UTF-16, 2 JS
    // .length units) — 40,000 of them is 160,000 bytes, well over the 64KiB
    // cap. A character-count-based cap (the old bug) would have kept far
    // more than 64KiB of actual bytes here.
    child.stderr.emit('data', Buffer.from('💥'.repeat(40_000), 'utf8'));
    child.stderr.emit('data', Buffer.from('THE-REAL-ERROR-AT-THE-END', 'utf8'));
    child.emit('close', 1);
    await assert.rejects(promise, (err) => {
      const bytes = Buffer.byteLength(err.details.stderr, 'utf8');
      assert.ok(bytes <= 64 * 1024, `expected <= 65536 bytes, got ${bytes}`);
      assert.ok(err.details.stderr.endsWith('THE-REAL-ERROR-AT-THE-END'), 'the diagnostic tail must survive multibyte truncation');
      return true;
    });
  } finally {
    _internals.spawn = originalSpawn;
  }
});

// ── Cooperative cancellation (Slice 4f Phase B — total render/job deadline)
// ────────────────────────────────────────────────────────────────────────
// The total deadline itself is owned by the CALLER (proof-render-worker.mjs
// creates the AbortController from a server-owned constant); these tests
// prove art-render.mjs's own half of the contract: an externally-supplied
// AbortSignal reaches, and is honored by, both the subprocess escalation
// (runLocalBinary) and the Playwright render loop (renderArtScene) itself.

test('_internals.runLocalBinary: an external AbortSignal triggers the SAME SIGTERM→grace→SIGKILL escalation an internal timeout would, using a real AbortController', async () => {
  const originalSpawn = _internals.spawn;
  const originalTimeouts = _internals.PROCESS_TIMEOUTS_MS;
  const child = makeFakeChild();
  _internals.spawn = () => child;
  // A generous internal timeout that must NEVER fire during this test — if
  // it did, the test couldn't distinguish "the external abort caused this"
  // from "the internal timer caused this anyway."
  _internals.PROCESS_TIMEOUTS_MS = { ffmpeg: 10_000, ffprobe: 10_000 };
  const controller = new AbortController();
  try {
    const promise = _internals.runLocalBinary('ffmpeg', [], 'ffmpeg', controller.signal);
    await new Promise((r) => { setTimeout(r, 20); }); // give the promise a moment to attach its abort listener
    controller.abort();
    await new Promise((r) => { setTimeout(r, 20); }); // let SIGTERM fire
    assert.deepEqual(child.killSignals, ['SIGTERM'], 'the external abort alone must trigger SIGTERM, well before the 10s internal timeout could ever fire');
    child.emit('close', null, 'SIGTERM');
    await assert.rejects(promise, (err) => {
      assert.ok(err instanceof ArtRenderError);
      assert.match(err.message, /terminated by SIGTERM/);
      assert.equal(err.details.terminationConfirmed, true);
      return true;
    });
  } finally {
    _internals.spawn = originalSpawn;
    _internals.PROCESS_TIMEOUTS_MS = originalTimeouts;
  }
});

test('_internals.runLocalBinary: aborting BEFORE the call starts rejects immediately without spawning a process', async () => {
  const originalSpawn = _internals.spawn;
  let spawnCalled = false;
  _internals.spawn = () => { spawnCalled = true; return makeFakeChild(); };
  const controller = new AbortController();
  controller.abort();
  try {
    await assert.rejects(
      () => _internals.runLocalBinary('ffmpeg', [], 'ffmpeg', controller.signal),
      (err) => { assert.ok(err instanceof ArtRenderError); assert.equal(err.details.aborted, true); return true; },
    );
    assert.equal(spawnCalled, false, 'an already-aborted signal must reject before ever spawning a process');
  } finally {
    _internals.spawn = originalSpawn;
  }
});

test('renderArtScene: aborting mid-render stops frame capture and closes the browser/server well before the requested duration elapses', async () => {
  await withTempOutDir(async (outDir) => {
    const recipe = recipeFor({ mat: { baseColor: '#7dd3fc' }, lookSeed: 42 });
    const controller = new AbortController();
    const started = Date.now();
    // A render that, uninterrupted, would run several seconds (72 frames at
    // 24fps/3s, matching the real UI's own PROOF_RENDER_PARAMS) — long
    // enough that an early, bounded rejection is only possible if the
    // abort genuinely stopped frame capture rather than letting it finish.
    const renderPromise = renderArtScene({
      recipe, width: 320, height: 320, fps: 24, durationSeconds: 3, outDir, signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 200);
    await assert.rejects(renderPromise, (err) => {
      assert.ok(err instanceof ArtRenderError);
      assert.match(err.message, /[Aa]borted/);
      assert.equal(err.details.aborted, true);
      return true;
    });
    const elapsedMs = Date.now() - started;
    assert.ok(elapsedMs < 2500, `expected early termination well under the 3s+ a full render/encode would take, took ${elapsedMs}ms`);
  });
});

test('renderArtScene: aborting BEFORE the call starts rejects immediately, launching no browser at all', async () => {
  const recipe = recipeFor({ lookSeed: 1 });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => renderArtScene({ recipe, width: 100, height: 100, fps: 10, durationSeconds: 0.1, signal: controller.signal }),
    (err) => { assert.ok(err instanceof ArtRenderError); assert.equal(err.details.aborted, true); return true; },
  );
});

// ── Glass Petal Sphere parity (Phase 5 glass-parity pass) — the PRIMARY
// glass element (recipe.glass) is genuinely rendered now: verbatim petal
// geometry/material port with fixed-timestep auto-rotate. Data-only glass
// duplicates still travel as extraInstances and stay capability-gated
// (covered by the extraInstances test above). ─────────────────────────────

test('a recipe with the primary glass ON is fully supported — the glass capability gate is gone', () => {
  const recipe = recipeFor({ glass: { on: true } });
  assert.deepEqual(checkCapabilities(recipe), { supported: true, unsupportedFeatures: [] });
});

test('glass ON genuinely renders and is deterministic: identical recipes are hash-identical, and differ from the same recipe with glass OFF', async () => {
  const on = recipeFor({ glass: { on: true, rotate: false } });
  const off = recipeFor({});
  const [a, b, c] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe: on, ...SMALL, durationSeconds: 1 / 12, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe: on, ...SMALL, durationSeconds: 1 / 12, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe: off, ...SMALL, durationSeconds: 1 / 12, outDir })),
  ]);
  assert.deepEqual(a.frameHashes, b.frameHashes, 'the same glass-on recipe must reproduce identical frames — no unseeded state anywhere in the glass path');
  assert.notEqual(a.frameHashes[0], c.frameHashes[0], 'glass ON must actually change the rendered frame — accepted-but-omitted would be the silent-drop defect the capability system exists to prevent');
});

test('glass auto-rotate advances with the fixed timestep: rotate:true produces different frames from rotate:false, deterministically', async () => {
  const rotating = recipeFor({ glass: { on: true, rotate: true, rotSpeed: 2 } });
  const still = recipeFor({ glass: { on: true, rotate: false } });
  const [rotA, rotB, stillRun] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe: rotating, ...SMALL, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe: rotating, ...SMALL, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe: still, ...SMALL, outDir })),
  ]);
  assert.deepEqual(rotA.frameHashes, rotB.frameHashes, 'rotation must be a pure function of the fixed timestep — same recipe, same frames, every run');
  assert.notEqual(
    rotA.frameHashes[rotA.frameHashes.length - 1],
    stillRun.frameHashes[stillRun.frameHashes.length - 1],
    'by the final frame the rotating glass must visibly differ from the non-rotating one',
  );
});

test('glass state maps onto the real material/group exactly (inspectScene): clarity→roughness, transmission, tint→attenuationColor, scale, position, rotationOffset baseline', async () => {
  const recipe = recipeFor({ glass: { on: true, clarity: 0.2, transmission: 0.35, tint: '#abcdef', scale: 1.5, position: [0.2, -0.1, 0.3], rotationOffset: [4, -6, 8] } });
  const { glassInspection, capabilities } = await inspectScene({ recipe, width: 64, height: 64, fps: 10 });
  assert.equal(capabilities.supported, true);
  assert.equal(glassInspection.petalCount, 5);
  assert.equal(glassInspection.roughness, 0.2, 'clarity drives material.roughness, exactly like the live scene');
  assert.equal(glassInspection.transmission, 0.35);
  assert.equal(glassInspection.attenuationColor, 'abcdef');
  assert.equal(glassInspection.scale, 1.5);
  assert.deepEqual(glassInspection.position, [0.2, -0.1, 0.3]);
  // Before frame zero the rotation IS the rotationOffset baseline, in radians.
  const DEG = Math.PI / 180;
  assert.deepEqual(glassInspection.rotation, [4 * DEG, -6 * DEG, 8 * DEG]);
});

test('24fps regression: glass rotation advances by UNIFORM exact frame time from the exact rotationOffset baseline — never the rounded 60Hz cloth-step schedule', async () => {
  // At 24fps the cloth solver's rounded step schedule alternates 3/2 steps
  // per frame (targetSteps 3,5,8,10,13,15 → deltas 3,2,3,2,3,2). Rotation
  // accumulated through those steps would advance in alternating 50ms/33ms
  // increments; the exact-frame-time computation this pins advances every
  // frame by exactly 1/24s. Cloth physics deliberately KEEPS the 60Hz
  // stepping — this regression is about the rigid glass rotation only.
  const DEG = Math.PI / 180;
  const rotSpeed = 1;
  const recipe = recipeFor({ glass: { on: true, rotate: true, rotSpeed, rotationOffset: [4, -6, 8] } });
  const result = await withTempOutDir((outDir) => renderArtScene({ recipe, width: 240, height: 240, fps: 24, durationSeconds: 0.25, outDir }));
  const rots = result.glassRotations;
  assert.equal(rots.length, 6, 'one rotation snapshot per captured frame');

  const close = (actual, expected, msg) => assert.ok(Math.abs(actual - expected) < 1e-12, `${msg}: |${actual} - ${expected}| >= 1e-12`);
  for (let i = 0; i < rots.length; i += 1) {
    const t = (i + 1) / 24;
    close(rots[i][0], 4 * DEG + rotSpeed * 0.17 * t, `frame ${i} x = baseline + 0.17·t`);
    close(rots[i][1], -6 * DEG, `frame ${i} y must stay at the exact rotationOffset baseline — auto-rotate never touches y`);
    close(rots[i][2], 8 * DEG + rotSpeed * 0.5 * t, `frame ${i} z = baseline + 0.5·t`);
  }
  for (let i = 1; i < rots.length; i += 1) {
    close(rots[i][2] - rots[i - 1][2], rotSpeed * 0.5 / 24, `frame ${i} z increment must be uniform (1/24s) — alternating 3/60 vs 2/60 increments are exactly the defect this pins`);
    close(rots[i][0] - rots[i - 1][0], rotSpeed * 0.17 / 24, `frame ${i} x increment must be uniform (1/24s)`);
  }
});

test('glass OFF builds no glass object at all — not an invisible one', async () => {
  const { glassInspection } = await inspectScene({ recipe: recipeFor({}), width: 64, height: 64, fps: 10 });
  assert.equal(glassInspection, null);
});

// ── Scene backgrounds (Slice B/C scene/background parity) — bgMode 'scene'
// genuinely renders: seeded procedural backdrop, fog, ground (flat or
// textured), pano plate with matched PMREM IBL. Support is judged from the
// COMPOSED effective scene (preset + sceneTweaks). ─────────────────────────

test('capability: bgMode "scene" is supported; "image"/"transparent" are precisely gated by name', () => {
  assert.deepEqual(checkCapabilities(recipeFor({ bgMode: 'scene', sceneId: 'thriller' })), { supported: true, unsupportedFeatures: [] });
  assert.deepEqual(checkCapabilities(recipeFor({ bgMode: 'image' })).unsupportedFeatures, ['background-image']);
  assert.deepEqual(checkCapabilities(recipeFor({ bgMode: 'transparent' })).unsupportedFeatures, ['background-transparent']);
});

test('capability: a RAW (un-normalized) scene recipe naming an asset outside the vendored tables is rejected per-asset, never accepted into a mid-render 404', () => {
  const raw = { ...recipeFor({ bgMode: 'scene', sceneId: 'thriller' }), sceneTweaks: { pano: '/hdr/not-vendored.hdr', groundTex: 'lava' } };
  const { supported, unsupportedFeatures } = checkCapabilities(raw);
  assert.equal(supported, false);
  assert.ok(unsupportedFeatures.includes('scene-pano:/hdr/not-vendored.hdr'));
  assert.ok(unsupportedFeatures.includes('scene-ground-texture:lava'));
});

test('capability: support is judged from the COMPOSED scene — a tweak can remove a pano preset requirement (and the render honors the removal)', async () => {
  // venice-table's preset carries pano+groundTex; the tweaks strip both.
  const recipe = recipeFor({ bgMode: 'scene', sceneId: 'venice-table', sceneTweaks: { pano: '', groundTex: '' } });
  assert.deepEqual(checkCapabilities(recipe), { supported: true, unsupportedFeatures: [] });
  const { sceneBackgroundInspection } = await inspectScene({ recipe, width: 64, height: 64, fps: 10 });
  assert.equal(sceneBackgroundInspection.backgroundKind, 'backdrop', 'the removed pano must leave the procedural backdrop, not a stale plate');
  assert.equal(sceneBackgroundInspection.environmentIsPanoIbl, false);
  assert.equal(sceneBackgroundInspection.groundHasTexture, false);
  assert.equal(sceneBackgroundInspection.groundColor, '8a5f3c', "flat ground falls back to the preset's own ground color");
});

test('scene render is deterministic, sceneSeed-driven, and genuinely different from a plain color background', async () => {
  const thriller = recipeFor({ bgMode: 'scene', sceneId: 'thriller' });
  const thrillerSeed2 = recipeFor({ bgMode: 'scene', sceneId: 'thriller', sceneSeed: 2 });
  const color = recipeFor({});
  const [a, b, c, d] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe: thriller, ...SMALL, durationSeconds: 1 / 12, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe: thriller, ...SMALL, durationSeconds: 1 / 12, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe: thrillerSeed2, ...SMALL, durationSeconds: 1 / 12, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe: color, ...SMALL, durationSeconds: 1 / 12, outDir })),
  ]);
  assert.deepEqual(a.frameHashes, b.frameHashes, 'same scene recipe, same frames — the backdrop film grain is sceneSeed-seeded, not Math.random');
  assert.notEqual(a.frameHashes[0], c.frameHashes[0], 'a different sceneSeed must produce different backdrop grain');
  assert.notEqual(a.frameHashes[0], d.frameHashes[0], 'the scene background must actually change the rendered frame vs plain color');
});

test('a pano scene (venice-table: 2K HDR plate + wood ground) renders deterministically with the exact preset plate/ground state', async () => {
  const recipe = recipeFor({ bgMode: 'scene', sceneId: 'venice-table' });
  const [a, b] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe, ...SMALL, durationSeconds: 1 / 12, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe, ...SMALL, durationSeconds: 1 / 12, outDir })),
  ]);
  assert.deepEqual(a.frameHashes, b.frameHashes, 'pano + textured ground must be exactly reproducible');

  const { sceneBackgroundInspection: insp } = await inspectScene({ recipe, width: 64, height: 64, fps: 10 });
  assert.equal(insp.backgroundKind, 'pano');
  assert.equal(insp.backgroundBlurriness, 0.1, "the preset's own panoBlur");
  assert.equal(insp.environmentIsPanoIbl, true, "the plate's matched PMREM IBL must override the envId environment");
  assert.equal(insp.groundVisible, true);
  assert.equal(insp.groundY, -0.68, "desk-style sets raise the floor — the preset's own groundY");
  assert.equal(insp.groundHasTexture, true);
  assert.equal(insp.groundRepeat, 7, "the wood surface's own repeat");
  assert.equal(insp.groundColor, 'ffffff', 'textured floors default the tint to white — the map carries the color');
});

test('scene inspection: thriller (procedural set) carries the exact preset fog/ground state; pano tweaks (blur/rotY/intensity + webp plate) apply', async () => {
  const { sceneBackgroundInspection: thriller } = await inspectScene({ recipe: recipeFor({ bgMode: 'scene', sceneId: 'thriller' }), width: 64, height: 64, fps: 10 });
  assert.equal(thriller.backgroundKind, 'backdrop');
  assert.equal(thriller.fogDensity, 0.16);
  assert.equal(thriller.groundVisible, true);
  assert.equal(thriller.groundY, -1.15);
  assert.equal(thriller.groundColor, '0a0a0c');

  // A webp plate added BY TWEAK to a procedural set, with tweak overrides —
  // proves the tweak-composed pano path end to end (loader branch included).
  const tweaked = recipeFor({
    bgMode: 'scene', sceneId: 'thriller',
    sceneTweaks: { pano: '/env/desk.webp', panoBlur: 0.4, panoRotY: 90, panoIntensity: 1.5 },
  });
  assert.equal(checkCapabilities(tweaked).supported, true);
  const { sceneBackgroundInspection: insp } = await inspectScene({ recipe: tweaked, width: 64, height: 64, fps: 10 });
  assert.equal(insp.backgroundKind, 'pano');
  assert.equal(insp.backgroundBlurriness, 0.4);
  assert.ok(Math.abs(insp.backgroundRotationY - (90 * Math.PI) / 180) < 1e-12, 'panoRotY is degrees → radians on backgroundRotation.y');
  assert.equal(insp.backgroundIntensity, 1.5);
  assert.equal(insp.environmentIsPanoIbl, true);
});

// ── Shadows (Codex Slice-B/C P1 correction): scene floors could never
// match Studio without the live shadow pipeline — exact-value regression
// read off the real renderer/light/mesh instances. ─────────────────────────

test('shadow pipeline matches the live Studio exactly: PCFSoftShadowMap, can-0 1024²/-0.0005/0.02, front cloth casts, ground receives', async () => {
  const { shadowInspection: s } = await inspectScene({ recipe: recipeFor({ bgMode: 'scene', sceneId: 'thriller' }), width: 64, height: 64, fps: 10 });
  assert.equal(s.shadowMapEnabled, true);
  assert.equal(s.shadowMapIsPCFSoft, true, 'must be THREE.PCFSoftShadowMap, the exact live type');
  assert.equal(s.can0CastShadow, true, 'light can 0 is the one configured shadow caster');
  assert.deepEqual(s.can0ShadowMapSize, [1024, 1024]);
  assert.equal(s.can0ShadowBias, -0.0005);
  assert.equal(s.can0ShadowNormalBias, 0.02);
  assert.equal(s.clothCastShadow, true, 'the front cloth mesh casts onto scene floors');
  assert.equal(s.clothBackCastShadow, false, 'the back mesh does NOT cast — verbatim ClothStudio (front mesh only)');
  assert.equal(s.groundReceiveShadow, true);
});

test('the shadow pipeline is active for every bgMode (enabled at renderer creation, like the live Studio) — invisible-ground modes just have no receiver', async () => {
  const { shadowInspection: s } = await inspectScene({ recipe: recipeFor({}), width: 64, height: 64, fps: 10 });
  assert.equal(s.shadowMapEnabled, true);
  assert.equal(s.can0CastShadow, true);
  assert.equal(s.groundReceiveShadow, true, 'the receiver flag stays set; visibility is what scene mode controls');
});

// ── Prototype-chain key hardening (Codex Slice-B/C P2): the RAW/
// un-normalized validation contract must hold for '__proto__'/'constructor'/
// 'toString' — a bare object-literal property read resolves those to real
// truthy prototype-chain values. ───────────────────────────────────────────

test('raw sceneId of __proto__/constructor/toString falls back to the thriller preset — never composes over Object.prototype', () => {
  for (const evil of ['__proto__', 'constructor', 'toString']) {
    const raw = { ...recipeFor({ bgMode: 'scene', sceneId: 'thriller' }), sceneId: evil };
    const { supported, unsupportedFeatures } = checkCapabilities(raw);
    assert.equal(supported, true, `sceneId '${evil}' must resolve like any unknown id (thriller fallback), got: ${unsupportedFeatures.join(', ')}`);
  }
});

test('raw groundTex of __proto__/constructor/toString is an UNKNOWN texture with a precise rejection — never a truthy prototype-chain object', () => {
  for (const evil of ['__proto__', 'constructor', 'toString']) {
    const raw = { ...recipeFor({ bgMode: 'scene', sceneId: 'thriller' }), sceneTweaks: { groundTex: evil } };
    const { supported, unsupportedFeatures } = checkCapabilities(raw);
    assert.equal(supported, false, `groundTex '${evil}' must be rejected`);
    assert.ok(unsupportedFeatures.includes(`scene-ground-texture:${evil}`), `precise rejection expected, got: ${unsupportedFeatures.join(', ')}`);
  }
});

// ── T-shirt primary (Slice E) — clothShape 'tshirt' renders via the SAME
// vendored hanging-tshirt factory the live Studio runs, stepped by exported
// stepSim(…, 1/60) on the exact target-step schedule (never advanceSim,
// whose 3-step catch-up cap loses simulation time below 20fps). ───────────

test('T-shirt render is deterministic and never builds a hidden sheet — repeat renders hash-identical, sheet mode unaffected', async () => {
  const tshirt = recipeFor({ clothShape: 'tshirt' });
  const sheet = recipeFor({});
  const [a, b, sheetRun] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe: tshirt, ...SMALL, durationSeconds: 1 / 12, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe: tshirt, ...SMALL, durationSeconds: 1 / 12, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe: sheet, ...SMALL, durationSeconds: 1 / 12, outDir })),
  ]);
  assert.deepEqual(a.frameHashes, b.frameHashes, 'the garment build/sim/print pipeline must be exactly reproducible');
  assert.notEqual(a.frameHashes[0], sheetRun.frameHashes[0], 'the garment must actually render something different from the flat sheet');

  const { clothDimensions, tshirtInspection } = await inspectScene({ recipe: tshirt, width: 64, height: 64, fps: 10 });
  assert.equal(clothDimensions, null, 'NO sheet cloth may exist in T-shirt mode — sheet XOR tshirt');
  assert.equal(tshirtInspection.sheetBuilt, false);
  assert.ok(tshirtInspection.vertexCount > 0, 'the garment sim must genuinely exist');

  const sheetInspect = await inspectScene({ recipe: sheet, width: 64, height: 64, fps: 10 });
  assert.ok(sheetInspect.clothDimensions, 'sheet mode still builds the sheet — non-regression');
  assert.equal(sheetInspect.tshirtInspection, null, 'no garment object may exist in sheet mode');
});

test('cross-fps: the same simulated time produces the SAME final garment frame at 12fps and 30fps — the exact-step schedule advanceSim would have broken', async () => {
  const recipe = recipeFor({ clothShape: 'tshirt' });
  const dims = { width: 240, height: 240 };
  const [at12, at30] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe, ...dims, fps: 12, durationSeconds: 0.5, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe, ...dims, fps: 30, durationSeconds: 0.5, outDir })),
  ]);
  // Both final frames sit at t=0.5s → round(6*60/12)=30 and round(15*60/30)=30
  // physics steps — identical sim state, identical pixels.
  assert.equal(at12.frameHashes.length, 6);
  assert.equal(at30.frameHashes.length, 15);
  assert.equal(at12.frameHashes[5], at30.frameHashes[14], 'the final captured frame must be pixel-identical across fps — lost catch-up steps would desync exactly this');
});

test('print/hanger inspection is exact: tshirtPrint maps onto the real shader uniforms (front only), hanger toggles, shadow behavior stays verbatim-live', async () => {
  const recipe = recipeFor({ clothShape: 'tshirt', tshirtPrint: { x: 0.1, y: -0.05, scale: 1.2, rotation: 45, opacity: 0.8, hangerVisible: true } });
  const { tshirtInspection: t } = await inspectScene({ recipe, width: 64, height: 64, fps: 10 });
  assert.equal(t.printReady, true, 'the artwork print must be decoded and live before frame zero');
  assert.equal(t.printX, 0.1);
  assert.equal(t.printY, -0.05);
  assert.equal(t.printScale, 1.2);
  assert.ok(Math.abs(t.printRotationRad - (45 * Math.PI) / 180) < 1e-12, 'print rotation is degrees → radians on the uniform');
  assert.equal(t.printOpacity, 0.8);
  assert.equal(t.backHasPrintShader, false, 'the print is FRONT-only — the back panel material carries no logo shader at all');
  assert.equal(t.hangerVisible, true);
  assert.equal(t.frontCastShadow, false, 'verbatim live behavior: the garment does not cast shadows — no server-only "improvements"');
  assert.equal(t.backCastShadow, false);

  const { tshirtInspection: noHanger } = await inspectScene({ recipe: recipeFor({ clothShape: 'tshirt', tshirtPrint: { hangerVisible: false } }), width: 64, height: 64, fps: 10 });
  assert.equal(noHanger.hangerVisible, false);
});

// ── Device primary shell (Slice F1) — clothShape 'device' renders the
// SHELL with its deterministic procedural placeholder screen via the SAME
// vendored device-mockup factory the live Studio runs. capture/upload
// screen sources stay precisely rejected until each has a real render path;
// 'live' (STUDIO-DETERMINISTIC-FINAL-RENDER-SONNET-HANDOFF.md's "Live
// website frames on the device screen" checkpoint) now genuinely renders a
// real captured scrolling frame sequence — see the render tests below. ────

test('capability: a source-free device shell is supported; a valid live URL is now supported; capture/upload screen sources are each still rejected by name; an unusable live request is precisely rejected', () => {
  assert.deepEqual(checkCapabilities(recipeFor({ clothShape: 'device' })), { supported: true, unsupportedFeatures: [] });
  // device-screen-live LIFTED for a genuinely usable request (a valid
  // http(s) liveUrl) — art-render.mjs can actually capture it now.
  assert.deepEqual(checkCapabilities(recipeFor({ clothShape: 'device', devicePrimary: { liveUrl: 'https://example.com' } })), { supported: true, unsupportedFeatures: [] });
  assert.deepEqual(checkCapabilities(recipeFor({ clothShape: 'device', devicePrimary: { live: true, liveUrl: 'https://example.com' } })), { supported: true, unsupportedFeatures: [] });
  // Requested but unusable (live:true with no URL to fetch, or a malformed
  // one) stays precisely rejected — never a silent placeholder fallback.
  assert.deepEqual(checkCapabilities(recipeFor({ clothShape: 'device', devicePrimary: { live: true } })).unsupportedFeatures, ['device-screen-live']);
  assert.deepEqual(checkCapabilities(recipeFor({ clothShape: 'device', devicePrimary: { live: true, liveUrl: 'not-a-url' } })).unsupportedFeatures, ['device-screen-live']);
  assert.deepEqual(checkCapabilities(recipeFor({ clothShape: 'device', devicePrimary: { captureUrl: 'https://example.com' } })).unsupportedFeatures, ['device-screen-capture']);
  assert.deepEqual(checkCapabilities(recipeFor({ clothShape: 'device', devicePrimary: { uploadAssetId: 'abc123' } })).unsupportedFeatures, ['device-screen-upload']);
});

test('device shell renders deterministically with the placeholder screen and no other primary — and the placeholder is genuinely what is on screen', async () => {
  const device = recipeFor({ clothShape: 'device', devicePrimary: { posY: 0.2, sway: true } });
  const [a, b] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe: device, ...SMALL, durationSeconds: 1 / 12, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe: device, ...SMALL, durationSeconds: 1 / 12, outDir })),
  ]);
  assert.deepEqual(a.frameHashes, b.frameHashes, 'the shell + placeholder pipeline must be exactly reproducible');

  const { clothDimensions, tshirtInspection, deviceInspection: d } = await inspectScene({ recipe: device, width: 64, height: 64, fps: 10 });
  assert.equal(clothDimensions, null, 'no sheet in device mode');
  assert.equal(tshirtInspection, null, 'no garment in device mode');
  assert.equal(d.sheetBuilt, false);
  assert.equal(d.screenKey, '', 'no capture/upload source may ever resolve — the renderer never fetches');
  assert.equal(d.placeholderActive, true, 'the deterministic procedural placeholder IS the screen content');
  assert.equal(d.positionY, 0.2, 'posY is the whole vertical story when no floor is visible');
  assert.equal(d.scale, 1.45);
  assert.equal(d.swayOn, true);
});

test('device sway/scroll are pure functions of exact frame time: 12fps and 30fps agree on the final frame; seat-on-floor lands on the scene floor', async () => {
  const recipe = recipeFor({ clothShape: 'device', devicePrimary: { sway: true, swaySpeed: 1.2, scroll: true, scrollSpeed: 0.8 } });
  const dims = { width: 240, height: 240 };
  const [at12, at30] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe, ...dims, fps: 12, durationSeconds: 0.5, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe, ...dims, fps: 30, durationSeconds: 0.5, outDir })),
  ]);
  assert.equal(at12.frameHashes[5], at30.frameHashes[14], 'both final frames sit at t=0.5s — sway sin() and scroll ping-pong must agree exactly');

  const seated = recipeFor({ clothShape: 'device', bgMode: 'scene', sceneId: 'venice-table' });
  const { deviceInspection: d } = await inspectScene({ recipe: seated, width: 64, height: 64, fps: 10 });
  assert.ok(Math.abs(d.positionY - (-0.0101)) < 1e-4, `seatOnFloor must place the device's lowest point on venice-table's raised floor (got ${d.positionY})`);
});

// ── Prototype-chain device ids (Codex F1 P1 correction): raw model/
// viewport/shellTexture ids of '__proto__'/'constructor'/'toString' used to
// read truthy Object.prototype values through bare table lookups —
// producing NaN placement and invalid geometry instead of the documented
// default-shell fallback. Fixed at the SOURCE (deviceResolveModel/
// deviceBottomLocalY/getShellTexture use Object.hasOwn) AND at
// normalization (per-viewport model allowlist). ───────────────────────────

test('recipe normalization: __proto__/constructor/toString model and shellTexture ids fall back to the viewport default — never carried', async () => {
  const { normalizeArtSceneRecipe } = await import('../art-recipe.mjs');
  for (const evil of ['__proto__', 'constructor', 'toString']) {
    const d = normalizeArtSceneRecipe({
      kind: 'art-scene-v2', schemaVersion: 1,
      scene: { devicePrimary: { models: { desktop: evil, mobile: evil, tablet: evil }, shellTexture: evil } },
    }).recipe.devicePrimary;
    assert.deepEqual(d.models, { desktop: 'studio', mobile: 'flagship', tablet: 'pro' }, `models '${evil}' must keep every viewport default`);
    assert.equal(d.shellTexture, 'smooth', `shellTexture '${evil}' must keep the default`);
  }
});

test('source-level fallback: a RAW __proto__/constructor/toString model id renders PIXEL-IDENTICALLY to the viewport default shell — no NaN geometry possible', async () => {
  const base = recipeFor({ clothShape: 'device' });
  const defaultRun = await withTempOutDir((outDir) => renderArtScene({ recipe: base, ...SMALL, durationSeconds: 1 / 12, outDir }));
  for (const evil of ['__proto__', 'constructor', 'toString']) {
    // Bypass normalization deliberately (a RAW recipe object) — this pins
    // the FACTORY-level Object.hasOwn fallback, not just the sanitizer.
    const models = {};
    ['desktop', 'mobile', 'tablet'].forEach((vp) => { models[vp] = evil; });
    const raw = { ...base, devicePrimary: { ...base.devicePrimary, models } };
    // eslint-disable-next-line no-await-in-loop
    const evilRun = await withTempOutDir((outDir) => renderArtScene({ recipe: raw, ...SMALL, durationSeconds: 1 / 12, outDir }));
    assert.deepEqual(evilRun.frameHashes, defaultRun.frameHashes, `model id '${evil}' must render exactly the default desktop shell`);
  }
});

// ── Pinned device-screen still (Slice F2) — the immutable content-hashed
// still renders as the device screen: loaded from a LOCAL file before frame
// zero (the worker downloads + hash-verifies it; this layer never fetches),
// scrolling through the factory's own capture path. ───────────────────────

const STILL_FIXTURE = new URL('../assets/artwork/holocloth-default-artwork.jpg', import.meta.url).pathname;
const { createHash: stillHash } = await import('node:crypto');
function stillRefFor(fixturePath) {
  const buf = readFileSync(fixturePath);
  return { sha256: stillHash('sha256').update(buf).digest('hex'), ext: 'jpg', width: 1024, height: 1024, bytes: buf.length };
}

test('capability: a VALID pinned still is supported; a malformed one is precisely rejected as device-screen-still-invalid', () => {
  const valid = recipeFor({ clothShape: 'device', devicePrimary: { screenStill: stillRefFor(STILL_FIXTURE) } });
  assert.deepEqual(checkCapabilities(valid), { supported: true, unsupportedFeatures: [] });
  const invalid = recipeFor({ clothShape: 'device', devicePrimary: { screenStill: { sha256: 'nope' } } });
  assert.deepEqual(checkCapabilities(invalid).unsupportedFeatures, ['device-screen-still-invalid']);
});

test('a pinned still renders deterministically, genuinely differs from the placeholder shell, and is EXACTLY what is on screen', async () => {
  const still = stillRefFor(STILL_FIXTURE);
  const pinned = recipeFor({ clothShape: 'device', devicePrimary: { screenStill: still } });
  const placeholder = recipeFor({ clothShape: 'device' });
  const [a, b, plain] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe: pinned, ...SMALL, durationSeconds: 1 / 12, outDir, deviceScreenStillPath: STILL_FIXTURE })),
    withTempOutDir((outDir) => renderArtScene({ recipe: pinned, ...SMALL, durationSeconds: 1 / 12, outDir, deviceScreenStillPath: STILL_FIXTURE })),
    withTempOutDir((outDir) => renderArtScene({ recipe: placeholder, ...SMALL, durationSeconds: 1 / 12, outDir })),
  ]);
  assert.deepEqual(a.frameHashes, b.frameHashes, 'the pinned-still pipeline must be exactly reproducible');
  assert.notEqual(a.frameHashes[0], plain.frameHashes[0], 'the pinned content must actually appear — identical frames would mean a silently-blank sourced screen');

  const { deviceInspection: d } = await inspectScene({ recipe: pinned, width: 64, height: 64, fps: 10, deviceScreenStillPath: STILL_FIXTURE });
  assert.equal(d.screenStillActive, true, 'the decoded still texture must BE the live screen map at frame zero');
  assert.equal(d.placeholderActive, false);
  assert.equal(d.screenKey, 'capture:./screen-still.jpg', "the still rides the factory's own capture path, keyed to the LOCAL file");
  assert.ok(d.screenRepeatY > 0 && d.screenRepeatY < 1, 'the per-image scroll fraction must be computed from the real still dimensions');
});

test('cross-fps parity holds WITH the pinned still (scrolling): 12fps and 30fps agree on the final frame; a pinned recipe without the local file rejects', async () => {
  const still = stillRefFor(STILL_FIXTURE);
  const recipe = recipeFor({ clothShape: 'device', devicePrimary: { screenStill: still, scroll: true, scrollSpeed: 0.8 } });
  const dims = { width: 240, height: 240 };
  const [at12, at30] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe, ...dims, fps: 12, durationSeconds: 0.5, outDir, deviceScreenStillPath: STILL_FIXTURE })),
    withTempOutDir((outDir) => renderArtScene({ recipe, ...dims, fps: 30, durationSeconds: 0.5, outDir, deviceScreenStillPath: STILL_FIXTURE })),
  ]);
  assert.equal(at12.frameHashes[5], at30.frameHashes[14], 'the still-scroll offset is a pure function of exact frame time');

  await assert.rejects(
    () => renderArtScene({ recipe, ...SMALL, durationSeconds: 1 / 12 }),
    (err) => { assert.match(err.message, /deviceScreenStillPath/); return true; },
    'a recipe that pins a still MUST be given the local file — never rendered blank',
  );
});

// ── Live website frames on the device screen (STUDIO-DETERMINISTIC-FINAL-
// RENDER-SONNET-HANDOFF.md checkpoint) — a REAL captured scrolling frame
// sequence renders as the device screen. Every test here overrides
// `_internals.captureDeviceLiveFrames` (the DI seam) with a synthetic fake
// — NEVER the real network — per the handoff's own testing constraint. ────

const FLYER_FIXTURE = new URL('../assets/artwork/holocloth-artwork-flyer-2.jpg', import.meta.url).pathname;
function dataUrlFor(fixturePath) {
  return `data:image/jpeg;base64,${readFileSync(fixturePath).toString('base64')}`;
}

test('device screen shows real captured website frames (DI-injected, never real network) — genuinely different from the placeholder shell', async () => {
  const frameA = dataUrlFor(STILL_FIXTURE);
  const frameB = dataUrlFor(FLYER_FIXTURE);
  const originalCapture = _internals.captureDeviceLiveFrames;
  let capturedArgs = null;
  _internals.captureDeviceLiveFrames = async (opts) => {
    capturedArgs = opts;
    return { frames: [frameA, frameB], viewport: { width: 240, height: 150 }, readiness: { ready: true }, scrollInfo: { y: 500 } };
  };
  try {
    const recipe = recipeFor({ clothShape: 'device', devicePrimary: { liveUrl: 'https://example.com/live-page' } });
    const placeholder = recipeFor({ clothShape: 'device' });
    const [live, plain] = await Promise.all([
      withTempOutDir((outDir) => renderArtScene({ recipe, ...SMALL, durationSeconds: 1 / 12, outDir })),
      withTempOutDir((outDir) => renderArtScene({ recipe: placeholder, ...SMALL, durationSeconds: 1 / 12, outDir })),
    ]);
    assert.equal(capturedArgs.url, 'https://example.com/live-page', 'the capture step must be handed the recipe\'s own liveUrl, never a hardcoded/placeholder one');
    assert.equal(capturedArgs.viewport, 'desktop');
    assert.equal(capturedArgs.fps, SMALL.fps, 'the render\'s own fps must reach the capture step (Live capture fluidity fixes checkpoint) so it can size the deterministic capture-frame plan against the real output frame count');
    assert.equal(live.liveCapture.frameCount, 2, 'the render result must report exactly how many frames were actually captured');
    assert.notEqual(live.frameHashes[0], plain.frameHashes[0], 'the captured content must actually appear — identical frames would mean a silently-blank sourced screen');
  } finally {
    _internals.captureDeviceLiveFrames = originalCapture;
  }
});

test('no-timeline pacing: different output frames genuinely select different captured live frames across the clip (the pipeline\'s own default scroll pacing)', async () => {
  const frames = [dataUrlFor(STILL_FIXTURE), dataUrlFor(FLYER_FIXTURE), dataUrlFor(STILL_FIXTURE), dataUrlFor(FLYER_FIXTURE)];
  const originalCapture = _internals.captureDeviceLiveFrames;
  _internals.captureDeviceLiveFrames = async () => ({ frames, viewport: { width: 240, height: 150 }, readiness: { ready: true }, scrollInfo: { y: 500 } });
  try {
    const recipe = recipeFor({ clothShape: 'device', devicePrimary: { liveUrl: 'https://example.com' } });
    const result = await withTempOutDir((outDir) => renderArtScene({ recipe, width: 64, height: 64, fps: 4, durationSeconds: 1, outDir }));
    assert.equal(result.frameHashes.length, 4);
    assert.ok(new Set(result.frameHashes).size > 1, 'consecutive output frames must show DIFFERENT captured frames as the clip progresses — a static single-frame result would mean the mapping/pacing silently collapsed');
  } finally {
    _internals.captureDeviceLiveFrames = originalCapture;
  }
});

test('timeline-driven pacing: scrollPosition directly selects the captured-frame index — deterministic and reproducible', async () => {
  const frames = [dataUrlFor(STILL_FIXTURE), dataUrlFor(FLYER_FIXTURE), dataUrlFor(STILL_FIXTURE), dataUrlFor(FLYER_FIXTURE)];
  const originalCapture = _internals.captureDeviceLiveFrames;
  _internals.captureDeviceLiveFrames = async () => ({ frames, viewport: { width: 240, height: 150 }, readiness: { ready: true }, scrollInfo: { y: 500 } });
  try {
    const recipe = recipeFor({ clothShape: 'device', devicePrimary: { liveUrl: 'https://example.com' } });
    const timeline = { totalSeconds: 0.5, keyframes: [{ t: 0, scroll: { scrollPosition: 0, posY: 0 } }, { t: 1, scroll: { scrollPosition: 1, posY: 0 } }] };
    const [a, b] = await Promise.all([
      withTempOutDir((outDir) => renderArtScene({ recipe, ...SMALL, durationSeconds: 0.5, outDir, timeline })),
      withTempOutDir((outDir) => renderArtScene({ recipe, ...SMALL, durationSeconds: 0.5, outDir, timeline })),
    ]);
    assert.deepEqual(a.frameHashes, b.frameHashes, 'the timeline-driven live-frame selection must be exactly reproducible');
    assert.notEqual(a.frameHashes[0], a.frameHashes[a.frameHashes.length - 1], 'scrollPosition 0 (first frame) vs 1 (last frame) must select genuinely different captured frames');
  } finally {
    _internals.captureDeviceLiveFrames = originalCapture;
  }
});

test('a live capture that produces zero frames rejects the whole render — never a silent placeholder fallback', async () => {
  const originalCapture = _internals.captureDeviceLiveFrames;
  _internals.captureDeviceLiveFrames = async () => ({ frames: [], viewport: { width: 240, height: 150 }, readiness: { ready: false }, scrollInfo: null });
  try {
    const recipe = recipeFor({ clothShape: 'device', devicePrimary: { liveUrl: 'https://example.com' } });
    await assert.rejects(
      () => renderArtScene({ recipe, ...SMALL, durationSeconds: 1 / 12 }),
      (err) => { assert.match(err.message, /no frames/i); return true; },
    );
  } finally {
    _internals.captureDeviceLiveFrames = originalCapture;
  }
});

// ── Live-frame memory ceiling ──────────────────────────────────────────────
// The page used to decode EVERY captured frame up front and hold them all in
// one array. A decoded 1440x900 bitmap is ~5MB, so a real 5-second 30fps
// render (150 captured frames) pinned ~750MB inside the page and further
// decodes began failing with "The source image cannot be decoded" on files
// that were independently verified byte-valid — surfacing only as the
// __sceneReady gate's 120s timeout. Frames are now decoded on demand behind a
// small LRU (art-scene.mjs: ensureDeviceLiveFrame). These two tests pin the
// two properties that fix depends on: the resident count is BOUNDED, and a
// frame that genuinely cannot be decoded still fails loudly by name. ────────

test('captured live frames are decoded ON DEMAND: the peak resident decoded-frame count stays bounded and never scales with the capture length', async () => {
  const originalCapture = _internals.captureDeviceLiveFrames;
  // 48 captured frames (alternating fixtures, each written to its own file by
  // renderArtScene, so each is a genuinely separate decode) against 24 output
  // frames — the old code would have held all 48 decoded at once.
  const frames = Array.from({ length: 48 }, (_, i) => dataUrlFor(i % 2 === 0 ? STILL_FIXTURE : FLYER_FIXTURE));
  _internals.captureDeviceLiveFrames = async () => ({ frames, viewport: { width: 240, height: 150 }, readiness: { ready: true }, scrollInfo: { y: 500 } });
  try {
    const recipe = recipeFor({ clothShape: 'device', devicePrimary: { liveUrl: 'https://example.com' } });
    const [a, b] = await Promise.all([
      withTempOutDir((outDir) => renderArtScene({ recipe, width: 64, height: 64, fps: 12, durationSeconds: 2, outDir })),
      withTempOutDir((outDir) => renderArtScene({ recipe, width: 64, height: 64, fps: 12, durationSeconds: 2, outDir })),
    ]);
    assert.equal(a.liveCapture.frameCount, 48);
    assert.equal(a.frameHashes.length, 24);
    assert.ok(
      a.liveCapture.residentFramePeak > 0 && a.liveCapture.residentFramePeak <= 4,
      `at most a handful of decoded frames may ever be resident at once (got ${a.liveCapture.residentFramePeak} of 48) — retaining them all is the memory ceiling this decodes-on-demand path exists to remove`,
    );
    assert.ok(new Set(a.frameHashes).size > 1, 'lazily decoded frames must still genuinely change across the clip — a collapsed set would mean a stale frame was reused instead of decoded');
    assert.deepEqual(a.frameHashes, b.frameHashes, 'on-demand decoding must not cost determinism: the same recipe + the same captured frames must reproduce identical frames');
  } finally {
    _internals.captureDeviceLiveFrames = originalCapture;
  }
});

test('a captured live frame that genuinely cannot be decoded fails the render loudly BY FRAME — never a silently blank or stale screen', async () => {
  const originalCapture = _internals.captureDeviceLiveFrames;
  const frames = Array.from({ length: 10 }, (_, i) => dataUrlFor(i % 2 === 0 ? STILL_FIXTURE : FLYER_FIXTURE));
  // Frame 9 (the LAST one the clip reaches) is genuine garbage — a late
  // failure, i.e. past the ready gate and inside the frame loop.
  frames[9] = `data:image/jpeg;base64,${Buffer.from('not-a-jpeg-at-all').toString('base64')}`;
  _internals.captureDeviceLiveFrames = async () => ({ frames, viewport: { width: 240, height: 150 }, readiness: { ready: true }, scrollInfo: { y: 500 } });
  try {
    const recipe = recipeFor({ clothShape: 'device', devicePrimary: { liveUrl: 'https://example.com' } });
    await assert.rejects(
      () => renderArtScene({ recipe, width: 64, height: 64, fps: 10, durationSeconds: 1 }),
      (err) => {
        assert.match(err.message, /frame 9/, 'the failure must name the exact captured frame that could not be decoded');
        assert.match(err.message, /failed to decode/i);
        return true;
      },
    );
  } finally {
    _internals.captureDeviceLiveFrames = originalCapture;
  }
});

// ── "Live capture GPU acceleration" checkpoint ──────────────────────────────

test('_internals.liveCaptureLaunchArgs(): the real production live-capture browser launch args include the GPU-enabling flags', () => {
  const args = _internals.liveCaptureLaunchArgs();
  assert.ok(args.includes('--headless=new'), 'GPU acceleration requires the modern headless mode');
  assert.ok(args.includes('--enable-gpu'));
  assert.ok(args.includes('--ignore-gpu-blocklist'));
  assert.ok(args.includes('--no-sandbox'), 'unconditional on every platform, not just the non-darwin ANGLE branch');
  assert.ok(args.includes('--disable-dev-shm-usage'));
  assert.equal(new Set(args).size, args.length, 'no duplicate flags even though the non-darwin ANGLE branch and the explicit trailing flags can both carry --no-sandbox');
});

test('device screen live capture: the GPU probe result (gpu:{renderer,software}) reaches renderArtScene\'s own result.liveCapture — never dropped on the way out', async () => {
  const originalCapture = _internals.captureDeviceLiveFrames;
  const frames = [dataUrlFor(STILL_FIXTURE), dataUrlFor(FLYER_FIXTURE)];
  _internals.captureDeviceLiveFrames = async () => ({
    frames, viewport: { width: 240, height: 150 }, readiness: { ready: true }, scrollInfo: { y: 500 }, gpu: { renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)', software: false },
  });
  try {
    const recipe = recipeFor({ clothShape: 'device', devicePrimary: { liveUrl: 'https://example.com' } });
    const result = await withTempOutDir((outDir) => renderArtScene({ recipe, ...SMALL, durationSeconds: 1 / 12, outDir }));
    assert.deepEqual(result.liveCapture.gpu, { renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)', software: false });
  } finally {
    _internals.captureDeviceLiveFrames = originalCapture;
  }
});

test('a recipe with no live/capture/upload source never triggers the capture DI seam at all', async () => {
  const originalCapture = _internals.captureDeviceLiveFrames;
  let called = false;
  _internals.captureDeviceLiveFrames = async () => { called = true; return { frames: [], viewport: null }; };
  try {
    const recipe = recipeFor({ clothShape: 'device' });
    await withTempOutDir((outDir) => renderArtScene({ recipe, ...SMALL, durationSeconds: 1 / 12, outDir }));
    assert.equal(called, false, 'a plain placeholder-shell recipe must never invoke the live-capture path');
  } finally {
    _internals.captureDeviceLiveFrames = originalCapture;
  }
});

// ── Timeline device scroll/posY (Phase C, "Interrupted export recovery",
// corrected for exact smoothstep-eased parity) — the server-reduced
// {totalSeconds, keyframes:[{t, scroll:{scrollPosition, posY}}]} shape
// (services/studio-render/art-timeline.mjs's own sanitizeArtTimeline; these
// tests pass it in directly, already reduced, exactly as
// proof-render-worker.mjs hands it to renderArtScene from a job's own
// persisted field). ───────────────────────────────────────────────────────

// Calls the REAL resolveTrackState (imported straight from
// app/dashboard/studio/timeline.js above — the exact function
// art-scene.mjs's resolveTimelineScrollAt reuses via the vendored
// ./timeline.js) so the expected trace is computed by the SAME source, not
// an independently hand-copied formula that could itself drift. Only the
// final two-scalar lerp (scrollPosition/posY) is reimplemented here, exact
// at both endpoints — same discipline as blendOrbitPose/resolveTimelineScrollAt.
function expectedTimelineScrollAt(timeline, frameIndex, fps) {
  const kfs = timeline.keyframes;
  const total = timeline.totalSeconds > 0 ? timeline.totalSeconds : 1;
  const t = (frameIndex + 1) / fps;
  const u = Math.min(1, Math.max(0, t / total));
  const state = resolveTrackState({ keyframes: kfs }, u);
  const a = kfs[state.fromIndex].scroll;
  const b = kfs[state.toIndex].scroll;
  const bl = state.blend;
  const lerp = (k) => (bl <= 0 ? a[k] : bl >= 1 ? b[k] : a[k] + (b[k] - a[k]) * bl);
  return { scrollPosition: lerp('scrollPosition'), posY: lerp('posY') };
}

test('timeline device scroll: a 2-keyframe (0->1) track is deterministic across 2 independent runs AND its final frame differs from a no-timeline render (silent-drop guard)', async () => {
  const recipe = recipeFor({ clothShape: 'device' });
  const timeline = { totalSeconds: 0.5, keyframes: [{ t: 0, scroll: { scrollPosition: 0, posY: 0 } }, { t: 1, scroll: { scrollPosition: 1, posY: 0 } }] };
  const [a, b, noTimeline] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe, ...SMALL, durationSeconds: 0.5, outDir, timeline })),
    withTempOutDir((outDir) => renderArtScene({ recipe, ...SMALL, durationSeconds: 0.5, outDir, timeline })),
    withTempOutDir((outDir) => renderArtScene({ recipe, ...SMALL, durationSeconds: 0.5, outDir })),
  ]);
  assert.deepEqual(a.frameHashes, b.frameHashes, 'the timeline-driven scroll pipeline must be exactly reproducible');
  assert.notEqual(
    a.frameHashes[a.frameHashes.length - 1],
    noTimeline.frameHashes[noTimeline.frameHashes.length - 1],
    'an accepted timeline must actually change the render — identical frames would mean it was silently dropped',
  );
});

test('timeline device scroll: the inspection trace matches the exact smoothstep-eased expectation at every sampled frame, including the before-first/after-last clamp regions', async () => {
  const recipe = recipeFor({ clothShape: 'device' });
  const fps = 10;
  const timeline = {
    totalSeconds: 1,
    keyframes: [
      { t: 0.2, scroll: { scrollPosition: 0.1, posY: -0.2 } },
      { t: 0.5, scroll: { scrollPosition: 0.6, posY: 0 } },
      { t: 0.9, scroll: { scrollPosition: 1, posY: 0.4 } },
    ],
  };
  const result = await withTempOutDir((outDir) => renderArtScene({ recipe, width: 64, height: 64, fps, durationSeconds: 1, outDir, timeline }));
  assert.equal(result.timelineScrollTrace.length, 10);
  result.timelineScrollTrace.forEach((applied, frameIndex) => {
    const expected = expectedTimelineScrollAt(timeline, frameIndex, fps);
    assert.ok(Math.abs(applied.scrollPosition - expected.scrollPosition) < 1e-9, `frame ${frameIndex} scrollPosition: got ${applied.scrollPosition}, expected ${expected.scrollPosition}`);
    assert.ok(Math.abs(applied.posY - expected.posY) < 1e-9, `frame ${frameIndex} posY: got ${applied.posY}, expected ${expected.posY}`);
  });
  // Sanity: frame 0 (t=0.1s, u=0.1) is before the first keyframe's t=0.2 -> clamps to its exact value.
  assert.equal(result.timelineScrollTrace[0].scrollPosition, 0.1);
  assert.equal(result.timelineScrollTrace[0].posY, -0.2);
  // Frame 9 (t=1.0s, u=1.0) is after the last keyframe's t=0.9 -> clamps to its exact value.
  assert.equal(result.timelineScrollTrace[9].scrollPosition, 1);
  assert.equal(result.timelineScrollTrace[9].posY, 0.4);
});

test('timeline device scroll: cross-fps final-frame identity holds WITH an active scroll timeline (12fps frame 5 === 30fps frame 14 at t=0.5s)', async () => {
  const recipe = recipeFor({ clothShape: 'device' });
  const timeline = { totalSeconds: 1, keyframes: [{ t: 0, scroll: { scrollPosition: 0, posY: 0 } }, { t: 1, scroll: { scrollPosition: 1, posY: 0.3 } }] };
  const dims = { width: 240, height: 240 };
  const [at12, at30] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe, ...dims, fps: 12, durationSeconds: 0.5, outDir, timeline })),
    withTempOutDir((outDir) => renderArtScene({ recipe, ...dims, fps: 30, durationSeconds: 0.5, outDir, timeline })),
  ]);
  assert.equal(at12.frameHashes[5], at30.frameHashes[14], 'the timeline-applied scroll/posY offset is a pure function of exact frame time, exactly like sway/scroll/glass rotation');
  assert.deepEqual(at12.timelineScrollTrace[5], at30.timelineScrollTrace[14], 'the applied values themselves must also agree exactly, not just the resulting pixels');
});

test('timeline device scroll: AUTO SCROLL ignores the keyframed positions — frame-for-frame identical to a timeline-less auto-scroll render (mirrors deviceAnimate\'s own branch order)', async () => {
  const recipe = recipeFor({ clothShape: 'device', devicePrimary: { scroll: true, scrollSpeed: 0.8 } });
  const timeline = { totalSeconds: 0.5, keyframes: [{ t: 0, scroll: { scrollPosition: 0, posY: 0 } }, { t: 1, scroll: { scrollPosition: 1, posY: 0 } }] };
  const [withTl, without] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe, ...SMALL, durationSeconds: 0.5, outDir, timeline })),
    withTempOutDir((outDir) => renderArtScene({ recipe, ...SMALL, durationSeconds: 0.5, outDir })),
  ]);
  assert.deepEqual(withTl.frameHashes, without.frameHashes, 'AUTO SCROLL must win and ignore the keyframed scroll override entirely, exactly like the live client');
});

test('timeline posY: keyframed posY genuinely moves the device — inspection trace shows it, and the final frame differs from the static (no-timeline) dial value', async () => {
  const recipe = recipeFor({ clothShape: 'device', devicePrimary: { posY: 0 } });
  const timeline = { totalSeconds: 0.5, keyframes: [{ t: 0, scroll: { scrollPosition: 0, posY: 0 } }, { t: 1, scroll: { scrollPosition: 0, posY: 0.6 } }] };
  const [withTl, without] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe, ...SMALL, durationSeconds: 0.5, outDir, timeline })),
    withTempOutDir((outDir) => renderArtScene({ recipe, ...SMALL, durationSeconds: 0.5, outDir })),
  ]);
  assert.notEqual(
    withTl.frameHashes[withTl.frameHashes.length - 1],
    without.frameHashes[without.frameHashes.length - 1],
    'a keyframed posY must visibly move the device — identical frames would mean it was silently ignored',
  );
  assert.equal(withTl.timelineScrollTrace[withTl.timelineScrollTrace.length - 1].posY, 0.6);

  const { deviceInspection } = await inspectScene({ recipe, width: 64, height: 64, fps: 10 });
  assert.equal(deviceInspection.timelineScrollApplied, null, 'inspectScene never calls __renderFrame — the trace field stays at its pre-frame-zero null baseline');
});

test('timeline device scroll: absent on a non-device scene is a strict no-op (never crashes, changes nothing)', async () => {
  const recipe = recipeFor({ clothShape: 'sheet' });
  const timeline = { totalSeconds: 0.5, keyframes: [{ t: 0, scroll: { scrollPosition: 0, posY: 0 } }, { t: 1, scroll: { scrollPosition: 1, posY: 0.5 } }] };
  const [withTl, without] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe, ...SMALL, durationSeconds: 0.5, outDir, timeline })),
    withTempOutDir((outDir) => renderArtScene({ recipe, ...SMALL, durationSeconds: 0.5, outDir })),
  ]);
  assert.deepEqual(withTl.frameHashes, without.frameHashes, 'a timeline carrying only device-scroll data has nothing to apply on a sheet scene');
  assert.equal(withTl.timelineScrollTrace, undefined, 'the trace is only collected for clothShape:\'device\'');
});

// Discriminates eased-vs-linear directly (Phase C correction review
// finding): a mid-segment rawBlend of 0.25 (deliberately NOT 0.5 — smoothstep
// is symmetric about the midpoint, so 0.5 would pass under either curve)
// produces smoothstep(0.25) = 0.15625, not the linear 0.25 a piecewise-linear
// resolver would report. This test FAILS if resolveTimelineScrollAt ever
// regresses back to plain linear interpolation.
test('timeline device scroll: a mid-segment frame is smoothstep-eased, not linear (fails under plain linear interpolation)', async () => {
  const recipe = recipeFor({ clothShape: 'device' });
  const fps = 4;
  const timeline = { totalSeconds: 1, keyframes: [{ t: 0, scroll: { scrollPosition: 0, posY: 0 } }, { t: 1, scroll: { scrollPosition: 1, posY: 0 } }] };
  const result = await withTempOutDir((outDir) => renderArtScene({ recipe, width: 64, height: 64, fps, durationSeconds: 1, outDir, timeline }));
  // Frame 0: t=(0+1)/4=0.25s, u=0.25/1=0.25 — a single segment [0,1], so
  // rawBlend===u===0.25. smoothstep(0.25) = 0.25*0.25*(3-0.5) = 0.15625.
  const applied = result.timelineScrollTrace[0];
  assert.ok(Math.abs(applied.scrollPosition - 0.15625) < 1e-9, `expected smoothstep-eased 0.15625, got ${applied.scrollPosition} (0.25 would mean plain linear, not smoothstep)`);
  assert.notEqual(applied.scrollPosition, 0.25, 'must not equal the plain-linear value at this rawBlend');
  // Cross-check against the shared expectedTimelineScrollAt helper (itself
  // driven by the real resolveTrackState) for the whole trace, not just frame 0.
  result.timelineScrollTrace.forEach((frameApplied, frameIndex) => {
    const expected = expectedTimelineScrollAt(timeline, frameIndex, fps);
    assert.ok(Math.abs(frameApplied.scrollPosition - expected.scrollPosition) < 1e-9, `frame ${frameIndex} scrollPosition mismatch`);
  });
});

// Duplicate-t "hold" keyframes (the camera-templates "parking" pattern —
// app/dashboard/studio/camera-templates.js's own hold-as-duplicate-keyframe
// expansion) must hold their value smoothly, never divide by zero/produce
// NaN — resolveTrackState's `Math.max(1e-6, b.t - a.t)` span floor is what
// guarantees this; this test exercises it with a GENUINE duplicate `t`
// (these tests pass the already-reduced timeline straight to renderArtScene,
// bypassing sanitizeArtTimeline's own tie-nudge — see this section's header).
test('timeline device scroll: duplicate-t hold keyframes hold their value without dividing by zero', async () => {
  const recipe = recipeFor({ clothShape: 'device' });
  const fps = 10;
  const timeline = {
    totalSeconds: 1,
    keyframes: [
      { t: 0, scroll: { scrollPosition: 0, posY: 0 } },
      { t: 0.5, scroll: { scrollPosition: 0.5, posY: 0.2 } },
      { t: 0.5, scroll: { scrollPosition: 0.5, posY: 0.2 } }, // duplicate t — the parked "hold"
      { t: 1, scroll: { scrollPosition: 1, posY: 0 } },
    ],
  };
  const result = await withTempOutDir((outDir) => renderArtScene({ recipe, width: 64, height: 64, fps, durationSeconds: 1, outDir, timeline }));
  assert.equal(result.timelineScrollTrace.length, 10);
  result.timelineScrollTrace.forEach((applied, frameIndex) => {
    assert.ok(Number.isFinite(applied.scrollPosition), `frame ${frameIndex} scrollPosition must be finite, got ${applied.scrollPosition}`);
    assert.ok(Number.isFinite(applied.posY), `frame ${frameIndex} posY must be finite, got ${applied.posY}`);
    const expected = expectedTimelineScrollAt(timeline, frameIndex, fps);
    assert.ok(Math.abs(applied.scrollPosition - expected.scrollPosition) < 1e-9, `frame ${frameIndex} scrollPosition mismatch`);
    assert.ok(Math.abs(applied.posY - expected.posY) < 1e-9, `frame ${frameIndex} posY mismatch`);
  });
  // Frame 4 (t=0.5s, u=0.5) lands exactly on the hold — both duplicate
  // keyframes carry the identical value, so the trace must show it exactly.
  assert.equal(result.timelineScrollTrace[4].scrollPosition, 0.5);
  assert.equal(result.timelineScrollTrace[4].posY, 0.2);
});

// Direct evil-viewport placement assertion (Codex F1 review note: make this
// its own visible automated test, not just an independently-verified fact).
test('deviceBottomLocalY(evil, evil) returns the finite desktop default for __proto__/constructor/toString', async () => {
  const factories = await import('../vendor/elements/factories.js');
  const defaultY = factories.deviceBottomLocalY('desktop', '');
  assert.ok(Number.isFinite(defaultY));
  for (const evil of ['__proto__', 'constructor', 'toString']) {
    assert.equal(factories.deviceBottomLocalY(evil, evil), defaultY, `viewport/model '${evil}' must resolve to the exact desktop default`);
  }
});

// ── Capture Frame parity (frame/crop round) — an active frame renders as a
// NATIVE-resolution crop of the boosted stage (art-scene-def.mjs
// resolveFrameRender), never a stretch, never an upscale, never a HUD
// overlay. frameId 'off' is byte-for-byte the pre-existing path. ──────────

const FRAME_CASES = [
  { frameId: 'square', width: 1080, height: 1080 },
  { frameId: 'portrait', width: 1080, height: 1350 },
  { frameId: 'vertical', width: 1080, height: 1920 },
  { frameId: 'landscape', width: 1920, height: 1080 },
];

test('capability: every real FRAME_PRESET is supported and maps to a fixed allowlisted output preset; unknown ids reject precisely', async () => {
  const { finalRenderFamilyForRecipe } = await import('../art-render-validation.mjs');
  for (const { frameId, width, height } of FRAME_CASES) {
    const recipe = recipeFor({ frameId });
    assert.deepEqual(checkCapabilities(recipe), { supported: true, unsupportedFeatures: [] }, `frame '${frameId}' must not be capability-rejected`);
    assert.equal(finalRenderFamilyForRecipe(recipe), frameId, 'the frame owns the output family');
    const preset = getFinalRenderPreset(`${frameId}-1080p-30`);
    assert.ok(preset, `preset ${frameId}-1080p-30 must exist`);
    assert.equal(preset.width, width);
    assert.equal(preset.height, height);
  }
  const invalid = recipeFor({ frameId: '__proto__' });
  assert.deepEqual(checkCapabilities(invalid).unsupportedFeatures, ['frame-unknown']);
  assert.equal(finalRenderFamilyForRecipe(recipeFor({})), 'landscape', 'frame off still derives from the sheet aspect (auto → landscape)');
});

test('all four frame crops render at EXACT native dimensions with ffprobe-verified metadata', async () => {
  const runs = await Promise.all(FRAME_CASES.map(({ frameId, width, height }) =>
    withTempOutDir(async (outDir) => {
      const r = await renderArtScene({ recipe: recipeFor({ frameId, stageAspect: 16 / 9 }), width, height, fps: 12, durationSeconds: 1 / 12, outDir });
      return { frameId, width, height, metadata: r.metadata };
    })));
  for (const run of runs) {
    assert.equal(run.metadata.width, run.width, `${run.frameId} width`);
    assert.equal(run.metadata.height, run.height, `${run.frameId} height`);
    assert.equal(run.metadata.codec, 'h264');
    assert.equal(run.metadata.frameCount, 1);
  }
});

test('the framed capture is a native-resolution PURE region copy — no stretch, no upscale, no HUD/label/filmstrip/dim overlay — and deterministic across repeat renders', async () => {
  const recipe = recipeFor({ frameId: 'vertical', stageAspect: 16 / 9 });
  const { frameInspection, frameCropProof } = await inspectScene({ recipe, width: 1080, height: 1920, fps: 10 });
  assert.ok(frameInspection.sourceWidth > 1920 && frameInspection.sourceHeight > 1920, 'the source stage is BOOSTED so the crop needs no upscaling');
  assert.ok(Math.abs(frameInspection.cropRect.w - 1080) < 1 && Math.abs(frameInspection.cropRect.h - 1920) < 1, 'the crop rect IS the native target size (ceil-rounding subpixel only) — never a stretched region');
  assert.equal(frameCropProof.pureRegionCopy, true, 'the delivered frame must equal an independent re-crop of the same source byte-for-byte — any overlay/dimming/label breaks this');

  const [a, b] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe, width: 1080, height: 1920, fps: 12, durationSeconds: 1 / 6, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe, width: 1080, height: 1920, fps: 12, durationSeconds: 1 / 6, outDir })),
  ]);
  assert.deepEqual(a.frameHashes, b.frameHashes, 'framed renders must be exactly reproducible');
});

test('frame off remains the unchanged full-canvas path (no frameInspection, no crop), and a framed render differs from the full-canvas render', async () => {
  const off = await inspectScene({ recipe: recipeFor({}), width: 240, height: 240, fps: 10 });
  assert.equal(off.frameInspection, null);
  assert.equal(off.frameCropProof, null);

  const [framed, full] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe: recipeFor({ frameId: 'square', stageAspect: 16 / 9 }), width: 1080, height: 1080, fps: 12, durationSeconds: 1 / 12, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe: recipeFor({}), width: 1080, height: 1080, fps: 12, durationSeconds: 1 / 12, outDir })),
  ]);
  assert.notEqual(framed.frameHashes[0], full.frameHashes[0], "the frame's crop of a 16:9 stage is a genuinely different image from a native square render");
});

test('an extreme stage aspect whose native crop would exceed the source bound rejects precisely — never silently downgraded', async () => {
  // stageAspect 4 with a 9:16 target needs a ~8349px source — over the 4320 bound.
  await assert.rejects(
    () => renderArtScene({ recipe: recipeFor({ frameId: 'vertical', stageAspect: 4 }), width: 1080, height: 1920, fps: 10, durationSeconds: 0.1 }),
    (err) => { assert.match(err.message, /native-resolution 'vertical' crop/); return true; },
  );
});

// ── Diffusion Camera server parity (Phase B, "Interrupted export recovery",
// STUDIO-DETERMINISTIC-FINAL-RENDER-SONNET-HANDOFF.md) — the vendored
// two-pass RenderPass -> diffusionPass -> treatmentPass composer chain,
// real per-frame focal-target resolution via the vendored diffusion-focus.js.
// The composer is built ONLY when diffusionCamera.enabled (see art-scene.mjs's
// own construction-site comment for the activation-decision evidence). ─────

test('diffusion ON genuinely renders and is deterministic: identical recipes are hash-identical, and differ from the same recipe with diffusion OFF', async () => {
  const on = recipeFor({ diffusionCamera: { enabled: true, aperture: 1, diffusionRadius: 1, focusDistance: 0.5 } });
  const off = recipeFor({});
  const [a, b, c] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe: on, ...SMALL, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe: on, ...SMALL, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe: off, ...SMALL, outDir })),
  ]);
  assert.deepEqual(a.frameHashes, b.frameHashes, 'the same diffusion-on recipe must reproduce identical frames — no time-varying/random input anywhere in the composer chain');
  assert.notEqual(a.frameHashes[0], c.frameHashes[0], 'diffusion ON must actually change the rendered frame — accepted-but-omitted would be the silent-drop defect the capability system exists to prevent');
});

test('diffusion OFF is byte-unchanged: a recipe with diffusionCamera.enabled:false reproduces the SAME frame hashes as before this phase (a recipe with no diffusionCamera key at all)', async () => {
  const explicitOff = recipeFor({ diffusionCamera: { enabled: false } });
  const noKeyAtAll = recipeFor({});
  const [a, b] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe: explicitOff, ...SMALL, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe: noKeyAtAll, ...SMALL, outDir })),
  ]);
  assert.deepEqual(a.frameHashes, b.frameHashes, 'diffusionCamera:{enabled:false} must render through the exact same direct renderer.render(scene,camera) path as no diffusionCamera field at all — the composer must never construct for an OFF recipe');
});

test('exact uniform mapping via inspectScene: aperture/falloff/diffusionRadius/highlightBloom/foreground+backgroundBias carry verbatim, bgDiffusion off maps to 0, manual focusDistance is the literal dial value', async () => {
  const recipe = recipeFor({
    diffusionCamera: {
      enabled: true, focalTarget: 'manual', focusDistance: 3.7,
      aperture: 0.77, falloff: 0.22, diffusionRadius: 0.91, highlightBloom: 0.44,
      foregroundBias: -0.5, backgroundBias: 0.8,
    },
    bgFx: { diffusion: false },
  });
  const { diffusionInspection, capabilities } = await inspectScene({ recipe, width: 64, height: 64, fps: 10 });
  assert.equal(capabilities.supported, true);
  assert.equal(diffusionInspection.enabled, true);
  assert.equal(diffusionInspection.resolvedFocalTargetId, 'manual');
  assert.deepEqual(diffusionInspection.uniforms, {
    uFocusDistance: 3.7, uAperture: 0.77, uFalloff: 0.22, uDiffusionRadius: 0.91, uHighlightBloom: 0.44,
    uForegroundBias: -0.5, uBackgroundBias: 0.8, uBgDiffusion: 0, uVignette: 0, uNear: 0.05, uFar: 60, uDiffusionEnabled: 1,
  });
});

test('diffusion OFF: inspectScene reports diffusionInspection null — not an inert-but-present object', async () => {
  const { diffusionInspection } = await inspectScene({ recipe: recipeFor({}), width: 64, height: 64, fps: 10 });
  assert.equal(diffusionInspection, null);
});

test('focal target "origin" resolves to the exact camera-space forward distance to world origin at the default fixed camera pose', async () => {
  // Default (no shotCam) camera position is (0,0,2.6) looking at the
  // origin — camera-space forward distance to (0,0,0) is exactly 2.6.
  const { diffusionInspection } = await inspectScene({
    recipe: recipeFor({ diffusionCamera: { enabled: true, focalTarget: 'origin' } }), width: 64, height: 64, fps: 10,
  });
  assert.equal(diffusionInspection.resolvedFocalTargetId, 'origin');
  assert.ok(Math.abs(diffusionInspection.uniforms.uFocusDistance - 2.6) < 1e-9);
});

test('focal target "primary-artwork" resolves to the sheet mesh\'s own world position (origin) at the default fixed camera pose', async () => {
  const { diffusionInspection } = await inspectScene({
    recipe: recipeFor({ diffusionCamera: { enabled: true, focalTarget: 'primary-artwork' } }), width: 64, height: 64, fps: 10,
  });
  assert.equal(diffusionInspection.resolvedFocalTargetId, 'primary-artwork');
  assert.ok(Math.abs(diffusionInspection.uniforms.uFocusDistance - 2.6) < 1e-9, 'the sheet mesh sits at the world origin, same distance as the "origin" target');
});

test('focal target "glass-petal-sphere-1" resolves to the LIVE glass group world position — a Z offset shifts the resolved distance by the exact same amount', async () => {
  const base = await inspectScene({
    recipe: recipeFor({ diffusionCamera: { enabled: true, focalTarget: 'glass-petal-sphere-1' }, glass: { on: true } }), width: 64, height: 64, fps: 10,
  });
  assert.equal(base.diffusionInspection.resolvedFocalTargetId, 'glass-petal-sphere-1');
  assert.ok(Math.abs(base.diffusionInspection.uniforms.uFocusDistance - 2.6) < 1e-9, 'glass at its default position (origin) is the same distance as the scene origin');

  const shifted = await inspectScene({
    recipe: recipeFor({ diffusionCamera: { enabled: true, focalTarget: 'glass-petal-sphere-1' }, glass: { on: true, position: [0, 0, 1.1] } }), width: 64, height: 64, fps: 10,
  });
  // Camera looks down -Z from z=2.6; moving the glass to z=1.1 (toward the
  // camera) must reduce the resolved forward distance by exactly 1.1.
  assert.ok(Math.abs(shifted.diffusionInspection.uniforms.uFocusDistance - 1.5) < 1e-9, `expected 1.5, got ${shifted.diffusionInspection.uniforms.uFocusDistance}`);
});

test('a focal target that names the primary glass while glass is OFF falls back to "origin" — exactly like the client, never a stale/invalid distance', async () => {
  const { diffusionInspection } = await inspectScene({
    recipe: recipeFor({ diffusionCamera: { enabled: true, focalTarget: 'glass-petal-sphere-1' } }), width: 64, height: 64, fps: 10,
  });
  assert.equal(diffusionInspection.resolvedFocalTargetId, 'origin');
  assert.ok(Math.abs(diffusionInspection.uniforms.uFocusDistance - 2.6) < 1e-9);
});

test('a focal target naming an extraInstances element id (never reachable server-side — extraInstances stays capability-gated) falls back to "origin" — never a crash, never a silently different focus', async () => {
  const { diffusionInspection } = await inspectScene({
    recipe: recipeFor({ diffusionCamera: { enabled: true, focalTarget: 'kinetic-rings-1' } }), width: 64, height: 64, fps: 10,
  });
  assert.equal(diffusionInspection.resolvedFocalTargetId, 'origin');
});

test('frame-crop + diffusion compose: a framed recipe with diffusion on renders deterministically and differs from the framed diffusion-off render', async () => {
  const on = recipeFor({ frameId: 'square', stageAspect: 16 / 9, diffusionCamera: { enabled: true, aperture: 1, diffusionRadius: 1, focusDistance: 0.5 } });
  const off = recipeFor({ frameId: 'square', stageAspect: 16 / 9 });
  const [a, b, c] = await Promise.all([
    withTempOutDir((outDir) => renderArtScene({ recipe: on, width: 1080, height: 1080, fps: 12, durationSeconds: 1 / 12, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe: on, width: 1080, height: 1080, fps: 12, durationSeconds: 1 / 12, outDir })),
    withTempOutDir((outDir) => renderArtScene({ recipe: off, width: 1080, height: 1080, fps: 12, durationSeconds: 1 / 12, outDir })),
  ]);
  assert.equal(a.metadata.width, 1080);
  assert.equal(a.metadata.height, 1080);
  assert.deepEqual(a.frameHashes, b.frameHashes, 'a framed diffusion render must still be exactly reproducible');
  assert.notEqual(a.frameHashes[0], c.frameHashes[0], 'diffusion must genuinely change the framed output too, not just the unframed full-canvas path');
});

test('capability: diffusionCamera never appears in unsupportedFeatures at any enabled/disabled/field combination, and the rest of the gate inventory is unchanged', () => {
  for (const dc of [
    { enabled: true }, { enabled: false }, { enabled: true, focalTarget: 'manual' },
    { enabled: true, focalTarget: 'glass-petal-sphere-1' }, { enabled: true, aperture: 1, diffusionRadius: 1 },
  ]) {
    const recipe = recipeFor({ diffusionCamera: dc });
    assert.ok(!checkCapabilities(recipe).unsupportedFeatures.includes('diffusionCamera'), `diffusionCamera=${JSON.stringify(dc)} must never be gated`);
  }
  // The rest of the gate inventory is unchanged by this phase — fx/
  // extraInstances/background-image/background-transparent/frame-unknown/
  // holographicMaterial/device-screen-* all still reject exactly as before.
  assert.deepEqual(checkCapabilities(recipeFor({ fx: { bloom: true } })).unsupportedFeatures, ['fx']);
  assert.deepEqual(checkCapabilities(recipeFor({ extraInstances: [{ id: 'kinetic-rings-1', type: 'kinetic-rings' }] })).unsupportedFeatures, ['extraInstances']);
  assert.deepEqual(checkCapabilities(recipeFor({ bgMode: 'image' })).unsupportedFeatures, ['background-image']);
});

test('a diffusionCamera-enabled recipe that ALSO requests non-default fx still rejects on the unchanged "fx" gate (the composer is built with default fx values only)', () => {
  const recipe = recipeFor({ diffusionCamera: { enabled: true }, fx: { bloom: true } });
  assert.deepEqual(checkCapabilities(recipe).unsupportedFeatures, ['fx']);
});

// ── bgFx (Phase B — previously documented as inert-and-carried but never
// actually normalized; see art-recipe.mjs's own comment for the gap this
// closes) ────────────────────────────────────────────────────────────────

test('bgFx: defaults mirror ClothStudio.jsx\'s DEFAULT_BG_FX exactly; values sanitize/clamp to the real UI bounds; invalid input yields the same default', () => {
  assert.deepEqual(recipeFor({}).bgFx, { fit: 'cover', shiftY: 0, diffusion: true });
  assert.deepEqual(recipeFor({ bgFx: { fit: 'contain', shiftY: 9, diffusion: false } }).bgFx, { fit: 'contain', shiftY: 1, diffusion: false });
  assert.deepEqual(recipeFor({ bgFx: { fit: 'stretch', shiftY: -9 } }).bgFx, { fit: 'stretch', shiftY: -1, diffusion: true });
  assert.deepEqual(recipeFor({ bgFx: { fit: 'not-a-real-fit' } }).bgFx, { fit: 'cover', shiftY: 0, diffusion: true });
  assert.deepEqual(recipeFor({ bgFx: 'nope' }).bgFx, { fit: 'cover', shiftY: 0, diffusion: true });
});
