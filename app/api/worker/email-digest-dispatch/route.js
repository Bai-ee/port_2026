import { NextResponse } from 'next/server';
import { createRequire } from 'module';

// email-digest-dispatch — Phase 3 per-client scheduling (EMAIL-REBUILD-PLAN.md
// owner decision: real per-client sendHour/weekday/timezone, GitHub-Actions
// dispatcher, hour precision). Every tick: find enrolled clients whose
// nextRunAt is due, atomically claim each ONE AT A TIME (never claim-then-
// queue), and for each claimed client fire the SAME two proven worker calls
// the old fan-out used — /api/worker/pre-digest-refresh then
// /api/admin/daily-digest, both with an explicit ?clientId= so neither one
// re-enters ITS OWN internal fan-out branch. Reuses the existing hardened
// entrypoints deliberately: this route only adds WHEN a client's turn comes
// up, not HOW the refresh/send themselves work (Phase 0+1's zero-LLM-
// scheduled-send guarantees, delivery leases, and stamps are untouched).
//
// Why claim-one-then-process-one, never claim-many-then-process: claiming
// immediately advances that client's nextRunAt to its NEXT future occurrence
// (see scheduler.cjs). If this route claimed every due client up front and
// then ran out of its own time budget partway through processing them, the
// unprocessed-but-claimed clients would silently miss today entirely — not
// retry next tick, because they're no longer "due" until their next real
// slot. Claiming right before processing, and stopping BEFORE claiming a new
// one when budget is low, means an unclaimed due client is picked up on the
// very next 30-minute tick instead.
//
// NOT wired into any live trigger yet: no vercel.json cron entry (Hobby caps
// crons at once-per-day; this needs 30-min resolution, which only a GitHub
// Actions workflow can provide — see .github/workflows/email-digest-
// dispatch.yml, written but deliberately not enabled). This route is inert
// until something calls it.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const require = createRequire(import.meta.url);
const { getHeaderValue, safeSecretEquals, hasValidWorkerSecret, buildAuthRequestShim } = require('../../../../api/_lib/auth.cjs');
const { logInfo, logWarn, logError } = require('../../../../api/_lib/observability.cjs');
const digestConfig = require('../../../../features/intelligence/_digest-config.js');
const { digestSelfOrigin, fetchWorkerJson, buildRefreshStampEntry, buildSendStampEntry } = require('../../../../api/_lib/digest-self-origin.cjs');

const DISPATCH_BUDGET_MS = 270_000; // leaves headroom under the 300s ceiling for the in-flight client's own two sub-requests to finish

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

/** One claimed client's refresh, then send — both attempted regardless of
 *  whether the other succeeded (a failed refresh still sends last-good data
 *  with a visible stale label, per the owner-decided stale policy; a failed
 *  send doesn't skip the refresh that already ran and already saved data for
 *  next time). Returns the two stamp entries so the caller can persist and
 *  report them without this function reaching into Firestore itself beyond
 *  the stamps digestConfig.stampCronRun already writes. */
async function processClaimedClient(clientId, selfOrigin) {
  const refreshTarget = new URL('/api/worker/pre-digest-refresh', selfOrigin);
  refreshTarget.searchParams.set('clientId', clientId);
  const refreshEntry = buildRefreshStampEntry(clientId, await fetchWorkerJson(refreshTarget));
  await digestConfig.stampCronRun(clientId, 'refresh', refreshEntry);

  const sendTarget = new URL('/api/admin/daily-digest', selfOrigin);
  sendTarget.searchParams.set('clientId', clientId);
  const sendEntry = buildSendStampEntry(clientId, await fetchWorkerJson(sendTarget));
  await digestConfig.stampCronRun(clientId, 'send', sendEntry);

  return { clientId, refresh: refreshEntry, send: sendEntry };
}

async function handle(request) {
  const authed = hasValidCronSecret(request) || hasValidWorkerSecret(buildAuthRequestShim(request));
  if (!authed) return json({ error: 'Unauthorized' }, 401);

  const startedAtMs = Date.now();
  const now = Date.now();

  let dueIds = [];
  try {
    dueIds = await digestConfig.listDueClientIds(now);
  } catch (err) {
    logError('email_digest_dispatch_scan_error', { error: err.message });
    return json({ error: `Could not scan due clients: ${err.message}` }, 500);
  }

  if (!dueIds.length) {
    return json({ ok: true, due: 0, processed: [], skipped: [] });
  }

  const selfOrigin = digestSelfOrigin();
  const processed = [];
  const skipped = [];

  for (const clientId of dueIds) {
    if (Date.now() - startedAtMs > DISPATCH_BUDGET_MS) {
      // Not claimed — still due, picked up on the next tick. Never claim
      // a client this invocation doesn't have budget left to process.
      skipped.push({ clientId, reason: 'dispatch budget exhausted before this client\'s turn' });
      // eslint-disable-next-line no-continue
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const claim = await digestConfig.claimDueOccurrence(clientId, Date.now());
    if (!claim.claimed) {
      skipped.push({ clientId, reason: claim.reason || 'not claimed' });
      // eslint-disable-next-line no-continue
      continue;
    }
    logInfo('email_digest_dispatch_claimed', { clientId, claimedNextRunAt: claim.claimedNextRunAt, advancedNextRunAt: claim.advancedNextRunAt });
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await processClaimedClient(clientId, selfOrigin);
      processed.push(result);
      logInfo('email_digest_dispatch_client_done', {
        clientId, refreshOk: result.refresh.ok, sendOk: result.send.ok, emailId: result.send.emailId || null,
      });
    } catch (err) {
      // A claim already advanced nextRunAt — this client is NOT retried
      // sooner by this route; it gets its next occurrence at its normal
      // scheduled time, same as the digest-delivery-sweep/generation-reclaim
      // path (a different mechanism) already covers stuck-mid-generation
      // recovery within a day. Log loudly since a claimed-but-crashed
      // client is otherwise invisible until tomorrow.
      logError('email_digest_dispatch_client_crashed', { clientId, error: err.message });
      processed.push({ clientId, refresh: null, send: null, error: err.message });
    }
  }

  const ok = processed.every((r) => r.refresh?.ok && r.send?.ok);
  logInfo('email_digest_dispatch_done', {
    due: dueIds.length, claimed: processed.length, skipped: skipped.length, ok,
    elapsedMs: Date.now() - startedAtMs,
  });
  return json({ ok, due: dueIds.length, processed, skipped }, ok || processed.length === 0 ? 200 : 207);
}

export async function GET(request) { return handle(request); }
export async function POST(request) { return handle(request); }
