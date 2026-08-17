'use strict';

// digest-refresh-preflight.cjs — the ONE gate every paid digest refresh must
// pass before it is allowed to call Scout/LLM code. Fixes the failure mode
// where the pipeline kept spending money to generate an email that either
// (a) could never be delivered (RESEND_API_KEY missing/misconfigured), or
// (b) has already failed delivery repeatedly in a row for this client
// (tripped circuit breaker), or (c) already has an OLDER delivery stuck
// unresolved (still retrying / mid-send) — piling another paid morning on
// top of a backlog nobody has actually received yet. See the incident
// checkpoint in docs/source-of-truth/EMAIL-DIGEST-CARD.md.
//
// FAIL CLOSED by construction: every check below is wrapped so that a
// Firestore read error (breaker state, prior-delivery scan) is treated as a
// BLOCK, never silently ignored and treated as "healthy". A caller does not
// need its own try/catch around this function to get that guarantee.
//
// Generated content is never discarded by this gate: a client that is
// currently paused/blocked can still have its LAST successfully generated
// digest retried for delivery (see digest-delivery.cjs's sweep/retry path,
// which does not consult this preflight at all — retrying a stored render
// must never be blocked by a gate meant to stop NEW paid generation).

const breaker = require('./digest-circuit-breaker.cjs');
const digestDelivery = require('./digest-delivery.cjs');

function hasResendKey() {
  return Boolean(String(process.env.RESEND_API_KEY || '').trim());
}

/**
 * @param {string} clientId
 * @param {object} [opts]
 * @param {string} [opts.excludeDeliveryId] exact delivery to ignore; never excludes every attempt from the same day
 * @param {boolean} [opts.allowUnresolvedPrior]  explicit, authorized override (never set automatically anywhere in this repo today — reserved for a future deliberate admin action)
 * @returns {Promise<{ ok: boolean, reason: string|null }>}
 */
async function checkDigestRefreshPreflight(clientId, { excludeDeliveryId = null, allowUnresolvedPrior = false } = {}) {
  try {
    if (breaker.isGlobalKillSwitchEnabled()) {
      return { ok: false, reason: 'kill-switch-enabled (DIGEST_REFRESH_KILL_SWITCH=1)' };
    }
  } catch (err) {
    return { ok: false, reason: `kill-switch check failed: ${err.message}` };
  }

  if (!hasResendKey()) {
    return { ok: false, reason: 'transport-not-configured: RESEND_API_KEY missing' };
  }

  if (clientId) {
    try {
      const paused = await breaker.isRefreshPaused(clientId);
      if (paused) {
        const state = await breaker.getBreakerState(clientId);
        return { ok: false, reason: state.pausedReason || 'delivery breaker paused' };
      }
    } catch (err) {
      // Fail closed: an unreadable breaker state must block, not pass through.
      return { ok: false, reason: `breaker check failed: ${err.message}` };
    }

    if (!allowUnresolvedPrior) {
      try {
        const unresolved = await digestDelivery.hasUnresolvedPriorDelivery(clientId, { excludeDeliveryId });
        if (unresolved) {
          return { ok: false, reason: 'unresolved prior delivery: an earlier digest for this client is still retrying or mid-send' };
        }
      } catch (err) {
        return { ok: false, reason: `unresolved-prior-delivery check failed: ${err.message}` };
      }
    }
  }

  return { ok: true, reason: null };
}

module.exports = { checkDigestRefreshPreflight, hasResendKey };
