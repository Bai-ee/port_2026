// studio-device-capture.test.js — Device Mockup Phase 2 guardrails: the
// cache + quota module behind the PUBLIC (unauthenticated) capture route.
// Dependency-injected against fake-firestore.cjs (same seam as
// proof-render-jobs.test.js) — no live Firestore, no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeContext } = require('./fake-firestore.cjs');
const cap = require('../studio-device-capture.cjs');

function freshCtx() {
  const ctx = makeFakeContext();
  cap.__setTestContext(ctx);
  return ctx;
}
test.afterEach(() => cap.__setTestContext(null));

test('captureCacheId: deterministic per URL+viewport, distinct across viewports and URLs', () => {
  const a = cap.captureCacheId('https://example.com/', 'desktop');
  assert.equal(a, cap.captureCacheId('https://example.com/', 'desktop'));
  assert.match(a, /^[0-9a-f]{40}$/);
  assert.notEqual(a, cap.captureCacheId('https://example.com/', 'mobile'));
  assert.notEqual(a, cap.captureCacheId('https://other.com/', 'desktop'));
});

test('isSupportedViewport: exactly the three device viewports, mapped to full-page browserless variants', () => {
  for (const vp of ['desktop', 'mobile', 'tablet']) {
    assert.equal(cap.isSupportedViewport(vp), true);
    assert.match(cap.VIEWPORT_VARIANT_IDS[vp], /-full$/, 'must map to a FULL-PAGE variant — the scroll effect needs the whole page');
  }
  assert.equal(cap.isSupportedViewport('watch'), false);
  assert.equal(cap.isSupportedViewport(''), false);
});

test('readCachedCapture: null when absent; fresh within 24h; stale (but still returned) after', async () => {
  freshCtx();
  const id = cap.captureCacheId('https://example.com/', 'desktop');
  assert.equal(await cap.readCachedCapture(id), null);

  const now = Date.UTC(2026, 6, 31, 12, 0, 0);
  await cap.saveCaptureCacheDoc(id, {
    url: 'https://example.com/', viewport: 'desktop',
    storagePath: 'public/studio-device-captures/x.jpg', contentType: 'image/jpeg', sizeBytes: 123, nowMs: now,
  });

  const hit = await cap.readCachedCapture(id, now + 60 * 60 * 1000);
  assert.equal(hit.fresh, true);
  assert.equal(hit.doc.storagePath, 'public/studio-device-captures/x.jpg');

  const stale = await cap.readCachedCapture(id, now + cap.CACHE_TTL_MS + 1);
  assert.equal(stale.fresh, false, 'past the TTL the doc must read as stale');
  assert.ok(stale.doc, 'a stale doc is still returned — the route serves it when a recapture fails');
});

test('consumeCaptureQuota: per-IP limit trips first for one hammering IP, other IPs unaffected', async () => {
  freshCtx();
  const now = Date.UTC(2026, 6, 31, 12, 0, 0);
  for (let i = 0; i < cap.PER_IP_DAILY_LIMIT; i += 1) {
    const r = await cap.consumeCaptureQuota({ ip: '203.0.113.9', nowMs: now });
    assert.equal(r.allowed, true, `capture ${i + 1} within the per-IP limit must be allowed`);
  }
  const blocked = await cap.consumeCaptureQuota({ ip: '203.0.113.9', nowMs: now });
  assert.deepEqual(blocked, { allowed: false, reason: 'ip-limit' });
  const other = await cap.consumeCaptureQuota({ ip: '198.51.100.4', nowMs: now });
  assert.equal(other.allowed, true, 'a different IP still has its own budget');
});

test('consumeCaptureQuota: global daily cap blocks everyone; a new UTC day resets both budgets', async () => {
  const ctx = freshCtx();
  const now = Date.UTC(2026, 6, 31, 12, 0, 0);
  // Seed today's doc at the global cap directly (walking there IP-by-IP
  // would just re-test the per-IP case).
  await ctx.adminDb.collection(cap.QUOTA_COLLECTION).doc(cap.quotaDayKey(now)).set({ total: cap.GLOBAL_DAILY_LIMIT, perIp: {} });
  const blocked = await cap.consumeCaptureQuota({ ip: '198.51.100.4', nowMs: now });
  assert.deepEqual(blocked, { allowed: false, reason: 'global-limit' });

  const tomorrow = now + 24 * 60 * 60 * 1000;
  const fresh = await cap.consumeCaptureQuota({ ip: '198.51.100.4', nowMs: tomorrow });
  assert.equal(fresh.allowed, true, 'a new UTC day is a new quota doc');
});

test('hashIp: never stores the raw address, stable per input', () => {
  const h = cap.hashIp('203.0.113.9');
  assert.equal(h, cap.hashIp('203.0.113.9'));
  assert.match(h, /^[0-9a-f]{16}$/);
  assert.ok(!h.includes('203'), 'quota keys must not embed the raw IP');
  assert.notEqual(h, cap.hashIp('203.0.113.10'));
});

// ── Phase 6 — force re-capture + blank-capture rejection ─────────────────
// Both exist because of the same measured defect: this cache is
// write-once-serve-forever in practice (CACHE_TTL_MS gates re-capture, never
// serving, and nothing in this repo deletes a capture doc or its storage
// object), so a single wrong or blank capture becomes a permanently wrong
// device screen with no user-reachable way out.

const sharp = require('sharp');

test('shouldServeCachedCapture: serves only a fresh, complete entry — and forceRefresh always bypasses it (the poisoned-cache escape hatch)', () => {
  const fresh = { fresh: true, doc: { storagePath: 'public/studio-device-captures/x.jpg', capturedAt: '2026-08-04T00:00:00.000Z' } };
  const stale = { fresh: false, doc: { storagePath: 'public/studio-device-captures/x.jpg', capturedAt: '2026-08-01T00:00:00.000Z' } };

  assert.deepEqual(cap.shouldServeCachedCapture({ cached: fresh }), { serve: true, reason: 'fresh' });
  assert.equal(cap.shouldServeCachedCapture({ cached: stale }).serve, false, 'a stale entry must trigger a re-capture, not be served as current');
  assert.equal(cap.shouldServeCachedCapture({ cached: null }).serve, false);
  assert.equal(cap.shouldServeCachedCapture({ cached: { fresh: true, doc: {} } }).serve, false, 'a doc with no storagePath has no bytes to serve');

  // The escape hatch: refresh:true must win over an otherwise-servable entry.
  const forced = cap.shouldServeCachedCapture({ cached: fresh, forceRefresh: true });
  assert.deepEqual(forced, { serve: false, reason: 'force-refresh' });
});

// ── Phase 7 — never re-run a capture path this URL has already failed ────
// Measured (browserless_requests, free ledger read): `hitloop.agency`
// desktop-full = four separate 3-attempt ladders, every attempt HTTP 408,
// zero successes — while the plain `desktop` viewport variant of the SAME
// url returned 200 in 7,978ms. Leading with full-page there costs ~84s of
// guaranteed waste on every export, which the user experiences as
// "Export Video does nothing". The marker below is what stops that repeating.

test('planCaptureStrategy: full-page is the default and stays it — only a RECORDED, unexpired failure demotes the lead variant', () => {
  const now = Date.UTC(2026, 7, 4, 12, 0, 0);

  // No doc at all, and a normal successful capture doc: full-page. Full-page
  // is genuinely better output (the element pans a tall texture to fake
  // scroll), so it must never be given up speculatively.
  assert.equal(cap.planCaptureStrategy({ cached: null, nowMs: now }).strategy, 'full-page');
  assert.deepEqual(
    cap.planCaptureStrategy({ cached: { fresh: true, doc: { storagePath: 'x.jpg', capturedAt: new Date(now).toISOString() } }, nowMs: now }),
    { strategy: 'full-page', reason: 'no-recorded-failure', fullPageFailedAt: null },
  );

  // A failure recorded an hour ago: skip straight to viewport, and hand the
  // ORIGINAL timestamp back so the caller can preserve it.
  const failedAt = new Date(now - 60 * 60 * 1000).toISOString();
  assert.deepEqual(
    cap.planCaptureStrategy({ cached: { fresh: false, doc: { url: 'https://hitloop.agency/', viewport: 'desktop', fullPageFailedAt: failedAt } }, nowMs: now }),
    { strategy: 'viewport-only', reason: 'full-page-failed-recently', fullPageFailedAt: failedAt },
  );

  // Past the TTL the site gets a real full-page retry — a site that becomes
  // capturable must not be downgraded forever.
  const expired = { fresh: false, doc: { fullPageFailedAt: new Date(now - cap.FULL_PAGE_FAILURE_TTL_MS - 1).toISOString() } };
  assert.deepEqual(
    cap.planCaptureStrategy({ cached: expired, nowMs: now }),
    { strategy: 'full-page', reason: 'failure-marker-expired', fullPageFailedAt: null },
  );

  // Garbage in the field is not a failure record.
  assert.equal(cap.planCaptureStrategy({ cached: { doc: { fullPageFailedAt: 'not-a-date' } }, nowMs: now }).strategy, 'full-page');

  // FORCE FRESH always retries full-page — the user-reachable way back to a
  // scrollable screen. Without it the marker would be a second
  // write-once-serve-forever trap.
  assert.deepEqual(
    cap.planCaptureStrategy({ cached: { doc: { fullPageFailedAt: failedAt } }, forceRefresh: true, nowMs: now }),
    { strategy: 'full-page', reason: 'force-refresh', fullPageFailedAt: null },
  );
});

test('a failure-marker-only doc is NEVER servable as a capture — the whole risk of putting the marker in the capture doc', async () => {
  const ctx = freshCtx();
  const now = Date.UTC(2026, 7, 4, 12, 0, 0);
  const id = cap.captureCacheId('https://hitloop.agency/', 'desktop');

  await cap.markFullPageCaptureFailed(id, { url: 'https://hitloop.agency/', viewport: 'desktop', nowMs: now });

  const marker = await cap.readCachedCapture(id, now);
  assert.ok(marker, 'the doc exists — which is exactly why the guards below matter');
  assert.equal(marker.doc.storagePath, undefined, 'a marker has no bytes behind it');

  // 1. Never served as a cache hit. (Reason names the real problem: the
  // entry is incomplete, not merely stale.)
  assert.deepEqual(cap.shouldServeCachedCapture({ cached: marker }), { serve: false, reason: 'incomplete-cache-entry' });

  // 2. Never used as the route's "honest stale fallback" — that branch would
  // answer ok:true with an imageUrl for an object that does not exist, and
  // the studio's TextureLoader sees a 404 as an opaque decode failure.
  assert.equal(cap.hasStoredCapture(marker), false);
  assert.equal(cap.hasStoredCapture(null), false);
  assert.equal(cap.hasStoredCapture({ doc: { storagePath: 'public/studio-device-captures/x.jpg' } }), true);

  // 3. It DOES steer the next capture away from full-page — the entire point.
  assert.equal(cap.planCaptureStrategy({ cached: marker, nowMs: now }).strategy, 'viewport-only');

  // And nothing else in the doc pretends to be a capture.
  const stored = (await ctx.adminDb.collection(cap.CACHE_COLLECTION).doc(id).get()).data();
  assert.equal(stored.capturedAt, undefined);
  assert.equal(stored.contentType, undefined);
});

test('markFullPageCaptureFailed MERGES — it can never destroy the storagePath of a capture the route is about to serve', async () => {
  freshCtx();
  const now = Date.UTC(2026, 7, 4, 12, 0, 0);
  const id = cap.captureCacheId('https://hitloop.agency/', 'desktop');
  await cap.saveCaptureCacheDoc(id, {
    url: 'https://hitloop.agency/', viewport: 'desktop',
    storagePath: 'public/studio-device-captures/x.jpg', contentType: 'image/jpeg', sizeBytes: 9, nowMs: now,
  });

  // A later re-capture attempt exhausts the full-page ladder and records it.
  await cap.markFullPageCaptureFailed(id, { url: 'https://hitloop.agency/', viewport: 'desktop', nowMs: now + 1000 });

  const after = await cap.readCachedCapture(id, now + 2000);
  assert.equal(after.doc.storagePath, 'public/studio-device-captures/x.jpg', 'the existing capture must survive the marker write');
  assert.equal(after.fresh, true, 'and still be servable as the honest fallback');
  assert.equal(cap.shouldServeCachedCapture({ cached: after }).serve, true);
  assert.equal(cap.planCaptureStrategy({ cached: after, nowMs: now + 2000 }).strategy, 'viewport-only');
});

test('saveCaptureCacheDoc: a full-page success CLEARS the marker in the same write; a viewport-height success preserves the ORIGINAL timestamp', async () => {
  freshCtx();
  const now = Date.UTC(2026, 7, 4, 12, 0, 0);
  const id = cap.captureCacheId('https://hitloop.agency/', 'desktop');
  const base = { url: 'https://hitloop.agency/', viewport: 'desktop', storagePath: 'public/studio-device-captures/x.jpg', contentType: 'image/jpeg', sizeBytes: 9 };

  await cap.markFullPageCaptureFailed(id, { ...base, nowMs: now });
  const originalMarker = (await cap.readCachedCapture(id, now)).doc.fullPageFailedAt;

  // Viewport-led capture a day later: full-page was never attempted, so
  // nothing new was learned — carrying the original timestamp keeps the TTL
  // running down instead of letting routine use extend the downgrade.
  await cap.saveCaptureCacheDoc(id, { ...base, nowMs: now + 24 * 60 * 60 * 1000, fullPageFailedAt: originalMarker });
  const kept = await cap.readCachedCapture(id, now + 24 * 60 * 60 * 1000);
  assert.equal(kept.doc.fullPageFailedAt, originalMarker, 'the downgrade must not renew itself on every viewport capture');
  assert.equal(kept.doc.storagePath, base.storagePath);
  assert.equal(cap.planCaptureStrategy({ cached: kept, nowMs: now + 24 * 60 * 60 * 1000 }).strategy, 'viewport-only');

  // A later FULL-PAGE success is proof the marker is out of date, and the
  // whole-doc write drops it — no delete, no second write, no window.
  await cap.saveCaptureCacheDoc(id, { ...base, nowMs: now + 48 * 60 * 60 * 1000 });
  const cleared = await cap.readCachedCapture(id, now + 48 * 60 * 60 * 1000);
  assert.equal(cleared.doc.fullPageFailedAt, undefined, 'a successful full-page capture must clear the marker');
  assert.equal(cap.planCaptureStrategy({ cached: cleared, nowMs: now + 48 * 60 * 60 * 1000 }).strategy, 'full-page');
});

test('assessCaptureContent: rejects a flat frame, accepts a sparse-but-real page, and never rejects on a decode/dependency failure', async () => {
  // A capture that came back as one flat colour — the failed capture that
  // must never reach the cache.
  const blank = await sharp({ create: { width: 480, height: 300, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .jpeg({ quality: 70 }).toBuffer();
  const blankVerdict = await cap.assessCaptureContent(blank);
  assert.equal(blankVerdict.ok, false);
  assert.equal(blankVerdict.reason, 'blank-capture');

  // The calibration case: https://example.com/ is the SPARSEST real capture
  // in this repo's own studio_device_captures collection (measured stdev
  // 9.56, non-background 0.0427 at the 64x64 probe) and is a perfectly
  // legitimate capture — an "is this mostly empty?" check must not reject
  // it. Approximated here by a light page with one small dark text band.
  const sparse = await sharp({ create: { width: 480, height: 300, channels: 3, background: { r: 240, g: 240, b: 242 } } })
    .composite([{
      input: await sharp({ create: { width: 240, height: 30, channels: 3, background: { r: 20, g: 20, b: 25 } } }).png().toBuffer(),
      top: 40, left: 96,
    }])
    .jpeg({ quality: 70 }).toBuffer();
  const sparseVerdict = await cap.assessCaptureContent(sparse);
  assert.equal(sparseVerdict.ok, true, 'a short/sparse page is a legitimate capture, not a failure');
  assert.ok(sparseVerdict.stdev > cap.BLANK_STDEV_MAX, 'sparse-page stdev must clear the blank threshold with margin');

  // Fails OPEN: an unreadable buffer or a missing decoder must never be the
  // reason a working capture is discarded.
  assert.equal((await cap.assessCaptureContent(Buffer.from('not an image'))).ok, true);
  const noDecoder = await cap.assessCaptureContent(blank, { loadSharp: () => { throw new Error('Cannot find module sharp'); } });
  assert.equal(noDecoder.ok, true);
  assert.equal(noDecoder.reason, 'not-assessable-no-decoder');

  // An empty buffer is the one hard reject — there is nothing to store.
  assert.equal((await cap.assessCaptureContent(Buffer.alloc(0))).ok, false);
});
