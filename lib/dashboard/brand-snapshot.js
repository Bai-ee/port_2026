// Brand Snapshot draft helpers — style-guide <-> draft shape conversion
// for the brand-snapshot data tab. Extracted from DashboardPage.jsx
// module scope (Phase 2 decomposition) — move-only, no behavior change.

import { cloneJson } from './format-utils.js';

export function buildBrandSnapshotDraft(styleGuide) {
  const sg = cloneJson(styleGuide) || {};
  return {
    brandMark: {
      logoUrl: sg.assets?.logoUrl || '',
      alt: sg.assets?.logoAlt || 'Brand mark',
    },
    colors: {
      primary: {
        hex: sg.colors?.primary?.hex || '',
        role: sg.colors?.primary?.role || 'Primary brand color',
      },
      secondary: {
        hex: sg.colors?.secondary?.hex || '',
        role: sg.colors?.secondary?.role || 'Secondary / support color',
      },
      tertiary: {
        hex: sg.colors?.tertiary?.hex || '',
        role: sg.colors?.tertiary?.role || 'Accent color',
      },
      neutral: {
        hex: sg.colors?.neutral?.hex || '',
        role: sg.colors?.neutral?.role || 'Background / neutral color',
      },
    },
    typography: {
      headingSystem: {
        fontFamily: sg.typography?.headingSystem?.fontFamily || '',
        fontWeight: sg.typography?.headingSystem?.fontWeight || '',
        fontSize: sg.typography?.headingSystem?.fontSize || '',
      },
      bodySystem: {
        fontFamily: sg.typography?.bodySystem?.fontFamily || '',
        fontWeight: sg.typography?.bodySystem?.fontWeight || '',
        fontSize: sg.typography?.bodySystem?.fontSize || '',
      },
    },
    gradient: {
      from: sg.gradient?.from || sg.colors?.primary?.hex || '',
      to: sg.gradient?.to || sg.colors?.secondary?.hex || sg.colors?.neutral?.hex || '',
      angle: sg.gradient?.angle || '135deg',
    },
    summary: sg.summary || '',
  };
}
export function draftToStyleGuide(draft, fallbackStyleGuide = null) {
  const fallback = cloneJson(fallbackStyleGuide) || {};
  return {
    ...fallback,
    confidence: 'manual',
    source: 'brand-snapshot-data-tab',
    updatedByUser: true,
    summary: draft?.summary || fallback.summary || '',
    assets: {
      ...(fallback.assets || {}),
      logoUrl: draft?.brandMark?.logoUrl || '',
      logoAlt: draft?.brandMark?.alt || 'Brand mark',
    },
    colors: {
      ...(fallback.colors || {}),
      primary:   { ...(fallback.colors?.primary || {}),   ...(draft?.colors?.primary || {}) },
      secondary: { ...(fallback.colors?.secondary || {}), ...(draft?.colors?.secondary || {}) },
      tertiary:  { ...(fallback.colors?.tertiary || {}),  ...(draft?.colors?.tertiary || {}) },
      neutral:   { ...(fallback.colors?.neutral || {}),   ...(draft?.colors?.neutral || {}) },
    },
    typography: {
      ...(fallback.typography || {}),
      headingSystem: { ...(fallback.typography?.headingSystem || {}), ...(draft?.typography?.headingSystem || {}) },
      bodySystem:    { ...(fallback.typography?.bodySystem || {}),    ...(draft?.typography?.bodySystem || {}) },
    },
    gradient: {
      ...(fallback.gradient || {}),
      ...(draft?.gradient || {}),
    },
  };
}
export function colorInputValue(value, fallback = '#000000') {
  const raw = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw.slice(1).split('').map((ch) => `${ch}${ch}`).join('')}`;
  }
  return fallback;
}
