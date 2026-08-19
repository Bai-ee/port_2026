'use strict';

// digest-delivery.cjs — durable, idempotent email-delivery tracking for the
// daily digest. One doc per delivery ATTEMPT in `digest_deliveries`.
//
// Built after the 2026-08-15/16/17 "Email provider did not return an id."
// incident (see docs/source-of-truth/EMAIL-DIGEST-CARD.md's incident
// checkpoint). THIRD pass on this module — a review before deploy of the
// second pass (which fixed atomic claim/lock + timezone identity) found
// four more correctness gaps, all fixed here:
//
//   P1-1 a crashed sender left a delivery PERMANENTLY stuck in `sending` —
//        nothing ever recovered it (the sweep only queried `retry-wait`),
//        AND the unresolved-prior-delivery guard counted `sending` as
//        blocking forever, so a single crash could wedge that client's
//        paid refresh permanently. Fixed with a real send LEASE
//        (`sendLeaseOwner`/`sendLeaseExpiresAt`) set atomically inside the
//        SAME claim transaction; an EXPIRED lease is reclaimable (and
//        counted as recoverable-not-blocking); a LIVE lease is not.
//   P1-2 manual-send identity used `Date.now()`, not a stable per-action
//        key — a submission retried after an HTTP timeout could send a
//        second email, and the "first send of the day reuses the primary
//        occurrence" rule meant two different concurrent first sends could
//        silently collapse into one. Fixed: `resolveDeliveryIdentity` now
//        NEVER shares identity between the scheduled occurrence and any
//        manual send, and every manual send's id is derived deterministically
//        from a caller-supplied, stable-per-user-action `requestId` (see
//        components/AdminEmailModals.jsx — generated once per click, held
//        across retries of that click).
//   P1-3 the unresolved-prior-delivery guard sampled up to 20 delivery docs
//        with NO deterministic order — once a client exceeded 20 records, a
//        genuinely unresolved one could fall outside the window and get
//        missed. Fixed: replaced the collection query with an O(1),
//        EXACT, single-document read of a small per-client companion doc
//        (`digest_client_delivery_state/{clientId}`) maintained
//        transactionally on every stage write that enters/leaves an
//        unresolved state — no query, no sampling, no index at all.
//   P2-4 the due-retry sweep applied its scan cap BEFORE sorting by
//        nextRetryAt, so the cap could select an arbitrary page and starve
//        genuinely-oldest work. Fixed: a denormalized `dueSortKey` field
//        (nextRetryAt for retry-wait, sendLeaseExpiresAt for a freshly
//        claimed sending record) lets the DATABASE itself return the
//        oldest-due work first via a single-field range query + orderBy on
//        that SAME field — Firestore serves this off the automatic
//        single-field index, no composite index required (verified against
//        this repo's no-new-composite-index rule, see the site-recreate SSOT).
//
// Also verified against Resend's actual idempotency-key contract (fetched
// 2026-08-17, resend.com/docs/dashboard/emails/idempotency-keys): the
// `Idempotency-Key` header, exact keys are honored for 24 HOURS, a replay
// with the SAME payload returns the original id, a replay with a DIFFERENT
// payload under the same key 409s `invalid_idempotent_request`, and a
// genuinely concurrent duplicate 409s `concurrent_idempotent_requests`.
//
// Same lease/backoff shape as api/_lib/{media-jobs,clone-jobs}.cjs
// (established pattern in this repo), same __setTestContext seam, tested
// against the shared api/_lib/__tests__/fake-firestore.cjs harness (whose
// runTransaction is fully serialized — a stronger, deterministic stand-in
// for exactly this kind of "prove exactly one concurrent caller wins" test;
// its Query now also supports range operators, added alongside this pass).

const crypto = require('crypto');
const realFb = require('./firebase-admin.cjs');
const digestBreaker = require('./digest-circuit-breaker.cjs');

const COLLECTION = 'digest_deliveries';
// Per-client companion doc tracking which deliveries are currently
// unresolved (retry-wait, or sending with a still-live lease). One small
// doc per client, read/written transactionally alongside the delivery
// doc's own stage transitions — see writeStageTransactional/claimForSend.
const UNRESOLVED_COLLECTION = 'digest_client_delivery_state';
const STORAGE_PREFIX = 'digest-html';

const STAGES = [
  'scheduled',
  'transport-preflight',
  'refreshing',
  'generated',
  'delivery-pending',
  'sending',
  'sent',
  'retry-wait',
  'terminal-failure',
];

// Explicit stage-transition graph. `sent` has NO outgoing edges — nothing
// can move a delivered record to any other stage, ever. `terminal-failure`
// permits exactly one edge back to `sending`, reserved for an explicit
// manual retry override (the automated sweep only ever selects via
// `dueSortKey`, which is null for terminal-failure, so it can never
// re-enter one on its own).
const ALLOWED_TRANSITIONS = {
  scheduled: ['transport-preflight', 'refreshing', 'generated', 'delivery-pending', 'terminal-failure'],
  'transport-preflight': ['refreshing', 'terminal-failure'],
  refreshing: ['generated', 'terminal-failure'],
  generated: ['delivery-pending', 'terminal-failure'],
  'delivery-pending': ['sending', 'terminal-failure'],
  sending: ['sent', 'retry-wait', 'terminal-failure'],
  'retry-wait': ['sending', 'terminal-failure'],
  sent: [],
  'terminal-failure': ['sending'],
};

// Stages a claim may originate from WITHOUT needing a lease check.
// `sending` is handled separately in claimForSend (claimable only when its
// lease has expired — see P1-1).
const CLAIMABLE_FOR_SEND = new Set(['delivery-pending', 'retry-wait', 'terminal-failure']);

const TERMINAL_STAGES = new Set(['sent', 'terminal-failure']);

// Exponential backoff for delivery retries (network/5xx/429/malformed-2xx).
const BACKOFF_MS = [2 * 60_000, 10 * 60_000, 30 * 60_000, 60 * 60_000, 180 * 60_000];
const MAX_SEND_ATTEMPTS = 6;

// How long a refresh lock holds before it's considered abandoned (e.g. the
// function crashed mid-run) and a new attempt may take it over.
const REFRESH_LOCK_TTL_MS = 10 * 60_000;

// Send-lease TTL (P1-1). Chosen against the ACTUAL deployed maxDuration of
// every route that can hold a `sending` claim: app/api/admin/daily-digest
// (300s) and app/api/worker/digest-delivery-sweep (120s) — 300s is the
// longest the platform itself will let a legitimate send stay in flight
// before force-killing the function. sendViaResend's own fetch times out
// at 15s, so a healthy send resolves in well under a minute in practice.
// 6 minutes (360s) is comfortably longer than the 300s worst-case platform
// ceiling — a lease can NEVER be falsely reclaimed out from under a send
// the platform itself is still willing to let run — while still being
// short enough that a genuinely crashed sender is recovered within about
// one external-pinger cycle (6 min lease + up to 5 min until the next
// sweep tick ≈ 11 min worst case), nowhere close to the 24h Resend
// idempotency-key boundary.
const SEND_LEASE_TTL_MS = 6 * 60_000;

// Resend honors an Idempotency-Key for 24h (verified against Resend's docs,
// 2026-08-17). Stop retrying automatically comfortably before that boundary
// so a very-delayed retry (the only guaranteed wake-up on Vercel Hobby is a
// ~24h-apart daily cron) can never reuse an EXPIRED key, which Resend would
// treat as an unrelated new send rather than a safe duplicate-check replay.
const RESEND_IDEMPOTENCY_KEY_TTL_MS = 24 * 60 * 60 * 1000;
const IDEMPOTENCY_SAFETY_MARGIN_MS = 20 * 60 * 60 * 1000;

// Default retention for fully-resolved (`sent` / `terminal-failure`)
// delivery records + their stored HTML. Purge is exposed as a callable
// function; nothing in this repo invokes it on a schedule yet — see the
// incident doc's retention section for why (Hobby cron budget) and the
// explicit test proving the selection + deletion contract.
const DEFAULT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

// Safety cap on the due-work scan. Independent of `limit` (how many a
// caller wants to PROCESS this call) — this bounds the underlying Firestore
// query itself. Combined with dueSortKey ordering (P2-4), correctness never
// depends on this cap: the DB returns the oldest-due `limit` rows directly,
// so raising/lowering this cap only affects worst-case query cost, never
// which rows are selected.
const DUE_WORK_SCAN_CAP = 200;

// --- test seam ---------------------------------------------------------------
let _ctx = null;
function __setTestContext(ctx) { _ctx = ctx; }
function ctx() { return _ctx || realFb; }

function utcDateKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

// Local-calendar-day key in a given IANA timezone. Intl.DateTimeFormat is
// DST-aware by construction, so this is correct across spring-forward /
// fall-back transitions without any special-casing here. Mirrors the
// existing `localDateStr` helper in app/api/admin/daily-digest/route.js so
// the two never drift apart.
function localDateKey(ts = Date.now(), timeZone = 'America/Chicago') {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(ts));
  } catch {
    return utcDateKey(ts); // an invalid/unknown timezone string falls back rather than throwing
  }
}

function buildDeliveryId(clientId, dateKey) {
  return `${clientId}__${dateKey}`;
}

function buildManualAttemptId(clientId, dateKey, attemptKey) {
  return `${clientId}__${dateKey}__manual-${attemptKey}`;
}

// A manual send's identity key. Strips everything except URL/doc-id-safe
// characters and bounds the length — defense in depth against a malformed
// or oversized client-supplied requestId, never trusted verbatim.
function sanitizeRequestId(requestId) {
  return String(requestId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

function backoffForAttempt(attempt) {
  const idx = Math.max(0, Math.min(BACKOFF_MS.length - 1, Number(attempt || 1) - 1));
  return BACKOFF_MS[idx];
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function canTransition(fromStage, toStage) {
  if (!fromStage) return true; // bootstrap: no existing doc yet
  if (fromStage === toStage) return true; // idempotent re-mark is always harmless, including on `sent`
  return Boolean(ALLOWED_TRANSITIONS[fromStage]?.includes(toStage));
}

/** Pure — no I/O. The initial shape for a brand-new delivery record. */
function buildNewDeliveryDoc({ deliveryId, clientId, dateKey, source }) {
  const now = new Date().toISOString();
  return {
    deliveryId,
    clientId,
    dateKey,
    source: source || 'cron-scheduled',
    stage: 'scheduled',
    idempotencyKey: deliveryId,
    subject: null,
    recipient: null,
    htmlStoragePath: null,
    htmlHash: null,
    htmlBytes: 0,
    attempts: 0,
    maxAttempts: MAX_SEND_ATTEMPTS,
    nextRetryAt: null,
    dueSortKey: null,
    lastError: null,
    attemptLog: [],
    providerEmailId: null,
    refreshLockAt: null,
    refreshLockOwner: null,
    sendLeaseOwner: null,
    sendLeaseExpiresAt: null,
    createdAt: now,
    updatedAt: now,
    history: [{ stage: 'scheduled', at: now, note: null }],
  };
}

async function getDelivery(deliveryId) {
  if (!deliveryId) return null;
  const snap = await ctx().adminDb.collection(COLLECTION).doc(deliveryId).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Idempotent, CREATE-ONLY, transactional: creates the durable record for
 * (clientId, dateKey) [or an explicit deliveryId] BEFORE any paid work
 * starts. A second concurrent call for the same key can only ever OBSERVE
 * the record — it never resets progress.
 */
async function getOrCreateDelivery({ clientId, dateKey, source = 'cron-scheduled', deliveryId: explicitId } = {}) {
  if (!clientId) throw new Error('getOrCreateDelivery: clientId is required');
  const key = dateKey || utcDateKey();
  const deliveryId = explicitId || buildDeliveryId(clientId, key);
  const fb = ctx();
  const ref = fb.adminDb.collection(COLLECTION).doc(deliveryId);
  return fb.adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) return { id: deliveryId, ...snap.data() };
    const doc = buildNewDeliveryDoc({ deliveryId, clientId, dateKey: key, source });
    tx.set(ref, doc);
    return { id: deliveryId, ...doc };
  });
}

/**
 * Resolves WHICH delivery record a send should target (P1-C, hardened for
 * P1-2). `timeZone` should be the client's own configured digest timezone.
 *
 * - An explicit `requestedDeliveryId` (the admin "Retry delivery" action)
 *   always wins — that action targets one existing record, never mints one.
 * - `source !== 'manual-admin'` (the scheduled cron) always targets the
 *   day's PRIMARY occurrence (`clientId__dateKey`) — idempotent, exactly
 *   one per client per scheduled local day, no matter how many times
 *   invoked.
 * - A manual send NEVER shares identity with the scheduled occurrence, and
 *   NEVER derives its id from wall-clock time when a `requestId` is
 *   supplied. `requestId` must be generated ONCE per user action (e.g.
 *   `crypto.randomUUID()` in the browser, held across retries of that same
 *   click — see components/AdminEmailModals.jsx) — the delivery id is
 *   derived deterministically from it, so: (a) resubmitting the SAME action
 *   (an HTTP-timeout retry) resolves to the SAME record — one email, not
 *   two; (b) two DIFFERENT concurrent manual sends (two different
 *   requestIds) always get two distinct records — neither is ever silently
 *   dropped or merged. Falling back to a wall-clock timestamp when no
 *   requestId is supplied is a known, non-ideal compatibility path for any
 *   caller that doesn't pass one.
 */
async function resolveDeliveryIdentity({ clientId, timestampMs = Date.now(), timeZone = 'America/Chicago', source = 'cron-scheduled', requestedDeliveryId = null, requestId = null }) {
  if (requestedDeliveryId) return { deliveryId: requestedDeliveryId, isNewAttempt: false };
  const dateKey = localDateKey(timestampMs, timeZone);
  if (source !== 'manual-admin') {
    return { deliveryId: buildDeliveryId(clientId, dateKey), dateKey, isNewAttempt: false };
  }
  const sanitized = sanitizeRequestId(requestId);
  const attemptKey = sanitized || String(timestampMs);
  return { deliveryId: buildManualAttemptId(clientId, dateKey, attemptKey), dateKey, isNewAttempt: true };
}

/** Guarded stage transition (non-transactional; for bookkeeping marks that
 *  never touch unresolved-tracking or the send lease — `refreshing`,
 *  `generated`, etc.). Refuses (returns the record UNCHANGED) any move the
 *  transition graph doesn't allow. Send-relevant transitions
 *  (claim/retry-wait/sent/terminal-failure) go through claimForSend /
 *  writeStageTransactional instead, which also keep the companion
 *  unresolved-state doc consistent atomically. */
async function markStage(deliveryId, stage, patch = {}) {
  if (!STAGES.includes(stage)) throw new Error(`markStage: unknown stage "${stage}"`);
  const fb = ctx();
  const ref = fb.adminDb.collection(COLLECTION).doc(deliveryId);
  const snap = await ref.get();
  const prev = snap.exists ? snap.data() : null;
  if (prev && !canTransition(prev.stage, stage)) {
    return { id: deliveryId, ...prev }; // blocked — return current state, untouched
  }
  const history = Array.isArray(prev?.history) ? prev.history.slice(-24) : [];
  const { note, ...rest } = patch;
  history.push({ stage, at: new Date().toISOString(), note: note || null });
  await ref.set({ ...rest, stage, history, updatedAt: new Date().toISOString() }, { merge: true });
  return getDelivery(deliveryId);
}

/**
 * Transactional stage write that ALSO keeps the per-client
 * `digest_client_delivery_state` companion doc consistent — both writes
 * commit atomically together (or neither does). Firestore requires every
 * read in a transaction before any write, so both documents are read
 * first, then both are written.
 *
 * @param {object} [opts.unresolvedUpdate]
 *   `{ clear: true, clientId }` to remove this delivery from the client's
 *   unresolved set, or `{ clientId, dateKey, kind, leaseExpiresAt }` to
 *   add/update it.
 */
async function writeStageTransactional(deliveryId, stage, patch = {}, {
  unresolvedUpdate = null,
  expectedSendLeaseOwner = null,
  breakerOutcome = null,
} = {}) {
  if (!STAGES.includes(stage)) throw new Error(`writeStageTransactional: unknown stage "${stage}"`);
  const fb = ctx();
  const ref = fb.adminDb.collection(COLLECTION).doc(deliveryId);
  return fb.adminDb.runTransaction(async (tx) => {
    // ── reads first ──
    const snap = await tx.get(ref);
    const prev = snap.exists ? snap.data() : null;
    if (prev && !canTransition(prev.stage, stage)) return { id: deliveryId, ...prev };
    if (expectedSendLeaseOwner && prev?.sendLeaseOwner !== expectedSendLeaseOwner) {
      return { id: deliveryId, ...prev, __leaseRejected: true };
    }

    const clientIdForCompanion = unresolvedUpdate?.clientId || prev?.clientId;
    let companionRef = null;
    let companionData = null;
    if (unresolvedUpdate && clientIdForCompanion) {
      companionRef = fb.adminDb.collection(UNRESOLVED_COLLECTION).doc(clientIdForCompanion);
      const companionSnap = await tx.get(companionRef);
      companionData = companionSnap.exists ? companionSnap.data() : {};
    }

    let breakerRef = null;
    let breakerRaw = null;
    const breakerOutcomeKey = breakerOutcome
      ? `${stage}:${patch.attempts ?? prev?.attempts ?? 0}`
      : null;
    const shouldWriteBreaker = Boolean(
      breakerOutcome
      && breakerOutcome.clientId
      && prev?.breakerOutcomeKey !== breakerOutcomeKey,
    );
    if (shouldWriteBreaker) {
      breakerRef = fb.adminDb.collection('digest_config').doc(breakerOutcome.clientId);
      const breakerSnap = await tx.get(breakerRef);
      breakerRaw = breakerSnap.exists ? breakerSnap.data()?.[digestBreaker.FIELD] : null;
    }

    // ── writes after ──
    const history = Array.isArray(prev?.history) ? prev.history.slice(-24) : [];
    const { note, ...rest } = patch;
    history.push({ stage, at: new Date().toISOString(), note: note || null });
    const nextDoc = {
      ...rest,
      stage,
      history,
      updatedAt: new Date().toISOString(),
      ...(shouldWriteBreaker ? { breakerOutcomeKey } : {}),
    };
    tx.set(ref, nextDoc, { merge: true });

    if (companionRef) {
      const map = { ...(companionData?.unresolved || {}) };
      if (unresolvedUpdate.clear) {
        delete map[deliveryId];
      } else {
        map[deliveryId] = {
          dateKey: unresolvedUpdate.dateKey ?? prev?.dateKey ?? null,
          kind: unresolvedUpdate.kind,
          leaseExpiresAt: unresolvedUpdate.leaseExpiresAt || null,
        };
      }
      tx.set(companionRef, { unresolved: map, updatedAt: new Date().toISOString() }, { merge: true });
    }

    if (shouldWriteBreaker) {
      const nextBreaker = digestBreaker.nextBreakerState(breakerRaw, {
        ok: Boolean(breakerOutcome.ok),
      });
      tx.set(breakerRef, { [digestBreaker.FIELD]: nextBreaker }, { merge: true });
    }

    return { id: deliveryId, ...(prev || {}), ...nextDoc };
  });
}

/**
 * Atomically claims a delivery for a send attempt. Handles THREE cases in
 * one transaction: a fresh claim from `delivery-pending`/`retry-wait`/
 * `terminal-failure` (manual override), and — P1-1 — a RECLAIM of a
 * `sending` record whose send lease has EXPIRED (a crashed/killed sender).
 * A `sending` record with a still-LIVE lease is never claimable — that is
 * what stops two callers from ever sending the same delivery twice. FAILS
 * CLOSED — a transaction error returns null, never a claim.
 */
async function claimForSend(deliveryId, { now = Date.now() } = {}) {
  try {
    const fb = ctx();
    const ref = fb.adminDb.collection(COLLECTION).doc(deliveryId);
    return await fb.adminDb.runTransaction(async (tx) => {
      // ── reads first ──
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const data = snap.data();
      if (data.stage === 'sent') return { id: deliveryId, ...data, __alreadySent: true };

      const leaseExpiredSending = data.stage === 'sending'
        && Boolean(data.sendLeaseExpiresAt)
        && Date.parse(data.sendLeaseExpiresAt) <= now;
      const claimable = CLAIMABLE_FOR_SEND.has(data.stage) || leaseExpiredSending;
      if (!claimable) return null; // includes a `sending` record with a still-LIVE lease

      const companionRef = fb.adminDb.collection(UNRESOLVED_COLLECTION).doc(data.clientId);
      const companionSnap = await tx.get(companionRef);
      const companionData = companionSnap.exists ? companionSnap.data() : {};

      // ── writes after ──
      const leaseOwner = `${now}_${crypto.randomBytes(6).toString('hex')}`;
      const leaseExpiresAt = new Date(now + SEND_LEASE_TTL_MS).toISOString();
      const historyEntry = {
        stage: 'sending',
        at: new Date(now).toISOString(),
        note: leaseExpiredSending ? 'reclaimed abandoned send lease' : 'claimed for send',
      };
      const history = [...(Array.isArray(data.history) ? data.history.slice(-23) : []), historyEntry];
      const nextDoc = {
        stage: 'sending',
        history,
        updatedAt: new Date(now).toISOString(),
        sendLeaseOwner: leaseOwner,
        sendLeaseExpiresAt: leaseExpiresAt,
        dueSortKey: leaseExpiresAt, // if THIS attempt also dies, the new expiry becomes the next due-point
      };
      tx.set(ref, nextDoc, { merge: true });

      const map = { ...(companionData.unresolved || {}) };
      map[deliveryId] = { dateKey: data.dateKey, kind: 'sending', leaseExpiresAt };
      tx.set(companionRef, { unresolved: map, updatedAt: new Date(now).toISOString() }, { merge: true });

      return { id: deliveryId, ...data, ...nextDoc };
    });
  } catch {
    return null; // fail closed — an unverifiable claim is never a claim
  }
}

/**
 * Atomic, fenced refresh-concurrency lock. NOT a substitute for the 6h
 * scout freshness skip — this only blocks genuinely overlapping runs for
 * the same client/day. FAILS CLOSED: any Firestore error during the
 * transaction returns acquired:false, never a fallback "true".
 */
async function acquireRefreshLock(clientId, dateKey, { ttlMs = REFRESH_LOCK_TTL_MS, now = Date.now(), source = 'cron-scheduled' } = {}) {
  const key = dateKey || utcDateKey(now);
  const deliveryId = buildDeliveryId(clientId, key);
  const ownerId = `${now}_${crypto.randomBytes(6).toString('hex')}`;
  try {
    const fb = ctx();
    const ref = fb.adminDb.collection(COLLECTION).doc(deliveryId);
    const won = await fb.adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : null;
      const lockedAtMs = data?.refreshLockAt ? Date.parse(data.refreshLockAt) : 0;
      const isHeld = lockedAtMs && (now - lockedAtMs) < ttlMs;
      if (isHeld) return false;
      const base = data || buildNewDeliveryDoc({ deliveryId, clientId, dateKey: key, source });
      tx.set(ref, {
        ...base,
        refreshLockAt: new Date(now).toISOString(),
        refreshLockOwner: ownerId,
        updatedAt: new Date(now).toISOString(),
      }, { merge: true });
      return true;
    });
    if (!won) return { acquired: false, deliveryId, ownerId: null };
    return { acquired: true, deliveryId, ownerId };
  } catch (err) {
    // Fail closed — an unverifiable acquisition must never be treated as won.
    return { acquired: false, deliveryId, ownerId: null, error: err.message };
  }
}

/** Fenced release: clears the lock ONLY if `ownerId` matches the current
 *  holder. An old/expired invocation whose lock was already taken over by
 *  a newer owner can never clear that newer owner's lock. */
async function releaseRefreshLock(deliveryId, ownerId) {
  if (!deliveryId || !ownerId) return { released: false, reason: 'missing-args' };
  try {
    const fb = ctx();
    const ref = fb.adminDb.collection(COLLECTION).doc(deliveryId);
    return await fb.adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : null;
      if (!data || data.refreshLockOwner !== ownerId) return { released: false, reason: 'not-current-owner' };
      tx.set(ref, { refreshLockAt: null, refreshLockOwner: null, updatedAt: new Date().toISOString() }, { merge: true });
      return { released: true };
    });
  } catch (err) {
    return { released: false, error: err.message };
  }
}

/**
 * True when this client has another delivery still
 * genuinely unresolved. O(1): a single document read of the per-client
 * companion doc (`digest_client_delivery_state/{clientId}`) — EXACT, never
 * sampled, no collection query, no index of any kind (P1-3 fix). A
 * `sending` entry only counts while its recorded lease is still live — an
 * EXPIRED lease is recoverable, not blocking (P1-1's other half: a crash
 * can never wedge paid refresh permanently).
 */
async function hasUnresolvedPriorDelivery(clientId, { excludeDeliveryId = null, now = Date.now() } = {}) {
  if (!clientId) return false;
  const fb = ctx();
  const snap = await fb.adminDb.collection(UNRESOLVED_COLLECTION).doc(clientId).get();
  if (!snap.exists) return false;
  const map = snap.data()?.unresolved || {};
  return Object.entries(map).some(([deliveryId, info]) => {
    if (excludeDeliveryId && deliveryId === excludeDeliveryId) return false;
    if (info?.kind === 'sending') {
      return info.leaseExpiresAt ? Date.parse(info.leaseExpiresAt) > now : true;
    }
    return true; // retry-wait always blocks until resolved
  });
}

/**
 * Persist the finished render BEFORE attempting delivery. IMMUTABLE once
 * set: a delivery that already has a stored render is left completely
 * untouched by a second call. Transactional — closes the race between two
 * near-simultaneous callers for the SAME delivery id.
 */
async function storeRenderedHtml(deliveryId, { html, subject, recipient, leaseOwner = null }) {
  const existing = await getDelivery(deliveryId);
  if (existing?.htmlStoragePath) return existing; // fast path: already rendered, immutable, no Storage write attempted at all
  // Fence BEFORE the Storage upload: the upload happens outside the
  // transaction below, and two DIFFERENT renders racing the same path would
  // otherwise leave the object's bytes inconsistent with the winning
  // Firestore hash (a generation re-entry regenerates from fresher saved
  // data, so "identical bytes" can no longer be assumed). A caller holding
  // the generation lease passes its owner id; a stale owner is turned away
  // here, then again inside the transaction.
  if (leaseOwner && existing?.genLeaseOwner && existing.genLeaseOwner !== leaseOwner) {
    return { ...existing, __generationFenced: true };
  }

  const fb = ctx();
  const path = `${STORAGE_PREFIX}/${deliveryId}.html`;
  const buffer = Buffer.from(String(html || ''), 'utf8');
  const hash = sha256(html);

  await fb.adminStorage.bucket().file(path).save(buffer, { contentType: 'text/html; charset=utf-8' });

  const ref = fb.adminDb.collection(COLLECTION).doc(deliveryId);
  return fb.adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    if (data?.htmlStoragePath) return { id: deliveryId, ...data }; // another caller's write already won — immutable
    // In-transaction fence (authoritative): only the current generation-lease
    // owner may record a render while a lease is active.
    if (leaseOwner && data?.genLeaseOwner && data.genLeaseOwner !== leaseOwner) {
      return { id: deliveryId, ...data, __generationFenced: true };
    }
    if (data && !canTransition(data.stage, 'delivery-pending')) return { id: deliveryId, ...data };
    const history = Array.isArray(data?.history) ? data.history.slice(-24) : [];
    history.push({ stage: 'delivery-pending', at: new Date().toISOString(), note: 'render stored' });
    const patch = {
      htmlStoragePath: path,
      htmlHash: hash,
      htmlBytes: buffer.length,
      subject: subject || null,
      recipient: recipient || null,
      stage: 'delivery-pending',
      history,
      updatedAt: new Date().toISOString(),
    };
    tx.set(ref, patch, { merge: true });
    return { id: deliveryId, ...(data || {}), ...patch };
  });
}

// ── Generation lease (Phase 1 hardening) ─────────────────────────────────────
// Fences the GENERATION segment (collect → render → store) the same way the
// send lease fences transport: at most one worker regenerates a delivery at a
// time, so a sweep reclaim racing the daily fan-out (or two overlapping sweep
// ticks) can never produce two competing renders. TTL exceeds the platform's
// 300s function ceiling, so an expired lease always means a dead worker.
const GENERATION_LEASE_TTL_MS = 6 * 60_000;

async function claimGeneration(deliveryId, { now = Date.now(), ttlMs = GENERATION_LEASE_TTL_MS } = {}) {
  const fb = ctx();
  const ref = fb.adminDb.collection(COLLECTION).doc(deliveryId);
  const ownerId = `gen-${crypto.randomBytes(8).toString('hex')}`;
  return fb.adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, reason: 'not-found' };
    const data = snap.data() || {};
    if (data.stage === 'sent') {
      return { ok: false, reason: 'already-sent', stage: data.stage, providerEmailId: data.providerEmailId || null };
    }
    if (data.stage === 'terminal-failure') return { ok: false, reason: 'terminal-failure', stage: data.stage };
    // Render already stored → nothing to generate; the caller should go
    // straight to transport (sendFirstAttempt has its own send lease).
    if (data.htmlStoragePath) return { ok: false, reason: 'already-rendered', stage: data.stage };
    const activeUntil = Date.parse(data.genLeaseExpiresAt || '') || 0;
    if (data.genLeaseOwner && activeUntil > now) {
      return { ok: false, reason: 'generation-in-progress', stage: data.stage };
    }
    tx.set(ref, {
      genLeaseOwner: ownerId,
      genLeaseExpiresAt: new Date(now + ttlMs).toISOString(),
      updatedAt: new Date(now).toISOString(),
    }, { merge: true });
    return { ok: true, ownerId };
  });
}

async function releaseGeneration(deliveryId, ownerId) {
  if (!deliveryId || !ownerId) return;
  const fb = ctx();
  const ref = fb.adminDb.collection(COLLECTION).doc(deliveryId);
  await fb.adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    if ((snap.data() || {}).genLeaseOwner !== ownerId) return; // fenced: never clear another owner's lease
    tx.set(ref, { genLeaseOwner: null, genLeaseExpiresAt: null }, { merge: true });
  }).catch(() => { /* best-effort — TTL expiry recovers a missed release */ });
}

async function loadRenderedHtml(deliveryId) {
  const delivery = await getDelivery(deliveryId);
  if (!delivery?.htmlStoragePath) return null;
  const fb = ctx();
  const [buffer] = await fb.adminStorage.bucket().file(delivery.htmlStoragePath).download();
  return { html: buffer.toString('utf8'), subject: delivery.subject, recipient: delivery.recipient, delivery };
}

/**
 * Classify + persist the outcome of ONE send attempt. Appends a bounded,
 * SANITIZED attempt-log entry (status/provider-id/error code+message/
 * response-shape KEYS only). Enforces the 24h Resend idempotency-key safety
 * margin. Every branch also keeps the companion unresolved-state doc
 * consistent, atomically, via writeStageTransactional. Idempotent past
 * `sent`.
 */
async function recordSendAttempt(deliveryId, result, { leaseOwner = null } = {}) {
  const delivery = await getDelivery(deliveryId);
  if (!delivery) throw new Error(`recordSendAttempt: no delivery record ${deliveryId}`);
  if (delivery.stage === 'sent') return delivery;
  if (delivery.sendLeaseOwner && delivery.sendLeaseOwner !== leaseOwner) {
    return { ...delivery, __leaseRejected: true };
  }

  const attempts = (delivery.attempts || 0) + 1;
  const attemptEntry = {
    at: new Date().toISOString(),
    httpStatus: result.httpStatus ?? null,
    providerId: result.ok ? (result.id || null) : null,
    errorCode: result.ok ? null : (result.errorCode || null),
    errorMessage: result.ok ? null : String(result.reason || '').slice(0, 300),
    responseKeys: result.responseKeys || null,
    retryable: result.ok ? null : Boolean(result.retryable),
  };
  const attemptLog = [...(Array.isArray(delivery.attemptLog) ? delivery.attemptLog.slice(-9) : []), attemptEntry];
  const clearLease = { sendLeaseOwner: null, sendLeaseExpiresAt: null };

  if (result.ok) {
    return writeStageTransactional(deliveryId, 'sent', {
      attempts, attemptLog, ...clearLease,
      providerEmailId: result.id || null,
      lastError: null, nextRetryAt: null, dueSortKey: null,
      note: `accepted (${result.httpStatus ?? 'n/a'})`,
    }, {
      unresolvedUpdate: { clear: true, clientId: delivery.clientId },
      expectedSendLeaseOwner: leaseOwner,
      breakerOutcome: { clientId: delivery.clientId, ok: true },
    });
  }

  const maxAttempts = delivery.maxAttempts || MAX_SEND_ATTEMPTS;
  const firstAttemptMs = Date.parse(delivery.createdAt || '') || Date.now();
  const ageMs = Date.now() - firstAttemptMs;
  const withinIdempotencySafety = ageMs < IDEMPOTENCY_SAFETY_MARGIN_MS;

  if (result.retryable && attempts < maxAttempts && withinIdempotencySafety) {
    const delayMs = backoffForAttempt(attempts);
    const nextRetryAt = new Date(Date.now() + delayMs).toISOString();
    return writeStageTransactional(deliveryId, 'retry-wait', {
      attempts, attemptLog, ...clearLease,
      nextRetryAt, dueSortKey: nextRetryAt,
      lastError: { code: result.errorCode || result.reason || 'unknown', message: result.reason || 'send failed', retryable: true, httpStatus: result.httpStatus ?? null },
      note: `retryable failure, next attempt ${nextRetryAt}`,
    }, {
      unresolvedUpdate: { clientId: delivery.clientId, dateKey: delivery.dateKey, kind: 'retry-wait', leaseExpiresAt: null },
      expectedSendLeaseOwner: leaseOwner,
    });
  }

  const idempotencyExpired = result.retryable && attempts < maxAttempts && !withinIdempotencySafety;
  const note = idempotencyExpired
    ? 'idempotency-key safety window exceeded (>20h since first attempt) — stopping rather than risk a duplicate send with an expired key'
    : (result.retryable ? 'retry budget exhausted' : 'permanent failure');
  return writeStageTransactional(deliveryId, 'terminal-failure', {
    attempts, attemptLog, ...clearLease,
    nextRetryAt: null, dueSortKey: null,
    lastError: {
      code: idempotencyExpired ? 'idempotency-window-exceeded' : (result.errorCode || result.reason || 'unknown'),
      message: note,
      retryable: false,
      httpStatus: result.httpStatus ?? null,
    },
    note,
  }, {
    unresolvedUpdate: { clear: true, clientId: delivery.clientId },
    expectedSendLeaseOwner: leaseOwner,
    breakerOutcome: { clientId: delivery.clientId, ok: false },
  });
}

/**
 * The ONE place a send attempt is ever made — the first attempt, a
 * scheduled sweep retry, a reclaimed-abandoned-lease retry, and a manual
 * retry all funnel through this. claimForSend is the actual concurrency
 * fence (a single Firestore transaction): two overlapping callers for the
 * SAME delivery will have exactly one succeed.
 */
async function attemptSendCore(deliveryId, sendFn, { now = Date.now() } = {}) {
  const claimed = await claimForSend(deliveryId, { now });
  if (!claimed) return { ok: false, reason: 'no-delivery-record-or-not-claimable', deliveryId };
  if (claimed.__alreadySent) {
    return { ok: true, alreadySent: true, providerEmailId: claimed.providerEmailId, stage: 'sent', deliveryId, clientId: claimed.clientId };
  }
  if (claimed.stage !== 'sending') {
    return { ok: false, reason: 'claim-failed (already claimed or not claimable)', deliveryId, stage: claimed.stage };
  }

  const loaded = await loadRenderedHtml(deliveryId);
  if (!loaded) {
    await recordSendAttempt(deliveryId, {
      ok: false,
      retryable: false,
      reason: 'no-stored-render',
      errorCode: 'no-stored-render',
      httpStatus: null,
      responseKeys: null,
    }, { leaseOwner: claimed.sendLeaseOwner }).catch(() => {});
    return { ok: false, reason: 'no-stored-render', deliveryId };
  }

  const result = await sendFn({
    subject: loaded.subject,
    html: loaded.html,
    to: loaded.recipient,
    idempotencyKey: loaded.delivery.idempotencyKey,
  });
  const updated = await recordSendAttempt(deliveryId, result, { leaseOwner: claimed.sendLeaseOwner });
  return { ...result, stage: updated.stage, deliveryId, clientId: claimed.clientId };
}

/** First-ever send attempt for a delivery already at `delivery-pending`. */
async function sendFirstAttempt(deliveryId, sendFn, opts = {}) {
  return attemptSendCore(deliveryId, sendFn, opts);
}

/** Manual "Retry delivery" — reuses the stored render, sends under the SAME
 *  idempotency key, never touches Anthropic. Also the path that reclaims
 *  an abandoned `sending` lease when targeted explicitly. */
async function retryDeliveryNow(deliveryId, { sendFn, now } = {}) {
  return attemptSendCore(deliveryId, sendFn, { now });
}

/**
 * Every delivery currently actionable — a due retry (`retry-wait` whose
 * `nextRetryAt` has passed) OR a recoverable abandoned send (`sending`
 * whose lease has expired) — returned OLDEST-DUE FIRST, straight from the
 * database. `dueSortKey` is null for every stage that isn't currently
 * actionable, so the range filter excludes them entirely; ordering by that
 * SAME field needs no composite index (P2-4 fix — starvation is impossible
 * by construction, not by assuming a small collection).
 */
async function listDueWork({ now = Date.now(), limit = 25 } = {}) {
  const fb = ctx();
  const nowIso = new Date(now).toISOString();
  const snap = await fb.adminDb.collection(COLLECTION)
    .where('dueSortKey', '<=', nowIso)
    .orderBy('dueSortKey')
    .limit(Math.min(limit, DUE_WORK_SCAN_CAP))
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Concurrency-safe due-sweep. Retries every due `retry-wait` AND reclaims
 * every abandoned `sending` lease, oldest-due first, reusing stored
 * content under the SAME idempotency key — never a re-render, never a
 * second Anthropic call. Each candidate is claimed individually
 * (claimForSend's transaction) — overlapping sweep workers will have
 * exactly one succeed per candidate; the rest see a clean claim-failed and
 * skip. `onOutcome({clientId, ok})` fires only on a TERMINAL outcome this
 * sweep (`sent` or `terminal-failure`).
 */
async function sweepDueRetries({ sendFn, onOutcome, now = Date.now(), limit = 25 } = {}) {
  const due = await listDueWork({ now, limit });
  const results = [];
  for (const candidate of due) {
    // eslint-disable-next-line no-await-in-loop
    try {
      const outcome = await attemptSendCore(candidate.id, sendFn, { now });
      results.push({ deliveryId: candidate.id, clientId: candidate.clientId, ...outcome });
      if (outcome.stage === 'sent') await onOutcome?.({ clientId: candidate.clientId, ok: true });
      else if (outcome.stage === 'terminal-failure') await onOutcome?.({ clientId: candidate.clientId, ok: false });
    } catch (err) {
      results.push({ deliveryId: candidate.id, clientId: candidate.clientId, ok: false, error: err.message });
    }
  }
  return { swept: due.length, results };
}

// ── Stale-generation reclaim (Phase 1, EMAIL-REBUILD-PLAN.md) ────────────────
// A cron-scheduled occurrence killed BEFORE its render was stored (stage still
// `scheduled`/`refreshing`/`generated`) used to be unrecoverable: no stored
// HTML for the transport sweep, no lease, no dueSortKey — the day was silently
// lost. These helpers let the delivery sweep find such records and re-enter
// the per-client send (regeneration from saved data is free; the deterministic
// scheduled identity + transactional send claim make a re-entry duplicate-safe).
const RECLAIMABLE_GENERATION_STAGES = new Set(['scheduled', 'refreshing', 'generated']);
// Older than this since the last write ⇒ no function can still be running it
// (well past any maxDuration) AND past the normal refresh(12:35)→send(13:00+)
// cron gap, so the reclaim never fires during an ordinary healthy morning.
const GENERATION_STALE_AFTER_MS = 45 * 60_000;
// Younger than this since creation ⇒ still inside the Resend idempotency
// safety window, so a reclaimed send behaves exactly like the original would.
const GENERATION_RECLAIM_MAX_AGE_MS = IDEMPOTENCY_SAFETY_MARGIN_MS;

/** Pure predicate — exported for tests. `doc` is a delivery record. */
function isReclaimableGeneration(doc, now = Date.now(), {
  staleMs = GENERATION_STALE_AFTER_MS,
  maxAgeMs = GENERATION_RECLAIM_MAX_AGE_MS,
} = {}) {
  if (!doc || !RECLAIMABLE_GENERATION_STAGES.has(doc.stage)) return false;
  // Only unattended occurrences: a manual flow's bookkeeping (source
  // 'manual-admin') has an operator watching it — never auto-resend for them.
  if (doc.source !== 'cron-scheduled') return false;
  const updatedMs = Date.parse(doc.updatedAt || doc.createdAt || '') || 0;
  const createdMs = Date.parse(doc.createdAt || '') || 0;
  if (!updatedMs || !createdMs) return false;
  return (now - updatedMs) >= staleMs && (now - createdMs) <= maxAgeMs;
}

/**
 * Validate a reclaim target the sweep handed to the send route. The identity
 * a reclaim proceeds with comes from THE STUCK RECORD — never recomputed from
 * the current clock — so reclaiming yesterday-evening's stuck occurrence
 * advances that exact record (same id, same dateKey, same idempotency key)
 * instead of minting a brand-new current-day delivery at the wrong hour.
 */
function validateReclaimTarget(doc, { clientId = null, now = Date.now() } = {}) {
  if (!doc) return { ok: false, reason: 'not-found' };
  if (clientId && doc.clientId !== clientId) return { ok: false, reason: 'client-mismatch' };
  if (!isReclaimableGeneration(doc, now)) {
    return { ok: false, reason: `not-reclaimable (stage=${doc.stage || 'unknown'}, source=${doc.source || 'unknown'})` };
  }
  return { ok: true, identity: { clientId: doc.clientId, dateKey: doc.dateKey, deliveryId: doc.id, source: 'cron-scheduled' } };
}

/** Cron-scheduled deliveries stuck mid-generation, oldest first. */
async function listStuckScheduledGeneration({ now = Date.now(), limit = 2, staleMs, maxAgeMs } = {}) {
  const fb = ctx();
  const snap = await fb.adminDb.collection(COLLECTION)
    .where('stage', 'in', [...RECLAIMABLE_GENERATION_STAGES])
    .limit(50)
    .get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((d) => isReclaimableGeneration(d, now, { staleMs, maxAgeMs }))
    .sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')))
    .slice(0, limit);
}

// ── Retention / cleanup ──────────────────────────────────────────────────────
// No cron invokes these automatically in this pass.
//
// Two eligibility classes:
//  1. TERMINAL_STAGES (`sent` / `terminal-failure`) past the cutoff — the
//     normal case, a digest that finished one way or the other.
//  2. Abandoned BOOKKEEPING stages (`scheduled`/`transport-preflight`/
//     `refreshing`/`generated`/`delivery-pending`) past the cutoff. These
//     stages carry no lease and no dueSortKey — nothing ever automatically
//     revisits them (unlike `sending`, which has a lease, or `retry-wait`,
//     which has nextRetryAt). Found in the adversarial self-review: if the
//     refresh or send route crashes before ever reaching a lease-tracked or
//     terminal stage, the record would otherwise sit forever as an orphaned
//     doc with no recovery or cleanup path. The retention window (14 days)
//     is far longer than any legitimate refresh/render cycle (minutes), so
//     anything still here past it is unambiguously abandoned, never a
//     genuinely slow in-progress run.
const ABANDONED_BOOKKEEPING_STAGES = new Set(['scheduled', 'transport-preflight', 'refreshing', 'generated', 'delivery-pending']);

async function listDeliveriesOlderThan(cutoffMs, { limit = 50 } = {}) {
  const fb = ctx();
  const snap = await fb.adminDb.collection(COLLECTION).limit(500).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((d) => (TERMINAL_STAGES.has(d.stage) || ABANDONED_BOOKKEEPING_STAGES.has(d.stage))
      && (Date.parse(d.updatedAt || d.createdAt || '') || 0) < cutoffMs)
    .slice(0, limit);
}

async function purgeDelivery(deliveryId) {
  const fb = ctx();
  const delivery = await getDelivery(deliveryId);
  if (!delivery) return { purged: false, reason: 'not-found', deliveryId };
  if (!TERMINAL_STAGES.has(delivery.stage) && !ABANDONED_BOOKKEEPING_STAGES.has(delivery.stage)) {
    return { purged: false, reason: `not-eligible (stage=${delivery.stage})`, deliveryId };
  }
  if (delivery.htmlStoragePath) {
    await fb.adminStorage.bucket().file(delivery.htmlStoragePath).delete({ ignoreNotFound: true }).catch(() => {});
  }
  await fb.adminDb.collection(COLLECTION).doc(deliveryId).delete();
  return { purged: true, deliveryId };
}

async function purgeDeliveriesOlderThan(cutoffMs, opts = {}) {
  const candidates = await listDeliveriesOlderThan(cutoffMs, opts);
  const results = [];
  for (const c of candidates) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await purgeDelivery(c.id));
  }
  return { count: results.length, results };
}

module.exports = {
  COLLECTION,
  UNRESOLVED_COLLECTION,
  STAGES,
  ALLOWED_TRANSITIONS,
  MAX_SEND_ATTEMPTS,
  SEND_LEASE_TTL_MS,
  RESEND_IDEMPOTENCY_KEY_TTL_MS,
  IDEMPOTENCY_SAFETY_MARGIN_MS,
  DEFAULT_RETENTION_MS,
  __setTestContext,
  utcDateKey,
  localDateKey,
  buildDeliveryId,
  buildManualAttemptId,
  sanitizeRequestId,
  backoffForAttempt,
  canTransition,
  getDelivery,
  getOrCreateDelivery,
  resolveDeliveryIdentity,
  markStage,
  writeStageTransactional,
  claimForSend,
  acquireRefreshLock,
  releaseRefreshLock,
  hasUnresolvedPriorDelivery,
  storeRenderedHtml,
  loadRenderedHtml,
  recordSendAttempt,
  sendFirstAttempt,
  retryDeliveryNow,
  listDueWork,
  sweepDueRetries,
  isReclaimableGeneration,
  validateReclaimTarget,
  listStuckScheduledGeneration,
  GENERATION_STALE_AFTER_MS,
  claimGeneration,
  releaseGeneration,
  GENERATION_LEASE_TTL_MS,
  listDeliveriesOlderThan,
  purgeDelivery,
  purgeDeliveriesOlderThan,
};
