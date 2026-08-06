// studio-device-capture.cjs — Device Mockup element, Phase 2 (docs/plans/
// STUDIO-DEVICE-MOCKUP-ELEMENT-PLAN.md): Firestore cache + abuse guardrails
// for the PUBLIC website→device-screen capture route
// (app/api/public/studio-device-capture). The route is deliberately
// unauthenticated (owner decision, 2026-07-31 — HOLO PAPER is a public
// tool), so this module is the entire cost-control surface for a PAID
// browserless call:
//
//   1. URL+viewport result cache (24h) — repeat captures of the same site
//      are free and consume no quota.
//   2. Per-IP daily limit + global daily limit, enforced in one Firestore
//      transaction on a per-day quota doc. IPs are stored hashed (sha256/16)
//      — the quota doc never holds a raw address.
//
// Firestore-only on purpose: the browserless call, SSRF validation
// (safe-fetch.cjs validateUrl), and Storage write stay in the route, so
// this module unit-tests against fake-firestore.cjs with no network mocks
// — same DI seam (`__setTestContext`) as proof-render-jobs.cjs/media-jobs.cjs.

const crypto = require('crypto');
const realFb = require('./firebase-admin.cjs');

const CACHE_COLLECTION = 'studio_device_captures';
const QUOTA_COLLECTION = 'studio_device_capture_quota';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PER_IP_DAILY_LIMIT = 20;
const GLOBAL_DAILY_LIMIT = 200;

// Phase 7 — how long a recorded FULL-PAGE capture failure keeps steering the
// next capture of that same URL+viewport straight to the viewport variant.
// Long enough that a site which has never captured full-page stops burning
// ~84s of guaranteed-failing attempts on every export (measured:
// `hitloop.agency` desktop-full = 7+ consecutive HTTP 408s across four
// separate ladders, while the plain `desktop` viewport variant of the SAME
// url returned 200 in 7,978ms), short enough that a site which later becomes
// capturable is not downgraded to a non-scrolling screen forever.
const FULL_PAGE_FAILURE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Device viewport id -> browserless FULL-PAGE screenshot variant id
// (api/_lib/browserless.cjs SCREENSHOT_VARIANTS). Full-page on purpose: the
// element fakes scroll by panning texture.offset.y down one tall image —
// see factories.js deviceAnimate — so the capture must include the whole
// page, not one viewport-height slice.
const VIEWPORT_VARIANT_IDS = {
  desktop: 'desktop-full',
  mobile: 'mobile-full',
  tablet: 'tablet-full',
};

let _ctx = null;
function __setTestContext(ctxOverride) { _ctx = ctxOverride; }
function ctx() { return _ctx || realFb; }

function isSupportedViewport(viewport) {
  return Object.prototype.hasOwnProperty.call(VIEWPORT_VARIANT_IDS, viewport);
}

/** Deterministic cache/doc id for one URL+viewport combination. */
function captureCacheId(url, viewport) {
  return crypto.createHash('sha1').update(`${url}|${viewport}`).digest('hex');
}

/** Hashed, truncated IP — enough to rate-limit, never a stored raw address. */
function hashIp(ip) {
  return crypto.createHash('sha256').update(String(ip || 'unknown')).digest('hex').slice(0, 16);
}

function quotaDayKey(nowMs = Date.now()) {
  return new Date(nowMs).toISOString().slice(0, 10); // UTC day, e.g. 2026-07-31
}

/**
 * Reads the cache doc for `id`. Returns null when absent, otherwise
 * { fresh, doc } — `fresh` means capturedAt is within CACHE_TTL_MS, i.e.
 * servable without a recapture. A stale doc is still returned: the route
 * uses it as an honest fallback when a recapture attempt fails.
 */
async function readCachedCapture(id, nowMs = Date.now()) {
  const snap = await ctx().adminDb.collection(CACHE_COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  const doc = snap.data() || {};
  const capturedMs = Date.parse(doc.capturedAt || '');
  const fresh = Number.isFinite(capturedMs) && nowMs - capturedMs < CACHE_TTL_MS;
  return { fresh, doc };
}

/**
 * Atomically consumes one capture from today's quota. Returns
 * { allowed: true } or { allowed: false, reason: 'ip-limit' | 'global-limit' }.
 * Consumed BEFORE the browserless call and deliberately not refunded on a
 * failed capture — a failing capture still spent a browserless attempt, and
 * refund logic would let a crafted always-failing URL bypass the cap.
 */
async function consumeCaptureQuota({ ip, nowMs = Date.now() }) {
  const fb = ctx();
  const ipKey = hashIp(ip);
  const ref = fb.adminDb.collection(QUOTA_COLLECTION).doc(quotaDayKey(nowMs));
  let outcome = { allowed: true };
  await fb.adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? (snap.data() || {}) : {};
    const total = Number(data.total || 0);
    const perIp = Number((data.perIp || {})[ipKey] || 0);
    if (total >= GLOBAL_DAILY_LIMIT) { outcome = { allowed: false, reason: 'global-limit' }; return; }
    if (perIp >= PER_IP_DAILY_LIMIT) { outcome = { allowed: false, reason: 'ip-limit' }; return; }
    tx.set(ref, { total: total + 1, perIp: { ...(data.perIp || {}), [ipKey]: perIp + 1 } }, { merge: true });
  });
  return outcome;
}

/**
 * Phase 6 — the cache-serving decision, extracted as a pure function.
 *
 * The route has always accepted `refresh: true` ("the site changed, capture
 * it again"), but that branch lived inline in the Next route file, where it
 * could not be unit-tested. It is the ONLY user-reachable way out of a
 * cached capture that is fresh-but-wrong, so it gets real coverage.
 *
 * `cached` is readCachedCapture's return ({ fresh, doc } | null).
 * Returns { serve, reason } — `serve:true` means answer from the cache with
 * no quota consumed and no browserless call.
 */
function shouldServeCachedCapture({ cached, forceRefresh = false } = {}) {
  if (forceRefresh) return { serve: false, reason: 'force-refresh' };
  if (!cached) return { serve: false, reason: 'no-cache-entry' };
  // Phase 7: the storagePath test moved ABOVE the freshness test on purpose.
  // A cache doc used to exist only after a SUCCESS; markFullPageCaptureFailed
  // below now also writes one after a full-page FAILURE, carrying no bytes.
  // Checking "has bytes" first means such a doc is rejected as
  // `incomplete-cache-entry` (what it is) rather than `stale` (what it is
  // not), and — the load-bearing part — can never be served. Every verdict
  // for a doc that does have a storagePath is unchanged by the reorder.
  if (!cached.doc?.storagePath) return { serve: false, reason: 'incomplete-cache-entry' };
  if (!cached.fresh) return { serve: false, reason: 'stale' };
  return { serve: true, reason: 'fresh' };
}

/**
 * Phase 7 — "does this cache entry have real bytes behind it?"
 *
 * The route's honest-stale-fallback branches ("the recapture failed, serve
 * the expired one rather than nothing") used to test `cached?.doc`, which a
 * failure-marker-only doc satisfies. That would have answered ok:true with an
 * imageUrl for an object that does not exist — and the studio's
 * THREE.TextureLoader sees a 404 as an opaque decode failure, i.e. the exact
 * silent-placeholder class of bug Phase 5 fixed in the GET. So the fallback
 * question is this predicate, never doc-existence.
 */
function hasStoredCapture(cached) {
  return Boolean(cached?.doc?.storagePath);
}

/**
 * Phase 7 — which variant this capture should LEAD with.
 *
 * Returns { strategy: 'full-page' | 'viewport-only', reason, fullPageFailedAt }.
 *
 * Full-page is the default and stays the default for any URL with no
 * recorded failure: it is genuinely better output (the device element fakes
 * scroll by panning texture.offset.y down one tall image, which a
 * viewport-height texture cannot do). This only ever demotes the lead variant
 * for a URL+viewport that has ALREADY been measured to fail full-page, and
 * only inside FULL_PAGE_FAILURE_TTL_MS.
 *
 * `fullPageFailedAt` is echoed back so the route can PRESERVE the original
 * failure timestamp when it stores a viewport-only capture — refreshing it on
 * every successful viewport capture would make regular use of the site extend
 * its own downgrade indefinitely.
 *
 * `forceRefresh` (the route's existing `refresh: true` / the control's FORCE
 * FRESH toggle) ALWAYS retries full-page. Without that, a marker written from
 * one bad day would be a second write-once-serve-forever trap with no
 * user-reachable way out — the exact failure mode this module's own comments
 * keep warning about — and the user would have no way to ask for the
 * scrollable full-page screen back. It is an explicit, opt-in toggle, so the
 * ~84s it can cost is spent only when someone deliberately asks for it; the
 * automatic export-time capture never sends it.
 */
function planCaptureStrategy({ cached, forceRefresh = false, nowMs = Date.now() } = {}) {
  if (forceRefresh) return { strategy: 'full-page', reason: 'force-refresh', fullPageFailedAt: null };
  const raw = cached?.doc?.fullPageFailedAt || null;
  const failedMs = Date.parse(raw || '');
  if (!Number.isFinite(failedMs)) return { strategy: 'full-page', reason: 'no-recorded-failure', fullPageFailedAt: null };
  if (nowMs - failedMs >= FULL_PAGE_FAILURE_TTL_MS) {
    return { strategy: 'full-page', reason: 'failure-marker-expired', fullPageFailedAt: null };
  }
  return { strategy: 'viewport-only', reason: 'full-page-failed-recently', fullPageFailedAt: raw };
}

/**
 * Phase 7 — records that FULL-PAGE capture of this URL+viewport failed.
 *
 * MERGE, never a whole-doc set: this can run when a stale-but-valid capture
 * doc already exists, and overwriting it would delete the storagePath the
 * route is about to serve as its honest fallback. The written doc carries no
 * `capturedAt` and no `storagePath`, so it reads as
 * `incomplete-cache-entry` everywhere (see shouldServeCachedCapture /
 * hasStoredCapture) — a marker is never a capture.
 */
async function markFullPageCaptureFailed(id, { url, viewport, nowMs = Date.now() } = {}) {
  await ctx().adminDb.collection(CACHE_COLLECTION).doc(id).set({
    url, viewport,
    fullPageFailedAt: new Date(nowMs).toISOString(),
  }, { merge: true });
}

// ── Phase 6 — blank-capture rejection ────────────────────────────────────
// A capture that comes back as a flat, featureless frame is a FAILED
// capture, and writing it to the 24h cache is what turns one transient
// failure into a permanently wrong device screen (the cache TTL gates
// re-capture, never serving, and nothing in this repo ever deletes a
// capture doc or its storage object). So the buffer is inspected BEFORE it
// is persisted.
//
// What is deliberately NOT used as a signal: "a full-page request that came
// back exactly viewport-height is a failed capture." That heuristic is
// wrong and was measured wrong — https://example.com/ captures as a
// perfectly correct 1440x900 full-page JPEG because that page genuinely is
// one viewport tall. Short pages are legitimate.
//
// Thresholds are calibrated against the five real captures in this repo's
// own `studio_device_captures` collection rather than guessed:
//
//   synthetic flat white frame   stdev 0.00   non-background 0.0000
//   example.com (sparsest real)  stdev 9.56   non-background 0.0427
//   vercel.com / wikipedia / critters.quest — higher on both
//
// Rejecting under stdev 1.0 AND non-background 0.005 leaves a ~9x margin
// beneath the sparsest legitimate page, so this only ever catches a frame
// that is effectively one flat colour.
const BLANK_STDEV_MAX = 1.0;
const BLANK_NON_BACKGROUND_MAX = 0.005;
const BLANK_PROBE_SIZE = 64;
// Manhattan distance in 0-255 RGB before a pixel counts as "not the
// background" — above JPEG ringing/gradient noise, well below real text.
const BACKGROUND_DISTANCE = 24;

/**
 * Rejects a capture that is effectively a single flat colour.
 *
 * Returns { ok, reason, stdev, nonBackgroundFraction }.
 *
 * FAILS OPEN by design: if `sharp` cannot be loaded (bundling/tracing) or
 * the buffer cannot be decoded, this returns ok:true with a reason — a
 * quality check must never be the reason a working capture is thrown away.
 *
 * `loadSharp` is DI-injectable purely so a test can exercise the fail-open
 * path without uninstalling a dependency.
 */
async function assessCaptureContent(buffer, { loadSharp = () => require('sharp') } = {}) {
  if (!buffer || !buffer.length) return { ok: false, reason: 'empty-buffer' };
  let sharp;
  try {
    sharp = loadSharp();
  } catch {
    return { ok: true, reason: 'not-assessable-no-decoder' };
  }
  try {
    const stats = await sharp(buffer).stats();
    const stdev = Math.max(...stats.channels.map((c) => Number(c.stdev) || 0));

    const size = BLANK_PROBE_SIZE;
    const raw = await sharp(buffer)
      .resize(size, size, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer();

    // Modal colour at 5-bit-per-channel quantization = the background.
    const counts = new Map();
    for (let i = 0; i < raw.length; i += 3) {
      const key = ((raw[i] >> 3) << 10) | ((raw[i + 1] >> 3) << 5) | (raw[i + 2] >> 3);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    let bestKey = 0;
    let bestCount = -1;
    for (const [key, count] of counts) {
      if (count > bestCount) { bestCount = count; bestKey = key; }
    }
    const bg = [((bestKey >> 10) & 31) << 3, ((bestKey >> 5) & 31) << 3, (bestKey & 31) << 3];

    let differing = 0;
    const total = raw.length / 3;
    for (let i = 0; i < raw.length; i += 3) {
      const dist = Math.abs(raw[i] - bg[0]) + Math.abs(raw[i + 1] - bg[1]) + Math.abs(raw[i + 2] - bg[2]);
      if (dist > BACKGROUND_DISTANCE) differing += 1;
    }
    const nonBackgroundFraction = total ? differing / total : 0;

    if (stdev < BLANK_STDEV_MAX && nonBackgroundFraction < BLANK_NON_BACKGROUND_MAX) {
      return { ok: false, reason: 'blank-capture', stdev, nonBackgroundFraction };
    }
    return { ok: true, reason: 'has-content', stdev, nonBackgroundFraction };
  } catch (err) {
    return { ok: true, reason: `not-assessable-${String(err?.message || err).slice(0, 60)}` };
  }
}

/**
 * Persists/overwrites the cache doc after a successful capture+store.
 *
 * Deliberately a WHOLE-DOC set (not a merge): that is what makes a successful
 * FULL-PAGE capture clear any `fullPageFailedAt` marker for free — omit the
 * field and the proof-of-failure is gone in the same write that proves it
 * wrong, with no delete, no second write, and no window where a stale marker
 * outlives it. Callers that captured at viewport height pass the marker back
 * in `fullPageFailedAt` so the downgrade survives (Phase 7).
 */
async function saveCaptureCacheDoc(id, { url, viewport, storagePath, contentType, sizeBytes, nowMs = Date.now(), fullPageFailedAt = null }) {
  await ctx().adminDb.collection(CACHE_COLLECTION).doc(id).set({
    url, viewport, storagePath, contentType,
    sizeBytes: Number(sizeBytes || 0),
    capturedAt: new Date(nowMs).toISOString(),
    ...(fullPageFailedAt ? { fullPageFailedAt } : null),
  });
}

module.exports = {
  CACHE_COLLECTION,
  QUOTA_COLLECTION,
  CACHE_TTL_MS,
  FULL_PAGE_FAILURE_TTL_MS,
  PER_IP_DAILY_LIMIT,
  GLOBAL_DAILY_LIMIT,
  VIEWPORT_VARIANT_IDS,
  isSupportedViewport,
  captureCacheId,
  hashIp,
  quotaDayKey,
  readCachedCapture,
  shouldServeCachedCapture,
  hasStoredCapture,
  planCaptureStrategy,
  markFullPageCaptureFailed,
  assessCaptureContent,
  BLANK_STDEV_MAX,
  BLANK_NON_BACKGROUND_MAX,
  consumeCaptureQuota,
  saveCaptureCacheDoc,
  __setTestContext,
};
