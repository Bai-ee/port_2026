// Hanging T-shirt — pure garment silhouette + Verlet cloth-sim module. No
// THREE.js import at this layer (plain typed arrays / index lists only), so
// every function here is directly unit-testable in plain Node, matching the
// house convention already used by elements/particle-math.js and this
// directory's other pure-logic modules. elements/factories.js turns the
// output of `buildTshirtMesh` into real THREE.BufferGeometry/materials, and
// steps the sim it returns every frame via `advanceSim`.
//
// ── Silhouette (master task, "P1 visual correction" round) ──────────────
// A T-shirt outline authored directly in normalized 0..1 PATTERN space
// (x: left→right across the full body span, y: hem→shoulder). This pattern
// coordinate IS the UV coordinate — no separate unwrap step, and no
// per-instance shape parameters (fabric/wind/logo are the only user-facing
// controls; the silhouette itself is fixed so every instance shares one
// deterministic topology per quality tier).
//
// CORRECTION (this round): two earlier attempts both built a UNIFORM
// rectangular grid and then tested each grid CELL against an inside/outside
// silhouette function (a plain rectangle+trapezoids the first time, a
// smoothly-blended union of regions the second) — both approaches produce a
// perimeter that's only as smooth as the grid is fine, because the boundary
// is discovered by clipping axis-aligned cells against a curve rather than
// being placed ON the curve. Confirmed live (screenshot) even after a ~2.3x
// resolution increase plus a boundary-smoothing pass: the neckline still
// rendered as a visible triangle and the shoulder/sleeve edge as a
// staircase, and a resolution high enough to fix that by brute force alone
// would have cost ~7x more — nearly the entire scene's whole performance
// budget for one element.
//
// This version is genuinely BOUNDARY-CONFORMING instead: every row's left/
// right edge (torso) or cross-section edge (sleeve) is computed DIRECTLY
// from a smooth closed-form curve (torsoHalfWidth/neckHalfExtent/
// sleeveHalfWidth below), not discovered by testing candidate grid points —
// so the perimeter is smooth BY CONSTRUCTION at any resolution, not just
// "smoother at higher resolution." The torso and each sleeve are built as
// separate structured patches (own row/col grid each), stitched together
// with short "attachment" constraints (see buildAttachmentPairs) rather
// than literally sharing vertices — geometrically adjacent, physically tied
// together, independently generated. This keeps every patch a plain
// row-major uniform grid (easy, "roughly uniform" triangulation + the same
// structural/shear/bend constraint pattern as before) while eliminating
// cell-clipping entirely.
export const PATTERN = {
  hemY: 0.0,
  underarmY: 0.58,           // torso height where the sleeves attach (armpit line)
  shoulderY: 0.80,           // top of the shoulder seam, at the neck base
  hemHalfWidth: 0.185,
  chestHalfWidth: 0.215,     // torso is widest at the underarm — natural taper down to a narrower hem
  shoulderHalfWidth: 0.145,  // body half-width at the very top (narrower than chest — shoulder slope)
  sleeveAngleDeg: 18,        // downward tilt of the sleeve's own long axis from horizontal
  sleeveLength: 0.26,
  sleeveShoulderHalfWidth: 0.095,
  sleeveCuffHalfWidth: 0.062,
  neckHalfWidth: 0.105,
  neckDepth: 0.095,
  collarBandWidth: 0.16,     // fraction of the neck ellipse's own radius, NOT pattern units — see insideCollarBand
  collarBumpZ: 0.35,         // fraction of garment thickness the collar band is pushed toward the viewer, for visual definition
  hemCurveAmount: 0.014,     // subtle bow so the hem isn't a perfectly straight line
};

function smoothstep01(t) {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** Torso half-width at pattern-space height `y` — smoothly blended hem->chest->shoulder (see module header). Analytic and continuous, so a torso row's left/right edge is exact at any resolution. */
function torsoHalfWidth(y, p) {
  if (y <= p.underarmY) {
    const t = smoothstep01((y - p.hemY) / Math.max(1e-6, p.underarmY - p.hemY));
    return p.hemHalfWidth + (p.chestHalfWidth - p.hemHalfWidth) * t;
  }
  const t = smoothstep01((y - p.underarmY) / Math.max(1e-6, p.shoulderY - p.underarmY));
  return p.chestHalfWidth + (p.shoulderHalfWidth - p.chestHalfWidth) * t;
}

/** Half-extent of the neckline cutout at height `y` (0 outside the neck's own Y range) — the analytic ellipse boundary, evaluated exactly per row rather than tested per grid cell. */
function neckHalfExtent(y, p) {
  const dy = (p.shoulderY - y) / p.neckDepth;
  if (dy < -1 || dy > 1) return 0;
  return p.neckHalfWidth * Math.sqrt(Math.max(0, 1 - dy * dy));
}

/** Elliptical-radius (not boolean) form of the neckline test — `r<=1` is the notch interior itself; `insideCollarBand` uses `r` just outside 1 to trace a thin ring around it. */
function neckEllipseRadius(x, y, p) {
  const dx = (x - 0.5) / p.neckHalfWidth;
  const dy = (p.shoulderY - y) / p.neckDepth;
  return Math.sqrt(dx * dx + dy * dy);
}

/** True for a thin ring of pattern-space just outside the neckline notch (a restrained raised collar band). */
export function insideCollarBand(x, y, p = PATTERN) {
  if (y < p.shoulderY - p.neckDepth * 1.6) return false;
  const r = neckEllipseRadius(x, y, p);
  return r > 1 && r <= 1 + p.collarBandWidth;
}

/** Sign/direction/attach-point basis for the given sleeve side — angled down and out from the shoulder point, matching the module header. */
function sleeveFrame(p, side) {
  const sign = side === 'left' ? -1 : 1;
  const rad = (p.sleeveAngleDeg * Math.PI) / 180;
  const dirX = sign * Math.cos(rad);
  const dirY = -Math.sin(rad);
  const perpX = sign * dirY;
  const perpY = -sign * dirX;
  return { sign, dirX, dirY, perpX, perpY, attachX: 0.5 + sign * p.shoulderHalfWidth, attachY: p.shoulderY };
}

/** Sleeve half-width at `along` (0=shoulder root, sleeveLength=cuff) — smoothstep taper, analytic like torsoHalfWidth. */
function sleeveHalfWidth(along, p) {
  const t = smoothstep01(Math.min(1, Math.max(0, along)) / p.sleeveLength);
  return p.sleeveShoulderHalfWidth + (p.sleeveCuffHalfWidth - p.sleeveShoulderHalfWidth) * t;
}

/** Converts a sleeve-local (along,across) coordinate to real pattern-space (x,y). */
function sleevePoint(along, across, p, side) {
  const f = sleeveFrame(p, side);
  return { x: f.attachX + along * f.dirX + across * f.perpX, y: f.attachY + along * f.dirY + across * f.perpY };
}

/** The garment's own rightmost pattern-space X reach (right sleeve's outer cuff corner) — used by factories.js to size the hanger bar from the REAL silhouette instead of a hardcoded magic number. */
export function patternMaxX(p = PATTERN) {
  const halfW = sleeveHalfWidth(p.sleeveLength, p);
  const a = sleevePoint(p.sleeveLength, halfW, p, 'right');
  const b = sleevePoint(p.sleeveLength, -halfW, p, 'right');
  return Math.max(a.x, b.x);
}

/**
 * Builds the torso as a plain row-major `cols`×`rows` grid spanning EXACTLY
 * hemY..shoulderY (no wasted rows above/below the silhouette, unlike the
 * old full-[0,1]-box-plus-masking approach) — every row's left/right edge
 * is placed AT torsoHalfWidth(y) exactly, and any column that would fall
 * inside the neckline cutout is clamped to the cutout's own analytic edge
 * instead of being culled. This means every cell has a valid vertex (some
 * near the neckline are near-coincident, which is fine — see
 * triAreaPattern's degenerate-triangle filter in buildTshirtMesh), so no
 * -1/"outside" sentinel or masking step is needed at all: the grid IS the
 * boundary-conforming shape by construction. The hem row additionally gets
 * a shallow per-column Y bow (hemCurveAmount) so the bottom edge itself
 * reads as a gentle curve, not a straight cut.
 */
// Reserves this fraction of the torso's row BUDGET for the neckline's own
// (narrow) Y band instead of spacing rows uniformly across the whole
// hem->shoulder height. Needed because the neckline is a small ellipse arc
// within a tall garment — uniform row spacing put only ~5 rows across it at
// a typical resolution, which reads as a V (a few points on an arc,
// connected by straight lines, look like converging wedges rather than a
// curve) even though the underlying math is a genuine ellipse. This costs
// nothing extra (same total row count) — it just reallocates WHERE those
// rows go, concentrating density where the curve actually is.
const NECK_ROW_FRACTION = 0.4;

/** Maps a uniform row parameter (0=hem, 1=shoulder) to pattern-space Y, concentrating NECK_ROW_FRACTION of the row budget into the neckline's own Y band (see above) instead of spacing rows uniformly. */
function torsoRowY(row, rows, p) {
  const neckBandStart = p.shoulderY - p.neckDepth * 1.3;
  const t = rows > 1 ? row / (rows - 1) : 0;
  const splitT = 1 - NECK_ROW_FRACTION;
  if (t <= splitT) {
    return p.hemY + (neckBandStart - p.hemY) * (t / splitT);
  }
  return neckBandStart + (p.shoulderY - neckBandStart) * ((t - splitT) / (1 - splitT));
}

function buildTorsoGrid(cols, rows, p) {
  const points = new Array(cols * rows);
  const boundary = new Array(cols * rows).fill(false);
  for (let row = 0; row < rows; row += 1) {
    const y = torsoRowY(row, rows, p);
    const halfW = torsoHalfWidth(y, p);
    const xL = 0.5 - halfW;
    const xR = 0.5 + halfW;
    const neckHalf = neckHalfExtent(y, p);
    const neckL = 0.5 - neckHalf;
    const neckR = 0.5 + neckHalf;
    for (let col = 0; col < cols; col += 1) {
      let x = xL + (xR - xL) * (col / (cols - 1));
      let onNeck = false;
      if (neckHalf > 0 && x > neckL && x < neckR) {
        x = x < 0.5 ? neckL : neckR;
        onNeck = true;
      }
      let yy = y;
      if (row === 0) {
        yy += p.hemCurveAmount * Math.cos(Math.min(1, Math.abs(x - 0.5) / Math.max(halfW, 1e-3)) * (Math.PI / 2));
      }
      const idx = row * cols + col;
      points[idx] = { x, y: yy };
      // Boundary: the hem row, the top (shoulder) row, either side edge of
      // every row (side seam through to the sleeve attachment region — a
      // real armscye seam, not a shortcut), or a column clamped onto the
      // neckline curve.
      boundary[idx] = row === 0 || row === rows - 1 || col === 0 || col === cols - 1 || onNeck;
    }
  }
  return { points, boundary, cols, rows };
}

/**
 * Builds one sleeve as its own plain row-major `cols`×`rows` grid — row 0
 * sits at the shoulder root (along≈0), row `rows-1` at the cuff; every
 * column's `across` offset is placed at exactly ±sleeveHalfWidth(along), so
 * both the top and bottom sleeve edges (and the taper between them) are
 * exact analytic curves, never grid-clipped. The root row is kept
 * deliberately independent of the torso grid's own vertices (no shared
 * indices) — buildAttachmentPairs below ties them together with short,
 * stiff constraints instead, which is simpler to get right than exact
 * index-matched vertex sharing across two differently-parametrized grids
 * and still reads as one continuous seam once simulated.
 */
function buildSleeveGrid(cols, rows, side, p) {
  const points = new Array(cols * rows);
  const boundary = new Array(cols * rows).fill(false);
  for (let row = 0; row < rows; row += 1) {
    const along = p.sleeveLength * (row / (rows - 1));
    const halfW = sleeveHalfWidth(along, p);
    for (let col = 0; col < cols; col += 1) {
      const across = -halfW + (2 * halfW) * (col / (cols - 1));
      const idx = row * cols + col;
      points[idx] = sleevePoint(along, across, p, side);
      boundary[idx] = row === 0 || row === rows - 1 || col === 0 || col === cols - 1;
    }
  }
  return { points, boundary, cols, rows };
}

/** Signed area (x2) of a pattern-space triangle — used to skip near-zero-area triangles that can occur where torso columns collapse onto a clamped neckline edge. */
function triAreaPattern(a, b, c) {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
}
const DEGENERATE_AREA_EPS = 1e-9;

// A vertex deliberately clamped onto the neckline's own ellipse boundary
// (buildTorsoGrid) sits at u^2+v^2 == 1 in exact math, but the Float32Array
// round-trip through `uvs` (and ordinary float64 accumulation error through
// the u0/v0/du/dv chain below) can land it at 0.999999-something instead —
// genuinely ON the boundary, not inside the opening. A strict `<1` compare
// then flags legitimate boundary vertices as "crossing." This margin
// requires being MEANINGFULLY inside (not just inside by float noise)
// before a point/segment counts as a real intrusion into the hole.
const NECK_HOLE_EPS = 1e-4;

/** True if point (x,y) is (meaningfully, not just by floating-point noise) inside the neckline ellipse — same math as neckHalfExtent/insideCollarBand's own ellipse test, exposed standalone for direct geometric edge/triangle checks below. */
function pointInNeckHole(x, y, p) {
  if (y < p.shoulderY - p.neckDepth * 1.3) return false;
  const dx = (x - 0.5) / p.neckHalfWidth;
  const dy = (p.shoulderY - y) / p.neckDepth;
  return dx * dx + dy * dy < 1 - NECK_HOLE_EPS;
}

/**
 * True if the straight segment a->b passes through the neckline opening —
 * a direct geometric test (does any point ALONG the segment fall inside
 * the ellipse), not a per-vertex tag. `p` is required (unused/undefined for
 * sleeve patches, which pass `null` and always get `false` back — sleeves
 * have no neckline).
 *
 * CORRECTION (Codex review, P1, second pass): an earlier version of this
 * check used a precomputed per-vertex `side` tag (-1/0/+1, gated on whether
 * THAT vertex's own row had a nonzero neck extent) and blocked a
 * connection only when both endpoints had defined, OPPOSITE tags. That
 * missed the single TRANSITION row where the ellipse is just beginning
 * (row below: no cutout yet, side=0 for everything in it; row above: a
 * genuine cutout) — a triangle connecting an untagged (side=0) point on
 * the row below to a tagged point on the row above was never blocked, even
 * though the triangle's own interior can still dip into the ellipse for
 * the sliver of Y between the two rows where the true (continuous) curve
 * has already started narrowing.
 *
 * CORRECTION (Codex review, P1, third pass): the immediate fix for the
 * above (sampling a handful of interior points along the segment) was
 * ITSELF resolution-dependent — a live regression test using a finer
 * sample spacing than this function's own found 2 segments this function's
 * coarser sampling missed. Discrete sampling can never be fully robust (a
 * thin enough sliver of the ellipse can always fall between sample
 * points). Replaced with an EXACT closed-form test: minimize the ellipse
 * equation's value along the segment (a 1D quadratic in the segment
 * parameter t, minimized analytically, clamped to t in [0,1] since only
 * the segment itself — not the infinite line through it — matters), and
 * check whether that true minimum is inside the ellipse. Correct at any
 * resolution, not just the ones exercised by tests.
 */
export function segmentCrossesNeckHole(a, b, p) {
  if (!p) return false;
  const rx = p.neckHalfWidth, ry = p.neckDepth;
  // Normalized coordinates (ellipse -> unit circle): u = (x-0.5)/rx, v = (shoulderY-y)/ry.
  const u0 = (a.x - 0.5) / rx, v0 = (p.shoulderY - a.y) / ry;
  const du = (b.x - a.x) / rx, dv = (a.y - b.y) / ry; // note: v = (shoulderY - y), so dv flips sign vs. dy
  const denom = du * du + dv * dv;
  let t = denom > 1e-12 ? -(u0 * du + v0 * dv) / denom : 0;
  t = Math.min(1, Math.max(0, t));
  const u = u0 + t * du, v = v0 + t * dv;
  if (u * u + v * v >= 1 - NECK_HOLE_EPS) return false; // closest approach on the segment is still outside/on the ellipse (within float tolerance — see NECK_HOLE_EPS)
  // The ellipse's own Y-band gate (same margin as pointInNeckHole/neckHalfExtent) — the algebraic test above is for an infinite elliptical CYLINDER in y; still need to confirm the closest point's actual Y falls within the neckline's real vertical extent.
  const y = a.y + t * (b.y - a.y);
  return y >= p.shoulderY - p.neckDepth * 1.3;
}

/** True if any point ALONG the three edges, or the centroid, of triangle (a,b,c) falls inside the neckline opening. */
function triangleCrossesNeckHole(a, b, c, p) {
  if (!p) return false;
  if (pointInNeckHole((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, p)) return true;
  return segmentCrossesNeckHole(a, b, p) || segmentCrossesNeckHole(b, c, p) || segmentCrossesNeckHole(a, c, p);
}

/**
 * Triangulates + builds structural/shear/bend constraints for one row-major
 * grid patch (torso or a sleeve) — same quad-to-2-triangle pattern the
 * original single-grid version used, generalized to any `cols`×`rows`
 * patch and offset into the shared global index space. Skips triangles
 * whose pattern-space area is ~0 (only occurs at the torso's neckline
 * clamp, where several columns can collapse onto the same boundary point)
 * AND any connection/triangle that would cross the neckline opening
 * (`pattern`, `null` for sleeve patches which have no neckline) —
 * CORRECTION (Codex review, P1): the degenerate-area filter alone did not
 * catch this; a triangle spanning from a left-of-neck vertex to a
 * right-of-neck vertex has genuine non-zero area (it's a real span across
 * the hole), not a collapsed point.
 */
function addPatchTopology({ points, cols, rows }, offset, flipWinding, indices, structural, shear, bend, pattern) {
  const idx = (row, col) => offset + row * cols + col;
  const at = (row, col) => points[row * cols + col];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (col + 1 < cols && !segmentCrossesNeckHole(at(row, col), at(row, col + 1), pattern)) {
        structural.push([idx(row, col), idx(row, col + 1)]);
      }
      if (row + 1 < rows && !segmentCrossesNeckHole(at(row, col), at(row + 1, col), pattern)) {
        structural.push([idx(row, col), idx(row + 1, col)]);
      }
      if (row + 1 < rows && col + 1 < cols) {
        if (!segmentCrossesNeckHole(at(row, col), at(row + 1, col + 1), pattern)) shear.push([idx(row, col), idx(row + 1, col + 1)]);
        if (!segmentCrossesNeckHole(at(row, col + 1), at(row + 1, col), pattern)) shear.push([idx(row, col + 1), idx(row + 1, col)]);
      }
      if (col + 2 < cols && !segmentCrossesNeckHole(at(row, col), at(row, col + 2), pattern)) bend.push([idx(row, col), idx(row, col + 2)]);
      if (row + 2 < rows && !segmentCrossesNeckHole(at(row, col), at(row + 2, col), pattern)) bend.push([idx(row, col), idx(row + 2, col)]);
      if (row + 1 < rows && col + 1 < cols) {
        const tl = at(row, col), tr = at(row, col + 1);
        const bl = at(row + 1, col), br = at(row + 1, col + 1);
        const iTl = idx(row, col), iTr = idx(row, col + 1), iBl = idx(row + 1, col), iBr = idx(row + 1, col + 1);
        const tri1Ok = triAreaPattern(tl, bl, tr) > DEGENERATE_AREA_EPS && !triangleCrossesNeckHole(tl, bl, tr, pattern);
        if (tri1Ok) {
          if (flipWinding) indices.push(iTl, iTr, iBl); else indices.push(iTl, iBl, iTr);
        }
        const tri2Ok = triAreaPattern(tr, bl, br) > DEGENERATE_AREA_EPS && !triangleCrossesNeckHole(tr, bl, br, pattern);
        if (tri2Ok) {
          if (flipWinding) indices.push(iTr, iBr, iBl); else indices.push(iTr, iBl, iBr);
        }
      }
    }
  }
}

/**
 * Ties each sleeve's root row to the nearest torso boundary vertex — on the
 * SAME side (`edgeCol` = 0 for the left torso edge, `torso.cols-1` for the
 * right) — in the underarm->shoulder Y range, with a short structural-style
 * constraint (rest length = their real initial distance, same "close but
 * independently generated" idiom as the front/back seam elsewhere in this
 * file). This is what keeps the sleeve visually attached to the torso
 * during simulation without requiring the two differently-parametrized
 * grids to share exact vertex indices.
 *
 * CORRECTION (Codex review, P1): this previously always searched/returned
 * `torso.cols-1` (the RIGHT edge) regardless of which sleeve it was called
 * for — the caller worked around it for the left sleeve by passing in a
 * MIRRORED copy of the torso's `points` (so the nearest-ROW search would
 * pick the geometrically correct row), but the returned INDEX still pointed
 * at the real torso's right-edge column, so the left sleeve's attachment
 * constraints pulled it toward the torso's RIGHT side — a real physical
 * defect (would visibly distort the shirt once simulated), not just a
 * cosmetic one. Fixed by taking `edgeCol` explicitly and always operating
 * on the torso's own REAL (unmirrored) points — no mirroring hack needed.
 */
function buildAttachmentPairs(torso, torsoOffset, edgeCol, sleeve, sleeveOffset, p) {
  const pairs = [];
  const torsoCandidates = [];
  for (let row = 0; row < torso.rows; row += 1) {
    const y = p.hemY + (p.shoulderY - p.hemY) * (row / (torso.rows - 1));
    if (y < p.underarmY - 0.02 || y > p.shoulderY + 0.001) continue;
    torsoCandidates.push({ row, y });
  }
  for (let col = 0; col < sleeve.cols; col += 1) {
    const sp = sleeve.points[0 * sleeve.cols + col]; // sleeve root row
    let best = null; let bestD = Infinity;
    torsoCandidates.forEach(({ row }) => {
      const tp = torso.points[row * torso.cols + edgeCol];
      const d = Math.hypot(tp.x - sp.x, tp.y - sp.y);
      if (d < bestD) { bestD = d; best = row; }
    });
    if (best == null) continue;
    pairs.push({ torsoIdx: torsoOffset + best * torso.cols + edgeCol, sleeveIdx: sleeveOffset + col, dist: bestD });
  }
  return pairs;
}

// Pin band — vertices within this far of the shoulder line are pinned to
// the hanger (torso's own top rows, plus each sleeve's own root rows, which
// sit at/near the same height). This is the "Gentle Hanger" support line:
// shoulders + upper sleeve, matching the handoff's required default exactly.
const PIN_BAND_ROWS_FROM_TOP = 2; // torso: top N rows pinned
const SLEEVE_PIN_ROWS_FROM_ROOT = 2; // sleeve: root N rows pinned (blends into the shoulder pin)

/**
 * Build the full front+back combined garment mesh: positions/UVs/triangle
 * indices for BOTH panels (front vertices first, back vertices appended
 * after, back triangles wound the opposite way so their normals face
 * outward), every structural/shear/bend constraint within each panel (kept
 * as three SEPARATE typed lists so the sim can apply the user's stretch vs.
 * bend stiffness sliders to the right constraints), seam constraints
 * linking every front boundary vertex to its back counterpart, and the
 * pinned-vertex index set. `cols`/`rows` size the torso patch directly;
 * each sleeve gets its own proportionally-smaller patch (a sleeve's
 * cross-section needs far fewer points than the torso's full width).
 */
export function buildTshirtMesh({ cols, rows, worldWidth, worldHeight, thickness, pattern = PATTERN }) {
  const torso = buildTorsoGrid(cols, rows, pattern);
  const sleeveCols = Math.max(5, Math.round(cols * 0.32));
  const sleeveRows = Math.max(6, Math.round(rows * 0.42));
  const sleeveRight = buildSleeveGrid(sleeveCols, sleeveRows, 'right', pattern);
  const sleeveLeft = buildSleeveGrid(sleeveCols, sleeveRows, 'left', pattern);

  const torsoCount = torso.cols * torso.rows;
  const sleeveCount = sleeveCols * sleeveRows;
  const count = torsoCount + sleeveCount * 2; // one panel's worth (front OR back)
  const vertexCount = count * 2; // front + back
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const pinIndices = new Set();
  const collarIndices = new Set();

  const torsoOffset = 0;
  const sleeveRightOffset = torsoCount;
  const sleeveLeftOffset = torsoCount + sleeveCount;

  const writeVertex = (i, px, py) => {
    const wx = (px - 0.5) * worldWidth;
    const wy = (py - pattern.hemY) * worldHeight - (pattern.shoulderY - pattern.hemY) * worldHeight * 0.5;
    const collarBump = insideCollarBand(px, py, pattern) ? thickness * pattern.collarBumpZ : 0;
    positions[i * 3] = wx;
    positions[i * 3 + 1] = wy;
    positions[i * 3 + 2] = thickness * 0.5 + collarBump;
    uvs[i * 2] = px;
    uvs[i * 2 + 1] = py;
    const bi = count + i;
    positions[bi * 3] = wx;
    positions[bi * 3 + 1] = wy;
    positions[bi * 3 + 2] = -thickness * 0.5 - collarBump;
    uvs[bi * 2] = px;
    uvs[bi * 2 + 1] = py;
    if (collarBump > 0) { collarIndices.add(i); collarIndices.add(bi); }
    return bi;
  };

  for (let row = 0; row < torso.rows; row += 1) {
    for (let col = 0; col < torso.cols; col += 1) {
      const i = torsoOffset + row * torso.cols + col;
      const { x, y } = torso.points[row * torso.cols + col];
      const bi = writeVertex(i, x, y);
      if (row >= torso.rows - PIN_BAND_ROWS_FROM_TOP) { pinIndices.add(i); pinIndices.add(bi); }
    }
  }
  [[sleeveRight, sleeveRightOffset], [sleeveLeft, sleeveLeftOffset]].forEach(([sleeve, offset]) => {
    for (let row = 0; row < sleeve.rows; row += 1) {
      for (let col = 0; col < sleeve.cols; col += 1) {
        const i = offset + row * sleeve.cols + col;
        const { x, y } = sleeve.points[row * sleeve.cols + col];
        const bi = writeVertex(i, x, y);
        if (row < SLEEVE_PIN_ROWS_FROM_ROOT) { pinIndices.add(i); pinIndices.add(bi); }
      }
    }
  });

  const indices = [];
  const structural = [];
  const shear = [];
  const bend = [];
  // CORRECTION (Codex review, kept from the prior round): row increases
  // from hem (y=0) to shoulder (y=1)-ish, so a "true" (tl,tr,bl/tr,br,bl)
  // winding computes to a +Z-facing normal for the front panel (verified via
  // (v1×v2) on real world-space vectors) — matches the camera at fixed +Z.
  // CORRECTION (Codex review, P1): the LEFT sleeve's own local frame
  // (sleeveFrame, mirrored via `sign=-1`) has the OPPOSITE handedness from
  // the torso's and the right sleeve's — verified empirically (mean front
  // normal Z: torso +0.00135, right sleeve +0.00122, left sleeve -0.00122
  // with the shared boolean) — so it needs the OPPOSITE flipWinding value
  // to also face +Z on the front panel. Left sleeve's front/back booleans
  // are deliberately swapped relative to torso/right sleeve below.
  addPatchTopology(torso, torsoOffset, true, indices, structural, shear, bend, pattern);
  addPatchTopology(sleeveRight, sleeveRightOffset, true, indices, structural, shear, bend, null);
  addPatchTopology(sleeveLeft, sleeveLeftOffset, false, indices, structural, shear, bend, null);
  const frontIndexCount = indices.length;
  addPatchTopology(torso, count + torsoOffset, false, indices, structural, shear, bend, pattern);
  addPatchTopology(sleeveRight, count + sleeveRightOffset, false, indices, structural, shear, bend, null);
  addPatchTopology(sleeveLeft, count + sleeveLeftOffset, true, indices, structural, shear, bend, null);

  // Sleeve<->torso attachment (per side) — short structural-style pulls
  // holding the independently-generated sleeve root against the torso's
  // real edge on the SAME side; front and back panels each get their own set.
  const rightPairs = buildAttachmentPairs(torso, torsoOffset, torso.cols - 1, sleeveRight, sleeveRightOffset, pattern);
  const leftPairs = buildAttachmentPairs(torso, torsoOffset, 0, sleeveLeft, sleeveLeftOffset, pattern);
  [...rightPairs, ...leftPairs].forEach(({ torsoIdx, sleeveIdx }) => {
    structural.push([torsoIdx, sleeveIdx]);
    structural.push([count + torsoIdx, count + sleeveIdx]);
  });

  // Seam constraints — every boundary vertex (hem/cuff/neckline/side/sleeve
  // edges) pinned to its exact counterpart on the other panel via a short
  // garment-thickness rest length, so front and back stay structurally
  // attached at the silhouette's edge instead of two independently-
  // flapping cards.
  const seam = [];
  const addSeams = (grid, offset) => {
    for (let row = 0; row < grid.rows; row += 1) {
      for (let col = 0; col < grid.cols; col += 1) {
        const idx = row * grid.cols + col;
        if (!grid.boundary[idx]) continue;
        const i = offset + idx;
        seam.push([i, count + i, thickness]);
      }
    }
  };
  addSeams(torso, torsoOffset);
  addSeams(sleeveRight, sleeveRightOffset);
  addSeams(sleeveLeft, sleeveLeftOffset);

  return {
    positions, uvs, indices: Uint32Array.from(indices), frontIndexCount,
    constraints: { structural, shear, bend, seam },
    pinIndices, collarIndices, frontCount: count, vertexCount,
    cols: torso.cols, rows: torso.rows, sleeveCols, sleeveRows,
  };
}

// ── Verlet simulation ───────────────────────────────────────────────────
// Reuses the main sheet's own conventions (ClothStudio.jsx buildCloth/step):
// position/prev/orig Float32Arrays, Gauss-Seidel constraint relaxation with
// pins re-snapped every iteration, fixed timestep with a bounded catch-up.
// Self-contained per shirt instance — no shared/global wind concept (same
// precedent as the Cloth Banners element).

function restLengthsFor(pairs, orig) {
  return pairs.map(([a, b]) => {
    const a3 = a * 3, b3 = b * 3;
    const dx = orig[b3] - orig[a3];
    const dy = orig[b3 + 1] - orig[a3 + 1];
    const dz = orig[b3 + 2] - orig[a3 + 2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  });
}

/** Build fresh position/prev/orig buffers and precomputed rest lengths for every constraint type from `mesh` (elements/tshirt-mesh.js buildTshirtMesh output). */
export function createSimState(mesh) {
  const orig = Float32Array.from(mesh.positions);
  return {
    position: Float32Array.from(mesh.positions),
    prev: Float32Array.from(mesh.positions),
    orig,
    structural: mesh.constraints.structural,
    shear: mesh.constraints.shear,
    bend: mesh.constraints.bend,
    seam: mesh.constraints.seam,
    structuralRest: restLengthsFor(mesh.constraints.structural, orig),
    shearRest: restLengthsFor(mesh.constraints.shear, orig),
    bendRest: restLengthsFor(mesh.constraints.bend, orig),
    pinIndices: mesh.pinIndices,
    vertexCount: mesh.vertexCount,
    accum: 0,
    windTime: 0,
  };
}

/** True only if every component in `arr` is finite — a cheap, whole-buffer NaN/Infinity guard. */
export function isFiniteBuffer(arr) {
  for (let i = 0; i < arr.length; i += 1) {
    if (!Number.isFinite(arr[i])) return false;
  }
  return true;
}

/** Reset a sim back to its rest pose — the recovery path when a step ever produces a non-finite value. */
export function resetSim(sim) {
  sim.position.set(sim.orig);
  sim.prev.set(sim.orig);
  sim.accum = 0;
}

// Bounded multi-octave wind — same "sum of a few sines at different
// frequencies/phases" shape as the main sheet's turbulence field
// (ClothStudio.jsx step()), parameterized per-instance rather than reading
// any shared/global wind state.
function windAt(x, y, z, t, dirX, dirZ, strength, turbulence) {
  const base = Math.sin(y * 2.3 + t * 1.7) * 0.6 + Math.sin(x * 3.1 - t * 1.3 + z * 1.9) * 0.4;
  const gust = turbulence > 0.001
    ? Math.sin(x * 5.7 + t * 3.1) * Math.sin(y * 4.3 - t * 2.4) * turbulence
    : 0;
  const amt = strength * (base * 0.7 + gust * 0.5 + 0.3);
  return { x: dirX * amt, y: amt * 0.12, z: dirZ * amt };
}

/** One Gauss-Seidel relaxation pass over a typed constraint list — moves each pair toward `restLengths[c]`, weighted so pinned endpoints never move. Exported standalone (not just via stepSim) so stretch-vs-bend stiffness routing is directly testable. */
export function relaxPairs(pos, pairs, restLengths, pinIndices, stiffness) {
  for (let c = 0; c < pairs.length; c += 1) {
    const [a, b] = pairs[c];
    const rest = restLengths[c];
    const a3 = a * 3, b3 = b * 3;
    const dx = pos[b3] - pos[a3];
    const dy = pos[b3 + 1] - pos[a3 + 1];
    const dz = pos[b3 + 2] - pos[a3 + 2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001;
    const diff = (dist - rest) / dist;
    const aPinned = pinIndices.has(a);
    const bPinned = pinIndices.has(b);
    const moveA = aPinned ? 0 : (bPinned ? 1 : 0.5);
    const moveB = bPinned ? 0 : (aPinned ? 1 : 0.5);
    pos[a3] += dx * diff * stiffness * moveA;
    pos[a3 + 1] += dy * diff * stiffness * moveA;
    pos[a3 + 2] += dz * diff * stiffness * moveA;
    pos[b3] -= dx * diff * stiffness * moveB;
    pos[b3 + 1] -= dy * diff * stiffness * moveB;
    pos[b3 + 2] -= dz * diff * stiffness * moveB;
  }
}

// Seam stiffness is deliberately NOT user-tunable — it represents the
// garment's own stitching (front/back panels genuinely sewn together), not
// a fabric property the Stretch/Bend sliders should loosen.
const SEAM_STIFFNESS = 0.85;

/**
 * One fixed substep: integrate (gravity + wind, velocity-from-previous-
 * position damping), relax every constraint type `iterations` times (pins
 * re-snapped to rest position each iteration so the solver can never drag
 * them), then recover to rest pose if anything went non-finite. `params`:
 * `{ gravity, damping, stretchStiffness, bendStiffness, windStrength,
 * windDirectionDeg, windTurbulence, windSpeed, windOn }`.
 *
 * `grab` (optional, same shape/precedent as ClothStudio.jsx's own sheet-grab
 * `world.grab`: `{active, idx, w, off, target}`) — a pointer-drag pull
 * applied ONCE per substep, AFTER constraint relaxation (so the hold stays
 * firm against the solver), mirroring the sheet's own grab-pull exactly.
 * Deliberately does NOT touch `prev` — the next substep's velocity term
 * (`(x-prev)*damping`) then reads this substep's grab-driven displacement as
 * real velocity, which is what makes a fast release fling and a held drag
 * pin, with no separate velocity-tracking code needed.
 */
export function stepSim(sim, params, dt, iterations = 4, grab = null) {
  const { position: pos, prev, pinIndices } = sim;
  const n = sim.vertexCount;
  const g = -Math.max(0, params.gravity) * dt * dt;
  const damping = Math.min(0.999, Math.max(0, params.damping));
  sim.windTime += dt;
  const dirRad = ((params.windDirectionDeg || 0) * Math.PI) / 180;
  const dirX = Math.cos(dirRad);
  const dirZ = Math.sin(dirRad);
  const windOn = params.windOn !== false;

  for (let i = 0; i < n; i += 1) {
    if (pinIndices.has(i)) continue;
    const i3 = i * 3;
    const x = pos[i3], y = pos[i3 + 1], z = pos[i3 + 2];
    const vx = (x - prev[i3]) * damping;
    const vy = (y - prev[i3 + 1]) * damping;
    const vz = (z - prev[i3 + 2]) * damping;
    let fx = 0, fy = g, fz = 0;
    if (windOn && params.windStrength > 0.0001) {
      const w = windAt(x, y, z, sim.windTime * (0.5 + (params.windSpeed || 1) * 0.5), dirX, dirZ, params.windStrength, params.windTurbulence || 0);
      fx += w.x * dt * dt;
      fy += w.y * dt * dt;
      fz += w.z * dt * dt;
    }
    prev[i3] = x; prev[i3 + 1] = y; prev[i3 + 2] = z;
    pos[i3] = x + vx + fx;
    pos[i3 + 1] = y + vy + fy;
    pos[i3 + 2] = z + vz + fz;
  }

  const stretchStiff = 0.5 * Math.min(1, Math.max(0.05, params.stretchStiffness));
  const bendStiff = 0.5 * Math.min(1, Math.max(0.02, params.bendStiffness));
  for (let iter = 0; iter < iterations; iter += 1) {
    relaxPairs(pos, sim.structural, sim.structuralRest, pinIndices, stretchStiff);
    relaxPairs(pos, sim.shear, sim.shearRest, pinIndices, stretchStiff);
    relaxPairs(pos, sim.bend, sim.bendRest, pinIndices, bendStiff);
    for (let c = 0; c < sim.seam.length; c += 1) {
      const [a, b, rest] = sim.seam[c];
      const a3 = a * 3, b3 = b * 3;
      const dx = pos[b3] - pos[a3];
      const dy = pos[b3 + 1] - pos[a3 + 1];
      const dz = pos[b3 + 2] - pos[a3 + 2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001;
      const diff = (dist - rest) / dist;
      const aPinned = pinIndices.has(a);
      const bPinned = pinIndices.has(b);
      const moveA = aPinned ? 0 : (bPinned ? 1 : 0.5);
      const moveB = bPinned ? 0 : (aPinned ? 1 : 0.5);
      pos[a3] += dx * diff * SEAM_STIFFNESS * moveA;
      pos[a3 + 1] += dy * diff * SEAM_STIFFNESS * moveA;
      pos[a3 + 2] += dz * diff * SEAM_STIFFNESS * moveA;
      pos[b3] -= dx * diff * SEAM_STIFFNESS * moveB;
      pos[b3 + 1] -= dy * diff * SEAM_STIFFNESS * moveB;
      pos[b3 + 2] -= dz * diff * SEAM_STIFFNESS * moveB;
    }
    pinIndices.forEach((i) => {
      const i3 = i * 3;
      pos[i3] = sim.orig[i3];
      pos[i3 + 1] = sim.orig[i3 + 1];
      pos[i3 + 2] = sim.orig[i3 + 2];
    });
  }

  if (grab?.active && grab.idx) {
    for (let k = 0; k < grab.idx.length; k += 1) {
      const ix = grab.idx[k] * 3;
      const wgt = grab.w[k];
      pos[ix] += (grab.target.x + grab.off[k * 3] - pos[ix]) * wgt;
      pos[ix + 1] += (grab.target.y + grab.off[k * 3 + 1] - pos[ix + 1]) * wgt;
      pos[ix + 2] += (grab.target.z + grab.off[k * 3 + 2] - pos[ix + 2]) * wgt;
    }
  }

  if (!isFiniteBuffer(pos)) {
    resetSim(sim);
    return { recovered: true };
  }
  return { recovered: false };
}

/** Fixed-timestep driver with a bounded catch-up — same shape as ClothStudio.jsx's own `DT=1/60`, max-3-substep loop. Call once per animate() frame; internally may run 0-`maxSteps` real stepSim() calls. */
export const SIM_DT = 1 / 60;
export const MAX_CATCHUP_STEPS = 3;

export function advanceSim(sim, params, dt, iterations = 4, grab = null) {
  sim.accum = Math.min(sim.accum + dt, SIM_DT * (MAX_CATCHUP_STEPS + 1));
  let steps = 0;
  let recovered = false;
  while (sim.accum >= SIM_DT && steps < MAX_CATCHUP_STEPS) {
    const result = stepSim(sim, params, SIM_DT, iterations, grab);
    if (result.recovered) recovered = true;
    sim.accum -= SIM_DT;
    steps += 1;
  }
  if (steps === MAX_CATCHUP_STEPS) sim.accum = 0;
  return { steps, recovered };
}

// ── Measured performance cost ───────────────────────────────────────────
// A real per-frame cost estimate driven by this specific mesh's actual
// vertex/constraint/triangle counts (relaxPairs iterates every constraint
// `iterations` times per stepSim call, up to MAX_CATCHUP_STEPS stepSim calls
// per animate() frame), NOT a flat hardcoded number. Used to fill
// elements/catalog.js's `quality.estimatedCost` from a real measurement
// instead of a guess — see the handoff's explicit "do not leave placeholder
// budget numbers" requirement. Calibrated so a mid-tier shirt (~proof tier,
// ~600 vertices) lands near other mid-cost elements' existing estimatedCost
// values (roughly 12-20) in elements/catalog.js.
const RELAX_ITERATIONS = 4;
export function computeMeasuredCost(mesh) {
  const constraintCount = mesh.constraints.structural.length + mesh.constraints.shear.length
    + mesh.constraints.bend.length + mesh.constraints.seam.length;
  const relaxWork = constraintCount * RELAX_ITERATIONS * MAX_CATCHUP_STEPS;
  const vertexWork = mesh.vertexCount * MAX_CATCHUP_STEPS;
  const triangleWork = mesh.indices.length / 3;
  return (relaxWork * 0.0025) + (vertexWork * 0.004) + (triangleWork * 0.006);
}
