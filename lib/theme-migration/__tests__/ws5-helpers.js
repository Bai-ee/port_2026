// Shared helpers for the WS5 (CSS migration) tests. Not a test file: the repo's test glob only
// picks up *.test.js. Pure Node, no dependencies.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASELINE_DEFINITION } from '../../theme/baseline.js';
import { resolveTheme } from '../../theme/resolve.js';
import { hslToSrgb01 } from '../../theme/color.js';
import { parseLiteral } from '../../theme/dev/scan-literals.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Every stylesheet WS5 owns (contract section 2), as repo-relative paths. */
export const OWNED_CSS = [
  'colors.css',
  ...fs.readdirSync(path.join(ROOT, 'styles/dashboard'))
    .filter((f) => /^\d\d-.*\.css$/.test(f))
    .sort()
    .map((f) => `styles/dashboard/${f}`),
  'styles/brain-builder.css',
];
export const BRIDGE_CSS = 'styles/theme/bridge.css';
export const GENERATED_CSS = 'styles/theme/theme.generated.css';

export const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
export const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Minimal CSS rule walker: returns [{ selector, atRules, decls: [{ name, value }] }] for every
 * rule that directly contains declarations. Handles @media/@supports nesting; ignores comments.
 */
export function parseRules(css) {
  const text = stripComments(css);
  const rules = [];
  const stack = [];
  let buf = '';
  let declBuf = '';
  const flushDecls = () => {
    const top = stack[stack.length - 1];
    if (top && !top.at) {
      for (const part of splitDecls(declBuf)) top.decls.push(part);
    }
    declBuf = '';
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') {
      flushDecls();
      const selector = buf.replace(/\s+/g, ' ').trim();
      const node = { selector, at: selector.startsWith('@'), decls: [] };
      stack.push(node);
      buf = '';
    } else if (ch === '}') {
      flushDecls();
      const node = stack.pop();
      if (node && !node.at && node.decls.length) {
        rules.push({ selector: node.selector, atRules: stack.filter((s) => s.at).map((s) => s.selector), decls: node.decls });
      }
      buf = '';
    } else {
      buf += ch;
      declBuf += ch;
    }
  }
  return rules;
}

function splitDecls(block) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of block) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ';' && depth === 0) {
      push(cur);
      cur = '';
    } else cur += ch;
  }
  push(cur);
  return out;
  function push(s) {
    const m = /^\s*(-{0,2}[A-Za-z_][\w-]*)\s*:\s*([\s\S]*?)\s*$/.exec(s);
    if (m) out.push({ name: m[1], value: m[2].replace(/\s+/g, ' ') });
  }
}

/** All `--t-*` references (var() form) in a CSS text, comments excluded. */
export function tokenRefs(css) {
  return [...stripComments(css).matchAll(/var\(\s*(--t-[a-z0-9]+(?:-[a-z0-9]+)*)/g)].map((m) => m[1]);
}

// ---- resolved theme (production baseline) -------------------------------------------------

const resolvedCache = {};
export function tokensFor(mode) {
  resolvedCache[mode] ||= resolveTheme(BASELINE_DEFINITION, mode).tokens;
  return resolvedCache[mode];
}

// ---- colour evaluation (enough for var(), color-mix(in srgb, A p%, B|transparent), literals) -----

function splitArgs(s) {
  const out = [];
  let d = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') d += 1;
    if (ch === ')') d -= 1;
    if (ch === ',' && d === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** -> { r, g, b, a } (0..255, a 0..1) or null when the expression is not a plain colour. */
export function evalColor(str, tokens) {
  const s = String(str).trim();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  let m = /^var\((--[\w-]+)\)$/.exec(s);
  if (m) {
    const v = tokens[m[1]];
    return v === undefined ? null : evalColor(v, tokens);
  }
  m = /^color-mix\(in srgb,(.*)\)$/.exec(s);
  if (m) {
    const [a, b] = splitArgs(m[1]);
    const parse = (t) => {
      const mm = /^(.*?)(?:\s+([\d.]+)%)?$/.exec(t.trim());
      return { c: evalColor(mm[1], tokens), p: mm[2] === undefined ? null : Number(mm[2]) / 100 };
    };
    const A = parse(a);
    const B = parse(b);
    if (!A.c || !B.c) return null;
    let pa = A.p;
    let pb = B.p;
    if (pa === null && pb === null) { pa = 0.5; pb = 0.5; } else if (pa === null) pa = 1 - pb; else if (pb === null) pb = 1 - pa;
    const sum = pa + pb;
    const alphaMul = sum < 1 ? sum : 1;
    pa /= sum;
    pb /= sum;
    const aA = A.c.a * pa;
    const aB = B.c.a * pb;
    const aa = aA + aB;
    if (aa === 0) return { r: 0, g: 0, b: 0, a: 0 };
    const ch = (k) => (A.c[k] * aA + B.c[k] * aB) / aa;
    return { r: ch('r'), g: ch('g'), b: ch('b'), a: aa * alphaMul };
  }
  const p = parseLiteral(s);
  if (!p) return null;
  if (p.space === 'rgb') return { r: p.r, g: p.g, b: p.b, a: p.a };
  const o = hslToSrgb01({ h: p.h / 360, s: p.s / 100, l: p.l / 100 });
  const [r, g, b] = (Array.isArray(o) ? o : [o.r, o.g, o.b]).map((x) => x * 255);
  return { r, g, b, a: p.a };
}

/** Largest per-channel difference (alpha scaled to 255); Infinity when either side is not a colour. */
export function colorDistance(a, b) {
  if (!a || !b) return Infinity;
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b), Math.abs(a.a - b.a) * 255);
}

// ---- legacy custom-property resolution ------------------------------------------------------

/**
 * Collect custom-property declarations (name -> value) from the given stylesheets whose rule
 * selector matches `selectorFilter` (default: every rule). Later declarations win.
 */
export function collectCustomProps(files, selectorFilter = () => true) {
  const table = {};
  for (const f of files) {
    for (const rule of parseRules(read(f))) {
      if (!selectorFilter(rule.selector, f)) continue;
      for (const d of rule.decls) if (d.name.startsWith('--') && !d.name.startsWith('--t-')) table[d.name] = d.value;
    }
  }
  return table;
}

/** Resolve `--legacy` through var() chains down to a computed colour string for `mode`. */
export function resolveLegacy(name, table, mode, depth = 0) {
  const raw = table[name];
  if (raw === undefined) return undefined;
  return substitute(raw, table, mode, depth);
}

function substitute(value, table, mode, depth) {
  if (depth > 8) throw new Error(`var() chain too deep at ${value}`);
  return value.replace(/var\((--[\w-]+)\)/g, (all, n) => {
    if (n.startsWith('--t-')) {
      const t = tokensFor(mode)[n];
      if (t === undefined) throw new Error(`unknown token ${n}`);
      return substitute(t, table, mode, depth + 1); // composite tokens (gradients, shadows) nest var() of other tokens
    }
    if (table[n] === undefined) return all;
    return substitute(table[n], table, mode, depth + 1);
  });
}
