// Studio gating (contract §8.4).
//   production:  adminReady && isAdmin
//   development: (adminReady && isAdmin) || ?theme-studio=1  (remembered in sessionStorage)
// `nodeEnv` is process.env.NODE_ENV passed in by the caller (Next inlines it, so the development
// branch is dead code in production bundles). The escape hatch is evaluated ONLY when
// nodeEnv === 'development': production + ?theme-studio=1 is always false.

import { STORAGE_KEYS } from '../theme/constants.js';

export function hasStudioQuery(search) {
  if (typeof search !== 'string' || !search) return false;
  try {
    return new URLSearchParams(search.charAt(0) === '?' ? search.slice(1) : search).get('theme-studio') === '1';
  } catch { return false; }
}

export function isStudioEnabled({ isAdmin, adminReady, search, nodeEnv, sessionStorage } = {}) {
  const admin = !!(adminReady && isAdmin);
  if (admin) return true;
  if (nodeEnv !== 'development') return false;

  if (hasStudioQuery(search)) {
    try { if (sessionStorage) sessionStorage.setItem(STORAGE_KEYS.devStudio, '1'); } catch { /* ignore */ }
    return true;
  }
  try {
    return !!sessionStorage && sessionStorage.getItem(STORAGE_KEYS.devStudio) === '1';
  } catch { return false; }
}
