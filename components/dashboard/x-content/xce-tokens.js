// Content Engine design tokens — plain constants shared by the ui/* primitives.
// The shared `xce-*` stylesheet in XContentEngineCard.jsx uses the same values
// (literal copies, since that block is a CSS template). Change both together.

export const XCE_COLORS = {
  ink: '#1f1d1b',
  inkSoft: 'rgba(31,29,27,0.62)',
  inkMuted: 'rgba(31,29,27,0.5)',
  surface: '#ffffff',
  surfaceMuted: '#f6f5f3',
  border: 'rgba(31,29,27,0.12)',
  borderStrong: 'rgba(31,29,27,0.24)',
  onInk: '#ffffff',
  green: '#23684a',
  greenBg: 'rgba(47,158,107,0.12)',
  greenBorder: 'rgba(47,158,107,0.3)',
  amber: '#8a5a15',
  amberBg: 'rgba(183,121,31,0.09)',
  amberBorder: 'rgba(183,121,31,0.3)',
  blue: '#1f55a6',
  blueBg: 'rgba(40,105,200,0.1)',
  blueBorder: 'rgba(40,105,200,0.28)',
  red: '#9f1f17',
  redBg: 'rgba(159,31,23,0.07)',
  redBorder: 'rgba(159,31,23,0.28)',
  greyBg: 'rgba(31,29,27,0.06)',
  greyBorder: 'rgba(31,29,27,0.14)',
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
export const XCE_GRADIENT_RULE = 'linear-gradient(90deg, #22c7e8 0%, #8a5cf0 55%, #e23fb8 100%)';
