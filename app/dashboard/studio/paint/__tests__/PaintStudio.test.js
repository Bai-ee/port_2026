// Focused tests for the pure logic factored out of PaintStudio.jsx into
// ./export-filename.js. The component itself is a .jsx file (JSX syntax,
// React, p5-backed renderer) and is deliberately NOT imported here — this
// repo's `node --test` runner has no JSX/DOM transform, so rendering the
// component is out of scope for this suite (see the integration handoff
// notes). Only the pure, DOM-free helpers are exercised.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildExportFilename, mobileAreaHeightFor } from '../export-filename.js';
import { PAINT_OUTPUT_FORMATS } from '../output-formats.js';

test('buildExportFilename encodes template id, seed, format id, and extension', () => {
  const recipe = { templateId: 'watercolour-bloom', seed: 12345, output: { formatId: 'desktop', width: 2560, height: 1440 } };
  assert.equal(buildExportFilename(recipe, 'png'), 'paint-watercolour-bloom-12345-desktop.png');
  assert.equal(buildExportFilename(recipe, 'json'), 'paint-watercolour-bloom-12345-desktop.json');
});

test('buildExportFilename falls back to safe placeholders on a malformed recipe', () => {
  assert.equal(buildExportFilename({}, 'png'), 'paint-template-0-format.png');
  assert.equal(buildExportFilename(null, 'png'), 'paint-template-0-format.png');
  assert.equal(buildExportFilename({ templateId: 'pigment-burst' }, 'png'), 'paint-pigment-burst-0-format.png');
});

test('mobileAreaHeightFor matches the UX kit per-orientation caps for every real Paint output format', () => {
  const desktop = PAINT_OUTPUT_FORMATS.find((f) => f.id === 'desktop'); // 2560x1440, landscape
  const mobile = PAINT_OUTPUT_FORMATS.find((f) => f.id === 'mobile'); // 1170x2532, portrait
  const square = PAINT_OUTPUT_FORMATS.find((f) => f.id === 'square'); // 2048x2048, square
  assert.equal(mobileAreaHeightFor(desktop), '44vh');
  assert.equal(mobileAreaHeightFor(mobile), '64vh');
  assert.equal(mobileAreaHeightFor(square), '54vh');
});

test('mobileAreaHeightFor defaults safely on missing/invalid input', () => {
  assert.equal(mobileAreaHeightFor(null), '44vh');
  assert.equal(mobileAreaHeightFor({}), '44vh');
  assert.equal(mobileAreaHeightFor({ w: 'x', h: 'y' }), '44vh');
});
