// Homepage particle math — Phase 3 (docs/plans/ORIGINAL-STUDIO-CINEMATIC-SETS-
// 4K-PLAN.md: "Extract/adapt the homepage particle math without changing
// homepage behavior"). Pure logic, no React/three.js/R3F — ox.jsx's
// `ParticleSwarm` computes the identical formula inline, per-frame, coupled
// to React-Three-Fiber's `useFrame`/`instancedMesh`; this module lifts JUST
// the math (stereographic projection of a Clifford torus + wave distortion +
// HSL color) into a standalone, independently testable function so a second,
// non-R3F consumer (a raw-three.js Studio factory — see factories.js) can
// drive the exact same visual formula without depending on R3F at all.
//
// ox.jsx itself is INTENTIONALLY left byte-for-byte untouched by this
// module's existence — this file mirrors its math (documented per-line
// below against ox.jsx's own line numbers) rather than ox.jsx importing
// this file, so there is zero risk of a homepage regression from this
// extraction. If ox.jsx is ever refactored to import this module instead of
// keeping its own inline copy, that is a deliberate, separate, visually-
// verified follow-up — not implied or required by this file's existence.
//
// The Studio hero is a SEPARATE, much smaller-scale scene (camera z=2.6,
// frustum half-extents on the order of ~1 world unit) than the homepage's
// particle canvas (camera z=100, particles spread ±60 world units) — this
// module's `scale`-family params are NOT assumed to carry over 1:1; a Studio
// factory consuming this is expected to pass its OWN, much smaller `scale`.

const GOLDEN_ANGLE = 2.39996322972865332;

// Mirrors ox.jsx's ParticleSwarm `defaultParams` (lines 64-94) exactly,
// value for value — the one deliberate exception is `particleCount`, left
// out here since a Studio factory's own quality-tier/budget system (see
// elements/quality.js) is what should decide instance count, not this
// shared-math module.
export const DEFAULT_PARTICLE_PARAMS = {
  scale: 55,
  chaos: 0.8,
  flow: 0.6,
  particleSize: 0.3,
  speedMult: 0.1,
  hueSpeed: 0.02,
  waveAmplitude: 3,
  saturation: 0.85,
  lightness: 0.5,
  torusMajorRadius: 1,
  torusTubeRadius: 0.2,
  torusPulse: 1,
  animationSpeed: 1.0,
  hueOffset: 0,
};

/**
 * The per-particle stereographic-projection + wave-distortion position for
 * particle `index` of `count`, at simulation `time` (seconds, already
 * multiplied by speedMult/animationSpeed upstream — see simTime below),
 * under `params` (merged over DEFAULT_PARTICLE_PARAMS). Mirrors ox.jsx lines
 * 279-304 exactly: a Clifford-torus point in 4D (x4,y4,z4,w4), stereographic-
 * projected to 3D via `d = 2 - w4`, then displaced by a sin/cos wave field
 * driven by `chaos`/`waveAmplitude`. Returns `{ x, y, z }` — NOT smoothed
 * toward a previous frame's position; see lerpTowardTarget for that
 * (deliberately separate so this function stays a pure, stateless formula).
 */
export function computeParticleTarget(index, count, time, params = {}) {
  const p = { ...DEFAULT_PARTICLE_PARAMS, ...params };
  const t = index * (1 / count);
  const timeFlow05 = time * p.flow * 0.5;
  const time04 = time * 0.4;
  const time07 = time * 0.7;
  const u = index * GOLDEN_ANGLE + timeFlow05;
  const phi = Math.acos(1 - 2 * t);
  const v = phi * 2 + time04;

  const pulse = p.torusPulse ?? 1;
  const R = p.torusMajorRadius;
  const r = p.torusTubeRadius;
  const r1 = R + r * 0.2 * Math.sin(time * 0.5) * pulse;

  const cu = Math.cos(u);
  const su = Math.sin(u);
  const cv = Math.cos(v);
  const sv = Math.sin(v);

  const x4 = r1 * cu;
  const y4 = r1 * su;
  const z4 = r * cv;
  const w4 = r * sv;

  const d = 2 - w4;
  const x = x4 / d;
  const y = y4 / d;
  const z = z4 / d;

  const chaos = p.chaos;
  const waveAmp = p.waveAmplitude;
  const waveAmpY = waveAmp * (pulse > 0 ? Math.sin(time * 0.3) : 1);
  const waveZ = Math.cos(time04);
  const wave = Math.sin(x * 5 + time) * Math.cos(y * 5 - time07) * chaos;

  const scale = p.scale;
  return {
    x: x * scale + wave * waveAmp,
    y: y * scale + wave * waveAmpY,
    z: z * scale * 0.8 + wave * waveZ,
    wave, // exposed — computeParticleColor's hue jitter needs the same `wave` this position used, not a recomputed one
  };
}

/** Exponential-smoothing step from `current` toward `target` — mirrors ox.jsx's per-frame lerp (line 310-312: `positions[i] + (target - positions[i]) * lerp`), kept as its own composable step so computeParticleTarget stays stateless. */
export function lerpTowardTarget(current, target, factor) {
  return current + (target - current) * factor;
}

/**
 * HSL color for particle `index`, at simulation `time`, given the SAME
 * `wave` value computeParticleTarget produced for this particle this frame
 * (ox.jsx recomputes `wave` a second time for color, line 306 vs 300 — same
 * formula, so passing it through instead avoids a second Math.sin/cos pass
 * and guarantees the two can never drift out of sync). Mirrors ox.jsx lines
 * 306-307. Returns `{ h, s, l }`, each in [0,1) — convert with hslToRgb
 * below for a factory that needs RGB.
 */
export function computeParticleColor(index, count, time, wave, params = {}) {
  const p = { ...DEFAULT_PARTICLE_PARAMS, ...params };
  const t = index * (1 / count);
  const timeHue = time * p.hueSpeed;
  const hue = (p.hueOffset + t * 0.8 + timeHue + wave * 0.05) % 1;
  return { h: hue < 0 ? hue + 1 : hue, s: p.saturation, l: p.lightness + wave * 0.15 };
}

/** Standard HSL -> [0,1]-range RGB conversion (no three.js dependency, so this module stays framework-free — a factory with a real THREE.Color can use this or THREE.Color.setHSL identically, they agree by construction). */
export function hslToRgb(h, s, l) {
  if (s === 0) return { r: l, g: l, b: l };
  const hue2rgb = (p, q, tt) => {
    let x = tt;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const pp = 2 * l - q;
  return {
    r: hue2rgb(pp, q, h + 1 / 3),
    g: hue2rgb(pp, q, h),
    b: hue2rgb(pp, q, h - 1 / 3),
  };
}
