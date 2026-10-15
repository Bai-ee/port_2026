// Colour guide (contract §7.1): token / light / dark / usage / linked-to, as rows
// and as deterministic Markdown. Used by the Studio export and by designers.

import { MODES } from './constants.js';
import { ROLE_DEFS, GROUPS } from './roles.js';
import { COMPOSITE_TOKENS } from './tokens.js';
import { resolveBoth } from './resolve.js';
import { normalizeDefinition } from './validate.js';
import { round } from './util.js';

function signed(n, dp) {
  const v = round(n, dp);
  return `${v >= 0 ? '+' : '−'}${Math.abs(v)}`;
}

/** Human description of how a role gets its value in a mode (null for custom). */
export function describeLink(def, mode, id) {
  const state = def.modes[mode].roles[id];
  const rd = ROLE_DEFS.find((d) => d.id === id);
  if (state.link === 'custom') return null;
  if (state.link === 'auto') {
    const h = rd.hue;
    if (h.src === 'tint') return h.value ? `follows neutral tint hue ${signed(h.value, 0)}°` : 'follows neutral tint hue';
    if (h.src === 'master') return h.value ? `follows master hue ${signed(h.value, 0)}°` : 'follows master hue';
    if (h.src === 'offset') return `follows master hue ${signed(def.offsets[h.key], 2)}°`;
    return `fixed hue ${h.value}° (never follows master)`;
  }
  const l = state.link;
  const parts = [];
  if (l.dL) parts.push(`${signed(l.dL, 4)} L`);
  if (l.dC) parts.push(`${signed(l.dC, 4)} C`);
  if (l.dH) parts.push(`${signed(l.dH, 2)}° H`);
  if (l.a !== undefined) parts.push(`alpha ${l.a}`);
  const target = l.mode && l.mode !== mode ? `${l.mode}:${l.to}` : l.to;
  return `linked to ${target}${parts.length ? ` ${parts.join(', ')}` : ''}`;
}

function joinModes(a, b) {
  if (a === b) return a;
  if (a === null) return `custom (light); ${b} (dark)`;
  if (b === null) return `${a} (light); custom (dark)`;
  return `${a} (light); ${b} (dark)`;
}

export function toColorGuide(definition) {
  const def = normalizeDefinition(definition);
  const res = resolveBoth(def, { assumeCanonical: true });
  const rows = ROLE_DEFS.map((rd) => {
    const row = { token: rd.css, roleId: rd.id, group: rd.group, usage: rd.usage };
    for (const mode of MODES) {
      const r = res[mode].roles[rd.id];
      row[mode] = {
        hex: r.hex,
        value: r.value,
        oklch: { l: round(r.oklch.l, 3), c: round(r.oklch.c, 3), h: round(r.oklch.h, 1), a: round(r.oklch.a, 3) },
      };
    }
    row.linked = joinModes(describeLink(def, 'light', rd.id), describeLink(def, 'dark', rd.id));
    return row;
  });
  const composites = COMPOSITE_TOKENS.map((token) => ({
    token,
    light: res.light.tokens[token],
    dark: res.dark.tokens[token],
  }));
  return { id: def.meta.id, name: def.meta.name, hash: res.light.hash, rows, composites };
}

const esc = (s) => String(s).replace(/\|/g, '\\|');

export function toColorGuideMarkdown(definition) {
  const g = toColorGuide(definition);
  const out = [`# Colour guide: ${esc(g.name)}`, '', `Theme \`${g.id}\` (hash \`${g.hash}\`). Generated; do not edit by hand.`, ''];
  for (const grp of GROUPS) {
    const rows = g.rows.filter((r) => r.group === grp.id);
    if (!rows.length) continue;
    out.push(`## ${grp.label}`, '', '| Token | Light | Dark | Usage | Linked |', '|---|---|---|---|---|');
    for (const r of rows) {
      out.push(`| \`${r.token}\` | \`${esc(r.light.value)}\` | \`${esc(r.dark.value)}\` | ${esc(r.usage)} | ${r.linked === null ? '' : esc(r.linked)} |`);
    }
    out.push('');
  }
  out.push('## Composite tokens', '', '| Token | Light | Dark |', '|---|---|---|');
  for (const c of g.composites) out.push(`| \`${c.token}\` | \`${esc(c.light)}\` | \`${esc(c.dark)}\` |`);
  out.push('');
  return out.join('\n');
}
