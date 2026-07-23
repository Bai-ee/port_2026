import test from 'node:test';
import assert from 'node:assert/strict';
import { importTemplateJSON, serializeTemplateList, parseTemplateListJSON } from '../templates.js';
import { sanitizeLightCans, sanitizeMat } from '../scene-recipe.js';

// End-to-end regression for the Codex-blocked crash (2026-07-23T17:58:38Z):
// "A schema-v1 Scene Template with recipe.lightCans=[null,null,null,null] is
// accepted with error:null" — true, and BY DESIGN: elements/templates.js
// deliberately stays opaque to recipe shape (see its own header), so import
// accepting a malformed nested recipe is not itself the bug. The bug was
// that nothing downstream validated it before use. This test drives the
// FULL pipeline a real malformed import would go through — untrusted JSON ->
// import -> persisted localStorage round-trip -> the sanitizers ClothStudio's
// applySceneRecipe now calls before touching live state — and proves the
// null-can shape can no longer reach render code un-neutralized.

const NOW = 1700000000000;

function maliciousExportJSON() {
  return JSON.stringify({
    schemaVersion: 1,
    id: 'tpl-attacker',
    scope: 'local',
    kind: 'scene',
    name: 'Malicious Import',
    recipe: {
      lightCans: [null, null, null, null],
      mat: { finish: 'not-a-real-finish', roughness: 'not-a-number', holoIntensity: 0.9 },
    },
    archived: false,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

test('importTemplateJSON accepts a malformed nested recipe — templates.js is deliberately shape-agnostic, this is not the vulnerability', () => {
  const { list, error } = importTemplateJSON([], maliciousExportJSON(), NOW + 1);
  assert.equal(error, null);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].recipe.lightCans, [null, null, null, null], 'confirms the raw malformed shape really does reach storage — the fix is NOT at the import layer');
});

test('the imported malformed recipe survives a persisted-localStorage round-trip unchanged (still malformed going in)', () => {
  const { list } = importTemplateJSON([], maliciousExportJSON(), NOW + 1);
  const json = serializeTemplateList(list);
  const reloaded = parseTemplateListJSON(json);
  assert.equal(reloaded.length, 1);
  assert.deepEqual(reloaded[0].recipe.lightCans, [null, null, null, null]);
});

test('applying the persisted malformed recipe through the sanitizers neutralizes it — no null can, no invalid enum, ready for setLightCans/setMat without crashing', () => {
  const { list } = importTemplateJSON([], maliciousExportJSON(), NOW + 1);
  const json = serializeTemplateList(list);
  const reloaded = parseTemplateListJSON(json);
  const recipe = reloaded[0].recipe;

  const currentLightCans = [
    { on: true, color: '#ffffff', intensity: 1.6, az: 35, el: 40 },
    { on: true, color: '#88ffee', intensity: 0.6, az: -140, el: 15 },
    { on: false, color: '#ffffff', intensity: 1, az: -35, el: 20 },
    { on: false, color: '#ffffff', intensity: 1, az: 180, el: 60 },
  ];
  const sanitizedCans = sanitizeLightCans(recipe.lightCans, currentLightCans);
  // This is the exact operation the blocked review's reproduction crashed on
  // (`c.on` on a null can, inside the lightCans.map render loop) — proving it
  // no longer throws is the regression.
  assert.doesNotThrow(() => sanitizedCans.forEach((c) => { if (c.on) { /* would read c.color/c.intensity here */ } }));
  sanitizedCans.forEach((c, i) => assert.deepEqual(c, currentLightCans[i]));

  const currentMat = { finish: 'glossy', roughness: 0.12, holoIntensity: 0.55, preset: 'black-cloth', baseColor: '#101114', holoScale: 8, bandFreq: 0.35, saturation: 0.6, hueShift: 0, sparkle: 0.25, specTint: 1, iridescence: 0.35, metalness: 0.35, clearcoat: 0.5, coatRoughness: 0.08, sheen: 0.08, bump: 0.79, bumpTiling: 3 };
  const sanitizedMat = sanitizeMat(recipe.mat, currentMat, { finishes: ['glossy', 'satin', 'matte'] });
  assert.equal(sanitizedMat.finish, currentMat.finish, 'invalid finish enum falls back to current rather than poisoning state');
  assert.equal(sanitizedMat.roughness, currentMat.roughness, 'invalid roughness type falls back to current');
  assert.equal(sanitizedMat.holoIntensity, 0.9, 'the one genuinely valid field in the malicious recipe still applies');
});
