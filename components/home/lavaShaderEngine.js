'use client';

/*
 * WebGL engine behind the anchor-band shader. Split out of AnchorLavaShader.jsx
 * so the tuning panel (AnchorLavaControls.jsx) can run a second live instance in
 * its own preview strip off the exact same code path — what you tune in the panel
 * is literally what the band renders.
 *
 * FIVE SURFACE LOOKS, selected by `look`, each a different field function under a
 * shared colour/ramp/pointer pipeline:
 *   lava      metaballs that rise, merge and part (CPU-simulated blob centres)
 *   particles procedural hashed-grid point field — hundreds of motes
 *   water     wavefront interference, powered into thin caustic filaments
 *   chrome    smooth height field through a triangle wave = polished-metal bands
 *   plasma    smooth multi-sine colour flow
 *
 * Three structural decisions worth knowing before editing:
 *
 * 1. NO time uniform reaches the shader. The shader is `precision mediump float`
 *    (for mobile), and mediump quantises badly once a seconds counter grows past
 *    ~30 — which makes any time-driven mediump shader visibly stutter after a
 *    minute. So the clock lives in JS float64 and only ever reaches the GPU as
 *    PRE-WRAPPED phases (already reduced mod 2*PI or mod 1). Anything new that
 *    animates must follow that rule.
 * 2. `lava` blob centres are simulated on the CPU and uploaded as a small uniform
 *    array. The other looks are evaluated procedurally per fragment, which is how
 *    `particles` gets hundreds of points without touching the uniform budget that
 *    caps the blob array at ~24.
 * 3. Everything spatial is in *band-heights*: y spans 0..1, x spans 0..aspect
 *    (~11.9 on an 810x68 strip). On a band this short the only dimension that
 *    matters is its height, so radii read directly as "fractions of the band
 *    height" instead of arbitrary UV numbers.
 *
 * Every value is live-tunable through getParams() and read fresh each frame, so
 * dragging a slider never rebuilds anything. The TWO exceptions are `look` and
 * `blobCount`, which change the shader's own source (field function / array size)
 * and therefore force a program rebuild — handled in ensureProgram.
 */

/*
 * THE band palette — one source of truth. Every other place that needs these
 * colours derives from here (LAVA_DEFAULTS, parseHex's fallback, the panel's
 * preview placeholder, the dev handle). They used to be written out separately in
 * four files, which is exactly how a stale copy silently reverted them once.
 *
 * The ONE copy that cannot import this is the CSS fallback on the band itself
 * (`aboutAnchorFooterStyle` in StackedSlidesSection.jsx) — keep it in step by hand,
 * it is what shows under reduced-motion / no-WebGL.
 *
 * Note this is NOT the same ramp as the primary CTA border and Book-a-Call pill,
 * which run a more saturated 90deg variant. Changing one does not imply the other.
 */
export const LAVA_BRAND_STOPS = ['#adaed9', '#fbfaf3', '#d3a4c3'];
export const LAVA_BRAND_MID = 0.52; // where the middle stop sits, matching the CSS
export const LAVA_BRAND_CSS =
  'linear-gradient(100deg, ' +
  LAVA_BRAND_STOPS[0] +
  ' 0%, ' +
  LAVA_BRAND_STOPS[1] +
  ' ' +
  Math.round(LAVA_BRAND_MID * 100) +
  '%, ' +
  LAVA_BRAND_STOPS[2] +
  ' 100%)';

/*
 * Named palettes for the panel's Palette dropdown. The palette is NOT a stored
 * param — it would be a second source of truth for the same three colours. The
 * dropdown simply writes colorA/B/C, and its displayed value is derived by
 * matching the current stops back against this table (falling back to "custom").
 */
export const LAVA_PALETTES = {
  brand: LAVA_BRAND_STOPS,
  'brand · bold': ['#2cc3ee', '#595a9a', '#eb2cc9'],
  'brand · vivid': ['#1ddbed', '#803bf7', '#f42ac5'], // the saturated CTA-border ramp
  chrome: ['#dfe9f2', '#5c6a7d', '#f2f5f8'], // greys — pairs with the chrome looks
  mono: ['#f2f4f7', '#2a2f3a', '#f2f4f7'],
  ember: ['#ffd166', '#c1440e', '#ff5d8f'],
  'deep sea': ['#7ce7d8', '#123f6d', '#2cc3ee'],
};

export const LAVA_CUSTOM_PALETTE = 'custom';

// Which named palette the current stops correspond to, or 'custom'.
export function matchLavaPalette(params) {
  const a = String(params?.colorA || '').toLowerCase();
  const b = String(params?.colorB || '').toLowerCase();
  const c = String(params?.colorC || '').toLowerCase();
  for (const [name, stops] of Object.entries(LAVA_PALETTES)) {
    if (stops[0].toLowerCase() === a && stops[1].toLowerCase() === b && stops[2].toLowerCase() === c) {
      return name;
    }
  }
  return LAVA_CUSTOM_PALETTE;
}

// Ranges in the panel are deliberately wide — well past tasteful — because you
// cannot find a look inside a range someone else already narrowed for you. These
// DEFAULTS are the restrained lava look; LAVA_PRESETS below are the jump-off
// points for the other directions.
export const LAVA_DEFAULTS = {
  // --- which surface ---
  look: 'plasma', // lava | particles | water | chrome | plasma

  // --- base ramp ---
  colorA: LAVA_BRAND_STOPS[0],
  colorB: LAVA_BRAND_STOPS[1],
  colorC: LAVA_BRAND_STOPS[2],
  rampAngle: 100, // deg, CSS convention: 0 = to top, 90 = to right
  rampMid: LAVA_BRAND_MID, // where colorB sits; matches the CSS gradient's stop
  rampBreathe: 0.012, // slow spatial wobble of the ramp position
  rampBreatheRate: 0.09,
  bgColor: '#0b0b12', // what the surface sits ON, once bgMix is raised
  bgMix: 0, // 0 = surface rides the ramp itself, 1 = ramp only inside the surface

  // --- lava blobs (ignored by the other looks) ---
  blobCount: 3,
  radiusBase: 2.18, // band-heights
  radiusSpread: 2.31, // per-blob variation added on top of base
  breatheAmount: 0.95, // radius pulse depth
  breatheRate: 0.16,
  seed: 0.828, // reshuffles every per-blob offset
  kernelPower: 6, // blob falloff: low = puffy, high = tight

  // --- lava motion (ignored by the other looks) ---
  flowMode: 'orbit', // rise | fall | churn | drift | orbit | still
  flowSpeed: 1, // multiplier on the base traverse rate
  swayAmount: 1.35, // horizontal excursion, band-heights
  swayRate: 1,
  spread: 1, // 0 = all blobs clustered mid-band, 1 = evenly spread

  // --- procedural field (particles / water / chrome / plasma) ---
  fieldScale: 0.7, // particles: density. others: spatial frequency
  fieldSharpness: 0.2, // caustic thinness / chrome band edge / particle falloff
  fieldDetail: 1.6, // chrome band count / particle size / water cross-term
  fieldSpeed: 0.52, // temporal rate for this look

  // --- shared field shaping ---
  fieldLo: 0, // field value that starts reading as "on"
  fieldHi: 1, // field value that fully saturates
  warpAmount: 0.4, // domain warp: melts the field off-geometric
  warpScale: 0.9,
  warpSpeed: 0.35,

  // --- colour response ---
  intensity: 1, // master strength
  hueShift: 0.75, // how far the field slides along the ramp
  valueDepth: 0.22, // how much darker the "off" areas sit
  satDepth: 0.18, // how much flatter the "off" areas sit
  glow: 0, // brightens cores; past ~0.15 it clips toward white
  rim: 0, // highlight band at the field boundary
  bias: 0.5, // field level treated as neutral

  // --- pointer ---
  repelMode: 'bulge', // repel | attract | swirl | bulge | pinch | ripple | none
  repelRadius: 11.85, // band-heights of reach
  repelPush: 3.65, // displacement at full influence
  repelSoftness: 3.64, // falloff curve: <1 wide and gentle, >1 tight and local
  repelFreq: 0.8, // ripple wavelength (also twists swirl at high values)
  repelThin: 0.42, // lava only: >0 thins blobs near the cursor, <0 fattens
  attackMs: 300, // ease-in once the pointer is over the band
  releaseMs: 300, // ease-out after it leaves

  // --- render ---
  fps: 30,
  dprCap: 2,
  dither: 1, // sub-LSB ordered dither against 8-bit banding
};

export const LAVA_ENUMS = {
  look: ['lava', 'particles', 'water', 'chrome', 'plasma'],
  flowMode: ['rise', 'fall', 'churn', 'drift', 'orbit', 'still'],
  repelMode: ['repel', 'attract', 'swirl', 'bulge', 'pinch', 'ripple', 'none'],
};

// Order is the contract between JS and GLSL — the shader switches on this index.
const REPEL_INDEX = { repel: 0, attract: 1, swirl: 2, bulge: 3, pinch: 4, ripple: 5, none: 6 };

// Renamed in the interaction rework; stored tuning sessions still carry the old
// names, and an unrecognised enum would reach the shader as NaN.
const LEGACY_ENUM_ALIASES = { push: 'repel', pull: 'attract' };

/*
 * Jump-off points, not finished looks — each one is tuned to read clearly as its
 * material so there is something real to dial from. Only the keys that matter for
 * that look are listed; everything else falls back to LAVA_DEFAULTS.
 */
export const LAVA_PRESETS = {
  lava: {
    look: 'lava',
  },
  'lava · molten': {
    look: 'lava',
    blobCount: 7,
    radiusBase: 1.25,
    radiusSpread: 0.6,
    kernelPower: 1.2,
    fieldLo: 0.05,
    fieldHi: 0.9,
    warpAmount: 0.55,
    warpScale: 0.7,
    warpSpeed: 0.22,
    intensity: 1.1,
    hueShift: 0.4,
    valueDepth: 0.34,
    satDepth: 0.3,
    rim: 0.35,
    flowSpeed: 0.7,
    swayAmount: 2.1,
    repelPush: 3.2,
    repelRadius: 3.6,
  },
  particles: {
    look: 'particles',
    fieldScale: 2.6, // cells per band-height -> density
    fieldDetail: 0.34, // mote size
    fieldSharpness: 1.6,
    fieldSpeed: 1.1,
    fieldLo: 0.01,
    fieldHi: 0.55,
    intensity: 1.0,
    hueShift: 0.5,
    valueDepth: 0.42,
    satDepth: 0.2,
    glow: 0.32,
    rim: 0,
    bias: 0.12,
    repelPush: 3.0,
    repelRadius: 3.2,
  },
  'particles · dense dust': {
    look: 'particles',
    fieldScale: 6.5,
    fieldDetail: 0.22,
    fieldSharpness: 2.4,
    fieldSpeed: 0.6,
    fieldLo: 0.005,
    fieldHi: 0.42,
    intensity: 0.9,
    hueShift: 0.34,
    valueDepth: 0.5,
    glow: 0.22,
    bias: 0.08,
    warpAmount: 0.3,
    repelPush: 2.2,
  },
  water: {
    look: 'water',
    fieldScale: 1.5,
    fieldSharpness: 5.5, // caustic filament thinness
    fieldDetail: 2.2,
    fieldSpeed: 0.8,
    fieldLo: 0.08,
    fieldHi: 0.85,
    intensity: 1.1,
    hueShift: 0.3,
    valueDepth: 0.4,
    satDepth: 0.22,
    glow: 0.28,
    rim: 0.2,
    bias: 0.3,
    warpAmount: 0.35,
    warpScale: 0.8,
    warpSpeed: 0.3,
    repelPush: 2.6,
    repelRadius: 3.4,
  },
  'water · deep swell': {
    look: 'water',
    fieldScale: 0.75,
    fieldSharpness: 1.8,
    fieldDetail: 1.4,
    fieldSpeed: 0.45,
    fieldLo: 0.05,
    fieldHi: 1.1,
    intensity: 0.9,
    hueShift: 0.5,
    valueDepth: 0.3,
    satDepth: 0.3,
    bias: 0.45,
    warpAmount: 0.7,
    warpScale: 0.5,
    repelPush: 3.4,
    repelRadius: 4.5,
  },
  chrome: {
    look: 'chrome',
    fieldScale: 0.9,
    fieldDetail: 3.5, // band count
    fieldSharpness: 1.4, // band edge hardness
    fieldSpeed: 0.5,
    fieldLo: 0.0,
    fieldHi: 1.0,
    intensity: 1.3,
    hueShift: 0.12, // chrome is value contrast, not hue
    valueDepth: 0.62,
    satDepth: 0.55,
    glow: 0.16,
    rim: 0.5,
    bias: 0.5,
    warpAmount: 0.6,
    warpScale: 0.55,
    warpSpeed: 0.18,
    repelPush: 3.0,
    repelRadius: 3.8,
    dither: 1,
  },
  'chrome · polished': {
    look: 'chrome',
    fieldScale: 1.3,
    fieldDetail: 6,
    fieldSharpness: 2.6,
    fieldSpeed: 0.32,
    fieldHi: 1.0,
    intensity: 1.6,
    hueShift: 0.05,
    valueDepth: 0.8,
    satDepth: 0.2,
    glow: 0.3,
    rim: 0.8,
    bias: 0.5,
    warpAmount: 0.9,
    warpScale: 0.45,
    repelPush: 4,
    repelRadius: 4,
  },
  plasma: {
    look: 'plasma',
    fieldScale: 1.1,
    fieldSharpness: 1,
    fieldDetail: 1.6,
    fieldSpeed: 0.7,
    fieldLo: 0,
    fieldHi: 1,
    intensity: 1.0,
    hueShift: 0.75,
    valueDepth: 0.22,
    satDepth: 0.18,
    bias: 0.5,
    warpAmount: 0.4,
    repelPush: 3.2,
    repelRadius: 4,
  },
};

// Non-blob uniform vectors the fragment shader uses, plus slack for driver
// bookkeeping. Subtracted from the device budget to get a safe blob cap.
const UNIFORM_VECTOR_OVERHEAD = 22;
const HARD_BLOB_CAP = 24;

/*
 * PHASE CONTRACT - read before touching anything that animates.
 *
 * No time uniform reaches the shader (see the header). Instead the CPU sends
 * PRE-WRAPPED phases: uPhase.xyzw reduced mod 2*PI, and uField2.w reduced mod 1.
 *
 * Wrapping is only INVISIBLE if the shader uses a phase with a coefficient of
 * exactly 1 - or an integer, since sin is 2*PI-periodic and fract is 1-periodic.
 * Write sin(x + uPhase.y * 0.7) and that term lurches by 1.4*PI every time the
 * phase wraps: a hard jerk, once every 2*PI/rate seconds. Three of these shipped,
 * each a real visible stutter (plasma and water every ~30s, particles every ~11s).
 *
 * So: every phase is used raw, and a term needing its own timing gets its own
 * phase slot rather than a multiplier. Where per-element speed variation is
 * wanted, scale by an INTEGER lap count. A test greps for violations - keep it
 * passing.
 */

// A lava blob's traverse span and how far past the band it runs. The weight
// envelope (see writeBlobs) fades each blob out at both ends of the span, which
// is what makes the wrap invisible at ANY radius — so the span can stay tight and
// keep blobs actually inside the band instead of idling off-screen.
const SPAN = 2.6;
const PAD = 0.8;
const FADE = 0.18;
const BASE_RISE = 0.067; // band-heights/sec at flowSpeed 1 -> ~28-39s cycles
const TAU = Math.PI * 2;

const PARAM_KEYS = Object.keys(LAVA_DEFAULTS);

// Fills `out` in place rather than returning a new object: the render loop reads
// params every frame, so allocating here would mean garbage on every frame.
export function normalizeLavaParamsInto(out, patch) {
  for (let i = 0; i < PARAM_KEYS.length; i++) {
    const key = PARAM_KEYS[i];
    const fallback = LAVA_DEFAULTS[key];
    const v = patch ? patch[key] : undefined;
    if (v === undefined || v === null) {
      out[key] = fallback;
    } else if (typeof fallback === 'number') {
      const n = Number(v);
      out[key] = Number.isFinite(n) ? n : fallback;
    } else if (LAVA_ENUMS[key]) {
      // Validate every enum against its option list: a stale value out of a stored
      // session (or a typo in a preset) would otherwise reach the shader as NaN.
      const alias = LEGACY_ENUM_ALIASES[v] || v;
      out[key] = LAVA_ENUMS[key].includes(alias) ? alias : fallback;
    } else {
      out[key] = v;
    }
  }
  return out;
}

export function normalizeLavaParams(patch) {
  return normalizeLavaParamsInto({}, patch);
}

// Keys a preset is NOT allowed to touch, because they are not part of a "look":
// the palette belongs to the brand (and then to whatever the user picked), and the
// render settings belong to the machine. Every preset — lava, water, chrome, all of
// them — therefore renders on the SAME default gradient. Enforced here rather than
// by convention, so a future preset cannot quietly reintroduce its own colours.
const PRESET_PROTECTED_KEYS = ['colorA', 'colorB', 'colorC', 'bgColor', 'fps', 'dprCap'];

export function applyLavaPreset(current, presetName) {
  const preset = LAVA_PRESETS[presetName];
  if (!preset) return normalizeLavaParams(current);
  // Presets rebase on the DEFAULTS, not on whatever is currently dialled in —
  // otherwise switching looks inherits half of the previous look's tuning and
  // nothing reads the way the preset was tuned to read.
  const next = normalizeLavaParams(preset);
  const held = normalizeLavaParams(current);
  for (const key of PRESET_PROTECTED_KEYS) next[key] = held[key];
  return next;
}

const VERTEX_SHADER = `
attribute vec2 aPos;
varying vec2 vUv;

void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// Per-look field function. Each returns a raw scalar that the shared pipeline
// then windows through fieldLo/fieldHi. Only ONE of these is compiled into any
// given program, so an unused look costs nothing at runtime.
const SURFACES = {
  lava: (blobCount) => `
float surface(vec2 p) {
  float f = 0.0;
  for (int i = 0; i < ${blobCount}; i++) {
    vec4 blob = uBlobs[i];
    vec2 q = p - blob.xy;
    float r = max(blob.z, 0.0001);
    // Wyvill-style (1 - d^2)^power: compact support, no singularity at the
    // centre, derivative zero at the boundary, and it sums into clean merges.
    // That is what keeps the field free of the hard rims a plain circle or a
    // 1/d^2 falloff would give.
    float g = max(1.0 - dot(q, q) / (r * r), 0.0);
    f += blob.w * pow(g, uField.x);
  }
  return f;
}
`,
  particles: () => `
// Hashed grid: one mote per cell, so density scales with fieldScale without
// touching the uniform budget that caps the lava blob array at ~24.
PREC_HI vec2 hash22(PREC_HI vec2 v) {
  PREC_HI float n = sin(dot(v, vec2(41.3, 289.7)));
  return fract(vec2(753.5453, 431.1234) * n);
}

float surface(vec2 p) {
  float dens = max(uField2.x, 0.05);
  PREC_HI vec2 gp = p * dens;
  PREC_HI vec2 base = floor(gp);
  // Everything below works RELATIVE to the cell origin. Absolute grid coords hit
  // ~120 at high density, where mediump resolves to ~0.12 of a cell — the motes
  // would visibly snap to a lattice. Local coords stay inside 0..2.
  vec2 local = vec2(gp - base);
  float rad = max(uField2.z, 0.02);
  float f = 0.0;
  // 3x3 neighbourhood so a mote near a cell edge still lights its neighbours.
  for (int oy = -1; oy <= 1; oy++) {
    for (int ox = -1; ox <= 1; ox++) {
      vec2 off = vec2(float(ox), float(oy));
      vec2 h = vec2(hash22(base + off));
      // Rise phase is pre-wrapped to 0..1 on the CPU (uField2.w), so fract() here
      // is exact. Per-particle speed comes from an INTEGER lap count: scaling a
      // wrapped phase by a fraction makes every mote jump on each wrap.
      float laps = min(4.0, floor(1.0 + 4.0 * h.x));
      float ph = fract(h.y + uField2.w * laps);
      vec2 d = local - (off + vec2(0.12 + 0.76 * h.x, ph));
      float g = max(1.0 - dot(d, d) / (rad * rad), 0.0);
      // Fade in at the bottom of the cell and out at the top: without this a mote
      // pops when its phase wraps. Reads as drifting, twinkling dust.
      f += sin(ph * 3.14159) * pow(g, uField2.y);
    }
  }
  return f;
}
`,
  water: () => `
float surface(vec2 p) {
  PREC_HI vec2 q = p * max(uField2.x, 0.02) * 3.0;
  float d = uField2.z;
  // Four wavefronts at incommensurate angles. Their interference pattern is what
  // produces caustic cells; the cross terms (q.x +/- q.y) are what stop it from
  // reading as a plain grid.
  float a = sin(q.x + uPhase.x) + sin(q.y * 1.3 - uPhase.y);
  float b = sin((q.x + q.y) * 0.8 * d + uPhase.z) + sin((q.x - q.y) * 1.1 * d + uPhase.w);
  float v = (a + b) * 0.25;
  // Caustics are thin bright filaments where wavefronts cross, so the ridge of
  // |v| gets powered up — a high exponent is the difference between thin light
  // lines and soft bands.
  return pow(max(1.0 - abs(v), 0.0), uField2.y);
}
`,
  chrome: () => `
float surface(vec2 p) {
  PREC_HI vec2 q = p * max(uField2.x, 0.02) * 2.0;
  // Smooth height field. Kept low-frequency on purpose: the banding below is what
  // carries the detail, so extra height detail just reads as noise. highp because
  // the band term multiplies it by up to 24 before fract().
  PREC_HI float h = sin(q.x * 0.7 + uPhase.x) * 0.6
                  + sin(q.y * 1.1 - uPhase.y) * 0.4
                  + sin((q.x * 0.5 + q.y * 0.8) + uPhase.z) * 0.5;
  // Triangle wave through the height = the alternating light/dark sheets that
  // read as polished metal. Powering it sharpens the band edges toward a mirror.
  float bands = abs(float(fract(h * max(uField2.z, 0.1))) * 2.0 - 1.0);
  return pow(bands, max(uField2.y, 0.05));
}
`,
  plasma: () => `
float surface(vec2 p) {
  PREC_HI vec2 q = p * max(uField2.x, 0.02) * 2.5;
  float d = uField2.z;
  float v = sin(q.x + uPhase.x) * sin(q.y * 0.9 + uPhase.y)
          + sin((q.x + q.y) * 0.7 * d + uPhase.z)
          + sin(length(q * 0.6) * d - uPhase.w);
  return pow(clamp(v * 0.3 + 0.5, 0.0, 1.0), max(uField2.y, 0.05));
}
`,
};

const buildFragmentShader = (look, blobCount) => `
precision mediump float;

// Hashes and domain warps multiply coordinates before sin(), which pushes the
// argument past what mediump resolves cleanly. highp for just those locals keeps
// them smooth where it exists, and degrades to mediump (chunkier, everything else
// identical) where it does not.
#ifdef GL_FRAGMENT_PRECISION_HIGH
#define PREC_HI highp
#else
#define PREC_HI mediump
#endif

varying vec2 vUv;

uniform float uAspect;              // band width in band-heights
uniform float uIntensity;
uniform vec4  uRamp;                // xy = gradient axis, z = mid stop, w = length
uniform vec2  uRampWave;            // x = pre-wrapped phase, y = amplitude
uniform vec4  uField;               // blob power, lo, hi, bias
uniform vec4  uField2;              // scale, sharpness, detail, particle phase (0..1)
uniform vec4  uPhase;               // four independent phases, pre-wrapped mod 2*PI
uniform vec4  uResp;                // hueShift, valueDepth, satDepth, glow
uniform vec2  uResp2;               // rim, dither
uniform vec4  uWarp;                // amount, scale, phaseA, phaseB
uniform vec4  uPtr;                 // xy = pointer, z = influence, w = reach
uniform vec4  uPtr2;                // mode index, force, ripple freq, softness
uniform vec4  uBg;                  // rgb = background colour, a = mix
uniform vec3  uColorA;
uniform vec3  uColorB;
uniform vec3  uColorC;
uniform vec4  uBlobs[${blobCount}]; // xy = centre, z = radius, w = weight

${SURFACES[look](blobCount)}

void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);

  // Pointer distortion of the whole field. The lava look moves its actual blob
  // centres on the CPU instead; every other look is procedural, so warping the
  // sample domain is the only way to make it respond to the cursor.
  //
  // A domain warp is an INVERSE map: to make the field APPEAR to move by +d, the
  // sample has to be taken at p - d. Adding it instead is exactly what turns
  // "repel" into a pinch, so disp below is always written as the visual
  // displacement and negated once, at the end.
  if (uPtr.z > 0.001 && uPtr.w > 0.001 && uPtr2.x < 5.5) {
    vec2 away = p - uPtr.xy;
    float dist = length(away);
    vec2 dir = away / max(dist, 0.001);
    float u = min(1.0, dist / uPtr.w);
    // Softness is an exponent on the falloff: below 1 it spreads into a wide swell,
    // above 1 it tightens into a local dent.
    float near = pow(1.0 - u * u * (3.0 - 2.0 * u), max(uPtr2.w, 0.05));
    float amp = near * uPtr2.y * uPtr.z;
    // dist * freq reaches ~170 at the extremes, well past mediump, so the ripple
    // argument is computed high-precision.
    PREC_HI float rip = dist * uPtr2.z - uPhase.x * 2.0;

    // Split into radial and tangential parts so the radial one can be clamped.
    // Without that clamp a strong repel displaces further than the cursor is away,
    // the inverse map folds back through the centre, and the void renders as a
    // mirrored double image instead of a clean hole.
    float radial = 0.0;  // + = the field appears to move outward, away from you
    float tangent = 0.0; // + = the field appears to rotate around you
    int m = int(uPtr2.x + 0.5);
    if (m == 0) radial = amp;                 // repel: field flees you
    else if (m == 1) radial = -amp;           // attract: gathers in
    else if (m == 2) tangent = amp;           // swirl: rotates around
    else if (m == 3) radial = amp * u;        // bulge: lens with a calm centre
    else if (m == 4) radial = -amp * u;       // pinch: contracts inward
    else radial = amp * sin(rip);             // ripple: rings travelling out

    // Only bites on outward push; inward modes pass through untouched.
    radial = min(radial, dist * 0.98);
    p -= dir * radial + vec2(-dir.y, dir.x) * tangent;
  }

  // Domain warp. Recentred before scaling so the sin() arguments stay as small as
  // possible, which is what keeps the warp smooth rather than stepped.
  if (uWarp.x > 0.0001) {
    PREC_HI vec2 w = (p - vec2(uAspect * 0.5, 0.5)) * uWarp.y;
    p += uWarp.x * 0.5 * vec2(
      sin(w.y * 2.7 + uWarp.z) + 0.5 * sin(w.x * 1.3 - uWarp.w),
      sin(w.x * 2.1 + uWarp.w) + 0.5 * sin(w.y * 1.7 + uWarp.z)
    );
  }

  float field = surface(p);
  float level = smoothstep(uField.y, max(uField.z, uField.y + 0.001), field);

  // Signed lift around the bias: negative in the "off" areas, positive inside the
  // surface, so the effect reads as light moving *through* the band rather than as
  // a decal laid on top of it.
  float lift = (level - uField.w) * uIntensity;

  // Position along the CSS gradient line. Dividing by the same length CSS uses
  // (|W*sin| + |H*cos|) is what makes the corners land exactly on 0 and 1, so
  // swapping this canvas in for the CSS gradient is not a visible jump.
  float t = 0.5 + dot(p - vec2(uAspect, 1.0) * 0.5, uRamp.xy) / max(uRamp.w, 0.001);

  // Slow spatial breathe so the flat areas are not perfectly static.
  t += sin(uRampWave.x + p.x * 0.22) * uRampWave.y;

  // Hue is the primary signal and the only one with real room: sliding t moves
  // ALONG the existing ramp, which is the structural guarantee that no output
  // colour can leave the colorA<->colorC range.
  t = clamp(t + lift * uResp.x, 0.0, 1.0);

  float mid = clamp(uRamp.z, 0.02, 0.98);
  vec3 col = t < mid
    ? mix(uColorA, uColorB, t / mid)
    : mix(uColorB, uColorC, (t - mid) / (1.0 - mid));

  // Value and saturation are biased DOWNWARD by default. Saturated brand stops
  // peak at ~0.97 in a channel, so there is almost no headroom to brighten:
  // multiplying up clips a channel, and a clipped channel is exactly how a
  // saturated hue turns into white. So a core keeps the exact ramp colour and the
  // gaps sit slightly deeper and softer — reads the same as brightening the
  // cores, and it cannot clip. glow/rim below are the opt-in way past that.
  float off = (1.0 - level) * uIntensity;
  col *= 1.0 - uResp.y * off;
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(lum), col, 1.0 - uResp.z * off);

  // Background. Weighted by how "off" the pixel is, so at mix 1 the ramp survives
  // only inside the surface and everything else is the chosen colour — that is what
  // lets particles or chrome sit on near-black instead of on the brand gradient.
  // Deliberately independent of uIntensity: a background is a base choice, not a
  // modulation, and dialling intensity down should not make it fade away.
  col = mix(col, uBg.rgb, uBg.a * (1.0 - level));

  // Core glow + boundary rim. These CAN clip toward white when pushed, which is a
  // look choice rather than a bug — they are 0 in the restrained default.
  float rimBand = level * (1.0 - level) * 4.0;
  col *= 1.0 + (uResp.w * level + uResp2.x * rimBand) * uIntensity;

  // Sub-LSB ordered dither: a wide hue sweep across ~810px is exactly the setup
  // that bands on 8-bit panels. This is the exact 2x2 Bayer matrix
  // ([0 2; 3 1] / 4) written arithmetically so it stays precise in mediump, at
  // well under one code value of amplitude — it dissolves the steps without
  // reading as grain.
  vec2 cell = mod(gl_FragCoord.xy, 2.0);
  float bayer = mod(2.0 * cell.x + 3.0 * cell.y, 4.0) * 0.25;
  col += (bayer - 0.375) * uResp2.y / 255.0;

  // Opaque: this replaces the CSS gradient rather than layering over it.
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

// #rgb / #rrggbb -> [r, g, b] in 0..1, or null if it is not a colour.
function hexToRgb(hex) {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

// Derived, never written out: a malformed hex degrades to the real first stop
// rather than to whatever colour happened to be pasted here.
const FALLBACK_RGB = hexToRgb(LAVA_BRAND_STOPS[0]);

// Memoised because the render loop reads colours every frame and must not
// allocate or re-parse.
const hexCache = new Map();
export function parseHex(hex) {
  const cached = hexCache.get(hex);
  if (cached) return cached;
  const rgb = hexToRgb(hex);
  if (!rgb) return FALLBACK_RGB;
  hexCache.set(hex, rgb);
  return rgb;
}

function compileShader(gl, type, source, label, warn) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    warn(`${label} shader failed to compile`, gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/*
 * Mounts the renderer on `canvas`. Returns null if WebGL or the shader is
 * unavailable — callers treat null as "show the CSS gradient instead".
 *
 *   canvas        target <canvas>; its CSS box drives the drawing-buffer size
 *   getParams     () => params object, read fresh every frame
 *   pointerTarget element the pointer listeners attach to (default: parent)
 *   onStats       optional ({ fps, blobLimit }) heartbeat, ~4x/sec
 */
export function createLavaEngine({ canvas, getParams, pointerTarget, onStats } = {}) {
  if (!canvas) return null;
  let warned = false;
  const warn = (...args) => {
    if (warned) return;
    warned = true;
    console.warn('[AnchorLavaShader]', ...args);
  };

  const glOpts = {
    alpha: false, // opaque output; we replace the gradient, not blend with it
    antialias: false, // nothing has edges, so MSAA would be pure cost
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'low-power', // decorative strip; never wake the dGPU
  };
  const gl = canvas.getContext('webgl', glOpts) || canvas.getContext('experimental-webgl', glOpts);
  if (!gl) {
    warn('no WebGL context available');
    return null;
  }

  // The uniform-array size is the real ceiling on lava blob count, and it varies
  // by device (the WebGL1 floor is 16 vectors; desktop reports 1024+).
  const vectorBudget = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) || 16;
  const blobLimit = Math.max(1, Math.min(HARD_BLOB_CAP, vectorBudget - UNIFORM_VECTOR_OVERHEAD));

  // ---- static geometry: one triangle pair, uploaded once -------------------
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  );

  let program = null;
  let uni = null;
  let activeCount = 0;
  let activeLook = '';
  let blobData = null;
  let dead = false;

  // `look` picks the field function and `blobCount` is the array size, so those
  // two are the only edits that need a new program. Everything else is a uniform.
  const ensureProgram = (look, count) => {
    if (program && look === activeLook && count === activeCount) return true;
    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER, 'vertex', warn);
    const fs = vs
      ? compileShader(gl, gl.FRAGMENT_SHADER, buildFragmentShader(look, count), 'fragment', warn)
      : null;
    let next = vs && fs ? gl.createProgram() : null;
    if (next) {
      gl.attachShader(next, vs);
      gl.attachShader(next, fs);
      gl.linkProgram(next);
      if (!gl.getProgramParameter(next, gl.LINK_STATUS)) {
        warn('program failed to link', gl.getProgramInfoLog(next));
        gl.deleteProgram(next);
        next = null;
      }
    }
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    if (!next) return false;

    if (program) gl.deleteProgram(program);
    program = next;
    activeLook = look;
    activeCount = count;
    blobData = new Float32Array(count * 4);
    gl.useProgram(program);
    const aPos = gl.getAttribLocation(program, 'aPos');
    if (aPos >= 0) {
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    }
    uni = {
      aspect: gl.getUniformLocation(program, 'uAspect'),
      intensity: gl.getUniformLocation(program, 'uIntensity'),
      ramp: gl.getUniformLocation(program, 'uRamp'),
      rampWave: gl.getUniformLocation(program, 'uRampWave'),
      field: gl.getUniformLocation(program, 'uField'),
      field2: gl.getUniformLocation(program, 'uField2'),
      phase: gl.getUniformLocation(program, 'uPhase'),
      resp: gl.getUniformLocation(program, 'uResp'),
      resp2: gl.getUniformLocation(program, 'uResp2'),
      warp: gl.getUniformLocation(program, 'uWarp'),
      ptr: gl.getUniformLocation(program, 'uPtr'),
      ptr2: gl.getUniformLocation(program, 'uPtr2'),
      bg: gl.getUniformLocation(program, 'uBg'),
      colorA: gl.getUniformLocation(program, 'uColorA'),
      colorB: gl.getUniformLocation(program, 'uColorB'),
      colorC: gl.getUniformLocation(program, 'uColorC'),
      // Arrays are queried by their first element — the spec-safe form.
      blobs: gl.getUniformLocation(program, 'uBlobs[0]'),
    };
    return true;
  };

  const resolveLook = (p) => (SURFACES[p.look] ? p.look : 'lava');
  // Only `lava` reads the blob array; the other looks compile it at size 1 so
  // they neither burn uniform slots nor pay for a CPU sim they ignore.
  const resolveCount = (p, look) =>
    look === 'lava' ? Math.max(1, Math.min(blobLimit, Math.round(p.blobCount) || 1)) : 1;

  // One scratch object reused for every read — see normalizeLavaParamsInto.
  const scratch = normalizeLavaParams(null);
  const readParams = () => normalizeLavaParamsInto(scratch, getParams ? getParams() : null);
  const boot = readParams();
  if (!ensureProgram(resolveLook(boot), resolveCount(boot, resolveLook(boot)))) {
    gl.deleteBuffer(quad);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return null;
  }

  // ---- mutable loop state (allocated once, mutated in place) ---------------
  let bufW = 0;
  let bufH = 0;
  let aspect = 1;
  let hasSize = false;
  let lastDpr = 0;

  let clock = 0; // seconds of rendered time; only advances while drawing
  let lastDraw = 0; // rAF timestamp of the last drawn frame; 0 = "first"
  let rafId = 0;
  let running = false;
  let onScreen = false;
  let awake = typeof document === 'undefined' ? true : !document.hidden;

  let ptrX = 0.5;
  let ptrY = 0.5;
  let ptrTargetX = 0.5;
  let ptrTargetY = 0.5;
  let influence = 0;
  let influenceTarget = 0;

  let statFrames = 0;
  let statSince = 0;

  // Analytic layout — a pure function of `clock`, never integrated. That is what
  // lets the loop stop off-screen and resume without desync, and it means a
  // resize can re-render the exact same instant.
  const writeBlobs = (p, count, phaseA) => {
    const px = ptrX * aspect;
    const py = ptrY;
    const swayAmount = p.swayAmount;
    const spread = p.spread;
    const mode = p.flowMode;
    const traverse = BASE_RISE * p.flowSpeed;
    const seed = p.seed;

    for (let i = 0; i < count; i++) {
      // Golden-ratio (low-discrepancy) offsets: for a handful of blobs this
      // spreads them far more evenly than a hash would, with no RNG state. The
      // seed just slides the whole sequence.
      const s1 = (i * 0.381966 + 0.31 + seed) % 1; // speed + size
      const s2 = (i * 0.7548777 + 0.13 + seed * 1.7) % 1; // phase + sway rate
      const s3 = (i * 0.618034 + 0.07 + seed * 2.3) % 1; // home position

      const rise = traverse * (1 + 0.39 * s1);
      // 0..1 along the traverse, used both for position and for the wrap fade.
      const cycle = ((((s2 + clock * rise * (1 / SPAN)) % 1) + 1) % 1);

      // Even spread collapses toward mid-band as `spread` goes to 0.
      const homeX = aspect * (0.5 + (0.08 + 0.84 * s3 - 0.5) * spread);
      const swayRate = (0.14 + 0.085 * s2) * p.swayRate;
      const sway = Math.sin(clock * swayRate + i * 2.4) * swayAmount;

      let x = homeX + sway;
      let y;
      // `wrapping` drives the fade envelope: only modes that jump a coordinate
      // back to the start need it, and applying it elsewhere would just dim blobs
      // for no reason.
      let wrapping = true;

      if (mode === 'fall') {
        y = (1 - cycle) * SPAN - PAD;
      } else if (mode === 'churn') {
        // Bobs up and down — no wrap, so no fade.
        y = 0.5 + Math.sin(cycle * TAU) * (0.35 + 0.7 * s1);
        wrapping = false;
      } else if (mode === 'drift') {
        // Horizontal traverse: x wraps instead of y, so the fade follows x.
        y = 0.5 + (s3 - 0.5) * 1.5;
        x =
          ((cycle + s1) % 1) * (aspect + 4) - 2 + Math.sin(clock * swayRate + i) * swayAmount * 0.35;
      } else if (mode === 'orbit') {
        const a = cycle * TAU + i * 1.3;
        y = 0.5 + Math.sin(a) * (0.4 + 0.5 * s1);
        x = homeX + Math.cos(a) * (0.9 + 1.6 * s2) * Math.max(swayAmount, 0.001);
        wrapping = false;
      } else if (mode === 'still') {
        y = 0.08 + 0.84 * s2;
        x = homeX;
        wrapping = false;
      } else {
        y = cycle * SPAN - PAD; // 'rise'
      }

      // Capped below 1: at 1.0 the factor touches zero and beyond it goes
      // NEGATIVE, which the shader clamps to ~0 - the blob would vanish and snap
      // back. Clamping the amplitude (not the waveform) keeps motion smooth.
      const breathe = Math.min(0.95, Math.max(0, p.breatheAmount));
      const r =
        (p.radiusBase + p.radiusSpread * s1) *
        (1 + breathe * Math.sin(clock * p.breatheRate + i * 1.7));

      // Fade the weight in and out at both ends of the traverse so the wrap is
      // invisible regardless of how big the blob has breathed.
      let w = 1;
      if (wrapping) {
        const edge = Math.min(1, Math.min(cycle, 1 - cycle) / FADE);
        w = edge * edge * (3 - 2 * edge);
      }

      if (influence > 0.001 && p.repelRadius > 0.001 && p.repelMode !== 'none') {
        const dx = x - px;
        const dy = y - py;
        const d = Math.sqrt(dx * dx + dy * dy) || 1e-4;
        const u = Math.min(1, d / p.repelRadius);
        // Same falloff and the same seven modes as the shader. Note the sign is
        // NOT inverted here: these are real object positions moving, a forward
        // transform, unlike the shader's inverse domain warp.
        const near = Math.pow(1 - u * u * (3 - 2 * u), Math.max(0.05, p.repelSoftness));
        const kick = near * p.repelPush * influence;
        const ux = dx / d;
        const uy = dy / d;
        const mode = p.repelMode;
        if (mode === 'attract') {
          x -= ux * kick;
          y -= uy * kick;
        } else if (mode === 'swirl') {
          x += -uy * kick;
          y += ux * kick;
        } else if (mode === 'bulge') {
          x += ux * kick * u;
          y += uy * kick * u;
        } else if (mode === 'pinch') {
          x -= ux * kick * u;
          y -= uy * kick * u;
        } else if (mode === 'ripple') {
          const wave = Math.sin(d * p.repelFreq - phaseA * 2);
          x += ux * kick * wave;
          y += uy * kick * wave;
        } else {
          x += ux * kick; // 'repel'
          y += uy * kick;
        }
        // Thin (or fatten, if repelThin is negative) rather than
        // shrink-to-nothing, so the field parts around the cursor instead of
        // blobs blinking out. Scales the wrap envelope — must not replace it, or a
        // wrapping blob pops back to full weight when the pointer nears.
        w *= 1 - p.repelThin * near * influence;
      }

      const o = i * 4;
      blobData[o] = x;
      blobData[o + 1] = y;
      blobData[o + 2] = r;
      blobData[o + 3] = w;
    }
  };

  const renderFrame = () => {
    if (dead || !hasSize) return;
    const p = readParams();
    const look = resolveLook(p);
    const count = resolveCount(p, look);
    if (!ensureProgram(look, count)) return;

    const k = Math.max(0, p.intensity);
    // Shared with uPhase.x below so a lava ripple and a procedural ripple move in
    // step rather than drifting apart.
    const phaseA = (clock * p.fieldSpeed * 0.55) % TAU;
    if (look === 'lava') writeBlobs(p, count, phaseA);
    else blobData.fill(0); // unused by this look; keep the uniform deterministic

    // CSS angles measure clockwise from "to top", so linear-gradient(Ndeg, ...)
    // runs along (sin, -cos) in screen space, flipped here into WebGL's y-up UV.
    const rad = (p.rampAngle * Math.PI) / 180;
    const dirX = Math.sin(rad);
    const dirY = -Math.cos(rad);
    const gradLen = Math.abs(aspect * dirX) + Math.abs(dirY);

    // Every phase is wrapped HERE rather than in GLSL, so no shader sin()/fract()
    // ever sees a large argument — see the mediump note at the top of this file.
    const fs = p.fieldSpeed;
    gl.uniform1f(uni.aspect, aspect);
    gl.uniform1f(uni.intensity, k);
    gl.uniform4f(uni.ramp, dirX, dirY, p.rampMid, gradLen);
    gl.uniform2f(uni.rampWave, (clock * p.rampBreatheRate) % TAU, p.rampBreathe * k);
    gl.uniform4f(uni.field, Math.max(0.1, p.kernelPower), p.fieldLo, p.fieldHi, p.bias);
    gl.uniform4f(
      uni.field2,
      p.fieldScale,
      Math.max(0.05, p.fieldSharpness),
      p.fieldDetail,
      // Particle rise phase, wrapped mod 1 so the shader's fract() is seamless.
      (((clock * fs * 0.09) % 1) + 1) % 1
    );
    gl.uniform4f(
      uni.phase,
      phaseA,
      (clock * fs * 0.41 + 1.3) % TAU,
      (clock * fs * 0.73 + 2.6) % TAU,
      (clock * fs * 0.31 + 4.1) % TAU
    );
    gl.uniform4f(uni.resp, p.hueShift, p.valueDepth, p.satDepth, p.glow);
    gl.uniform2f(uni.resp2, p.rim, p.dither ? 1 : 0);
    gl.uniform4f(
      uni.warp,
      p.warpAmount,
      p.warpScale,
      (clock * p.warpSpeed) % TAU,
      (clock * p.warpSpeed * 0.73 + 1.7) % TAU
    );
    // The CPU blob sim already displaces lava centres, so the shader-side domain
    // warp is only for the procedural looks — passing influence 0 for lava keeps the
    // two from doubling up.
    gl.uniform4f(uni.ptr, ptrX * aspect, ptrY, look === 'lava' ? 0 : influence, p.repelRadius);
    gl.uniform4f(
      uni.ptr2,
      REPEL_INDEX[p.repelMode] ?? 0,
      p.repelPush,
      p.repelFreq,
      p.repelSoftness
    );
    const bg = parseHex(p.bgColor);
    gl.uniform4f(uni.bg, bg[0], bg[1], bg[2], Math.max(0, Math.min(1, p.bgMix)));
    const a = parseHex(p.colorA);
    const b = parseHex(p.colorB);
    const c = parseHex(p.colorC);
    gl.uniform3f(uni.colorA, a[0], a[1], a[2]);
    gl.uniform3f(uni.colorB, b[0], b[1], b[2]);
    gl.uniform3f(uni.colorC, c[0], c[1], c[2]);
    gl.uniform4fv(uni.blobs, blobData);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  const loop = (now) => {
    rafId = requestAnimationFrame(loop);
    const p = readParams();
    const interval = 1000 / Math.max(1, p.fps);
    if (lastDraw === 0) lastDraw = now - interval; // draw immediately on start
    const since = now - lastDraw;
    if (since < interval) return; // frame cap
    // Charge only whole intervals so the cadence does not drift off `fps`.
    lastDraw = now - (since % interval);

    // Clamped so a resumed tab advances the animation by one frame, not by the
    // whole time it spent hidden.
    const dt = Math.min(since / 1000, 0.1);
    clock += dt;

    // Exponential smoothing: frame-rate independent, so the ease feels the same at
    // fps 15 and fps 120. Separate attack/release so "notices you" and "forgets
    // you" can be tuned apart.
    const tau = Math.max(0.02, (influenceTarget > influence ? p.attackMs : p.releaseMs) / 1000);
    influence += (influenceTarget - influence) * (1 - Math.exp(-dt / tau));
    const pk = 1 - Math.exp(-dt / 0.1);
    ptrX += (ptrTargetX - ptrX) * pk;
    ptrY += (ptrTargetY - ptrY) * pk;

    // dpr slider moved: re-size the drawing buffer before drawing into it.
    if (Math.max(1, Math.min(3, p.dprCap)) !== lastDpr) resize();
    renderFrame();

    if (onStats) {
      statFrames++;
      if (now - statSince > 250) {
        onStats({ fps: Math.round((statFrames * 1000) / (now - statSince)), blobLimit });
        statFrames = 0;
        statSince = now;
      }
    }
  };

  const start = () => {
    if (running || dead) return;
    running = true;
    lastDraw = 0;
    statSince = 0;
    statFrames = 0;
    rafId = requestAnimationFrame(loop);
  };
  const stop = () => {
    if (!running) return;
    running = false;
    cancelAnimationFrame(rafId);
    rafId = 0;
  };
  const sync = () => {
    if (onScreen && awake) start();
    else stop();
  };

  const resize = () => {
    if (dead) return;
    // Recorded before the zero-size bail so an unsized canvas cannot make the loop
    // re-enter resize on every single frame.
    const cap = Math.max(1, Math.min(3, readParams().dprCap));
    lastDpr = cap;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (cw <= 0 || ch <= 0) {
      // Laid out at zero (hidden parent, mid-transition): nothing to size, and
      // bailing here is what keeps us out of a divide-by-zero.
      hasSize = false;
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, cap);
    const w = Math.max(1, Math.round(cw * dpr));
    const h = Math.max(1, Math.round(ch * dpr));
    hasSize = true;
    if (w === bufW && h === bufH) return; // RO fires on no-op layout too
    bufW = w;
    bufH = h;
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    aspect = w / h;
    // Resizing clears the drawing buffer to opaque black, so repaint now even if
    // the loop is parked — otherwise an off-screen resize could composite as a
    // black band on the way back in.
    renderFrame();
  };

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  const io = new IntersectionObserver(
    ([entry]) => {
      onScreen = entry?.isIntersecting ?? false;
      sync();
    },
    { root: null, threshold: 0, rootMargin: '120px 0px' }
  );
  io.observe(canvas);

  const onVisibility = () => {
    awake = !document.hidden;
    sync();
  };
  document.addEventListener('visibilitychange', onVisibility);

  // The band itself is the pointer target — the canvas only fills it. All
  // listeners are passive and nothing calls preventDefault, so touch scrolling
  // over the band is untouched.
  const target = pointerTarget || canvas.parentElement || canvas;
  const onPointerMove = (event) => {
    // Measured per move rather than cached: this band lives inside a scroll-driven
    // stacked-card section, so a cached rect goes stale the moment the page moves.
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    ptrTargetX = (event.clientX - rect.left) / rect.width;
    ptrTargetY = 1 - (event.clientY - rect.top) / rect.height; // UV is y-up
    if (influence < 0.02) {
      // First contact after an exit: snap, so the pointer does not visibly swoop
      // across the band from wherever it left last time.
      ptrX = ptrTargetX;
      ptrY = ptrTargetY;
    }
    influenceTarget = 1;
  };
  const onPointerOut = () => {
    influenceTarget = 0;
  };
  target.addEventListener('pointermove', onPointerMove, { passive: true });
  target.addEventListener('pointerleave', onPointerOut, { passive: true });
  target.addEventListener('pointercancel', onPointerOut, { passive: true });

  return {
    blobLimit,
    // Repaint on demand while the loop is parked (used by the panel so a slider
    // still updates a preview that is scrolled out of view).
    requestDraw: renderFrame,
    destroy() {
      dead = true;
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      target.removeEventListener('pointermove', onPointerMove);
      target.removeEventListener('pointerleave', onPointerOut);
      target.removeEventListener('pointercancel', onPointerOut);
      gl.deleteBuffer(quad);
      if (program) gl.deleteProgram(program);
      // Free the GPU allocation immediately instead of waiting for GC to collect
      // the canvas.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
