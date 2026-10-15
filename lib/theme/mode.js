// Shared mode rule: used by the runtime AND mirrored (ES5) by the pre-paint
// bootstrap. Keep the two in lock-step; bootstrap-parity tests enforce it.

import { PREFERENCES } from './constants.js';

/** Returns `value` when it is a valid preference, else the (normalised) fallback. */
export function normalizePreference(value, fallback = 'light') {
  if (typeof value === 'string' && PREFERENCES.includes(value)) return value;
  if (typeof fallback === 'string' && PREFERENCES.includes(fallback)) return fallback;
  return 'light';
}

/** Resolve a preference to a concrete mode. */
export function resolveMode(preference, systemPrefersDark) {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference === 'dark' ? 'dark' : 'light';
}
