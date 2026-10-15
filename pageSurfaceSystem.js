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
