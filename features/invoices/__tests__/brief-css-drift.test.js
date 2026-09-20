// Drift guard for the generated ESM mirror features/invoices/brief-css.js
// (produced by scripts/sync-brief-css.mjs from features/scout-intake/brief-css.cjs,
// the source of truth). features/invoices/render.js imports the mirror so it can
// run in a client bundle — if someone edits the .cjs without re-running the
// generator, this test is what catches the two copies silently diverging.
// The mirror deliberately does NOT sit beside its source: features/scout-intake/
// pins "type":"commonjs", which made the mirror CJS and broke the webpack client
// build ("Cannot use 'import.meta' outside a module"). See the generator header.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { BRIEF_CSS as MIRROR_BRIEF_CSS } from '../brief-css.js';

const require = createRequire(import.meta.url);

test('brief-css.js (generated) is byte-identical to brief-css.cjs (source)', () => {
  const { BRIEF_CSS: SOURCE_BRIEF_CSS } = require('../../scout-intake/brief-css.cjs');
  assert.equal(typeof SOURCE_BRIEF_CSS, 'string');
  assert.equal(MIRROR_BRIEF_CSS, SOURCE_BRIEF_CSS);
});
