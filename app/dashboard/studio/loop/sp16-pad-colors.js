// Loop Studio — the Pioneer Toraiz SP-16 hardware pad color spectrum, used by
// the SP-16 pad grid so an assigned pad lights up in the same color the
// physical unit lights it. Same standalone-module tier as workbench-view.js:
// no React, no DOM, no imports — every export is a plain value or a pure
// function of primitive arguments, directly testable under node:test.
//
// ⚠️ Colors key to pad NUMBER, never to screen position. The hardware's pad 1
// is BOTTOM-left and counts upward; the on-screen grid renders pad 01 at the
// TOP-left. Indexing this table by pad number (not by row/column) is what
// keeps a given pad the same color on screen as it is under the player's
// hands. Index 0 = pad 1 ... index 15 = pad 16.
//
// Each lit pad on the hardware reads as a soft radial bloom on a rounded
// rectangle: a lighter, desaturated center falling off to the saturated hue at
// the edges. That's the three-stop `glow → base → edge` ramp below; `base` is
// the pad's identity color (borders, badges, legends) and `ink` is the label
// color that clears WCAG AA (>= 4.5:1) against it.

// ── Hardware spectrum ────────────────────────────────────────────────────
// Hues walk the wheel red → pink across the 4x4. Lightness is tuned per hue
// so every `base` clears 4.5:1 against its `ink` — the blue/indigo/violet
// band has to sit lighter than the yellows to get there, which is also how
// the real pads read (they bloom, they don't sit flat).

export const SP16_PAD_COLORS = [
  { name: 'red', hue: 0, base: '#f74545', glow: '#f6caca', edge: '#da0707', ink: '#1a1a1a' },
  { name: 'orange', hue: 22, base: '#f5600a', glow: '#efb99a', edge: '#9e3d05', ink: '#1a1a1a' },
  { name: 'amber', hue: 38, base: '#f59f0a', glow: '#efd09a', edge: '#9e6605', ink: '#1a1a1a' },
  { name: 'yellow', hue: 50, base: '#f5ce0a', glow: '#efe19a', edge: '#9e8505', ink: '#1a1a1a' },
  { name: 'yellow', hue: 58, base: '#f5ed0a', glow: '#efec9a', edge: '#9e9905', ink: '#1a1a1a' },
  { name: 'lime', hue: 80, base: '#a7f50a', glow: '#d2ef9a', edge: '#6b9e05', ink: '#1a1a1a' },
  { name: 'green', hue: 132, base: '#0af539', glow: '#9aefab', edge: '#059e24', ink: '#1a1a1a' },
  { name: 'teal', hue: 168, base: '#0af5c6', glow: '#9aefde', edge: '#059e80', ink: '#1a1a1a' },
  { name: 'cyan', hue: 186, base: '#0addf5', glow: '#9ae6ef', edge: '#058f9e', ink: '#1a1a1a' },
  { name: 'sky', hue: 200, base: '#0aa7f5', glow: '#9ad2ef', edge: '#056b9e', ink: '#1a1a1a' },
  { name: 'blue', hue: 218, base: '#4083f7', glow: '#cadbf6', edge: '#0752d5', ink: '#1a1a1a' },
  { name: 'indigo', hue: 248, base: '#8776f9', glow: '#d0caf6', edge: '#391bf8', ink: '#1a1a1a' },
  { name: 'violet', hue: 268, base: '#ab67f9', glow: '#dfcaf6', edge: '#7a0df8', ink: '#1a1a1a' },
  { name: 'purple', hue: 288, base: '#d240f7', glow: '#eecaf6', edge: '#ab07d5', ink: '#1a1a1a' },
  { name: 'magenta', hue: 312, base: '#f514c8', glow: '#f0a3e1', edge: '#a80588', ink: '#1a1a1a' },
  { name: 'pink', hue: 334, base: '#f7368a', glow: '#f5c2d8', edge: '#cb065b', ink: '#1a1a1a' },
];

/** The unassigned pad look: dark, no hue, low-contrast ink for the pad number. */
export const EMPTY_PAD = { base: '#17181d', edge: '#0d0e12', ink: 'rgba(255,255,255,0.32)' };

// ── Bloom tuning ────────────────────────────────────────────────────────

/** Panel ground an assigned-but-idle pad recedes toward. */
export const DIM_GROUND = '#16171c';
/** How far a dimmed pad mixes toward DIM_GROUND (0 = lit, 1 = invisible). */
export const DIM_MIX = 0.55;
/** How far an active pad mixes toward its own bloom center. */
export const ACTIVE_MIX = 0.38;
/** Shared bloom geometry — the highlight sits above center, as on the hardware. */
export const BLOOM_ORIGIN = 'circle at 50% 42%';
/** How far the mid stop sits from the bloom center toward the identity hue. */
export const BLOOM_MID_MIX = 0.55;

// ── Color math (pure, no dependencies) ──────────────────────────────────

function parseHex(hex) {
  const s = String(hex).replace('#', '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function toHex(rgb) {
  return `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

/** Linear blend of two hex colors; `t` = 0 returns `a`, `t` = 1 returns `b`. */
export function mixHex(a, b, t) {
  const amt = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  const from = parseHex(a);
  const to = parseHex(b);
  return toHex(from.map((v, i) => v + (to[i] - v) * amt));
}

// ── Pad lookup ───────────────────────────────────────────────────────────

/** The color entry for pad 1-16, or `null` for any out-of-range / non-integer pad number. */
export function padColor(padNumber) {
  const n = Number(padNumber);
  if (!Number.isInteger(n) || n < 1 || n > SP16_PAD_COLORS.length) return null;
  return SP16_PAD_COLORS[n - 1];
}

// ── Rendered pad surfaces ────────────────────────────────────────────────

/**
 * The CSS `background` for a pad face: a three-stop radial bloom
 * (`glow` center → `base` → `edge` falloff).
 *
 * - default   — the pad lit at its hardware color.
 * - `dim`     — assigned but idle: the same ramp mixed toward the panel ground,
 *               so the hue still reads but the pad isn't shouting.
 * - `active`  — currently triggered: the ramp brightened toward its own bloom.
 *
 * Pad numbers are 1-16; anything else returns the neutral EMPTY_PAD gradient.
 */
export function padSurface(padNumber, { active = false, dim = false } = {}) {
  const pad = padColor(padNumber);
  if (!pad) {
    return `radial-gradient(${BLOOM_ORIGIN}, ${EMPTY_PAD.base} 0%, ${EMPTY_PAD.base} 55%, ${EMPTY_PAD.edge} 100%)`;
  }
  let glow = pad.glow;
  let base = pad.base;
  let edge = pad.edge;
  if (dim) {
    glow = mixHex(glow, DIM_GROUND, DIM_MIX);
    base = mixHex(base, DIM_GROUND, DIM_MIX);
    edge = mixHex(edge, DIM_GROUND, DIM_MIX);
  }
  if (active) {
    glow = mixHex(glow, pad.glow, ACTIVE_MIX);
    base = mixHex(base, pad.glow, ACTIVE_MIX);
    edge = mixHex(edge, pad.base, ACTIVE_MIX);
  }
  // Four stops, not three: the real pads read pastel because the bloom holds
  // most of the face and the saturated hue only arrives at the falloff. A
  // straight glow→base ramp lands far more neon than the hardware.
  const bloom = mixHex(glow, base, BLOOM_MID_MIX);
  return `radial-gradient(${BLOOM_ORIGIN}, ${glow} 0%, ${bloom} 45%, ${base} 88%, ${edge} 100%)`;
}

/**
 * Border color for a pad face — the bloom center when the pad is active (it
 * reads as a rim light), otherwise the identity hue held back to 55% so the
 * border frames the pad instead of ringing it.
 */
export function padBorder(padNumber, active) {
  const pad = padColor(padNumber);
  if (!pad) return 'rgba(255,255,255,0.10)';
  if (active) return pad.glow;
  const [r, g, b] = parseHex(pad.base);
  return `rgba(${r},${g},${b},0.55)`;
}
