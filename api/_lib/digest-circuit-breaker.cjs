'use strict';

// digest-circuit-breaker.cjs — per-client consecutive DELIVERY-failure
// breaker for the daily digest. Trips only on repeated DELIVERY failures
// (Resend rejecting/never accepting the send after retries are exhausted),
// never on a Scout/LLM error — a bad refresh already degrades to last-good
// data and must not be conflated with "we cannot reach this client at all."
//
// Deliberately stored separate from digest_config.schedule.enabled: tripping
// the breaker must never silently flip the user's own daily-email toggle,
// and resetting it must never re-enable a schedule the user turned off on
// purpose. Both live on the same digest_config/{clientId} doc as different
// top-level fields so a config read stays a single doc fetch.

const realFb = require('./firebase-admin.cjs');

const THRESHOLD = 3; // consecutive terminal delivery failures before pausing new paid refreshes
const FIELD = 'deliveryBreaker';

let _ctx = null;
function __setTestContext(ctx) { _ctx = ctx; }
function ctx() { return _ctx || realFb; }

function docRef(clientId) {
  return ctx().adminDb.collection('digest_config').doc(clientId);
}

const DEFAULT_STATE = {
  consecutiveFailures: 0,
  pausedAt: null,
  pausedReason: null,
  lastFailureAt: null,
  lastResetAt: null,
  lastResetBy: null,
};

function nextBreakerState(rawState, { ok, now = new Date().toISOString() } = {}) {
  const state = { ...DEFAULT_STATE, ...(rawState && typeof rawState === 'object' ? rawState : {}) };
  if (ok) {
    return { ...state, consecutiveFailures: 0, pausedAt: null, pausedReason: null };
  }
  const consecutiveFailures = (state.consecutiveFailures || 0) + 1;
  const tripped = consecutiveFailures >= THRESHOLD;
  return {
    ...state,
    consecutiveFailures,
    lastFailureAt: now,
    pausedAt: tripped ? (state.pausedAt || now) : state.pausedAt,
    pausedReason: tripped
      ? `Paid refresh paused after ${consecutiveFailures} consecutive delivery failures.`
      : state.pausedReason,
  };
}

async function getBreakerState(clientId) {
  if (!clientId) return { ...DEFAULT_STATE };
  const snap = await docRef(clientId).get();
  const raw = snap.exists ? snap.data()?.[FIELD] : null;
  return { ...DEFAULT_STATE, ...(raw && typeof raw === 'object' ? raw : {}) };
}

async function isRefreshPaused(clientId) {
  const state = await getBreakerState(clientId);
  return Boolean(state.pausedAt);
}

/**
 * Call once per digest cycle's TERMINAL delivery outcome — `sent`, or
 * retries exhausted (`terminal-failure`). Never for an in-progress
 * `retry-wait`: a delivery that eventually succeeds after retrying must
 * reset the counter, not have counted as a failure along the way.
 */
async function recordDeliveryOutcome(clientId, { ok }) {
  if (!clientId) return null;
  const ref = docRef(clientId);
  return ctx().adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const raw = snap.exists ? snap.data()?.[FIELD] : null;
    const next = nextBreakerState(raw, { ok });
    tx.set(ref, { [FIELD]: next }, { merge: true });
    return next;
  });
}

/**
 * Explicit admin reset. The CALLER is responsible for verifying transport is
 * healthy first (e.g. RESEND_API_KEY present) — this module only clears
 * state so it stays independently testable; the admin route is where the
 * "transport healthy" precondition is enforced.
 */
async function resetBreaker(clientId, { actorUid = null } = {}) {
  if (!clientId) return null;
  const now = new Date().toISOString();
  const next = { ...DEFAULT_STATE, lastResetAt: now, lastResetBy: actorUid || null };
  await docRef(clientId).set({ [FIELD]: next }, { merge: true });
  return next;
}

// Global emergency kill switch for digest refreshes — env only, defaults to
// normal operation (unset / anything other than '1'). See .env.example.
function isGlobalKillSwitchEnabled() {
  return String(process.env.DIGEST_REFRESH_KILL_SWITCH || '').trim() === '1';
}

module.exports = {
  THRESHOLD,
  FIELD,
  DEFAULT_STATE,
  __setTestContext,
  nextBreakerState,
  getBreakerState,
  isRefreshPaused,
  recordDeliveryOutcome,
  resetBreaker,
  isGlobalKillSwitchEnabled,
};
