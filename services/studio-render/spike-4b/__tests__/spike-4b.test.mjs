// spike-4b.test.mjs — Slice 4b feasibility spike, encoded as real, repeatable
// assertions (not a one-off manual script). Launches real headless Chromium
// via Playwright — LOCAL only (127.0.0.1 static server, no external network,
// no Cloud Run, no GPU requirement, no billing). Slower than the pure-logic
// suites (each test launches at least one real browser) — see the Slice 4b
// checkpoint for observed per-run timing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHeadlessFixedTimestepSpike } from '../serve-and-capture.mjs';

test('fixed-timestep determinism: the exact same seed + frame count reproduces a byte-identical hash sequence across two independent headless browser launches', async () => {
  const a = await runHeadlessFixedTimestepSpike({ seed: 42, frameCount: 5 });
  const b = await runHeadlessFixedTimestepSpike({ seed: 42, frameCount: 5 });
  assert.deepEqual(a.hashes, b.hashes);
});

test('the fixed-timestep loop genuinely animates: consecutive frames in one run are NOT all identical', async () => {
  const result = await runHeadlessFixedTimestepSpike({ seed: 42, frameCount: 5 });
  assert.equal(new Set(result.hashes).size, 5, 'all 5 frames must be pairwise distinct — a static/non-animating loop would collapse this to 1');
});

test('the seeded texture generator genuinely responds to its seed: two different seeds produce different frame-0 output, the same seed reproduces it', async () => {
  const seed1 = await runHeadlessFixedTimestepSpike({ seed: 1, frameCount: 1 });
  const seed2 = await runHeadlessFixedTimestepSpike({ seed: 2, frameCount: 1 });
  const seed1Again = await runHeadlessFixedTimestepSpike({ seed: 1, frameCount: 1 });
  assert.notEqual(seed1.hashes[0], seed2.hashes[0]);
  assert.equal(seed1.hashes[0], seed1Again.hashes[0]);
});

test('a captured frame is a real, non-trivial PNG', async () => {
  const result = await runHeadlessFixedTimestepSpike({ seed: 7, frameCount: 1 });
  assert.match(result.frames[0], /^data:image\/png;base64,/);
  assert.ok(result.frames[0].length > 1000, 'a real rendered frame should be well more than a blank/degenerate PNG');
});
