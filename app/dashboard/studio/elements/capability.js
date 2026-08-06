// Capability messaging — turns a catalog definition's `previewSupported` /
// `finalRenderSupported` flags into one explicit state so the UI never shows
// a control that pretends to work. Three states, checked in order of severity:
//
//   'unsupported-in-preview' — previewSupported is false. The live Studio
//     preview cannot render this element at all; controls must be hidden or
//     disabled, not just labeled.
//   'preview-only'           — previewSupported is true but finalRenderSupported
//     is false (glass-petal-sphere's actual state today: it's the real,
//     already-shipping glass mesh, but the Cloud Run final-frame renderer
//     doesn't consume it yet). Controls work; the element IS included in a
//     browser MP4/WebM export (that path just captures the live canvas —
//     it never reads this flag, see elements/video-export.js) — only the
//     separate, server-side Proof Render (Cloud Run final-frame) pipeline
//     doesn't consume it yet. CORRECTION (Codex review): the UI copy this
//     drives previously said "exports don't include this element yet",
//     which is only true of Proof Render, not of the browser export most
//     users actually mean by "export" — see StudioElementInspector.jsx.
//   'full'                   — both preview and final render are supported.
//
// Pure logic — no React — so it's unit-testable on its own.

export const CAPABILITY_STATES = {
  UNSUPPORTED_IN_PREVIEW: 'unsupported-in-preview',
  PREVIEW_ONLY: 'preview-only',
  FULL: 'full',
  UNKNOWN: 'unknown',
};

export function getCapabilityState(def) {
  if (!def) return CAPABILITY_STATES.UNKNOWN;
  if (!def.previewSupported) return CAPABILITY_STATES.UNSUPPORTED_IN_PREVIEW;
  if (!def.finalRenderSupported) return CAPABILITY_STATES.PREVIEW_ONLY;
  return CAPABILITY_STATES.FULL;
}

export const CAPABILITY_LABELS = {
  [CAPABILITY_STATES.UNSUPPORTED_IN_PREVIEW]: 'UNSUPPORTED IN PREVIEW',
  [CAPABILITY_STATES.PREVIEW_ONLY]: 'PREVIEW ONLY',
  [CAPABILITY_STATES.FULL]: null, // no badge needed — fully supported
  [CAPABILITY_STATES.UNKNOWN]: 'UNSUPPORTED IN PREVIEW',
};

export function getCapabilityLabel(def) {
  return CAPABILITY_LABELS[getCapabilityState(def)];
}
