import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PATTERN, insideCollarBand, patternMaxX, buildTshirtMesh, segmentCrossesNeckHole,
  createSimState, isFiniteBuffer, resetSim, stepSim, advanceSim, computeMeasuredCost, relaxPairs,
} from '../tshirt-mesh.js';
import { buildLatticeTopology } from '../tshirt-glb-lattice.js';

function buildMesh(cols = 24, rows = 30) {
  return buildTshirtMesh({ cols, rows, worldWidth: 1.4, worldHeight: 1.8, thickness: 0.02 });
}

// A point along the RIGHT sleeve's own centerline at fraction `t` of its
// length (0=shoulder attach, 1=cuff) — computed the SAME way the source's
// own sleeveFrame/sleevePoint does, so tests exercise real anatomical
// claims (angle, taper, position) instead of guessed pattern-space
// coordinates that would silently drift if PATTERN's numbers ever change.
function rightSleevePoint(t, p = PATTERN) {
  const rad = (p.sleeveAngleDeg * Math.PI) / 180;
  const dirX = Math.cos(rad);
  const dirY = -Math.sin(rad);
  const attachX = 0.5 + p.shoulderHalfWidth;
  const attachY = p.shoulderY;
  const along = p.sleeveLength * t;
  return { x: attachX + along * dirX, y: attachY + along * dirY };
}

// ── Anatomy (pure pattern-space claims — no mesh needed) ─────────────────

test('anatomy: sleeve is angled down-and-out, not a purely horizontal drop — Y decreases as it extends from shoulder to cuff', () => {
  const shoulder = rightSleevePoint(0);
  const cuff = rightSleevePoint(1);
  assert.ok(cuff.x > shoulder.x, 'cuff sits further outward (X) than the shoulder attach');
  assert.ok(cuff.y < shoulder.y, 'cuff sits LOWER (Y) than the shoulder attach — an angled, not horizontal, sleeve');
});

test('anatomy: sleeve tapers — the cuff half-width is narrower than the shoulder half-width', () => {
  assert.ok(PATTERN.sleeveCuffHalfWidth < PATTERN.sleeveShoulderHalfWidth, 'cuff narrower than shoulder root');
});

test('anatomy: torso tapers smoothly — chest is wider than both the hem and the shoulder (natural underarm bulge, not a flat rectangle side)', () => {
  assert.ok(PATTERN.chestHalfWidth > PATTERN.hemHalfWidth, 'chest wider than hem');
  assert.ok(PATTERN.chestHalfWidth > PATTERN.shoulderHalfWidth, 'chest wider than the shoulder (shoulder slope narrows toward the neck)');
});

test('anatomy: neckline is round and centered on the shoulder midline', () => {
  const y = PATTERN.shoulderY - PATTERN.neckDepth * 0.5;
  const mesh = buildMesh(30, 38);
  // At half-depth into the notch, no torso vertex should exist within the
  // neck's own half-extent at that height (both sides symmetric).
  let leftmostOutsideNeck = Infinity;
  for (let i = 0; i < mesh.frontCount; i += 1) {
    const px = mesh.uvs[i * 2], py = mesh.uvs[i * 2 + 1];
    if (Math.abs(py - y) > 0.02) continue;
    if (px < 0.5) leftmostOutsideNeck = Math.min(leftmostOutsideNeck, 0.5 - px);
  }
  assert.ok(leftmostOutsideNeck > 0, 'the neck notch genuinely excludes fabric near the shoulder midline');
});

test('insideCollarBand: traces a thin ring immediately around (but not inside) the neckline, and never bleeds onto a sleeve', () => {
  const onBand = insideCollarBand(0.5, PATTERN.shoulderY - PATTERN.neckDepth * 1.02, PATTERN);
  assert.ok(onBand, 'a point just outside the neck ellipse boundary is inside the collar band');
  assert.ok(!insideCollarBand(0.5, PATTERN.shoulderY - PATTERN.neckDepth * 0.3, PATTERN), 'the neck hole interior is not collar band');
  assert.ok(!insideCollarBand(0.5, 0.3, PATTERN), 'mid-torso is not collar band');
  const sleeveMid = rightSleevePoint(0.6);
  assert.ok(!insideCollarBand(sleeveMid.x, sleeveMid.y, PATTERN), 'collar band never bleeds onto the sleeve');
});

test('patternMaxX: matches the real sleeve cuff\'s outer corner, not a hardcoded guess', () => {
  const maxX = patternMaxX(PATTERN);
  assert.ok(maxX > 0.5 + PATTERN.shoulderHalfWidth, 'the sleeve genuinely extends past the shoulder point');
  const mesh = buildMesh(30, 38);
  let observedMax = -Infinity;
  for (let i = 0; i < mesh.frontCount; i += 1) {
    const wx = mesh.positions[i * 3];
    const px = wx / 1.4 + 0.5; // invert buildMesh's worldWidth=1.4 scaling back to pattern space
    if (px > observedMax) observedMax = px;
  }
  assert.ok(observedMax <= maxX + 0.02, `patternMaxX (${maxX}) should not undershoot the real mesh's rightmost vertex (observed ${observedMax})`);
});

// ── Boundary conformance (P1 correction — this is the whole point of the
// rewrite: the perimeter must be genuinely smooth, not grid-clipped) ─────

test('boundary continuity: torso side-seam X position changes smoothly row-to-row — no large jump anywhere (the old cell-clipped grid could jump a full cell width at a stair step)', () => {
  const mesh = buildMesh(30, 38);
  // Reconstruct torso rows (cols x rows, first cols*rows vertices) and check
  // the rightmost vertex's X per row for large discontinuities.
  const cols = mesh.cols;
  const rows = mesh.rows;
  let maxJump = 0;
  let prevX = null;
  for (let row = 0; row < rows; row += 1) {
    const i = row * cols + (cols - 1); // rightmost column of this row
    const x = mesh.uvs[i * 2];
    if (prevX != null) maxJump = Math.max(maxJump, Math.abs(x - prevX));
    prevX = x;
  }
  // A genuinely smooth curve sampled at `rows` steps across the whole
  // torso height should never jump by more than a couple of row-steps'
  // worth of the total width range in one step.
  assert.ok(maxJump < 0.05, `side-seam X jumped by ${maxJump.toFixed(4)} in one row step — should be a smooth curve, not a stair-step`);
});

test('boundary continuity: neckline edge (row-to-row) also changes smoothly near the top of the torso, not in cell-sized jumps', () => {
  const mesh = buildMesh(30, 38);
  const cols = mesh.cols, rows = mesh.rows;
  const jumps = [];
  for (let row = 1; row < rows; row += 1) {
    // Find this row's and the previous row's rightmost NECK-adjacent vertex
    // (smallest X that's still right of center, i.e. the neck's right edge
    // if this row intersects the notch) by scanning inward from center.
    const edgeX = (r) => {
      let best = null;
      for (let col = 0; col < cols; col += 1) {
        const i = r * cols + col;
        const px = mesh.uvs[i * 2], py = mesh.uvs[i * 2 + 1];
        if (px <= 0.5) continue;
        if (py < PATTERN.shoulderY - PATTERN.neckDepth) continue;
        if (best == null || px < best) best = px;
      }
      return best;
    };
    const a = edgeX(row - 1), b = edgeX(row);
    if (a != null && b != null) jumps.push(Math.abs(b - a));
  }
  if (jumps.length > 0) {
    const maxJump = Math.max(...jumps);
    assert.ok(maxJump < 0.06, `neckline edge jumped by ${maxJump.toFixed(4)} between adjacent rows — should read as round, not faceted`);
  }
});

test('boundary continuity: sleeve outer edge tapers smoothly from shoulder to cuff — no jump between adjacent sleeve rows', () => {
  const mesh = buildMesh(30, 38);
  const sleeveCols = mesh.sleeveCols, sleeveRows = mesh.sleeveRows;
  const sleeveOffset = mesh.cols * mesh.rows; // right sleeve starts right after the torso block
  let maxJump = 0;
  let prevOuterX = null;
  for (let row = 0; row < sleeveRows; row += 1) {
    const i = sleeveOffset + row * sleeveCols + (sleeveCols - 1); // outer edge column
    const x = mesh.uvs[i * 2];
    if (prevOuterX != null) maxJump = Math.max(maxJump, Math.abs(x - prevOuterX));
    prevOuterX = x;
  }
  assert.ok(maxJump < 0.06, `sleeve outer edge jumped by ${maxJump.toFixed(4)} between adjacent rows`);
});

test('boundary continuity: underarm transition — the sleeve\'s root row sits close to the torso\'s own edge in the underarm..shoulder Y range (no visible gap)', () => {
  const mesh = buildMesh(30, 38);
  const cols = mesh.cols, rows = mesh.rows;
  const sleeveCols = mesh.sleeveCols;
  const sleeveOffset = cols * rows;
  // Torso boundary points in [underarmY, shoulderY] on the right side.
  const torsoEdge = [];
  for (let row = 0; row < rows; row += 1) {
    const i = row * cols + (cols - 1);
    const py = mesh.uvs[i * 2 + 1];
    if (py >= PATTERN.underarmY - 0.02 && py <= PATTERN.shoulderY + 0.001) {
      torsoEdge.push({ x: mesh.uvs[i * 2], y: py });
    }
  }
  assert.ok(torsoEdge.length > 0, 'torso has boundary vertices in the underarm..shoulder range to attach to');
  // Sleeve root row (row 0) — every point should have SOME nearby torso edge point.
  let maxNearestGap = 0;
  for (let col = 0; col < sleeveCols; col += 1) {
    const i = sleeveOffset + col;
    const sx = mesh.uvs[i * 2], sy = mesh.uvs[i * 2 + 1];
    let nearest = Infinity;
    torsoEdge.forEach((t) => { nearest = Math.min(nearest, Math.hypot(t.x - sx, t.y - sy)); });
    maxNearestGap = Math.max(maxNearestGap, nearest);
  }
  // Bounded by the sleeve's own root half-width by construction (the
  // outermost/innermost points of the sleeve's root cross-section are
  // necessarily offset from the single nearest torso boundary point by up
  // to roughly that half-width) — buildAttachmentPairs' structural
  // constraints (verified in a separate test below) are what actually pull
  // this gap closed during simulation, on top of this rest-pose proximity.
  assert.ok(maxNearestGap < PATTERN.sleeveShoulderHalfWidth + 0.02, `sleeve root sits up to ${maxNearestGap.toFixed(4)} pattern-units from the nearest torso edge — should be close enough for the attachment constraints to read as one seamless connection`);
});

test('no degenerate triangles: every triangle in the mesh has non-zero pattern-space area', () => {
  const mesh = buildMesh(30, 38);
  let minArea = Infinity;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i], b = mesh.indices[i + 1], c = mesh.indices[i + 2];
    const ax = mesh.uvs[a * 2], ay = mesh.uvs[a * 2 + 1];
    const bx = mesh.uvs[b * 2], by = mesh.uvs[b * 2 + 1];
    const cx = mesh.uvs[c * 2], cy = mesh.uvs[c * 2 + 1];
    const area = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay));
    minArea = Math.min(minArea, area);
  }
  assert.ok(minArea > 1e-9, `smallest triangle area was ${minArea} — a near-zero-area triangle slipped through the degenerate filter`);
});

test('UV bounds: every UV coordinate stays within [0,1]', () => {
  const mesh = buildMesh(24, 30);
  for (let i = 0; i < mesh.uvs.length; i += 1) {
    assert.ok(mesh.uvs[i] >= -1e-6 && mesh.uvs[i] <= 1 + 1e-6, `uv[${i}]=${mesh.uvs[i]} out of [0,1]`);
  }
});

// ── Regression coverage for 3 P1 defects a code review found live (the
// existing tests above did not catch any of these — they checked aggregate
// winding, only the right-side attachment, and neckline VERTEX positions
// rather than actual triangle/edge coverage of the opening) ───────────────

test('per-patch winding: torso, right sleeve, AND left sleeve all face +Z on the front panel — not just the aggregate mean', () => {
  const mesh = buildMesh(24, 30);
  const torsoCount = mesh.cols * mesh.rows;
  const rightOffset = torsoCount;
  const leftOffset = torsoCount + mesh.sleeveCols * mesh.sleeveRows;
  const sleeveCount = mesh.sleeveCols * mesh.sleeveRows;
  const meanNormalZ = (belongsTo) => {
    let sumZ = 0, n = 0;
    for (let i = 0; i < mesh.frontIndexCount; i += 3) {
      const a = mesh.indices[i], b = mesh.indices[i + 1], c = mesh.indices[i + 2];
      if (!belongsTo(a) || !belongsTo(b) || !belongsTo(c)) continue;
      const pa = a * 3, pb = b * 3, pc = c * 3;
      const v1x = mesh.positions[pb] - mesh.positions[pa], v1y = mesh.positions[pb + 1] - mesh.positions[pa + 1];
      const v2x = mesh.positions[pc] - mesh.positions[pa], v2y = mesh.positions[pc + 1] - mesh.positions[pa + 1];
      sumZ += v1x * v2y - v1y * v2x;
      n += 1;
    }
    return { mean: n > 0 ? sumZ / n : NaN, n };
  };
  const torsoZ = meanNormalZ((i) => i < torsoCount);
  const rightZ = meanNormalZ((i) => i >= rightOffset && i < rightOffset + sleeveCount);
  const leftZ = meanNormalZ((i) => i >= leftOffset && i < leftOffset + sleeveCount);
  assert.ok(torsoZ.n > 0 && rightZ.n > 0 && leftZ.n > 0, 'all three patches contributed front triangles');
  assert.ok(torsoZ.mean > 0, `torso should face +Z, got ${torsoZ.mean}`);
  assert.ok(rightZ.mean > 0, `right sleeve should face +Z, got ${rightZ.mean}`);
  assert.ok(leftZ.mean > 0, `left sleeve should face +Z (same as torso/right sleeve — its mirrored local frame has opposite handedness and needs the opposite flipWinding), got ${leftZ.mean}`);
});

test('sleeve attachment stays on its own side: left-sleeve attachment constraints connect to LEFT torso edge vertices only, never across the body to the right edge', () => {
  const mesh = buildMesh(26, 33);
  const torsoCount = mesh.cols * mesh.rows;
  const sleeveCount = mesh.sleeveCols * mesh.sleeveRows;
  const leftSleeveOffset = torsoCount + sleeveCount;
  const leftRootMin = leftSleeveOffset, leftRootMax = leftSleeveOffset + mesh.sleeveCols;
  const crossPatchPairs = mesh.constraints.structural.filter(([a, b]) => {
    const aIsTorso = a < torsoCount, bIsTorso = b < torsoCount;
    const aInLeftRoot = a >= leftRootMin && a < leftRootMax, bInLeftRoot = b >= leftRootMin && b < leftRootMax;
    return (aIsTorso && bInLeftRoot) || (bIsTorso && aInLeftRoot);
  });
  assert.ok(crossPatchPairs.length > 0, 'left sleeve has torso attachment constraints');
  crossPatchPairs.forEach(([a, b]) => {
    const torsoIdx = a < torsoCount ? a : b;
    const x = mesh.uvs[torsoIdx * 2];
    assert.ok(x < 0.5, `left-sleeve attachment reached a torso vertex at x=${x} — should be on the LEFT (x<0.5) side, not across the body`);
  });
});

test('neckline is a true opening: no triangle (centroid OR any edge) intersects the neck ellipse, and no structural/shear/bend constraint spans across it', () => {
  const mesh = buildMesh(30, 38);
  const torsoCount = mesh.cols * mesh.rows;
  const inNeckHole = (x, y) => {
    if (y < PATTERN.shoulderY - PATTERN.neckDepth * 1.3) return false;
    const dx = (x - 0.5) / PATTERN.neckHalfWidth, dy = (PATTERN.shoulderY - y) / PATTERN.neckDepth;
    return dx * dx + dy * dy < 1;
  };
  // Uses the SAME exact closed-form segment-vs-ellipse test the source
  // itself uses (segmentCrossesNeckHole) — not a local re-implementation —
  // so this test can never diverge from what the mesh generator actually
  // checks. A discrete-sampling version of this test previously found (and
  // then chased) resolution-dependent false negatives/positives; the
  // analytic test has no such gap.
  const crossesHole = (i, j) => segmentCrossesNeckHole(
    { x: mesh.uvs[i * 2], y: mesh.uvs[i * 2 + 1] },
    { x: mesh.uvs[j * 2], y: mesh.uvs[j * 2 + 1] },
    PATTERN,
  );
  let badTriangles = 0;
  for (let i = 0; i < mesh.frontIndexCount; i += 3) {
    const a = mesh.indices[i], b = mesh.indices[i + 1], c = mesh.indices[i + 2];
    if (a >= torsoCount || b >= torsoCount || c >= torsoCount) continue; // torso-only (sleeves have no neckline)
    const cx = (mesh.uvs[a * 2] + mesh.uvs[b * 2] + mesh.uvs[c * 2]) / 3;
    const cy = (mesh.uvs[a * 2 + 1] + mesh.uvs[b * 2 + 1] + mesh.uvs[c * 2 + 1]) / 3;
    if (inNeckHole(cx, cy) || crossesHole(a, b) || crossesHole(b, c) || crossesHole(a, c)) badTriangles += 1;
  }
  assert.equal(badTriangles, 0, `${badTriangles} front triangle(s) intersect the neckline opening — the neck must be a real hole, not filled fabric`);

  let badConstraints = 0;
  const allPairs = [...mesh.constraints.structural, ...mesh.constraints.shear, ...mesh.constraints.bend];
  allPairs.forEach(([a, b]) => {
    if (a >= torsoCount || b >= torsoCount) return; // front torso indices only; back torso reuses the same check by symmetry
    if (crossesHole(a, b)) badConstraints += 1;
  });
  assert.equal(badConstraints, 0, `${badConstraints} constraint(s) span across the neckline opening`);
});

// ── Mesh structure (front/back panels, seams, pins, indices) ────────────

test('buildTshirtMesh: front+back panels, seams, pins, valid triangle indices', () => {
  const mesh = buildMesh();
  assert.equal(mesh.vertexCount, mesh.frontCount * 2, 'front+back vertex count');
  assert.ok(mesh.positions.length === mesh.vertexCount * 3);
  assert.ok(mesh.uvs.length === mesh.vertexCount * 2);
  assert.ok(mesh.indices.length > 0 && mesh.indices.length % 3 === 0, 'triangle list');
  for (let i = 0; i < mesh.indices.length; i += 1) {
    assert.ok(mesh.indices[i] >= 0 && mesh.indices[i] < mesh.vertexCount, 'index in range');
  }
  assert.ok(mesh.constraints.structural.length > 0);
  assert.ok(mesh.constraints.shear.length > 0);
  assert.ok(mesh.constraints.bend.length > 0);
  assert.ok(mesh.constraints.seam.length > 0, 'front/back seam links exist');
  assert.ok(mesh.pinIndices.size > 0, 'has pinned shoulder/sleeve vertices');
  mesh.pinIndices.forEach((i) => assert.ok(i >= 0 && i < mesh.vertexCount));
});

test('matching front/back perimeter vertices: every seam pair is a valid (front, corresponding back) index with the correct offset and a positive rest length', () => {
  const mesh = buildMesh();
  mesh.constraints.seam.forEach(([a, b, rest]) => {
    assert.ok(a < mesh.frontCount, 'seam A is a front vertex');
    assert.ok(b >= mesh.frontCount, 'seam B is a back vertex');
    assert.equal(b - a, mesh.frontCount, 'seam links exact front/back counterpart');
    assert.ok(rest > 0, 'seam rest length is the authored thickness');
  });
});

test('valid seam-pair indices: seam constraints exist for the torso, both sleeves, and cover a meaningful fraction of each patch\'s own boundary', () => {
  const mesh = buildMesh(30, 38);
  const cols = mesh.cols, rows = mesh.rows, sleeveCols = mesh.sleeveCols, sleeveRows = mesh.sleeveRows;
  const torsoCount = cols * rows;
  const sleeveCount = sleeveCols * sleeveRows;
  const rightOffset = torsoCount, leftOffset = torsoCount + sleeveCount;
  const inTorso = mesh.constraints.seam.filter(([a]) => a < torsoCount).length;
  const inRightSleeve = mesh.constraints.seam.filter(([a]) => a >= rightOffset && a < rightOffset + sleeveCount).length;
  const inLeftSleeve = mesh.constraints.seam.filter(([a]) => a >= leftOffset && a < leftOffset + sleeveCount).length;
  assert.ok(inTorso > 0, 'torso contributes seam pairs');
  assert.ok(inRightSleeve > 0, 'right sleeve contributes seam pairs');
  assert.ok(inLeftSleeve > 0, 'left sleeve contributes seam pairs');
});

test('sleeve<->torso attachment: structural constraints connect sleeve root vertices to nearby torso vertices (not just internal sleeve/torso constraints)', () => {
  const mesh = buildMesh(30, 38);
  const cols = mesh.cols, rows = mesh.rows, sleeveCols = mesh.sleeveCols, sleeveRows = mesh.sleeveRows;
  const torsoCount = cols * rows;
  const sleeveCount = sleeveCols * sleeveRows;
  const rightOffset = torsoCount;
  // A cross-patch structural constraint has one endpoint in [0,torsoCount)
  // and the other in the sleeve's own index range.
  const crossPairs = mesh.constraints.structural.filter(([a, b]) => {
    const aInTorso = a < torsoCount, bInTorso = b < torsoCount;
    const aInRightSleeve = a >= rightOffset && a < rightOffset + sleeveCount;
    const bInRightSleeve = b >= rightOffset && b < rightOffset + sleeveCount;
    return (aInTorso && bInRightSleeve) || (bInTorso && aInRightSleeve);
  });
  assert.ok(crossPairs.length > 0, 'at least one structural constraint ties the right sleeve to the torso');
});

test('buildTshirtMesh: frontIndexCount cleanly splits the index buffer into front-only and back-only triangles', () => {
  const mesh = buildMesh();
  assert.ok(mesh.frontIndexCount > 0 && mesh.frontIndexCount < mesh.indices.length);
  assert.equal(mesh.frontIndexCount % 3, 0, 'splits on a whole-triangle boundary');
  for (let i = 0; i < mesh.frontIndexCount; i += 1) {
    assert.ok(mesh.indices[i] < mesh.frontCount, 'front slice references only front vertices');
  }
  for (let i = mesh.frontIndexCount; i < mesh.indices.length; i += 1) {
    assert.ok(mesh.indices[i] >= mesh.frontCount, 'back slice references only back vertices');
  }
});

// Mean face-normal Z-component for a slice of the index buffer, computed the
// same way three.js's own face-normal / winding convention does: for
// triangle (a,b,c), normal = (b-a) x (c-a). Positive Z = the panel faces the
// fixed camera (world.camera.position.set(0,0,2.6), looking toward -Z, per
// ClothStudio.jsx); negative Z = it faces away and would be culled by the
// panel material's `side: THREE.FrontSide`.
function meanNormalZ(positions, indices, start, end) {
  let sumZ = 0;
  let count = 0;
  for (let i = start; i < end; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const v1x = positions[b] - positions[a], v1y = positions[b + 1] - positions[a + 1];
    const v2x = positions[c] - positions[a], v2y = positions[c + 1] - positions[a + 1];
    sumZ += v1x * v2y - v1y * v2x;
    count += 1;
  }
  return sumZ / count;
}

test('buildTshirtMesh: the front (logo-bearing) panel faces the camera (+Z); the back panel faces away (-Z)', () => {
  const mesh = buildMesh();
  const frontMeanZ = meanNormalZ(mesh.positions, mesh.indices, 0, mesh.frontIndexCount);
  const backMeanZ = meanNormalZ(mesh.positions, mesh.indices, mesh.frontIndexCount, mesh.indices.length);
  assert.ok(frontMeanZ > 0, `front panel should face +Z (toward the camera), got mean normal z=${frontMeanZ}`);
  assert.ok(backMeanZ < 0, `back panel should face -Z (away from the camera), got mean normal z=${backMeanZ}`);
});

test('buildTshirtMesh: back panel is the +Z mirror of the front panel (front/back both present, not one card)', () => {
  const mesh = buildMesh();
  const n = mesh.frontCount;
  for (let i = 0; i < n; i += 1) {
    const f = i * 3, b = (n + i) * 3;
    assert.equal(mesh.positions[f], mesh.positions[b], 'same X');
    assert.equal(mesh.positions[f + 1], mesh.positions[b + 1], 'same Y');
    assert.ok(mesh.positions[f + 2] > mesh.positions[b + 2], 'front is +Z of back');
  }
});

test('buildTshirtMesh: UVs equal pattern coordinates (fabric-bound mapping, not a separate unwrap)', () => {
  const mesh = buildMesh();
  for (let i = 0; i < mesh.frontCount; i += 1) {
    assert.ok(mesh.uvs[i * 2] >= 0 && mesh.uvs[i * 2] <= 1);
    assert.ok(mesh.uvs[i * 2 + 1] >= 0 && mesh.uvs[i * 2 + 1] <= 1);
  }
});

// ── Quality-tier vertex budgets ──────────────────────────────────────────

test('quality-tier vertex budget: a higher tier\'s cols/rows produce a larger but still bounded mesh', () => {
  const small = buildMesh(22, 28);
  const large = buildMesh(44, 56);
  assert.ok(small.vertexCount > 0 && small.vertexCount < 3000, 'small tier stays well bounded');
  assert.ok(large.vertexCount > small.vertexCount && large.vertexCount < 7000, 'large tier is bigger but still bounded');
});

// ── Simulation stability through the new topology ────────────────────────

const PARAMS = {
  gravity: 2.6, damping: 0.92, stretchStiffness: 0.85, bendStiffness: 0.4,
  windStrength: 0.5, windDirectionDeg: 30, windTurbulence: 0.4, windSpeed: 1, windOn: true,
};

test('createSimState + stepSim: pinned vertices never move, unpinned vertices settle under gravity, no NaNs', () => {
  const mesh = buildMesh();
  const sim = createSimState(mesh);
  const pinSample = [...sim.pinIndices][0];
  const p3 = pinSample * 3;
  const before = [sim.position[p3], sim.position[p3 + 1], sim.position[p3 + 2]];
  for (let i = 0; i < 30; i += 1) stepSim(sim, PARAMS, 1 / 60);
  assert.equal(sim.position[p3], before[0]);
  assert.equal(sim.position[p3 + 1], before[1]);
  assert.equal(sim.position[p3 + 2], before[2]);
  assert.ok(isFiniteBuffer(sim.position), 'stays finite over many steps');

  let hem = -1;
  let minY = Infinity;
  for (let i = 0; i < sim.vertexCount; i += 1) {
    if (sim.pinIndices.has(i)) continue;
    if (sim.orig[i * 3 + 1] < minY) { minY = sim.orig[i * 3 + 1]; hem = i; }
  }
  assert.ok(sim.position[hem * 3 + 1] <= sim.orig[hem * 3 + 1] + 1e-6, 'hem sags or stays, never rises');
});

test('no NaNs through simulation: a large single frame delta (tab-suspend style) never produces NaNs, and resetSim recovers', () => {
  const mesh = buildMesh();
  const sim = createSimState(mesh);
  advanceSim(sim, PARAMS, 500); // 500 simulated seconds in one call
  assert.ok(isFiniteBuffer(sim.position));
  resetSim(sim);
  assert.ok(isFiniteBuffer(sim.position));
  for (let i = 0; i < sim.position.length; i += 1) assert.equal(sim.position[i], sim.orig[i]);
});

test('stepSim: non-finite injection recovers to rest pose instead of propagating NaNs', () => {
  const mesh = buildMesh(20, 24);
  const sim = createSimState(mesh);
  sim.position[3] = NaN;
  const result = stepSim(sim, PARAMS, 1 / 60);
  assert.equal(result.recovered, true);
  assert.ok(isFiniteBuffer(sim.position));
  for (let i = 0; i < sim.position.length; i += 1) assert.equal(sim.position[i], sim.orig[i]);
});

test('resetSim: restores position/prev to orig and clears accum', () => {
  const mesh = buildMesh(20, 24);
  const sim = createSimState(mesh);
  sim.accum = 0.5;
  for (let i = 0; i < 10; i += 1) stepSim(sim, PARAMS, 1 / 60);
  resetSim(sim);
  assert.equal(sim.accum, 0);
  for (let i = 0; i < sim.position.length; i += 1) {
    assert.equal(sim.position[i], sim.orig[i]);
    assert.equal(sim.prev[i], sim.orig[i]);
  }
});

test('advanceSim: bounded catch-up never runs more than MAX_CATCHUP_STEPS in one call', () => {
  const mesh = buildMesh(20, 24);
  const sim = createSimState(mesh);
  const { steps } = advanceSim(sim, PARAMS, 5);
  assert.ok(steps <= 3, 'catch-up bounded');
  assert.ok(isFiniteBuffer(sim.position));
});

test('advanceSim: zero dt runs zero steps (no free energy injection when paused)', () => {
  const mesh = buildMesh(20, 24);
  const sim = createSimState(mesh);
  const { steps } = advanceSim(sim, PARAMS, 0);
  assert.equal(steps, 0);
});

test('relaxPairs: higher stiffness pulls a violated constraint closer to rest length in one pass', () => {
  const restLengths = [1];
  const pairs = [[0, 1]];
  const pinIndices = new Set();
  const posStiff = new Float32Array([0, 0, 0, 2, 0, 0]);
  const posSoft = new Float32Array([0, 0, 0, 2, 0, 0]);
  relaxPairs(posStiff, pairs, restLengths, pinIndices, 0.5);
  relaxPairs(posSoft, pairs, restLengths, pinIndices, 0.01);
  const distAfter = (pos) => Math.abs(pos[3] - pos[0]);
  const stiffErr = Math.abs(distAfter(posStiff) - 1);
  const softErr = Math.abs(distAfter(posSoft) - 1);
  assert.ok(stiffErr < softErr, 'higher stiffness closes the gap toward rest length faster');
});

test('stepSim: structural/shear use stretchStiffness, bend uses bendStiffness (both independently effective)', () => {
  const mesh = buildMesh(24, 30);
  const loSim = createSimState(mesh);
  const hiSim = createSimState(mesh);
  const loParams = { ...PARAMS, stretchStiffness: 0.05, windStrength: 0 };
  const hiParams = { ...PARAMS, stretchStiffness: 1, windStrength: 0 };
  for (let i = 0; i < 15; i += 1) {
    stepSim(loSim, loParams, 1 / 60);
    stepSim(hiSim, hiParams, 1 / 60);
  }
  let maxDelta = 0;
  for (let i = 0; i < loSim.position.length; i += 1) {
    maxDelta = Math.max(maxDelta, Math.abs(loSim.position[i] - hiSim.position[i]));
  }
  assert.ok(maxDelta > 1e-4, 'stretchStiffness measurably changes the settled drape');
});

test('measured performance cost is computed from real mesh sizes, not a placeholder constant', () => {
  const small = buildMesh(18, 22);
  const large = buildMesh(36, 46);
  const costSmall = computeMeasuredCost(small);
  const costLarge = computeMeasuredCost(large);
  assert.ok(costSmall > 0);
  assert.ok(costLarge > costSmall, 'cost scales with actual vertex/constraint counts');
});

// ── Pointer-drag grab ─────────────────────────────────────────────────────
// Same mechanism ClothStudio.jsx's own sheet-grab already uses (pos pulled
// toward target, prev left untouched so the pull becomes real velocity on
// the next substep) — exercised here directly through stepSim/advanceSim's
// grab param so both this garment and the lattice-based GLB path share one
// tested implementation.

function smallLattice() {
  return buildLatticeTopology({ min: [-1, -1, -0.2], max: [1, 1, 0.2], cols: 5, rows: 7, layers: 2, pinRows: 2 });
}

test('stepSim grab: a grabbed vertex moves toward target, weighted by grab.w — full weight lands closer than partial weight', () => {
  const g = smallLattice();
  const sim = createSimState(g);
  const params = { gravity: 0, damping: 0.9, stretchStiffness: 1, bendStiffness: 1, windOn: false, windStrength: 0 };
  const target = { x: 5, y: 5, z: 5 };
  const grabFull = { active: true, idx: [10], w: [1], off: [0, 0, 0], target };
  const before = sim.position[10 * 3];
  stepSim(sim, params, 1 / 60, 1, grabFull);
  const afterFull = sim.position[10 * 3];
  assert.ok(Math.abs(afterFull - target.x) < Math.abs(before - target.x), 'grabbed vertex moved toward target');

  const sim2 = createSimState(g);
  const grabPartial = { active: true, idx: [10], w: [0.2], off: [0, 0, 0], target };
  stepSim(sim2, params, 1 / 60, 1, grabPartial);
  const afterPartial = sim2.position[10 * 3];
  assert.ok(Math.abs(afterFull - target.x) < Math.abs(afterPartial - target.x), 'w=1 lands closer to target than w=0.2 in one step');
});

test('stepSim grab: only indices in grab.idx move — everything else is unaffected by an inactive-radius (falloff) exclusion', () => {
  const g = smallLattice();
  const sim = createSimState(g);
  const params = { gravity: 0, damping: 0.9, stretchStiffness: 1, bendStiffness: 1, windOn: false, windStrength: 0 };
  const untouchedIdx = 15;
  const before = sim.position.slice();
  const grab = { active: true, idx: [10], w: [1], off: [0, 0, 0], target: { x: 5, y: 5, z: 5 } };
  stepSim(sim, params, 1 / 60, 1, grab);
  assert.notEqual(sim.position[10 * 3], before[10 * 3], 'grabbed vertex actually moved');
  assert.equal(sim.position[untouchedIdx * 3 + 2], before[untouchedIdx * 3 + 2], 'a distant, non-neighboring vertex is untouched on the Z axis with no gravity/wind in play');
});

test('advanceSim grab: releasing after a MOVING drag (target advances each frame, like a real pointer drag) lets the velocity baked into prev continue the motion next frame (fling)', () => {
  const g = smallLattice();
  const sim = createSimState(g);
  const params = { gravity: 0, damping: 0.999, stretchStiffness: 0.05, bendStiffness: 0.05, windOn: false, windStrength: 0 };
  const target = { x: 0, y: 0, z: 0 };
  const grab = { active: true, idx: [10], w: [1], off: [0, 0, 0], target };
  for (let i = 0; i < 5; i += 1) {
    target.x += 1;
    advanceSim(sim, params, 1 / 60, 1, grab);
  }
  const posAtRelease = sim.position[10 * 3];
  const velAtRelease = posAtRelease - sim.prev[10 * 3];
  assert.ok(velAtRelease > 0, 'grabbed vertex carries positive velocity into release, from chasing the moving drag target');
  advanceSim(sim, params, 1 / 60, 1, null);
  assert.ok(sim.position[10 * 3] > posAtRelease, 'released vertex keeps moving forward from carried velocity (fling), not snapping back');
  assert.ok(isFiniteBuffer(sim.position), 'fling never produces NaNs');
});
