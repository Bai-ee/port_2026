// Invoice Studio — theme contract (design-layer plan §3.2). Client-safe,
// pure, no side effects: only imports the shared Studio font catalog
// (app/dashboard/studio/text-layers.js, itself pure ESM). No createRequire,
// no .cjs, no framework import — the same client-safety bar as
// features/invoices/model.js/registry.js.
//
// Built-in presets only (design-layer plan L2/plan L2 "no custom theme
// creation", this round's "no JSON import/export"): a theme overrides
// fonts/colors/paper/margins, never DOM structure or layout system, and
// `normalizeTheme()` only ever hands back one of the three frozen presets
// below (or null) — it never trusts a persisted object's own color/font
// values, so a hand-edited localStorage blob can't smuggle in arbitrary CSS.
//
// This file does NOT touch features/invoices/render.js — wiring
// `themeToCss`/`themeFontsHref`/`normalizeTheme` into the renderer (the
// `data-invoice-theme` marker on <html>/<body>, the theme <style> block, the
// Letter/A4 print geometry) is Lane T's job (Q3). Q0 only establishes the
// contract and its three real presets.

import { GOOGLE_FONT_CATALOG } from '../../text-layers.js';

export const THEME_SCHEMA_VERSION = 1;

const MARGIN_MM = { tight: 8, normal: 14, wide: 22 };

function fontEntry(catalogId) {
  return GOOGLE_FONT_CATALOG.find((f) => f.id === catalogId) || null;
}

function fontFamilyCss(catalogId) {
  const entry = fontEntry(catalogId);
  return entry ? `'${entry.family}', ${entry.fallback}` : 'inherit';
}

// ── Built-in presets ────────────────────────────────────────────────────
// Every font id below must exist in GOOGLE_FONT_CATALOG — theme-schema.test.js
// pins that. `why` is a short editor-facing rationale (design-layer plan
// §3.2's ThemePreset.why), shown in CoverCard's design picker (Lane T, Q3).
export const BUILTIN_THEME_PRESETS = [
  {
    id: 'ledger',
    label: 'Ledger',
    version: THEME_SCHEMA_VERSION,
    fonts: { display: 'ibm-plex-mono', body: 'work-sans', mono: 'ibm-plex-mono' },
    colors: {
      paper: '#f7f5ef', ink: '#14110c', inkSoft: '#5b5648', accent: '#1f6f4a', line: 'rgba(20,17,12,0.18)',
    },
    paper: 'letter',
    margins: 'normal',
    why: 'A green-accent accounting ledger look for formal bookkeeping.',
  },
  {
    id: 'editorial',
    label: 'Editorial',
    version: THEME_SCHEMA_VERSION,
    fonts: { display: 'playfair-display', body: 'work-sans', mono: 'space-mono' },
    colors: {
      paper: '#fbf9f5', ink: '#1a1512', inkSoft: '#544a41', accent: '#b5482f', line: 'rgba(26,21,18,0.15)',
    },
    paper: 'letter',
    margins: 'wide',
    why: 'A serif, generous-margin look for design and creative studios.',
  },
  {
    id: 'studio-dark',
    label: 'Studio Dark',
    version: THEME_SCHEMA_VERSION,
    fonts: { display: 'unbounded', body: 'space-grotesk', mono: 'jetbrains-mono' },
    colors: {
      paper: '#121212', ink: '#f5f5f0', inkSoft: '#b8b4ac', accent: '#7dd3fc', line: 'rgba(245,245,240,0.16)',
    },
    paper: 'fluid',
    margins: 'normal',
    why: 'A dark, on-screen-first document for digital-only delivery.',
  },
];

const BUILTIN_BY_ID = new Map(BUILTIN_THEME_PRESETS.map((t) => [t.id, t]));

// "Default" is `null` (design-layer plan L1) — never a preset object.
// normalizeTheme() only ever returns one of the three frozen builtins above
// (matched by id) or null; a raw object's own colors/fonts/paper/margins are
// never trusted, even if they look well-formed.
export function normalizeTheme(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return BUILTIN_BY_ID.get(raw.id) || null;
}

// A Google Fonts stylesheet href covering every distinct catalog font a
// theme uses — mirrors features/invoices/render.js's own <link> construction
// (see its renderInvoiceDocument()), so Lane T can drop this straight into
// the document <head> alongside (non-null themes) or instead of (theme fully
// replaces the default Doto/Space Grotesk/Space Mono trio — design-layer
// plan L3) the hardcoded default link.
export function themeFontsHref(theme) {
  if (!theme) return '';
  const ids = Array.from(new Set([theme.fonts?.display, theme.fonts?.body, theme.fonts?.mono].filter(Boolean)));
  const parts = ids
    .map((id) => fontEntry(id))
    .filter(Boolean)
    // Google Fonts' css2 endpoint wants spaces as literal '+', not %20 —
    // mirrors features/invoices/render.js's own hardcoded font <link>
    // ("family=Space+Grotesk:wght@...").
    .map((entry) => `family=${entry.family.replace(/ /g, '+')}:wght@${(entry.weights || [400]).join(';')}`);
  if (!parts.length) return '';
  return `https://fonts.googleapis.com/css2?${parts.join('&')}&display=swap`;
}

// CSS that retargets every hardcoded invoice selector render.js's INVOICE_CSS
// defines (root/body ground, cards, ink/soft-ink text, the paid status
// stamp, the balance rule, the payment-QR ground, and the
// display/mono/body font-family groups), scoped under a `[data-invoice-theme]`
// attribute selector AND its `html[data-invoice-theme]`/`body[...]` forms
// (design-layer plan §3.3: "use a theme marker on <html> or body only for
// non-null themes" — Lane T decides which element carries the attribute;
// this CSS matches either). Returns '' for theme:null — the untouched
// default renders with none of this, exactly as it does today.
export function themeToCss(theme) {
  if (!theme) return '';
  const id = theme.id;
  const sel = (inner) => `[data-invoice-theme="${id}"] ${inner}, html[data-invoice-theme="${id}"] ${inner}, body[data-invoice-theme="${id}"] ${inner}`;
  const displayFont = fontFamilyCss(theme.fonts?.display);
  const bodyFont = fontFamilyCss(theme.fonts?.body);
  const monoFont = fontFamilyCss(theme.fonts?.mono);
  const marginMm = MARGIN_MM[theme.margins] || MARGIN_MM.normal;
  const pageSize = theme.paper === 'letter' ? 'letter' : theme.paper === 'a4' ? 'a4' : '';
  const pageRule = pageSize ? `@page{size:${pageSize};margin:${marginMm}mm;}` : `@page{margin:${marginMm}mm;}`;

  return `
html[data-invoice-theme="${id}"], body[data-invoice-theme="${id}"], [data-invoice-theme="${id}"] {
  --bg:${theme.colors.paper}; --card:${theme.colors.paper}; --ink:${theme.colors.ink};
  --ink-soft:${theme.colors.inkSoft}; --line:${theme.colors.line}; --hl:${theme.colors.accent};
}
${sel('html')}, ${sel('body')} { background:${theme.colors.paper} !important; background-image:none !important; color:${theme.colors.ink}; }
${sel('.card')} { background:${theme.colors.paper}; }
${sel('.invoice-hero-sub')}, ${sel('.invoice-block-label')}, ${sel('.stat-row .k')}, ${sel('#invoice-contact-footer-section')},
${sel('.invoice-list')}, ${sel('.invoice-category-label')}, ${sel('.invoice-subitem-list li')}, ${sel('.invoice-chip')} { color:${theme.colors.inkSoft}; }
${sel('.invoice-hero-title')}, ${sel('.invoice-total-value')}, ${sel('.invoice-balance-value')} { font-family:${displayFont}; }
${sel('.invoice-hero-sub')}, ${sel('.invoice-block-label')}, ${sel('.invoice-fact dt')}, ${sel('.invoice-status')},
${sel('.invoice-balance-label')}, ${sel('.invoice-category-label')}, ${sel('.invoice-chip')}, ${sel('.invoice-due-of')},
${sel('.invoice-paid-mark')}, ${sel('.invoice-item-hours')}, ${sel('.invoice-item-rate')}, ${sel('.invoice-item-amount')},
${sel('.invoice-item-head > div')}, ${sel('.invoice-balance-currency')} { font-family:${monoFont}; }
${sel('.invoice-fact dd')}, ${sel('.invoice-item-name')}, ${sel('.invoice-item-detail')}, ${sel('.invoice-hero .meta .v')},
${sel('.invoice-recommendation-name')}, ${sel('.invoice-link')} { font-family:${bodyFont}; }
${sel('.invoice-status')} { border-color:${theme.colors.ink}; color:${theme.colors.ink}; }
${sel('.invoice-status.is-paid')} { background:${theme.colors.ink}; color:${theme.colors.paper}; }
${sel('.invoice-balance')} { border-top-color:${theme.colors.ink}; }
${sel('.invoice-item-head')} { border-bottom-color:${theme.colors.ink}; }
${sel('.invoice-fact')}, ${sel('.invoice-item-row')}, ${sel('.invoice-hero')}, ${sel('#invoice-contact-footer-section')},
${sel('.invoice-payment-qr')} { border-color:${theme.colors.line}; }
${sel('.invoice-payment-qr')} { background:${theme.colors.paper}; }
${pageRule}
`.trim();
}

export default { THEME_SCHEMA_VERSION, BUILTIN_THEME_PRESETS, normalizeTheme, themeToCss, themeFontsHref };
