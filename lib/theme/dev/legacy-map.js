// Exact legacy literal -> token map (contract §10.4 rule 1) used by the codemod.
// Only EXACT matches are rewritten; anything ambiguous or without an exact token
// is reported instead. Dev tooling only.

import { parseLiteral, kebab } from './scan-literals.js';

const TEXT_PROPS = new Set(['color', 'fill', 'stroke', 'stop-color', 'caret-color', 'text-decoration-color']);

function fmtPct(a) {
  const v = Math.round(a * 10000) / 100;
  return `${v}%`;
}

const mix = (token, a) => `color-mix(in srgb, var(${token}) ${fmtPct(a)}, transparent)`;

// opaque rgb -> token (exact baseline light values; asserted by legacy-map.test)
const OPAQUE = new Map([
  ['42,36,32', '--t-text'],
  ['10,10,10', '--t-text-strong'],
  ['26,26,26', '--t-text-body'],
  ['250,247,242', '--t-text-inverse'],
  ['40,95,59', '--t-success'],
  ['74,158,92', '--t-success-solid'],
  ['103,83,61', '--t-warning'],
  ['212,168,67', '--t-warning-solid'],
  ['159,31,23', '--t-danger'],
  ['29,78,216', '--t-info'],
  ['47,111,237', '--t-info-solid'],
]);

// literals that need a human decision: key -> suggestions
const AMBIGUOUS_OPAQUE = new Map([
  ['215,25,33', ['--t-danger-solid (status)', '--t-dash-accent (dashboard brand highlight)']],
  ['245,241,223', ['--t-chrome (carries alpha .55 in the baseline) or --t-chrome-strong']],
  ['231,217,195', ['--t-glass-border is rgba(212,196,171,.82), not exactly #e7d9c3']],
]);

const INK_ALPHA = new Map([
  [0.08, '--t-border-faint'],
  [0.12, '--t-border-subtle'],
  [0.22, '--t-control-border'],
  [0.38, '--t-text-faint'],
  [0.52, '--t-text-muted'],
  [0.72, '--t-text-secondary'],
]);

const WHITE_ALPHA = new Map([
  [0.5, '--t-glass-soft'],
  [0.62, '--t-glass'],
  [0.78, '--t-glass-strong'],
]);

const COMET_HSL = [
  [185, 100, 58], [200, 100, 62], [225, 100, 64], [250, 100, 66],
  [275, 100, 66], [300, 100, 68], [320, 80, 80],
];

const same = (a, b) => Math.abs(a - b) < 1e-9;

/**
 * @param literal   the literal text
 * @param property  CSS/JSX property it appears in (any casing), or null
 * @returns { status:'mapped', replacement, token } | { status:'ambiguous'|'unmapped', suggestions? }
 */
export function mapLiteral(literal, property = null) {
  const prop = kebab(property);
  const p = parseLiteral(literal);
  if (!p) return { status: 'unmapped' };

  if (p.space === 'rgb') {
    const key = `${p.r},${p.g},${p.b}`;
    const a = p.a;
    if (same(a, 1)) {
      if (key === '255,255,255') {
        if (TEXT_PROPS.has(prop) || prop.startsWith('--')) {
          return { status: 'ambiguous', suggestions: ['--t-on-accent (text on an accent fill)', '--t-on-solid (text on a status fill)', '--t-surface (a white fill)'] };
        }
        return { status: 'mapped', token: '--t-surface', replacement: 'var(--t-surface)' };
      }
      if (OPAQUE.has(key)) {
        const token = OPAQUE.get(key);
        return { status: 'mapped', token, replacement: `var(${token})` };
      }
      if (AMBIGUOUS_OPAQUE.has(key)) return { status: 'ambiguous', suggestions: AMBIGUOUS_OPAQUE.get(key) };
      if (key === '0,0,0') return { status: 'ambiguous', suggestions: ['--t-text-default (UA black text)', '--t-text-strong'] };
      return { status: 'unmapped' };
    }
    // translucent
    if (key === '42,36,32') {
      for (const [alpha, token] of INK_ALPHA) if (same(a, alpha)) return { status: 'mapped', token, replacement: `var(${token})` };
      return { status: 'mapped', token: '--t-text', replacement: mix('--t-text', a) };
    }
    if (key === '255,255,255') {
      if (same(a, 0.45) && prop === 'box-shadow') return { status: 'mapped', token: '--t-glass-highlight', replacement: 'var(--t-glass-highlight)' };
      for (const [alpha, token] of WHITE_ALPHA) if (same(a, alpha)) return { status: 'mapped', token, replacement: `var(${token})` };
      return { status: 'mapped', token: '--t-surface', replacement: mix('--t-surface', a) };
    }
    if (key === '26,26,26') return { status: 'mapped', token: '--t-text-body', replacement: mix('--t-text-body', a) };
    if (key === '90,83,70') return { status: 'mapped', token: '--t-text-eyebrow', replacement: mix('--t-text-eyebrow', a) };
    if (key === '0,0,0') return { status: 'mapped', token: '--t-text-strong', replacement: mix('--t-text-strong', a) };
    if (key === '212,196,171' && same(a, 0.82)) return { status: 'mapped', token: '--t-glass-border', replacement: 'var(--t-glass-border)' };
    if (key === '22,20,18' && same(a, 0.42)) return { status: 'mapped', token: '--t-overlay', replacement: 'var(--t-overlay)' };
    if (key === '245,241,223') {
      if (same(a, 0.55)) return { status: 'mapped', token: '--t-chrome', replacement: 'var(--t-chrome)' };
      if (same(a, 0.85)) return { status: 'mapped', token: '--t-chrome-strong', replacement: 'var(--t-chrome-strong)' };
      if (same(a, 0.08)) return { status: 'mapped', token: '--t-scene-wash', replacement: 'var(--t-scene-wash)' };
      return { status: 'ambiguous', suggestions: ['--t-chrome tokens bake in their alpha, so color-mix cannot be used; pick a token or keep the literal'] };
    }
    return { status: 'unmapped' };
  }

  // hsl / hsla
  const { h, s, l, a } = p;
  if (same(a, 1)) {
    if (h === 185 && s === 100 && l === 45) return { status: 'mapped', token: '--t-accent-bright', replacement: 'var(--t-accent-bright)' };
    if (h === 262 && s === 100 && l === 55) return { status: 'mapped', token: '--t-support-1', replacement: 'var(--t-support-1)' };
    if (h === 314 && s === 100 && l === 50) return { status: 'mapped', token: '--t-support-2', replacement: 'var(--t-support-2)' };
    return { status: 'unmapped' };
  }
  const idx = COMET_HSL.findIndex(([ch, cs, cl]) => ch === h && cs === s && cl === l);
  if (idx >= 0) {
    const token = `--t-comet-${idx + 1}`;
    return { status: 'mapped', token, replacement: mix(token, a) };
  }
  return { status: 'unmapped' };
}
