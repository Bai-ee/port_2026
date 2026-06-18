// Render recipe — the shared contract between the Studio UI (authoring) and the
// render service (execution). One JSON object fully describes a mockup video:
// what the live site does (url + scroll target/timing) and how it's framed
// (camera keyframe track), plus output/device options.
//
// This is what a user "directs" — via templates for quick cases, or the Studio
// helper UI / hand-authored JSON for fully-custom shots.

// pose = [radiusFactor, azimuthDeg, elevationDeg, targetXFrac=0, targetYFrac=0]
//   radiusFactor : multiple of the viewport's camZ (smaller = closer/zoomed)
//   azimuth/elev : degrees around the device (0/0 = flat, head-on)
//   targetX/Yfrac: where the camera looks, as a fraction of half screen w/h

export const CAMERA_PRESETS = {
  // id: { label, seconds, moveSeconds, cameraTrack, scroll? }
  'push-in-hold': {
    label: 'Push-in + hold',
    cameraTrack: [
      { t: 0, pose: [1.05, -14, 10] },
      { t: 0.3, pose: [0.62, -3, 3] },
      { t: 1, pose: [0.6, -2, 2] },
    ],
  },
  'push-rotate-flat': {
    label: 'Push-in → rotate → flat zoom (good with a scroll target)',
    cameraTrack: [
      { t: 0, pose: [1.05, -14, 10] },
      { t: 0.25, pose: [0.62, -3, 3] },
      { t: 0.55, pose: [0.5, 14, -3] },
      { t: 0.82, pose: [0.32, 0, 0, 0, 0] },
      { t: 1, pose: [0.3, 0, 0, 0, 0] },
    ],
  },
  'orbit-reveal': {
    label: 'Orbit reveal',
    cameraTrack: [
      { t: 0, pose: [1.4, -55, 12] },
      { t: 0.5, pose: [0.7, -8, 6] },
      { t: 1, pose: [1.2, 45, 10] },
    ],
  },
};

const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

const ALLOWED_ENV_PRESETS = ['airport-terminal', 'desk', 'studio', 'loft', 'sunset'];

function normEnvironment(e) {
  if (!e) return { mode: 'gradient', preset: 'studio', color: '#11141a', blur: 0, hue: 0, saturation: 1, brightness: 1, reflections: true };
  const mode = ['preset', 'color', 'site', 'gradient'].includes(e.mode) ? e.mode : 'gradient';
  return {
    mode,
    preset: ALLOWED_ENV_PRESETS.includes(e.preset) ? e.preset : 'studio',
    color: String(e.color || '#11141a').slice(0, 20),
    blur: clamp(e.blur, 0, 48, 0),
    hue: clamp(e.hue, -180, 180, 0),
    saturation: clamp(e.saturation, 0, 3, 1),
    brightness: clamp(e.brightness, 0, 3, 1),
    reflections: e.reflections !== false,
  };
}

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

function normScroll(s) {
  if (!s) return null;
  const t = s.target || {};
  const target = {};
  if (t.selector) target.selector = String(t.selector).slice(0, 200);
  if (t.text) target.text = String(t.text).slice(0, 120);
  if (t.percent != null) target.percent = clamp(t.percent, 0, 100, 55);
  if (!target.selector && !target.text && target.percent == null) target.percent = 55;
  return {
    target,
    startAt: clamp(s.startAt, 0, 1, 0.25),   // fraction of clip when the scroll begins
    arriveAt: clamp(s.arriveAt, 0, 1, 0.85), // fraction of clip when it lands centered
    align: s.align === 'top' ? 'top' : 'center',
  };
}

/**
 * Normalize + validate a raw recipe into a complete, clamped recipe the render
 * core can execute. Applies a camera preset if `preset` is given and no explicit
 * cameraTrack. Always returns a safe object.
 */
export function normalizeRecipe(raw = {}) {
  const r = raw || {};
  const preset = CAMERA_PRESETS[r.preset] || null;

  let track = Array.isArray(r.cameraTrack) && r.cameraTrack.length >= 2
    ? r.cameraTrack
    : (preset ? preset.cameraTrack : CAMERA_PRESETS['push-rotate-flat'].cameraTrack);
  const cameraTrack = track
    .map((k) => ({ t: clamp(k.t, 0, 1, 0), pose: normPose(k.pose) }))
    .sort((a, b) => a.t - b.t);

  const scroll = normScroll(r.scroll ?? (preset && preset.scroll) ?? null);

  return {
    url: String(r.url || '').trim(),
    output: {
      seconds: clamp(r.output?.seconds, 2, 12, 8),
      fps: clamp(r.output?.fps, 24, 30, 30),
      width: clamp(r.output?.width, 640, 2560, 1920),
      height: clamp(r.output?.height, 360, 1600, 1200),
      siteSpeed: clamp(r.output?.siteSpeed, 0.25, 4, 1),
    },
    device: {
      viewport: ['desktop', 'mobile', 'tablet'].includes(r.device?.viewport) ? r.device.viewport : 'desktop',
      backdrop: String(r.device?.backdrop || 'home').slice(0, 20),
      loop: r.device?.loop !== false,
    },
    capture: { warmupMs: clamp(r.capture?.warmupMs, 0, 5000, 400) },
    environment: normEnvironment(r.environment),
    scroll,
    cameraTrack,
  };
}

export function isValidUrl(u) { return /^https?:\/\/\S+$/i.test(String(u || '')); }
