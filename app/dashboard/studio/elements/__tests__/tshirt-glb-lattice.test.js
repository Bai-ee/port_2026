import test from 'node:test';
import assert from 'node:assert/strict';
import {
  combineBounds, buildLatticeTopology, computeSkinBinding, mapPrimaryStateToLatticeParams, computeGrabRadius,
  LATTICE_BEND_STIFFNESS_RATIO, LATTICE_WIND_STRENGTH_SCALE, LATTICE_WIND_DIRECTION_DEG,
} from '../tshirt-glb-lattice.js';
import { createSimState, advanceSim, isFiniteBuffer, resetSim } from '../tshirt-mesh.js';

// ── combineBounds ────────────────────────────────────────────────────────

test('combineBounds: unions multiple boxes and expands by the margin fraction', () => {
  const boxes = [
    { min: [-1, -2, -3], max: [1, 2, 3] },
    { min: [-2, -1, -3], max: [0, 5, 4] },
  ];
  const out = combineBounds(boxes, 0);
  assert.deepEqual(out.min, [-2, -2, -3]);
  assert.deepEqual(out.max, [1, 5, 4]);
});

test('combineBounds: a positive margin expands every axis outward symmetrically', () => {
  const out = combineBounds([{ min: [0, 0, 0], max: [10, 10, 10] }], 0.1);
  assert.equal(out.min[0], -1);
  assert.equal(out.max[0], 11);
});

// ── buildLatticeTopology ─────────────────────────────────────────────────

function grid(cols = 4, rows = 5, layers = 2) {
  return buildLatticeTopology({ min: [-1, -1, -0.5], max: [1, 1, 0.5], cols, rows, layers, pinRows: 1 });
}

test('buildLatticeTopology: produces exactly cols*rows*layers bones at the expected extremes', () => {
  const g = grid(4, 5, 2);
  assert.equal(g.vertexCount, 4 * 5 * 2);
  assert.equal(g.positions.length, g.vertexCount * 3);
  // corner bone (0,0,0) sits exactly at min
  assert.equal(g.positions[0], -1);
  assert.equal(g.positions[1], -1);
  assert.equal(g.positions[2], -0.5);
});

test('buildLatticeTopology: throws on a degenerate grid (cols/rows < 2)', () => {
  assert.throws(() => buildLatticeTopology({ min: [0, 0, 0], max: [1, 1, 1], cols: 1, rows: 5, layers: 2 }));
});

test('buildLatticeTopology: single-layer (layers=1) still produces a valid, non-empty grid with no XZ/YZ shear', () => {
  const g = buildLatticeTopology({ min: [-1, -1, 0], max: [1, 1, 0], cols: 4, rows: 4, layers: 1, pinRows: 1 });
  assert.equal(g.vertexCount, 16);
  assert.ok(g.constraints.structural.length > 0);
  assert.ok(g.constraints.shear.length > 0); // XY shear still present
});

test('buildLatticeTopology: pinRows pins exactly the top N rows (highest Y), across every column and layer', () => {
  const g = grid(4, 5, 2);
  // rows=5, pinRows=1 -> only row index 4 (the top row) should be pinned
  const idx = (ix, iy, iz) => iz * (4 * 5) + iy * 4 + ix;
  for (let iz = 0; iz < 2; iz += 1) {
    for (let ix = 0; ix < 4; ix += 1) {
      assert.ok(g.pinIndices.has(idx(ix, 4, iz)), `top row (${ix},4,${iz}) should be pinned`);
      assert.ok(!g.pinIndices.has(idx(ix, 3, iz)), `second-from-top row (${ix},3,${iz}) should NOT be pinned`);
      assert.ok(!g.pinIndices.has(idx(ix, 0, iz)), `bottom row (${ix},0,${iz}) should NOT be pinned`);
    }
  }
});

test('buildLatticeTopology: every constraint pair references valid, in-range, distinct bone indices', () => {
  const g = grid(5, 6, 2);
  const all = [...g.constraints.structural, ...g.constraints.shear, ...g.constraints.bend];
  assert.ok(all.length > 0);
  all.forEach(([a, b]) => {
    assert.ok(a >= 0 && a < g.vertexCount);
    assert.ok(b >= 0 && b < g.vertexCount);
    assert.notEqual(a, b);
  });
});

test('buildLatticeTopology: output shape is a drop-in match for tshirt-mesh.js createSimState — no adapter needed', () => {
  const g = grid();
  const sim = createSimState(g);
  assert.equal(sim.vertexCount, g.vertexCount);
  assert.equal(sim.position.length, g.vertexCount * 3);
  assert.equal(sim.structuralRest.length, g.constraints.structural.length);
});

// ── computeSkinBinding ───────────────────────────────────────────────────

test('computeSkinBinding: a vertex exactly at a bone position gets that bone as its dominant (near-1.0) weight', () => {
  const bones = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]); // 4 bones
  const verts = new Float32Array([0, 0, 0]); // one vertex, exactly at bone 0
  const { skinIndex, skinWeight } = computeSkinBinding(verts, bones, 4);
  assert.equal(skinIndex[0], 0);
  assert.ok(skinWeight[0] > 0.9, `expected dominant weight near 1.0, got ${skinWeight[0]}`);
});

test('computeSkinBinding: weights for every vertex sum to 1 (normalized)', () => {
  const bones = new Float32Array([0, 0, 0, 5, 0, 0, 0, 5, 0, 5, 5, 0, 0, 0, 5]); // 5 bones
  const verts = new Float32Array([1, 2, 1, 3, 3, 3, -2, -2, -2]); // 3 vertices
  const { skinWeight } = computeSkinBinding(verts, bones, 4);
  for (let v = 0; v < 3; v += 1) {
    let sum = 0;
    for (let j = 0; j < 4; j += 1) sum += skinWeight[v * 4 + j];
    assert.ok(Math.abs(sum - 1) < 1e-5, `vertex ${v} weights should sum to 1, got ${sum}`);
  }
});

test('computeSkinBinding: gracefully handles fewer bones than k (does not crash, still normalizes)', () => {
  const bones = new Float32Array([0, 0, 0, 1, 1, 1]); // 2 bones only
  const verts = new Float32Array([0.5, 0.5, 0.5]);
  const { skinIndex, skinWeight } = computeSkinBinding(verts, bones, 4);
  let sum = 0;
  for (let j = 0; j < 4; j += 1) sum += skinWeight[j];
  assert.ok(Math.abs(sum - 1) < 1e-5);
  assert.ok(skinIndex[0] === 0 || skinIndex[0] === 1);
});

test('computeSkinBinding: a closer bone always gets a larger weight than a farther one', () => {
  const bones = new Float32Array([0, 0, 0, 100, 100, 100]);
  const verts = new Float32Array([1, 0, 0]); // much closer to bone 0
  const { skinWeight } = computeSkinBinding(verts, bones, 2);
  assert.ok(skinWeight[0] > skinWeight[1]);
});

// ── computeGrabRadius ────────────────────────────────────────────────────

test('computeGrabRadius: scales up with the lattice\'s own size, not a fixed constant', () => {
  const small = grid(4, 5, 2); // bounds [-1,-1,-0.5]..[1,1,0.5]
  const large = buildLatticeTopology({ min: [-10, -10, -5], max: [10, 10, 5], cols: 4, rows: 5, layers: 2, pinRows: 1 });
  const rSmall = computeGrabRadius(small);
  const rLarge = computeGrabRadius(large);
  assert.ok(rSmall > 0);
  assert.ok(rLarge > rSmall * 5, 'a 10x larger lattice gets a proportionally larger grab radius');
});

test('computeGrabRadius: finer grid resolution (more bones over the same span) shrinks the radius', () => {
  const coarse = buildLatticeTopology({ min: [-1, -1, -0.2], max: [1, 1, 0.2], cols: 3, rows: 3, layers: 1, pinRows: 1 });
  const fine = buildLatticeTopology({ min: [-1, -1, -0.2], max: [1, 1, 0.2], cols: 9, rows: 9, layers: 1, pinRows: 1 });
  assert.ok(computeGrabRadius(fine) < computeGrabRadius(coarse), 'denser bone spacing narrows the falloff radius');
});

// ── mapPrimaryStateToLatticeParams ──────────────────────────────────────

test('mapPrimaryStateToLatticeParams: maps phys/anim directly, no clamping indirection', () => {
  const p = mapPrimaryStateToLatticeParams({ phys: { gravity: 2.7, damping: 0.9, stiffness: 0.85 }, anim: { on: true, turbulence: 0.6, speed: 1 } });
  assert.equal(p.gravity, 2.7);
  assert.equal(p.damping, 0.9);
  assert.equal(p.stretchStiffness, 0.85);
  assert.ok(Math.abs(p.bendStiffness - 0.85 * LATTICE_BEND_STIFFNESS_RATIO) < 1e-9);
  assert.ok(Math.abs(p.windStrength - 0.6 * LATTICE_WIND_STRENGTH_SCALE) < 1e-9);
  assert.equal(p.windDirectionDeg, LATTICE_WIND_DIRECTION_DEG);
  assert.equal(p.windOn, true);
});

test('mapPrimaryStateToLatticeParams: anim.on=false zeroes windStrength and reports windOn=false', () => {
  const p = mapPrimaryStateToLatticeParams({ phys: { gravity: 2.7, damping: 0.9, stiffness: 0.85 }, anim: { on: false, turbulence: 0.6, speed: 1 } });
  assert.equal(p.windStrength, 0);
  assert.equal(p.windOn, false);
});

// ── End-to-end: lattice + tshirt-mesh.js's REAL simulation engine ───────

test('lattice + advanceSim: settles under gravity without NaNs across many frames, pinned bones never move', () => {
  const g = buildLatticeTopology({ min: [-1, -1, -0.2], max: [1, 1, 0.2], cols: 5, rows: 7, layers: 2, pinRows: 2 });
  const sim = createSimState(g);
  const params = mapPrimaryStateToLatticeParams({ phys: { gravity: 2.7, damping: 0.9, stiffness: 0.85 }, anim: { on: true, turbulence: 0.6, speed: 1 } });
  for (let frame = 0; frame < 180; frame += 1) {
    advanceSim(sim, params, 1 / 60);
  }
  assert.ok(isFiniteBuffer(sim.position), 'position buffer must stay finite');
  g.pinIndices.forEach((i) => {
    assert.equal(sim.position[i * 3], sim.orig[i * 3]);
    assert.equal(sim.position[i * 3 + 1], sim.orig[i * 3 + 1]);
    assert.equal(sim.position[i * 3 + 2], sim.orig[i * 3 + 2]);
  });
  // At least SOME non-pinned bone should have visibly moved from rest under gravity.
  let anyMoved = false;
  for (let i = 0; i < g.vertexCount; i += 1) {
    if (g.pinIndices.has(i)) continue;
    const dy = sim.position[i * 3 + 1] - sim.orig[i * 3 + 1];
    if (Math.abs(dy) > 1e-4) { anyMoved = true; break; }
  }
  assert.ok(anyMoved, 'unpinned bones should sag under gravity');
});

test('lattice + advanceSim: a huge single dt (tab-suspend style) never produces NaNs — bounded catch-up + resetSim recovery hold', () => {
  const g = buildLatticeTopology({ min: [-1, -1, -0.2], max: [1, 1, 0.2], cols: 5, rows: 7, layers: 2, pinRows: 2 });
  const sim = createSimState(g);
  const params = mapPrimaryStateToLatticeParams({ phys: { gravity: 4, damping: 0.998, stiffness: 1 }, anim: { on: true, turbulence: 1, speed: 3 } });
  advanceSim(sim, params, 500); // 500 seconds in one call — simulates a long-suspended tab
  assert.ok(isFiniteBuffer(sim.position));
  resetSim(sim);
  assert.ok(isFiniteBuffer(sim.position));
  for (let i = 0; i < sim.position.length; i += 1) assert.equal(sim.position[i], sim.orig[i]);
});
