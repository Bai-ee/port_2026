// timeline-vendor.test.mjs — Phase C correction ("exact smoothstep-eased
// parity" checkpoint, STUDIO-DETERMINISTIC-FINAL-RENDER-SONNET-HANDOFF.md).
// Vendor-sync guarantees, same discipline as diffusion-camera-vendor.test.mjs
// / scene-presets-vendor.test.mjs / art-recipe.test.mjs's vendor-elements
// tests:
//   1. `vendor/timeline.js` is byte-identical to the real
//      app/dashboard/studio/timeline.js — the drift guard that ties
//      art-scene.mjs's `import { resolveTrackState } from './timeline.js'`
//      to its real source, so a future client-side edit to timeline.js's
//      straddling-pair/smoothstep resolver can never silently drift from
//      what the server render actually runs.
//   2. `vendorTimeline()` is idempotent — running it twice produces
//      byte-identical committed output both times.
//   3. `resolveTrackState` (imported straight from the vendored file, the
//      SAME module art-scene.mjs imports) actually applies the smoothstep
//      curve, not linear — a lightweight sanity check independent of the
//      full-Chromium art-render.test.mjs suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vendorTimeline, TIMELINE_TARGET } from '../scripts/vendor-timeline.mjs';
import { resolveTrackState } from '../vendor/timeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVICE_DIR = path.resolve(__dirname, '..');
const TIMELINE_SOURCE = path.resolve(SERVICE_DIR, '../../app/dashboard/studio/timeline.js');

test('vendor sync: vendor/timeline.js is byte-identical to the real app/dashboard/studio/timeline.js', () => {
  const real = readFileSync(TIMELINE_SOURCE, 'utf8');
  const vendored = readFileSync(TIMELINE_TARGET, 'utf8');
  assert.equal(vendored, real, 'vendor/timeline.js is out of sync — re-run: node services/studio-render/scripts/vendor-timeline.mjs');
});

test('vendorTimeline() is idempotent — running it twice produces byte-identical committed output both times', () => {
  const before = readFileSync(TIMELINE_TARGET, 'utf8');
  vendorTimeline();
  const after = readFileSync(TIMELINE_TARGET, 'utf8');
  assert.equal(after, before);
});

test('the vendored resolveTrackState applies smoothstep easing, not linear, at a mid-segment blend', () => {
  const tl = { keyframes: [{ t: 0 }, { t: 1 }] };
  const state = resolveTrackState(tl, 0.25);
  // smoothstep(0.25) = 0.25*0.25*(3-2*0.25) = 0.15625 — a plain linear
  // resolver would instead report rawBlend itself (0.25) as `blend`.
  assert.equal(state.rawBlend, 0.25);
  assert.ok(Math.abs(state.blend - 0.15625) < 1e-9, `expected smoothstep-eased blend 0.15625, got ${state.blend}`);
  assert.notEqual(state.blend, state.rawBlend, 'blend must differ from rawBlend — a linear resolver would make them equal');
});
