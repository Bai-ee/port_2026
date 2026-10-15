// Role catalogue (contract §4). One entry per colour role; the CSS variable for
// role `id` is always `--t-<id>`. Order here IS the canonical emit/key order.
//
// hue rule:  { src:'tint', value:n }   neutral tint hue + n
//            { src:'master', value:n } master hue + n
//            { src:'offset', key }     master hue + offsets[key]
//            { src:'fixed', value:n }  absolute hue (status / semantic: never follows master)
// scale:     'tint' (chroma x neutral.tintStrength) | 'int' (chroma x master.intensity) | 'none'
// ranges:    advisory authoring ranges per mode, checked by the report (never by validation)

import { TOKEN_PREFIX } from './constants.js';
import { EXCLUDED_ROLES } from './contrast-pairs.js';

export const GROUPS = Object.freeze([
  { id: 'surfaces', label: 'Surfaces' },
  { id: 'text', label: 'Text and borders' },
  { id: 'accent', label: 'Accent and supporting' },
  { id: 'decorative', label: 'Decorative ramps' },
  { id: 'status', label: 'Status' },
  { id: 'state', label: 'State, shadow, scene' },
  { id: 'dashboard', label: 'Dashboard neutrals' },
  { id: 'terminal', label: 'Terminal' },
]);

const T = (value) => ({ src: 'tint', value });
const M = (value) => ({ src: 'master', value });
const O = (key) => ({ src: 'offset', key });
const F = (value) => ({ src: 'fixed', value });

const WIDE_L = [0, 1];
const WIDE_C = [0, 0.4];

// ranges helper: lightness light/dark, max chroma, optional alpha range (default solid [1,1])
function rng(lL, lD, cMax, a = [1, 1], cMaxDark = cMax) {
  return {
    light: { l: lL, c: [0, cMax], a },
    dark: { l: lD, c: [0, cMaxDark], a },
  };
}

const defs = [];
function role(id, group, hue, o = {}) {
  defs.push({
    id,
    css: `${TOKEN_PREFIX}${id}`,
    group,
    kind: o.kind || 'solid',
    hue,
    scale: o.scale || 'none',
    modeSettings: !!o.ms,
    ranges: o.ranges || rng(WIDE_L, WIDE_L, WIDE_C[1]),
    usage: o.usage || '',
    contrast: !(id in EXCLUDED_ROLES),
  });
}

// ---- 4.1 Surfaces ----
role('page', 'surfaces', T(40), { scale: 'tint', ranges: rng([0.94, 1], [0.1, 0.26], 0.03), usage: 'Body and canvas background' });
role('surface', 'surfaces', T(40), { scale: 'tint', ranges: rng([0.92, 1], [0.14, 0.32], 0.03), usage: 'Cards, inputs, modals' });
role('raised', 'surfaces', T(39), { scale: 'tint', ranges: rng([0.92, 1], [0.18, 0.36], 0.03), usage: 'Popovers, floating panels, inner-page shell' });
role('inset', 'surfaces', T(50), { scale: 'tint', ranges: rng([0.88, 0.99], [0.08, 0.24], 0.03), usage: 'Wells, code blocks, guidance rows' });
role('overlay', 'surfaces', T(12), { kind: 'alpha', scale: 'tint', ranges: rng([0.05, 0.3], [0, 0.2], 0.03, [0.2, 0.9]), usage: 'Scrim behind modals and blocked tiles' });
role('chrome', 'surfaces', T(41), { kind: 'alpha', scale: 'tint', ranges: rng([0.9, 0.99], [0.14, 0.34], 0.05, [0.3, 0.9]), usage: 'Navigation strip glass' });
role('chrome-strong', 'surfaces', T(41), { kind: 'alpha', ranges: rng(WIDE_L, WIDE_L, WIDE_C[1], [0.5, 1]), usage: 'Scroll-top button, pinned nav' });
role('glass-soft', 'surfaces', T(40), { kind: 'alpha', ranges: rng(WIDE_L, WIDE_L, WIDE_C[1], [0.3, 0.7]), usage: 'Lightest glass panel' });
role('glass', 'surfaces', T(40), { kind: 'alpha', ranges: rng(WIDE_L, WIDE_L, WIDE_C[1], [0.4, 0.85]), usage: 'Standard glass panel' });
role('glass-strong', 'surfaces', T(40), { kind: 'alpha', ranges: rng(WIDE_L, WIDE_L, WIDE_C[1], [0.55, 0.95]), usage: 'Dense glass panel, text-bearing' });
role('glass-border', 'surfaces', T(23), { kind: 'alpha', scale: 'tint', ranges: rng([0.7, 0.92], [0.25, 0.55], 0.05, [0.3, 1]), usage: 'Sand panel border' });
role('glass-highlight', 'surfaces', T(40), { kind: 'alpha', scale: 'tint', ranges: rng([0.9, 1], [0.85, 1], 0.02, [0.05, 0.8]), usage: 'Inset hairlines on glass' });
role('scrim', 'surfaces', T(40), { kind: 'alpha', ranges: rng(WIDE_L, WIDE_L, WIDE_C[1], [0, 0.9]), usage: 'Text-over-animation scrim (invisible in the baseline)' });

// ---- 4.2 Text and borders ----
role('text-default', 'text', T(0), { scale: 'tint', ranges: rng([0, 0.3], [0.82, 0.98], 0.03), usage: 'Inherited body colour' });
role('text-strong', 'text', T(0), { scale: 'tint', ranges: rng([0.05, 0.3], [0.9, 1], 0.03), usage: 'Headings' });
role('text-body', 'text', T(0), { scale: 'tint', ranges: rng([0.1, 0.35], [0.8, 0.96], 0.03), usage: 'Inner-page body copy' });
role('text', 'text', T(0), { scale: 'tint', ranges: rng([0.15, 0.4], [0.82, 0.98], 0.03), usage: 'Primary ink, the workhorse' });
role('text-secondary', 'text', T(0), { kind: 'alpha', ranges: rng(WIDE_L, WIDE_L, WIDE_C[1], [0.6, 0.85]), usage: 'Secondary text' });
role('text-muted', 'text', T(0), { kind: 'alpha', ranges: rng(WIDE_L, WIDE_L, WIDE_C[1], [0.4, 0.65]), usage: 'Muted text and hints' });
role('text-faint', 'text', T(0), { kind: 'alpha', ranges: rng(WIDE_L, WIDE_L, WIDE_C[1], [0.25, 0.5]), usage: 'Placeholders' });
role('text-eyebrow', 'text', T(27), { scale: 'tint', ranges: rng([0.3, 0.55], [0.62, 0.82], 0.03, [0.5, 1]), usage: 'Eyebrow labels' });
role('text-inverse', 'text', T(25), { scale: 'tint', ranges: rng([0.9, 1], [0.1, 0.3], 0.03), usage: 'Text on dark chrome and overlays' });
role('on-overlay', 'text', T(25), { scale: 'tint', ranges: rng([0.9, 1], [0.9, 1], 0.03), usage: 'Text on overlay scrims and blocked tiles (light in both modes)' });
role('on-accent', 'text', T(0), { scale: 'tint', ranges: rng([0.1, 1], [0.1, 1], 0.03), usage: 'Text on accent fills' });
role('on-solid', 'text', T(0), { scale: 'tint', ranges: rng([0.1, 1], [0.1, 1], 0.03), usage: 'Text on status solid fills' });
role('text-disabled', 'text', T(0), { kind: 'alpha', ranges: rng(WIDE_L, WIDE_L, WIDE_C[1], [0.2, 0.5]), usage: 'Disabled text' });
role('accent-text', 'text', M(0), { scale: 'int', ranges: rng([0.4, 0.58], [0.72, 0.9], 0.18), usage: 'Links and accent text on page' });
role('border-faint', 'text', T(0), { kind: 'alpha', ranges: rng(WIDE_L, WIDE_L, WIDE_C[1], [0.04, 0.14]), usage: 'Decorative hairlines' });
role('border-subtle', 'text', T(0), { kind: 'alpha', ranges: rng(WIDE_L, WIDE_L, WIDE_C[1], [0.06, 0.2]), usage: 'Dividers and card hairlines' });
role('control-border', 'text', T(0), { kind: 'alpha', ranges: rng(WIDE_L, WIDE_L, WIDE_C[1], [0.15, 0.4]), usage: 'Input and button boundary' });
role('control-border-strong', 'text', T(0), { kind: 'alpha', ranges: rng(WIDE_L, WIDE_L, WIDE_C[1], [0.4, 0.8]), usage: 'Emphasised control boundary' });
role('focus', 'text', M(0), { scale: 'int', ranges: rng([0.4, 0.62], [0.7, 0.9], 0.18), usage: 'Keyboard focus ring' });

// ---- 4.3 Accent and supporting ----
role('accent', 'accent', M(0), { scale: 'int', ms: true, ranges: rng([0.55, 0.8], [0.65, 0.85], 0.2), usage: 'Primary accent fill' });
role('accent-hover', 'accent', M(0), { ranges: rng(WIDE_L, WIDE_L, WIDE_C[1]), usage: 'Accent hover state' });
role('accent-pressed', 'accent', M(0), { ranges: rng(WIDE_L, WIDE_L, WIDE_C[1]), usage: 'Accent pressed state' });
role('accent-soft', 'accent', M(0), { kind: 'alpha', ranges: rng(WIDE_L, WIDE_L, WIDE_C[1], [0.04, 0.3]), usage: 'Accent tint background' });
role('accent-soft-border', 'accent', M(0), { kind: 'alpha', ranges: rng(WIDE_L, WIDE_L, WIDE_C[1], [0.1, 0.6]), usage: 'Accent tint border' });
role('accent-bright', 'accent', O('accentBright'), { scale: 'int', ms: true, ranges: rng([0.7, 0.9], [0.7, 0.9], 0.22), usage: 'Gradient start, bright accent' });
role('support-1', 'accent', O('support1'), { scale: 'int', ms: true, ranges: rng([0.45, 0.8], [0.6, 0.85], 0.32), usage: 'Supporting colour 1 (gradient middle)' });
role('support-2', 'accent', O('support2'), { scale: 'int', ms: true, ranges: rng([0.45, 0.8], [0.6, 0.85], 0.32), usage: 'Supporting colour 2 (gradient end)' });
role('selection-bg', 'accent', M(0), { kind: 'alpha', ranges: rng(WIDE_L, WIDE_L, WIDE_C[1], [0.1, 0.6]), usage: 'Text selection background' });
role('selection-fg', 'accent', T(0), { ranges: rng(WIDE_L, WIDE_L, WIDE_C[1]), usage: 'Text selection foreground' });

// ---- 4.4 Decorative ramps ----
const COMET_OFFSETS = [4, 35, 65, 82, 107, 127, 139];
COMET_OFFSETS.forEach((n, i) => {
  role(`comet-${i + 1}`, 'decorative', M(n), { scale: 'int', ms: true, ranges: rng([0.55, 0.9], [0.55, 0.9], 0.3), usage: `Conic gradient stop ${i + 1} (CTA ring, spinner)` });
});
const DECO_OFFSETS = [-153, -25, -110, 98];
DECO_OFFSETS.forEach((n, i) => {
  role(`deco-${i + 1}`, 'decorative', M(n), { scale: 'int', ms: true, ranges: rng([0.6, 0.85], [0.5, 0.8], 0.14), usage: `Hero tint blob ${i + 1}` });
});

// ---- 4.5 Status (fixed hues) ----
const STATUS = [
  { id: 'success', fg: 152.7, solid: 148.6, solidL: [0.5, 0.8], solidLD: [0.6, 0.82] },
  { id: 'warning', fg: 69.1, solid: 84.9, solidL: [0.5, 0.82], solidLD: [0.6, 0.85] },
  { id: 'danger', fg: 29.0, solid: 26.8, solidL: [0.5, 0.8], solidLD: [0.6, 0.82] },
  { id: 'info', fg: 264.4, solid: 262.0, solidL: [0.5, 0.8], solidLD: [0.6, 0.82] },
];
for (const s of STATUS) {
  role(s.id, 'status', F(s.fg), { ranges: rng([0.35, 0.55], [0.68, 0.85], 0.22), usage: `${s.id} text and icons on surface` });
  role(`${s.id}-bg`, 'status', F(s.fg), { kind: 'alpha', ranges: rng(WIDE_L, WIDE_L, WIDE_C[1], [0.04, 0.3]), usage: `${s.id} tinted background` });
  role(`${s.id}-border`, 'status', F(s.fg), { kind: 'alpha', ranges: rng(WIDE_L, WIDE_L, WIDE_C[1], [0.1, 0.6]), usage: `${s.id} tinted border` });
  role(`${s.id}-solid`, 'status', F(s.solid), { ranges: rng(s.solidL, s.solidLD, 0.24), usage: `${s.id} fills and icons` });
}

// ---- 4.6 State, shadow, scene ----
role('disabled-bg', 'state', T(0), { kind: 'alpha', ranges: rng(WIDE_L, WIDE_L, WIDE_C[1], [0.03, 0.2]), usage: 'Disabled control background' });
role('shadow', 'state', F(0), { kind: 'alpha', ranges: rng([0, 0.2], [0, 0.2], 0.02, [0.04, 0.6]), usage: 'Drop-shadow colour' });
role('scene-wash', 'state', T(41), { kind: 'alpha', scale: 'tint', ranges: rng([0, 1], [0, 1], 0.05, [0, 0.3]), usage: 'Wash over the animated background' });

// ---- 4.7 Dashboard neutrals (exact legacy values, untinted by default) ----
const DASH = [
  ['dash-page', 'Dashboard page background'],
  ['dash-surface', 'Dashboard card surface'],
  ['dash-surface-raised', 'Dashboard raised surface'],
  ['dash-border', 'Dashboard border'],
  ['dash-border-visible', 'Dashboard visible border'],
  ['dash-text-disabled', 'Dashboard disabled text'],
  ['dash-text-secondary', 'Dashboard secondary text'],
  ['dash-text-primary', 'Dashboard primary text'],
  ['dash-text-display', 'Dashboard display text'],
];
for (const [id, usage] of DASH) role(id, 'dashboard', T(0), { ranges: rng([0, 1], [0, 1], 0.05), usage });
role('dash-dot-grid', 'dashboard', T(0), { kind: 'alpha', ranges: rng([0, 1], [0, 1], 0.05, [0, 0.3]), usage: 'Dashboard dot-grid texture' });
role('dash-accent', 'dashboard', F(26.8), { ranges: rng([0, 1], [0, 1], 0.32), usage: 'Dashboard brand highlight (legacy --accent red)' });

// ---- 4.8 Terminal ----
role('term-bg-top', 'terminal', T(23), { scale: 'tint', ranges: rng([0.9, 1], [0.08, 0.3], 0.05), usage: 'Terminal background (top stop)' });
role('term-bg-bottom', 'terminal', T(23), { scale: 'tint', ranges: rng([0.9, 1], [0.06, 0.28], 0.05), usage: 'Terminal background (bottom stop)' });
const TERM_ALPHA_USAGE = [
  ['term-border', 'Terminal border', [0.04, 0.3]],
  ['term-border-top', 'Terminal top highlight border', [0.02, 0.3]],
  ['term-titlebar-bg', 'Terminal titlebar background', [0.02, 0.2]],
  ['term-titlebar-border', 'Terminal titlebar border', [0.03, 0.3]],
  ['term-title-fg', 'Terminal title text', [0.25, 0.8]],
  ['term-scroll-thumb', 'Terminal scrollbar thumb', [0.08, 0.5]],
];
for (const [id, usage, a] of TERM_ALPHA_USAGE) role(id, 'terminal', T(0), { kind: 'alpha', ranges: rng(WIDE_L, WIDE_L, WIDE_C[1], a), usage });
role('term-fg', 'terminal', T(0), { ranges: rng(WIDE_L, WIDE_L, WIDE_C[1]), usage: 'Terminal default line text' });
role('term-dim', 'terminal', T(23), { scale: 'tint', ranges: rng([0.45, 0.8], [0.5, 0.8], 0.05), usage: 'Terminal system / dim text' });
role('term-shadow-1', 'terminal', T(0), { kind: 'alpha', ranges: rng(WIDE_L, WIDE_L, WIDE_C[1], [0.02, 0.6]), usage: 'Terminal shadow, near' });
role('term-shadow-2', 'terminal', T(0), { kind: 'alpha', ranges: rng(WIDE_L, WIDE_L, WIDE_C[1], [0.02, 0.6]), usage: 'Terminal shadow, far' });

// Semantic terminal lines: fixed hues (pfx, msg), never follow master.
export const TERM_KINDS = Object.freeze([
  { id: 'info', pfx: 256, msg: 256.8 },
  { id: 'fetch', pfx: 210, msg: 208.5 },
  { id: 'ok', pfx: 139.5, msg: 136.3 },
  { id: 'ai', pfx: 312.8, msg: 312.3 },
  { id: 'build', pfx: 77.6, msg: 78.2 },
  { id: 'error', pfx: 29.7, msg: 29.5 },
  { id: 'active', pfx: 262, msg: 250.7 },
  { id: 'screen', pfx: 267, msg: 268.3 },
  { id: 'mock', pfx: 47, msg: 45.3 },
  { id: 'countdown', pfx: 77.6, msg: 78.2 },
]);
for (const k of TERM_KINDS) {
  role(`term-${k.id}-pfx`, 'terminal', F(k.pfx), { ranges: rng([0.45, 0.65], [0.7, 0.85], 0.26), usage: `Terminal ${k.id} line prefix` });
  role(`term-${k.id}-msg`, 'terminal', F(k.msg), { ranges: rng([0.28, 0.58], [0.78, 0.9], 0.26), usage: `Terminal ${k.id} line message` });
}
role('term-caret', 'terminal', F(262), { ranges: rng(WIDE_L, WIDE_L, WIDE_C[1]), usage: 'Terminal caret' });

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

export const ROLE_DEFS = deepFreeze(defs);
export const ROLE_IDS = Object.freeze(defs.map((d) => d.id));
const BY_ID = new Map(defs.map((d) => [d.id, d]));
export function getRoleDef(id) {
  return BY_ID.get(id) || null;
}
export function isRoleId(id) {
  return typeof id === 'string' && BY_ID.has(id);
}
