export const internalPagePanelSurfaceStyle = {
  background: 'rgba(255,255,255,0.5)',
  border: '1px solid rgba(212, 196, 171, 0.82)',
  boxShadow: '0 1px 0 rgba(255,255,255,0.65), inset 0 1px 0 rgba(255,255,255,0.4)',
};

export const internalPageGlassCardStyle = {
  ...internalPagePanelSurfaceStyle,
  backdropFilter: 'blur(28px)',
  WebkitBackdropFilter: 'blur(28px)',
};
