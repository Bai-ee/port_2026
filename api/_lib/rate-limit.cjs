'use strict';

const fb = require('./firebase-admin.cjs');

const COLLECTION = '_rate_limits';

/**
 * Firestore-backed sliding-window rate limiter.
 *
 * @param {object} opts
 * @param {string} opts.key       - Unique rate-limit key (e.g. "anon:1.2.3.4:create-payment-intent")
 * @param {number} opts.limit     - Max requests per window
 * @param {number} opts.windowSeconds - Window duration in seconds
 * @returns {{ allowed: boolean, remaining: number }}
 */
async function checkRateLimit({ key, limit, windowSeconds }) {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const safeKey = key.replace(/[^a-zA-Z0-9:@._-]/g, '_').slice(0, 200);
  const ref = fb.adminDb.collection(COLLECTION).doc(safeKey);

  try {
    return await fb.adminDb.runTransaction(async (tx) => {
      const doc = await tx.get(ref);

      if (!doc.exists) {
        tx.set(ref, { count: 1, windowStart: now, expiresAt: now + windowMs });
        return { allowed: true, remaining: limit - 1 };
      }

      const data = doc.data();

      if (now - data.windowStart >= windowMs) {
        tx.set(ref, { count: 1, windowStart: now, expiresAt: now + windowMs });
        return { allowed: true, remaining: limit - 1 };
      }

      if (data.count >= limit) {
        return { allowed: false, remaining: 0 };
      }

      const next = (data.count || 0) + 1;
      tx.update(ref, { count: next, expiresAt: now + windowMs });
      return { allowed: true, remaining: limit - next };
    });
  } catch (err) {
    // Fail open on Firestore errors — log and allow
    console.error('[rate-limit] Firestore error, failing open:', err?.message || err);
    return { allowed: true, remaining: limit };
  }
}

/**
 * Extract the real client IP from Vercel/proxy headers.
 */
function getClientIp(request) {
  const fwd = typeof request.headers?.get === 'function'
    ? request.headers.get('x-forwarded-for')
    : (request.headers?.['x-forwarded-for'] || null);
  if (fwd) return String(fwd).split(',')[0].trim();

  const real = typeof request.headers?.get === 'function'
    ? request.headers.get('x-real-ip')
    : (request.headers?.['x-real-ip'] || null);
  return real ? String(real).trim() : 'unknown';
}

module.exports = { checkRateLimit, getClientIp };
