import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OUTPUT_FORMATS, CAMERA_Z, FOV_DEG, NEAR_PLANE_MARGIN,
  projectSphereToNDC, isFramedNDC, overlapsSafeZoneNDC, evaluatePlacement,
  placementWarningForInstance, boundingRadiusForInstance,
  defaultPositionForFormat, defaultTransformForFormat, offsetPosition, resolveEffectiveInstance, DUPLICATE_OFFSET,
  maxFeasibleAxisOffset, cornerCandidate,
} from '../placement.js';
import { FACTORIES } from '../factories.js';
import { getElementDefinition, ELEMENT_CATALOG, TRANSFORM_RANGES } from '../catalog.js';
import { createElementInstance } from '../schema.js';

const FORMAT_IDS = Object.keys(OUTPUT_FORMATS);
const PHASE2_TYPES = Object.keys(FACTORIES);
const CLEARING_TYPES = ['chrome-ribbon', 'translucent-monoliths', 'liquid-glass-lens', 'floating-media-frame'];
const OVERLAP_TYPES = ['kinetic-rings', 'glass-petal-sphere', 'homepage-particle-hero'];

// ── projectSphereToNDC / isFramedNDC / overlapsSafeZoneNDC — the shared
// projection every other check in this module (and this test file) funnels
// through. ────────────────────────────────────────────────────────────────

test('projectSphereToNDC: a point sphere (radius 0) at the origin projects to NDC (0,0) in every format', () => {
  FORMAT_IDS.forEach((formatId) => {
    const p = projectSphereToNDC([0, 0, 0], 0, formatId);
    assert.equal(p.nearPlaneViolation, false);
    assert.equal(p.ndcMinX, 0);
    assert.equal(p.ndcMaxX, 0);
    assert.equal(p.ndcMinY, 0);
    assert.equal(p.ndcMaxY, 0);
  });
});

test('projectSphereToNDC: nearDepth is the distance from the camera to the sphere\'s NEAREST (closest-to-camera) point, not its center', () => {
  const p = projectSphereToNDC([0, 0, -0.5], 0.3, 'landscape');
  // nearest point is at z + radius = -0.2; distance from camera = CAMERA_Z - (-0.2)
  assert.equal(p.nearDepth, CAMERA_Z - (-0.5 + 0.3));
});

test('isFramedNDC: a point sphere at the origin is framed in every format; a huge offset is not', () => {
  FORMAT_IDS.forEach((formatId) => {
    assert.equal(isFramedNDC(projectSphereToNDC([0, 0, 0], 0, formatId)), true);
    assert.equal(isFramedNDC(projectSphereToNDC([50, 50, 0], 0, formatId)), false);
  });
});

test('overlapsSafeZoneNDC: a point sphere at the origin overlaps in every format; something clearly outside the frame does not', () => {
  FORMAT_IDS.forEach((formatId) => {
    assert.equal(overlapsSafeZoneNDC(projectSphereToNDC([0, 0, 0], 0, formatId)), true);
    assert.equal(overlapsSafeZoneNDC(projectSphereToNDC([50, 50, 0], 0, formatId)), false);
  });
});

test('evaluatePlacement: outside-frame takes precedence over overlaps-artwork', () => {
  const w = evaluatePlacement([100, 100, 0], 0, 'landscape');
  assert.equal(w.code, 'outside-frame');
});

test('evaluatePlacement: null (clear) for a small point comfortably between the safe zone and the frame edge', () => {
  // origin overlaps (0 is always inside ±0.55); a point far enough out clears
  // the safe zone (NDC ±0.55) while still framed (NDC ±1) — e.g. NDC 0.75.
  const nearDepth = CAMERA_Z - 0;
  const tanY = Math.tan((FOV_DEG / 2) * (Math.PI / 180));
  const worldX = 0.75 * nearDepth * tanY * getFormat_aspect('landscape');
  assert.equal(evaluatePlacement([worldX, 0, 0], 0, 'landscape'), null);
});
function getFormat_aspect(formatId) { return OUTPUT_FORMATS[formatId].aspect; }

// ── Independent oracle: every REAL point on the sphere surface must project
// inside the interval projectSphereToNDC returns. This does not reuse
// projectSphereToNDC's own formula at all — it independently projects
// literal (x,y,z) points sampled directly on the sphere (each via the
// single-point perspective-divide formula, using THAT point's own actual
// depth, which is unambiguous and not an approximation) and checks
// containment. An earlier version of projectSphereToNDC passed every
// existing test in this file while FAILING this property for off-center
// spheres (an external review caught it with the counterexamples below,
// independently reproduced here) — this is exactly the class of bug a
// same-formula test can't catch, which is why this oracle exists. ─────────

function projectPoint(px, py, pz, formatId) {
  const depth = CAMERA_Z - pz;
  const tanY = Math.tan((FOV_DEG / 2) * (Math.PI / 180));
  const tanX = tanY * getFormat_aspect(formatId);
  return { ndcX: px / (depth * tanX), ndcY: py / (depth * tanY) };
}

/** Sample many points genuinely ON a sphere's surface (spherical coordinates), independent of any code under test. */
function sampleSpherePoints(center, radius, count = 200) {
  const [cx, cy, cz] = center;
  const points = [];
  for (let i = 0; i < count; i += 1) {
    // Deterministic, well-spread sampling (golden-angle-ish), not random —
    // this is a test, it must be reproducible.
    const theta = Math.acos(1 - (2 * (i + 0.5)) / count); // polar angle, evenly spread in cos
    const phi = i * 2.399963229728653; // golden angle azimuth
    points.push([
      cx + radius * Math.sin(theta) * Math.cos(phi),
      cy + radius * Math.sin(theta) * Math.sin(phi),
      cz + radius * Math.cos(theta),
    ]);
  }
  return points;
}

const OFF_CENTER_SPHERES = [
  { position: [0.6, 0.3, -0.5], radius: 0.4 },
  { position: [-0.9, -0.4, -1.0], radius: 0.6 },
  { position: [1.2, -0.7, 0.2], radius: 0.3 },
  { position: [-0.3, 0.9, -0.2], radius: 0.5 },
  { position: [0.05, -0.05, 0.4], radius: 0.15 },
];

OFF_CENTER_SPHERES.forEach(({ position, radius }, idx) => {
  test(`oracle: every real point on off-center sphere #${idx} (pos=${JSON.stringify(position)}, r=${radius}) projects inside the returned interval, in every format`, () => {
    FORMAT_IDS.forEach((formatId) => {
      const projected = projectSphereToNDC(position, radius, formatId);
      if (projected.nearPlaneViolation) return; // interval isn't meaningful here by contract — nothing to check
      sampleSpherePoints(position, radius).forEach((point) => {
        const { ndcX, ndcY } = projectPoint(point[0], point[1], point[2], formatId);
        assert.ok(ndcX >= projected.ndcMinX - 1e-9 && ndcX <= projected.ndcMaxX + 1e-9,
          `${formatId}: point ${JSON.stringify(point)} projects to ndcX=${ndcX}, outside returned [${projected.ndcMinX}, ${projected.ndcMaxX}]`);
        assert.ok(ndcY >= projected.ndcMinY - 1e-9 && ndcY <= projected.ndcMaxY + 1e-9,
          `${formatId}: point ${JSON.stringify(point)} projects to ndcY=${ndcY}, outside returned [${projected.ndcMinY}, ${projected.ndcMaxY}]`);
      });
    });
  });
});

// The two counterexamples an external review found against the prior
// (shared-nearDepth) approximation — both previously read as "clear" and are
// genuine safe-zone overlaps once projected correctly.
test('regression (external review): Chrome Ribbon-shaped sphere at [-1.484,0.65,-0.8] r=0.423 in Landscape genuinely overlaps the safe zone', () => {
  const w = evaluatePlacement([-1.484, 0.65, -0.8], 0.9 * 0.47, 'landscape');
  assert.equal(w?.code, 'overlaps-artwork');
});

test('regression (external review): Liquid-Glass-Lens-shaped sphere at [0.662,0.662,0.05] r=0.1886 in Square genuinely overlaps the safe zone', () => {
  const w = evaluatePlacement([0.662, 0.662, 0.05], 0.46 * 0.41, 'square');
  assert.equal(w?.code, 'overlaps-artwork');
});

// ── Near-plane safety ────────────────────────────────────────────────────
// Exit-gate item 4: "Near-plane intersection must return an explicit warning."

test('near-plane: a sphere whose nearest point is within NEAR_PLANE_MARGIN of the camera is flagged, with its own explicit code', () => {
  // position.z + radius must land within NEAR_PLANE_MARGIN of CAMERA_Z.
  const z = CAMERA_Z - NEAR_PLANE_MARGIN + 0.05; // nearest point just inside the margin
  const w = evaluatePlacement([0, 0, z - 0.1], 0.1, 'landscape');
  assert.equal(w.code, 'near-plane-clip');
});

test('near-plane: comfortably far from the camera never trips it, at any reasonable radius', () => {
  FORMAT_IDS.forEach((formatId) => {
    const p = projectSphereToNDC([0, 0, -0.45], 0.5, formatId);
    assert.equal(p.nearPlaneViolation, false);
  });
});

// Exit-gate item 4: "A sphere that fits at its center-Z slice but clips at
// its near side must fail." — the exact regression the perspective fix
// targets: checking clearance using the OBJECT's own (center) Z, rather than
// its nearest point, misses a large sphere whose front face is much closer
// to the camera than its center.
test('regression: a sphere fits comfortably using its CENTER depth\'s frustum, but its NEAR side is close enough to actually clip', () => {
  const position = [0.03, 0, 1.0];
  const radius = 1.0;
  const formatId = 'landscape';
  // The (deliberately wrong) old approach: evaluate the frustum at the
  // sphere's own center Z, not its near side.
  const tanY = Math.tan((FOV_DEG / 2) * (Math.PI / 180));
  const centerDist = CAMERA_Z - position[2];
  const halfWAtCenter = centerDist * tanY * getFormat_aspect(formatId);
  const wouldPassAtCenterZ = Math.abs(position[0]) + radius <= halfWAtCenter;
  assert.equal(wouldPassAtCenterZ, true, 'sanity: this case is DESIGNED to look fine if judged at the center Z');
  // The real (near-side) projection must disagree.
  const projected = projectSphereToNDC(position, radius, formatId);
  assert.equal(isFramedNDC(projected), false, 'the near side has a narrower frustum and must fail here');
  assert.equal(evaluatePlacement(position, radius, formatId).code, 'outside-frame');
});

// Exit-gate item 4: "A background sphere whose projected bounds overlap the
// Z=0 artwork safe region must fail." — a background object positioned at a
// LARGE world-space offset (because the frustum is wide out there) that a
// raw-world-unit comparison against the Z=0 safe zone would have called
// "clear", but which actually projects back inside the safe region on
// screen.
test('regression: a background sphere with a world-space X larger than the safe zone\'s own world half-width can still project INSIDE the safe zone', () => {
  const formatId = 'landscape';
  const position = [1.5, 0, -3]; // deep background; 1.5 world units off-center
  const radius = 0.3;
  // The safe zone's own world half-width at Z=0, for comparison — this is
  // what a (deliberately wrong) raw-world-unit check would have compared
  // `position[0]` against.
  const tanY = Math.tan((FOV_DEG / 2) * (Math.PI / 180));
  const safeWorldHalfWidthAtZ0 = 0.55 * (CAMERA_Z * tanY * getFormat_aspect(formatId));
  assert.ok(Math.abs(position[0]) > safeWorldHalfWidthAtZ0, 'sanity: this case is DESIGNED to look clear under a naive world-unit-at-Z=0 comparison');
  // The real (NDC-projected) check must disagree — properly perspective-
  // divided, this point is still inside the safe region on screen.
  const projected = projectSphereToNDC(position, radius, formatId);
  assert.equal(overlapsSafeZoneNDC(projected), true, 'projected back through the camera, this background point still falls inside the safe zone');
  assert.equal(evaluatePlacement(position, radius, formatId).code, 'overlaps-artwork');
});

// ── boundingRadiusForInstance ────────────────────────────────────────────

test('boundingRadiusForInstance: scales the catalog-declared local radius by the instance\'s largest scale axis', () => {
  const def = { bounds: { localRadius: 1 } };
  assert.equal(boundingRadiusForInstance({ transform: { scale: [1, 1, 1] } }, def), 1);
  assert.equal(boundingRadiusForInstance({ transform: { scale: [2, 1, 1] } }, def), 2);
  assert.equal(boundingRadiusForInstance({ transform: { scale: [0.4, 0.4, 0.4] } }, def), 0.4);
});

test('boundingRadiusForInstance: a type with no declared bounds falls back to 0 (a point), not a crash', () => {
  assert.equal(boundingRadiusForInstance({ transform: { scale: [2, 2, 2] } }, { bounds: undefined }), 0);
  assert.equal(boundingRadiusForInstance({ transform: { scale: [2, 2, 2] } }, null), 0);
});

// ── Per-type, per-format defaults — validated through the SAME production
// projection validator (evaluatePlacement/placementWarningForInstance) used
// everywhere else. Exit-gate item 4: "Every generated Phase 2 default must
// pass the same production projection validator in landscape, square, and
// reel." — for types/formats where genuine clearance is physically possible
// within the allowed transform bounds, it must. Item 3 explicitly allows —
// and requires — an HONEST `feasible:false` report (not a silently invalid
// "success") for the combinations where it genuinely is not possible; those
// are asserted here too, by name, so a constant/bounds change that silently
// makes one MORE combination infeasible (or incorrectly claims one is now
// feasible) fails this test instead of shipping unnoticed. ─────────────────

// translucent-monoliths (local radius 1.02) is genuinely, provably too large
// to clear both the frame and the artwork safe zone in ANY format within
// TRANSFORM_RANGES; chrome-ribbon (0.9) clears in Landscape (its wider
// aspect gives real X headroom a square/tall frame doesn't) but not in
// Square or Reel. Verified by exhaustive brute-force grid search (every
// scale down to 0.4, every depth out to the position-bound cap, a dense
// x/y grid — not just the corner the production search happens to try) with
// no dependency on `cornerCandidate`'s own logic, so this isn't just "the
// search says so." This is not a bug; it's the exit-gate's own reporting
// requirement working correctly, against numbers that are actually right.
//
// This table changed twice this round, both times because the SEARCH was
// wrong, not the underlying geometry:
//  1. The original (shared-nearDepth-approximation) projection under-stated
//     how far a sphere's near-center edge reaches toward screen center, so
//     it incorrectly reported liquid-glass-lens/floating-media-frame in Reel
//     as infeasible when they actually clear.
//  2. The tangent-cone projection fix was correct, but `cornerCandidate`
//     still coupled X and Y to one shared push fraction — in a non-square
//     format the tighter axis capped the looser one before it reached its
//     own true maximum, so chrome-ribbon:landscape was reported infeasible
//     even though a real solution exists (`x=1.5, y=0` — see the named
//     regression below). Fixed by maximizing each axis independently
//     (`maxFeasibleAxisOffset`/`cornerCandidate`), which is what this table
//     now reflects.
const KNOWN_INFEASIBLE = new Set([
  'chrome-ribbon:square', 'chrome-ribbon:reel',
  'translucent-monoliths:landscape', 'translucent-monoliths:square', 'translucent-monoliths:reel',
]);

test('every Phase 2 type has a deliberate, non-[0,0,0] default position in every format', () => {
  PHASE2_TYPES.forEach((type) => {
    FORMAT_IDS.forEach((formatId) => {
      const pos = defaultPositionForFormat(type, formatId, getElementDefinition(type));
      assert.notDeepEqual(pos, [0, 0, 0], `${type}/${formatId} should not default to the origin`);
    });
  });
});

test('every Phase 2 default TRANSFORM stays within TRANSFORM_RANGES (position/scale) — never silently clamped by validators later', () => {
  PHASE2_TYPES.forEach((type) => {
    FORMAT_IDS.forEach((formatId) => {
      const { position, scale } = defaultTransformForFormat(type, formatId, getElementDefinition(type));
      position.forEach((v) => assert.ok(v >= TRANSFORM_RANGES.position.min && v <= TRANSFORM_RANGES.position.max, `${type}/${formatId} position ${v} out of range`));
      scale.forEach((v) => assert.ok(v >= TRANSFORM_RANGES.scale.min && v <= TRANSFORM_RANGES.scale.max, `${type}/${formatId} scale ${v} out of range`));
    });
  });
});

test('every Phase 2 default, run through the production validator, matches its expected feasible/infeasible status', () => {
  CLEARING_TYPES.forEach((type) => {
    const def = getElementDefinition(type);
    FORMAT_IDS.forEach((formatId) => {
      const t = defaultTransformForFormat(type, formatId, def);
      const instance = createElementInstance(type, { id: `${type}-1`, enabled: true, transform: t });
      const warning = placementWarningForInstance(instance, formatId, def);
      const key = `${type}:${formatId}`;
      if (KNOWN_INFEASIBLE.has(key)) {
        assert.equal(t.feasible, false, `${key} should be reported infeasible`);
        assert.ok(t.constraint, `${key} should explain WHY it's infeasible`);
        assert.ok(warning, `${key} should still surface a real (non-null) placement warning — never a silent "looks fine"`);
        assert.notEqual(warning.code, 'intentional-overlap', `${key} is not an intentional-overlap type`);
      } else {
        assert.equal(t.feasible, true, `${key} should be genuinely feasible`);
        assert.equal(t.constraint, null, `${key} should have no constraint message`);
        assert.equal(warning, null, `${key} should have no placement warning`);
      }
    });
  });
});

// ── cornerCandidate independence regression (external review) ───────────
// The prior `cornerCandidate` coupled X and Y to one shared bisected push
// fraction `t`, so in a non-square format the tighter axis stopped the
// bisection before the looser axis reached its own true maximum. Confirmed
// against production numbers: Chrome Ribbon in Landscape (local radius 0.9,
// scale 0.43) reads genuinely clear at `x=1.5, y=0`, but the coupled search
// could never reach that point because y's tighter bound capped the shared
// `t` first — and reported the whole type/format infeasible as a result.

test('regression (external review): Chrome Ribbon in Landscape at [1.5,0,-0.45] scale 0.43 genuinely clears the frame and safe zone', () => {
  const w = evaluatePlacement([1.5, 0, -0.45], 0.9 * 0.43, 'landscape');
  assert.equal(w, null, 'a real valid transform exists here — the search must be able to find it (or an equally valid one)');
});

test('chrome-ribbon:landscape is now reported feasible, with a default that actually clears production validation', () => {
  const def = getElementDefinition('chrome-ribbon');
  const t = defaultTransformForFormat('chrome-ribbon', 'landscape', def);
  assert.equal(t.feasible, true);
  assert.equal(t.constraint, null);
  const instance = createElementInstance('chrome-ribbon', { id: 'cr-landscape', enabled: true, transform: t });
  assert.equal(placementWarningForInstance(instance, 'landscape', def), null);
});

test('maxFeasibleAxisOffset: X and Y maxima are computed independently — an asymmetric (non-square) format gives them genuinely different values', () => {
  // Landscape's aspect (>1) gives strictly more X headroom than Y headroom
  // for an off-center sphere at the same depth — a coupled shared-fraction
  // search could never express this difference; independent maximization
  // must.
  const z = -0.45;
  const r = 0.9 * 0.43;
  const positionMax = TRANSFORM_RANGES.position.max;
  const maxX = maxFeasibleAxisOffset('x', z, r, 'landscape', positionMax);
  const maxY = maxFeasibleAxisOffset('y', z, r, 'landscape', positionMax);
  assert.ok(maxX > maxY, `expected landscape's wider aspect to give more X (${maxX}) than Y (${maxY}) headroom`);
});

test('cornerCandidate: combines the independently-maximized X and Y, not a single coupled shared fraction', () => {
  const z = -0.45;
  const r = 0.9 * 0.43;
  const positionMax = TRANSFORM_RANGES.position.max;
  const maxX = maxFeasibleAxisOffset('x', z, r, 'landscape', positionMax);
  const maxY = maxFeasibleAxisOffset('y', z, r, 'landscape', positionMax);
  const corner = cornerCandidate(r, z, 1, -1, 'landscape', positionMax);
  // cornerCandidate rounds to 3dp for storage (round3) — tolerate that, not
  // the underlying independence, which is what this test actually guards.
  assert.ok(Math.abs(corner[0] - maxX) < 1e-3, `corner x=${corner[0]} should equal the independently-maximized x=${maxX}`);
  assert.ok(Math.abs(corner[1] - -maxY) < 1e-3, `corner y=${corner[1]} should equal the independently-maximized y=${-maxY}`);
});

// Guards the whole per-type/per-format table above against ever silently
// exceeding what's independently provable, in every format — not just the
// one hand-picked Landscape example — so aspect-ratio asymmetry (Square is
// symmetric; Landscape/Reel are not) can't quietly regress in either
// direction (a coupled search back-sliding, or a future change over-pushing
// past what's actually framed).
test('every feasible clearing default stays within the independently-computed per-axis maximum, in every format', () => {
  CLEARING_TYPES.forEach((type) => {
    const def = getElementDefinition(type);
    FORMAT_IDS.forEach((formatId) => {
      const key = `${type}:${formatId}`;
      if (KNOWN_INFEASIBLE.has(key)) return;
      const t = defaultTransformForFormat(type, formatId, def);
      const r = def.bounds.localRadius * t.scale[0];
      const positionMax = TRANSFORM_RANGES.position.max;
      const maxX = maxFeasibleAxisOffset('x', t.position[2], r, formatId, positionMax);
      const maxY = maxFeasibleAxisOffset('y', t.position[2], r, formatId, positionMax);
      // +1e-3 tolerates defaultTransformForFormat's 3dp storage rounding
      // (round3), not the underlying independent-maximum bound itself.
      assert.ok(Math.abs(t.position[0]) <= maxX + 1e-3, `${key} x=${t.position[0]} exceeds independent max ${maxX}`);
      assert.ok(Math.abs(t.position[1]) <= maxY + 1e-3, `${key} y=${t.position[1]} exceeds independent max ${maxY}`);
    });
  });
});

// homepage-particle-hero's declared bound (2.1) is deliberately the WORST
// CASE across its full appearance-slider range (chaos/waveAmplitude aren't
// topology fields, so a user can dial either to max without a rebuild — see
// catalog.js's comment on this type's bounds) — the SAME "conservative
// regardless of the instance's actual, less-extreme settings" philosophy
// chrome-ribbon/translucent-monoliths' bounds already use. At that bound,
// Reel's frame genuinely cannot fit it even at TRANSFORM_RANGES.scale.min —
// same kind of real, provable constraint as those two, not a bug.
const KNOWN_INFEASIBLE_CENTERED = new Set(['homepage-particle-hero:reel']);

['kinetic-rings', 'homepage-particle-hero'].forEach((type) => {
  test(`${type} deliberately overlaps the safe zone by design, in every format — flagged intentional-overlap, never a plain warning, and still genuinely framed where feasible`, () => {
    const def = getElementDefinition(type);
    FORMAT_IDS.forEach((formatId) => {
      const t = defaultTransformForFormat(type, formatId, def);
      const key = `${type}:${formatId}`;
      const instance = createElementInstance(type, { id: `${type}-1`, enabled: true, transform: t });
      const warning = placementWarningForInstance(instance, formatId, def);
      if (KNOWN_INFEASIBLE_CENTERED.has(key)) {
        assert.equal(t.feasible, false, `${key} should be reported infeasible`);
        assert.ok(t.constraint, `${key} should explain WHY it's infeasible`);
        assert.ok(warning, `${key} should still surface a real placement warning`);
      } else {
        assert.equal(t.feasible, true, `${key} should be feasible (frame-fit only)`);
        assert.equal(warning?.code, 'intentional-overlap', `${key} should read intentional-overlap`);
      }
    });
  });
});

// ── GLB Import (Phase 3) ─────────────────────────────────────────────────
// Its declared bound (0.46 — see catalog.js's own comment on why this is
// NOT the full unit-sphere normalization target) was specifically
// calibrated against this real search after an initial 1.0/1.15 attempt
// was found genuinely infeasible in every format — this regression guards
// that calibration against silently regressing back to that state.
test('glb-import: with its calibrated bound, the default is genuinely feasible in every format', () => {
  const def = getElementDefinition('glb-import');
  ['landscape', 'square', 'reel'].forEach((formatId) => {
    const t = defaultTransformForFormat('glb-import', formatId, def);
    assert.equal(t.feasible, true, `glb-import:${formatId} should be feasible`);
    assert.equal(t.constraint, null);
    const instance = createElementInstance('glb-import', { id: 'glb-1', enabled: true, transform: t });
    assert.equal(placementWarningForInstance(instance, formatId, def), null);
  });
});

// ── Optical pack (Phase 4) ───────────────────────────────────────────────
// prismatic-slab (radius 0.6) and iridescent-film (radius 0.8) are
// genuinely feasible in Landscape only — the same real, honest constraint
// chrome-ribbon (0.9) already has, confirmed by the same brute-force-grid
// cross-check used for that type (a dense position/depth/scale sweep run
// directly against evaluatePlacement, independent of defaultTransformForFormat's
// own search) before accepting this as a real limitation, not an anchor-
// choice mistake. gel-panels is centered/intentional-overlap (like kinetic-
// rings) — feasible everywhere at full scale by design.
const OPTICAL_PACK_INFEASIBLE = new Set([
  'prismatic-slab:square', 'prismatic-slab:reel',
  'iridescent-film:square', 'iridescent-film:reel',
]);

test('Optical pack: prismatic-slab and iridescent-film clear Landscape but are honestly infeasible in Square/Reel at their real radii', () => {
  ['prismatic-slab', 'iridescent-film'].forEach((type) => {
    const def = getElementDefinition(type);
    ['landscape', 'square', 'reel'].forEach((formatId) => {
      const t = defaultTransformForFormat(type, formatId, def);
      const key = `${type}:${formatId}`;
      if (OPTICAL_PACK_INFEASIBLE.has(key)) {
        assert.equal(t.feasible, false, `${key} should be reported infeasible`);
        assert.ok(t.constraint);
      } else {
        assert.equal(t.feasible, true, `${key} should be feasible`);
        const instance = createElementInstance(type, { id: `${type}-1`, enabled: true, transform: t });
        assert.equal(placementWarningForInstance(instance, formatId, def), null);
      }
    });
  });
});

test('Optical pack: gel-panels is feasible in every format at full scale (centered, intentional-overlap, like kinetic-rings)', () => {
  const def = getElementDefinition('gel-panels');
  ['landscape', 'square', 'reel'].forEach((formatId) => {
    const t = defaultTransformForFormat('gel-panels', formatId, def);
    assert.equal(t.feasible, true);
    assert.deepEqual(t.scale, [1, 1, 1]);
    const instance = createElementInstance('gel-panels', { id: 'gel-1', enabled: true, transform: t });
    const warning = placementWarningForInstance(instance, formatId, def);
    assert.equal(warning?.code, 'intentional-overlap');
  });
});

// ── Reflective/Sculptural pack (Phase 4) ─────────────────────────────────
// Unlike the Optical pack, every one of these four is genuinely feasible in
// all three formats at their calibrated radii — empirically checked via
// defaultTransformForFormat directly (same discipline as every other type's
// calibration), not assumed. inflatable-forms and logo-sculpture were first
// tried at a 'foreground' anchor depth (matching liquid-glass-lens/
// prismatic-slab's own foreground-showcase precedent) and came back
// genuinely infeasible in Square/Reel; switching their anchor to
// 'background' (elements/placement.js ELEMENT_ANCHORS) cleared all three
// formats with no other change, so that was kept over accepting a
// Landscape-only constraint.
test('Reflective/Sculptural pack: orb-constellation, inflatable-forms, mirror-fragments, and logo-sculpture are all feasible in every format', () => {
  ['orb-constellation', 'inflatable-forms', 'mirror-fragments', 'logo-sculpture'].forEach((type) => {
    const def = getElementDefinition(type);
    ['landscape', 'square', 'reel'].forEach((formatId) => {
      const t = defaultTransformForFormat(type, formatId, def);
      assert.equal(t.feasible, true, `${type}:${formatId} should be feasible`);
      assert.equal(t.constraint, null);
      const instance = createElementInstance(type, { id: `${type}-1`, enabled: true, transform: t });
      assert.equal(placementWarningForInstance(instance, formatId, def), null, `${type}:${formatId} default should clear production validation with no warning`);
    });
  });
});

// ── Architectural pack (Phase 4) ──────────────────────────────────────────
// light-tubes and cloth-banners are genuinely Landscape-only at their
// measured radii — both were also tried at the OTHER anchor depth
// (checked directly via defaultTransformForFormat, not assumed) and neither
// cleared more formats, so this is a real geometric limit, same honest-
// constraint precedent as the Optical pack's prismatic-slab/iridescent-film.
// wireframe-sculpture and portal-plane are feasible everywhere (portal-
// plane is centered/intentional-overlap, like kinetic-rings).
const ARCHITECTURAL_PACK_INFEASIBLE = new Set([
  'light-tubes:square', 'light-tubes:reel',
  'cloth-banners:square', 'cloth-banners:reel',
]);

test('Architectural pack: light-tubes and cloth-banners clear Landscape but are honestly infeasible in Square/Reel at their real radii', () => {
  ['light-tubes', 'cloth-banners'].forEach((type) => {
    const def = getElementDefinition(type);
    ['landscape', 'square', 'reel'].forEach((formatId) => {
      const t = defaultTransformForFormat(type, formatId, def);
      const key = `${type}:${formatId}`;
      if (ARCHITECTURAL_PACK_INFEASIBLE.has(key)) {
        assert.equal(t.feasible, false, `${key} should be reported infeasible`);
        assert.ok(t.constraint);
      } else {
        assert.equal(t.feasible, true, `${key} should be feasible`);
        const instance = createElementInstance(type, { id: `${type}-1`, enabled: true, transform: t });
        assert.equal(placementWarningForInstance(instance, formatId, def), null);
      }
    });
  });
});

test('Architectural pack: wireframe-sculpture is feasible in every format', () => {
  const def = getElementDefinition('wireframe-sculpture');
  ['landscape', 'square', 'reel'].forEach((formatId) => {
    const t = defaultTransformForFormat('wireframe-sculpture', formatId, def);
    assert.equal(t.feasible, true, `wireframe-sculpture:${formatId} should be feasible`);
    const instance = createElementInstance('wireframe-sculpture', { id: 'w1', enabled: true, transform: t });
    assert.equal(placementWarningForInstance(instance, formatId, def), null);
  });
});

// Unlike gel-panels/kinetic-rings, portal-plane's ring is deliberately sized
// as a HALO around the cloth sheet (radius 1.05+0.04, well beyond the
// sheet's own largest half-extent 0.86 — see catalog.js's bound comment for
// why: a first, smaller version rendered completely invisible, hidden
// behind the opaque sheet). That larger radius means Reel (the narrowest
// format) genuinely needs to scale DOWN from 1 to clear the frame — full
// scale everywhere is not the right assertion for this type the way it is
// for the smaller centered types.
test('Architectural pack: portal-plane is feasible in every format (centered, intentional-overlap halo, like kinetic-rings)', () => {
  const def = getElementDefinition('portal-plane');
  ['landscape', 'square', 'reel'].forEach((formatId) => {
    const t = defaultTransformForFormat('portal-plane', formatId, def);
    assert.equal(t.feasible, true, `portal-plane:${formatId} should be feasible`);
    assert.ok(t.scale[0] > 0 && t.scale[0] <= 1);
    const instance = createElementInstance('portal-plane', { id: 'p1', enabled: true, transform: t });
    const warning = placementWarningForInstance(instance, formatId, def);
    assert.equal(warning?.code, 'intentional-overlap');
  });
});

// ── Atmospheric/Surface pack (Phase 4) ────────────────────────────────────
// particle-ribbon and caustic-water-light are corner-anchored;
// particle-ribbon is genuinely Landscape-only at its calibrated bound, same
// honest-constraint precedent as light-tubes/cloth-banners. volumetric-
// light-cone and topographic-floor were BOTH first tried at a real corner
// and came back genuinely infeasible in every format at their large
// calibrated bounds (checked directly via defaultTransformForFormat, not
// assumed) — centered/intentional-overlap cleared all three, same
// resolution pattern as Kinetic Rings/Homepage Particle Hero.
const ATMOSPHERIC_PACK_INFEASIBLE = new Set(['particle-ribbon:square', 'particle-ribbon:reel']);

test('Atmospheric/Surface pack: particle-ribbon clears Landscape but is honestly infeasible in Square/Reel; caustic-water-light is feasible everywhere', () => {
  const particleDef = getElementDefinition('particle-ribbon');
  ['landscape', 'square', 'reel'].forEach((formatId) => {
    const t = defaultTransformForFormat('particle-ribbon', formatId, particleDef);
    const key = `particle-ribbon:${formatId}`;
    if (ATMOSPHERIC_PACK_INFEASIBLE.has(key)) {
      assert.equal(t.feasible, false, `${key} should be reported infeasible`);
      assert.ok(t.constraint);
    } else {
      assert.equal(t.feasible, true, `${key} should be feasible`);
      const instance = createElementInstance('particle-ribbon', { id: 'p1', enabled: true, transform: t });
      assert.equal(placementWarningForInstance(instance, formatId, particleDef), null);
    }
  });

  const causticDef = getElementDefinition('caustic-water-light');
  ['landscape', 'square', 'reel'].forEach((formatId) => {
    const t = defaultTransformForFormat('caustic-water-light', formatId, causticDef);
    assert.equal(t.feasible, true, `caustic-water-light:${formatId} should be feasible`);
    const instance = createElementInstance('caustic-water-light', { id: 'c1', enabled: true, transform: t });
    assert.equal(placementWarningForInstance(instance, formatId, causticDef), null);
  });
});

test('Atmospheric/Surface pack: volumetric-light-cone and topographic-floor are feasible in every format (centered, intentional-overlap, like kinetic-rings)', () => {
  ['volumetric-light-cone', 'topographic-floor'].forEach((type) => {
    const def = getElementDefinition(type);
    ['landscape', 'square', 'reel'].forEach((formatId) => {
      const t = defaultTransformForFormat(type, formatId, def);
      assert.equal(t.feasible, true, `${type}:${formatId} should be feasible`);
      const instance = createElementInstance(type, { id: `${type}-1`, enabled: true, transform: t });
      const warning = placementWarningForInstance(instance, formatId, def);
      assert.equal(warning?.code, 'intentional-overlap');
    });
  });
});

// ── Hero pack, final pack (Phase 4) ───────────────────────────────────────
// metaball-bloom is feasible everywhere at a real corner (its bound is
// small — a compact cluster). kinetic-type-totem was first tried at
// 'foreground' (matching Logo Sculpture's own showcase precedent) and came
// back Square/Reel-infeasible; 'background' cleared all three formats with
// no other change, checked directly via defaultTransformForFormat, same
// resolution pattern this whole Phase 4 has used repeatedly. echo-
// feedback-tunnel is centered/intentional-overlap from the start — its
// bound (1.3) was expected to need it given every other type this large
// (volumetric-light-cone, topographic-floor) already needed the same
// treatment, and it was confirmed feasible everywhere immediately.
test('Hero pack: metaball-bloom and kinetic-type-totem are feasible in every format', () => {
  ['metaball-bloom', 'kinetic-type-totem'].forEach((type) => {
    const def = getElementDefinition(type);
    ['landscape', 'square', 'reel'].forEach((formatId) => {
      const t = defaultTransformForFormat(type, formatId, def);
      assert.equal(t.feasible, true, `${type}:${formatId} should be feasible`);
      const instance = createElementInstance(type, { id: `${type}-1`, enabled: true, transform: t });
      assert.equal(placementWarningForInstance(instance, formatId, def), null);
    });
  });
});

test('Hero pack: echo-feedback-tunnel is feasible in every format (centered, intentional-overlap, like kinetic-rings)', () => {
  const def = getElementDefinition('echo-feedback-tunnel');
  ['landscape', 'square', 'reel'].forEach((formatId) => {
    const t = defaultTransformForFormat('echo-feedback-tunnel', formatId, def);
    assert.equal(t.feasible, true, `echo-feedback-tunnel:${formatId} should be feasible`);
    const instance = createElementInstance('echo-feedback-tunnel', { id: 'e1', enabled: true, transform: t });
    const warning = placementWarningForInstance(instance, formatId, def);
    assert.equal(warning?.code, 'intentional-overlap');
  });
});

// ── Intentional-overlap policy ───────────────────────────────────────────

test('kinetic-rings, glass-petal-sphere, and homepage-particle-hero declare intentionalOverlap in the catalog', () => {
  OVERLAP_TYPES.forEach((type) => {
    assert.equal(ELEMENT_CATALOG[type].intentionalOverlap, true, `${type} should declare intentionalOverlap`);
    assert.ok(ELEMENT_CATALOG[type].bounds?.localRadius > 0, `${type} should declare a real bounding radius`);
  });
});

test('placementWarningForInstance: outside-frame is NEVER downgraded to intentional-overlap, even for an intentional-overlap type', () => {
  const def = getElementDefinition('kinetic-rings');
  const farAway = createElementInstance('kinetic-rings', { id: 'kr-2', enabled: true, transform: { position: [50, 50, 0] } });
  const warning = placementWarningForInstance(farAway, 'landscape', def);
  assert.equal(warning.code, 'outside-frame');
});

test('placementWarningForInstance: near-plane-clip is NEVER downgraded to intentional-overlap, even for an intentional-overlap type', () => {
  const def = getElementDefinition('kinetic-rings');
  const tooClose = createElementInstance('kinetic-rings', { id: 'kr-3', enabled: true, transform: { position: [0, 0, 1.4] } }); // near CAMERA_Z=2.6, well within NEAR_PLANE_MARGIN once the radius is added
  const warning = placementWarningForInstance(tooClose, 'landscape', def);
  assert.equal(warning.code, 'near-plane-clip');
});

test('placementWarningForInstance: a non-intentional type overlapping the safe zone gets the plain accidental code', () => {
  // floating-media-frame (radius 0.65) — small enough to fit the frame at
  // the origin, so this isolates the safe-zone check from the frame check.
  const def = getElementDefinition('floating-media-frame');
  const atOrigin = createElementInstance('floating-media-frame', { id: 'fmf-1', enabled: true, transform: { position: [0, 0, -0.45] } });
  const warning = placementWarningForInstance(atOrigin, 'landscape', def);
  assert.equal(warning.code, 'overlaps-artwork');
});

// ── Maximum-scale regression — exit-gate item 4 ─────────────────────────

test('Maximum-scale Chrome Ribbon must warn appropriately, at any position — including a point a bare center-point check would call clear', () => {
  // Chrome Ribbon's own Landscape default is itself infeasible (see
  // KNOWN_INFEASIBLE) — this test isolates the SCALE regression specifically
  // (item 4's literal wording), independent of that: take a position that
  // reads clear as a bare POINT (proving the point-only check is blind here
  // too, not just at the default), then crank scale to the max and confirm
  // the bounds-aware check catches it.
  const def = getElementDefinition('chrome-ribbon');
  const position = [1.2, 0.1, -0.6]; // clear as a bare point (verified below)
  assert.equal(evaluatePlacement(position, 0, 'landscape'), null, 'sanity: this position should read clear as a bare point');
  const maxScale = [TRANSFORM_RANGES.scale.max, TRANSFORM_RANGES.scale.max, TRANSFORM_RANGES.scale.max];
  const instance = createElementInstance('chrome-ribbon', { id: 'cr-max', enabled: true, transform: { position, scale: maxScale } });
  const warning = placementWarningForInstance(instance, 'landscape', def);
  assert.ok(warning, 'a bare center-point check at this position would read clear — the bounds-aware, perspective-correct check must not');
  assert.ok(['outside-frame', 'overlaps-artwork', 'near-plane-clip'].includes(warning.code));
});

test('regression: cranking authored scale to the maximum turns a feasible default into a real violation the old center-point check would have missed', () => {
  CLEARING_TYPES.filter((type) => !KNOWN_INFEASIBLE.has(`${type}:landscape`)).forEach((type) => {
    const def = getElementDefinition(type);
    const { position } = defaultTransformForFormat(type, 'landscape', def);
    // A bare point at this position always reads clear — that's what "genuinely clear" means for the default.
    assert.equal(evaluatePlacement(position, 0, 'landscape'), null, `${type} default position should read clear as a bare point`);
    const maxScaleInstance = { transform: { position, scale: [TRANSFORM_RANGES.scale.max, TRANSFORM_RANGES.scale.max, TRANSFORM_RANGES.scale.max] } };
    const radius = boundingRadiusForInstance(maxScaleInstance, def);
    const warning = evaluatePlacement(position, radius, 'landscape');
    assert.ok(warning, `${type} at 2.2x scale should trip a placement warning the point check missed`);
  });
});

test('background-depth defaults sit behind the sheet; foreground never goes behind it', () => {
  const ringsPos = defaultPositionForFormat('kinetic-rings', 'landscape', getElementDefinition('kinetic-rings')); // background
  const lensPos = defaultPositionForFormat('liquid-glass-lens', 'landscape', getElementDefinition('liquid-glass-lens')); // foreground
  assert.ok(ringsPos[2] < 0);
  assert.ok(lensPos[2] >= 0);
});

// ── Duplicate offset ─────────────────────────────────────────────────────

test('offsetPosition: applies a fixed, deterministic, non-zero offset', () => {
  const base = [0.5, 0.2, -0.1];
  const offset = offsetPosition(base);
  assert.notDeepEqual(offset, base);
  assert.deepEqual(offsetPosition(base), offsetPosition(base));
  assert.deepEqual(offset, [
    Math.round((base[0] + DUPLICATE_OFFSET[0]) * 1000) / 1000,
    Math.round((base[1] + DUPLICATE_OFFSET[1]) * 1000) / 1000,
    Math.round((base[2] + DUPLICATE_OFFSET[2]) * 1000) / 1000,
  ]);
});

// ── resolveEffectiveInstance ─────────────────────────────────────────────

test('resolveEffectiveInstance: no-op (same reference) when there is no override for this format', () => {
  const instance = { transform: { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] }, formatOverrides: { landscape: {}, square: {}, reel: {} } };
  assert.equal(resolveEffectiveInstance(instance, 'landscape'), instance);
});

test('resolveEffectiveInstance: merges a per-format transform override over the base transform', () => {
  const instance = {
    transform: { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] },
    formatOverrides: { landscape: { transform: { position: [9, 9, 9] } }, square: {}, reel: {} },
  };
  const effective = resolveEffectiveInstance(instance, 'landscape');
  assert.deepEqual(effective.transform.position, [9, 9, 9]);
  assert.deepEqual(effective.transform.rotation, [0, 0, 0]);
  assert.notEqual(effective, instance);
  assert.equal(resolveEffectiveInstance(instance, 'square'), instance);
});

test('placementWarningForInstance: evaluates the EFFECTIVE (format-override-resolved) transform, not the base one', () => {
  const def = getElementDefinition('floating-media-frame'); // feasible in every format — see KNOWN_INFEASIBLE
  const clearing = defaultTransformForFormat('floating-media-frame', 'landscape', def);
  const instance = createElementInstance('floating-media-frame', {
    id: 'fmf-2', enabled: true,
    transform: { position: [0, 0, -0.45], scale: [1, 1, 1] }, // base: overlaps
  });
  instance.formatOverrides.landscape = { transform: { position: clearing.position, scale: clearing.scale } };
  assert.equal(placementWarningForInstance(instance, 'landscape', def), null);
});
