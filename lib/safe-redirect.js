// safe-redirect.js - post-login redirect targets must be same-origin relative paths.

/** Allow only "/path" (a single leading slash). Rejects "//host", "/\host", absolute URLs, control chars. */
export function safeRedirectPath(raw, fallback = '/dashboard') {
  if (typeof raw !== 'string') return fallback;
  const v = raw.trim();
  if (!v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\')) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(v)) return fallback;
  return v;
}
