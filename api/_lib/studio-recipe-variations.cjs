'use strict';

// Studio video variation engine. Given a base render recipe, generate a fresh
// CAMERA move + background each render so consecutive Video Promo renders look
// noticeably different — while obeying two hard rules:
//
//   1. Stay ZOOMED IN. The farthest the camera ever pulls back is the point
//      where the device mockup fills the frame; it NEVER zooms out to show the
//      whole device sitting in empty margin. Within a clip the radius only ever
//      shrinks (zoom in), never grows.
//   2. From that fill framing it zooms into different CORNERS at varied angles,
//      with the pacing/speed randomized across renders.
//
// Plus the background (environment) is randomized each render.
//
// Applied server-side at the single render chokepoint
// (studio-render-core.renderAndStoreStudioVideo) so every trigger — the Video
// Promo card button, a creative brief run, signup, or a social-post request —
// gets a fresh look. Randomness is seeded from the per-client rotation counter
// so it is reproducible (same index → same shot) and always differs run to run.
//
// Pure + stateless: no Firestore, no I/O. The render service
// (services/studio-render/recipe.mjs → normalizeRecipe) re-clamps everything,
// and this only changes the recipe (cameraTrack + environment + scroll timing),
// so NO render-service redeploy is needed.
//
// pose = [radiusFactor, azimuthDeg, elevationDeg, targetXFrac, targetYFrac]
//   radiusFactor : multiple of the viewport's camZ (smaller = closer/zoomed)
//   azimuth/elev : degrees around the device (0/0 = flat, head-on)
//   targetX/Yfrac: where the camera looks, as a fraction of half screen w/h

const clamp = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};

// scene.mjs uses a 38° VERTICAL FOV PerspectiveCamera. Mirror of scene.mjs
// VIEWPORTS (the device geometry needed to compute the "device fills the frame"
// zoom cap). Keep in sync with services/studio-render/scene.mjs.
const FOV_DEG = 38;
const VP_GEOM = {
  desktop: { w: 1440, h: 900, bezel: 30, camZ: 2700 },
  mobile: { w: 390, h: 844, bezel: 18, camZ: 1500 },
  tablet: { w: 768, h: 1024, bezel: 24, camZ: 1900 },
};

// The radiusFactor at which the whole device (incl. bezel) just fills the frame
// on its tighter axis — the FARTHEST the camera may pull back. Closer than this
// (smaller factor) is fine; farther would reveal margin around the device, which
// rule 1 forbids. Depends on the viewport geometry AND the output aspect ratio.
function fillRadiusFactor(viewport, outW, outH) {
  const vp = VP_GEOM[viewport] || VP_GEOM.desktop;
  const devW = vp.w + vp.bezel * 2;
  const devH = vp.h + vp.bezel * 2;
  const aspect = outW > 0 && outH > 0 ? outW / outH : 1.6;
  const tanV = Math.tan((FOV_DEG * Math.PI) / 180 / 2);
  const tanH = tanV * aspect;
  const fitHeightDist = devH / (2 * tanV);
  const fitWidthDist = devW / (2 * tanH);
  // MIN distance = the frame is filled (device overflows the tighter axis).
  const fillDist = Math.min(fitHeightDist, fitWidthDist);
  return fillDist / vp.camZ;
}

// Deterministic PRNG (mulberry32) so a given rotation index always produces the
// same shot — reproducible for debugging, yet different every render because the
// counter advances. Tests can inject their own rng.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randRange = (rng, lo, hi) => lo + (hi - lo) * rng();
const pick = (rng, arr) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

// Corner focus points as (targetXFrac, targetYFrac) directions. CENTER = a
// filling, head-on framing used to open a shot before diving into a corner.
const CENTER = { name: 'Center', tx: 0, ty: 0 };
const CORNERS = [
  { name: 'TL', tx: -1, ty: 1 },
  { name: 'TR', tx: 1, ty: 1 },
  { name: 'BL', tx: -1, ty: -1 },
  { name: 'BR', tx: 1, ty: -1 },
];

// Backgrounds to rotate through (environment mode/preset). 'gradient' = the
// branded HITLOOP gradient; studio/sunset = gradient presets; loft/airport/desk
// = photo scenes (assets ship in services/studio-render/assets/environments).
const BACKGROUNDS = [
  { label: 'brand', env: { mode: 'gradient' } },
  { label: 'studio', env: { mode: 'preset', preset: 'studio' } },
  { label: 'sunset', env: { mode: 'preset', preset: 'sunset' } },
  { label: 'loft', env: { mode: 'preset', preset: 'loft' } },
  { label: 'airport', env: { mode: 'preset', preset: 'airport-terminal' } },
  { label: 'desk', env: { mode: 'preset', preset: 'desk' } },
];

function normPose(p) {
  const a = Array.isArray(p) ? p : [];
  return [
    clamp(a[0], 0.2, 3, 1),
    clamp(a[1], -180, 180, 0),
    clamp(a[2], -89, 89, 0),
    clamp(a[3], -1, 1, 0),
    clamp(a[4], -1, 1, 0),
  ];
}

// Re-pace the camera move without changing WHERE it goes: t' = t^gamma.
// gamma < 1 = snappier (reach the pose then hold); gamma > 1 = slower build.
// Endpoints (t=0,1) are fixed, so radii/targets and the zoom-in-only ordering
// are untouched — this only varies perceived speed.
function warpTrack(track, gamma) {
  const g = clamp(gamma, 0.3, 3, 1);
  return track
    .map((k) => ({ t: clamp(Math.pow(clamp(k.t, 0, 1, 0), g), 0, 1, k.t), pose: normPose(k.pose) }))
    .sort((a, b) => a.t - b.t);
}

// Build one zoom-in-only corner move. Radii are strictly non-increasing and all
// ≤ fill (rules 1+2); corners, angles, reach and pacing are randomized.
function buildCornerZoomTrack(rng, fill) {
  // Radius band, as fractions of the fill cap → never wider than device-fills,
  // and rEnd < rStart guarantees the move only zooms IN.
  const rStart = fill * randRange(rng, 0.9, 1.0);
  const rEnd = fill * randRange(rng, 0.55, 0.72);
  const azMag = randRange(rng, 8, 22);
  const elMag = randRange(rng, 4, 13);

  // Open filling + roughly centered (small reach); end tight on a corner
  // (larger reach + angle). This reads as "fills the screen → dives into a
  // corner", never as "pulls back to reveal the whole device".
  const startCorner = rng() < 0.35 ? CENTER : pick(rng, CORNERS);
  let endCorner = pick(rng, CORNERS);
  if (endCorner === startCorner) endCorner = CORNERS[(CORNERS.indexOf(endCorner) + 1) % CORNERS.length];

  const poseFor = (corner, r, reach) => [
    r,
    corner.tx * azMag,
    corner.ty * elMag,
    corner.tx * reach,
    corner.ty * reach,
  ];

  const startReach = startCorner === CENTER ? 0 : randRange(rng, 0.12, 0.3);
  const endReach = randRange(rng, 0.45, 0.65);

  const keys = [{ t: 0, pose: poseFor(startCorner, rStart, startReach) }];
  if (rng() < 0.6) {
    // Optional mid keyframe for a longer, choreographed dive.
    const midCorner = pick(rng, CORNERS);
    keys.push({ t: randRange(rng, 0.4, 0.6), pose: poseFor(midCorner, (rStart + rEnd) / 2, (startReach + endReach) / 2) });
  }
  keys.push({ t: 1, pose: poseFor(endCorner, rEnd, endReach) });

  return { track: warpTrack(keys, randRange(rng, 0.7, 1.4)), label: endCorner.name };
}

// Light scroll-timing jitter that ALWAYS still reaches the bottom (target stays
// scroll-to-end via percent 100; arriveAt ≤ 1). siteSpeed is never touched — it
// desyncs the scroll (see git history / scene.mjs).
function randomScroll(rng, recipe) {
  const src = (recipe && recipe.scroll) || {};
  const target = src.target && (src.target.selector || src.target.text || src.target.percent != null)
    ? src.target
    : { percent: 100 };
  return {
    target,
    startAt: Number(randRange(rng, 0.14, 0.26).toFixed(3)),
    arriveAt: Number(randRange(rng, 0.92, 1).toFixed(3)),
    align: src.align === 'top' ? 'top' : 'center',
  };
}

// Produce a fresh variant of `recipe` for rotation slot `index`. Returns
// { recipe, label, index }. Never throws: on any error the base recipe passes
// through unchanged (label null). `rngOverride` is for tests.
function varyRecipe(recipe, index, rngOverride) {
  const r = recipe || {};
  const raw = Number(index);
  const seed = Number.isFinite(raw) ? Math.trunc(raw) : 0;
  const rng = rngOverride || mulberry32(seed >>> 0);
  try {
    const viewport = ['desktop', 'mobile', 'tablet'].includes(r.device && r.device.viewport)
      ? r.device.viewport
      : 'desktop';
    const fill = fillRadiusFactor(viewport, r.output && r.output.width, r.output && r.output.height);

    const { track, label: corner } = buildCornerZoomTrack(rng, fill);
    const bg = pick(rng, BACKGROUNDS);

    const next = { ...r };
    next.cameraTrack = track.map((k) => ({ t: k.t, pose: normPose(k.pose) }));
    // Fresh environment (don't inherit the base preset/grading) so the randomized
    // background is exactly what we picked — no stale preset bleeding through.
    next.environment = { ...bg.env, reflections: true };
    next.scroll = randomScroll(rng, r);
    return { recipe: next, label: `Corner ${corner} · ${bg.label}`, index: seed };
  } catch {
    return { recipe: r, label: null, index: seed };
  }
}

module.exports = {
  varyRecipe,
  fillRadiusFactor,
  mulberry32,
  BACKGROUNDS,
};
