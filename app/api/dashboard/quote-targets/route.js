import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { createSocialPost } from '../../../../features/social-posting/twitter-service.js';
import { buildDayPlan } from '../../../../features/x-quote-targets/day-plan.js';
// Static import so Next bundles the calendar — docs/audits/ is NOT in
// .vercelignore, but a runtime fs read of a repo path is fragile on serverless.
import calendar from '../../../../docs/audits/x-calendar-15day.json' with { type: 'json' };
import { guardXPost } from '../../../../features/x-content-guard/index.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);
const { verifyRequestUser, isAdminEmail } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');
const fb = require('../../../../api/_lib/firebase-admin.cjs');

// Quote Targets — draft/dismiss surface over X accounts worth quote-tweeting.
//
// This route NEVER calls the X API. Candidate discovery runs entirely offline
// via scripts/x-content/scan-quote-targets.mjs, because `bird` (the X search
// tool used elsewhere in this repo) needs browser cookies that aren't
// available to a server route — the scan is a local, human-run script whose
// output is written to Firestore for this route to read. Every action below
// is Firestore-only: GET reads a saved scan, draft-quote writes a draft post
// (never posts it), dismiss edits a saved list. See
// docs/source-of-truth/X-API-AND-PROFILE-OPERATIONS.md before adding any call
// that could reach the live X API from this file.
//
// GET is free — no network, no spend. POST actions are Firestore writes only
// (guardXPost is a pure/offline check — see features/x-content-guard).

const DISMISSED_CAP = 200;
const QUOTE_URL_RE = /^https:\/\/x\.com\/\w+\/status\/\d+$/;
const CONTENT_SEP = '\n\n';
const MAX_POST_LEN = 280;

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

// Admin-gate exactly like app/api/dashboard/x-monitor/route.js's requireAdmin,
// then resolve the caller's clientId the way app/api/social-posting/route.js's
// resolveContext does — this route needs both: admin-only (candidate scanning
// and drafting is an operator action) and client-scoped (drafts + dismissed
// list are stored per dashboard_state/{clientId}, same as createSocialPost).
async function requireAdminContext(request) {
  const decoded = await verifyRequestUser(makeReqShim(request));
  if (!(await isAdminEmail(decoded?.email))) {
    const err = new Error('Admin access required for quote targets.');
    err.status = 403;
    throw err;
  }
  const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  if (!context.clientId) {
    const err = new Error('No client workspace was found.');
    err.status = 404;
    throw err;
  }
  return { decoded, context };
}

async function readQuoteTargets(clientId) {
  const snap = await fb.adminDb.collection('dashboard_state').doc(clientId).get();
  if (!snap.exists) return null;
  return snap.data()?.marketingBrief?.quoteTargets ?? null;
}

export async function GET(request) {
  let context;
  try {
    ({ context } = await requireAdminContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  try {
    const quoteTargets = await readQuoteTargets(context.clientId);

    // Which calendar day to show. There is no stored start date yet, so the
    // day is explicit (?day=N) and defaults to 1 rather than being guessed
    // from a date the system does not actually track.
    const url = new URL(request.url);
    const requestedDay = Number(url.searchParams.get('day'));
    const dayNumber = Number.isFinite(requestedDay) && requestedDay >= 1 ? Math.floor(requestedDay) : 1;

    let dayPlan = null;
    try {
      dayPlan = buildDayPlan({
        calendar,
        quoteTargets,
        dayNumber,
        existingDraftIds: Array.isArray(quoteTargets?.dismissed) ? quoteTargets.dismissed : [],
      });
    } catch {
      // The merge is a convenience layer; never let it take the whole GET down.
      dayPlan = null;
    }

    return json({ ok: true, quoteTargets, dayPlan, clientId: context.clientId });
  } catch (err) {
    // A missing/broken Firestore read is a clean error, not a stack trace —
    // an unscanned account is a normal state (handled above), this is only
    // for genuine read failures.
    return json({ error: err.message || 'Failed to read quote targets.' }, 500);
  }
}

// caption.trim() + "\n\n" + quotedUrl, truncating only the caption so the URL
// is always preserved intact. Returns { content, truncated }.
function composeQuoteContent(caption, quotedUrl) {
  const trimmedCaption = String(caption).trim();
  const full = `${trimmedCaption}${CONTENT_SEP}${quotedUrl}`;
  if (full.length <= MAX_POST_LEN) return { content: full, truncated: false };

  const budget = MAX_POST_LEN - CONTENT_SEP.length - quotedUrl.length - 1; // -1 for the ellipsis
  if (budget <= 0) {
    const err = new Error('quotedUrl is too long to fit within a 280-character post.');
    err.status = 400;
    throw err;
  }
  const shortCaption = `${trimmedCaption.slice(0, budget)}…`;
  return { content: `${shortCaption}${CONTENT_SEP}${quotedUrl}`, truncated: true };
}

async function handleDraftQuote(context, body) {
  const caption = typeof body?.caption === 'string' ? body.caption.trim() : '';
  const quotedUrl = typeof body?.quotedUrl === 'string' ? body.quotedUrl.trim() : '';
  if (!caption) {
    const err = new Error('caption is required.');
    err.status = 400;
    throw err;
  }
  if (!QUOTE_URL_RE.test(quotedUrl)) {
    const err = new Error('quotedUrl must look like https://x.com/<handle>/status/<digits>.');
    err.status = 400;
    throw err;
  }

  const { content, truncated } = composeQuoteContent(caption, quotedUrl);

  const verdict = guardXPost({ text: caption, type: 'quote-react', media: 'none' });
  if (verdict.hardBlock) {
    const err = new Error(verdict.note || 'Blocked by content guard.');
    err.status = 422;
    err.verdict = verdict;
    throw err;
  }

  const post = await createSocialPost(context.clientId, {
    content,
    source: 'quote-targets',
    status: 'draft',
    scheduledAt: null,
    platform: 'x',
  });

  return { ok: true, post, verdict, truncated };
}

async function handleDismiss(clientId, body) {
  const candidateId = typeof body?.candidateId === 'string' ? body.candidateId.trim() : '';
  if (!candidateId) {
    const err = new Error('candidateId is required.');
    err.status = 400;
    throw err;
  }

  const docRef = fb.adminDb.collection('dashboard_state').doc(clientId);
  const dismissed = await fb.adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const existing = Array.isArray(snap.data()?.marketingBrief?.quoteTargets?.dismissed)
      ? snap.data().marketingBrief.quoteTargets.dismissed
      : [];
    // Dedupe, append, then cap — drop the oldest entries first so the list
    // stays bounded without losing the most recent dismissals.
    const next = existing.filter((id) => id !== candidateId).concat(candidateId);
    const capped = next.length > DISMISSED_CAP ? next.slice(next.length - DISMISSED_CAP) : next;
    tx.set(
      docRef,
      { marketingBrief: { quoteTargets: { dismissed: capped } }, updatedAt: fb.FieldValue.serverTimestamp() },
      { merge: true }
    );
    return capped;
  });

  return { ok: true, dismissed };
}

const SUPPORTED_ACTIONS = ['draft-quote', 'dismiss'];

export async function POST(request) {
  let context;
  try {
    ({ context } = await requireAdminContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const action = body?.action || '';
  try {
    if (action === 'draft-quote') {
      const result = await handleDraftQuote(context, body);
      return json(result);
    }
    if (action === 'dismiss') {
      const result = await handleDismiss(context.clientId, body);
      return json(result);
    }
    return json({ error: `Unknown action: ${action}`, supportedActions: SUPPORTED_ACTIONS }, 400);
  } catch (err) {
    if (err?.status) {
      return json({ error: err.message, verdict: err.verdict || undefined }, err.status);
    }
    return json({ error: err.message || 'Quote targets action failed.' }, 500);
  }
}
