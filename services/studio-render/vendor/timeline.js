// Studio Hero Text Builder — Phase 4 pure logic, v2 (normalized-time
// keyframe track, ported from the Mockup Video studio's own camera-path
// model). See docs/plans/STUDIO-HERO-TEXT-BUILDER-SONNET-HANDOFF.md "Phase 4
// — Keyframe timeline (promo flows)" for the original plan; this module is
// the SAME pure tier as text-layers.js / diffusion-focus.js — no React, no
// DOM, no three.js import, no requestAnimationFrame/Date.now. Every function
// here is a plain deterministic transform of its arguments, directly
// testable under node:test.
//
// A keyframe's `recipe` field is an OPAQUE captureSceneRecipe() snapshot
// (ClothStudio.jsx) — this module never deep-validates its shape. The
// untrusted boundary for a recipe's own fields is (and stays)
// elements/scene-recipe.js's sanitizers, applied by ClothStudio's own
// applySceneRecipe; sanitizeTimeline below only guarantees `recipe` is a
// plain object (or the whole keyframe is dropped), same "structural only"
// discipline sanitizeTextLayers uses for text-layers.js's own opaque
// sub-shapes. Keeping recipe validation at ONE boundary (applySceneRecipe)
// means this module never drifts out of sync with scene-recipe.js's own
// field list as new recipe keys are added.
//
// This file's exported names are a CONTRACT — ClothStudio.jsx's timeline
// wiring and components/StudioTimelineCard.jsx are built against this exact
// API. Do not rename exports.
//
// ── v2 model (this revision) ────────────────────────────────────────────
// Keyframes now live at NORMALIZED track positions `t` in [0,1] over a
// `totalSeconds` duration, mirroring the Mockup Video studio's own camera
// path (`app/dashboard/studio/page.jsx`'s `applyPath`, lines ~1605-1625):
// sorted keys, clamp before the first / after the last, interpolate the
// straddling pair with a per-segment smoothstep. Marker SPACING on the
// track therefore literally IS the speed between two looks — two keys
// close together transition fast, two keys far apart transition slowly,
// with no separate "hold" or "transition" duration fields to keep in sync
// with where the markers visually sit. Every keyframe now also snapshots a
// world-space orbit-camera pose (`orbitPose`) alongside its scene recipe,
// so camera motion and look changes are ONE authored track, not two.
//
// v1 (hold/transition per-keyframe, array-position-implies-order) is
// migrated once, on load, by sanitizeTimeline — see migrateV1Timeline below
// for the exact conversion rules. There is no v1 API surface left in this
// file: `resolveTimelineState` (blend/hold/transition state machine) and
// the old hold/transition-based `sanitizeTimeline`/`timelineDuration` are
// gone, replaced by `resolveTrackState`/the t-based sanitizer/the trivial
// totalSeconds-returning `timelineDuration`. See this round's handoff notes
// for the full old→new export diff.

// ── Keyframe schema (v2) ─────────────────────────────────────────────────
// { id, name, t, recipe, orbitPose }
//   id         — reassigned positionally as 'kf-1'..'kf-N' by sanitizeTimeline
//                (same rationale as text-layers.js's txt-N reassignment: one
//                deterministic rule handles missing/duplicate/stale ids and
//                a dropped-and-renumbered array with no separate "detect a
//                collision" branch to keep in sync).
//   name       — string, ≤40 chars, defaults to 'Shot N' (N = 1-based
//                position in the KEPT array).
//   t          — normalized track position, clamped [0,1]. sanitizeTimeline
//                sorts the kept array by `t` ascending and nudges any
//                resulting ties (or clamp-induced near-ties) +0.01 apart, so
//                resolveTrackState's straddling-pair search never divides by
//                a zero-width segment.
//   recipe     — a captureSceneRecipe() snapshot (opaque, see header above).
//   orbitPose  — `{ px, py, pz, tx, ty, tz }`, a world-space camera position
//                + OrbitControls target (same convention page.jsx's own
//                keyframes use), or `null` when this keyframe never captured
//                one. All-or-nothing: a pose missing/non-finite on even ONE
//                of the six fields sanitizes to `null`, same "structural
//                requirement, no partial value" discipline `recipe` itself
//                gets above — a five-of-six-finite pose is not a usable
//                camera position, so there is nothing to independently
//                per-field-fallback the way e.g. `name` does.

export const MAX_TIMELINE_KEYFRAMES = 12;

const T_MIN = 0;
const T_MAX = 1;
const T_DEFAULT = 0;
// How far apart sanitizeTimeline pushes two keyframes that landed on (or
// were clamped to) the exact same `t` — small enough to be visually
// unnoticeable on the track, large enough that the straddling-pair search's
// `Math.max(1e-6, b.t - a.t)` span guard is never the thing actually doing
// the work.
const TIE_NUDGE = 0.01;

const TOTAL_SECONDS_MIN = 1;
const TOTAL_SECONDS_MAX = 120;
const TOTAL_SECONDS_DEFAULT = 8;

const KEYFRAME_NAME_MAX_LEN = 40;

export const DEFAULT_TIMELINE = { keyframes: [], totalSeconds: TOTAL_SECONDS_DEFAULT, loop: false };

// Treats null/undefined/'' as "absent" (falls back) rather than letting
// Number(null) === 0 silently clamp to the field's minimum — same
// "no opinion vs as-small-as-possible" distinction text-layers.js's own
// clampNum documents.
const clampNum = (v, min, max, fallback) => {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/**
 * All-or-nothing 6-field finite-number validation (see the schema header's
 * `orbitPose` entry above for why this is not an independent per-field
 * fallback like every other keyframe field). `raw === null` is an explicit
 * clear (returns null even if `fallback` has a real pose); `raw === undefined`
 * defers to `fallback`; anything else that isn't a plain object, or is
 * missing/non-finite on any of the six fields, sanitizes to `null`.
 */
function sanitizeOrbitPose(raw, fallback) {
  const src = raw === undefined ? fallback : raw;
  if (!src || typeof src !== 'object') return null;
  const px = Number(src.px), py = Number(src.py), pz = Number(src.pz);
  const tx = Number(src.tx), ty = Number(src.ty), tz = Number(src.tz);
  return [px, py, pz, tx, ty, tz].every(Number.isFinite) ? { px, py, pz, tx, ty, tz } : null;
}

/**
 * One keyframe, field-by-field validated against `fallback` (a same-index
 * keyframe from the previous sanitize pass, if any) — independent per-field
 * fallback for name/t (same discipline as text-layers.js's sanitizeTextLayer),
 * all-or-nothing for orbitPose (see sanitizeOrbitPose above). Returns `null`
 * (never a partial/invalid keyframe) when `raw.recipe` isn't a plain object
 * — the ONE structural requirement a keyframe must satisfy to exist at all.
 *
 * This is the SAME validation path both a native v2 keyframe and a
 * migrateV1Timeline-produced keyframe go through (sanitizeTimeline calls
 * this over the migrated array exactly like it would over native input) —
 * migration only needs to get the CONVERSION MATH right (t positions,
 * hold-duplication); every bound (t clamp, name length, orbitPose shape,
 * recipe structural check) is enforced here, once, for both sources.
 */
function sanitizeKeyframeV2(raw, positionIndex, fallback) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const fb = fallback && typeof fallback === 'object' ? fallback : {};

  const recipe = r.recipe && typeof r.recipe === 'object' && !Array.isArray(r.recipe) ? r.recipe : null;
  if (!recipe) return null;

  const fbName = typeof fb.name === 'string' && fb.name.trim() ? fb.name : `Shot ${positionIndex + 1}`;
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.slice(0, KEYFRAME_NAME_MAX_LEN) : fbName.slice(0, KEYFRAME_NAME_MAX_LEN);

  const t = clampNum(r.t, T_MIN, T_MAX, clampNum(fb.t, T_MIN, T_MAX, T_DEFAULT));

  const orbitPose = sanitizeOrbitPose(r.orbitPose, fb.orbitPose);

  return { id: `kf-${positionIndex + 1}`, name, t, recipe, orbitPose };
}

// ── v1 → v2 migration ────────────────────────────────────────────────────
// v1's own hold/transition bounds/defaults, kept ONLY so a migrated blob
// reproduces exactly the durations the OLD (hold/transition) player would
// have shown — not reused anywhere else in this v2 module, and never
// exported.
const LEGACY_HOLD_MIN = 0.2, LEGACY_HOLD_MAX = 30, LEGACY_HOLD_DEFAULT = 2;
const LEGACY_TRANSITION_MIN = 0, LEGACY_TRANSITION_MAX = 10, LEGACY_TRANSITION_DEFAULT = 1.5;

// A v1 keyframe carries `hold`/`transition` and no (finite) `t` — a v2
// keyframe carries a finite `t` and no hold/transition. Checking `!t` first
// means a migrated (or native v2) keyframe, which never has `t` missing, is
// never misidentified as legacy even if it happened to still carry a stale
// `hold`/`transition` key.
const isLegacyKeyframeEntry = (entry) => (
  entry && typeof entry === 'object' && !Number.isFinite(Number(entry.t))
  && (entry.hold !== undefined || entry.transition !== undefined)
);

// sanitizeTimeline migrates the WHOLE blob, once, when ANY keyframe looks
// legacy — never a per-entry mix. A real blob is homogeneously v1 or v2 (it
// was written by one version of the app at a time); this is not designed to
// gracefully split a hand-corrupted mixed array, only to never throw on one.
function isV1TimelineShape(raw) {
  return Array.isArray(raw?.keyframes) && raw.keyframes.some(isLegacyKeyframeEntry);
}

/**
 * Converts a v1 `{ keyframes: [{ hold, transition, recipe, name, ... }], loop }`
 * blob into an equivalent v2 `{ keyframes: [{ t, recipe, orbitPose, name }, ...],
 * totalSeconds, loop }` blob. Exported so the conversion math is directly
 * testable; sanitizeTimeline calls this once (when isV1TimelineShape) before
 * running its normal v2 sanitize pass over the result — see sanitizeKeyframeV2's
 * own comment for why bounds/ids are NOT enforced here.
 *
 * Conversion rule: walk cumulative time across the v1 chain (keyframe i's own
 * hold, then its transition into i+1 — the LAST keyframe's transition is
 * never consumed, exactly like the old timelineDuration/resolveTimelineState
 * did). Keyframe i's v2 `t` lands at its segment's START (where its hold
 * begins, i.e. right after the previous transition ended), normalized by the
 * v1 chain's total duration. Keyframe i's HOLD becomes a second, DUPLICATE
 * v2 keyframe at the hold's END (same recipe/orbitPose, name suffixed
 * " hold") — a flat span between two identical keys is exactly how the
 * Mockup studio's own path model already represents "hold a pose" (two keys
 * at the same pose produce zero motion between them), so the hold survives
 * the migration as data on the SAME track instead of needing its own field.
 * `totalSeconds` is `Math.ceil` of the v1 chain's total duration.
 *
 * Idempotent: every keyframe this function emits (original AND
 * hold-duplicate) has a finite `t` and no `hold`/`transition` keys, so
 * isV1TimelineShape/migrateV1Timeline is always false/a no-op on this
 * function's own output — a migrated blob saved back to localStorage and
 * reloaded is never re-migrated or re-duplicated (sanitizeTimeline's own
 * "migration is idempotent" test exercises this end-to-end).
 *
 * MAX_TIMELINE_KEYFRAMES is deliberately NOT enforced here — this function
 * can emit up to 2x the input length (every v1 keyframe becomes 2 v2
 * keyframes), and sanitizeTimeline applies the cap AFTER migration, over
 * the full migrated array, dropping overflow from the tail (documented
 * deviation from "cap the input" — the input here isn't the thing that
 * needs capping, the migration OUTPUT is).
 */
export function migrateV1Timeline(raw) {
  const entries = Array.isArray(raw?.keyframes) ? raw.keyframes : [];
  const n = entries.length;
  const loop = Boolean(raw?.loop);
  if (n === 0) return { keyframes: [], totalSeconds: TOTAL_SECONDS_DEFAULT, loop };

  const holds = entries.map((e) => clampNum(e?.hold, LEGACY_HOLD_MIN, LEGACY_HOLD_MAX, LEGACY_HOLD_DEFAULT));
  const transitions = entries.map((e) => clampNum(e?.transition, LEGACY_TRANSITION_MIN, LEGACY_TRANSITION_MAX, LEGACY_TRANSITION_DEFAULT));
  const oldDuration = holds.reduce((sum, h) => sum + h, 0) + transitions.slice(0, n - 1).reduce((sum, tr) => sum + tr, 0);

  const keyframes = [];
  let acc = 0;
  entries.forEach((entry, i) => {
    const holdStart = acc;
    const holdEnd = holdStart + holds[i];
    const baseId = typeof entry?.id === 'string' && entry.id ? entry.id : `legacy-${i + 1}`;
    const name = typeof entry?.name === 'string' && entry.name.trim() ? entry.name : `Shot ${i + 1}`;
    const recipe = entry?.recipe;
    const orbitPose = entry?.orbitPose ?? null;

    keyframes.push({ id: baseId, name, t: oldDuration > 0 ? holdStart / oldDuration : 0, recipe, orbitPose });
    keyframes.push({ id: `${baseId}-hold`, name: `${name} hold`, t: oldDuration > 0 ? holdEnd / oldDuration : 0, recipe, orbitPose });

    if (i < n - 1) acc = holdEnd + transitions[i];
  });

  return { keyframes, totalSeconds: Math.ceil(oldDuration), loop };
}

// ── Sanitizer ────────────────────────────────────────────────────────────

/**
 * Always returns a fully-shaped `{ keyframes, totalSeconds, loop }` (never
 * throws, never passes through unsanitized data) — the single gate both
 * localStorage load and any future timeline mutation handler goes through,
 * mirroring sanitizeTextLayers' role for textLayers.
 *
 * Accepts BOTH shapes: a v1 blob (any keyframe missing a finite `t` but
 * carrying `hold`/`transition`) is routed through migrateV1Timeline ONCE,
 * then the migrated array flows through the exact same per-keyframe
 * validation a native v2 blob does — see sanitizeKeyframeV2/migrateV1Timeline
 * above. MAX_TIMELINE_KEYFRAMES truncation happens AFTER migration (over
 * whichever array — migrated or native — is about to be validated), so a
 * migration that doubled a 7-keyframe v1 blob into 14 v2 keyframes still
 * caps at 12, dropping the tail.
 *
 * The kept array is sorted by `t` ascending and any resulting ties (or
 * clamp-induced near-ties) are nudged +0.01 apart — see the TIE_NUDGE
 * constant above.
 */
export function sanitizeTimeline(raw, fallback = DEFAULT_TIMELINE) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const fb = fallback && typeof fallback === 'object' ? fallback : DEFAULT_TIMELINE;

  const source = isV1TimelineShape(r) ? migrateV1Timeline(r) : r;

  const fallbackKeyframes = Array.isArray(fb.keyframes) ? fb.keyframes : [];
  const sourceKeyframes = Array.isArray(source.keyframes) ? source.keyframes : fallbackKeyframes;

  const kept = [];
  sourceKeyframes.slice(0, MAX_TIMELINE_KEYFRAMES).forEach((entry, i) => {
    const kf = sanitizeKeyframeV2(entry, kept.length, fallbackKeyframes[i]);
    if (kf) kept.push(kf);
  });

  kept.sort((a, b) => a.t - b.t);
  for (let i = 1; i < kept.length; i += 1) {
    if (kept[i].t <= kept[i - 1].t) kept[i].t = Math.min(T_MAX, kept[i - 1].t + TIE_NUDGE);
  }

  const totalSeconds = clampNum(
    source.totalSeconds, TOTAL_SECONDS_MIN, TOTAL_SECONDS_MAX,
    clampNum(fb.totalSeconds, TOTAL_SECONDS_MIN, TOTAL_SECONDS_MAX, TOTAL_SECONDS_DEFAULT)
  );

  // Same "null/undefined falls back, everything else truthy-coerces"
  // discipline as text-layers.js's own sanitizeBool.
  const loopSource = source.loop === null || source.loop === undefined ? fb.loop : source.loop;
  return { keyframes: kept, totalSeconds, loop: Boolean(loopSource) };
}

/** v2: totalSeconds IS the timeline's duration — no hold/transition math left to sum. Defensive default (never NaN/undefined) for hand-built test fixtures that skip sanitizeTimeline. */
export function timelineDuration(timeline) {
  const v = timeline?.totalSeconds;
  return Number.isFinite(v) ? v : TOTAL_SECONDS_DEFAULT;
}

// ── Track state resolution ──────────────────────────────────────────────

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// EXACTLY page.jsx's applyPath per-segment ease: `t*t*(3-2*t)`.
const smoothstep = (t) => t * t * (3 - 2 * t);

/**
 * Resolves which keyframe(s) are active at normalized playhead `u` (0..1) —
 * a direct port of page.jsx's `applyPath` (lines ~1605-1625): sort keys by
 * `t`, clamp before the first / after the last, else find the straddling
 * pair and ease the local blend with smoothstep. Returns
 * `{ fromIndex, toIndex, blend, rawBlend, done }`:
 *   - `fromIndex`/`toIndex` are indices into the `timeline.keyframes` array
 *     AS PASSED IN (not a sorted copy) — callers already hold that array and
 *     can index straight into it (`timeline.keyframes[fromIndex]`) with no
 *     need to re-sort it themselves, same as the old resolveTimelineState's
 *     contract.
 *   - `u <= first.t` (by `t`): `{ fromIndex: toIndex: <first's index>, blend: 0, rawBlend: 0, done: false }`.
 *   - `u >= last.t`: `{ fromIndex: toIndex: <last's index>, blend: 0, rawBlend: 0, done: true }`
 *     — the only `done: true` case; a caller drives playback by feeding
 *     `elapsedSeconds / totalSeconds` in as `u` and stops on `done`.
 *   - otherwise: the straddling pair `i, i+1` (by `t`), `rawBlend` is the
 *     PRE-EASE linear fraction across that segment (`clamp01((u - a.t) /
 *     (b.t - a.t))`, span floored at 1e-6 same as page.jsx), `blend` is
 *     `smoothstep(rawBlend)`. Marker SPACING is the speed: for a fixed `u`,
 *     a narrower `[a.t, b.t]` span produces a LARGER rawBlend/blend than a
 *     wider one — the track visually IS the pacing, there is no separate
 *     duration field per segment.
 *   - 0 keyframes: total, done, degenerate `{0,0,0,0,true}` (nothing to
 *     play) — the only case where `keyframes[fromIndex]` may not exist.
 *
 * Loop-agnostic by design, exactly like the page.jsx function it ports:
 * this never reads (or needs) `timeline.loop` — wrapping `u` back into
 * [0,1] for loop:true playback is the CALLER's job (e.g. `u = (elapsed %
 * totalSeconds) / totalSeconds`), same as page.jsx's own camera-path
 * playback wraps its own `u` externally before calling `applyPath`.
 */
export function resolveTrackState(timeline, u) {
  const keyframes = Array.isArray(timeline?.keyframes) ? timeline.keyframes : [];
  const n = keyframes.length;
  if (n === 0) return { fromIndex: 0, toIndex: 0, blend: 0, rawBlend: 0, done: true };

  // Sort ORIGINAL indices by t (never the keyframes themselves) so
  // fromIndex/toIndex always index straight into the array the caller
  // passed in.
  const order = keyframes.map((_, i) => i).sort((a, b) => keyframes[a].t - keyframes[b].t);
  const uIn = Number.isFinite(u) ? u : 0;
  const firstIdx = order[0];
  const lastIdx = order[order.length - 1];

  if (uIn <= keyframes[firstIdx].t) return { fromIndex: firstIdx, toIndex: firstIdx, blend: 0, rawBlend: 0, done: false };
  if (uIn >= keyframes[lastIdx].t) return { fromIndex: lastIdx, toIndex: lastIdx, blend: 0, rawBlend: 0, done: true };

  // Straddling pair — same advance-while-behind walk as page.jsx's applyPath.
  let i = 0;
  while (i < order.length - 2 && keyframes[order[i + 1]].t < uIn) i += 1;
  const aIdx = order[i], bIdx = order[i + 1];
  const a = keyframes[aIdx], b = keyframes[bIdx];
  const span = Math.max(1e-6, b.t - a.t);
  const rawBlend = clamp01((uIn - a.t) / span);
  return { fromIndex: aIdx, toIndex: bIdx, blend: smoothstep(rawBlend), rawBlend, done: false };
}

/**
 * Component lerp of an orbit-camera pose's 6 world-space fields. `null` if
 * either side is `null`/not an object (no partial-pose blending — matches
 * sanitizeOrbitPose's own all-or-nothing contract). Exact at both endpoints
 * (`blend<=0` -> `a`'s own values, `blend>=1` -> `b`'s own values) rather
 * than trusting float arithmetic to land exactly there, same reasoning as
 * blendRecipes' own endpoint-exactness comment below.
 */
export function blendOrbitPose(a, b, blend) {
  if (!a || typeof a !== 'object' || !b || typeof b !== 'object') return null;
  const bl = Number.isFinite(blend) ? clamp01(blend) : 0;
  const lerp = (k) => (bl <= 0 ? a[k] : bl >= 1 ? b[k] : a[k] + (b[k] - a[k]) * bl);
  return { px: lerp('px'), py: lerp('py'), pz: lerp('pz'), tx: lerp('tx'), ty: lerp('ty'), tz: lerp('tz') };
}

// ── Whitelist-driven continuous interpolation ───────────────────────────
// Every OTHER field (artworkId, sceneId, clothShape, bgMode, camSeed,
// videoSeconds, ...) cuts at the transition's START — the instant a
// transition begins, ClothStudio applies the WHOLE next keyframe's discrete
// state via applySceneRecipe, then this whitelist's numeric leaves (plus the
// textLayers/bgColor/mat.baseColor special cases below) animate continuously
// underneath it for the transition's duration.
//
// `anim.on` (cloth wind on/off) and every `phys.*` field (gravity/damping/
// stiffness/rebound/rumple/pinMode) are deliberately NEVER in this whitelist
// and never blended. `anim.on` is a discrete toggle (see
// `TIMELINE_LERP_WHITELIST`'s `anim.turbulence`/`anim.speed` entries below —
// the wind's INTENSITY animates, whether it's on at all does not).
// `phys.*` is excluded for a different reason: it drives the live Verlet
// cloth solver every frame regardless of timeline playback — interpolating
// gravity/stiffness/rebound mid-transition would be a physics
// discontinuity, not a smooth camera/look move, and could destabilize the
// sim. The cloth keeps simulating live off whatever `phys` the last
// discrete cut applied, exactly as it does outside timeline playback.
export const TIMELINE_LERP_WHITELIST = [
  'shotCam.az', // shortest-angle lerp — see shortestAngleLerp below
  'shotCam.el',
  'shotCam.dist',
  'shotCam.fov',
  'envIntensity',
  'glass.scale',
  'glass.rotSpeed',
  'glass.clarity',
  'glass.transmission',
  'glass.position.0',
  'glass.position.1',
  'glass.position.2',
  'glass.rotationOffset.0',
  'glass.rotationOffset.1',
  'glass.rotationOffset.2',
  'diffusionCamera.focusDistance',
  'diffusionCamera.aperture',
  'diffusionCamera.falloff',
  'diffusionCamera.diffusionRadius',
  'diffusionCamera.highlightBloom',
  // Device primary shape (Phase 5) — the hero device's page-scroll position
  // (0..1 of the captured page). Keyframed like a camera move: set the
  // SCROLL POSITION dial, Add Keyframe, and playback pans the site between
  // keyframes. Applied per-frame via the device entry's own
  // userData.scrollPositionOverride (see ClothStudio's loop), NOT a React
  // state write. Only meaningful while AUTO SCROLL is off — auto mode
  // ping-pongs on its own clock and deliberately ignores the keyframed
  // position (deviceAnimate's own branch order).
  'devicePrimary.scrollPosition',
  'devicePrimary.posY',
  'fx.bloomStrength',
  'fx.bloomThreshold',
  'fx.vignette',
  'fx.grain',
  'fx.t1',
  'fx.t2',
  'fx.t3',
  // Cloth material — DEFAULT_MAT's own numeric dials (ClothStudio.jsx).
  // `mat.baseColor` is a hex string, hex-lerped as a special case in
  // blendRecipes below, not a dot-path here (same reason bgColor isn't).
  'mat.holoIntensity',
  'mat.holoScale',
  'mat.bandFreq',
  'mat.saturation',
  'mat.hueShift',
  'mat.sparkle',
  'mat.specTint',
  'mat.iridescence',
  'mat.roughness',
  'mat.metalness',
  'mat.clearcoat',
  'mat.coatRoughness',
  'mat.sheen',
  'mat.bump',
  'mat.bumpTiling',
  // Cloth wind intensity — see the header comment above for why `anim.on`
  // itself is excluded.
  'anim.turbulence',
  'anim.speed',
  // lightCans[i] — intensity (linear) + az/el (the can's actual two
  // rotational/spatial fields per sanitizeLightCans/sanitizeCan in
  // elements/scene-recipe.js: `{ on, color, intensity, az, el }`). az is a
  // full-circle bearing (shortest-angle lerp, same treatment as
  // shotCam.az — see SHORTEST_ANGLE_PATHS below); el is a bounded elevation
  // (observed range roughly -45..80 across LIGHT_TEMPLATES, never a full
  // circle), plain-lerped.
  'lightCans.0.intensity',
  'lightCans.0.az',
  'lightCans.0.el',
  'lightCans.1.intensity',
  'lightCans.1.az',
  'lightCans.1.el',
  'lightCans.2.intensity',
  'lightCans.2.az',
  'lightCans.2.el',
  'lightCans.3.intensity',
  'lightCans.3.az',
  'lightCans.3.el',
];

// Dot-paths that use shortest-angle (not plain linear) lerp — full-circle
// bearing fields where a naive lerp between e.g. 170 and -170 would sweep
// the LONG way around through 0 instead of the short way through 180. See
// shortestAngleLerp's own doc comment for the exact math.
const SHORTEST_ANGLE_PATHS = new Set([
  'shotCam.az',
  'lightCans.0.az', 'lightCans.1.az', 'lightCans.2.az', 'lightCans.3.az',
]);

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

// Clones every container along `path` (object or array, as appropriate)
// before writing the leaf value, so `setPath` never mutates a container
// reachable from the ORIGINAL `toRecipe`/`fromRecipe` objects passed into
// blendRecipes — only the fresh `{ ...toRecipe }` top-level copy (and
// whatever this function clones underneath it) is ever written to. Works
// transparently for array segments (`glass.position.1` etc.) since JS
// indexes arrays with the same bracket/string-key syntax as objects.
const setPath = (obj, path, value) => {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const k = keys[i];
    cur[k] = Array.isArray(cur[k]) ? cur[k].slice() : { ...(cur[k] || {}) };
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
};

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const isHexColor = (v) => typeof v === 'string' && HEX_COLOR_RE.test(v);

/**
 * Shortest-angle lerp in DEGREES — see SHORTEST_ANGLE_PATHS above for which
 * whitelist paths use this instead of a plain lerp. Always takes the <=180°
 * path, in whichever direction that is.
 */
export function shortestAngleLerp(fromDeg, toDeg, blend) {
  const b = Number.isFinite(blend) ? clamp01(blend) : 0;
  const from = Number(fromDeg) || 0;
  const to = Number(toDeg) || 0;
  const diff = (((to - from + 180) % 360) + 360) % 360 - 180;
  return from + diff * b;
}

/** Per-channel hex color lerp (`#rrggbb`) — used for `bgColor`/`mat.baseColor`/text-layer `color`/`backdropColor` (all special-cased, not whitelist dot-paths). */
export function lerpHexColor(fromHex, toHex, blend) {
  const b = Number.isFinite(blend) ? clamp01(blend) : 0;
  if (!isHexColor(fromHex) || !isHexColor(toHex)) return isHexColor(toHex) ? toHex : (isHexColor(fromHex) ? fromHex : '#000000');
  const from = { r: parseInt(fromHex.slice(1, 3), 16), g: parseInt(fromHex.slice(3, 5), 16), b: parseInt(fromHex.slice(5, 7), 16) };
  const to = { r: parseInt(toHex.slice(1, 3), 16), g: parseInt(toHex.slice(3, 5), 16), b: parseInt(toHex.slice(5, 7), 16) };
  const chan = (a, z) => Math.round(a + (z - a) * b).toString(16).padStart(2, '0');
  return `#${chan(from.r, to.r)}${chan(from.g, to.g)}${chan(from.b, to.b)}`;
}

// Text-layer transform fields that lerp when a from/to pair matches by id
// AND shares the same discrete identity (text/fontId/weight/uppercase/align
// — see blendTextLayers below). `color`/`backdropColor` hex-lerp separately.
const TEXT_LAYER_LERP_FIELDS = [
  'sizePct', 'leading', 'tracking', 'opacity', 'anchorX', 'anchorY',
  'rotX', 'rotY', 'rotZ', 'backdropOpacity', 'backdropPadPct', 'maxWidthPct',
  'posZ', // in-scene depth (placement:'scene') — tweens like any transform
];

/**
 * Blends two textLayers arrays BY id (not by array position) — the shape
 * that survives is `toLayers`' own: a to-only layer (no matching from id)
 * appears verbatim, a from-only layer (no matching to id) simply isn't in
 * the output (disappears at the cut). For an id present on BOTH sides,
 * whether it LERPS or CUTS depends on whether `text`, `fontId`, `weight`,
 * `uppercase`, AND `align` are all identical:
 *   - identical on all five -> the SAME headline is just moving/restyling
 *     between shots, so TEXT_LAYER_LERP_FIELDS lerp linearly and
 *     `color`/`backdropColor` hex-lerp; every other field (id, text,
 *     fontId, weight, align, uppercase, anim, backdrop kind) is the to-side's.
 *   - any of those five differ -> a discrete cut to the to-side's layer
 *     verbatim (new copy, headline swap) — this is what lets the wiring
 *     layer detect "content changed" and retrigger the layer's in-anim,
 *     exactly like blendRecipes' own top-level discrete-field cut.
 * Returns a NEW array of NEW layer objects — never mutates `fromLayers` or
 * `toLayers` (or any layer object reachable from them).
 */
export function blendTextLayers(fromLayers, toLayers, blend) {
  const toArr = Array.isArray(toLayers) ? toLayers : [];
  const fromArr = Array.isArray(fromLayers) ? fromLayers : [];
  const b = Number.isFinite(blend) ? clamp01(blend) : 0;
  const fromById = new Map(fromArr.filter((l) => l && typeof l === 'object').map((l) => [l.id, l]));

  return toArr.map((toLayer) => {
    if (!toLayer || typeof toLayer !== 'object') return toLayer;
    const fromLayer = fromById.get(toLayer.id);
    if (!fromLayer) return toLayer; // to-only layer: appears verbatim

    const sameDiscrete = fromLayer.text === toLayer.text
      && fromLayer.fontId === toLayer.fontId
      && fromLayer.weight === toLayer.weight
      && fromLayer.uppercase === toLayer.uppercase
      && fromLayer.align === toLayer.align
      // overlay vs in-scene use different coordinate spaces — anchors/posZ
      // must never lerp ACROSS a placement change; it cuts discretely.
      && (fromLayer.placement || 'overlay') === (toLayer.placement || 'overlay');
    if (!sameDiscrete) return toLayer; // discrete cut, retriggers in-anim

    const out = { ...toLayer };
    TEXT_LAYER_LERP_FIELDS.forEach((key) => {
      const fv = fromLayer[key], tv = toLayer[key];
      if (!Number.isFinite(fv) || !Number.isFinite(tv)) return; // missing on either side -> stays at toLayer's own value (already spread)
      out[key] = b <= 0 ? fv : b >= 1 ? tv : fv + (tv - fv) * b;
    });
    if (isHexColor(fromLayer.color) && isHexColor(toLayer.color)) out.color = lerpHexColor(fromLayer.color, toLayer.color, b);
    if (isHexColor(fromLayer.backdropColor) && isHexColor(toLayer.backdropColor)) out.backdropColor = lerpHexColor(fromLayer.backdropColor, toLayer.backdropColor, b);
    return out;
  });
}

/**
 * Returns a NEW recipe object — `toRecipe`'s discrete fields (a shallow
 * `{ ...toRecipe }` spread) with every TIMELINE_LERP_WHITELIST leaf that is
 * a finite number on BOTH ends numerically interpolated (shortest-angle for
 * SHORTEST_ANGLE_PATHS entries, plain lerp otherwise), plus `bgColor` and
 * `mat.baseColor` blended as hex colors when both ends are valid hex
 * strings, plus `textLayers` blended via blendTextLayers (see its own doc
 * comment). A whitelisted field missing or non-finite on EITHER end is left
 * exactly as the initial spread already set it (toRecipe's own value) —
 * "missing on either side -> toRecipe value."
 *
 * Never mutates `fromRecipe` or `toRecipe` — every container written to is
 * cloned first (see setPath above; `mat.baseColor` and `textLayers` clone
 * their own containers explicitly, see below). At blend 0 the result is
 * `toRecipe`'s discrete fields with every whitelisted leaf still at
 * `fromRecipe`'s value (NOT toRecipe's) — this is the exact mechanism the
 * handoff's "cut at transition start" rule depends on: applying
 * `blendRecipes(from, to, 0)` once, at the instant a transition begins,
 * switches every discrete field immediately while leaving every continuous
 * field (camera, look, lights, material, text transforms) exactly where it
 * was, so the two then animate together for the rest of the transition with
 * zero visual jump.
 */
/**
 * Element-instance TRANSFORM tweening (Phase: "keyframe the image layers")
 * — the extraInstances analog of blendTextLayers above. An instance present
 * in BOTH keyframes with the same `id` AND `type` is the SAME object moving
 * between shots: its transform.position/rotation/scale lerp component-wise
 * (rotation via shortestAngleLerp — degrees, same convention as shotCam.az).
 * Everything else about the instance (material, appearance, motion,
 * enabled) is the to-side's, cut at the segment boundary like every other
 * discrete field. A to-only instance appears verbatim; a from-only instance
 * simply isn't in the result (it was removed at the cut). Returns NEW
 * arrays/objects — never mutates either input.
 */
export function blendElementTransforms(fromInstances, toInstances, blend) {
  const toArr = Array.isArray(toInstances) ? toInstances : [];
  const fromArr = Array.isArray(fromInstances) ? fromInstances : [];
  const b = Number.isFinite(blend) ? clamp01(blend) : 0;
  const fromById = new Map(fromArr.filter((i) => i && typeof i === 'object').map((i) => [i.id, i]));

  const lerpTriplet = (fv, tv, angular) => {
    if (!Array.isArray(fv) || !Array.isArray(tv)) return tv;
    return tv.map((tvN, n) => {
      const fvN = fv[n];
      if (!Number.isFinite(fvN) || !Number.isFinite(tvN)) return tvN;
      if (b <= 0) return fvN;
      if (b >= 1) return tvN;
      return angular ? shortestAngleLerp(fvN, tvN, b) : fvN + (tvN - fvN) * b;
    });
  };

  return toArr.map((toInst) => {
    if (!toInst || typeof toInst !== 'object' || !toInst.transform) return toInst;
    const fromInst = fromById.get(toInst.id);
    if (!fromInst || fromInst.type !== toInst.type || !fromInst.transform) return toInst;
    return {
      ...toInst,
      transform: {
        ...toInst.transform,
        position: lerpTriplet(fromInst.transform.position, toInst.transform.position, false),
        rotation: lerpTriplet(fromInst.transform.rotation, toInst.transform.rotation, true),
        scale: lerpTriplet(fromInst.transform.scale, toInst.transform.scale, false),
      },
    };
  });
}

export function blendRecipes(fromRecipe, toRecipe, blend) {
  const from = fromRecipe && typeof fromRecipe === 'object' ? fromRecipe : {};
  const to = toRecipe && typeof toRecipe === 'object' ? toRecipe : {};
  const b = Number.isFinite(blend) ? clamp01(blend) : 0;
  const result = { ...to };

  TIMELINE_LERP_WHITELIST.forEach((path) => {
    const fromVal = getPath(from, path);
    const toVal = getPath(to, path);
    if (!Number.isFinite(fromVal) || !Number.isFinite(toVal)) return;
    // Exact at both endpoints (b<=0 -> fromVal, b>=1 -> toVal) rather than
    // trusting float arithmetic to land exactly there — `from + (to-from)*1`
    // is not always bit-identical to `to`, and shortestAngleLerp's own
    // normalized-diff math never claims to reproduce toVal's exact raw
    // number at b=1 (only an angle equivalent mod 360) — both would
    // otherwise violate "blend 1 -> deep-equals toRecipe on every
    // whitelisted path."
    const value = b <= 0 ? fromVal : b >= 1 ? toVal : (SHORTEST_ANGLE_PATHS.has(path) ? shortestAngleLerp(fromVal, toVal, b) : fromVal + (toVal - fromVal) * b);
    setPath(result, path, value);
  });

  if (isHexColor(from.bgColor) && isHexColor(to.bgColor)) {
    result.bgColor = lerpHexColor(from.bgColor, to.bgColor, b);
  }

  // mat.baseColor — same special-case hex-lerp mechanism as bgColor, one
  // level deeper. Cloned unconditionally before writing: setPath already
  // clones result.mat the FIRST time any mat.* whitelist path above sets a
  // leaf, but a from/to pair with no OTHER matching mat.* numeric field
  // would otherwise leave result.mat === to.mat (shared reference) — this
  // clone must not depend on that having happened.
  if (isHexColor(from?.mat?.baseColor) && isHexColor(to?.mat?.baseColor)) {
    result.mat = { ...(result.mat || {}) };
    result.mat.baseColor = lerpHexColor(from.mat.baseColor, to.mat.baseColor, b);
  }

  if (Array.isArray(to.textLayers)) {
    result.textLayers = blendTextLayers(from.textLayers, to.textLayers, b);
  }

  // Element instances (image layers, extra elements) — transforms tween
  // between keyframes; everything else about an instance stays a discrete
  // cut. See blendElementTransforms' own header for the id+type matching
  // rule.
  if (Array.isArray(to.extraInstances)) {
    result.extraInstances = blendElementTransforms(from.extraInstances, to.extraInstances, b);
  }

  return result;
}

// ── Server transport (Phase C, "Interrupted export recovery") ──────────────
// Cloud Final Render / Proof Render carry the timeline as an EXPLICIT
// TOP-LEVEL field alongside `scene` (never nested into captureSceneRecipe —
// see that function's own header for why nesting would recurse). This is
// the ONE pure helper that builds that submission — device screen-source
// stripping + absent-when-empty — shared by handleGenerateProof and
// handleGenerateFinalRender (ClothStudio.jsx). See
// services/studio-render/art-timeline.mjs for the server-side sanitize/
// validate boundary this transport feeds.

// Mirrors the exact field list ClothStudio.jsx's pinDeviceScreenIfNeeded
// clears once a screen is already pinned (devicePrimary.screenStill set) —
// a keyframe can never carry different screen content mid-video; the BASE
// scene's own pinned screen is authoritative for the whole render.
// `captureSourceUrl`/`captureViewport` (Recovery round 2, Defect 1) are
// captureUrl's own provenance — meaningless without the captureUrl they
// describe, so stripped alongside it for the same reason. Not load-bearing
// for correctness (art-recipe.mjs's sanitizeDevicePrimary never carries
// these two fields into the normalized recipe either way — see that
// module's own comment — so a keyframe could never trip a timeline-field
// rejection on them even if they rode along), but stripping keeps this
// list an honest "every device screen-source field" set and trims a few
// harmless bytes off the wire.
const DEVICE_SCREEN_SOURCE_FIELDS = ['live', 'liveUrl', 'captureUrl', 'uploadAssetId', 'screenStill', 'captureSourceUrl', 'captureViewport'];

/**
 * Returns a recipe whose `devicePrimary` (if any) never carries a screen
 * SOURCE field — a NEW object when a source field was actually present,
 * the SAME `recipe` reference otherwise (so a keyframe with no device at
 * all, or a device with no source set, is never needlessly cloned). Never
 * mutates `recipe` or its `devicePrimary`.
 *
 * Exported for the LOCAL export path too (export-restore Phase 5): the same
 * rule this function's own header states — "a keyframe can never carry
 * different screen content mid-video; the BASE scene's own pinned screen is
 * authoritative for the whole render" — was previously enforced ONLY at the
 * cloud-submission boundary (buildTimelineSubmission). Browser Quick Export
 * had no equivalent, so `exportTimeline`/`stepTimelinePlayback` re-applied
 * each keyframe's stored `devicePrimary.live`/`liveUrl` and rebuilt the
 * CSS3D live iframe MID-RECORDING — re-punching the alpha hole the export
 * guard had just torn down, which recorded a blank frame every time. See
 * ClothStudio.jsx's own call sites.
 */
export function stripDeviceScreenSource(recipe) {
  if (!recipe || typeof recipe !== 'object' || !recipe.devicePrimary || typeof recipe.devicePrimary !== 'object') return recipe;
  const dp = recipe.devicePrimary;
  const hasSource = DEVICE_SCREEN_SOURCE_FIELDS.some((k) => k in dp);
  if (!hasSource) return recipe;
  const nextDp = { ...dp };
  DEVICE_SCREEN_SOURCE_FIELDS.forEach((k) => { delete nextDp[k]; });
  return { ...recipe, devicePrimary: nextDp };
}

/**
 * Builds the exact `timeline` value a Final Render/Proof submission sends
 * top-level. Returns `undefined` for an empty timeline (0 keyframes) — "an
 * empty timeline is sent as absent" (the handoff's own transport contract),
 * so a non-timeline scene's request body is byte-identical to before this
 * phase shipped. Otherwise returns a NEW timeline object — `totalSeconds`
 * (via timelineDuration, so a hand-built fixture missing the field still
 * gets the same defensive default every other consumer of this timeline
 * gets), `loop`, and every keyframe with its `recipe` run through
 * stripDeviceScreenSource above. Never mutates `timeline` or any keyframe
 * in it.
 */
export function buildTimelineSubmission(timeline) {
  const keyframes = Array.isArray(timeline?.keyframes) ? timeline.keyframes : [];
  if (keyframes.length === 0) return undefined;
  return {
    totalSeconds: timelineDuration(timeline),
    loop: Boolean(timeline.loop),
    keyframes: keyframes.map((kf) => ({ ...kf, recipe: stripDeviceScreenSource(kf.recipe) })),
  };
}
