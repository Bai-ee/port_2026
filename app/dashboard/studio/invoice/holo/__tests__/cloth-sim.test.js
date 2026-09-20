// Invoice Studio HoloPaper — cloth-sim.js pure numeric unit tests (Lane S).
// No DOM/WebGL involved: every function under test operates on plain typed
// arrays / plain objects only (see cloth-sim.js's own module header).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gridIndex,
  buildConstraints,
  buildRestPositions,
  buildGrid,
  buildPinSet,
  applyRestPose,
  applyRumple,
  integrateVerlet,
  relaxConstraints,
  applyGrabForces,
  selectGrabVertices,
  stepClothSimulation,
} from '../cloth-sim.js';

// ── buildGrid / buildConstraints / buildRestPositions ──────────────────

test('buildGrid returns the right vertex count and a non-empty constraint list', () => {
  const grid = buildGrid(5, 4, 1, 1.3);
  assert.equal(grid.cols, 5);
  assert.equal(grid.rows, 4);
  assert.equal(grid.count, 20);
  assert.equal(grid.positions.length, 60);
  assert.ok(grid.constraints.length > 0);
  // Every constraint must reference valid vertex indices and a finite,
  // positive rest length.
  for (const [a, b, rest] of grid.constraints) {
    assert.ok(a >= 0 && a < grid.count);
    assert.ok(b >= 0 && b < grid.count);
    assert.ok(Number.isFinite(rest) && rest > 0);
  }
});

test('buildConstraints structural-edge count matches the known grid formula', () => {
  // For a cols x rows grid: horizontal structural = (cols-1)*rows, vertical
  // structural = cols*(rows-1). Isolate structural-only constraints by their
  // rest length (restX for horizontal, restY for vertical, distinct here).
  const cols = 6; const rows = 5; const restX = 0.2; const restY = 0.33;
  const constraints = buildConstraints(cols, rows, restX, restY);
  const horizontal = constraints.filter((c) => Math.abs(c[2] - restX) < 1e-9);
  const vertical = constraints.filter((c) => Math.abs(c[2] - restY) < 1e-9);
  assert.equal(horizontal.length, (cols - 1) * rows);
  assert.equal(vertical.length, cols * (rows - 1));
});

test('buildRestPositions centers the grid at the origin with row 0 at the top', () => {
  const cols = 3; const rows = 3; const w = 2; const h = 4;
  const pos = buildRestPositions(cols, rows, w, h);
  // Corner (0,0) — top-left.
  assert.equal(pos[0], -1); // x = -w/2
  assert.equal(pos[1], 2); // y = +h/2 (top)
  // Corner (cols-1, rows-1) — bottom-right, index = (rows*cols - 1).
  const lastIx = gridIndex(cols - 1, rows - 1, cols) * 3;
  assert.equal(pos[lastIx], 1); // x = +w/2
  assert.equal(pos[lastIx + 1], -2); // y = -h/2 (bottom)
});

// ── buildPinSet ──────────────────────────────────────────────────────────

test('buildPinSet: free-float pins nothing', () => {
  assert.equal(buildPinSet(4, 4, 'free-float').size, 0);
});

test('buildPinSet: top-edge pins exactly the whole top row', () => {
  const cols = 5; const rows = 4;
  const pins = buildPinSet(cols, rows, 'top-edge');
  assert.equal(pins.size, cols);
  for (let x = 0; x < cols; x += 1) assert.ok(pins.has(gridIndex(x, 0, cols)));
});

test('buildPinSet: top-corners pins exactly the two top corners', () => {
  const cols = 5; const rows = 4;
  const pins = buildPinSet(cols, rows, 'top-corners');
  assert.equal(pins.size, 2);
  assert.ok(pins.has(gridIndex(0, 0, cols)));
  assert.ok(pins.has(gridIndex(cols - 1, 0, cols)));
});

test('buildPinSet: unrecognized mode falls back to all four corners', () => {
  const cols = 5; const rows = 4;
  const pins = buildPinSet(cols, rows, 'anything-else');
  assert.equal(pins.size, 4);
  assert.ok(pins.has(gridIndex(0, 0, cols)));
  assert.ok(pins.has(gridIndex(cols - 1, 0, cols)));
  assert.ok(pins.has(gridIndex(0, rows - 1, cols)));
  assert.ok(pins.has(gridIndex(cols - 1, rows - 1, cols)));
});

// ── applyRestPose / applyRumple ──────────────────────────────────────────

test('applyRestPose resets positions and prev to orig with zero inferred velocity', () => {
  const orig = new Float32Array([0, 0, 0, 1, 1, 1]);
  const positions = new Float32Array([5, 5, 5, 9, 9, 9]);
  const prev = new Float32Array([-1, -1, -1, -2, -2, -2]);
  applyRestPose(positions, prev, orig);
  assert.deepEqual(Array.from(positions), Array.from(orig));
  assert.deepEqual(Array.from(prev), Array.from(orig));
});

test('applyRumple is deterministic — identical inputs produce identical output', () => {
  const grid = buildGrid(6, 8, 1, 1.3);
  const pins = buildPinSet(grid.cols, grid.rows, 'top-edge');
  const orig = new Float32Array(grid.positions);

  const posA = new Float32Array(orig);
  const prevA = new Float32Array(orig);
  applyRumple(posA, prevA, orig, pins, grid.count, 0.4);

  const posB = new Float32Array(orig);
  const prevB = new Float32Array(orig);
  applyRumple(posB, prevB, orig, pins, grid.count, 0.4);

  assert.deepEqual(Array.from(posA), Array.from(posB));
  assert.deepEqual(Array.from(prevA), Array.from(prevB));
});

test('applyRumple leaves pinned vertices at exact rest position and seeds prev == position (zero velocity)', () => {
  const grid = buildGrid(6, 8, 1, 1.3);
  const pins = buildPinSet(grid.cols, grid.rows, 'top-edge');
  const orig = new Float32Array(grid.positions);
  const positions = new Float32Array(orig);
  const prev = new Float32Array(orig);
  applyRumple(positions, prev, orig, pins, grid.count, 0.5);

  for (const pi of pins) {
    const ix = pi * 3;
    assert.equal(positions[ix], orig[ix]);
    assert.equal(positions[ix + 1], orig[ix + 1]);
    assert.equal(positions[ix + 2], orig[ix + 2]);
  }
  // Every vertex (pinned or not) must have prev === position after rumple —
  // "seeded with zero velocity" per the module header.
  for (let i = 0; i < positions.length; i += 1) {
    assert.equal(prev[i], positions[i]);
  }
  // A non-pinned vertex should actually have MOVED from rest (amount > 0).
  const bottomRowStart = gridIndex(0, grid.rows - 1, grid.cols) * 3;
  const moved = Math.abs(positions[bottomRowStart + 2] - orig[bottomRowStart + 2]) > 1e-6
    || Math.abs(positions[bottomRowStart] - orig[bottomRowStart]) > 1e-6;
  assert.ok(moved, 'a non-pinned vertex should be displaced by the rumple field');
});

test('applyRumple with amount 0 leaves every unpinned vertex at its exact rest x/y (z formula is amount-scaled, so amount=0 -> no displacement at all)', () => {
  const grid = buildGrid(4, 4, 1, 1);
  const pins = buildPinSet(grid.cols, grid.rows, 'free-float');
  const orig = new Float32Array(grid.positions);
  const positions = new Float32Array(orig);
  const prev = new Float32Array(orig);
  applyRumple(positions, prev, orig, pins, grid.count, 0);
  assert.deepEqual(Array.from(positions), Array.from(orig));
});

// ── integrateVerlet — velocity inference / fling behavior ────────────────

test('integrateVerlet: a released point continues its verlet-inferred velocity (no accel, damping=1)', () => {
  // Single "vertex" grid — no pins, no accel. positions is 1 vertex ahead of
  // prev by (0.1, 0, 0), i.e. it was moving at that per-step velocity.
  const positions = new Float32Array([0.1, 0, 0]);
  const prev = new Float32Array([0, 0, 0]);
  integrateVerlet(positions, prev, new Set(), 1 / 60, 1, null);
  // With damping=1 and no acceleration, the point should advance by exactly
  // the same delta again: new position = old position + (old - older).
  // Tolerance is Float32Array-precision-appropriate (~1e-7), not 1e-9 —
  // these buffers are single-precision, matching THREE.BufferAttribute's
  // own array type.
  assert.ok(Math.abs(positions[0] - 0.2) < 1e-6, `expected ~0.2, got ${positions[0]}`);
  // prev is now updated to the pre-step current position (Float32 precision).
  assert.ok(Math.abs(prev[0] - 0.1) < 1e-6, `expected prev ~0.1, got ${prev[0]}`);
});

test('integrateVerlet: a pinned vertex never moves regardless of its prev/accel', () => {
  const positions = new Float32Array([5, 5, 5]);
  const prev = new Float32Array([0, 0, 0]); // huge inferred velocity, should be ignored
  const pins = new Set([0]);
  integrateVerlet(positions, prev, pins, 1 / 60, 1, (i, x, y, z, out) => { out.y = -100; });
  assert.deepEqual(Array.from(positions), [5, 5, 5]);
  assert.deepEqual(Array.from(prev), [0, 0, 0]); // pinned vertices are skipped entirely, prev untouched here
});

test('integrateVerlet: damping < 1 attenuates the inferred velocity each step', () => {
  const positions = new Float32Array([0.1, 0, 0]);
  const prev = new Float32Array([0, 0, 0]);
  integrateVerlet(positions, prev, new Set(), 1, 0.5, null); // dt=1 for simple arithmetic
  // vx = (0.1 - 0) * 0.5 = 0.05; new x = 0.1 + 0.05 = 0.15
  // (Float32Array precision — see the tolerance note in the previous test.)
  assert.ok(Math.abs(positions[0] - 0.15) < 1e-6, `expected ~0.15, got ${positions[0]}`);
});

test('integrateVerlet: gravity-only accel pulls a point downward over repeated steps', () => {
  const positions = new Float32Array([0, 0, 0]);
  const prev = new Float32Array([0, 0, 0]);
  const gravity = (i, x, y, z, out) => { out.y = -1; };
  for (let i = 0; i < 10; i += 1) integrateVerlet(positions, prev, new Set(), 1 / 60, 0.99, gravity);
  assert.ok(positions[1] < 0, 'y should have fallen below 0 under constant downward accel');
  assert.ok(Number.isFinite(positions[1]));
});

// ── relaxConstraints — constraint pulls toward rest length, pins hold ────

test('relaxConstraints pulls two points toward their rest distance', () => {
  // Two vertices, one constraint, rest length 1 — start them 3 apart.
  const positions = new Float32Array([0, 0, 0, 3, 0, 0]);
  const prev = new Float32Array(positions);
  const orig = new Float32Array(positions);
  const constraints = [[0, 1, 1]];
  const distBefore = Math.abs(positions[3] - positions[0]);
  relaxConstraints(positions, prev, constraints, new Set(), orig, 20, 0.5);
  const distAfter = Math.abs(positions[3] - positions[0]);
  assert.ok(distAfter < distBefore, 'distance should shrink toward rest length');
  assert.ok(Math.abs(distAfter - 1) < 0.05, `expected distance close to 1, got ${distAfter}`);
});

test('relaxConstraints: a pinned vertex stays exactly at its rest position across many relaxation passes', () => {
  const grid = buildGrid(5, 5, 1, 1);
  const pins = buildPinSet(grid.cols, grid.rows, 'top-edge');
  const orig = new Float32Array(grid.positions);
  // Perturb EVERY vertex (including pinned ones) far from rest.
  const positions = new Float32Array(orig.length);
  const prev = new Float32Array(orig.length);
  for (let i = 0; i < positions.length; i += 1) { positions[i] = orig[i] + 5; prev[i] = orig[i] + 5; }

  relaxConstraints(positions, prev, grid.constraints, pins, orig, 10, 0.5);

  for (const pi of pins) {
    const ix = pi * 3;
    assert.equal(positions[ix], orig[ix]);
    assert.equal(positions[ix + 1], orig[ix + 1]);
    assert.equal(positions[ix + 2], orig[ix + 2]);
    assert.equal(prev[ix], orig[ix]);
    assert.equal(prev[ix + 1], orig[ix + 1]);
    assert.equal(prev[ix + 2], orig[ix + 2]);
  }
});

// ── selectGrabVertices / applyGrabForces ──────────────────────────────────

test('selectGrabVertices selects vertices within radius with tweezer falloff, and always includes the nearest when nothing is in radius', () => {
  const positions = new Float32Array([
    0, 0, 0, // vertex 0 — exactly at the hit point
    0.01, 0, 0, // vertex 1 — very close
    5, 5, 5, // vertex 2 — far away
  ]);
  const hit = { x: 0, y: 0, z: 0 };
  const sel = selectGrabVertices(positions, 3, new Set(), hit, 0.1);
  assert.ok(sel.idx.includes(0));
  assert.ok(sel.idx.includes(1));
  assert.ok(!sel.idx.includes(2));
  // Nearest (exact hit) should have the highest weight.
  const w0 = sel.w[sel.idx.indexOf(0)];
  const w1 = sel.w[sel.idx.indexOf(1)];
  assert.ok(w0 >= w1);
  assert.ok(w0 <= 0.95 + 1e-9);
});

test('selectGrabVertices falls back to the single nearest vertex when the radius misses everything', () => {
  const positions = new Float32Array([10, 10, 10, 20, 20, 20]);
  const hit = { x: 0, y: 0, z: 0 };
  const sel = selectGrabVertices(positions, 2, new Set(), hit, 0.001);
  assert.equal(sel.idx.length, 1);
  assert.equal(sel.idx[0], 0); // vertex 0 is nearer to the origin than vertex 1
  assert.equal(sel.w[0], 0.95);
});

test('selectGrabVertices excludes pinned vertices even when closest', () => {
  const positions = new Float32Array([0, 0, 0, 1, 1, 1]);
  const hit = { x: 0, y: 0, z: 0 };
  const sel = selectGrabVertices(positions, 2, new Set([0]), hit, 5);
  assert.ok(!sel.idx.includes(0));
  assert.ok(sel.idx.includes(1));
});

test('applyGrabForces pulls grabbed vertices toward target + per-vertex offset, weighted', () => {
  const positions = new Float32Array([0, 0, 0]);
  const grab = {
    active: true, idx: [0], w: [1], off: [0, 0, 0], target: { x: 10, y: 0, z: 0 },
  };
  applyGrabForces(positions, grab);
  // weight 1 => full jump to target this call
  assert.ok(Math.abs(positions[0] - 10) < 1e-9);
});

test('applyGrabForces is a no-op when grab is inactive or absent', () => {
  const positions = new Float32Array([1, 2, 3]);
  applyGrabForces(positions, null);
  applyGrabForces(positions, { active: false, idx: [0], w: [1], off: [0, 0, 0], target: { x: 99, y: 99, z: 99 } });
  assert.deepEqual(Array.from(positions), [1, 2, 3]);
});

// ── stepClothSimulation — orchestration + stability ───────────────────────

test('stepClothSimulation orchestrates integrate -> relax -> grab in order and keeps positions finite', () => {
  const grid = buildGrid(6, 8, 1, 1.3);
  const pins = buildPinSet(grid.cols, grid.rows, 'top-edge');
  const orig = new Float32Array(grid.positions);
  const positions = new Float32Array(orig);
  const prev = new Float32Array(orig);
  applyRumple(positions, prev, orig, pins, grid.count, 0.3);

  const state = {
    positions, prevPositions: prev, origPositions: orig, constraints: grid.constraints, pins,
  };
  const gravity = (i, x, y, z, out) => { out.y = -0.2; };

  for (let step = 0; step < 300; step += 1) {
    stepClothSimulation(state, {
      dt: 1 / 60, damping: 0.98, stiffness: 0.5, iterations: 5, accel: gravity, grab: null,
    });
  }

  for (let i = 0; i < positions.length; i += 1) {
    assert.ok(Number.isFinite(positions[i]), `position[${i}] should stay finite, got ${positions[i]}`);
  }
  // Bounded: nothing should have flown off to absurd magnitude under a
  // small constant gravity with a pinned top edge and real constraints.
  for (let i = 0; i < positions.length; i += 1) {
    assert.ok(Math.abs(positions[i]) < 50, `position[${i}] should stay bounded, got ${positions[i]}`);
  }
  // Pinned vertices must still be exactly at rest after 300 fixed steps.
  for (const pi of pins) {
    const ix = pi * 3;
    assert.equal(positions[ix], orig[ix]);
    assert.equal(positions[ix + 1], orig[ix + 1]);
    assert.equal(positions[ix + 2], orig[ix + 2]);
  }
});

test('stepClothSimulation: an active grab pulls its vertex toward the target across repeated steps', () => {
  const grid = buildGrid(6, 8, 1, 1.3);
  const pins = buildPinSet(grid.cols, grid.rows, 'top-edge');
  const orig = new Float32Array(grid.positions);
  const positions = new Float32Array(orig);
  const prev = new Float32Array(orig);

  // Grab the bottom-center-ish vertex and drag it far to the right.
  const grabIdx = gridIndex(3, grid.rows - 1, grid.cols);
  const grab = {
    active: true, idx: [grabIdx], w: [0.9], off: [0, 0, 0], target: { x: 3, y: -1, z: 0 },
  };
  const state = {
    positions, prevPositions: prev, origPositions: orig, constraints: grid.constraints, pins,
  };
  const startX = positions[grabIdx * 3];
  for (let step = 0; step < 120; step += 1) {
    stepClothSimulation(state, {
      dt: 1 / 60, damping: 0.98, stiffness: 0.5, iterations: 5, accel: null, grab,
    });
  }
  const endX = positions[grabIdx * 3];
  assert.ok(endX > startX + 0.5, `grabbed vertex should have moved substantially toward target.x=3, went from ${startX} to ${endX}`);
});
