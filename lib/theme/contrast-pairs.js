// Contrast pair definitions (contract §7.3). Pure data. Evaluated per mode by
// report.js. A `bg` array lists the layers composited bottom -> top over the
// opaque `page` colour. `scene-peak` is a virtual layer (scene-base at alpha 0.23)
// resolved by report.js; it approximates the busiest particle colour, it is not
// a sample of every particle.
//
// `required:false` marks the pairs that are intentionally low-emphasis in the
// baseline (tertiary text, placeholder text, the default input hairline, the
// brand accent as a graphic). They are still measured and reported as
// "advisory" failures; only `required` failures block the "validated" status.

import { CONTRAST_STATEMENT } from './constants.js';

export { CONTRAST_STATEMENT };

export const THRESHOLDS = Object.freeze({ text: 4.5, large: 3, nontext: 3 });

const pairs = [];
function add(fg, bg, kind, extra = {}) {
  const bgKey = bg.join('+');
  pairs.push({
    id: `${fg}@${bgKey}`,
    label: `${fg} on ${bg.length === 1 ? bg[0] : bg.join(' over ')}`,
    kind,
    min: THRESHOLDS[kind],
    required: extra.required !== false,
    fg,
    bg,
  });
}

// --- body text on surfaces ---
for (const fg of ['text-default', 'text-strong', 'text-body', 'text']) {
  for (const bg of ['page', 'surface', 'raised', 'inset']) add(fg, [bg], 'text');
  add(fg, ['glass-strong'], 'text');
}
// --- secondary / muted / faint ---
for (const bg of [['surface'], ['glass-strong']]) {
  add('text-secondary', bg, 'text');
  add('text-muted', bg, 'text', { required: false });
  add('text-faint', bg, 'text', { required: false });
}
add('text-eyebrow', ['surface'], 'text');
add('on-overlay', ['overlay'], 'text');
add('text-inverse', ['text'], 'text'); // inverse ink on an ink-coloured fill (e.g. a primary button)
add('text', ['chrome-strong'], 'text');
// --- accent family ---
for (const bg of ['accent', 'accent-hover', 'accent-pressed']) add('on-accent', [bg], 'text');
add('accent-text', ['page'], 'text');
add('accent-text', ['surface'], 'text');
add('accent-text', ['surface', 'accent-soft'], 'text');
// --- status ---
for (const s of ['success', 'warning', 'danger', 'info']) {
  add('on-solid', [`${s}-solid`], 'text');
  add(s, ['surface'], 'text');
  add(s, ['surface', `${s}-bg`], 'text');
}
add('selection-fg', ['selection-bg'], 'text');
// --- terminal ---
const TERM_KINDS = ['info', 'fetch', 'ok', 'ai', 'build', 'error', 'active', 'screen', 'mock', 'countdown'];
for (const bg of ['term-bg-top', 'term-bg-bottom']) {
  add('term-fg', [bg], 'text');
  add('term-dim', [bg], 'text', { required: false });
  for (const k of TERM_KINDS) {
    add(`term-${k}-pfx`, [bg], 'text', { required: false }); // prefix tag; the message carries the content
    add(`term-${k}-msg`, [bg], 'text');
  }
}
// --- dashboard neutrals ---
for (const fg of ['dash-text-primary', 'dash-text-secondary']) {
  for (const bg of ['dash-surface', 'dash-page']) add(fg, [bg], 'text');
}
// --- text over the animated scene ---
add('text', ['page', 'scrim', 'scene-peak'], 'text');
// --- non-text 3:1 ---
for (const bg of ['page', 'surface']) add('focus', [bg], 'nontext');
add('control-border', ['surface'], 'nontext', { required: false });
add('control-border-strong', ['surface'], 'nontext');
add('accent', ['surface'], 'nontext', { required: false });
// status is never colour-only (paired with text/icon), so the solid fill as a graphic is advisory
for (const s of ['success', 'warning', 'danger', 'info']) add(`${s}-solid`, ['surface'], 'nontext', { required: false });

export const CONTRAST_PAIRS = Object.freeze(pairs.map((p) => Object.freeze(p)));

// Roles never measured, with the reason shown in the report.
export const EXCLUDED_ROLES = Object.freeze({
  'border-faint': 'decorative hairline',
  'border-subtle': 'decorative divider',
  'glass-border': 'decorative panel edge',
  'text-disabled': 'disabled controls are exempt',
  'disabled-bg': 'disabled controls are exempt',
  shadow: 'shadow',
  overlay: 'scrim behind modals (measured through text-inverse)',
  scrim: 'text-over-animation scrim (measured through the scene pair)',
  'glass-highlight': 'decorative inset hairline',
  'support-1': 'decorative accent',
  'support-2': 'decorative accent',
  'comet-1': 'decorative gradient stop',
  'comet-2': 'decorative gradient stop',
  'comet-3': 'decorative gradient stop',
  'comet-4': 'decorative gradient stop',
  'comet-5': 'decorative gradient stop',
  'comet-6': 'decorative gradient stop',
  'comet-7': 'decorative gradient stop',
  'deco-1': 'decorative hero tint',
  'deco-2': 'decorative hero tint',
  'deco-3': 'decorative hero tint',
  'deco-4': 'decorative hero tint',
});
