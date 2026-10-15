// Token manifest (contract §4, §4.9). `TOKEN_NAMES` is the ordered union of all
// role variables and composite variables; toCss emits exactly this list.

import { ROLE_DEFS, getRoleDef } from './roles.js';

/** Composite (non-role) tokens in emit order (contract §4.9). */
export const COMPOSITE_TOKENS = Object.freeze([
  '--t-gradient-accent',
  '--t-term-bg',
  '--t-term-shadow',
  '--t-shadow-sm',
  '--t-shadow-md',
  '--t-shadow-lg',
  '--t-blend-deco',
  '--t-logo-blend',
  '--t-logo-filter',
  '--t-logo-filter-muted',
  '--t-scene-bg',
  '--t-scene-base',
  '--t-scene-secondary',
  '--t-scene-highlight',
  '--t-scene-fallback',
]);

export const ROLE_TOKEN_NAMES = Object.freeze(ROLE_DEFS.map((d) => d.css));

export const TOKEN_NAMES = Object.freeze([...ROLE_TOKEN_NAMES, ...COMPOSITE_TOKENS]);

export function tokenForRole(id) {
  const def = getRoleDef(id);
  return def ? def.css : null;
}
