// art-recipe.test.mjs — Slice 4a. Pure unit tests, no Cloud Run/network/
// filesystem writes, no rendering. NOT part of `npm test`'s glob today
// (services/**/__tests__ isn't one of its patterns — see package.json) —
// run directly: `node --test services/studio-render/__tests__/art-recipe.test.mjs`.
// See the Slice 4a checkpoint doc for why this wasn't wired into the root
// glob (a deliberate, flagged, minor follow-up decision, not an oversight).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, cpSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import * as artRecipe from '../art-recipe.mjs';
import * as videoPromoRecipe from '../recipe.mjs';
import { vendorElements, VENDORED_FILES } from '../scripts/vendor-elements.mjs';

const { normalizeArtSceneRecipe, ArtRecipeValidationError, RECIPE_KIND, RECIPE_SCHEMA_VERSION, PRIMARY_ELEMENT_ID } = artRecipe;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLOTH_STUDIO_PATH = path.resolve(__dirname, '../../../app/dashboard/studio/ClothStudio.jsx');
const clothStudioSource = readFileSync(CLOTH_STUDIO_PATH, 'utf8');

function payload(scene) {
  return { kind: RECIPE_KIND, schemaVersion: RECIPE_SCHEMA_VERSION, scene };
}

// ── Enum-parity cross-check against ClothStudio.jsx's real source text ─────
// Reads the file as TEXT (never imports/executes it — see art-recipe.mjs's
// own header comment for why) and extracts each enum's real keys, asserting
// this module's duplicated lists still match. A future ClothStudio.jsx enum
// edit that isn't mirrored in art-recipe.mjs fails here immediately.

function extractTopLevelKeys(source, constName) {
  const startIdx = source.indexOf(`const ${constName} = {`);
  assert.ok(startIdx >= 0, `could not find "const ${constName} = {" in ClothStudio.jsx`);
  let depth = 0;
  let started = false;
  let i = startIdx;
  const keys = [];
  const keyRe = /^\s*(?:'([^']+)'|([A-Za-z0-9_-]+)):\s*\{/;
  const lines = source.slice(startIdx).split('\n');
  for (const line of lines) {
    if (depth === 1) {
      const m = keyRe.exec(line);
      if (m) keys.push(m[1] || m[2]);
    }
    for (const ch of line) {
      if (ch === '{') { depth += 1; started = true; }
      else if (ch === '}') depth -= 1;
    }
    if (started && depth <= 0) break;
  }
  return keys;
}

function extractArrayLiteral(source, constName) {
  const m = new RegExp(`const ${constName} = \\[([^\\]]*)\\];`).exec(source);
  assert.ok(m, `could not find "const ${constName} = [...]" in ClothStudio.jsx`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function extractArrayOfIds(source, constName) {
  const startIdx = source.indexOf(`const ${constName} = [`);
  assert.ok(startIdx >= 0, `could not find "const ${constName} = [" in ClothStudio.jsx`);
  const endIdx = source.indexOf('\n];', startIdx);
  const block = source.slice(startIdx, endIdx);
  return [...block.matchAll(/id:\s*'([^']+)'/g)].map((x) => x[1]);
}

test('enum parity: PERF_LEVEL_IDS matches ClothStudio.jsx PERF_LEVELS', () => {
  assert.deepEqual(artRecipe.PERF_LEVEL_IDS, extractTopLevelKeys(clothStudioSource, 'PERF_LEVELS'));
});
test('enum parity: FINISHES matches ClothStudio.jsx FINISHES', () => {
  assert.deepEqual(artRecipe.FINISHES, extractArrayLiteral(clothStudioSource, 'FINISHES'));
});
test('enum parity: PIN_MODE_IDS matches ClothStudio.jsx PIN_MODES', () => {
  assert.deepEqual(artRecipe.PIN_MODE_IDS, extractArrayOfIds(clothStudioSource, 'PIN_MODES'));
});
test('enum parity: MATERIAL_PRESET_IDS matches Object.keys(ClothStudio.jsx MATERIAL_PRESETS)', () => {
  assert.deepEqual(artRecipe.MATERIAL_PRESET_IDS, extractTopLevelKeys(clothStudioSource, 'MATERIAL_PRESETS'));
});
test('enum parity: LIGHT_TEMPLATE_IDS matches ClothStudio.jsx LIGHT_TEMPLATES', () => {
  assert.deepEqual(artRecipe.LIGHT_TEMPLATE_IDS, extractTopLevelKeys(clothStudioSource, 'LIGHT_TEMPLATES'));
});
test('enum parity: FRAME_PRESET_IDS matches ClothStudio.jsx FRAME_PRESETS', () => {
  assert.deepEqual(artRecipe.FRAME_PRESET_IDS, extractTopLevelKeys(clothStudioSource, 'FRAME_PRESETS'));
});
test('enum parity: ENV_PRESET_IDS matches ClothStudio.jsx ENV_PRESETS', () => {
  assert.deepEqual(artRecipe.ENV_PRESET_IDS, extractTopLevelKeys(clothStudioSource, 'ENV_PRESETS'));
});
test('enum parity: FX_PRESET_IDS matches ClothStudio.jsx FX_PRESETS', () => {
  assert.deepEqual(artRecipe.FX_PRESET_IDS, extractTopLevelKeys(clothStudioSource, 'FX_PRESETS'));
});
test('enum parity: SCENE_PRESET_IDS matches ClothStudio.jsx SCENE_PRESETS', () => {
  assert.deepEqual(artRecipe.SCENE_PRESET_IDS, extractTopLevelKeys(clothStudioSource, 'SCENE_PRESETS'));
});
test('enum parity: CLOTH_ASPECT_IDS matches ClothStudio.jsx CLOTH_ASPECTS', () => {
  assert.deepEqual(artRecipe.CLOTH_ASPECT_IDS, extractTopLevelKeys(clothStudioSource, 'CLOTH_ASPECTS'));
});
test('enum parity: VIDEO_FORMAT_IDS matches ClothStudio.jsx VIDEO_FORMATS', () => {
  assert.deepEqual(artRecipe.VIDEO_FORMAT_IDS, extractTopLevelKeys(clothStudioSource, 'VIDEO_FORMATS'));
});
test('enum parity: TREATMENT_IDS matches ClothStudio.jsx TREATMENTS', () => {
  assert.deepEqual(artRecipe.TREATMENT_IDS, extractTopLevelKeys(clothStudioSource, 'TREATMENTS'));
});
test('enum parity: BUILTIN_ARTWORK_IDS matches ClothStudio.jsx BUILTIN_ARTWORKS', () => {
  assert.deepEqual(artRecipe.BUILTIN_ARTWORK_IDS, extractArrayOfIds(clothStudioSource, 'BUILTIN_ARTWORKS'));
});
test('enum parity: PRIMARY_ELEMENT_ID matches ClothStudio.jsx', () => {
  const m = /const PRIMARY_ELEMENT_ID = '([^']+)';/.exec(clothStudioSource);
  assert.ok(m);
  assert.equal(PRIMARY_ELEMENT_ID, m[1]);
});

// ── Minimal valid recipe / safe defaults ────────────────────────────────────

test('an empty scene normalizes to every documented default', () => {
  const result = normalizeArtSceneRecipe(payload({}));
  assert.equal(result.kind, RECIPE_KIND);
  assert.equal(result.schemaVersion, RECIPE_SCHEMA_VERSION);
  assert.equal(result.primaryElementId, 'glass-petal-sphere-1');
  assert.equal(result.recipe.perf, 'high');
  assert.equal(result.recipe.mat.preset, '');
  assert.equal(result.recipe.mat.baseColor, '#ffffff');
  assert.equal(result.recipe.phys.pinMode, 'free-float');
  assert.equal(result.recipe.lightTemplate, 'studio');
  assert.deepEqual(result.recipe.lightCans[0], { on: true, color: '#ffffff', intensity: 1.6, az: 35, el: 40 });
  assert.equal(result.recipe.shotCam.dist, 3.2);
  assert.equal(result.recipe.diffusionCamera.enabled, false);
  assert.equal(result.recipe.frameId, 'off');
  assert.equal(result.recipe.envId, 'room');
  assert.equal(result.recipe.fxPresetId, '');
  assert.equal(result.recipe.clothAspect, 'auto');
  assert.equal(result.recipe.clothShape, 'sheet');
  assert.deepEqual(result.recipe.textLayers, []);
  assert.equal(result.recipe.artworkRatio, null);
  assert.equal(result.recipe.artworkId, 'brock');
  assert.equal(result.recipe.bgMode, 'color');
  assert.equal(result.recipe.sceneId, 'thriller');
  assert.equal(result.recipe.envIntensity, 0.65);
  assert.equal(result.recipe.videoSeconds, 5);
  assert.equal(result.recipe.videoFormat, 'mp4');
  assert.equal(result.recipe.sceneSeed, 1);
  assert.equal(result.recipe.lookSeed, 1);
  assert.deepEqual(result.recipe.extraInstances, []);
  assert.equal(result.recipe.elementFormatId, 'landscape');
  assert.equal(result.recipe.elementQualityTier, 'draft');
  // Phase B (Diffusion Camera server parity) — always true now, a fixed
  // capability flag independent of this recipe's own diffusionCamera.enabled.
  assert.equal(result.support.diffusionCamera, true);
  assert.deepEqual(result.recipe.bgFx, { fit: 'cover', shiftY: 0, diffusion: true });
  assert.deepEqual(result.warnings, []);
  // hudOn/elementLocks/randomizeIntensity must never appear — editor-only.
  assert.equal(result.recipe.hudOn, undefined);
  assert.equal(result.recipe.elementLocks, undefined);
  assert.equal(result.recipe.randomizeIntensity, undefined);
});

// ── A representative FULL captureSceneRecipe fixture ────────────────────────

const FULL_FIXTURE = {
  perf: 'medium',
  mat: {
    preset: 'holo-foil', finish: 'glossy', baseColor: '#123456',
    holoIntensity: 0.7, holoScale: 9, bandFreq: 0.3, saturation: 0.8, hueShift: 0.2,
    sparkle: 0.4, specTint: 0.9, iridescence: 0.6, roughness: 0.2, metalness: 0.8,
    clearcoat: 0.5, coatRoughness: 0.1, sheen: 0.3, bump: 0.5, bumpTiling: 4,
  },
  phys: { gravity: 3.1, damping: 0.95, stiffness: 0.6, rebound: 0.4, rumple: 0.5, pinMode: 'top-corners' },
  anim: { on: false, turbulence: 0.3, speed: 1.5 },
  cam: { rotX: false, rotY: true, pan: false },
  lightCans: [
    { on: true, color: '#ff00c8', intensity: 2, az: 10, el: 20 },
    { on: false, color: '#00e5ff', intensity: 1, az: -10, el: -20 },
    { on: true, color: '#ffffff', intensity: 0.5, az: 90, el: 5 },
    { on: false, color: '#ffffff', intensity: 1, az: 0, el: 0 },
  ],
  lightTemplate: 'neon-cross',
  glass: { on: true, scale: 1.5, rotate: false, rotSpeed: 1, tint: '#abcdef', clarity: 0.2, position: [0.2, -0.1, 0.3], rotationOffset: [1, 2, 3] },
  shotCam: { use: true, az: 45, el: 30, dist: 4, fov: 55 },
  diffusionCamera: { enabled: true, locked: true, focalTarget: 'kinetic-rings-1', focusDistance: 3, aperture: 0.6, falloff: 0.4, diffusionRadius: 0.5, highlightBloom: 0.3, foregroundBias: 0.2, backgroundBias: -0.1 },
  camSeed: 42,
  hudOn: false,
  // Phase 0.5 gate-bug fix: tshirtPrint/devicePrimary/sceneTweaks are
  // deliberately absent from the output recipe (see normalizeScene's
  // docstring for the proof each is inert unless an already-gated field is
  // also active) — included here to prove a caller sending them doesn't
  // crash/warn, and that they're silently excluded, same as hudOn below.
  // bgFx IS carried since Phase B (Diffusion Camera server parity) — its
  // own assertion below checks the real sanitized value, not exclusion.
  tshirtPrint: { hangerVisible: false, x: 0.1, y: -0.2, scale: 1.1, rotation: 5, opacity: 0.9 },
  devicePrimary: { viewport: 'mobile', live: true, liveUrl: 'https://example.com' },
  bgFx: { fit: 'contain', shiftY: 0.3, diffusion: false },
  sceneTweaks: { fogDensity: 0.4 },
  frameId: 'square',
  envId: 'sunset',
  fx: { bloom: true, bloomStrength: 1.2, bloomThreshold: 0.6, grain: 0.3, vignette: 0.4, treatment: 'halftone', t1: 12, t2: 30, t3: 0.5, colA: '#000000', colB: '#ffffff' },
  fxPresetId: 'cinema-bloom',
  clothAspect: 'square',
  clothShape: 'tshirt',
  textLayers: [{ id: 'txt-1', on: true, text: 'HEADLINE' }, { id: 'txt-2', on: false, text: 'SUBLINE' }],
  artworkRatio: 1.5,
  artworkId: 'viva-program',
  bgMode: 'image',
  bgColor: '#112233',
  sceneId: 'neon-alley',
  envIntensity: 1.2,
  videoSeconds: 10,
  videoFormat: 'webm',
  sceneSeed: 777,
  lookSeed: 888,
  elementLocks: { 'kinetic-rings-1': { locked: true } },
  extraInstances: [
    { id: 'kinetic-rings-1', type: 'kinetic-rings', enabled: true, transform: { position: [1, 0, 0], scale: [1, 1, 1] } },
  ],
  elementFormatId: 'square',
  elementQualityTier: 'social',
  randomizeIntensity: 'wild',
};

test('a representative full captureSceneRecipe fixture normalizes every field correctly', () => {
  const result = normalizeArtSceneRecipe(payload(FULL_FIXTURE));
  assert.equal(result.recipe.perf, 'medium');
  assert.equal(result.recipe.mat.preset, 'holo-foil');
  assert.equal(result.recipe.mat.baseColor, '#123456');
  assert.equal(result.recipe.phys.pinMode, 'top-corners');
  assert.equal(result.recipe.anim.speed, 1.5);
  assert.equal(result.recipe.cam.rotX, false);
  assert.equal(result.recipe.lightTemplate, 'neon-cross');
  assert.equal(result.recipe.lightCans[0].color, '#ff00c8');
  assert.equal(result.recipe.glass.on, true);
  assert.deepEqual(result.recipe.glass.position, [0.2, -0.1, 0.3]);
  assert.equal(result.recipe.shotCam.fov, 55);
  assert.equal(result.recipe.diffusionCamera.focalTarget, 'kinetic-rings-1');
  assert.equal(result.recipe.camSeed, 42);
  assert.equal(result.recipe.frameId, 'square');
  assert.equal(result.recipe.envId, 'sunset');
  assert.equal(result.recipe.fx.treatment, 'halftone');
  assert.equal(result.recipe.fxPresetId, 'cinema-bloom');
  assert.equal(result.recipe.clothAspect, 'square');
  assert.equal(result.recipe.clothShape, 'tshirt');
  assert.deepEqual(result.recipe.textLayers, [{ on: true }, { on: false }]);
  // Slice E: tshirtPrint IS carried now (clothShape 'tshirt' genuinely
  // renders) — the fixture's values are all within the print-slider bounds,
  // so they carry through unclamped.
  assert.deepEqual(result.recipe.tshirtPrint, { hangerVisible: false, x: 0.1, y: -0.2, scale: 1.1, rotation: 5, opacity: 0.9 });
  // Slice F1: devicePrimary IS carried now (the device shell renders; the
  // fixture's live/liveUrl screen source survives sanitization as plain
  // strings precisely so the capability layer can reject it by name).
  assert.equal(result.recipe.devicePrimary.viewport, 'mobile');
  assert.equal(result.recipe.devicePrimary.live, true);
  assert.equal(result.recipe.devicePrimary.liveUrl, 'https://example.com');
  // Phase B: bgFx IS carried now (diffusion feeds uBgDiffusion whenever
  // diffusionCamera renders) — the fixture's values are all within bounds,
  // so they carry through unclamped.
  assert.deepEqual(result.recipe.bgFx, { fit: 'contain', shiftY: 0.3, diffusion: false });
  // Slice B/C scene parity: sceneTweaks IS carried now (sanitized —
  // fogDensity 0.4 clamps to the Scene Lab slider's real 0.2 max), because
  // bgMode 'scene' genuinely renders and capability is judged from the
  // preset COMPOSED with these tweaks.
  assert.deepEqual(result.recipe.sceneTweaks, { fogDensity: 0.2 });
  assert.equal(result.recipe.artworkRatio, 1.5);
  assert.equal(result.recipe.artworkId, 'viva-program');
  assert.equal(result.recipe.bgMode, 'image');
  assert.equal(result.recipe.sceneId, 'neon-alley');
  assert.equal(result.recipe.envIntensity, 1.2);
  assert.equal(result.recipe.videoSeconds, 10);
  assert.equal(result.recipe.videoFormat, 'webm');
  assert.equal(result.recipe.sceneSeed, 777);
  assert.equal(result.recipe.lookSeed, 888);
  assert.equal(result.recipe.elementFormatId, 'square');
  assert.equal(result.recipe.elementQualityTier, 'social');
  assert.equal(result.recipe.extraInstances.length, 1);
  assert.equal(result.recipe.extraInstances[0].type, 'kinetic-rings');
  assert.equal(result.recipe.extraInstances[0].finalRenderSupported, false, 'kinetic-rings is not yet final-render-supported per catalog.js — must be reported honestly, not assumed');
  assert.deepEqual(result.warnings, []);
});

// ── Deterministic deep-equal normalization ──────────────────────────────────

test('normalizing the same payload twice produces deep-equal results', () => {
  const a = normalizeArtSceneRecipe(payload(FULL_FIXTURE));
  const b = normalizeArtSceneRecipe(payload(FULL_FIXTURE));
  assert.deepEqual(a, b);
});

// ── Enum and numeric boundaries ─────────────────────────────────────────────

test('numeric bounds: mat fields clamp to their real UI slider ranges', () => {
  const result = normalizeArtSceneRecipe(payload({ mat: { roughness: 99, metalness: -5, holoScale: 999, bumpTiling: 0.1 } }));
  assert.equal(result.recipe.mat.roughness, 1);
  assert.equal(result.recipe.mat.metalness, 0);
  assert.equal(result.recipe.mat.holoScale, 30);
  assert.equal(result.recipe.mat.bumpTiling, 1);
});

test('numeric bounds: phys.gravity/damping/stiffness clamp correctly', () => {
  const result = normalizeArtSceneRecipe(payload({ phys: { gravity: 100, damping: 0, stiffness: 5 } }));
  assert.equal(result.recipe.phys.gravity, 4);
  assert.equal(result.recipe.phys.damping, 0.9);
  assert.equal(result.recipe.phys.stiffness, 1);
});

test('numeric bounds: shotCam az/el/dist/fov clamp to real slider ranges', () => {
  const result = normalizeArtSceneRecipe(payload({ shotCam: { az: 999, el: -999, dist: 0.1, fov: 500 } }));
  assert.equal(result.recipe.shotCam.az, 180);
  assert.equal(result.recipe.shotCam.el, -80);
  assert.equal(result.recipe.shotCam.dist, 1.2);
  assert.equal(result.recipe.shotCam.fov, 90);
});

test('numeric bounds: lightCans intensity/az/el clamp per-can', () => {
  const result = normalizeArtSceneRecipe(payload({ lightCans: [
    { on: true, color: '#ffffff', intensity: 50, az: 999, el: 999 },
    { on: true, color: '#ffffff', intensity: 1, az: 0, el: 0 },
    { on: true, color: '#ffffff', intensity: 1, az: 0, el: 0 },
    { on: true, color: '#ffffff', intensity: 1, az: 0, el: 0 },
  ] }));
  assert.equal(result.recipe.lightCans[0].intensity, 3);
  assert.equal(result.recipe.lightCans[0].az, 180);
  assert.equal(result.recipe.lightCans[0].el, 85);
});

test('numeric bounds: diffusionCamera fields clamp to real slider ranges', () => {
  const result = normalizeArtSceneRecipe(payload({ diffusionCamera: { focusDistance: 99, aperture: -5, foregroundBias: -99, backgroundBias: 99 } }));
  assert.equal(result.recipe.diffusionCamera.focusDistance, 4.5);
  assert.equal(result.recipe.diffusionCamera.aperture, 0);
  assert.equal(result.recipe.diffusionCamera.foregroundBias, -1);
  assert.equal(result.recipe.diffusionCamera.backgroundBias, 1);
});

test('numeric bounds: envIntensity clamps to [0, 2.5]', () => {
  assert.equal(normalizeArtSceneRecipe(payload({ envIntensity: 99 })).recipe.envIntensity, 2.5);
  assert.equal(normalizeArtSceneRecipe(payload({ envIntensity: -5 })).recipe.envIntensity, 0);
});

test('numeric bounds: glass scale/rotSpeed/clarity and position/rotationOffset clamp', () => {
  const result = normalizeArtSceneRecipe(payload({ glass: { scale: 99, rotSpeed: -5, clarity: 99, position: [999, -999, 0], rotationOffset: [0, 0, 999] } }));
  assert.equal(result.recipe.glass.scale, 2.2);
  assert.equal(result.recipe.glass.rotSpeed, 0.05);
  assert.equal(result.recipe.glass.clarity, 0.4);
  assert.deepEqual(result.recipe.glass.position, [10, -10, 0]);
  assert.deepEqual(result.recipe.glass.rotationOffset, [0, 0, 10]);
});

test('enum: an invalid mat.preset/finish falls back to the default without rejecting the whole recipe', () => {
  const result = normalizeArtSceneRecipe(payload({ mat: { preset: 'not-a-real-preset', finish: 'crunchy', baseColor: 'red' } }));
  assert.equal(result.recipe.mat.preset, '');
  assert.equal(result.recipe.mat.finish, 'matte');
  assert.equal(result.recipe.mat.baseColor, '#ffffff');
});

test('enum: invalid frameId/envId/sceneId/fxPresetId/videoFormat/clothAspect/clothShape fall back to defaults', () => {
  const result = normalizeArtSceneRecipe(payload({
    frameId: 'bogus', envId: 'bogus', sceneId: 'bogus', fxPresetId: 'bogus', videoFormat: 'bogus', clothAspect: 'bogus', clothShape: 'bogus',
  }));
  assert.equal(result.recipe.frameId, 'off');
  assert.equal(result.recipe.envId, 'room');
  assert.equal(result.recipe.sceneId, 'thriller');
  assert.equal(result.recipe.fxPresetId, '');
  assert.equal(result.recipe.videoFormat, 'mp4');
  assert.equal(result.recipe.clothAspect, 'auto');
  assert.equal(result.recipe.clothShape, 'sheet');
});

// ── Phase 0.5 gate-bug fix: textLayers capability-detection ────────────────
// Not a full sanitizer (see normalizeScene's detectTextLayers helper) — only
// carries the `on` flag checkCapabilities' 'textLayers' gate needs.

test('textLayers: non-array/absent input normalizes to an empty array', () => {
  assert.deepEqual(normalizeArtSceneRecipe(payload({ textLayers: 'not-an-array' })).recipe.textLayers, []);
  assert.deepEqual(normalizeArtSceneRecipe(payload({ textLayers: null })).recipe.textLayers, []);
  assert.deepEqual(normalizeArtSceneRecipe(payload({})).recipe.textLayers, []);
});

test('textLayers: a layer with no explicit `on` defaults to on:true, matching DEFAULT_TEXT_LAYER.on', () => {
  const result = normalizeArtSceneRecipe(payload({ textLayers: [{ text: 'HEADLINE' }] }));
  assert.deepEqual(result.recipe.textLayers, [{ on: true }]);
});

test('textLayers: more than 3 entries truncate to the first 3 (mirrors MAX_TEXT_LAYERS), matching slice-then-filter order', () => {
  const result = normalizeArtSceneRecipe(payload({ textLayers: [{ on: true }, { on: false }, { on: true }, { on: true }, { on: true }] }));
  assert.deepEqual(result.recipe.textLayers, [{ on: true }, { on: false }, { on: true }]);
});

test('textLayers: non-object entries within the first 3 slots are dropped, not padded with a default', () => {
  const result = normalizeArtSceneRecipe(payload({ textLayers: [{ on: true }, 'garbage', null] }));
  assert.deepEqual(result.recipe.textLayers, [{ on: true }]);
});

test('enum: an unsupported videoSeconds value defaults to 5 and records a warning', () => {
  const result = normalizeArtSceneRecipe(payload({ videoSeconds: 4 }));
  assert.equal(result.recipe.videoSeconds, 5);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].field, 'videoSeconds');
});

test('enum: a non-built-in artworkId defaults to "brock" and records a warning', () => {
  const result = normalizeArtSceneRecipe(payload({ artworkId: 'my-custom-local-upload-id' }));
  assert.equal(result.recipe.artworkId, 'brock');
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].field, 'artworkId');
  assert.equal(result.warnings[0].code, 'unsupported-custom-artwork');
});

test('a built-in artworkId (viva-program) is accepted with no warning', () => {
  const result = normalizeArtSceneRecipe(payload({ artworkId: 'viva-program' }));
  assert.equal(result.recipe.artworkId, 'viva-program');
  assert.deepEqual(result.warnings, []);
});

// ── Invalid recipe kind / version ───────────────────────────────────────────

test('rejects a payload with the wrong kind', () => {
  assert.throws(
    () => normalizeArtSceneRecipe({ kind: 'scene', schemaVersion: 1, scene: {} }),
    (err) => { assert.ok(err instanceof ArtRecipeValidationError); assert.equal(err.status, 400); return true; },
  );
});

test('rejects a payload with an unknown schemaVersion', () => {
  assert.throws(
    () => normalizeArtSceneRecipe({ kind: RECIPE_KIND, schemaVersion: 2, scene: {} }),
    (err) => { assert.equal(err.status, 400); return true; },
  );
  assert.throws(
    () => normalizeArtSceneRecipe({ kind: RECIPE_KIND, scene: {} }), // missing entirely
    (err) => { assert.equal(err.status, 400); return true; },
  );
});

test('rejects a payload that is not a plain object, or whose scene is not a plain object', () => {
  assert.throws(() => normalizeArtSceneRecipe(null));
  assert.throws(() => normalizeArtSceneRecipe('a string'));
  assert.throws(() => normalizeArtSceneRecipe([]));
  assert.throws(() => normalizeArtSceneRecipe({ kind: RECIPE_KIND, schemaVersion: 1, scene: 'not-an-object' }));
  assert.throws(() => normalizeArtSceneRecipe({ kind: RECIPE_KIND, schemaVersion: 1, scene: ['array'] }));
  assert.throws(() => normalizeArtSceneRecipe({ kind: RECIPE_KIND, schemaVersion: 1, scene: null }));
});

test('rejects an oversized scene payload', () => {
  const hugeArray = Array.from({ length: 60_000 }, (_, i) => ({ id: `x${i}`, type: 'kinetic-rings' }));
  assert.throws(
    () => normalizeArtSceneRecipe(payload({ extraInstances: hugeArray })),
    (err) => { assert.equal(err.status, 400); return true; },
  );
});

// ── Invalid element types / excessive counts / malformed transforms / non-finite ──

test('extraInstances: an unknown element type is dropped, not rejected', () => {
  const result = normalizeArtSceneRecipe(payload({ extraInstances: [
    { id: 'ghost-1', type: 'not-a-real-catalog-type' },
    { id: 'kinetic-rings-1', type: 'kinetic-rings' },
  ] }));
  assert.equal(result.recipe.extraInstances.length, 1);
  assert.equal(result.recipe.extraInstances[0].id, 'kinetic-rings-1');
});

test('extraInstances: more than MAX_EXTRA_INSTANCES entries truncates, never throws', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `kinetic-rings-${i}`, type: 'kinetic-rings' }));
  const result = normalizeArtSceneRecipe(payload({ extraInstances: many }));
  assert.equal(result.recipe.extraInstances.length, 8);
});

test('extraInstances: a malformed transform (non-array position, non-finite values) falls back to catalog defaults instead of throwing', () => {
  const result = normalizeArtSceneRecipe(payload({ extraInstances: [
    { id: 'kinetic-rings-1', type: 'kinetic-rings', transform: { position: 'not-an-array', scale: [NaN, Infinity, -Infinity] } },
  ] }));
  assert.equal(result.recipe.extraInstances.length, 1);
  const inst = result.recipe.extraInstances[0];
  assert.ok(Array.isArray(inst.transform.position));
  assert.ok(inst.transform.position.every((v) => Number.isFinite(v)));
  assert.ok(inst.transform.scale.every((v) => Number.isFinite(v)));
});

test('extraInstances: duplicate ids keep only the first occurrence, preserving original order', () => {
  const result = normalizeArtSceneRecipe(payload({ extraInstances: [
    { id: 'a', type: 'kinetic-rings' },
    { id: 'b', type: 'kinetic-rings' },
    { id: 'a', type: 'kinetic-rings' },
  ] }));
  assert.deepEqual(result.recipe.extraInstances.map((i) => i.id), ['a', 'b']);
});

test('extraInstances: an entry using the primary element id is dropped', () => {
  const result = normalizeArtSceneRecipe(payload({ extraInstances: [
    { id: PRIMARY_ELEMENT_ID, type: 'kinetic-rings' },
  ] }));
  assert.deepEqual(result.recipe.extraInstances, []);
});

test('non-finite top-level numeric values fall back to defaults instead of propagating NaN/Infinity', () => {
  const result = normalizeArtSceneRecipe(payload({ camSeed: NaN, sceneSeed: Infinity, lookSeed: -Infinity, envIntensity: NaN }));
  assert.equal(result.recipe.camSeed, 1);
  assert.equal(result.recipe.sceneSeed, 1);
  assert.equal(result.recipe.lookSeed, 1);
  assert.equal(result.recipe.envIntensity, 0.65);
});

// ── Diffusion Camera normalization ───────────────────────────────────────────
// support.diffusionCamera flipped to true in Phase B (STUDIO-DETERMINISTIC-
// FINAL-RENDER-SONNET-HANDOFF.md, "Interrupted export recovery") — the
// server art-scene.mjs now genuinely renders the two-pass diffusion/
// treatment composer chain; see art-render-validation.mjs's
// CAPABILITY_CHECKS (the diffusionCamera gate was removed) for the real
// enforcement point.

test('Diffusion Camera fields normalize fully, and support.diffusionCamera is now true (Phase B server parity)', () => {
  const result = normalizeArtSceneRecipe(payload({ diffusionCamera: { enabled: true, locked: true, focalTarget: 'kinetic-rings-1', focusDistance: 3.5, aperture: 0.7 } }));
  assert.equal(result.recipe.diffusionCamera.enabled, true);
  assert.equal(result.recipe.diffusionCamera.locked, true);
  assert.equal(result.recipe.diffusionCamera.focalTarget, 'kinetic-rings-1');
  assert.equal(result.recipe.diffusionCamera.focusDistance, 3.5);
  assert.equal(result.support.diffusionCamera, true);
});

test('Diffusion Camera disabled-by-default recipe still reports support.diffusionCamera as true (a fixed capability flag, never recipe-content-dependent)', () => {
  const result = normalizeArtSceneRecipe(payload({}));
  assert.equal(result.support.diffusionCamera, true);
  assert.ok('diffusionCamera' in result.recipe, 'diffusionCamera fields must still be present even when disabled');
});

// ── Unknown/untrusted output and infrastructure fields ──────────────────────

test('render dimensions, output/storage paths, ownership, billing, job status, and infra fields are never carried through', () => {
  const dangerous = {
    outputPath: '/etc/passwd', storagePath: 'gs://evil-bucket/x', width: 999999, height: 999999,
    ownerUid: 'attacker-uid', clientId: 'attacker-client', billing: { account: 'steal-this' },
    jobStatus: 'done', jobId: 'fake-job', gcpProject: 'human-in-the-loop-a1a19', gcpZone: 'us-east1',
    __proto__: { polluted: true },
  };
  const result = normalizeArtSceneRecipe(payload({ ...FULL_FIXTURE, ...dangerous }));
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('evil-bucket'));
  assert.ok(!serialized.includes('attacker'));
  assert.ok(!serialized.includes('steal-this'));
  assert.ok(!serialized.includes('fake-job'));
  assert.ok(!serialized.includes('human-in-the-loop-a1a19'));
  assert.ok(!serialized.includes('/etc/passwd'));
  assert.equal(result.polluted, undefined);
  // The output's own top-level keys are an exact, closed allowlist.
  assert.deepEqual(Object.keys(result).sort(), ['kind', 'primaryElementId', 'recipe', 'schemaVersion', 'support', 'warnings'].sort());
});

// ── Input object is never mutated ───────────────────────────────────────────

test('normalizeArtSceneRecipe never mutates its input payload', () => {
  const input = payload(JSON.parse(JSON.stringify(FULL_FIXTURE)));
  const snapshot = JSON.parse(JSON.stringify(input));
  normalizeArtSceneRecipe(input);
  assert.deepEqual(input, snapshot);
});

test('the returned recipe is frozen (immutable from the caller\'s perspective)', () => {
  const result = normalizeArtSceneRecipe(payload({}));
  assert.throws(() => { result.kind = 'tampered'; }, /Cannot assign|read.only/i);
});

// ── Deep freeze — every nested object/array, not just the outer shell ──────

test('deep freeze: nested field objects (mat, phys, glass, shotCam, diffusionCamera, fx) reject property mutation', () => {
  const result = normalizeArtSceneRecipe(payload(FULL_FIXTURE));
  assert.throws(() => { result.recipe.mat.roughness = 99; }, TypeError);
  assert.throws(() => { result.recipe.phys.gravity = 99; }, TypeError);
  assert.throws(() => { result.recipe.glass.scale = 99; }, TypeError);
  assert.throws(() => { result.recipe.shotCam.fov = 99; }, TypeError);
  assert.throws(() => { result.recipe.diffusionCamera.aperture = 99; }, TypeError);
  assert.throws(() => { result.recipe.fx.grain = 99; }, TypeError);
  assert.equal(result.recipe.mat.roughness, 0.2, 'value must be unchanged after the rejected mutation');
});

test('deep freeze: lightCans array and each can object reject mutation', () => {
  const result = normalizeArtSceneRecipe(payload(FULL_FIXTURE));
  assert.throws(() => { result.recipe.lightCans.push({}); }, TypeError);
  assert.throws(() => { result.recipe.lightCans[0].intensity = 99; }, TypeError);
});

test('deep freeze: glass.position/rotationOffset arrays reject element mutation', () => {
  const result = normalizeArtSceneRecipe(payload(FULL_FIXTURE));
  assert.throws(() => { result.recipe.glass.position[0] = 99; }, TypeError);
  assert.throws(() => { result.recipe.glass.rotationOffset[0] = 99; }, TypeError);
});

test('deep freeze: extraInstances array, each instance, and their nested transform/material/motion/appearance/random objects reject mutation', () => {
  const result = normalizeArtSceneRecipe(payload(FULL_FIXTURE));
  assert.equal(result.recipe.extraInstances.length, 1);
  assert.throws(() => { result.recipe.extraInstances.push({}); }, TypeError);
  assert.throws(() => { result.recipe.extraInstances[0].enabled = false; }, TypeError);
  assert.throws(() => { result.recipe.extraInstances[0].transform.position = [9, 9, 9]; }, TypeError);
  assert.throws(() => { result.recipe.extraInstances[0].transform.position[0] = 99; }, TypeError);
  assert.throws(() => { result.recipe.extraInstances[0].material.color = '#ffffff'; }, TypeError);
  assert.throws(() => { result.recipe.extraInstances[0].random.groups.transform = true; }, TypeError);
});

test('deep freeze: support and warnings (array and each entry object) reject mutation', () => {
  const result = normalizeArtSceneRecipe(payload({ artworkId: 'unknown-custom-id' }));
  assert.throws(() => { result.support.diffusionCamera = true; }, TypeError);
  assert.throws(() => { result.warnings.push({ field: 'x' }); }, TypeError);
  assert.equal(result.warnings.length, 1);
  assert.throws(() => { result.warnings[0].field = 'tampered'; }, TypeError);
});

test('deep freeze does not affect input non-mutation or JSON serialization', () => {
  const input = payload(JSON.parse(JSON.stringify(FULL_FIXTURE)));
  const snapshot = JSON.parse(JSON.stringify(input));
  const result = normalizeArtSceneRecipe(input);
  assert.deepEqual(input, snapshot, 'input must still be untouched after a deep-frozen result is produced');
  const roundTripped = JSON.parse(JSON.stringify(result));
  assert.deepEqual(roundTripped.recipe.mat, result.recipe.mat, 'a frozen result must still serialize/deserialize normally');
});

// ── Existing Video Promo pipeline is untouched and still passes ────────────

// ── Vendor sync — vendor/elements/ must stay byte-identical to the real
// source, or a future elements/*.js edit silently ships stale logic into the
// Cloud Run image (Codex P1 packaging-boundary fix). ────────────────────────

const SERVICE_DIR = path.resolve(__dirname, '..');
const ELEMENTS_SOURCE_DIR = path.resolve(SERVICE_DIR, '../../app/dashboard/studio/elements');
const VENDOR_ELEMENTS_DIR = path.resolve(SERVICE_DIR, 'vendor/elements');

for (const file of VENDORED_FILES) {
  test(`vendor sync: vendor/elements/${file} is byte-identical to the real elements/${file}`, () => {
    const real = readFileSync(path.join(ELEMENTS_SOURCE_DIR, file), 'utf8');
    const vendored = readFileSync(path.join(VENDOR_ELEMENTS_DIR, file), 'utf8');
    assert.equal(vendored, real, `vendor/elements/${file} is out of sync with the real source — re-run: node services/studio-render/scripts/vendor-elements.mjs`);
  });
}

test('vendor sync: vendor/elements/ contains exactly VENDORED_FILES — nothing extra, nothing missing', () => {
  const actual = readdirSync(VENDOR_ELEMENTS_DIR).sort();
  assert.deepEqual(actual, [...VENDORED_FILES].sort());
});

// vendorElements() is exercised here against an ISOLATED TEMP directory,
// never the canonical services/studio-render/vendor/elements/ (Codex
// re-review: `npm test` runs test files concurrently; calling
// `vendorElements()` with no args previously deleted-and-recreated the
// CANONICAL directory while OTHER concurrently-running test files
// [art-render.test.mjs, proof-render-worker.test.mjs] were importing
// modules from inside it — an observed test-isolation race, not
// hypothetical: `catalog.js` momentarily didn't exist mid-rebuild). The
// canonical directory's own byte-for-byte sync is already fully covered by
// the per-file "vendor sync" tests above, which only ever READ it.
function withTempVendorDir(fn) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'vendor-elements-test-'));
  try { return fn(tempDir); } finally { rmSync(tempDir, { recursive: true, force: true }); }
}

test('vendorElements({targetDir}) copies byte-for-byte identical files into an ISOLATED temp directory, never touching the canonical vendor/elements/', () => {
  withTempVendorDir((tempDir) => {
    const result = vendorElements({ targetDir: tempDir });
    assert.equal(result.targetDir, tempDir);
    for (const file of VENDORED_FILES) {
      const real = readFileSync(path.join(ELEMENTS_SOURCE_DIR, file), 'utf8');
      const isolated = readFileSync(path.join(tempDir, file), 'utf8');
      assert.equal(isolated, real, `isolated vendoring of ${file} must be byte-identical to the real source`);
    }
    const actual = readdirSync(tempDir).sort();
    assert.deepEqual(actual, [...VENDORED_FILES].sort());
  });
  // The canonical directory must be completely unaffected by the isolated
  // run above — still present, still in sync (re-checked here as a direct
  // assertion, not just inferred from the per-file tests running earlier).
  for (const file of VENDORED_FILES) {
    const real = readFileSync(path.join(ELEMENTS_SOURCE_DIR, file), 'utf8');
    const canonical = readFileSync(path.join(VENDOR_ELEMENTS_DIR, file), 'utf8');
    assert.equal(canonical, real, `the canonical vendor/elements/${file} must be untouched by an isolated-targetDir vendorElements() call`);
  }
});

test('vendorElements({targetDir}) is repeatable: running it twice against fresh temp directories produces the same byte-for-byte result both times', () => {
  withTempVendorDir((firstDir) => {
    withTempVendorDir((secondDir) => {
      vendorElements({ targetDir: firstDir });
      vendorElements({ targetDir: secondDir });
      for (const file of VENDORED_FILES) {
        const first = readFileSync(path.join(firstDir, file), 'utf8');
        const second = readFileSync(path.join(secondDir, file), 'utf8');
        assert.equal(first, second, `${file} must vendor identically across independent runs`);
      }
    });
  });
});

// Deliberately NOT tested by calling vendorElements() with zero args here —
// that exact no-args invocation (which defaults to the canonical directory)
// is what deploy-cloud-run.sh relies on unchanged, but exercising it in THIS
// concurrently-run test suite is precisely the race being eliminated. The
// default-parameter wiring itself (`targetDir = TARGET_DIR`) is a one-line,
// low-risk mechanic verified by code review; deploy-cloud-run.sh's own
// behavior is unmodified by this fix (still calls the script with no args).

// ── Service-artifact / build-context simulation (Codex P1 packaging-boundary
// fix) — proves art-recipe.mjs and its full dependency closure load and run
// from an ISOLATED copy containing ONLY the files the real Dockerfile's own
// COPY lines list (parsed from the actual Dockerfile, not a hand-maintained
// duplicate list, so this can't silently drift from it). No Docker daemon,
// no Cloud Run, no GPU, no network, no billing — a plain temp-directory copy
// plus a dynamic import(). ───────────────────────────────────────────────────

function dockerfileCopySources() {
  const dockerfileSource = readFileSync(path.join(SERVICE_DIR, 'Dockerfile'), 'utf8');
  const copyLines = [...dockerfileSource.matchAll(/^COPY\s+(.+)$/gm)].map((m) => m[1].trim());
  // Each line is "COPY <source...> <dest>" — the LAST whitespace-separated
  // token is always the destination; everything before it is source(s).
  return copyLines.flatMap((line) => line.split(/\s+/).slice(0, -1));
}

test('the Dockerfile\'s real COPY list includes art-recipe.mjs and vendor/', () => {
  const sources = dockerfileCopySources();
  assert.ok(sources.includes('art-recipe.mjs'), 'Dockerfile must COPY art-recipe.mjs into the image');
  assert.ok(sources.some((s) => s.replace(/\/$/, '') === 'vendor'), 'Dockerfile must COPY the vendor/ directory into the image');
});

test('art-recipe.mjs and its full dependency closure import and run successfully from an isolated copy of ONLY the Dockerfile\'s real COPY-list files', async () => {
  const sources = dockerfileCopySources();
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'studio-render-artifact-'));
  try {
    for (const rel of sources) {
      const from = path.join(SERVICE_DIR, rel);
      assert.ok(existsSync(from), `Dockerfile COPY source does not exist on disk: ${rel}`);
      cpSync(from, path.join(tempDir, rel), { recursive: true });
    }
    const isolatedArtRecipeUrl = pathToFileURL(path.join(tempDir, 'art-recipe.mjs')).href;
    const isolated = await import(isolatedArtRecipeUrl);
    const result = isolated.normalizeArtSceneRecipe({
      kind: isolated.RECIPE_KIND,
      schemaVersion: isolated.RECIPE_SCHEMA_VERSION,
      scene: { mat: { baseColor: '#123456' }, extraInstances: [{ id: 'kinetic-rings-1', type: 'kinetic-rings' }] },
    });
    assert.equal(result.recipe.mat.baseColor, '#123456');
    assert.equal(result.recipe.extraInstances.length, 1);
    assert.equal(result.recipe.extraInstances[0].type, 'kinetic-rings');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('the existing Video Promo recipe.mjs is untouched and still behaves as before', () => {
  assert.equal(typeof videoPromoRecipe.normalizeRecipe, 'function');
  assert.equal(typeof videoPromoRecipe.isValidUrl, 'function');
  assert.ok(videoPromoRecipe.CAMERA_PRESETS && typeof videoPromoRecipe.CAMERA_PRESETS === 'object');
  const normalized = videoPromoRecipe.normalizeRecipe({ url: 'https://example.com' });
  assert.ok(normalized && typeof normalized === 'object');
  assert.equal(videoPromoRecipe.isValidUrl('https://example.com'), true);
  assert.equal(videoPromoRecipe.isValidUrl('not-a-url'), false);
});

// ── glass.transmission (Phase 5 glass-parity pass — mirrors ClothStudio's
// Codex glass-transparency round: real optical transparency, orthogonal to
// clarity/roughness) ───────────────────────────────────────────────────────

test('glass transmission: defaults to 1 (a pre-transparency-round recipe renders fully transmissive, like the live scene), carries real values, clamps to [0,1]', () => {
  assert.equal(normalizeArtSceneRecipe(payload({})).recipe.glass.transmission, 1);
  assert.equal(normalizeArtSceneRecipe(payload({ glass: { transmission: 0.35 } })).recipe.glass.transmission, 0.35);
  assert.equal(normalizeArtSceneRecipe(payload({ glass: { transmission: 9 } })).recipe.glass.transmission, 1);
  assert.equal(normalizeArtSceneRecipe(payload({ glass: { transmission: -3 } })).recipe.glass.transmission, 0);
});

// ── sceneTweaks (Slice B/C scene/background parity — Codex constraint:
// "normalize and sanitize sceneTweaks; don't silently omit them") ──────────

test('sceneTweaks: numeric fields clamp to the real Scene Lab slider bounds', () => {
  const r = normalizeArtSceneRecipe(payload({
    sceneTweaks: { panoBlur: 5, panoRotY: -900, panoIntensity: 0.01, groundY: 0, fogDensity: 9 },
  })).recipe;
  assert.deepEqual(r.sceneTweaks, { panoBlur: 1, panoRotY: -180, panoIntensity: 0.2, groundY: -0.55, fogDensity: 0.2 });
});

test('sceneTweaks: field PRESENCE is preserved — absent fields stay absent (composeSceneDef distinguishes absent from set), invalid values are dropped not defaulted', () => {
  const r = normalizeArtSceneRecipe(payload({
    sceneTweaks: { panoBlur: 0.5, fogColor: 'not-a-color', ground: 12, mystery: 'field' },
  })).recipe;
  assert.deepEqual(r.sceneTweaks, { panoBlur: 0.5 }, 'only the valid field survives; invalid/unknown fields vanish rather than becoming defaults');
});

test('sceneTweaks: pano/groundTex accept empty-string removal and allowlisted ids only — an arbitrary path can never survive into asset resolution', () => {
  const removed = normalizeArtSceneRecipe(payload({ sceneTweaks: { pano: '', groundTex: '' } })).recipe;
  assert.deepEqual(removed.sceneTweaks, { pano: '', groundTex: '' }, 'explicit removal ("") is a real, carried tweak');

  const allowlisted = normalizeArtSceneRecipe(payload({ sceneTweaks: { pano: '/hdr/venice_sunset_2k.hdr', groundTex: 'wood' } })).recipe;
  assert.deepEqual(allowlisted.sceneTweaks, { pano: '/hdr/venice_sunset_2k.hdr', groundTex: 'wood' });

  const rejected = normalizeArtSceneRecipe(payload({ sceneTweaks: { pano: '/etc/passwd', groundTex: '__proto__' } })).recipe;
  assert.deepEqual(rejected.sceneTweaks, {}, 'non-allowlisted pano paths and unknown groundTex keys are dropped entirely');
});

test('sceneTweaks: bool/color fields sanitize (fogOn, fogColor, ground, groundTint); non-object input yields {}', () => {
  const r = normalizeArtSceneRecipe(payload({
    sceneTweaks: { fogOn: true, fogColor: '#aabbcc', ground: '#112233', groundTint: '#445566' },
  })).recipe;
  assert.deepEqual(r.sceneTweaks, { fogOn: true, fogColor: '#aabbcc', ground: '#112233', groundTint: '#445566' });
  assert.deepEqual(normalizeArtSceneRecipe(payload({ sceneTweaks: 'nope' })).recipe.sceneTweaks, {});
  assert.deepEqual(normalizeArtSceneRecipe(payload({})).recipe.sceneTweaks, {});
});

// ── tshirtPrint (Slice E — T-shirt primary parity) ─────────────────────────

test('tshirtPrint: defaults mirror primary-cloth DEFAULT_TSHIRT_PRINT; values clamp to the exact print-slider UI bounds', () => {
  assert.deepEqual(normalizeArtSceneRecipe(payload({})).recipe.tshirtPrint, { hangerVisible: true, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });
  const clamped = normalizeArtSceneRecipe(payload({
    tshirtPrint: { x: 9, y: -9, scale: 99, rotation: 900, opacity: -1, hangerVisible: false },
  })).recipe.tshirtPrint;
  assert.deepEqual(clamped, { hangerVisible: false, x: 0.3, y: -0.3, scale: 1.8, rotation: 180, opacity: 0 });
});

// ── devicePrimary (Slice F1 — device shell + placeholder screen) ───────────

test('devicePrimary: defaults mirror DEFAULT_DEVICE_PRIMARY; numerics clamp to the real UI bounds; screen sources carry as sanitized strings', () => {
  const d = normalizeArtSceneRecipe(payload({})).recipe.devicePrimary;
  assert.equal(d.viewport, 'desktop');
  assert.deepEqual(d.models, { desktop: 'studio', mobile: 'flagship', tablet: 'pro' });
  assert.equal(d.finish, 'realistic');
  assert.equal(d.scale, 1.45);
  assert.equal(d.seatOnFloor, true);
  assert.equal(d.live, false);
  assert.equal(d.captureUrl, '');

  const clamped = normalizeArtSceneRecipe(payload({
    devicePrimary: { claySoftness: 0, scale: 99, posY: -9, scrollSpeed: 99, swaySpeed: 0, scrollPosition: 2, viewport: 'not-real', finish: 'holographic' },
  })).recipe.devicePrimary;
  assert.equal(clamped.claySoftness, 0.4);
  assert.equal(clamped.scale, 2.2);
  assert.equal(clamped.posY, -0.8);
  assert.equal(clamped.scrollSpeed, 2);
  assert.equal(clamped.swaySpeed, 0.05);
  assert.equal(clamped.scrollPosition, 1);
  assert.equal(clamped.viewport, 'desktop', 'unknown viewport falls back');
  assert.equal(clamped.finish, 'realistic', 'unknown finish falls back');
});

// ── devicePrimary.screenStill (Slice F2 — immutable pinned still) ──────────

test('screenStill: a valid reference carries exactly; a malformed one flags screenStillInvalid (precise rejection downstream, never a silent placeholder)', () => {
  const good = { sha256: 'a'.repeat(64), ext: 'png', width: 1280, height: 3000, bytes: 100000 };
  const carried = normalizeArtSceneRecipe(payload({ devicePrimary: { screenStill: good } })).recipe.devicePrimary;
  assert.deepEqual(carried.screenStill, good);
  assert.equal(carried.screenStillInvalid, undefined);

  for (const bad of [
    { ...good, sha256: '__proto__' },
    { ...good, sha256: 'A'.repeat(64) },
    { ...good, ext: 'svg' },
    { ...good, width: 4 },
    { ...good, width: 8000, height: 8000 }, // sides in range, decoded-pixel product over the 32MP budget
    { ...good, bytes: 9 * 1024 * 1024 },
    'not-an-object',
  ]) {
    const d = normalizeArtSceneRecipe(payload({ devicePrimary: { screenStill: bad } })).recipe.devicePrimary;
    assert.equal(d.screenStill, undefined, `malformed still must not carry: ${JSON.stringify(bad).slice(0, 60)}`);
    assert.equal(d.screenStillInvalid, true, 'presence of a malformed still must be FLAGGED, not silently dropped');
  }

  const absent = normalizeArtSceneRecipe(payload({})).recipe.devicePrimary;
  assert.equal(absent.screenStill, undefined);
  assert.equal(absent.screenStillInvalid, undefined, 'no still at all is not an error — the placeholder shell is the honest default');
});

// ── frameId + stageAspect (Capture Frame parity round) ─────────────────────

test('frameId: known ids carry; MISSING defaults to off with no flag; PRESENT-but-unknown (incl. prototype-chain) flags frameIdInvalid — never a silent off', () => {
  assert.equal(normalizeArtSceneRecipe(payload({ frameId: 'vertical' })).recipe.frameId, 'vertical');
  const absent = normalizeArtSceneRecipe(payload({})).recipe;
  assert.equal(absent.frameId, 'off');
  assert.equal(absent.frameIdInvalid, undefined);
  for (const evil of ['__proto__', 'constructor', 'toString', 'not-a-frame']) {
    const r = normalizeArtSceneRecipe(payload({ frameId: evil })).recipe;
    assert.equal(r.frameId, 'off', `'${evil}' renders nothing itself`);
    assert.equal(r.frameIdInvalid, true, `'${evil}' must be FLAGGED, not silently normalized away`);
  }
});

test('stageAspect: carried and clamped to [0.3, 4]; absent defaults to 16:9', () => {
  assert.equal(normalizeArtSceneRecipe(payload({ stageAspect: 2.35 })).recipe.stageAspect, 2.35);
  assert.equal(normalizeArtSceneRecipe(payload({ stageAspect: 99 })).recipe.stageAspect, 4);
  assert.equal(normalizeArtSceneRecipe(payload({ stageAspect: 0.01 })).recipe.stageAspect, 0.3);
  assert.equal(normalizeArtSceneRecipe(payload({})).recipe.stageAspect, 16 / 9);
});
