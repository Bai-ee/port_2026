import { NextResponse } from 'next/server';
import { createRequire } from 'module';

// email-digest-dispatch — Phase 3 per-client scheduling (EMAIL-REBUILD-PLAN.md
// owner decision: real per-client sendHour/weekday/timezone, GitHub-Actions
// dispatcher, hour precision). Every tick: find enrolled clients whose
// nextRunAt is due, atomically claim them, and for each claimed client fire
// the SAME two proven worker calls the old fan-out used —
// /api/worker/pre-digest-refresh then /api/admin/daily-digest, both with an
// explicit ?clientId= so neither one re-enters ITS OWN internal fan-out
// branch. Reuses the existing hardened entrypoints deliberately: this route
// only adds WHEN a client's turn comes up, not HOW the refresh/send
// themselves work (Phase 0+1's zero-LLM-scheduled-send guarantees, delivery
// leases, and stamps are untouched).
//
// Claim sequentially, dispatch concurrently, in bounded waves — never claim
// what this invocation can't immediately start dispatching. Claiming
// advances a client's nextRunAt to its NEXT future occurrence (see
// scheduler.cjs), so claiming without dispatching would silently drop that
// client's whole day rather than retry next tick. But strictly serial
// claim-then-fully-await-refresh-then-send-then-next-claim is its OWN
// hazard: a refresh alone can take ~4 minutes against this route's 300s
// ceiling, so one-at-a-time processing serves roughly one client per
// 30-minute tick — client N sharing a sendHour with N-1 others waits
// N*30min. A wave claims up to WAVE_SIZE clients, fires all of their
// refresh+send sub-requests concurrently (each is its own independent
// invocation with its own 300s budget), waits for the wave, then claims the
// next wave if budget remains — mirrors pre-digest-refresh's own existing
// multi-client DISPATCH_CONCURRENCY=3 wave pattern.
//
// Within a claimed client, the send sub-request is ALWAYS attempted, even
// when refresh failed or threw — never one try/catch spanning both. This
// isn't just "don't lose data on a crash": daily-digest's send path creates
// the durable delivery record immediately and sends last-good saved data
// with a visible stale label when nothing fresher exists (the owner-decided
// stale policy) — attempting it unconditionally converts "refresh failed"
// into "delivered stale-labeled" instead of "nothing sent today". The only
// remaining exposure is a dispatcher dying in the literal gap between a
// claim committing and its first sub-request firing — a millisecond window,
// and even then the existing digest-delivery-sweep 5-minute reclaim (a
// separate, already-live mechanism) recovers a stuck-mid-generation delivery
// within the same day.
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

const DISPATCH_BUDGET_MS = 270_000; // leaves headroom under the 300s ceiling for the last-claimed wave to finish
const WAVE_SIZE = 3; // mirrors pre-digest-refresh's own DISPATCH_CONCURRENCY

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

/** One claimed client's refresh, then send. Each sub-request is its own
 *  try/catch — the send attempt below must run even if the refresh call
 *  above threw, not just when it merely reported ok:false (fetchWorkerJson
 *  itself never throws, but this stays fault-isolated defensively rather
 *  than trusting that contract to hold forever). Never throws — a crash in
 *  either half becomes an honest {ok:false} entry, not a rejected promise,
 *  so a Promise.all across a wave can never have one client's failure take
 *  down its wave-mates. */
async function processClaimedClient(clientId, selfOrigin) {
  let refreshEntry;
  try {
    const refreshTarget = new URL('/api/worker/pre-digest-refresh', selfOrigin);
    refreshTarget.searchParams.set('clientId', clientId);
    refreshEntry = buildRefreshStampEntry(clientId, await fetchWorkerJson(refreshTarget));
  } catch (err) {
    refreshEntry = { clientId, ok: false, status: null, reason: `refresh dispatch threw: ${err.message}` };
  }
  await digestConfig.stampCronRun(clientId, 'refresh', refreshEntry).catch(() => {});

  let sendEntry;
  try {
    const sendTarget = new URL('/api/admin/daily-digest', selfOrigin);
    sendTarget.searchParams.set('clientId', clientId);
    sendEntry = buildSendStampEntry(clientId, await fetchWorkerJson(sendTarget));
  } catch (err) {
    sendEntry = { clientId, ok: false, status: null, reason: `send dispatch threw: ${err.message}`, error: err.message, emailId: null };
  }
  await digestConfig.stampCronRun(clientId, 'send', sendEntry).catch(() => {});

  logInfo('email_digest_dispatch_client_done', {
    clientId, refreshOk: refreshEntry.ok, sendOk: sendEntry.ok, emailId: sendEntry.emailId || null,
  });
  return { clientId, refresh: refreshEntry, send: sendEntry };
}

async function handle(request) {
  const authed = hasValidCronSecret(request) || hasValidWorkerSecret(buildAuthRequestShim(request));
  if (!authed) return json({ error: 'Unauthorized' }, 401);

  const startedAtMs = Date.now();

  let dueIds = [];
  try {
    dueIds = await digestConfig.listDueClientIds(Date.now());
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
  let i = 0;

  while (i < dueIds.length) {
    if (Date.now() - startedAtMs > DISPATCH_BUDGET_MS) {
      // Nothing left in this wave gets claimed — still due, picked up on
      // the next tick. Never claim a client this invocation doesn't have
      // budget left to immediately start dispatching.
      for (; i < dueIds.length; i += 1) skipped.push({ clientId: dueIds[i], reason: 'dispatch budget exhausted before this client\'s turn' });
      break;
    }
    // Claim sequentially (fast Firestore transactions) up to WAVE_SIZE.
    const wave = [];
    while (wave.length < WAVE_SIZE && i < dueIds.length) {
      const clientId = dueIds[i];
      i += 1;
      // eslint-disable-next-line no-await-in-loop
      const claim = await digestConfig.claimDueOccurrence(clientId, Date.now());
      if (!claim.claimed) {
        skipped.push({ clientId, reason: claim.reason || 'not claimed' });
        // eslint-disable-next-line no-continue
        continue;
      }
      logInfo('email_digest_dispatch_claimed', { clientId, claimedNextRunAt: claim.claimedNextRunAt, advancedNextRunAt: claim.advancedNextRunAt });
      wave.push(clientId);
    }
    if (!wave.length) continue; // this pass claimed nothing (all lost the race or became ineligible) — advance to the next slice, loop condition re-checks budget

    // Dispatch the whole wave's refresh+send concurrently — each client's
    // two sub-requests are independent invocations with their own 300s
    // budget; this route just waits for the wave, it doesn't do their work.
    // eslint-disable-next-line no-await-in-loop
    const waveResults = await Promise.all(wave.map((clientId) => processClaimedClient(clientId, selfOrigin)));
    processed.push(...waveResults);
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
