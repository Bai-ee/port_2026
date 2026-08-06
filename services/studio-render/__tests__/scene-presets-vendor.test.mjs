// scene-presets-vendor.test.mjs — Phase 5 scene/background parity (Slice
// B/C). Two guarantees:
//   1. DRIFT: the generated vendor/scene-presets.mjs exactly matches a fresh
//      extraction from ClothStudio.jsx (same discipline as the
//      vendor-elements byte-compare tests — edit the tables there without
//      re-running scripts/vendor-scene-presets.mjs and this fails).
//   2. ASSETS: every pano plate and ground-texture file any preset (or the
//      Scene Lab's own PANO_PLATES list) can reference actually exists in
//      this service's committed assets/ mirror — the "exact Studio assets,
//      never silently missing/downgraded" guarantee, enforced at test time
//      instead of discovered as a 404 mid-render.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractConstObject } from '../scripts/vendor-scene-presets.mjs';
import { SCENE_PRESETS, GROUND_TEXTURES, PANO_PLATES } from '../vendor/scene-presets.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clothStudioSource = readFileSync(path.resolve(__dirname, '../../../app/dashboard/studio/ClothStudio.jsx'), 'utf8');
const ASSETS_DIR = path.resolve(__dirname, '../assets');

// The fresh extraction comes out of a `vm` sandbox — a DIFFERENT realm, so
// its objects carry that realm's Object.prototype and deepStrictEqual would
// fail on prototype identity alone. JSON round-tripping normalizes both
// sides to this realm's plain data (the tables are pure JSON-safe data by
// construction — the vendor script's sandbox eval guarantees it).
const asData = (x) => JSON.parse(JSON.stringify(x));

test('vendor sync: SCENE_PRESETS matches a fresh extraction from ClothStudio.jsx', () => {
  assert.deepEqual(asData(SCENE_PRESETS), asData(extractConstObject(clothStudioSource, 'SCENE_PRESETS')));
});

test('vendor sync: GROUND_TEXTURES matches a fresh extraction from ClothStudio.jsx', () => {
  assert.deepEqual(asData(GROUND_TEXTURES), asData(extractConstObject(clothStudioSource, 'GROUND_TEXTURES')));
});

test('vendor sync: PANO_PLATES matches a fresh extraction from ClothStudio.jsx', () => {
  assert.deepEqual(asData(PANO_PLATES), asData(extractConstObject(clothStudioSource, 'PANO_PLATES', '[', ']')));
});

// Public URL path (e.g. '/hdr/venice_sunset_2k.hdr', '/tex/wood_table_diff_2k.jpg')
// → this service's committed mirror path.
function assetPathFor(publicUrl) {
  return path.join(ASSETS_DIR, publicUrl.replace(/^\//, ''));
}

test('every pano any preset or the Scene Lab can reference exists in assets/ (13 2K HDRs + 3 webp plates, exact Studio files)', () => {
  const fromPresets = Object.values(SCENE_PRESETS).map((p) => p.pano).filter(Boolean);
  const fromPlates = PANO_PLATES.map((p) => p.id).filter(Boolean);
  const all = [...new Set([...fromPresets, ...fromPlates])];
  assert.equal(all.length, 16, `expected the known 16 pano plates, got ${all.length}: ${all.join(', ')}`);
  for (const pano of all) {
    assert.ok(existsSync(assetPathFor(pano)), `pano asset missing from assets/ mirror: ${pano}`);
  }
});

test('every ground-texture map/rough file exists in assets/ (7 surfaces, 14 files, exact Studio 2K files)', () => {
  const entries = Object.entries(GROUND_TEXTURES);
  assert.equal(entries.length, 7);
  for (const [key, surf] of entries) {
    assert.ok(existsSync(assetPathFor(surf.map)), `ground map missing for '${key}': ${surf.map}`);
    assert.ok(existsSync(assetPathFor(surf.rough)), `ground rough missing for '${key}': ${surf.rough}`);
    assert.ok(typeof surf.repeat === 'number' && surf.repeat > 0, `ground '${key}' must carry a positive repeat`);
  }
});

test('every preset groundTex key resolves to a real GROUND_TEXTURES entry — no dangling surface names', () => {
  for (const [id, preset] of Object.entries(SCENE_PRESETS)) {
    if (preset.groundTex !== undefined) {
      assert.ok(GROUND_TEXTURES[preset.groundTex], `preset '${id}' references unknown groundTex '${preset.groundTex}'`);
    }
  }
});
