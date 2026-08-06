// Real-GLB T-shirt primary shape — bone-lattice "GPU cage" deformation.
// Pure logic, no THREE.js import — same house convention as tshirt-mesh.js.
//
// Why a lattice instead of per-vertex simulation: the real garment asset
// (public/models/merch/tshirt.glb) is ~373K triangles across 4 meshes with
// no skin/bones. Running a Verlet solver directly on every dense vertex
// (weighted-blend recompute every frame) is roughly 9-10M float ops/frame —
// too slow for 60fps in JS. Instead, a COARSE 3D grid of "bones" (~126
// points, the same order of magnitude as the procedural mesh's own vertex
// count) is simulated with the exact same proven Verlet engine
// (tshirt-mesh.js createSimState/advanceSim/resetSim — reused unmodified,
// not reimplemented), and three.js's own GPU skeletal-skinning pipeline
// (SkinnedMesh/Skeleton/Bone) does the expensive per-vertex displacement AND
// normal recomputation on the GPU, the same way it already does for every
// skinned character in any three.js scene — no custom shader needed for the
// deformation itself.
//
// This module owns the two pieces that ARE specific to this technique:
// building the lattice's own topology (positions + constraint pairs + pins,
// in the SAME shape tshirt-mesh.js's buildTshirtMesh already produces, so
// createSimState/advanceSim work on it unmodified), and computing the
// one-time (load-time, not per-frame) skin-binding weights that tell the GPU
// which bones influence which dense vertices.

/** Combines multiple {min:[x,y,z], max:[x,y,z]} boxes into one overall box, expanded by `marginFrac` of its own size on each axis (so the lattice comfortably covers geometry near the edge). */
export function combineBounds(boxes, marginFrac = 0.08) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  boxes.forEach((b) => {
    for (let a = 0; a < 3; a += 1) {
      if (b.min[a] < min[a]) min[a] = b.min[a];
      if (b.max[a] > max[a]) max[a] = b.max[a];
    }
  });
  const out = { min: [...min], max: [...max] };
  for (let a = 0; a < 3; a += 1) {
    const size = max[a] - min[a];
    const margin = size * marginFrac;
    out.min[a] -= margin;
    out.max[a] += margin;
  }
  return out;
}

/**
 * Builds a `cols` x `rows` x `layers` grid of bone rest positions spanning
 * `[min, max]` (X=cols, Y=rows, Z=layers), plus structural (axis-neighbor),
 * shear (face-diagonal), and bend (skip-one) constraint pairs connecting
 * them, and a pin set covering the top `pinRows` rows (Y = collar/shoulder
 * band — the hanger-grip region). Returned shape matches tshirt-mesh.js
 * buildTshirtMesh's own output contract exactly (`positions`, `constraints:
 * {structural,shear,bend,seam}`, `pinIndices`, `vertexCount`) so
 * createSimState/advanceSim/resetSim (tshirt-mesh.js) work on it completely
 * unmodified — no new simulation engine, only new topology.
 */
export function buildLatticeTopology({ min, max, cols, rows, layers, pinRows = 2 }) {
  if (cols < 2 || rows < 2 || layers < 1) throw new Error('buildLatticeTopology: cols/rows must be >=2, layers >=1');
  const count = cols * rows * layers;
  const positions = new Float32Array(count * 3);
  const idx = (ix, iy, iz) => iz * (cols * rows) + iy * cols + ix;
  for (let iz = 0; iz < layers; iz += 1) {
    for (let iy = 0; iy < rows; iy += 1) {
      for (let ix = 0; ix < cols; ix += 1) {
        const i = idx(ix, iy, iz) * 3;
        positions[i] = min[0] + ((max[0] - min[0]) * ix) / (cols - 1);
        positions[i + 1] = min[1] + ((max[1] - min[1]) * iy) / (rows - 1);
        positions[i + 2] = layers > 1 ? min[2] + ((max[2] - min[2]) * iz) / (layers - 1) : (min[2] + max[2]) / 2;
      }
    }
  }

  const structural = [];
  const shear = [];
  const bend = [];
  for (let iz = 0; iz < layers; iz += 1) {
    for (let iy = 0; iy < rows; iy += 1) {
      for (let ix = 0; ix < cols; ix += 1) {
        const here = idx(ix, iy, iz);
        if (ix + 1 < cols) structural.push([here, idx(ix + 1, iy, iz)]);
        if (iy + 1 < rows) structural.push([here, idx(ix, iy + 1, iz)]);
        if (iz + 1 < layers) structural.push([here, idx(ix, iy, iz + 1)]);
        // XY face-diagonal shear (per depth layer)
        if (ix + 1 < cols && iy + 1 < rows) {
          shear.push([idx(ix, iy, iz), idx(ix + 1, iy + 1, iz)]);
          shear.push([idx(ix + 1, iy, iz), idx(ix, iy + 1, iz)]);
        }
        // XZ / YZ face-diagonal shear (between depth layers) — only meaningful when layers>1
        if (layers > 1 && iz + 1 < layers) {
          if (ix + 1 < cols) {
            shear.push([idx(ix, iy, iz), idx(ix + 1, iy, iz + 1)]);
            shear.push([idx(ix + 1, iy, iz), idx(ix, iy, iz + 1)]);
          }
          if (iy + 1 < rows) {
            shear.push([idx(ix, iy, iz), idx(ix, iy + 1, iz + 1)]);
            shear.push([idx(ix, iy + 1, iz), idx(ix, iy, iz + 1)]);
          }
        }
        if (ix + 2 < cols) bend.push([here, idx(ix + 2, iy, iz)]);
        if (iy + 2 < rows) bend.push([here, idx(ix, iy + 2, iz)]);
      }
    }
  }

  const pinIndices = new Set();
  const pinFromRow = Math.max(0, rows - pinRows);
  for (let iz = 0; iz < layers; iz += 1) {
    for (let iy = pinFromRow; iy < rows; iy += 1) {
      for (let ix = 0; ix < cols; ix += 1) pinIndices.add(idx(ix, iy, iz));
    }
  }

  return {
    positions,
    constraints: { structural, shear, bend, seam: [] },
    pinIndices,
    vertexCount: count,
    cols, rows, layers,
  };
}

/**
 * One-time (load-time) skin binding: for every dense vertex, finds the `k`
 * nearest bones (rest-pose Euclidean distance) and returns normalized
 * inverse-distance weights — the standard "smooth bind" technique, the same
 * conceptual approach any DCC tool's automatic weight painting uses.
 * Returns typed arrays ready to become a BufferGeometry's skinIndex/
 * skinWeight attributes (skinIndex as Float32Array — three.js accepts
 * either Uint16/Uint8 or Float32 for skinIndex; Float32 avoids a second
 * typed-array conversion here). Pure/brute-force O(vertexCount * boneCount)
 * — a deliberate one-time cost, never run per frame.
 */
export function computeSkinBinding(vertexPositions, boneRestPositions, k = 4) {
  const vertexCount = vertexPositions.length / 3;
  const boneCount = boneRestPositions.length / 3;
  const kEff = Math.min(k, boneCount);
  const skinIndex = new Float32Array(vertexCount * 4);
  const skinWeight = new Float32Array(vertexCount * 4);
  // CORRECTION (found live — this is a real, load-blocking perf bug, not
  // just a style nit): allocating `bestIdx`/`bestDist`/`invW` arrays INSIDE
  // the vertex loop meant ~200K short-lived array allocations for the real
  // asset (65532 verts x 3 meshes + 4999), enough GC pressure to visibly
  // freeze the tab for several seconds during a single load. Every buffer
  // below is now allocated ONCE, outside both loops, and reused (overwritten
  // in place) per vertex — zero per-vertex heap allocation.
  const bestIdx = new Int32Array(kEff);
  const bestDist = new Float32Array(kEff);
  for (let v = 0; v < vertexCount; v += 1) {
    const vx = vertexPositions[v * 3], vy = vertexPositions[v * 3 + 1], vz = vertexPositions[v * 3 + 2];
    bestDist.fill(Infinity);
    bestIdx.fill(-1);
    // Partial top-K selection computed directly against each bone's
    // distance (no full `boneCount`-length distances buffer needed either —
    // kEff is tiny, e.g. 4, so a simple insertion into a k-slot buffer beats
    // computing+sorting all `boneCount` distances first).
    for (let b = 0; b < boneCount; b += 1) {
      const dx = boneRestPositions[b * 3] - vx;
      const dy = boneRestPositions[b * 3 + 1] - vy;
      const dz = boneRestPositions[b * 3 + 2] - vz;
      const d = dx * dx + dy * dy + dz * dz; // squared distance — sqrt not needed for nearest-K selection
      if (d < bestDist[kEff - 1]) {
        let pos = kEff - 1;
        while (pos > 0 && bestDist[pos - 1] > d) {
          bestDist[pos] = bestDist[pos - 1];
          bestIdx[pos] = bestIdx[pos - 1];
          pos -= 1;
        }
        bestDist[pos] = d;
        bestIdx[pos] = b;
      }
    }
    let weightSum = 0;
    for (let j = 0; j < kEff; j += 1) weightSum += 1 / (bestDist[j] + 1e-6);
    for (let j = 0; j < 4; j += 1) {
      if (j < kEff) {
        skinIndex[v * 4 + j] = bestIdx[j];
        skinWeight[v * 4 + j] = (1 / (bestDist[j] + 1e-6)) / weightSum;
      } else {
        skinIndex[v * 4 + j] = bestIdx[0];
        skinWeight[v * 4 + j] = 0;
      }
    }
  }
  return { skinIndex, skinWeight };
}

/**
 * A sensible pointer-drag falloff radius for a lattice — proportional to the
 * average spacing between neighboring bones (derived from the lattice's own
 * bounding diagonal / grid resolution), so a drag reliably catches a small
 * NEIGHBORHOOD of bones (not zero, not the whole cage) regardless of the
 * asset's absolute scale. Mirrors the sheet's own tweezer-pinch radius
 * precedent (`Math.max(c.cw, c.ch) * 0.055` in ClothStudio.jsx) but scaled
 * up for a much coarser control cage — `factor` defaults to a wider
 * multiple of the spacing so a grab typically influences 2-4 neighbors.
 */
export function computeGrabRadius(lattice, factor = 1.8) {
  const { positions, cols, rows, layers } = lattice;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a += 1) {
      const v = positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const maxDim = Math.max(cols, rows, layers, 2) - 1;
  return (diag / maxDim) * factor;
}

// Bend is conventionally softer than stretch, same precedent as
// elements/primary-cloth.js's TSHIRT_BEND_STIFFNESS_RATIO for the (now
// replaced) procedural mesh — reused here for consistency.
export const LATTICE_BEND_STIFFNESS_RATIO = 0.6;
// Same wind-strength scale precedent as elements/primary-cloth.js.
export const LATTICE_WIND_STRENGTH_SCALE = 0.4;
export const LATTICE_WIND_DIRECTION_DEG = 35;

/**
 * Maps the primary sheet's SHARED phys/anim state directly onto lattice sim
 * params (tshirt-mesh.js stepSim/advanceSim's `params` shape) — no
 * intermediate "instance"/fieldSpec layer this time (the lattice isn't a
 * catalog-driven extraInstances entry), so no clamping indirection is
 * needed; phys/anim's own slider ranges ARE the lattice's operating range
 * directly. Mirrors the mapping precedent already established for the
 * (now-replaced) procedural mesh in elements/primary-cloth.js
 * buildPrimaryTshirtInstanceRaw, documented here for the real-GLB path.
 *
 * `worldScale` (default 1, backward compatible) corrects a real scale
 * mismatch found live: the lattice is built directly from the GLB's OWN
 * (raw, un-normalized) vertex bounds — needed so computeSkinBinding's
 * nearest-bone search is in the same units as the mesh's own vertices — but
 * tshirt-mesh.js's stepSim applies gravity/wind as ABSOLUTE per-step
 * position deltas (`g = -gravity*dt*dt`, wind similarly), a formula tuned
 * for the (now-replaced) procedural mesh's near-unit-scale coordinates.
 * This real asset's raw scale is ~18x larger (its own normalizeGLBTransform
 * scale-to-radius-1 factor measured ~0.056, i.e. radius ~17.9), so identical
 * ABSOLUTE deltas are ~18x too small to be visible relative to the
 * garment's own size — confirmed live: the sim was moving correctly
 * (verified numerically) but settling into a sub-pixel equilibrium,
 * invisible on screen. `worldScale` should be the SAME scale factor
 * normalizeGLBTransform returns (e.g. ~0.056); gravity/wind (the absolute-
 * delta terms) are divided by it here so the PROPORTIONAL (relative to
 * garment size) effect matches what the phys sliders were tuned for,
 * regardless of the asset's raw coordinate units. Stiffness/damping are
 * unitless relaxation factors (relative to each constraint's own rest
 * length) and need no such correction.
 */
export function mapPrimaryStateToLatticeParams({ phys, anim, worldScale = 1 }) {
  const forceScale = 1 / Math.max(worldScale, 1e-6);
  return {
    gravity: phys.gravity * forceScale,
    damping: phys.damping,
    stretchStiffness: phys.stiffness,
    bendStiffness: phys.stiffness * LATTICE_BEND_STIFFNESS_RATIO,
    windStrength: (anim.on ? anim.turbulence * LATTICE_WIND_STRENGTH_SCALE : 0) * forceScale,
    windDirectionDeg: LATTICE_WIND_DIRECTION_DEG,
    windTurbulence: anim.turbulence,
    windSpeed: anim.speed,
    windOn: Boolean(anim.on),
  };
}
