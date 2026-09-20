import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { createSocialPost } from '../../../../features/social-posting/twitter-service.js';
import { buildDayPlan } from '../../../../features/x-quote-targets/day-plan.js';
// Static import so Next bundles the calendar — docs/audits/ is NOT in
// .vercelignore, but a runtime fs read of a repo path is fragile on serverless.
import bundledCalendar from '../../../../docs/audits/x-calendar-15day.json' with { type: 'json' };
import { guardXPost } from '../../../../features/x-content-guard/index.js';
import { compareToBenchmark, resolveXGrowthProfile, resolveTier } from '../../../../features/x-benchmark/index.js';
import { buildCalendar } from '../../../../features/x-benchmark/build-calendar.js';
import { readCorpus, readCorpora, saveGapReport } from '../../../../features/x-benchmark/store.js';
// Aliased: features/x-quote-targets/day-plan.js already owns the name
// `buildDayPlan` in this file, and the two build entirely different things —
// that one merges a calendar day with scanned quote candidates, this one plans
// a day of authored posts out of the content inventory.
import { buildDayPlan as buildContentDayPlan } from '../../../../features/x-content-inventory/plan-day.js';
import { projectDayPlan } from '../../../../features/x-content-inventory/day-plan-projection.js';
import { validateInventory } from '../../../../features/x-content-inventory/schema.js';
import { readInventory, upsertPackage, deletePackage } from '../../../../features/x-content-inventory/store.js';
// Same static-import reasoning as bundledCalendar above. These are the two
// ingested corpora the planner needs as ROWS — x_corpora stores summarized stat
// blocks, which summarizeCorpus cannot be fed, so the committed JSON is the
// only source of rows a serverless request can reach.
import ownCorpusRows from '../../../../docs/audits/bai-ee-x-corpus.json' with { type: 'json' };
import benchmarkCorpusRows from '../../../../docs/audits/seb-design-x-corpus.json' with { type: 'json' };

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

/**
 * The client's own generated calendar, falling back to the bundled one.
 *
 * A generated calendar (features/x-benchmark/build-calendar.js, written by the
 * gap-report run) is per-client and lives in Firestore. The bundled 15-day JSON
 * is @bai_ee's hand-written calendar and stays as the fallback so the original
 * account keeps working unchanged — and so a client whose corpus has not been
 * ingested yet sees a plan rather than an empty card.
 */
async function readCalendar(clientId) {
  try {
    const snap = await fb.adminDb.collection('dashboard_state').doc(clientId).get();
    const stored = snap.exists ? snap.data()?.marketingBrief?.xGrowth?.calendar : null;
    if (stored && Array.isArray(stored.days) && stored.days.length) {
      return { calendar: stored, source: 'generated' };
    }
  } catch {
    // A read failure must not cost the card its calendar.
  }
  return { calendar: bundledCalendar, source: 'bundled' };
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

    const { calendar, source: calendarSource } = await readCalendar(context.clientId);

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

    let xGrowth = null;
    try {
      const stateSnap = await fb.adminDb.collection('dashboard_state').doc(context.clientId).get();
      xGrowth = stateSnap.exists ? (stateSnap.data()?.marketingBrief?.xGrowth ?? null) : null;
    } catch {
      // The gap report is additive context; never let it take the GET down.
    }

    return json({
      ok: true,
      quoteTargets,
      dayPlan,
      calendarSource,
      gapReport: xGrowth?.gapReport ?? null,
      analysisComputedAt: xGrowth?.computedAt ?? null,
      clientId: context.clientId,
    });
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

const SUPPORTED_ACTIONS = [
  'draft-quote',
  'dismiss',
  'refresh-analysis',
  'content-plan',
  'inventory-list',
  'inventory-save',
  'inventory-delete',
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Slot count per day. The upper bound is not a guess: tier 2 in
 * build-calendar.js tops out well below it, and a caller asking for 50 slots is
 * asking the planner to invent content that does not exist. */
const MAX_PLAN_POSTS = 12;

/**
 * Plan one day of authored posts from the content inventory.
 *
 * Free and offline in the same sense as refresh-analysis: two committed corpora,
 * the client's saved inventory, and pure functions over both. No X API, no
 * ScrapeCreators, no LLM — drafting the actual copy is a separate, explicit step.
 *
 * ⚠️ The corpora are @bai_ee's, so the mix this returns is benchmarked against
 * @bai_ee's history regardless of which client is loaded. Per-client planning
 * needs per-client corpus ROWS, which nothing stores yet.
 */
async function handleContentPlan(context, body) {
  const requestedPosts = Number(body?.posts);
  const posts = Number.isFinite(requestedPosts) && requestedPosts >= 1
    ? Math.min(Math.floor(requestedPosts), MAX_PLAN_POSTS)
    : 5;
  const date = typeof body?.date === 'string' && DATE_RE.test(body.date.trim())
    ? body.date.trim()
    : new Date().toISOString().slice(0, 10);

  const { packages, seeded } = await readInventory();

  const plan = buildContentDayPlan({
    corpusRows: ownCorpusRows,
    benchmarkRows: benchmarkCorpusRows,
    packages,
    date,
    posts,
  });

  // `seeded` travels with the plan so the card can say the gaps come from the
  // example rows, not from an inventory someone actually curated.
  //
  // `summary` is the narrowed view (day-plan-projection.js): it names each
  // slot's state once and counts each route into a slot separately, because
  // `plan.filled` counts inventory matches only — a day carrying a re-surfaced
  // winner and two scan slots would otherwise read as one-fifth built. Additive;
  // the panel keeps reading `plan`.
  return { ok: true, plan, seeded, summary: projectDayPlan(plan, { posts }).summary };
}

async function handleInventoryList(context) {
  const { packages, updatedAt, seeded } = await readInventory();
  return { ok: true, packages, updatedAt, seeded, audit: validateInventory(packages) };
}

async function handleInventorySave(context, body) {
  const { pkg, packages, warnings, created } = await upsertPackage(body?.pkg);
  // The whole-inventory audit, not just this row's: duplicate ids and series
  // coverage only exist as properties of the set.
  return { ok: true, pkg, created, warnings, audit: validateInventory(packages) };
}

async function handleInventoryDelete(context, body) {
  const { removed } = await deletePackage(body?.id);
  return { ok: true, removed };
}

/**
 * Recompute the client's gap report and calendar from already-ingested corpora.
 *
 * Free and offline: it reads stat blocks that scripts/x-content/ingest-corpus.mjs
 * already stored and runs two pure functions over them. No X API, no
 * ScrapeCreators, no LLM — the ingest that costs something is the separate,
 * local, human-run step.
 */
async function handleRefreshAnalysis(context) {
  const snap = await fb.adminDb.collection('client_configs').doc(context.clientId).get();
  const profile = resolveXGrowthProfile({
    config: snap.exists ? snap.data()?.marketingBriefConfig?.xGrowth : null,
  });

  if (!profile.ready) {
    const err = new Error(`X growth profile is incomplete — missing: ${profile.missing.join(', ')}.`);
    err.status = 400;
    throw err;
  }

  const ownCorpus = await readCorpus(profile.ownHandle);
  if (!ownCorpus?.stats) {
    const err = new Error(`No ingested corpus for @${profile.ownHandle}. Run: node scripts/x-content/ingest-corpus.mjs --handle ${profile.ownHandle} --write`);
    err.status = 409;
    throw err;
  }

  const benchmarks = await readCorpora(profile.benchmarkHandles);
  if (!benchmarks.length) {
    const err = new Error(`No ingested corpus for any benchmark account (${profile.benchmarkHandles.join(', ')}).`);
    err.status = 409;
    throw err;
  }

  // One report per benchmark. They are kept separate rather than averaged:
  // two benchmark accounts can disagree, and an average of two strategies is
  // usually neither. The first is the primary and drives the calendar.
  const reports = benchmarks
    .map((b) => compareToBenchmark({ own: ownCorpus.stats, benchmark: b.stats }))
    .filter((r) => Array.isArray(r.gaps));
  const primary = reports[0];

  const tier = resolveTier({
    tierOverride: profile.tierOverride,
    currentAuthoredPerDay: ownCorpus.stats?.cadence?.authoredPerActiveDay,
  });
  const calendar = buildCalendar({
    report: primary,
    ownStats: ownCorpus.stats,
    tier,
    profile,
    days: 15,
    startDate: new Date().toISOString().slice(0, 10),
  });

  const report = {
    ...primary,
    tier,
    // Secondary benchmarks are reported but never merged into the primary.
    alternates: reports.slice(1).map((r) => ({ benchmarkHandle: r.benchmarkHandle, gaps: r.gaps, projection: r.projection })),
    corpora: {
      own: { handle: ownCorpus.handle, ...(ownCorpus.meta ?? {}) },
      benchmarks: benchmarks.map((b) => ({ handle: b.handle, ...(b.meta ?? {}) })),
    },
  };

  await saveGapReport(context.clientId, { report, calendar });
  return { ok: true, report, calendar, tier };
}

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
    if (action === 'refresh-analysis') {
      const result = await handleRefreshAnalysis(context);
      return json(result);
    }
    if (action === 'dismiss') {
      const result = await handleDismiss(context.clientId, body);
      return json(result);
    }
    if (action === 'content-plan') {
      const result = await handleContentPlan(context, body);
      return json(result);
    }
    if (action === 'inventory-list') {
      const result = await handleInventoryList(context);
      return json(result);
    }
    if (action === 'inventory-save') {
      const result = await handleInventorySave(context, body);
      return json(result);
    }
    if (action === 'inventory-delete') {
      const result = await handleInventoryDelete(context, body);
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
