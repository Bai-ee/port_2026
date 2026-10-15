// Public API of the theme engine (contract §7.1). Pure ESM; no window/document at import time.

export * from './constants.js';
export * from './mode.js';
export * from './color.js';
export * from './contrast.js';
export { CONTRAST_PAIRS, EXCLUDED_ROLES, THRESHOLDS } from './contrast-pairs.js';
export { ROLE_DEFS, ROLE_IDS, GROUPS, TERM_KINDS, getRoleDef, isRoleId } from './roles.js';
export { TOKEN_NAMES, ROLE_TOKEN_NAMES, COMPOSITE_TOKENS, tokenForRole } from './tokens.js';
export { BASELINE_DEFINITION, createBaseline } from './baseline.js';
export { resolveTheme, resolveBoth } from './resolve.js';
export { resolveScene, SCENE_REFERENCE } from './scene.js';
export {
  validateDefinition, parseDefinition, normalizeDefinition, canonicalize, hashDefinition,
} from './validate.js';
export { migrate, MIGRATIONS } from './migrate.js';
export * from './edit.js';
export { toCss } from './css.js';
export { buildReport, evaluateContrast, suggestFix, reportStatus } from './report.js';
export { toColorGuide, toColorGuideMarkdown, describeLink } from './guide.js';
export { exportThemeJson, importThemeJson, buildExportBundle } from './export.js';
export { getBootstrapScript, BOOTSTRAP_SCRIPT_HASH_NOTE } from './bootstrap-source.js';
