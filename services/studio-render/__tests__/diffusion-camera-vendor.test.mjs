// diffusion-camera-vendor.test.mjs — Phase B (Diffusion Camera server
// parity). Vendor-sync guarantees, same discipline as
// scene-presets-vendor.test.mjs / art-recipe.test.mjs's vendor-elements
// tests:
//   1. `vendor/diffusion-focus.js` is byte-identical to the real
//      app/dashboard/studio/diffusion-focus.js.
//   2. `vendor/diffusion-shaders.mjs`'s DIFFUSION_SHADER/TREATMENT_SHADER
//      match a fresh extraction from ClothStudio.jsx.
//   3. The one small id art-scene.mjs duplicates as a literal (the glass
//      PRIMARY_ELEMENT_ID, since a browser-generated page can't `import`
//      it from the Node-only art-recipe.mjs module) matches the real
//      source of truth.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vendorDiffusionCamera, generateDiffusionShadersModule, DIFFUSION_FOCUS_TARGET, DIFFUSION_SHADERS_TARGET } from '../scripts/vendor-diffusion-camera.mjs';
import { DIFFUSION_SHADER, TREATMENT_SHADER } from '../vendor/diffusion-shaders.mjs';
import { PRIMARY_ELEMENT_ID } from '../art-recipe.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVICE_DIR = path.resolve(__dirname, '..');
const DIFFUSION_FOCUS_SOURCE = path.resolve(SERVICE_DIR, '../../app/dashboard/studio/diffusion-focus.js');
const CLOTHSTUDIO_SOURCE = path.resolve(SERVICE_DIR, '../../app/dashboard/studio/ClothStudio.jsx');

test('vendor sync: vendor/diffusion-focus.js is byte-identical to the real app/dashboard/studio/diffusion-focus.js', () => {
  const real = readFileSync(DIFFUSION_FOCUS_SOURCE, 'utf8');
  const vendored = readFileSync(DIFFUSION_FOCUS_TARGET, 'utf8');
  assert.equal(vendored, real, 'vendor/diffusion-focus.js is out of sync — re-run: node services/studio-render/scripts/vendor-diffusion-camera.mjs');
});

test('vendor sync: DIFFUSION_SHADER/TREATMENT_SHADER match a fresh extraction from ClothStudio.jsx', () => {
  const clothStudioSource = readFileSync(CLOTHSTUDIO_SOURCE, 'utf8');
  const freshModuleSource = generateDiffusionShadersModule(clothStudioSource);
  const vendoredModuleSource = readFileSync(DIFFUSION_SHADERS_TARGET, 'utf8');
  assert.equal(vendoredModuleSource, freshModuleSource, 'vendor/diffusion-shaders.mjs is out of sync — re-run: node services/studio-render/scripts/vendor-diffusion-camera.mjs');
});

test('the vendored DIFFUSION_SHADER/TREATMENT_SHADER carry the exact uniform sets the composer wiring depends on', () => {
  assert.deepEqual(Object.keys(DIFFUSION_SHADER.uniforms).sort(), [
    'tDepth', 'tDiffuse', 'uAperture', 'uBackgroundBias', 'uBgDiffusion', 'uDiffusionEnabled',
    'uDiffusionRadius', 'uFalloff', 'uFar', 'uForegroundBias', 'uFrameCenter', 'uFrameHalf',
    'uFocusDistance', 'uHighlightBloom', 'uNear', 'uRes', 'uVignette',
  ].sort());
  assert.deepEqual(Object.keys(TREATMENT_SHADER.uniforms).sort(), [
    'tDepth', 'tDiffuse', 'uCleanAlphaHole', 'uColA', 'uColB', 'uFrameCenter', 'uGrain', 'uRes', 'uT1', 'uT2', 'uT3', 'uTime',
  ].sort());
  assert.ok(DIFFUSION_SHADER.fragmentShader.includes('uFocusDistance'), 'sanity: real GLSL source, not a stub');
  assert.ok(TREATMENT_SHADER.fragmentShader.includes('linearToOutputTexel'), 'sanity: real GLSL source, not a stub');
});

test('vendorDiffusionCamera() is idempotent — running it twice produces byte-identical committed output both times', () => {
  const before = {
    focus: readFileSync(DIFFUSION_FOCUS_TARGET, 'utf8'),
    shaders: readFileSync(DIFFUSION_SHADERS_TARGET, 'utf8'),
  };
  vendorDiffusionCamera();
  const after = {
    focus: readFileSync(DIFFUSION_FOCUS_TARGET, 'utf8'),
    shaders: readFileSync(DIFFUSION_SHADERS_TARGET, 'utf8'),
  };
  assert.deepEqual(after, before);
});

// ── art-scene.mjs duplicates the glass PRIMARY_ELEMENT_ID as a literal (the
// browser-generated page can't import it from the Node-only art-recipe.mjs
// module — same "small id, duplicated with a drift test" discipline this
// file's own header comment documents for ENV_HDR_URLS etc.) ──────────────
test('art-scene.mjs\'s duplicated DIFFUSION_PRIMARY_ELEMENT_ID literal matches art-recipe.mjs\'s real PRIMARY_ELEMENT_ID', () => {
  const artSceneSource = readFileSync(path.resolve(SERVICE_DIR, 'art-scene.mjs'), 'utf8');
  const m = artSceneSource.match(/const DIFFUSION_PRIMARY_ELEMENT_ID = '([^']+)'/);
  assert.ok(m, 'art-scene.mjs must declare a literal DIFFUSION_PRIMARY_ELEMENT_ID constant');
  assert.equal(m[1], PRIMARY_ELEMENT_ID);
});
