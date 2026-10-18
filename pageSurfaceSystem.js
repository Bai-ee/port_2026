export const internalPagePanelSurfaceStyle = {
  background: 'var(--t-glass-soft)',
  border: '1px solid var(--t-glass-border)',
  boxShadow: '0 1px 0 color-mix(in srgb, var(--t-surface) 65%, transparent), inset 0 1px 0 color-mix(in srgb, var(--t-glass-highlight) 88.89%, transparent)',
};

export const internalPageGlassCardStyle = {
  ...internalPagePanelSurfaceStyle,
  backdropFilter: 'blur(28px)',
  WebkitBackdropFilter: 'blur(28px)',
};

// Opaque "cream paper" fill (the legacy nav cream). There is no opaque cream role in
// the theme, so the translucent chrome-strong role is composited over the page
// role: it follows the theme in both modes and stays opaque (floating previews
// must not let the page read through).
export const internalPageCreamPaperBackground =
  'linear-gradient(var(--t-chrome-strong), var(--t-chrome-strong)), var(--t-page)';

// Shared edge for the marquee-style modal cards (loading, run terminal, refresh…): a subtle 1px border,
// a faint top inner highlight and a faint bottom hairline, then the standard soft drop shadow.
export const marqueeCardEdgeStyle = {
  border: '1px solid var(--t-border-subtle)',
  boxShadow: '0 1px 0 var(--t-border-subtle), inset 0 1px 0 var(--t-glass-highlight), 0px 5px 10px rgba(0, 0, 0, 0.1), 0px 15px 30px rgba(0, 0, 0, 0.1), 0px 20px 40px rgba(0, 0, 0, 0.15)',
};

// Soft left/right fade for a scrolling marquee viewport — same stops as the dashboard hero
// marquee (#founders-hero-marquee-shell). A mask only reads alpha, so a token at 94% stands in for black.
const marqueeEdgeFadeGradient =
  'linear-gradient(90deg, transparent 0, color-mix(in srgb, var(--t-text) 94%, transparent) 8%, color-mix(in srgb, var(--t-text) 94%, transparent) 92%, transparent 100%)';
export const marqueeEdgeFadeStyle = {
  maskImage: marqueeEdgeFadeGradient,
  WebkitMaskImage: marqueeEdgeFadeGradient,
};
