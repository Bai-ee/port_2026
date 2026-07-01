'use strict';

// Studio video variation engine. Given a base render recipe (the "current
// template"), produce a deterministic variant by index so consecutive renders
// of the same template look noticeably different — reversed timeline, mirrored
// direction, different speed/focus — while keeping the background, environment,
// device, and output identical.
//
// Applied server-side at the single render chokepoint
// (studio-render-core.renderAndStoreStudioVideo) so every trigger — the Video
// Promo card button, a creative brief run, signup, or a social-post request —
// rotates through variants from ONE per-client counter (dashboard_state.
// studioVariantIndex).
//
// Pure + stateless: no Firestore, no I/O. The render service
// (services/studio-render/recipe.mjs → normalizeRecipe) re-clamps everything at
// render time, so this only needs to stay within the same value ranges.
//
// pose = [radiusFactor, azimuthDeg, elevationDeg, targetXFrac, targetYFrac]
//   radiusFactor : multiple of the viewport's camZ (smaller = closer/zoomed)
//   azimuth/elev : degrees around the device (0/0 = flat, head-on)
//   targetX/Yfrac: where the camera looks, as a fraction of half screen w/h

// Mirror of services/studio-render/recipe.mjs CAMERA_PRESETS. Keep in sync.
// Used to expand a preset-only recipe into an explicit cameraTrack we can
// transform (an explicit cameraTrack overrides the preset in normalizeRecipe).
const CAMERA_PRESET_TRACKS = {
  'push-in-hold': [
    { t: 0, pose: [1.05, -14, 10, 0, 0] },
    { t: 0.3, pose: [0.62, -3, 3, 0, 0] },
    { t: 1, pose: [0.6, -2, 2, 0, 0] },
  ],
  'push-rotate-flat': [
    { t: 0, pose: [1.05, -14, 10, 0, 0] },
    { t: 0.25, pose: [0.62, -3, 3, 0, 0] },
    { t: 0.55, pose: [0.5, 14, -3, 0, 0] },
    { t: 0.82, pose: [0.32, 0, 0, 0, 0] },
    { t: 1, pose: [0.3, 0, 0, 0, 0] },
  ],
  'orbit-reveal': [
    { t: 0, pose: [1.4, -55, 12, 0, 0] },
    { t: 0.5, pose: [0.7, -8, 6, 0, 0] },
    { t: 1, pose: [1.2, 45, 10, 0, 0] },
  ],
};
const DEFAULT_PRESET = 'push-rotate-flat';

// Mirror of recipe.mjs DEFAULT_SCROLL_TO_END — the hidden default when a recipe
// specifies no scroll (hold at top, then smooth-scroll to the document bottom).
// Variants that re-time the scroll clone this so they keep the scroll-to-END
// target instead of collapsing to normScroll's 55% fallback.
const DEFAULT_SCROLL_TO_END = { target: { percent: 100 }, startAt: 0.25, arriveAt: 1 };

const clamp = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};

function normPose(p) {
  const a = Array.isArray(p) ? p : [];
  return [
    clamp(a[0], 0.2, 3, 1),     // radiusFactor
    clamp(a[1], -180, 180, 0),  // azimuth
    clamp(a[2], -89, 89, 0),    // elevation
    clamp(a[3], -1, 1, 0),      // targetXFrac
    clamp(a[4], -1, 1, 0),      // targetYFrac
  ];
}

// The base cameraTrack to vary: an explicit recipe track if present, else the
// track for the recipe's named preset (or the default preset).
function baseTrack(recipe) {
  const explicit = recipe && Array.isArray(recipe.cameraTrack) ? recipe.cameraTrack : null;
  if (explicit && explicit.length >= 2) {
    return explicit.map((k) => ({ t: clamp(k && k.t, 0, 1, 0), pose: normPose(k && k.pose) }));
  }
  const preset = CAMERA_PRESET_TRACKS[recipe && recipe.preset] || CAMERA_PRESET_TRACKS[DEFAULT_PRESET];
  return preset.map((k) => ({ t: k.t, pose: k.pose.slice() }));
}

// Reverse the timeline: a keyframe at t plays at 1-t, so a push-IN becomes a
// pull-OUT (and vice versa). Poses stay attached to their new times.
function reverseTrack(track) {
  return track
    .map((k) => ({ t: clamp(1 - k.t, 0, 1, 0), pose: k.pose.slice() }))
    .sort((a, b) => a.t - b.t);
}

// Mirror the orbit/pan direction: negate azimuth (left rotate ↔ right rotate)
// and the horizontal look target so the whole move comes from the other side.
function mirrorAzimuth(track) {
  return track.map((k) => {
    const pose = k.pose.slice();
    pose[1] = clamp(-pose[1], -180, 180, 0);
    pose[3] = clamp(-pose[3], -1, 1, 0);
    return { t: k.t, pose };
  });
}

// Push the camera closer by scaling every radius (factor < 1 = tighter).
function zoomBy(track, factor) {
  return track.map((k) => {
    const pose = k.pose.slice();
    pose[0] = clamp(pose[0] * factor, 0.2, 3, pose[0]);
    return { t: k.t, pose };
  });
}

// Offset where the camera looks (different focal point) without moving the rig.
function shiftFocus(track, dx, dy) {
  return track.map((k) => {
    const pose = k.pose.slice();
    pose[3] = clamp(pose[3] + dx, -1, 1, pose[3]);
    pose[4] = clamp(pose[4] + dy, -1, 1, pose[4]);
    return { t: k.t, pose };
  });
}

// Re-pace the CAMERA move without touching the site scroll: t' = t^gamma.
// gamma < 1 pushes keyframes earlier (snappier — reach the pose, then hold);
// gamma > 1 pushes them later (slower build). Endpoints (t=0, t=1) are fixed
// points of the power curve, so the move still spans the full clip.
//
// This is how we vary "speed". We deliberately do NOT touch output.siteSpeed:
// the render service scales captured-site-frame playback by siteSpeed
// (scene.mjs), and any value != 1 desyncs the scroll — siteSpeed < 1 never
// reaches the last frame (bottom) and siteSpeed > 1 wraps back to the top
// mid-clip. Scrolling to the bottom must stay intact, so siteSpeed is left at 1.
function warpTrack(track, gamma) {
  const g = clamp(gamma, 0.3, 3, 1);
  return track
    .map((k) => ({ t: clamp(Math.pow(clamp(k.t, 0, 1, 0), g), 0, 1, k.t), pose: k.pose.slice() }))
    .sort((a, b) => a.t - b.t);
}

// Re-time the site scroll while preserving its target (defaults to scroll-to-END
// so we never silently downgrade to the 55% fallback).
function retimeScroll(recipe, startAt, arriveAt) {
  const src = (recipe && recipe.scroll) || DEFAULT_SCROLL_TO_END;
  return {
    target: src.target || DEFAULT_SCROLL_TO_END.target,
    startAt: clamp(startAt, 0, 1, DEFAULT_SCROLL_TO_END.startAt),
    arriveAt: clamp(arriveAt, 0, 1, DEFAULT_SCROLL_TO_END.arriveAt),
    align: src.align === 'top' ? 'top' : 'center',
  };
}

// The rotation set. Each variant is a patch over the base recipe — only CAMERA
// motion + scroll TIMING change (never siteSpeed; see warpTrack); environment,
// device, backdrop, and output dimensions are always inherited unchanged, and
// every variant still scrolls the site all the way to the bottom. Index 0 is the
// unmodified template, so the rotation always includes the original.
const VARIANTS = [
  {
    label: 'Signature',
    build: (r, track) => ({ cameraTrack: track }),
  },
  {
    label: 'Rewind',
    build: (r, track) => ({ cameraTrack: reverseTrack(track) }),
  },
  {
    label: 'Mirror',
    build: (r, track) => ({ cameraTrack: mirrorAzimuth(track) }),
  },
  {
    label: 'Slow Focus',
    build: (r, track) => ({ cameraTrack: zoomBy(warpTrack(track, 1.5), 0.85), scroll: retimeScroll(r, 0.2, 1) }),
  },
  {
    label: 'Fast Sweep',
    build: (r, track) => ({ cameraTrack: shiftFocus(warpTrack(track, 0.6), 0.18, -0.1), scroll: retimeScroll(r, 0.1, 0.95) }),
  },
  {
    label: 'Reverse Mirror',
    build: (r, track) => ({ cameraTrack: mirrorAzimuth(reverseTrack(track)), scroll: retimeScroll(r, 0.15, 0.92) }),
  },
];

const VARIANT_COUNT = VARIANTS.length;

// Produce a variant of `recipe` for rotation slot `index`. Returns
// { recipe, label, index } — the recipe is a shallow clone with only the
// motion levers patched. Never throws: on any error the base recipe passes
// through unchanged (label null).
function varyRecipe(recipe, index) {
  const r = recipe || {};
  const raw = Number(index);
  const n = Number.isFinite(raw) ? ((Math.trunc(raw) % VARIANT_COUNT) + VARIANT_COUNT) % VARIANT_COUNT : 0;
  const variant = VARIANTS[n];
  try {
    const track = baseTrack(r);
    const patch = variant.build(r, track) || {};
    const next = { ...r };
    if (Array.isArray(patch.cameraTrack) && patch.cameraTrack.length >= 2) {
      next.cameraTrack = patch.cameraTrack;
    }
    if (patch.scroll) next.scroll = patch.scroll;
    // NB: intentionally never patch output.siteSpeed — it desyncs the
    // scroll-to-bottom (see warpTrack). Camera pacing is the speed lever.
    return { recipe: next, label: variant.label, index: n };
  } catch {
    return { recipe: r, label: null, index: n };
  }
}

module.exports = {
  varyRecipe,
  VARIANT_COUNT,
  CAMERA_PRESET_TRACKS,
};
