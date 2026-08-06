// Camera animation templates — the Mockup Video studio's 13 authored moves
// (page.jsx CAMERA_TEMPLATES, ported verbatim: same poses, holds, radius
// cap, canonical-open rule, and hold-as-duplicate-keyframe expansion),
// retargeted from that scene's pixel space onto HOLO PAPER's orbit camera.
//
// Mapping: a mockup pose is [radiusFactor, azimuth°, elevation°, targetXFrac,
// targetYFrac, hold] where radius = camZ·rF (px) and targets are fractions
// of the device's half-size. Holo Paper's orbit camera lives in world units
// around the origin (default z 2.6, OrbitControls clamps 0.6..8), and its
// subjects (flyer/T-shirt/device) span roughly ±0.5 wu — so radiusFactor
// maps through BASE_DIST (2.6 wu ≈ "device fills the frame", the same
// meaning camZ carries in the mockup scene) and target fractions through
// SUBJECT_HALF (0.5 wu). Angles are shared verbatim (same spherical
// convention as shotCam/page.jsx: az around Y from +Z, el up).
//
// Output = timeline-v2 keyframes ({ t, name, recipe, orbitPose }) — the
// existing playback engine (resolveTrackState + blendOrbitPose) animates the
// orbit camera between them, so a template ride composes with everything
// else the timeline drives (device scroll, layer transforms, look blends).
// Pure module, no three.js/DOM — unit-testable.

export const DEFAULT_VIEW = [0.72, -26, 6];

export const CAMERA_TEMPLATES = [
  { id: 'home-feature', label: 'HOME PAGE FEATURE', theme: 'HERO', intensity: 'MEDIUM', seconds: 10,
    keys: [[1.85, -22, 12], [1.45, -15, 9], [1.05, -9, 6], [0.68, -4, 3], [0.48, -1, 2, 0, 0.08, 0.9], [0.52, 2, 2, 0, 0.05], [0.78, 8, 5, 0, 0, 0.5], [1.3, 14, 9]] },
  { id: 'hero-push', label: 'HERO PUSH-IN', theme: 'CINEMATIC', intensity: 'MEDIUM', seconds: 10,
    keys: [[2.2, -16, 14], [1.4, -9, 8], [0.85, -4, 4], [0.34, -1, 1, 0, 0, 0.8], [0.34, 0, 0, 0, 0.15], [0.7, 3, 3], [1.4, 9, 8, 0, 0, 0.5], [2.0, 14, 12]] },
  { id: 'orbit-reveal', label: 'ORBIT REVEAL', theme: 'SHOWCASE', intensity: 'BOLD', seconds: 10,
    keys: [[1.5, -75, 8], [1.15, -40, 10], [0.4, -12, 4, -0.55, 0.35, 0.6], [1.2, 5, 9], [0.4, 18, 4, 0.55, -0.35, 0.6], [1.2, 45, 10], [1.5, 70, 8], [1.3, 40, 8]] },
  { id: 'rise-settle', label: 'RISE & SETTLE', theme: 'CALM', intensity: 'SUBTLE', seconds: 10,
    keys: [[1.6, 0, -18], [1.45, 1, -11], [1.3, 2, -5], [1.1, 2, 0], [0.85, 1, 3, 0, 0, 0.7], [0.7, 0, 4, 0, 0.1, 0.9], [0.95, 0, 5], [1.2, 0, 6]] },
  { id: 'whip-arc', label: 'WHIP ARC', theme: 'ENERGETIC', intensity: 'BOLD', seconds: 6,
    keys: [[1.4, -65, 5], [0.35, -25, 6, -0.6, 0.4, 0.3], [1.2, 10, 10], [0.3, 35, 4, 0.6, 0.4, 0.3], [1.3, 60, 5], [0.32, 20, -4, 0.5, -0.45, 0.3], [1.1, -15, 8], [0.5, -40, 4, -0.4, -0.3]] },
  { id: 'slow-drift', label: 'SLOW DRIFT', theme: 'AMBIENT', intensity: 'SUBTLE', seconds: 15,
    keys: [[1.6, -12, 6], [1.4, -8, 7], [1.15, -4, 8], [0.9, -1, 7, 0, 0.1, 0.8], [0.75, 2, 6, 0.1, 0, 1.0], [0.9, 5, 5], [1.2, 8, 5], [1.45, 10, 5]] },
  { id: 'spiral-in', label: 'SPIRAL IN', theme: 'LAUNCH', intensity: 'BOLD', seconds: 10,
    keys: [[2.3, -130, 26], [1.8, -90, 20], [1.35, -55, 15], [0.95, -28, 10], [0.6, -10, 5], [0.32, 0, 2, 0, 0, 1.0], [0.32, 4, 1, 0.2, 0.1], [0.8, 12, 4]] },
  { id: 'top-drop', label: 'TOP DROP', theme: 'DRAMATIC', intensity: 'MEDIUM', seconds: 6,
    keys: [[1.9, 0, 60], [1.5, -2, 45], [1.0, -3, 28], [0.5, -2, 12, -0.5, 0.5, 0.5], [0.3, 0, 4, -0.6, 0.6, 0.6], [0.7, 0, 4, 0, 0.2], [1.1, 0, 6, 0, 0, 0.4], [1.25, 0, 5]] },
  { id: 'close-pan', label: 'CORNER TOUR', theme: 'DETAIL', intensity: 'BOLD', seconds: 15,
    keys: [[0.32, -4, 3, -0.7, 0.55, 0.7], [0.3, -2, 2, -0.65, 0.5], [0.3, 0, 2, 0.65, 0.5, 0.7], [0.3, 2, 0, 0.7, 0.45], [0.3, 3, -2, 0.65, -0.5, 0.7], [0.3, 2, -2, -0.6, -0.5], [0.32, 0, -1, -0.7, -0.55, 0.7], [0.9, 0, 3]] },
  { id: 'pull-reveal', label: 'PULL REVEAL', theme: 'LAUNCH', intensity: 'MEDIUM', seconds: 10,
    keys: [[0.28, 0, 1, -0.6, 0.5, 0.8], [0.4, 2, 2, -0.3, 0.3], [0.6, 5, 3], [0.9, 8, 5], [1.3, 11, 8], [1.7, 14, 10], [2.1, 16, 11, 0, 0, 0.5], [2.3, 17, 12]] },
  { id: 'low-hero', label: 'LOW HERO', theme: 'EPIC', intensity: 'BOLD', seconds: 10,
    keys: [[1.6, -55, -24], [1.3, -30, -16], [0.45, -10, -8, -0.5, -0.4, 0.5], [1.2, 0, -10], [0.45, 12, -8, 0.5, -0.4, 0.5], [1.3, 30, -16], [1.6, 55, -24, 0, 0, 0.4], [1.4, 40, -20]] },
  { id: 'breathe', label: 'BREATHE', theme: 'AMBIENT', intensity: 'SUBTLE', seconds: 15,
    keys: [[1.5, 0, 5], [0.8, 1, 5, 0, 0, 0.6], [1.4, 0, 6], [0.7, -1, 6, 0, 0.1, 0.6], [1.45, -1, 5], [0.65, 0, 5, 0, 0, 0.6], [1.4, 0, 6], [1.5, 0, 5]] },
  { id: 'showcase-loop', label: 'SHOWCASE LOOP', theme: 'AD SPOT', intensity: 'MEDIUM', seconds: 10,
    keys: [[1.5, 0, 6], [1.25, 35, 12], [0.45, 15, 6, 0.3, 0.2, 0.5], [1.3, -20, 14], [0.4, 0, 3, 0, 0, 0.7], [1.3, -45, 10], [1.25, -25, 8], [1.5, 0, 6]] },
];

// Holo Paper's world scale for the mockup's normalized pose space.
const BASE_DIST = 2.6;      // wu at radiusFactor 1 — the "fills the frame" distance
const SUBJECT_HALF = 0.5;   // wu — target fractions map onto the subject's half-extent
const DIST_MIN = 0.7;       // keep templates inside OrbitControls' own 0.6..8 clamps
const DIST_MAX = 7.5;
const DEG = Math.PI / 180;

// Radius cap — ported verbatim (page.jsx TEMPLATE_RADIUS_CAP/capTemplateKeys):
// no template sits "zoomed way out"; tracks whose widest pose exceeds the cap
// scale down proportionally, preserving the move's character.
const TEMPLATE_RADIUS_CAP = 1.1;
function capTemplateKeys(keys) {
  const maxR = Math.max(...keys.map((k) => k[0]));
  if (maxR <= TEMPLATE_RADIUS_CAP) return keys;
  const s = TEMPLATE_RADIUS_CAP / maxR;
  return keys.map((k) => [k[0] * s, ...k.slice(1)]);
}

// Canonical-open rule — ported verbatim: every template opens on the close,
// front-3/4 DEFAULT_VIEW (never zoomed out or turned away on frame one).
function openingKeys(tpl) {
  const keys = capTemplateKeys(tpl.keys).slice();
  keys[0] = [...DEFAULT_VIEW];
  return keys;
}

/** One mockup pose -> a Holo Paper orbitPose (world units, orbit around origin). */
export function templateOrbitPose([rF, az, el, txF = 0, tyF = 0]) {
  const r = Math.min(DIST_MAX, Math.max(DIST_MIN, rF * BASE_DIST));
  return {
    px: r * Math.sin(az * DEG) * Math.cos(el * DEG),
    py: r * Math.sin(el * DEG),
    pz: r * Math.cos(az * DEG) * Math.cos(el * DEG),
    tx: txF * SUBJECT_HALF,
    ty: tyF * SUBJECT_HALF,
    tz: 0,
  };
}

/**
 * Builds timeline-v2 keyframes for one template. `recipe` is the CURRENT
 * scene snapshot (captureSceneRecipe), reused for every keyframe so ONLY the
 * camera animates — the scene itself holds still, exactly like the mockup
 * studio's template rides. Hold semantics ported verbatim: a pose with a
 * hold parks the camera there for that many travel-units via a duplicate
 * keyframe. Worst case (Corner Tour) lands at 11 keyframes — inside
 * MAX_TIMELINE_KEYFRAMES (12) because the canonical open drops the first
 * key's own hold.
 */
export function buildCameraTemplateTimeline(templateId, recipe) {
  const tpl = CAMERA_TEMPLATES.find((t) => t.id === templateId);
  if (!tpl) return null;
  const keys = openingKeys(tpl);
  const totalUnits = (keys.length - 1) + keys.reduce((sum, k) => sum + (k[5] || 0), 0);
  const keyframes = [];
  let unit = 0;
  keys.forEach((k, i) => {
    const orbitPose = templateOrbitPose(k);
    keyframes.push({ t: unit / totalUnits, name: `${tpl.label} ${i + 1}`, recipe, orbitPose });
    if (k[5]) {
      unit += k[5];
      keyframes.push({ t: unit / totalUnits, name: `${tpl.label} ${i + 1} HOLD`, recipe, orbitPose });
    }
    unit += 1;
  });
  return { keyframes, totalSeconds: tpl.seconds, label: tpl.label };
}
