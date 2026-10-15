// Theme Studio constants (contract §7.1). Pure data, no side effects.

export const SCHEMA_ID = 'hitloop.theme';
export const SCHEMA_VERSION = 1;
export const MODES = Object.freeze(['light', 'dark']);
export const PREFERENCES = Object.freeze(['light', 'dark', 'system']);

// Master hue (OKLCH degrees) of the baseline preset; the scene "follow" model
// measures hue shift relative to it (contract §9.1).
export const BASELINE_MASTER_HUE = 201;

export const STORAGE_KEYS = Object.freeze({
  pref: 'theme:pref:v1',
  draft: 'theme-studio:draft:v1',
  active: 'theme-studio:active:v1',
  draftCss: 'theme-studio:draftcss:v1',
  draftScene: 'theme-studio:draftscene:v1',
  devStudio: 'theme-studio:dev:v1',
  debug: 'theme-studio:debug:v1',
  library: 'theme-studio:library:v1',
});

export const CHANNEL_NAME = 'theme-studio';

// Draft CSS persisted for pre-paint injection MUST begin with this exact marker
// (the bootstrap refuses anything else).
export const DRAFT_CSS_MARKER = '/* theme-draft v1 ';

// Every generated custom property is namespaced with this prefix.
export const TOKEN_PREFIX = '--t-';

export const CONTRAST_STATEMENT =
  'Automated contrast checks only; this is not a WCAG conformance claim.';

// Canonical decimal precision (contract §3).
export const DP_COLOR = 4; // l, c, a and other dimensionless numbers
export const DP_DEG = 2; // hue / degree fields
