// Invoice Studio HoloPaper — pure grid/constraint/fixed-step cloth helpers
// (docs/plans/INVOICE-STUDIO-HOLOPAPER-HANDOFF.md §5, Lane S ownership).
//
// Deliberately framework-free: no THREE import, no Mesh/Geometry/Vector3
// object touched anywhere in this file. Every function takes plain typed
// arrays / plain objects in and mutates/returns plain typed arrays / plain
// objects out, so this module is directly unit-testable with plain
// node:test (no DOM/WebGL needed) — see __tests__/cloth-sim.test.js.
//
// Adapted from the general SHAPE of ClothStudio.jsx's own cloth sim
// (identifiers named in the controlling handoff, not copied wholesale):
//   - world.buildCloth's grid/constraint construction (~line 4211)
//   - world.applyPins's four pin-mode sets (~line 4268)
//   - world.applyRumple's deterministic multi-octave fold field (~line 4284)
//   - the fixed-step `step()` function's verlet-integrate → constraint-
//     relax → grab-pull order (~line 4521)
//   - the onPointerDown tweezer-pinch vertex-selection formula (~line 4402)
// This file does not know about ClothStudio's React state, timeline,
// presets, or any of its other systems — only the cloth math itself.
//
// Coordinate convention: a flat Float32Array of [x0,y0,z0, x1,y1,z1, ...],
// one triple per grid vertex. Vertex index = row*cols + col, matching
// THREE.PlaneGeometry's own row-major vertex order (row 0 = the TOP edge —
// see ClothStudio's own applyPins comment: "PlaneGeometry rows run top
// (y=0) → bottom, so row 0 is the top edge"). invoice-holo-scene.js builds
// its geometry with THREE.PlaneGeometry and passes that geometry's own
// position array straight into these functions, so this module never needs
// to build its own rest-pose buffer to match THREE's exact layout — the
// caller supplies real positions and this module only needs the grid's
// (cols, rows) shape to walk them correctly.

export function gridIndex(col, row, cols) {
  return row * cols + col;
}

// Builds the constraint list for a `cols` x `rows` vertex grid — structural
// (horizontal/vertical neighbor), shear (diagonal), and bend (two-apart)
// constraints, each a [indexA, indexB, restLength] triple. Mirrors
// world.buildCloth's own constraint-building loop exactly (same four
// constraint kinds, same coverage rules at the grid edges).
export function buildConstraints(cols, rows, restX, restY) {
  const restD = Math.hypot(restX, restY);
  const constraints = [];
  const idx = (x, y) => gridIndex(x, y, cols);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (x < cols - 1) constraints.push([idx(x, y), idx(x + 1, y), restX]); // structural →
      if (y < rows - 1) constraints.push([idx(x, y), idx(x, y + 1), restY]); // structural ↓
      if (x < cols - 1 && y < rows - 1) {
        constraints.push([idx(x, y), idx(x + 1, y + 1), restD]); // shear ↘
        constraints.push([idx(x + 1, y), idx(x, y + 1), restD]); // shear ↙
      }
      if (x < cols - 2) constraints.push([idx(x, y), idx(x + 2, y), restX * 2]); // bend →
      if (y < rows - 2) constraints.push([idx(x, y), idx(x, y + 2), restY * 2]); // bend ↓
    }
  }
  return constraints;
}

// Builds the rest-pose (flat, z=0) position buffer for a `cols` x `rows`
// grid of world width `w` / height `h`, centered at the origin, row 0 at
// the top (max y) — used only by callers that need a rest-pose buffer
// WITHOUT building a real THREE.PlaneGeometry (e.g. tests). The real scene
// (invoice-holo-scene.js) instead reads PlaneGeometry's own position array
// directly, which is authoritative for THREE's exact vertex layout.
export function buildRestPositions(cols, rows, w, h) {
  const count = cols * rows;
  const positions = new Float32Array(count * 3);
  const stepX = cols > 1 ? w / (cols - 1) : 0;
  const stepY = rows > 1 ? h / (rows - 1) : 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const i = gridIndex(col, row, cols) * 3;
      positions[i] = -w / 2 + col * stepX;
      positions[i + 1] = h / 2 - row * stepY; // row 0 = top
      positions[i + 2] = 0;
    }
  }
  return positions;
}

// Convenience one-call grid builder — { cols, rows, count, positions,
// constraints, restX, restY }. `positions` is a fresh rest-pose buffer
// (buildRestPositions); callers own cloning it into their own current/prev/
// orig buffers, exactly like invoice-holo-scene.js does with PlaneGeometry's
// array (see the module header above).
export function buildGrid(cols, rows, w, h) {
  const restX = cols > 1 ? w / (cols - 1) : 0;
  const restY = rows > 1 ? h / (rows - 1) : 0;
  return {
    cols,
    rows,
    count: cols * rows,
    positions: buildRestPositions(cols, rows, w, h),
    constraints: buildConstraints(cols, rows, restX, restY),
    restX,
    restY,
  };
}

// Pin sets — mirrors world.applyPins's four pin modes exactly, including its
// fallback (any unrecognized mode behaves like 'all-corners').
export function buildPinSet(cols, rows, pinMode) {
  const pins = new Set();
  const top = (x) => gridIndex(x, 0, cols);
  const bottom = (x) => gridIndex(x, rows - 1, cols);
  if (pinMode === 'free-float') {
    // no pins — caller's own anchor/rebound logic (if any) holds it
  } else if (pinMode === 'top-edge') {
    for (let x = 0; x < cols; x += 1) pins.add(top(x));
  } else if (pinMode === 'top-corners') {
    pins.add(top(0));
    pins.add(top(cols - 1));
  } else {
    pins.add(top(0));
    pins.add(top(cols - 1));
    pins.add(bottom(0));
    pins.add(bottom(cols - 1));
  }
  return pins;
}

// Resets `positions`/`prevPositions` to `origPositions` — a full rest-pose
// snapshot with zero inferred velocity (prev === current).
export function applyRestPose(positions, prevPositions, origPositions) {
  positions.set(origPositions);
  prevPositions.set(origPositions);
}

// Deterministic multi-octave fold field over the rest pose, scaled by
// `amount` — mirrors world.applyRumple exactly (same formula/coefficients).
// Seeded with zero velocity: `prevPositions` is set to the folded position
// too, not just `origPositions`, so the sheet "opens looking handled"
// instead of snapping into its rumple on the very first integration step.
// Pinned vertices are left at their exact rest position (never rumpled).
export function applyRumple(positions, prevPositions, origPositions, pins, count, amount) {
  const a = (amount ?? 0) * 0.22;
  for (let i = 0; i < count; i += 1) {
    const i3 = i * 3;
    if (pins && pins.has(i)) {
      positions[i3] = origPositions[i3];
      positions[i3 + 1] = origPositions[i3 + 1];
      positions[i3 + 2] = origPositions[i3 + 2];
    } else {
      const ox = origPositions[i3];
      const oy = origPositions[i3 + 1];
      positions[i3] = ox + a * 0.35 * Math.sin(oy * 4.1 + 2.2);
      positions[i3 + 1] = oy + a * 0.3 * Math.cos(ox * 3.7 + 1.1);
      positions[i3 + 2] = origPositions[i3 + 2] + a * (
        0.55 * Math.sin(ox * 3.1 + 1.7) * Math.cos(oy * 2.3 + 0.6)
        + 0.3 * Math.sin(ox * 6.7 + 4.2) * Math.cos(oy * 5.1 + 2.8)
        + 0.2 * Math.sin(ox * 11.3 + 0.9) * Math.cos(oy * 9.7 + 5.5)
      );
    }
    prevPositions[i3] = positions[i3];
    prevPositions[i3 + 1] = positions[i3 + 1];
    prevPositions[i3 + 2] = positions[i3 + 2];
  }
}

// Fixed-step verlet integration — advances `positions` in place using
// position-based (Störmer–Verlet) integration: velocity is INFERRED from
// the delta between the current and previous position (scaled by
// `damping`), never stored explicitly. This is what makes a released grab
// FLING for free (see stepClothSimulation's own header below) — as long as
// `prevPositions` is not reset to the current position on release, the next
// integration pass reads the drag's own delta as velocity.
//
// `accel(i, x, y, z, out)` is an optional per-vertex acceleration hook
// (gravity + ambient wind in the real scene); it must write ax/ay/az into
// `out` (a reused {x,y,z} object) and is called once per unpinned vertex,
// per fixed step. Omit it for a pure/force-free integration pass.
export function integrateVerlet(positions, prevPositions, pins, dt, damping, accel) {
  const dt2 = dt * dt;
  const out = { x: 0, y: 0, z: 0 };
  const count = positions.length / 3;
  for (let i = 0; i < count; i += 1) {
    if (pins && pins.has(i)) continue;
    const ix = i * 3;
    const x = positions[ix];
    const y = positions[ix + 1];
    const z = positions[ix + 2];
    const vx = (x - prevPositions[ix]) * damping;
    const vy = (y - prevPositions[ix + 1]) * damping;
    const vz = (z - prevPositions[ix + 2]) * damping;
    let ax = 0;
    let ay = 0;
    let az = 0;
    if (typeof accel === 'function') {
      out.x = 0; out.y = 0; out.z = 0;
      accel(i, x, y, z, out);
      ax = out.x || 0; ay = out.y || 0; az = out.z || 0;
    }
    prevPositions[ix] = x; prevPositions[ix + 1] = y; prevPositions[ix + 2] = z;
    positions[ix] = x + vx + ax * dt2;
    positions[ix + 1] = y + vy + ay * dt2;
    positions[ix + 2] = z + vz + az * dt2;
  }
}

// Constraint relaxation (Gauss-Seidel-style position correction),
// `iterations` passes, each followed by re-asserting every pinned vertex
// back to its exact rest position in BOTH `positions` and `prevPositions` —
// mirrors world.step's own "Re-assert pins each pass so the solve can't
// drag them" comment. Without the per-pass reset, a constraint touching a
// pin would slowly walk it away from rest across iterations.
export function relaxConstraints(positions, prevPositions, constraints, pins, origPositions, iterations, stiffness) {
  for (let it = 0; it < iterations; it += 1) {
    for (let ci = 0; ci < constraints.length; ci += 1) {
      const [a, b, rest] = constraints[ci];
      const ax = a * 3;
      const bx = b * 3;
      const dx = positions[bx] - positions[ax];
      const dy = positions[bx + 1] - positions[ax + 1];
      const dz = positions[bx + 2] - positions[ax + 2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      const diff = ((dist - rest) / dist) * stiffness;
      const ox = dx * diff;
      const oy = dy * diff;
      const oz = dz * diff;
      positions[ax] += ox; positions[ax + 1] += oy; positions[ax + 2] += oz;
      positions[bx] -= ox; positions[bx + 1] -= oy; positions[bx + 2] -= oz;
    }
    if (pins) {
      for (const pi of pins) {
        const ix = pi * 3;
        positions[ix] = origPositions[ix];
        positions[ix + 1] = origPositions[ix + 1];
        positions[ix + 2] = origPositions[ix + 2];
        prevPositions[ix] = origPositions[ix];
        prevPositions[ix + 1] = origPositions[ix + 1];
        prevPositions[ix + 2] = origPositions[ix + 2];
      }
    }
  }
}

// Grabbed-patch pull toward the pointer target — mirrors world.step's own
// grab handling: each grabbed vertex eases toward `target + perVertexOffset`
// by its own tweezer-falloff weight, applied AFTER constraint relaxation so
// a held grab stays firm against the sheet's own stiffness.
//
// grabState: { active, idx: number[], w: number[] (0..1 falloff weight per
// idx entry), off: number[] (flat [dx,dy,dz, ...] per idx entry — the
// original pointer-to-vertex offset captured at grab-start), target: {x,y,z} }
// A falsy/inactive grabState is a safe no-op.
export function applyGrabForces(positions, grabState) {
  if (!grabState || !grabState.active || !grabState.idx || !grabState.idx.length) return;
  const { idx, w, off, target } = grabState;
  for (let k = 0; k < idx.length; k += 1) {
    const ix = idx[k] * 3;
    const wgt = w[k];
    const tx = target.x + off[k * 3];
    const ty = target.y + off[k * 3 + 1];
    const tz = target.z + off[k * 3 + 2];
    positions[ix] += (tx - positions[ix]) * wgt;
    positions[ix + 1] += (ty - positions[ix + 1]) * wgt;
    positions[ix + 2] += (tz - positions[ix + 2]) * wgt;
  }
}

// Tweezer-pinch vertex selection — given a grid's CURRENT positions and a
// world-space hit point `{x,y,z}`, returns `{idx, w, off}` for every vertex
// within `radius` (falloff `w = t*t*0.95`, `t = 1 - d/radius`, mirroring
// ClothStudio's own onPointerDown selection math exactly), always including
// at least the single nearest unpinned vertex so a coarse grid can't miss
// the tiny radius between vertices entirely.
export function selectGrabVertices(positions, count, pins, hit, radius) {
  const idx = [];
  const w = [];
  const off = [];
  let nearest = -1;
  let nearestD = Infinity;
  for (let i = 0; i < count; i += 1) {
    if (pins && pins.has(i)) continue;
    const ix = i * 3;
    const dx = positions[ix] - hit.x;
    const dy = positions[ix + 1] - hit.y;
    const dz = positions[ix + 2] - hit.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < nearestD) { nearestD = d; nearest = i; }
    if (d < radius) {
      const t = 1 - d / radius;
      idx.push(i); w.push(t * t * 0.95);
      off.push(dx, dy, dz);
    }
  }
  if (!idx.length && nearest >= 0) {
    const ix = nearest * 3;
    idx.push(nearest); w.push(0.95);
    off.push(positions[ix] - hit.x, positions[ix + 1] - hit.y, positions[ix + 2] - hit.z);
  }
  return { idx, w, off };
}

// One fixed-step tick — orchestrates integrate → relax → grab, mirroring
// world.step's own order exactly (ClothStudio: integrate all unpinned
// vertices, relax constraints `iterations` passes with pins re-asserted
// each pass, THEN apply any active grab pull so a held grab stays firm
// against the just-relaxed sheet). Every buffer named in `state` is mutated
// in place; this function returns nothing.
//
// state: { positions, prevPositions, origPositions, constraints, pins }
// opts: { dt, damping, stiffness, iterations, accel, grab }
export function stepClothSimulation(state, opts) {
  const {
    positions, prevPositions, origPositions, constraints, pins,
  } = state;
  const {
    dt = 1 / 60, damping = 0.98, stiffness = 0.5, iterations = 5, accel = null, grab = null,
  } = opts || {};
  integrateVerlet(positions, prevPositions, pins, dt, damping, accel);
  relaxConstraints(positions, prevPositions, constraints, pins, origPositions, iterations, stiffness);
  applyGrabForces(positions, grab);
}
