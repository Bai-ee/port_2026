import { NextResponse } from 'next/server';
import { createRequire } from 'module';

// digest-delivery-sweep — the ONLY thing this route does is retry digest
// deliveries currently sitting in `retry-wait` whose backoff has elapsed,
// reusing their already-stored HTML under their already-assigned
// idempotency key. It NEVER calls Anthropic, Scout, X search, or any brief/
// email renderer — see api/_lib/digest-delivery.cjs's attemptSendCore,
// which this route's only real work (sweepDueRetries) is built on.
//
// Why this route exists (P1-A from the 2026-08-17 incident review): the
// daily-digest cron's fan-out already sweeps once per day, but Resend
// idempotency keys expire after 24h and this system's own backoff schedule
// (2m/10m/30m/1h/3h) is meaningless if nothing ever wakes it up sooner than
// a ~24h-apart cron. Vercel Hobby forbids any cron schedule more frequent
// than daily (docs/source-of-truth/VERCEL-HOBBY-DEPLOYMENT.md), so a
// SUB-daily wake-up cannot come from vercel.json. This repo already has an
// established answer to exactly that constraint:
// .github/workflows/brief-worker-sweep.yml pings /api/worker/run-brief
// every 5 minutes via a GitHub Actions schedule, authenticated with the
// same HITLOOP_CRON_SECRET repo secret this route also accepts. Wiring an
// equivalent workflow entry for THIS route is the intended production
// wake-up — see docs/source-of-truth/EMAIL-DIGEST-CARD.md §12b for the
// exact workflow file and the explicit approval/activation steps (adding +
// enabling a GitHub Actions workflow requires a commit+push this session is
// not authorized to make).
//
// Bounded: `limit` caps how many deliveries one call processes (default 10).
// Authenticated: CRON_SECRET (Bearer) or WORKER_SECRET (x-worker-secret) —
// same fail-closed-in-production pattern as every other worker route in
// this repo. Idempotent + concurrency-safe: every candidate is claimed
// individually via a Firestore transaction inside attemptSendCore, so this
// route can safely be hit by multiple overlapping pingers (the daily cron's
// own sweep call AND an external 5-minute pinger) without ever sending the
// same delivery twice.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const require = createRequire(import.meta.url);
const { getHeaderValue, safeSecretEquals, hasValidWorkerSecret, buildAuthRequestShim } = require('../../../../api/_lib/auth.cjs');
const { logInfo, logWarn } = require('../../../../api/_lib/observability.cjs');
const digestDelivery = require('../../../../api/_lib/digest-delivery.cjs');
const { sendViaResend } = require('../../../../api/_lib/resend-transport.cjs');
const { digestSelfOrigin, fetchWorkerJson } = require('../../../../api/_lib/digest-self-origin.cjs');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DIGEST_FROM = process.env.DIGEST_FROM || 'HITLOOP Daily <digest@hitloop.agency>';
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

/** Vercel cron sends CRON_SECRET as a Bearer token. Mirrors every other
 *  worker route in this repo: fail closed in production when unset. */
function hasValidCronSecret(request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    if (process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production') return false;
    return true; // dev/preview convenience only
  }
  const provided = getHeaderValue(request.headers, 'authorization');
  return safeSecretEquals(provided, `Bearer ${cronSecret}`);
}

function digestSendFn({ subject, html, to, idempotencyKey }) {
  return sendViaResend({ apiKey: RESEND_API_KEY, from: DIGEST_FROM, to, subject, html, idempotencyKey });
}

async function handle(request) {
  const authed = hasValidCronSecret(request) || hasValidWorkerSecret(buildAuthRequestShim(request));
  if (!authed) return json({ error: 'Unauthorized' }, 401);

  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(MAX_LIMIT, Math.floor(rawLimit)) : DEFAULT_LIMIT;

  try {
    const { swept, results } = await digestDelivery.sweepDueRetries({
      sendFn: digestSendFn,
      limit,
    });
    const sent = results.filter((r) => r.stage === 'sent').length;
    const stillRetrying = results.filter((r) => r.stage === 'retry-wait').length;
    const terminal = results.filter((r) => r.stage === 'terminal-failure').length;
    const claimedElsewhere = results.filter((r) => r.reason && String(r.reason).startsWith('claim-failed')).length;

    // Stale-generation reclaim (Phase 1, EMAIL-REBUILD-PLAN.md): a
    // cron-scheduled occurrence killed BEFORE its render was stored has no
    // HTML for the transport sweep above — it used to be a silently lost day.
    // Re-enter the per-client send for at most 2 such records per sweep tick:
    // regeneration reads saved data only (the send path is zero-LLM for
    // scheduled sends), the deterministic identity maps back to the SAME
    // record, and the transactional send claim makes duplicates impossible.
    const reclaimed = [];
    try {
      const stuck = await digestDelivery.listStuckScheduledGeneration({ limit: 2 });
      for (const doc of stuck) {
        const target = new URL('/api/admin/daily-digest', digestSelfOrigin());
        target.searchParams.set('clientId', doc.clientId);
        // Name the EXACT record to advance: the send route validates it and
        // proceeds with the record's own identity (dateKey + idempotency key),
        // never a recomputed current-day one — a prior-day stuck occurrence
        // finishes as itself instead of minting a new delivery.
        target.searchParams.set('reclaimDeliveryId', doc.id);
        // eslint-disable-next-line no-await-in-loop
        const sub = await fetchWorkerJson(target);
        reclaimed.push({
          deliveryId: doc.id,
          clientId: doc.clientId,
          stage: doc.stage,
          ok: Boolean(sub.executed && sub.body?.email?.id),
          reason: sub.executed ? (sub.body?.reason || null) : sub.reason,
        });
      }
    } catch (err) {
      logWarn('digest_generation_reclaim_failed', { error: err.message });
    }
    if (reclaimed.length) logInfo('digest_generation_reclaim', { reclaimed });

    logInfo('digest_delivery_sweep', { swept, sent, stillRetrying, terminal, claimedElsewhere, reclaimed: reclaimed.length });
    return json({ ok: true, swept, sent, stillRetrying, terminal, claimedElsewhere, reclaimed, limit });
  } catch (err) {
    logWarn('digest_delivery_sweep_failed', { error: err.message });
    return json({ error: err.message || 'sweep failed' }, 500);
  }
}

export async function GET(request) { return handle(request); }
export async function POST(request) { return handle(request); }
