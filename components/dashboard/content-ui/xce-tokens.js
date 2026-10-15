// Content Engine design tokens — plain constants shared by the ui/* primitives.
// Values are theme-token references (`var(--t-*)`), so they follow the viewer's light/dark
// preference. The shared `xce-*` stylesheet (ContentUiStyles.jsx) uses the same tokens.

export const XCE_COLORS = {
  ink: 'var(--t-text)',
  inkSoft: 'color-mix(in srgb, var(--t-text) 62%, transparent)',
  inkMuted: 'color-mix(in srgb, var(--t-text) 50%, transparent)',
  surface: 'var(--t-surface)',
  surfaceMuted: 'var(--t-inset)',
  border: 'color-mix(in srgb, var(--t-text) 12%, transparent)',
  borderStrong: 'color-mix(in srgb, var(--t-text) 24%, transparent)',
  onInk: 'var(--t-surface)',
  green: 'var(--t-success)',
  greenBg: 'var(--t-success-bg)',
  greenBorder: 'var(--t-success-border)',
  amber: 'var(--t-warning)',
  amberBg: 'var(--t-warning-bg)',
  amberBorder: 'var(--t-warning-border)',
  blue: 'var(--t-info)',
  blueBg: 'var(--t-info-bg)',
  blueBorder: 'var(--t-info-border)',
  red: 'var(--t-danger)',
  redBg: 'var(--t-danger-bg)',
  redBorder: 'var(--t-danger-border)',
  greyBg: 'color-mix(in srgb, var(--t-text) 6%, transparent)',
  greyBorder: 'color-mix(in srgb, var(--t-text) 14%, transparent)',
};

export const XCE_RADII = { sm: 8, md: 12, lg: 16, pill: 999 };

export const XCE_SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export const XCE_TYPE = {
  mono: 'var(--font-mono)',
  label: { fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' },
};

export const XCE_SHADOWS = {
  card: '0 1px 2px rgba(31,29,27,0.04)',
  nav: '0 -1px 0 rgba(31,29,27,0.08)',
};

// Height of the mobile bottom nav, excluding the safe-area inset. Pad the body by this.
export const XCE_NAV_HEIGHT = 60;

// The thin rule under the card header.
export const XCE_GRADIENT_RULE = 'linear-gradient(90deg, var(--t-accent-bright) 0%, var(--t-support-1) 55%, var(--t-support-2) 100%)';
