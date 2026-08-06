'use strict';

// proof-render-live-url.cjs — Studio Deterministic Final Render, "Live URL
// wired to Final Render" wiring round. A small, directly-testable SSRF gate
// for a Proof/Final Render job's `devicePrimary.liveUrl` — applied at
// app/api/dashboard/proof-render/route.js BEFORE the recipe is normalized
// and persisted onto a job. Mirrors the SAME guardrail
// app/api/public/studio-device-capture/route.js already applies to a
// user-submitted URL (https-default scheme when none is given, then
// safe-fetch.cjs's own validateUrl) so both entry points that turn a
// browser-typed URL into a server-side fetch target share one SSRF policy
// — never a second, independently-drifting implementation.
//
// This module deliberately does NOT decide "is a live screen wanted at
// all" — that stays art-render-validation.mjs's job (checkCapabilities'
// `device-screen-live` check, which already treats a present-but-malformed
// liveUrl as a precise, honest capability rejection). This module only
// answers "if a liveUrl string was submitted, is it safe/normalized" — an
// absent/blank liveUrl is simply not this module's concern (returns
// `undefined`, meaning "nothing to validate," so the existing capability
// gate is what rejects a device scene that wanted live with no URL at all).

const { validateUrl: realValidateUrl } = require('./safe-fetch.cjs');

/**
 * Resolves and SSRF-validates a raw `devicePrimary.liveUrl` string.
 *
 * Returns `undefined` when there is nothing to validate (non-string, blank,
 * or whitespace-only input) — the caller leaves the recipe's own liveUrl
 * field untouched in this case.
 *
 * Returns the normalized, SSRF-validated URL string on success — a bare
 * domain (no scheme) is prefixed with `https://` first, matching this
 * repo's own established default for a browser-typed site URL (see
 * studio-device-capture/route.js and ClothStudio.jsx's own live-iframe
 * `src` normalization).
 *
 * Throws a clean `Error` (no `SSRF_BLOCKED:` prefix leaked, `.status = 400`)
 * on an unsafe/unusable URL — the caller surfaces `err.message` directly as
 * a precise rejection.
 *
 * `validateUrl` is DI-injectable (defaults to the real safe-fetch.cjs
 * implementation, which performs a real DNS lookup) purely so tests never
 * need real network/DNS access.
 */
async function resolveDeviceLiveUrl(rawUrl, { validateUrl = realValidateUrl } = {}) {
  if (typeof rawUrl !== 'string') return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const validated = await validateUrl(withScheme);
    return validated.toString();
  } catch (err) {
    const message = String(err?.message || err).replace(/^SSRF_BLOCKED:\s*/, '');
    const e = new Error(`devicePrimary.liveUrl can't be captured: ${message}`);
    e.status = 400;
    throw e;
  }
}

module.exports = { resolveDeviceLiveUrl };
