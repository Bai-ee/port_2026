// Validation report (contract §7.3, §12.4): structure issues + per-mode contrast
// + gamut mapping + authoring-range warnings. Automated checks only.

import { MODES, SCHEMA_VERSION, CONTRAST_STATEMENT } from './constants.js';
import { contrastRatio, composite } from './contrast.js';
import { gamutMap } from './color.js';
import { CONTRAST_PAIRS, EXCLUDED_ROLES } from './contrast-pairs.js';
import { ROLE_DEFS, getRoleDef } from './roles.js';
import { resolveBoth } from './resolve.js';
import { validateDefinition, normalizeDefinition } from './validate.js';
import { round } from './util.js';

const SCENE_PEAK_ALPHA = 0.23;
const SUGGESTION_MARGIN = 0.05;
const PAGE_FALLBACK = { r: 255, g: 255, b: 255, a: 1 };

const round2 = (x) => Math.round(x * 100) / 100;

function rgbaOf(resolved, id, overrides) {
  if (overrides && overrides[id]) return overrides[id];
  if (id === 'scene-peak') {
    const hex = resolved.scene.swatches.base;
    return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16), a: SCENE_PEAK_ALPHA };
  }
  const r = resolved.roles[id];
  if (!r) return null;
  return { r: r.rgba[0], g: r.rgba[1], b: r.rgba[2], a: r.rgba[3] };
}

/** Composite a bottom->top layer list over the opaque page colour. */
function backdrop(resolved, layers, overrides) {
  let cur = rgbaOf(resolved, 'page', overrides) || PAGE_FALLBACK;
  cur = { ...cur, a: 1 };
  for (const id of layers) {
    const l = rgbaOf(resolved, id, overrides);
    if (!l) return null;
    cur = composite(l, cur);
    cur = { ...cur, a: 1 };
  }
  return cur;
}

function measure(resolved, pair, overrides) {
  const bg = backdrop(resolved, pair.bg, overrides);
  const fgRaw = rgbaOf(resolved, pair.fg, overrides);
  if (!bg || !fgRaw) return null;
  const fg = composite(fgRaw, bg);
  return { fg, bg, ratio: contrastRatio(fg, bg) };
}

const hex = (c) => `#${[c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;

/**
 * Suggest a repair for a failing pair. Never mutates anything.
 * Order: fg, then the bg layers top-down; the first non-locked role is adjusted.
 * Alpha roles first try a higher alpha; otherwise a lightness change (keeping c,h).
 */
export function suggestFix(resolved, pair) {
  const target = pair.min + SUGGESTION_MARGIN;
  const def = CONTRAST_PAIRS.find((p) => p.id === pair.id) || pair;
  const candidates = [def.fg, ...[...def.bg].reverse().filter((id) => id !== 'scene-peak')];
  const chosen = candidates.find((id) => resolved.roles[id] && !resolved.roles[id].locked);
  const lockedAll = !chosen;
  const roleId = chosen || def.fg;
  const role = resolved.roles[roleId];
  if (!role) return null;

  const ratioWith = (rgba) => {
    const m = measure(resolved, def, { [roleId]: rgba });
    return m ? m.ratio : 0;
  };
  const basis = { r: role.rgba[0], g: role.rgba[1], b: role.rgba[2], a: role.rgba[3] };
  const withBlock = (s) => (lockedAll ? { ...s, blockedByLock: true } : s);

  // 1) alpha roles (as the foreground) can simply be made denser
  if (roleId === def.fg && basis.a < 1) {
    if (ratioWith({ ...basis, a: 1 }) >= target) {
      let lo = basis.a;
      let hi = 1;
      for (let i = 0; i < 16; i++) {
        const mid = (lo + hi) / 2;
        if (ratioWith({ ...basis, a: round(mid, 3) }) >= target) hi = mid;
        else lo = mid;
      }
      const a = Math.min(1, Math.ceil(hi * 1000) / 1000);
      const res = ratioWith({ ...basis, a });
      if (res >= target) return withBlock({ role: roleId, set: { a }, resultingRatio: round2(res) });
    }
  }

  // 2) lightness search, keeping chroma and hue (gamut mapped)
  const { c, h } = role.oklch;
  const alpha = roleId === def.fg && basis.a < 1 ? 1 : basis.a;
  const rgbaAt = (l) => {
    const [r, g, b] = gamutMap({ l, c, h }).rgb255;
    return { r, g, b, a: alpha };
  };
  const l0 = role.oklch.l;
  const up = ratioWith(rgbaAt(1));
  const down = ratioWith(rgbaAt(0));
  const end = up >= down ? 1 : 0;
  if (Math.max(up, down) < target) return null;
  let lo = l0; // fails (or current)
  let hi = end; // passes
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (ratioWith(rgbaAt(round(mid, 4))) >= target) hi = mid;
    else lo = mid;
  }
  const l = round(hi, 4);
  const res = ratioWith(rgbaAt(l));
  if (res < target) return null;
  const set = alpha !== basis.a ? { l, a: alpha } : { l };
  return withBlock({ role: roleId, set, resultingRatio: round2(res) });
}

/** Contrast report for one resolved mode. */
export function evaluateContrast(resolved) {
  const results = [];
  for (const pair of CONTRAST_PAIRS) {
    const m = measure(resolved, pair);
    if (!m) continue;
    const pass = m.ratio >= pair.min;
    const entry = {
      id: pair.id,
      label: pair.label,
      kind: pair.kind,
      min: pair.min,
      required: pair.required,
      fg: pair.fg,
      bg: [...pair.bg],
      fgHex: hex(m.fg),
      bgHex: hex(m.bg),
      ratio: round2(m.ratio),
      pass,
      fgLocked: !!resolved.roles[pair.fg]?.locked,
      bgLocked: pair.bg.some((id) => !!resolved.roles[id]?.locked),
    };
    if (!pass) {
      const s = suggestFix(resolved, { ...pair, ratio: m.ratio });
      if (s) entry.suggestion = s;
    }
    results.push(entry);
  }
  const excluded = ROLE_DEFS.filter((d) => d.id in EXCLUDED_ROLES).map((d) => ({ roleId: d.id, reason: EXCLUDED_ROLES[d.id] }));
  return { mode: resolved.mode, results, excluded };
}

function rangeIssues(resolved) {
  const out = [];
  const TOL = 0.00006;
  for (const rd of ROLE_DEFS) {
    const r = resolved.roles[rd.id];
    const rg = rd.ranges[resolved.mode];
    const fields = [
      ['l', r.oklch.l, rg.l],
      ['c', r.oklch.c, rg.c],
      ['a', r.oklch.a, rg.a],
    ];
    for (const [field, value, [min, max]] of fields) {
      if (value < min - TOL || value > max + TOL) {
        out.push({ mode: resolved.mode, roleId: rd.id, field, value: round(value, 4), min, max });
      }
    }
  }
  return out;
}

function gamutIssues(resolved) {
  const out = [];
  for (const rd of ROLE_DEFS) {
    const g = resolved.roles[rd.id].gamut;
    if (g.mapped) out.push({ mode: resolved.mode, roleId: rd.id, mapped: true, deltaE: g.deltaE });
  }
  return out;
}

/** Full report for a definition (canonicalised internally). */
export function buildReport(definition) {
  const v = validateDefinition(definition);
  const def = v.definition || normalizeDefinition(definition);
  const resolved = resolveBoth(def, { assumeCanonical: true });
  const modes = {};
  const gamut = [];
  const ranges = [];
  for (const mode of MODES) {
    modes[mode] = evaluateContrast(resolved[mode]);
    gamut.push(...gamutIssues(resolved[mode]));
    ranges.push(...rangeIssues(resolved[mode]));
  }
  let pass = 0;
  let fail = 0;
  let advisoryFail = 0;
  let failRequired = 0;
  let excluded = 0;
  for (const mode of MODES) {
    excluded += modes[mode].excluded.length;
    for (const r of modes[mode].results) {
      if (r.pass) pass += 1;
      else {
        fail += 1;
        if (r.required) failRequired += 1;
        else advisoryFail += 1;
      }
    }
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    definitionId: resolved.light.definitionId,
    hash: resolved.light.hash,
    structure: { errors: v.errors, warnings: v.warnings },
    modes,
    gamut,
    ranges,
    summary: { pass, fail, advisoryFail, excluded, failRequired },
    statement: CONTRAST_STATEMENT,
  };
}

/** 'validated' only when the structure is sound and no required check fails. */
export function reportStatus(report) {
  return report.structure.errors.length === 0 && report.summary.failRequired === 0 ? 'validated' : 'draft';
}

export { getRoleDef };
