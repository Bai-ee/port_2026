// PUBLIC website→device-screen capture for the Studio Device Mockup element
// (docs/plans/STUDIO-DEVICE-MOCKUP-ELEMENT-PLAN.md Phase 2). Deliberately
// unauthenticated — HOLO PAPER is a public tool (owner decision, 2026-07-31)
// — so every request runs the full guardrail stack in
// api/_lib/studio-device-capture.cjs: SSRF-validated URL (safe-fetch.cjs),
// 24h URL+viewport result cache (repeat captures are free), per-IP + global
// daily quotas, and captures ledgered in `browserless_requests` like every
// other browserless call (Operating Cost card visibility).
//
// POST { url, viewport } -> { ok, captureId, imageUrl, cached }
//   `imageUrl` is this route's own GET — SAME-ORIGIN on purpose, so the
//   WebGL texture load never depends on storage-bucket CORS headers (the
//   plan's flagged top risk).
// GET ?id=<captureId> -> the stored screenshot bytes (long CDN cache).
import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/* Dev only: evict the stateless capture/browserless modules so edits show
   without a dev-server restart (same pattern as brief-preview's STALE_CJS
   and hitloop-creative-brief). firebase-admin is deliberately NOT evicted —
   it holds live singletons. */
if (process.env.NODE_ENV !== 'production') {
  for (const key of Object.keys(require.cache)) {
    if (/api[\\/]_lib[\\/](studio-device-capture|browserless)\.cjs$/.test(key)) delete require.cache[key];
  }
}

const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { validateUrl } = require('../../../../api/_lib/safe-fetch.cjs');
const { captureScreenshotBuffer, FULL_PAGE_SCREENSHOT_VARIANTS, VIEWPORT_SCREENSHOT_VARIANTS } = require('../../../../api/_lib/browserless.cjs');
const { saveBufferArtifact } = require('../../../../api/_lib/storage-artifacts.cjs');
const {
  VIEWPORT_VARIANT_IDS, isSupportedViewport, captureCacheId,
  readCachedCapture, shouldServeCachedCapture, assessCaptureContent,
  consumeCaptureQuota, saveCaptureCacheDoc,
  hasStoredCapture, planCaptureStrategy, markFullPageCaptureFailed,
} = require('../../../../api/_lib/studio-device-capture.cjs');

// ── Phase 6 — capture budget, measured rather than assumed ───────────────
// The shared default ladder is 3 attempts at 45s / 60s / 60s plus 1s+2s
// backoff ≈ 168s. This route declares `maxDuration = 120`, so on any site
// that exhausts the ladder the Vercel function is KILLED before the ladder
// can return — the caller never receives the honest 502, just a dead
// request. Measured against `browserless_requests`: `https://hitloop.agency/`
// (the owner's own site) burned exactly that ladder, three separate times
// on 2026-08-04 (45s/60s/60s, all HTTP 408, all `desktop-full`), and there
// is no capture doc for it anywhere in `studio_device_captures` as a result.
// That is WHY the device scene was still carrying an old capture of a
// different site.
//
// So the ladder is bounded here to fit the declared budget:
//   attempt 1  42s  +1s backoff
//   attempt 2  42s
//   viewport fallback 25s
//   = ~110s, inside maxDuration with room for the quality check + store.
//
// ── Phase 7 — and stop paying that budget on a path already measured to
// fail for THIS url ──────────────────────────────────────────────────────
// The bound above is still ~110s of waiting for a site whose full-page
// capture has never once succeeded. `hitloop.agency` has now burned four
// separate `desktop-full` ladders in `browserless_requests` — every attempt
// HTTP 408 — while the plain `desktop` viewport variant of the SAME url
// returned 200 in 7,978ms. Leading with full-page there is ~84s of
// guaranteed waste on every export, forever, and 110 silent seconds is what
// the user experiences as "Export Video does nothing."
//
// So a full-page failure is now RECORDED per url+viewport
// (markFullPageCaptureFailed) and the next capture for that pair leads with
// the viewport variant instead (planCaptureStrategy). Full-page remains the
// default for every url with no recorded failure — it is the better output —
// and the marker expires (FULL_PAGE_FAILURE_TTL_MS) so a site that later
// becomes capturable is not downgraded forever.
const CAPTURE_MAX_ATTEMPTS = 2;
const CAPTURE_REQUEST_TIMEOUT_MS = 42000;
const CAPTURE_GOTO_TIMEOUT_MS = 18000;
const CAPTURE_FALLBACK_REQUEST_TIMEOUT_MS = 25000;
const CAPTURE_FALLBACK_GOTO_TIMEOUT_MS = 15000;
// Viewport-LED capture (the recorded-failure path): the same budget the
// fallback attempt already uses, but as the primary variant, so it gets the
// shared ladder's retry instead of a single shot. Worst case ~51s vs the
// full-page path's ~110s; the measured case is ~8s.
const CAPTURE_VIEWPORT_LED_MAX_ATTEMPTS = 2;

// Full-page id -> the SAME device's viewport-only id, for the last-resort
// fallback below.
const VIEWPORT_ONLY_VARIANT_IDS = { desktop: 'desktop', mobile: 'mobile', tablet: 'tablet' };

// Shared 120-second Hobby tier — an existing function group, never a novel
// value (docs/source-of-truth/VERCEL-HOBBY-DEPLOYMENT.md).
export const maxDuration = 120;

const BROWSERLESS_CLIENT_ID = 'public-studio';

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function requestIp(request) {
  const fwd = request.headers.get('x-forwarded-for') || '';
  return fwd.split(',')[0].trim() || 'unknown';
}

// Versioned by capture time: a recapture of the same URL+viewport overwrites
// the SAME id/storagePath, so the `v` param is what busts the browser's and
// CDN's day-long cache of the previous bytes (the GET itself ignores it).
function imageUrlFor(captureId, capturedAt) {
  const v = Date.parse(capturedAt || '') || 0;
  return `/api/public/studio-device-capture?id=${captureId}&v=${v}`;
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }

  const viewport = String(body?.viewport || 'desktop');
  if (!isSupportedViewport(viewport)) return json({ error: 'Unsupported viewport.' }, 400);

  let rawUrl = String(body?.url || '').trim();
  if (!rawUrl) return json({ error: 'Missing url.' }, 400);
  if (!/^https?:\/\//i.test(rawUrl)) rawUrl = `https://${rawUrl}`;
  let targetUrl;
  try {
    // validateUrl returns the parsed URL object (safe-fetch.cjs) — its
    // toString() is the normalized form the cache id is keyed on.
    targetUrl = (await validateUrl(rawUrl)).toString();
  } catch (err) {
    return json({ error: `That URL can't be captured: ${String(err?.message || err).replace(/^SSRF_BLOCKED:\s*/, '')}` }, 400);
  }

  // Live-screen preflight ({ url, checkEmbed: true }): reports whether the
  // site allows iframe embedding (X-Frame-Options / CSP frame-ancestors) so
  // the studio can say "this site blocks embedding" instead of showing
  // Chrome's silent sad-page. Plain header fetch — no browserless call, no
  // quota; still behind the same SSRF validation above. `sameorigin` counts
  // as blocked because the studio is never the target site's origin.
  if (body?.checkEmbed === true) {
    try {
      const res = await fetch(targetUrl, {
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; HITLOOP-Studio-embed-preflight)' },
      });
      const xfo = (res.headers.get('x-frame-options') || '').toLowerCase();
      const csp = res.headers.get('content-security-policy') || '';
      const frameAncestors = /frame-ancestors\s+([^;]+)/i.exec(csp)?.[1]?.trim() || null;
      let blockedBy = null;
      if (xfo.includes('deny') || xfo.includes('sameorigin')) blockedBy = `X-Frame-Options: ${xfo}`;
      else if (frameAncestors && !frameAncestors.includes('*')) blockedBy = `CSP frame-ancestors: ${frameAncestors}`;
      return json({ ok: true, embeddable: !blockedBy, blockedBy, httpStatus: res.status });
    } catch (err) {
      // Unreachable/timeout — can't say either way; the iframe attempt
      // itself is the truth. Never fail the caller over a preflight.
      return json({ ok: true, embeddable: null, blockedBy: null, error: String(err?.message || err) });
    }
  }

  const captureId = captureCacheId(targetUrl, viewport);

  // 1. Fresh cache hit — free, no quota consumed. `refresh: true` skips
  // this (an honest "the site changed, capture it again" path) — the
  // recapture still goes through the full quota gate below, so refresh
  // spam can't bypass the caps.
  const forceRefresh = body?.refresh === true;
  let cached = null;
  try { cached = await readCachedCapture(captureId); } catch {}
  if (shouldServeCachedCapture({ cached, forceRefresh }).serve) {
    return json({ ok: true, captureId, imageUrl: imageUrlFor(captureId, cached.doc.capturedAt), cached: true });
  }

  // 2. Quota — consumed before the paid call, never refunded on failure
  // (see consumeCaptureQuota's own comment).
  const quota = await consumeCaptureQuota({ ip: requestIp(request) });
  if (!quota.allowed) {
    const msg = quota.reason === 'ip-limit'
      ? 'Daily capture limit reached for your connection — try again tomorrow.'
      : 'The shared daily capture budget is used up — try again tomorrow.';
    return json({ error: msg, reason: quota.reason }, 429);
  }

  // 3. Paid capture — full-page variant matching the device viewport, with
  // scrollPage so lazy-loading sites actually render below the fold (an
  // instant full-page shot of e.g. vercel.com came back almost entirely
  // blank white — confirmed live).
  const baseVariant = FULL_PAGE_SCREENSHOT_VARIANTS.find((v) => v.id === VIEWPORT_VARIANT_IDS[viewport]);
  const fullPageVariant = { ...baseVariant, scrollPage: true };
  const viewportVariant = VIEWPORT_SCREENSHOT_VARIANTS.find((v) => v.id === VIEWPORT_ONLY_VARIANT_IDS[viewport]) || null;

  // Phase 7 — lead with whichever variant the recorded evidence supports.
  // `viewport-only` ONLY when this exact url+viewport has already failed
  // full-page inside the marker TTL; otherwise full-page, exactly as before.
  const strategy = planCaptureStrategy({ cached, forceRefresh });
  const viewportLed = strategy.strategy === 'viewport-only' && Boolean(viewportVariant);
  const variant = viewportLed ? viewportVariant : fullPageVariant;
  // Last-resort fallback to the SAME device at viewport height (Phase 6).
  // captureScreenshotBuffer has supported this since it was written and its
  // own docblock describes this route as the intended consumer — but the
  // wiring was never added, so a site whose full page cannot be rendered in
  // time produced nothing at all. Measured: `https://hitloop.agency/` fails
  // every `desktop-full` attempt with a 408, yet the plain `desktop`
  // viewport variant of that same URL captured successfully in 7,978ms.
  // Costs exactly ONE extra browserless call, and only after the full-page
  // ladder is already spent. The screen texture is then one viewport tall,
  // so the element's scroll-pan has nothing to travel — a real, reported
  // degradation (`fellBackToViewport`), never a silent one.
  // ...and it is skipped entirely on the viewport-LED path, where the
  // viewport variant is already the primary — there is nothing below it to
  // fall back to.
  const fallbackVariant = viewportLed ? null : viewportVariant;
  let shot;
  try {
    shot = await captureScreenshotBuffer({
      clientId: BROWSERLESS_CLIENT_ID,
      runId: `device-${captureId.slice(0, 8)}-${Date.now()}`,
      targetUrl,
      variant,
      // Adaptive: returns as soon as the page has rendered text/media, so a
      // fast site pays nothing. A client-rendered app can satisfy
      // domcontentloaded + fonts.ready with an empty root — this is what
      // stops that page being photographed before it paints.
      waitForContent: true,
      maxAttempts: viewportLed ? CAPTURE_VIEWPORT_LED_MAX_ATTEMPTS : CAPTURE_MAX_ATTEMPTS,
      requestTimeoutMs: viewportLed ? CAPTURE_FALLBACK_REQUEST_TIMEOUT_MS : CAPTURE_REQUEST_TIMEOUT_MS,
      gotoTimeoutMs: viewportLed ? CAPTURE_FALLBACK_GOTO_TIMEOUT_MS : CAPTURE_GOTO_TIMEOUT_MS,
      fallbackVariant,
      fallbackRequestTimeoutMs: CAPTURE_FALLBACK_REQUEST_TIMEOUT_MS,
      fallbackGotoTimeoutMs: CAPTURE_FALLBACK_GOTO_TIMEOUT_MS,
    });
  } catch (err) {
    shot = { ok: false, warning: { message: String(err?.message || err) } };
  }

  // Phase 7 — record what this attempt proved about FULL-PAGE capture of this
  // url+viewport, so the next one does not repeat a spent ladder:
  //   full-page led and produced the shot   -> nothing to record; the
  //       whole-doc write below omits the marker, which CLEARS any old one.
  //   full-page led and did not produce it  -> mark (both the total failure
  //       and the fell-back-to-viewport success; in both, full-page failed).
  //   viewport led                          -> full-page was never attempted,
  //       so nothing was learned: carry the ORIGINAL timestamp forward
  //       unchanged (never refreshed) so the TTL keeps running down.
  const fellBackToViewport = Boolean(shot?.fellBackFromVariant);
  const fullPageFailedThisRun = !viewportLed && (!shot?.ok || fellBackToViewport);
  const capturedAtMs = Date.now();
  let markerToPersist = viewportLed ? strategy.fullPageFailedAt : null;
  if (fullPageFailedThisRun) {
    markerToPersist = new Date(capturedAtMs).toISOString();
    // On the !ok path this is the ONLY write, and it must not clobber an
    // existing capture's storagePath — markFullPageCaptureFailed merges.
    // On the fell-back path the successful whole-doc write below carries the
    // same value, so this is a harmless precursor either way.
    try {
      await markFullPageCaptureFailed(captureId, { url: targetUrl, viewport, nowMs: capturedAtMs });
    } catch (err) {
      // A marker is an optimization, never a correctness requirement — a
      // failed write must not turn a usable capture into an error.
      console.warn('[studio-device-capture] could not record the full-page failure marker', String(err?.message || err));
    }
  }

  if (!shot?.ok) {
    // Honest stale fallback: an expired capture beats no capture at all.
    // Gated on hasStoredCapture, NOT on doc existence: since Phase 7 a doc
    // can exist as a failure MARKER with no bytes behind it, and answering
    // ok:true with an imageUrl for those missing bytes is exactly the
    // silent-broken-texture failure Phase 5 removed from the GET.
    if (hasStoredCapture(cached)) return json({ ok: true, captureId, imageUrl: imageUrlFor(captureId, cached.doc.capturedAt), cached: true, stale: true });
    return json({ error: shot?.warning?.message || 'Capture failed.' }, 502);
  }

  // 3b. Blank-capture gate (Phase 6) — a flat, featureless frame is a FAILED
  // capture, and this cache is write-once-serve-forever in practice (the TTL
  // gates re-capture, never serving; nothing deletes a doc or its object), so
  // one blank write becomes a permanently wrong device screen. Reject BEFORE
  // anything is persisted. Fails open when the image can't be assessed —
  // see assessCaptureContent.
  const quality = await assessCaptureContent(shot.buffer);
  if (!quality.ok) {
    console.warn('[studio-device-capture] rejected a blank capture', { targetUrl, viewport, quality });
    if (hasStoredCapture(cached)) { // never a failure-marker-only doc — see the !shot.ok branch
      return json({ ok: true, captureId, imageUrl: imageUrlFor(captureId, cached.doc.capturedAt), cached: true, stale: true, blankRejected: true });
    }
    return json({
      error: `${targetUrl} rendered as a blank page, so nothing was saved — the screen would have been empty. Try again (the site may have been slow to render), or check that the URL loads publicly without a login or cookie wall.`,
      reason: quality.reason,
    }, 502);
  }

  const ext = shot.extension || 'jpg';
  const stored = await saveBufferArtifact({
    storagePath: `public/studio-device-captures/${captureId}.${ext}`,
    buffer: shot.buffer,
    contentType: shot.contentType || 'image/jpeg',
    metadata: { artifactType: 'studio_device_capture', targetUrl, viewport },
  });
  await saveCaptureCacheDoc(captureId, {
    url: targetUrl, viewport,
    storagePath: stored.storagePath,
    contentType: stored.contentType,
    sizeBytes: stored.sizeBytes,
    nowMs: capturedAtMs,
    // Whole-doc write: passing the marker PRESERVES it (viewport-height
    // result), omitting it CLEARS it (full-page succeeded — the proof that
    // any recorded failure is out of date, applied in the same write).
    fullPageFailedAt: markerToPersist,
  });

  return json({
    ok: true, captureId,
    imageUrl: imageUrlFor(captureId, new Date(capturedAtMs).toISOString()),
    cached: false,
    // Reported so the UI can say the screen won't scroll — never silent.
    // True for BOTH viewport-height paths: the last-resort fallback, and the
    // Phase 7 viewport-led capture (where full-page was skipped because it is
    // already known to fail for this url — the screen is equally short, so
    // saying nothing would be the silent degradation this route refuses).
    ...((fellBackToViewport || viewportLed) ? { fellBackToViewport: true } : null),
  });
}

export async function GET(request) {
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!/^[0-9a-f]{40}$/.test(id)) return json({ error: 'Invalid capture id.' }, 400);
  // Guarded (export-restore Phase 5): an unhandled Firestore throw here
  // returned Next's HTML 500 page, which the studio's THREE.TextureLoader
  // sees as an opaque image-decode failure — indistinguishable from a
  // genuinely missing capture, and the reason "the device screen silently
  // shows the placeholder" was so hard to diagnose. Fail as clean JSON.
  let cached;
  try {
    cached = await readCachedCapture(id);
  } catch (err) {
    console.warn('[studio-device-capture] cache lookup failed', id, err);
    return json({ error: 'Capture lookup is temporarily unavailable.' }, 503);
  }
  if (!cached?.doc?.storagePath) return json({ error: 'Capture not found.' }, 404);
  try {
    const [buffer] = await fb.adminStorage.bucket().file(cached.doc.storagePath).download();
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'content-type': cached.doc.contentType || 'image/jpeg',
        // Immutable by id: a recapture of the same URL+viewport overwrites
        // the SAME id/storagePath, so stale CDN copies age out via max-age
        // rather than needing invalidation.
        'cache-control': 'public, max-age=86400',
      },
    });
  } catch {
    return json({ error: 'Capture file unavailable.' }, 404);
  }
}
