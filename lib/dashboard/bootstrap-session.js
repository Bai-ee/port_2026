// Dashboard bootstrap/session helpers — client impersonation, the
// sessionStorage bootstrap cache, and the /api/dashboard/bootstrap
// fetch wrapper. Extracted from DashboardPage.jsx module scope
// (Phase 2 decomposition) — move-only, no behavior change.

export const IMPERSONATE_STORAGE_KEY = 'dashboard.impersonateClientId';
export const PENDING_DASHBOARD_SIGNUP_KEY = 'pending-dashboard-signup';
export const DASHBOARD_BOOTSTRAP_TIMEOUT_MS = 20_000;
export const DASHBOARD_BOOTSTRAP_CACHE_PREFIX = 'dashboard-bootstrap-cache-v1';
export function readImpersonateClientId() {
  if (typeof window === 'undefined') return null;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('as');
    if (fromUrl) {
      window.sessionStorage.setItem(IMPERSONATE_STORAGE_KEY, fromUrl);
      return fromUrl;
    }
    return window.sessionStorage.getItem(IMPERSONATE_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}
export function writeImpersonateClientId(clientId) {
  if (typeof window === 'undefined') return;
  try {
    if (clientId) window.sessionStorage.setItem(IMPERSONATE_STORAGE_KEY, clientId);
    else window.sessionStorage.removeItem(IMPERSONATE_STORAGE_KEY);
  } catch {}
}
export function withImpersonation(path, clientId) {
  if (!clientId) return path;
  const [base, hash = ''] = String(path).split('#');
  const joiner = base.includes('?') ? '&' : '?';
  return `${base}${joiner}as=${encodeURIComponent(clientId)}${hash ? `#${hash}` : ''}`;
}
export function getBootstrapCacheKey(user, impersonateId = null) {
  const uid = user?.uid || user?.email || 'anonymous';
  return `${DASHBOARD_BOOTSTRAP_CACHE_PREFIX}:${uid}:${impersonateId || 'self'}`;
}
export function readCachedDashboardBootstrap(user, impersonateId = null) {
  if (typeof window === 'undefined' || !user) return null;
  try {
    const raw = window.sessionStorage.getItem(getBootstrapCacheKey(user, impersonateId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
export function writeCachedDashboardBootstrap(user, impersonateId = null, data = null) {
  if (typeof window === 'undefined' || !user || !data) return;
  try {
    window.sessionStorage.setItem(getBootstrapCacheKey(user, impersonateId), JSON.stringify(data));
  } catch {}
}
export function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}
export async function fetchDashboardBootstrap(user, impersonateId = null) {
  const token = await withTimeout(
    user.getIdToken(),
    DASHBOARD_BOOTSTRAP_TIMEOUT_MS,
    'Dashboard auth token request timed out.'
  );
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DASHBOARD_BOOTSTRAP_TIMEOUT_MS);

  try {
    const response = await fetch(withImpersonation('/api/dashboard/bootstrap', impersonateId), {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status !== 401 && response.status !== 403) {
        const cached = readCachedDashboardBootstrap(user, impersonateId);
        if (cached) {
          return {
            ...cached,
            _bootstrapWarning: data?.error || 'Live dashboard data is unavailable; showing the last loaded dashboard state.',
          };
        }
      }
      throw new Error(data?.error || 'Could not load dashboard data.');
    }
    writeCachedDashboardBootstrap(user, impersonateId, data);
    return data;
  } catch (err) {
    const cached = readCachedDashboardBootstrap(user, impersonateId);
    if (cached) {
      const timedOut = err?.name === 'AbortError';
      return {
        ...cached,
        _bootstrapWarning: timedOut
          ? 'Live dashboard data timed out; showing the last loaded dashboard state.'
          : 'Live dashboard data is unavailable; showing the last loaded dashboard state.',
      };
    }
    if (err?.name === 'AbortError') {
      throw new Error('Dashboard data request timed out.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
export function readPendingDashboardSignup() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_DASHBOARD_SIGNUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}
export function clearPendingDashboardSignup() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(PENDING_DASHBOARD_SIGNUP_KEY);
}

// ── Modal step builder ───────────────────────────────────────────────────────
// Converts run state + progress into human-readable build steps for the modal.
// Step states: 'done' | 'active' | 'pending' | 'waiting' | 'sub' | 'pending-sub' | 'error'
