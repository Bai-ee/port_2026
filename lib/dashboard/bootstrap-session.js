// Dashboard bootstrap/session helpers — client impersonation, the
// sessionStorage bootstrap cache, and the /api/dashboard/bootstrap
// fetch wrapper. Extracted from DashboardPage.jsx module scope
// (Phase 2 decomposition) — move-only, no behavior change.

export const IMPERSONATE_STORAGE_KEY = 'dashboard.impersonateClientId';
export const PENDING_DASHBOARD_SIGNUP_KEY = 'pending-dashboard-signup';
export const DASHBOARD_BOOTSTRAP_TIMEOUT_MS = 20_000;
export const DASHBOARD_BOOTSTRAP_CACHE_PREFIX = 'dashboard-bootstrap-cache-v1';
// A cache showing a client-blocking incident is always safe to fall back to,
// no matter how old — it can only ever be STICKY (the incident may since have
// been resolved server-side, self-corrects on the next live fetch), never
// hide one. A cache showing "healthy" is the opposite: it can only ever prove
// the dashboard was fine as of when it was written, never that a NEW
// incident hasn't opened since — see docs/plans/
// DASHBOARD_CREATION_FAILURE_UX_CLAUDE_PLAN.md §3. This bounds how long a
// "healthy" reading may be trusted without a fresh live check; long enough to
// ride out a real transient network blip, short enough that it can never
// silently mask an incident opened hours or days ago.
export const DASHBOARD_BOOTSTRAP_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
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
// Returns { data, cachedAtMs } or null — never the bare bootstrap object, so
// every caller is forced to reckon with the entry's age before trusting it.
export function readCachedDashboardBootstrap(user, impersonateId = null) {
  if (typeof window === 'undefined' || !user) return null;
  try {
    const raw = window.sessionStorage.getItem(getBootstrapCacheKey(user, impersonateId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'data' in parsed && 'cachedAtMs' in parsed) {
      return parsed;
    }
    // Back-compat with a cache entry written before this wrapper existed (a
    // bare bootstrap object) — treat its age as unknown/maximally stale
    // rather than crashing or silently trusting it forever.
    return { data: parsed, cachedAtMs: 0 };
  } catch {
    return null;
  }
}
export function writeCachedDashboardBootstrap(user, impersonateId = null, data = null) {
  if (typeof window === 'undefined' || !user || !data) return;
  try {
    window.sessionStorage.setItem(
      getBootstrapCacheKey(user, impersonateId),
      JSON.stringify({ data, cachedAtMs: Date.now() })
    );
  } catch {}
}
// A cached entry is safe to serve as a fallback when either: it is fresh
// enough that "no incident" is still a credible read of the live state, OR
// it already shows an open incident (safe regardless of age — see the
// MAX_AGE constant's comment above).
export function isCachedBootstrapUsable(cachedEntry) {
  if (!cachedEntry?.data) return false;
  if (cachedEntry.data.creationFailure?.status === 'open') return true;
  return (Date.now() - (cachedEntry.cachedAtMs || 0)) <= DASHBOARD_BOOTSTRAP_CACHE_MAX_AGE_MS;
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
      // An auth failure must never resurrect a stale cached session — tagged
      // so the outer catch (below) can never accidentally fall back to cache
      // for it either. Pre-existing gap: this throw used to land in the
      // outer catch, whose own fallback had no status check at all, so a
      // 401/403 could silently succeed off a stale cache despite this
      // branch's own exclusion looking correct in isolation.
      if (response.status === 401 || response.status === 403) {
        throw Object.assign(new Error(data?.error || 'Could not load dashboard data.'), { authFailure: true });
      }
      const cached = readCachedDashboardBootstrap(user, impersonateId);
      if (isCachedBootstrapUsable(cached)) {
        return {
          ...cached.data,
          _bootstrapWarning: data?.error || 'Live dashboard data is unavailable; showing the last loaded dashboard state.',
        };
      }
      throw new Error(data?.error || 'Could not load dashboard data.');
    }
    writeCachedDashboardBootstrap(user, impersonateId, data);
    return data;
  } catch (err) {
    if (err?.authFailure) throw err;
    const cached = readCachedDashboardBootstrap(user, impersonateId);
    if (isCachedBootstrapUsable(cached)) {
      const timedOut = err?.name === 'AbortError';
      return {
        ...cached.data,
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
