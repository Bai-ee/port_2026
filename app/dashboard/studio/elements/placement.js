// Format-aware safe placement — Phase 2 exit-gate item 1
// (docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-4K-PLAN.md). Pure logic, no
// React/three.js, so every check here is directly unit-testable.
//
// Scope, stated precisely: this plans and VALIDATES element placement for
// three named output formats (landscape/square/reel). It does NOT change the
// live canvas's actual camera FOV/aspect or the cloth's own `clothAspect`
// state — those stay exactly what they were. Format here is a placement/
// validation frame the element system reasons about; picking a format
// changes where new elements default to and what the safe-zone warnings
// check against, not what's literally on screen at this moment.
//
// CAMERA_Z / FOV_DEG / CAMERA_NEAR mirror ClothStudio.jsx's fixed
// `camera.position.set(0,0,2.6)` / `new THREE.PerspectiveCamera(40, w/h,
// 0.05, 60)` — kept in sync manually, the same mirrored-constant pattern
// already used elsewhere in this codebase (api/_lib/studio-recipe-
// variations.cjs's VP_GEOM mirrors services/studio-render/scene.mjs's
// VIEWPORTS).
//
// ── Bounds model ─────────────────────────────────────────────────────────
// Every check below takes a `radius` — a world-space bounding-SPHERE radius
// (elements/catalog.js `bounds.localRadius`, per type, scaled by the
// instance's own authored scale — see boundingRadiusForInstance) — and asks
// whether the whole sphere clears the frame/safe-zone, not just its center.
// A sphere is deliberately conservative rather than a tight mesh bound (full
// mesh collision is unnecessary per the exit-gate spec), and for every
// Phase 2 factory it's actually EXACT, not just "conservative enough": each
// factory builds its geometry with the element's own local origin at
// (0,0,0), and animate() only ever rotates around an axis through that same
// origin (root.userData.motion — see factories.js) — rotation about a fixed
// origin never changes any point's distance FROM that origin, so a bounding
// sphere computed from the (topology-maximal) static geometry already bounds
// everything the animation can ever sweep through.
//
// ── Perspective projection model (this round's correction) ─────────────────
// The prior pass compared a background/foreground object's raw WORLD-space
// X/Y/radius directly against the artwork safe zone's world-space rectangle
// — itself always defined at Z=0. That's not perspective-correct: a camera
// ray's X position is NOT constant with depth (a perspective frustum is a
// cone, not a cylinder), so two points on the SAME camera ray have DIFFERENT
// world X at different Z, but land in the exact same place on screen.
// Comparing raw world units across depths without projecting has two
// consequences: (a) a background object positioned at its own frame's edge
// (a LARGE world-space offset, since the frustum is wide out there) can
// still project back to well INSIDE the safe zone's on-screen footprint —
// exactly backwards from what the old check concluded; (b) nothing accounted
// for the sphere's own Z-extent — its near side (closer to camera) sees a
// NARROWER frustum than its center, so a check anchored at the center alone
// under-counts how much of the frame a big, close object actually occupies.
//
// The fix: project everything into NORMALIZED DEVICE COORDINATES (NDC,
// range ±1 = the frame edge) via ONE shared function, projectSphereToNDC,
// used identically by placementWarningForInstance, the defaultTransformForFormat
// search, and every test — there is exactly one definition of "does this
// project inside X" in the whole module. The whole sphere (its near-to-far
// extent along Z too, not just its center) is conservatively projected using
// the frustum at its NEAREST point to the camera (nearDepth = CAMERA_Z -
// (z + radius)) — the frustum is narrowest there, so if the sphere clears
// using that tightest slice, it clears at every other depth along itself.

import { TRANSFORM_RANGES } from './catalog.js';

export const CAMERA_Z = 2.6;
export const FOV_DEG = 40;
// Mirrors ClothStudio.jsx's `new THREE.PerspectiveCamera(40, w/h, 0.05, 60)`.
export const CAMERA_NEAR = 0.05;
// Total safety distance (world units) a bounding sphere's nearest point must
// keep from the camera. The raw GPU near-clip (CAMERA_NEAR) is where
// geometry literally vanishes; well before that, an object rushing toward
// the camera balloons to a grotesque apparent size and reads as broken long
// before it's technically clipped, so the margin is deliberately several
// times the raw clip distance.
export const NEAR_PLANE_MARGIN = 0.3;

// clothAspect ties each format to the closest-matching existing Holo Paper
// cloth-aspect world-space label (CLOTH_ASPECTS in ClothStudio.jsx) purely
// for documentation/labeling — the projection math below is self-contained
// (derived from the camera frustum, not from CLOTH_ASPECTS' literal w/h).
export const OUTPUT_FORMATS = {
  landscape: { id: 'landscape', label: 'Landscape', aspect: 16 / 9, clothAspect: 'landscape' },
  square: { id: 'square', label: 'Square', aspect: 1, clothAspect: 'square' },
  reel: { id: 'reel', label: 'Reel', aspect: 9 / 16, clothAspect: 'portrait' },
};

export function getFormat(formatId) {
  return OUTPUT_FORMATS[formatId] || OUTPUT_FORMATS.landscape;
}

const round3 = (v) => Math.round(v * 1000) / 1000;

const TAN_HALF_FOV = Math.tan((FOV_DEG / 2) * (Math.PI / 180));

// The artwork's safe region, expressed in NDC. It's a FIXED fraction of the
// frame at Z=0 — and NDC is defined by dividing by that same Z=0 frame — so
// the ratio is format- and depth-independent by construction: ±0.55 on both
// axes, in every format, always. (Deriving this from world units, the way
// the prior pass did, produced a per-format world-space rectangle that then
// had to be compared against a DIFFERENT depth's world units for anything
// not sitting at Z=0 — the exact bug this round fixes.)
const SAFE_ZONE_NDC = 0.55;

/**
 * Conservative NDC projection of a bounding sphere (`radius`, world units)
 * centered at `position` — the ONE shared projection every consumer in this
 * module uses (placementWarningForInstance, the defaultTransformForFormat
 * search, and every test):
 *
 * EXACT tangent-cone bound (not an approximation): a perspective camera
 * viewing a sphere sees a cone tangent to it; that cone's angular half-width,
 * as seen from the camera, is `asin(radius / distanceToCenter)`. Combined
 * with the angle FROM the camera's forward axis TO the sphere's center
 * (`atan2(offset, depthToCenter)`), the two tangent rays bound exactly how
 * far the sphere's silhouette reaches on that axis — converted to NDC via
 * `tan(angle) / tan(halfFOV)`, the same relationship a literal point's NDC
 * position already has to its own viewing angle. X and Y are solved as two
 * independent 2D tangent-circle problems (X uses the sphere's X-offset and
 * its depth from camera; Y uses its Y-offset and that same depth) — valid
 * because a sphere is radially symmetric, so each axis's exact bound doesn't
 * depend on the OTHER axis's offset. The result is an axis-aligned box
 * around the sphere's true (elliptical) silhouette — a standard, accepted
 * conservative simplification (never used to fail to catch clipping/overlap
 * that isn't there); what's NOT acceptable, and what an earlier version of
 * this function got wrong, is approximating within a single axis by reusing
 * one shared depth (the sphere's nearest point to the camera) for BOTH the
 * inward and outward edge — that under-states how far the inward edge
 * reaches toward screen center (the inward edge's TRUE point sits at the
 * sphere's CENTER depth, farther from the camera and hence under a WIDER
 * frustum than the shared near-depth approximation assumed), producing
 * exactly the false "clear" verdicts this replacement fixes. See this
 * function's own test file for oracle tests that independently project real
 * points on the sphere surface and confirm every one of them falls inside
 * the interval this returns.
 *
 * `nearPlaneViolation: true` means the sphere's nearest point to the camera
 * (position.z + radius) is at or inside NEAR_PLANE_MARGIN, OR the camera
 * sits inside (or touching) the sphere along an axis (no finite tangent cone
 * exists) — the ndc* fields are then NOT meaningful and every consumer MUST
 * check this flag first.
 */
function tangentConeAxisBounds(offset, depthToCenter, radius, tanFov) {
  const dist2D = Math.sqrt(offset * offset + depthToCenter * depthToCenter);
  if (dist2D <= radius) return null; // camera is inside/touching the sphere along this axis — no finite cone
  const alpha = Math.asin(radius / dist2D);
  const beta = Math.atan2(offset, depthToCenter);
  const angleMin = beta - alpha;
  const angleMax = beta + alpha;
  // A tangent ray at or past ±90° from the forward axis is at or past the
  // camera's own side-on horizon — its NDC position is unbounded (tan blows
  // up, and can flip sign past the asymptote, which would silently produce
  // an inverted min>max interval if left unhandled). Always safe/conservative
  // to fall back to an unbounded interval here — it can only ever make the
  // frame/safe-zone checks MORE likely to (correctly) flag a problem, never
  // less.
  const HORIZON = Math.PI / 2 - 1e-6;
  if (angleMin <= -HORIZON || angleMax >= HORIZON) return { min: -Infinity, max: Infinity };
  return { min: Math.tan(angleMin) / tanFov, max: Math.tan(angleMax) / tanFov };
}

export function projectSphereToNDC(position, radius, formatId) {
  const [x, y, z] = position;
  const nearestZ = z + radius;
  const nearPlaneViolation = CAMERA_Z - nearestZ <= NEAR_PLANE_MARGIN;
  const depthToCenter = CAMERA_Z - z;
  const tanX = TAN_HALF_FOV * getFormat(formatId).aspect;
  const xBounds = tangentConeAxisBounds(x, depthToCenter, radius, tanX);
  const yBounds = tangentConeAxisBounds(y, depthToCenter, radius, TAN_HALF_FOV);
  const cameraInsideSphere = !xBounds || !yBounds;
  return {
    nearDepth: CAMERA_Z - nearestZ,
    nearPlaneViolation: nearPlaneViolation || cameraInsideSphere,
    ndcMinX: xBounds ? xBounds.min : -Infinity,
    ndcMaxX: xBounds ? xBounds.max : Infinity,
    ndcMinY: yBounds ? yBounds.min : -Infinity,
    ndcMaxY: yBounds ? yBounds.max : Infinity,
  };
}

/** True when a `projectSphereToNDC` result is entirely within normalized screen bounds [-1,1] on both axes. Never true on a near-plane violation. */
export function isFramedNDC(projected) {
  if (projected.nearPlaneViolation) return false;
  return projected.ndcMinX >= -1 && projected.ndcMaxX <= 1 && projected.ndcMinY >= -1 && projected.ndcMaxY <= 1;
}

/**
 * True when a `projectSphereToNDC` result's projected interval overlaps the
 * artwork safe region on BOTH axes — the standard 2D interval-overlap test
 * (two axis-aligned intervals overlap iff neither is entirely to one side of
 * the other): `min <= otherMax && otherMin <= max`, applied per axis, ANDed
 * together (a box only overlaps another box if it overlaps on every axis).
 * Fails closed (returns `true`, "overlaps") on a near-plane violation — an
 * un-project-able sphere can't be asserted clear of anything.
 */
export function overlapsSafeZoneNDC(projected) {
  if (projected.nearPlaneViolation) return true;
  const overlapsX = projected.ndcMaxX >= -SAFE_ZONE_NDC && projected.ndcMinX <= SAFE_ZONE_NDC;
  const overlapsY = projected.ndcMaxY >= -SAFE_ZONE_NDC && projected.ndcMinY <= SAFE_ZONE_NDC;
  return overlapsX && overlapsY;
}

/**
 * One placement check for a bounding sphere (`radius`) at `position` in
 * `formatId`, funneled entirely through projectSphereToNDC. Precedence:
 * near-plane clip first (nothing else is meaningful once the sphere is
 * basically in the camera), then outside-frame (a fully off-frame element
 * isn't meaningfully "overlapping" anything visible either), then
 * overlaps-artwork. Type-agnostic — does not know about intentional-overlap
 * policy; see placementWarningForInstance for that.
 */
export function evaluatePlacement(position, radius, formatId) {
  const projected = projectSphereToNDC(position, radius, formatId);
  if (projected.nearPlaneViolation) {
    return { code: 'near-plane-clip', message: 'Too close to the camera for this placement check — clips the near plane' };
  }
  if (!isFramedNDC(projected)) return { code: 'outside-frame', message: 'Outside the output frame for this format' };
  if (overlapsSafeZoneNDC(projected)) return { code: 'overlaps-artwork', message: 'Intersects the protected artwork region' };
  return null;
}

// Depth -> Z-offset. A documented, deterministic mapping (not render order —
// real Z separation already gives correct depth-tested draw order for these
// simple, non-intersecting shapes): foreground sits closer to the camera,
// background sits behind the sheet, hero sits at the sheet's own depth
// (only glass-petal-sphere uses 'hero', and glass is untouched by this
// module). This is a DEFAULT-time convenience — once an instance exists,
// its actual rendered Z always comes from transform.position[2], which the
// user can freely edit; depth is not re-enforced afterward.
export const DEPTH_Z_OFFSET = { foreground: 0.35, hero: 0, background: -0.45 };

// How far the default-placement search is allowed to push a background type
// away from the camera (more negative Z) to buy extra frame headroom in
// narrow formats before it gives up on that depth. Capped at
// TRANSFORM_RANGES.position.min itself — Z is stored in the exact same
// `transform.position` field X/Y are, and validators.js clamps it to that
// same range, so anything past it would silently be clamped back on the
// next normalize, invalidating everything the search computed against it (a
// real bug caught during this round's implementation: an earlier attempt at
// a deeper cap got silently clamped from -2.4 back to -1.5, which changed
// the frustum-at-nearDepth basis every subsequent check used, producing a
// result the search itself had never actually verified).
const MAX_BACKGROUND_DEPTH = TRANSFORM_RANGES.position.min;
const DEPTH_SEARCH_STEP = 0.01;
const SCALE_SEARCH_STEP = 0.01;

// Per-type placement anchor — which corner of the frame the default-
// placement search pushes the element toward (xSign/ySign), and which named
// depth bucket it starts from. {xSign:0, ySign:0} means "centered, no
// safe-zone avoidance attempted" — used for the one deliberate exception.
const ELEMENT_ANCHORS = {
  'kinetic-rings': { xSign: 0, ySign: 0, depth: 'background' },
  'chrome-ribbon': { xSign: -1, ySign: 1, depth: 'background' },
  'translucent-monoliths': { xSign: 1, ySign: -1, depth: 'background' },
  'liquid-glass-lens': { xSign: 1, ySign: 1, depth: 'foreground' },
  'floating-media-frame': { xSign: -1, ySign: -1, depth: 'background' },
  'homepage-particle-hero': { xSign: 0, ySign: 0, depth: 'background' }, // wraps the whole scene, same centered/intentional-overlap design as kinetic-rings
  'glb-import': { xSign: -1, ySign: 1, depth: 'foreground' }, // an uploaded showcase object — corner-anchored, nearer camera like liquid-glass-lens (see below: 'hero'/background-only depths gave this radius materially worse clearance odds)
  'prismatic-slab': { xSign: 1, ySign: 1, depth: 'foreground' },
  'iridescent-film': { xSign: -1, ySign: -1, depth: 'background' },
  'gel-panels': { xSign: 0, ySign: 0, depth: 'background' }, // intentionally overlaps the artwork by design (see catalog.js) — same centered treatment as kinetic-rings
  'orb-constellation': { xSign: 1, ySign: -1, depth: 'background' },
  // 'foreground' was tried first for both of these (matching liquid-glass-
  // lens/prismatic-slab's own foreground-showcase precedent) and left
  // Square/Reel genuinely infeasible (empirically checked via
  // defaultTransformForFormat directly, same discipline as every other
  // type's calibration) — their bounds are simply too large to clear both
  // frame and safe zone that close to the camera in a narrow aspect.
  // 'background' clears all three formats at a reasonable scale with no
  // other change, so it was kept over accepting a Landscape-only constraint.
  'inflatable-forms': { xSign: -1, ySign: 1, depth: 'background' },
  'mirror-fragments': { xSign: 1, ySign: -1, depth: 'foreground' },
  'logo-sculpture': { xSign: -1, ySign: -1, depth: 'background' },
  // light-tubes and cloth-banners were both tried at the OTHER depth
  // (foreground) too — checked directly via defaultTransformForFormat, not
  // assumed — and neither cleared any more formats than shown below (in
  // cloth-banners' case, foreground actually cleared FEWER). Both stay
  // genuinely Landscape-only at their calibrated bounds, the same honest
  // constraint the Optical pack's prismatic-slab/iridescent-film already
  // established as acceptable, not a mistake to keep chasing.
  'light-tubes': { xSign: 1, ySign: 1, depth: 'background' },
  // wireframe-sculpture WAS tried at 'foreground' first (matching Logo
  // Sculpture's own sculptural/showcase precedent) and came back
  // Landscape-only; 'background' clears all three formats with no other
  // change, so it was kept — same resolution pattern as inflatable-forms/
  // logo-sculpture in the prior pack.
  'wireframe-sculpture': { xSign: -1, ySign: -1, depth: 'background' },
  'portal-plane': { xSign: 0, ySign: 0, depth: 'background' }, // a "portal behind the hero" reads as centered by design, same intentional-overlap treatment as kinetic-rings
  'cloth-banners': { xSign: 1, ySign: -1, depth: 'background' },
  // particle-ribbon is genuinely Landscape-only at its calibrated bound —
  // same honest-constraint precedent as light-tubes/cloth-banners above.
  'particle-ribbon': { xSign: -1, ySign: 1, depth: 'background' },
  'caustic-water-light': { xSign: 1, ySign: 1, depth: 'background' },
  // Both of these were first tried at a real corner (checked directly via
  // defaultTransformForFormat, not assumed) and came back genuinely
  // infeasible in EVERY format at their large calibrated bounds — centered/
  // intentional-overlap (catalog.js) cleared all three with no other
  // change, same treatment as Kinetic Rings/Homepage Particle Hero.
  'volumetric-light-cone': { xSign: 0, ySign: 0, depth: 'background' },
  'topographic-floor': { xSign: 0, ySign: 0, depth: 'background' },
  // 'foreground' was tried first and, once the bound was corrected to its
  // true worst case (0.55, up from an under-measured 0.26 — see
  // catalog.js), came back Square/Reel-infeasible; 'background' cleared
  // all three formats with no other change, checked directly via
  // defaultTransformForFormat, same resolution pattern this whole Phase 4
  // has used repeatedly.
  'metaball-bloom': { xSign: 1, ySign: 1, depth: 'background' },
  // 'foreground' was tried first (matching Logo Sculpture's own showcase
  // precedent) and came back Square/Reel-infeasible; 'background' cleared
  // all three formats with no other change, checked directly via
  // defaultTransformForFormat, same resolution pattern as this pack's own
  // prior rounds (inflatable-forms/logo-sculpture/wireframe-sculpture).
  'kinetic-type-totem': { xSign: -1, ySign: 1, depth: 'background' },
  'echo-feedback-tunnel': { xSign: 0, ySign: 0, depth: 'background' }, // a receding tunnel reads as centered by design, same intentional-overlap treatment as kinetic-rings
};

export function anchorForType(type) {
  return ELEMENT_ANCHORS[type] || null;
}

/** Largest axis-scale component — the one that actually inflates the bounding sphere. */
function maxAxisScale(scale) {
  const [sx, sy, sz] = Array.isArray(scale) ? scale : [1, 1, 1];
  return Math.max(sx, sy, sz);
}

/**
 * World-space bounding-sphere radius for `instance`: its type's catalog-
 * declared LOCAL radius (topology-maximum, scale=1 — elements/catalog.js
 * `bounds.localRadius`) times its own authored scale's largest axis. Types
 * with no declared bounds fall back to 0 — a point, matching pre-bounds-
 * model behavior rather than silently under- or over-warning for an
 * undeclared type.
 */
export function boundingRadiusForInstance(instance, definition) {
  const local = definition?.bounds?.localRadius;
  if (!local) return 0;
  return local * maxAxisScale(instance?.transform?.scale);
}

// NDC-space slack demanded of the candidate's frame containment (not of
// evaluatePlacement itself) so a candidate the search accepts survives
// storage rounding (position/scale round to 3dp) without drifting back
// outside the frame. The final acceptance check still runs the exact,
// unmargined evaluatePlacement — this only affects where a candidate is
// PLACED, not what counts as clearing.
const CANDIDATE_NDC_MARGIN = 0.01;

/**
 * Largest magnitude `m` in [0, positionMax] such that a sphere of radius `r`
 * at depth `z`, offset `m` along ONE axis (the other axis held at exactly 0),
 * stays framed — found by bisecting against `isFramedNDC`/
 * `projectSphereToNDC` directly (the SAME functions evaluatePlacement itself
 * calls), never a separate closed-form formula (an earlier version computed
 * the candidate corner from its own inverted-projection arithmetic, which
 * quietly drifted out of sync with a later fix to projectSphereToNDC's
 * actual math — caught by external review; bisecting against the real
 * functions makes that whole class of bug structurally impossible). Returns
 * `null` if `r` alone doesn't fit the frame even at the origin.
 *
 * Holding the OTHER axis at exactly 0 while maximizing this one is
 * deliberate, not a simplification: `projectSphereToNDC` solves X and Y as
 * two independent tangent-cone problems (a direct consequence of a sphere's
 * radial symmetry — see its own comment), so one axis's frame bound never
 * depends on the other axis's offset at all. Coupling both axes to a single
 * shared push fraction (an earlier version's bug, caught by external review)
 * throws away real reach on whichever axis happens to have more headroom:
 * in a non-square format the tighter axis stops the shared fraction early,
 * capping the looser axis below its own true maximum — exactly the false
 * "cannot genuinely clear" the review found (Chrome Ribbon/Landscape had a
 * real solution at `x=1.5, y=0` that a diagonal-only search could never
 * reach, since y=0 pinned the shared fraction to whatever y needed, and y's
 * bound was tighter than x's).
 */
export function maxFeasibleAxisOffset(axis, z, r, formatId, positionMax) {
  const framedAt = (m) => {
    const position = axis === 'x' ? [m, 0, z] : [0, m, z];
    return isFramedNDC(projectSphereToNDC(position, r, formatId));
  };
  if (!framedAt(0)) return null;
  let lo = 0;
  let hi = positionMax;
  if (!framedAt(hi)) {
    for (let i = 0; i < 40; i += 1) {
      const mid = (lo + hi) / 2;
      if (framedAt(mid)) lo = mid; else hi = mid;
    }
  } else {
    lo = hi;
  }
  return Math.max(0, lo * (1 - CANDIDATE_NDC_MARGIN));
}

/**
 * Candidate position for a bounding sphere of world-radius `r` at depth `z`,
 * pushed toward the frame corner given by `xSign`/`ySign` — X and Y are each
 * maximized INDEPENDENTLY via `maxFeasibleAxisOffset` (own bisection, other
 * axis pinned to 0), then combined into one corner. This finds every
 * solution a coupled shared-fraction search could plus any solution where
 * the axes' true limits differ (the common case in non-square formats) —
 * see `maxFeasibleAxisOffset`'s comment for why independent maximization is
 * not just an optimization but the only way some feasible corners are ever
 * reached at all. Returns `null` if `r` alone doesn't fit the frame even at
 * the origin (t=0 on both axes) — no candidate exists at this `z`.
 */
export function cornerCandidate(r, z, xSign, ySign, formatId, positionMax) {
  const maxX = maxFeasibleAxisOffset('x', z, r, formatId, positionMax);
  const maxY = maxFeasibleAxisOffset('y', z, r, formatId, positionMax);
  if (maxX === null || maxY === null) return null;
  return [round3(xSign * maxX), round3(ySign * maxY), round3(z)];
}

/**
 * Deliberate per-format default TRANSFORM (position + uniform scale) for
 * `type` in `formatId` — never [0,0,0]/default-scale-without-thought for a
 * known clearing type. A deterministic CANDIDATE SEARCH (not a continuous
 * analytical solver): scans scale from 1 down to TRANSFORM_RANGES.scale.min
 * in fixed steps (preferring full size), and for each scale, scans depth
 * from the type's natural anchor outward to its cap in fixed steps
 * (preferring the shallowest push); the first candidate whose position —
 * placed at its preferred frame corner via cornerCandidate — passes
 * evaluatePlacement (the EXACT SAME validator placementWarningForInstance
 * and every test use) is returned immediately. For the one deliberate
 * exception (`xSign===0 && ySign===0`, e.g. kinetic-rings): stays centered
 * and accepts an 'overlaps-artwork' verdict as success (that's the intended
 * design), but still requires real frame/near-plane clearance.
 *
 * Per the exit-gate correction: if NO (depth, scale) combination in the
 * entire search range passes, this does NOT force scale up to the minimum
 * and claim success — `feasible` is `false` and `constraint` explains why,
 * carrying the FIRST candidate tried (scale 1, natural depth — the most
 * "as-designed" attempt) as a best-effort position/scale to render, not a
 * verified-clean one.
 *
 * Returns `{ position:[x,y,z], scale:[s,s,s], feasible, constraint }`.
 */
export function defaultTransformForFormat(type, formatId, catalogDef) {
  const anchor = anchorForType(type);
  if (!anchor) return { position: [0, 0, 0], scale: [1, 1, 1], feasible: true, constraint: null };
  const localRadius = catalogDef?.bounds?.localRadius || 0;
  const positionMax = TRANSFORM_RANGES.position.max;
  const scaleMin = TRANSFORM_RANGES.scale.min;
  const scaleMax = TRANSFORM_RANGES.scale.max;
  const centered = anchor.xSign === 0 && anchor.ySign === 0;
  const zStart = DEPTH_Z_OFFSET[anchor.depth] ?? 0;
  const zFloor = anchor.depth === 'foreground' ? 0 : MAX_BACKGROUND_DEPTH;
  const zDir = zFloor < zStart ? -1 : 1;
  const zSteps = Math.max(0, Math.round(Math.abs(zFloor - zStart) / DEPTH_SEARCH_STEP));
  const scaleSteps = Math.max(0, Math.round((1 - scaleMin) / SCALE_SEARCH_STEP));

  let fallback = null;
  for (let si = 0; si <= scaleSteps; si += 1) {
    const scale = round3(1 - si * SCALE_SEARCH_STEP);
    const r = localRadius * scale;
    for (let zi = 0; zi <= zSteps; zi += 1) {
      const z = round3(zStart + zDir * zi * DEPTH_SEARCH_STEP);
      const position = centered ? [0, 0, z] : cornerCandidate(r, z, anchor.xSign, anchor.ySign, formatId, positionMax);
      if (!position) continue; // near-plane violation at this (z, r) — no valid corner, try deeper z
      const warning = evaluatePlacement(position, r, formatId);
      const ok = !warning || (centered && warning.code === 'overlaps-artwork');
      if (!fallback) fallback = { position, scale: [scale, scale, scale] };
      if (ok) return { position, scale: [scale, scale, scale], feasible: true, constraint: null };
    }
  }
  const constraint = `${type} cannot genuinely clear both the frame and the artwork safe zone in ${formatId} within the allowed scale range [${scaleMin}, ${scaleMax}] and the ${anchor.depth} depth search range — no (depth, scale) combination in the search passed.`;
  return { ...(fallback || { position: [0, 0, round3(zStart)], scale: [scaleMin, scaleMin, scaleMin] }), feasible: false, constraint };
}

/** Position-only convenience wrapper around defaultTransformForFormat, for callers that don't need scale/feasibility. */
export function defaultPositionForFormat(type, formatId, catalogDef) {
  return defaultTransformForFormat(type, formatId, catalogDef).position;
}

// A small, fixed, deterministic offset applied to a duplicate's position so
// it doesn't sit exactly on top of its source (which would read as "my
// click did nothing"). Not scaled/escalated per existing-duplicate-count —
// kept simple and predictable; if it still overlaps the source after a
// user drags things around, that's now the user's own arrangement, not an
// unexplained default.
export const DUPLICATE_OFFSET = [0.15, -0.1, 0];

export function offsetPosition(position, offset = DUPLICATE_OFFSET) {
  return [round3(position[0] + offset[0]), round3(position[1] + offset[1]), round3(position[2] + offset[2])];
}

/**
 * Merge `instance.formatOverrides[formatId]` (validated per-instance,
 * per-format transform override — currently only ever populated
 * programmatically, e.g. by future authoring UI; every instance starts with
 * empty overrides) over `instance.transform`, producing the EFFECTIVE
 * instance a factory should actually render. Called once per
 * applyInstance — see ClothStudio.jsx's live-object sync effect. No-op
 * (returns `instance` unchanged, same reference) when there's nothing to
 * merge, so it's cheap to call unconditionally.
 */
export function resolveEffectiveInstance(instance, formatId) {
  const override = instance?.formatOverrides?.[formatId];
  if (!override || !override.transform) return instance;
  const t = override.transform;
  if (!t.position && !t.rotation && !t.scale) return instance;
  return {
    ...instance,
    transform: {
      position: t.position || instance.transform.position,
      rotation: t.rotation || instance.transform.rotation,
      scale: t.scale || instance.transform.scale,
    },
  };
}

/**
 * The full, type-aware placement check for a live instance: resolves its
 * effective (format-override-applied) transform, computes its actual
 * bounding-sphere radius from `definition.bounds` + its own authored scale,
 * and evaluates frame/safe-zone/near-plane clearance against that sphere via
 * evaluatePlacement — the SAME projection every other consumer in this
 * module uses. When the only violation is a safe-zone overlap AND the type
 * declares `intentionalOverlap: true` (elements/catalog.js — today:
 * kinetic-rings, glass-petal-sphere), the warning code is downgraded to
 * `'intentional-overlap'` so the UI can render it as "by design" rather than
 * something the user needs to fix. Frame-edge and near-plane violations are
 * NEVER downgraded — nothing is ever supposed to be cropped out of the
 * export or balloon into the lens, intentional-overlap type or not.
 */
export function placementWarningForInstance(instance, formatId, definition) {
  const effective = resolveEffectiveInstance(instance, formatId);
  const radius = boundingRadiusForInstance(effective, definition);
  const warning = evaluatePlacement(effective.transform.position, radius, formatId);
  if (!warning) return null;
  if (warning.code === 'overlaps-artwork' && definition?.intentionalOverlap) {
    return { code: 'intentional-overlap', message: 'Intentionally overlaps the artwork region — by design' };
  }
  return warning;
}
