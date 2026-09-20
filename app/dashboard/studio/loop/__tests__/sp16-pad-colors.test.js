import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SP16_PAD_COLORS, EMPTY_PAD,
  padColor, padSurface, padBorder, mixHex,
} from '../sp16-pad-colors.js';

// ── WCAG contrast math (implemented here on purpose — the test must not
//    trust the source module's own idea of contrast) ──────────────────────

const HEX6 = /^#[0-9a-f]{6}$/;

function toRgb(hex) {
  const s = String(hex).replace('#', '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

function relativeLuminance(hex) {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

test('contrastRatio: sanity — black on white is 21:1, a color on itself is 1:1', () => {
  assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 1e-6);
  assert.ok(Math.abs(contrastRatio('#f5600a', '#f5600a') - 1) < 1e-9);
});

// ── spectrum shape ───────────────────────────────────────────────────────

test('SP16_PAD_COLORS: exactly 16 entries, one per hardware pad', () => {
  assert.equal(SP16_PAD_COLORS.length, 16);
});

test('SP16_PAD_COLORS: every entry has a name, numeric hue and valid 6-digit hex base/glow/edge', () => {
  SP16_PAD_COLORS.forEach((pad, i) => {
    assert.equal(typeof pad.name, 'string', `pad ${i + 1} name`);
    assert.equal(pad.name, pad.name.toLowerCase(), `pad ${i + 1} name is lowercase`);
    assert.ok(Number.isFinite(pad.hue), `pad ${i + 1} hue is a number`);
    assert.match(pad.base, HEX6, `pad ${i + 1} base`);
    assert.match(pad.glow, HEX6, `pad ${i + 1} glow`);
    assert.match(pad.edge, HEX6, `pad ${i + 1} edge`);
  });
});

test('SP16_PAD_COLORS: the bloom ramp runs light center -> base -> deep edge', () => {
  SP16_PAD_COLORS.forEach((pad, i) => {
    const glow = relativeLuminance(pad.glow);
    const base = relativeLuminance(pad.base);
    const edge = relativeLuminance(pad.edge);
    assert.ok(glow > base, `pad ${i + 1} (${pad.name}): glow should be lighter than base`);
    assert.ok(edge < base, `pad ${i + 1} (${pad.name}): edge should be deeper than base`);
  });
});

// ── ink legibility ───────────────────────────────────────────────────────

test('SP16_PAD_COLORS: ink is #1a1a1a or #fff and clears WCAG AA (>= 4.5:1) on base', () => {
  SP16_PAD_COLORS.forEach((pad, i) => {
    assert.ok(['#1a1a1a', '#fff'].includes(pad.ink), `pad ${i + 1} ink is one of the two allowed values`);
    const ratio = contrastRatio(pad.base, pad.ink === '#fff' ? '#ffffff' : pad.ink);
    assert.ok(
      ratio >= 4.5,
      `pad ${i + 1} (${pad.name}): ink ${pad.ink} on ${pad.base} is ${ratio.toFixed(2)}:1, needs >= 4.5:1`,
    );
  });
});

test('SP16_PAD_COLORS: ink is the better of the two options for its base', () => {
  SP16_PAD_COLORS.forEach((pad, i) => {
    const dark = contrastRatio(pad.base, '#1a1a1a');
    const white = contrastRatio(pad.base, '#ffffff');
    const expected = dark >= white ? '#1a1a1a' : '#fff';
    assert.equal(pad.ink, expected, `pad ${i + 1} (${pad.name}) should use ${expected}`);
  });
});

// ── padColor lookup ──────────────────────────────────────────────────────

test('padColor: 1-16 map to index 0-15; out of range is null', () => {
  assert.equal(padColor(1), SP16_PAD_COLORS[0]);
  assert.equal(padColor(16), SP16_PAD_COLORS[15]);
  assert.equal(padColor(0), null);
  assert.equal(padColor(17), null);
  assert.equal(padColor(NaN), null);
  assert.equal(padColor(2.5), null);
});

// ── padSurface ───────────────────────────────────────────────────────────

test('padSurface: pads 1-16 each return a four-stop radial-gradient in their own hue', () => {
  const seen = new Set();
  for (let pad = 1; pad <= 16; pad += 1) {
    const surface = padSurface(pad);
    assert.match(surface, /^radial-gradient\(circle at 50% 42%, /, `pad ${pad} gradient shape`);
    assert.ok(surface.includes(`${SP16_PAD_COLORS[pad - 1].base} 88%`), `pad ${pad} carries its base stop`);
    assert.ok(
      ['0%', '45%', '88%', '100%'].every((stop) => surface.includes(stop)),
      `pad ${pad} has all four stops`,
    );
    seen.add(surface);
  }
  assert.equal(seen.size, 16, 'every pad surface is distinct');
});

test('padSurface: out-of-range pad numbers return the same neutral dark gradient', () => {
  const neutral = padSurface(0);
  assert.match(neutral, /^radial-gradient\(/);
  assert.ok(neutral.includes(EMPTY_PAD.base), 'neutral gradient uses the empty-pad base');
  assert.ok(neutral.includes(EMPTY_PAD.edge), 'neutral gradient uses the empty-pad edge');
  assert.equal(padSurface(17), neutral);
  assert.equal(padSurface(NaN), neutral);
  assert.equal(padSurface(undefined), neutral);
  // and it must not be any lit pad's surface
  for (let pad = 1; pad <= 16; pad += 1) assert.notEqual(padSurface(pad), neutral);
});

test('padSurface: active and dim each differ from the default and from each other', () => {
  for (let pad = 1; pad <= 16; pad += 1) {
    const base = padSurface(pad);
    const active = padSurface(pad, { active: true });
    const dim = padSurface(pad, { dim: true });
    assert.notEqual(active, base, `pad ${pad}: active should differ from default`);
    assert.notEqual(dim, base, `pad ${pad}: dim should differ from default`);
    assert.notEqual(active, dim, `pad ${pad}: active should differ from dim`);
    assert.match(active, /^radial-gradient\(/);
    assert.match(dim, /^radial-gradient\(/);
  }
});

test('padSurface: dim recedes toward the panel ground, active pushes brighter', () => {
  const pad = 7; // green
  const stops = (s) => s.match(/#[0-9a-f]{6}/g);
  const baseMid = relativeLuminance(stops(padSurface(pad))[1]);
  const dimMid = relativeLuminance(stops(padSurface(pad, { dim: true }))[1]);
  const activeMid = relativeLuminance(stops(padSurface(pad, { active: true }))[1]);
  assert.ok(dimMid < baseMid, 'dim pad is darker than lit');
  assert.ok(activeMid > baseMid, 'active pad is brighter than lit');
});

// ── padBorder ────────────────────────────────────────────────────────────

test('padBorder: identity hue at partial alpha when idle, bloom center when active', () => {
  for (let pad = 1; pad <= 16; pad += 1) {
    const idle = padBorder(pad, false);
    assert.match(idle, /^rgba\(\d{1,3},\d{1,3},\d{1,3},0\.55\)$/, `pad ${pad} idle border`);
    assert.equal(padBorder(pad, true), SP16_PAD_COLORS[pad - 1].glow);
  }
});

test('padBorder: out-of-range pads get a neutral translucent border', () => {
  assert.equal(padBorder(0, false), 'rgba(255,255,255,0.10)');
  assert.equal(padBorder(17, true), 'rgba(255,255,255,0.10)');
  assert.equal(padBorder(NaN, false), 'rgba(255,255,255,0.10)');
});

// ── EMPTY_PAD ────────────────────────────────────────────────────────────

test('EMPTY_PAD: dark, hueless, with low-contrast ink', () => {
  assert.equal(EMPTY_PAD.base, '#17181d');
  assert.equal(EMPTY_PAD.edge, '#0d0e12');
  assert.equal(EMPTY_PAD.ink, 'rgba(255,255,255,0.32)');
  assert.ok(relativeLuminance(EMPTY_PAD.edge) < relativeLuminance(EMPTY_PAD.base));
});

// ── mixHex ───────────────────────────────────────────────────────────────

test('mixHex: endpoints, midpoint and clamping', () => {
  assert.equal(mixHex('#000000', '#ffffff', 0), '#000000');
  assert.equal(mixHex('#000000', '#ffffff', 1), '#ffffff');
  assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mixHex('#000000', '#ffffff', -1), '#000000'); // clamped
  assert.equal(mixHex('#000000', '#ffffff', 2), '#ffffff'); // clamped
  assert.equal(mixHex('#000000', '#ffffff', NaN), '#000000'); // non-finite -> t=0
});
