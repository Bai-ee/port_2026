import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { randomUUID } from 'crypto';
import { createSocialPost, readSocialQueue, getSocialPost, createDraftPostOnce, ensureDraftPost, findOpenPostForPackage, updateSocialPost, runPostingAgents, approveDraft, unapproveDraft, rejectDraft, swapPostMedia } from '../../../../features/social-posting/twitter-service.js';
import { buildDayPlan, mergeListCandidates } from '../../../../features/x-quote-targets/day-plan.js';
// Static import so Next bundles the calendar — docs/audits/ is NOT in
// .vercelignore, but a runtime fs read of a repo path is fragile on serverless.
import bundledCalendar from '../../../../docs/audits/x-calendar-15day.json' with { type: 'json' };
import { guardXPost } from '../../../../features/x-content-guard/index.js';
import { readCorpus, readCorpora, saveGapReport } from '../../../../features/x-benchmark/store.js';
// Aliased: features/x-quote-targets/day-plan.js already owns the name
// `buildDayPlan` in this file, and the two build entirely different things —
// that one merges a calendar day with scanned quote candidates, this one plans
// a day of authored posts out of the content inventory.
import { buildDayPlan as buildContentDayPlan } from '../../../../features/x-content-inventory/plan-day.js';
import { validateInventory } from '../../../../features/x-content-inventory/schema.js';
import { readInventory, upsertPackage, deletePackage, packageGetterFor } from '../../../../features/x-content-inventory/store.js';
import { buildClientPackage, applyApproval } from '../../../../features/x-content-inventory/client-capture.js';
import { quotedUrlOf } from '../../../../features/x-strategy/post-query.js';
import { parseStatusUrl, findQuotedCandidate, buildQuotedPreview } from '../../../../features/x-quote-targets/quoted-preview.js';
import { buildPostResults } from '../../../../features/x-content-inventory/results.js';
import { recentPostsFromQueue } from '../../../../features/x-content-inventory/allocate-slot.js';
import { readUnifiedCalendar, readCalendarQuoteTargets as readCalendarQuoteTargetsShared } from '../../../../features/x-content-inventory/calendar-reader.js';
import { ctDate, toRow as calendarPostRow } from '../../../../features/x-content-inventory/month-calendar.js';
import { hotOpportunities, hotPicksToTargets, windowHoursOf } from '../../../../features/x-quote-targets/hot-calendar.js';
import { decideCalendarItem } from '../../../../features/x-content-inventory/calendar-decide.js';
import { createContentTaskStore } from '../../../../features/x-content-inventory/content-tasks.js';
import { joinPerformance, engineStats } from '../../../../features/x-content-inventory/performance.js';
import * as bucketStore from '../../../../features/x-content-inventory/bucket-store.js';
import { findMediaCandidates, linkMediaPatch, normalizeLinks } from '../../../../features/x-content-inventory/item-media.js';
import { normalizeFacets } from '../../../../features/x-content-inventory/facets.js';
import { resolveMediaUrls } from '../../../../features/rendered-videos/media-url.js';
import { syncRenderedVideosForClient } from '../../../../features/rendered-videos/firestore-sync.js';
import { resolveMediaUrlsBatch, MEDIA_URLS_MAX_IDS, MEDIA_KINDS, tokenUrlFor } from '../../../../features/x-content-inventory/thumbs.js';
import { setRights, saveThumb, createDraftFromItem, pickMedia } from '../../../../features/x-content-inventory/item-actions.js';
import { NAS_ACTIONS, handleNasAction } from '../../../../features/x-content-inventory/nas.js';
import { attachItemMedia } from '../../../../features/x-content-inventory/attach-item-media.js';
import { findHiresMedia, useHiresMedia, HIRES_EDITABLE_STATUSES, pendingStageFromDb, readStageStatesFromDb } from '../../../../features/x-content-inventory/hires-media.js';
import { runDailyLoop, localDateOf, LOOP_VERSION } from '../../../../features/x-content-inventory/daily-loop.js';
import { assertClientReady, resolveClientXHandle } from '../../../../features/client-readiness/index.js';
import {
  createFirestoreRunStore, loadDailyLoopInputs, saveSuggestionDraft, editSuggestion, dismissSuggestion, overlayStagedMedia, createModelDrafter,
} from '../../../../features/x-content-inventory/daily-run-store.js';
import { createStrategyHandlersFromDb, STRATEGY_ROUTE_ACTIONS } from '../../../../features/x-strategy/route-handlers.js';
import { executePaidSync, loadXMonitorService } from '../../../../features/mcp/paid-syncs.js';
import { createFirestoreCounters } from '../../../../features/mcp/limits.js';
import { createContentPlanHandlers } from '../../../../features/x-strategy/content-plan.js';
import { createFirestoreCorpusStore } from '../../../../features/x-strategy/corpus-store.js';
import { createFirestorePlanStore } from '../../../../features/x-strategy/plan-store.js';
import { createFirestoreStrategyDocStore } from '../../../../features/x-strategy/strategy-doc-store.js';
import { loadContentContext, summarizeContentContext } from '../../../../features/content-context/load-content-context.js';
import { loadClientLoopCorpora } from '../../../../features/x-strategy/loop-corpora.js';
import { resolveXGrowthProfile } from '../../../../features/x-benchmark/profile.js';
// Committed corpora: bundled here as the fallback for the rows store (getCorpusStore) and the legacy evaluate rows.
// The daily loop reads them through loadLoopCorpora (rows store first); the plan doc reaches it via `readPlanDoc`.
import { DISCOGS_ACTIONS, handleDiscogsAction } from '../../../../features/discogs-ingest/actions.js';
import { TIMELINE_ACTIONS, handleTimelineAction } from '../../../../features/social-archive/actions.js';
import * as timelineStore from '../../../../features/social-archive/timeline-store.js';
import ownCorpusRows from '../../../../docs/audits/bai-ee-x-corpus.json' with { type: 'json' };
import benchmarkCorpusRows from '../../../../docs/audits/seb-design-x-corpus.json' with { type: 'json' };
import dailyLoopDemoSet from '../../../../features/x-content-inventory/daily-loop-demo-set.json' with { type: 'json' };

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);
const { verifyRequestUser, isAdminEmail } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');
const { requirePilotOwner } = require('../../../../api/_lib/pilot-access.cjs');
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
  // Owner pilot boundary: the whole route is Content Management (global package store, NAS, strategy chat,
  // calendar). Allowlisted uid + client only; the client id is the server-resolved one (never body/model).
  requirePilotOwner(context, decoded);
  return { decoded, context };
}

// One dashboard_state read for the GET and readOpportunities: the RAW stored quoteTargets plus the track-list signals.
// Merging happens in memory only; the dismiss POST keeps reading/writing the raw doc.
async function readQuoteState(clientId) {
  const snap = await fb.adminDb.collection('dashboard_state').doc(clientId).get();
  if (!snap.exists) return { rawQuoteTargets: null, listSignals: null, hotQuotes: null };
  const brief = snap.data()?.marketingBrief;
  return { rawQuoteTargets: brief?.quoteTargets ?? null, listSignals: brief?.listSignals ?? null, hotQuotes: brief?.hotQuotes ?? null };
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
    const { rawQuoteTargets, listSignals } = await readQuoteState(context.clientId);
    // Track-list candidates merge in memory; `dismissed` stays the raw stored array.
    const quoteTargets = mergeListCandidates(rawQuoteTargets, listSignals);

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
    // A hot pick is passed here too (the calendar reads hotQuotes.dismissed); the next hot scan replaces hotQuotes wholesale.
    const hotDismissed = Array.isArray(snap.data()?.marketingBrief?.hotQuotes?.dismissed) ? snap.data().marketingBrief.hotQuotes.dismissed : [];
    // Dedupe, append, then cap — drop the oldest entries first so the list
    // stays bounded without losing the most recent dismissals.
    const next = existing.filter((id) => id !== candidateId).concat(candidateId);
    const capped = next.length > DISMISSED_CAP ? next.slice(next.length - DISMISSED_CAP) : next;
    tx.set(
      docRef,
      {
        marketingBrief: { quoteTargets: { dismissed: capped }, hotQuotes: { dismissed: hotDismissed.filter((id) => id !== candidateId).concat(candidateId).slice(-DISMISSED_CAP) } },
        updatedAt: fb.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return capped;
  });

  return { ok: true, dismissed };
}

// Daily Content Loop (docs/plans/DAILY-CONTENT-LOOP-MASTER-PLAN.md). Owner
// account only; reads saved inputs, writes the run store, and — on Save Draft
// only — one unscheduled social_posts draft. Never schedules or posts.
const DAILY_RUN_ACTIONS = ['daily-run-latest', 'daily-run-generate', 'daily-run-edit', 'daily-run-save-draft', 'daily-run-dismiss'];

const SUPPORTED_ACTIONS = [
  ...STRATEGY_ROUTE_ACTIONS,
  ...NAS_ACTIONS,
  ...DISCOGS_ACTIONS,
  ...TIMELINE_ACTIONS,
  'engine-performance',
  'draft-quote',
  'dismiss',
  'refresh-analysis',
  'content-plan',
  'inventory-list',
  'inventory-save',
  'inventory-delete',
  'month-calendar',
  'calendar-approve',
  'calendar-unapprove',
  'calendar-suggestion-approve',
  'calendar-item-decide',
  'content-task-update',
  'content-context',
  'post-status',
  'quoted-post-preview',
  'post-results',
  'capture-client-story',
  'approve-package',
  'reject-package',
  'list-buckets',
  'upsert-bucket',
  'delete-bucket',
  'list-folders',
  'upsert-folder',
  'delete-folder',
  'update-item-facets',
  'move-item',
  'media-url',
  'sync-rendered-videos',
  'media-urls',
  'save-thumb',
  'find-item-media',
  'find-hires-media',
  'hires-media-use',
  'post-attach-item-media',
  'link-item-media',
  'set-rights',
  'create-draft-from-item',
  ...DAILY_RUN_ACTIONS,
];

// `content-plan` and `refresh-analysis` live in features/x-strategy/content-plan.js: they read the client's Strategy
// plan doc (x_strategy_plans) and corpus ROWS (x_corpora rows, committed-JSON fallback) so the Plan tab, the
// Strategy tab and the daily loop share one plan. Built lazily on first use (no Firestore at import).
// With NO plan doc they run the pre-T5 logic over `legacyRows` (the two static imports above) - see content-plan.js.
//
// Vercel: the corpus store's own default loader reads docs/audits via runtime fs, which the tracer may not bundle.
// These static JSON imports ARE bundled, so the store is given them as its committed-JSON fallback instead.
// Handle-keyed cache for @bai_ee / @seb__design only (not a default): a client reaches these rows only when its own resolved handle is one of them.
const COMMITTED_CORPORA = { bai_ee: ownCorpusRows, seb__design: benchmarkCorpusRows };
const committedCorpusRows = (handle) => (Object.hasOwn(COMMITTED_CORPORA, handle) ? COMMITTED_CORPORA[handle] : null);
let corpusStoreSingleton = null;
function getCorpusStore() {
  if (!corpusStoreSingleton) corpusStoreSingleton = createFirestoreCorpusStore(fb.adminDb, { loadCommitted: committedCorpusRows });
  return corpusStoreSingleton;
}
const readXGrowthConfigFor = async (clientId) => {
  const snap = await fb.adminDb.collection('client_configs').doc(clientId).get();
  return snap.exists ? snap.data()?.marketingBriefConfig?.xGrowth ?? null : null;
};
let contentPlanHandlers = null;
function getContentPlanHandlers() {
  if (!contentPlanHandlers) {
    contentPlanHandlers = createContentPlanHandlers({
      corpusStore: getCorpusStore(),
      planStore: createFirestorePlanStore(fb.adminDb),
      readXGrowthConfig: readXGrowthConfigFor,
      readInventory,
      readCorpus,
      readCorpora,
      legacyRows: { own: ownCorpusRows, benchmark: benchmarkCorpusRows },
      saveGapReport,
    });
  }
  return contentPlanHandlers;
}

const handleContentPlan = (context, body) => getContentPlanHandlers().contentPlan(context, body);

// ---- Inventory is per client (multi-client Phase 3a) ----
// Writes go through upsertFor(clientId): a new row is stamped with the client, an existing row of another
// client is refused (409). Item actions resolve by id through getPackageFor, which hides a foreign row (404).
const upsertFor = (clientId) => (pkg) => upsertPackage(pkg, { returnPackages: false, clientId });
const getPackageFor = (clientId) => packageGetterFor(clientId);

async function handleInventoryList(context) {
  const { packages, updatedAt, seeded } = await readInventory({ clientId: context.clientId });
  return { ok: true, packages, updatedAt, seeded, audit: validateInventory(packages) };
}

async function handleInventorySave(context, body) {
  const { pkg, packages, warnings, created } = await upsertPackage(body?.pkg, { clientId: context.clientId });
  // The whole-inventory audit, not just this row's: duplicate ids and series
  // coverage only exist as properties of the set.
  return { ok: true, pkg, created, warnings, audit: validateInventory(packages) };
}

async function handleInventoryDelete(context, body) {
  const { removed } = await deletePackage(body?.id, { clientId: context.clientId });
  return { ok: true, removed };
}

/** Mark one "film this" task done / open (content_tasks). Client-scoped by the store path; touches nothing else. */
async function handleContentTaskUpdate(context, body) {
  const taskId = typeof body?.taskId === 'string' ? body.taskId.trim() : '';
  if (!taskId) throw badRequest('taskId is required');
  const status = body?.status === 'done' ? 'done' : body?.status === 'open' ? 'open' : null;
  if (!status) throw badRequest("status must be 'open' or 'done'");
  const task = await createContentTaskStore(fb.adminDb).setStatus(context.clientId, taskId, status);
  if (!task) throw Object.assign(new Error('Task not found.'), { status: 404 });
  return { ok: true, task };
}

/**
 * Month calendar over social_posts, with undated drafts PROPOSED onto days (display only, nothing is written).
 * Read-only like the week view: Approve / Reject / edit go through the social-posting route.
 */
/** Open quote candidates for the calendar = the latest hot-scan picks (shared reader, also used by the agent/MCP get_calendar tool). */
const readCalendarQuoteTargets = (clientId) => readCalendarQuoteTargetsShared(fb.adminDb, clientId);

/** Dashboard Month calendar = the shared unified reader + row thumbnails (the only route-specific part). */
async function handleMonthCalendar(context, body) {
  const month = typeof body?.month === 'string' ? body.month.trim() : '';
  const { calendar, pkgs, baselineSlots, quoteBudget } = await readUnifiedCalendar(fb.adminDb, context.clientId, { month, now: Date.now() });
  await withRowThumbs(calendar, pkgs, context.clientId);
  // Daily baseline slots (confirmed strategy doc) ride on the calendar so the Day view can mark them (display only).
  return { ok: true, calendar: { ...calendar, baselineSlots, quoteBudget } };
}

/**
 * Small preview image per grid row: the library item's thumb (thumbs.js: stored thumb / poster / its image), else a NAS
 * item's thumb from the local worker while it is online, else the post's own poster or image. Never fails.
 */
async function withRowThumbs(calendar, pkgs, clientId) {
  const rows = calendar.weeks.flat().flatMap((d) => d.posts);
  let nasBase = null;
  if (rows.some((r) => pkgs.get(r.packageId)?.nas?.sha256)) {
    try {
      const st = await handleNasAction(nasDeps(clientId), 'nas-status', {});
      nasBase = st?.online && st.localThumbBase ? st.localThumbBase : null;
    } catch { nasBase = null; }
  }
  const ids = [...new Set(rows.map((r) => r.packageId).filter((id) => pkgs.get(id)?.clientId === clientId))];
  let urls = {};
  try {
    if (ids.length) {
      const bridge = loadBridge();
      urls = await resolveMediaUrlsBatch(ids.map((id) => pkgs.get(id)), ['thumb'], {
        hitloopBucket: fb.adminStorage.bucket(), signEv: (p) => bridge.signReadUrl(p),
      });
    }
  } catch { urls = {}; }
  for (const r of rows) {
    const sha = pkgs.get(r.packageId)?.nas?.sha256;
    const nasUrl = nasBase && /^[a-f0-9]{16,128}$/i.test(String(sha || '')) ? `${nasBase}/thumbs/${sha}.jpg` : null;
    r.thumbUrl = urls[r.packageId]?.thumbUrl || nasUrl || r.posterUrl || (r.mediaType === 'image' ? r.mediaUrl : null) || null;
  }
}

// ---- Content Management: status strip, post status, bounded chat readers (all client-scoped, read-only) ----

const excerptOf = (t, n = 160) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

const postStatusRow = (p) => ({
  id: p.id, status: p.status, scheduledAt: p.scheduledAt || null, postedAt: p.postedAt || null,
  reviewedAt: p.reviewedAt || null, content: p.content, packageId: p.packageId || null, source: p.source || null, updatedAt: p.updatedAt || null,
  errorClass: p.errorClass || null, error: p.error || null, replyTo: !!p.replyTo, revision: p.revision || 0,
  lifecycleVersion: p.lifecycleVersion || null,
  sourceRef: p.sourceRef || null, kind: p.kind || null, repostOf: p.repostOf || null, twitterId: p.twitterId || null, permalink: p.permalink || null,
  reviewOn: p.reviewOn || null, bucketId: p.bucketId || null, engine: p.engine || null, fillKind: p.fillKind || null,
  expiresAt: p.expiresAt || null, needsStory: p.needsStory === true, mediaUrl: p.mediaUrl || null, mediaStoragePath: p.mediaStoragePath || null, mediaType: p.mediaType || null, nasSha: p.nasSha || null,
  replyToUrl: p.replyTo && typeof p.replyTo === 'object' ? p.replyTo.url || null : null,
  provenance: { runId: p.runId || null, suggestionId: p.suggestionId || null, strategyVersion: p.strategyVersion ?? null, sourceRef: p.sourceRef || null },
});

/** Post-level results for THIS client: posted / waiting / needs attention, joined to package, run and plan version. Read-only. */
async function handlePostResults(context) {
  const [posts, inventory] = await Promise.all([readSocialQueue(context.clientId), readInventory({ clientId: context.clientId }).catch(() => ({ packages: [] }))]);
  return { ok: true, results: buildPostResults({ posts, packages: inventory?.packages || [], now: Date.now() }) };
}

/** Status of specific posts of THIS client (a foreign or missing id is simply absent). */
async function handlePostStatus(context, body) {
  const ids = (Array.isArray(body?.postIds) ? body.postIds : []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 20);
  const rows = (await Promise.all(ids.map((id) => getSocialPost(context.clientId, id)))).filter(Boolean);
  // `full: true` (the calendar editor): also return the approval-bound objects. `replyTo` is then the full object, not the
  // boolean other callers (chat agent, status strip) rely on, so it is strictly opt-in. Read-only.
  if (body?.full === true) {
    const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    return { ok: true, posts: rows.map((p) => ({
      ...postStatusRow(p),
      replyTo: isObj(p.replyTo) ? p.replyTo : null,
      selfReply: isObj(p.selfReply) ? p.selfReply : null,
      mediaVariants: isObj(p.mediaVariants) ? p.mediaVariants : null,
    })) };
  }
  return { ok: true, posts: rows.map(postStatusRow) };
}

/**
 * Read-only preview of the tweet a quote post (or a url) quotes, for the post editor. Firestore only: the quoted URL comes
 * from the saved post (sourceRef / trailing status URL), the text/author from the client's stored quote-target scan.
 * No X API, no ScrapeCreators. `preview` is null when the post quotes nothing; `found:false` when only the URL is known.
 */
async function handleQuotedPostPreview(context, body) {
  let url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (body?.postId) {
    const post = await getSocialPost(context.clientId, String(body.postId).trim());
    if (!post) throw Object.assign(new Error('Post not found.'), { status: 404 });
    url = quotedUrlOf(post) || '';
  }
  const parsed = parseStatusUrl(url);
  if (!parsed) return { ok: true, preview: null };
  const { rawQuoteTargets, listSignals } = await readQuoteState(context.clientId);
  const qt = mergeListCandidates(rawQuoteTargets, listSignals);
  return { ok: true, preview: buildQuotedPreview({ url: parsed.url, candidate: findQuotedCandidate(qt?.candidates, parsed.id) }) };
}

async function readQueueSummary(clientId) {
  const posts = await readSocialQueue(clientId);
  const counts = {};
  for (const p of posts) counts[p.status] = (counts[p.status] || 0) + 1;
  return {
    counts,
    // Newest 200 across EVERY source; the tool filters by status/source and caps what the model sees at 20.
    posts: posts.slice(0, 200).map((p) => ({
      id: p.id, status: p.status, scheduledAt: p.scheduledAt || null, source: p.source || null, excerpt: excerptOf(p.content), packageId: p.packageId || null, errorClass: p.errorClass || null,
    })),
  };
}

const FIND_POSTS_SCAN_LIMIT = 1500; // newest posts scanned by find_posts (bounded read)
async function readPostsForQuery(clientId) {
  return (await readSocialQueue(clientId, { limit: FIND_POSTS_SCAN_LIMIT })).map(postStatusRow);
}

async function readPostForChat(clientId, postId) {
  const p = await getSocialPost(clientId, postId);
  return p ? postStatusRow(p) : null;
}

// Latest Market Signals report (the canonical brief projection). Read-only Firestore read; null when none exists.
async function readMarketSignalsUncached(clientId) {
  const snap = await fb.adminDb.collection('dashboard_state').doc(clientId).get();
  if (!snap.exists) return null;
  const state = snap.data();
  const { projectBrief } = require('../../../../features/intelligence/_brief-intel.js');
  return projectBrief(state?.marketingBrief, state);
}

// Memo: the Today card fires two parallel HTTP calls (content-context + daily-run-generate) that cannot share a
// "request" in a Next route module, so we dedupe per client with a short-TTL promise cache (module-level; evicted on rejection).
const memoByClient = (ttlMs, load) => {
  const cache = new Map();
  return (clientId) => {
    const hit = cache.get(clientId);
    if (hit && Date.now() - hit.at < ttlMs) return hit.promise;
    const promise = load(clientId);
    cache.set(clientId, { at: Date.now(), promise });
    promise.catch(() => { if (cache.get(clientId)?.promise === promise) cache.delete(clientId); });
    return promise;
  };
};
const MARKET_SIGNALS_MEMO_MS = 12_000;
const LOOP_CORPORA_MEMO_MS = 60_000;
const readMarketSignals = memoByClient(MARKET_SIGNALS_MEMO_MS, readMarketSignalsUncached);

// Chat/MCP post edit: the SAME update path the Queue tab uses (social-posting `update` -> updateSocialPost), with a
// fresh posting-agents score like that route does. Text/time only; approval stays with the owner's buttons.
async function editQueuedPost({ clientId, postId, content, scheduledAt, expectedRevision, needsStory }) {
  const existing = await getSocialPost(clientId, postId);
  const text = content != null ? content : existing?.content;
  const payload = { ...(content != null ? { content } : {}), ...(scheduledAt !== undefined ? { scheduledAt } : {}), ...(typeof needsStory === 'boolean' ? { needsStory } : {}) };
  const { agents } = runPostingAgents(text, { source: existing?.source || 'copywriter', ...(existing?.replyTo ? { replyTo: existing.replyTo } : {}) });
  return updateSocialPost(clientId, postId, { ...payload, agents }, { expectedRevision });
}

// Hot picks only, same helper as the MCP reader: the opportunities as-of always matches the calendar's.
async function readOpportunities(clientId) {
  const { hotQuotes } = await readQuoteState(clientId);
  return hotOpportunities(hotQuotes, { now: Date.now() });
}

// Daily fill: the open hot-scan picks only (the legacy watchlist quoteTargets feed no longer reaches daily-fill), with the raw
// createdAt and per-pick window the fill needs.
async function readQuoteTargetsForFill(clientId) {
  const { hotQuotes } = await readQuoteState(clientId);
  return { generatedAt: hotQuotes?.scannedAt || null, targets: hotPicksToTargets(hotQuotes, { now: Date.now() }) };
}

async function readResultsForChat(clientId) {
  const rows = joinPerformance({ posts: await readSocialQueue(clientId) });
  const stats = engineStats(rows, { windowDays: 30, now: Date.now() });
  return {
    window: `last ${stats.windowDays} days`,
    engines: Object.entries(stats.engines).map(([engine, e]) => ({
      engine,
      n: e.n ?? null,
      medianViews: e.medianViews ?? null,
      caveats: [
        e.insufficient ? `Fewer than ${stats.minN} measured posts: not ranked.` : null,
        'Lift is likes-based; missing metrics are not zero.',
      ].filter(Boolean),
    })),
  };
}

/**
 * Per-engine performance from STORED fields only (social_posts.performance,
 * written by scripts/x-content/backfill-performance.mjs). No X API, no bird.
 */
async function handleEnginePerformance(context, body) {
  const w = Number(body?.windowDays);
  const windowDays = Number.isFinite(w) && w >= 0 ? Math.min(w, 365) : 30;
  const posts = await readSocialQueue(context.clientId);
  const rows = joinPerformance({ posts });
  const stats = engineStats(rows, { windowDays, now: Date.now() });
  const captured = rows.map((r) => r.metrics?.capturedAt).filter(Boolean).sort();
  return { ok: true, stats, lastCapturedAt: captured.length ? captured[captured.length - 1] : null };
}

/** Capture template -> approval-gated client package. Never returns the inventory. */
async function handleCaptureClientStory(context, body) {
  const built = buildClientPackage(body?.capture ?? body?.input ?? {});
  if (!built.ok) {
    const err = new Error(built.errors.join('; ') || 'Invalid capture.');
    err.status = 400;
    throw err;
  }
  const { pkg, created, warnings } = await upsertFor(context.clientId)(built.pkg);
  return { ok: true, pkg, created, warnings: warnings ?? built.warnings };
}

/** Admin-only (the whole route is): record an approve/reject decision. */
async function handleDecidePackage(context, decoded, body, state) {
  const id = typeof body?.id === 'string' ? body.id.trim() : '';
  if (!id) {
    const err = new Error('id is required.');
    err.status = 400;
    throw err;
  }
  const existing = await getPackageFor(context.clientId)(id);
  if (!existing) {
    const err = new Error(`No package ${id}.`);
    err.status = 404;
    throw err;
  }
  const next = applyApproval(existing, state, decoded?.email || decoded?.uid || null);
  const { pkg } = await upsertFor(context.clientId)(next);
  return { ok: true, pkg };
}

const handleRefreshAnalysis = (context) => getContentPlanHandlers().refreshAnalysis(context);

// ---- Content Engine v2: buckets / folders / item facets (admin-only route) ----

function badRequest(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

async function handleUpdateItemFacets(context, body) {
  const id = typeof body?.id === 'string' ? body.id.trim() : '';
  if (!id) throw badRequest('id is required.');
  const hasEdits = body?.humanEdits && typeof body.humanEdits === 'object' && !Array.isArray(body.humanEdits);
  const hasStory = typeof body?.story === 'string';
  if (!hasEdits && !hasStory) throw badRequest('humanEdits or story is required.');
  const existing = await getPackageFor(context.clientId)(id);
  if (!existing) throw badRequest(`No package ${id}.`, 404);

  // Writes ONLY humanEdits + story; extracted `facets` is never touched. A null
  // value clears that field's override (extracted value shows through again).
  const next = { ...existing };
  if (hasEdits) {
    const merged = { ...(existing.humanEdits || {}) };
    for (const [k, v] of Object.entries(body.humanEdits)) {
      if (v === null) delete merged[k];
      else Object.assign(merged, normalizeFacets({ [k]: v }));
    }
    next.humanEdits = merged;
  }
  if (hasStory) next.story = body.story;
  const { pkg } = await upsertFor(context.clientId)(next);
  return { ok: true, pkg: { id: pkg.id, bucketId: pkg.bucketId ?? null, story: pkg.story, humanEdits: pkg.humanEdits || {}, facets: pkg.facets || {}, searchTokens: pkg.searchTokens || [] } };
}

async function handleMoveItem(context, body) {
  const id = typeof body?.id === 'string' ? body.id.trim() : '';
  const bucketId = typeof body?.bucketId === 'string' ? body.bucketId.trim() : '';
  if (!id || !bucketId) throw badRequest('id and bucketId are required.');
  const buckets = await bucketStore.listBuckets(context.clientId);
  if (!buckets.some((b) => b.id === bucketId)) throw badRequest(`Unknown bucket: ${bucketId}`);
  const existing = await getPackageFor(context.clientId)(id);
  if (!existing) throw badRequest(`No package ${id}.`, 404);
  const { pkg } = await upsertFor(context.clientId)({ ...existing, bucketId });
  return { ok: true, id: pkg.id, bucketId: pkg.bucketId };
}

/** Fresh 1h signed URL(s) for a rendered-video package's stored ev: object path.
 * Admin-only (the POST gate). Paths are stored, never URLs, so this is the only
 * place a signed URL is minted for the Studio. */
async function handleMediaUrl(context, body) {
  const id = String(body?.id || '').trim();
  if (!id) throw badRequest('id is required.');
  const pkg = await getPackageFor(context.clientId)(id); // initializes the Hitloop adminDb BEFORE the bridge (named app)
  const bridge = require('../../../../api/_lib/editvideos-bridge.cjs');
  return resolveMediaUrls(pkg, (p) => bridge.signReadUrl(p));
}


// ---- Rendered Videos live sync + thumbnails + per-item actions ----

const PKG_COLLECTION = 'x_content_packages';
const EV_LONG_SIGN_MS = 6.9 * 24 * 60 * 60 * 1000; // v4 signed URLs cap at 7 days

/** Initializes the Hitloop adminDb BEFORE the named EditVideos bridge app. */
function loadBridge() {
  void fb.adminDb;
  return require('../../../../api/_lib/editvideos-bridge.cjs');
}

/** Bulk stored docs by id (no seed overlay), via Firestore getAll in chunks. */
async function readStoredPackages(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 300) {
    const refs = ids.slice(i, i + 300).map((id) => fb.adminDb.collection(PKG_COLLECTION).doc(id));
    const snaps = refs.length ? await fb.adminDb.getAll(...refs) : [];
    for (const snap of snaps) if (snap.exists) out.set(snap.id, { id: snap.id, ...(snap.data() || {}) });
  }
  return out;
}

// Same wiring as the daily-loop cron (features/rendered-videos/firestore-sync.js).
async function handleSyncRenderedVideos(context, body) {
  return syncRenderedVideosForClient({
    db: fb.adminDb,
    bridge: loadBridge(),
    upsert: upsertFor(context.clientId),
    clientId: context.clientId,
    force: body?.force === true,
  });
}

async function handleMediaUrls(context, body) {
  const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.map((x) => String(x || '').trim()).filter(Boolean))] : [];
  if (!ids.length) throw badRequest('ids[] is required.');
  if (ids.length > MEDIA_URLS_MAX_IDS) throw badRequest(`At most ${MEDIA_URLS_MAX_IDS} ids per call.`);
  const kinds = Array.isArray(body?.kinds) && body.kinds.length ? body.kinds : ['thumb'];
  if (!kinds.every((k) => MEDIA_KINDS.includes(k))) throw badRequest(`kinds must be among ${MEDIA_KINDS.join(', ')}.`);
  const stored = await readStoredPackages(ids);
  const bridge = loadBridge();
  // Another client's id is simply absent (no URL minted for it).
  const urls = await resolveMediaUrlsBatch([...stored.values()].filter((p) => p.clientId === context.clientId), kinds, {
    hitloopBucket: fb.adminStorage.bucket(),
    signEv: (p) => bridge.signReadUrl(p),
  });
  return { ok: true, urls };
}

async function handleSaveThumb(context, body) {
  return saveThumb({
    getPackage: getPackageFor(context.clientId),
    upsertPackage: upsertFor(context.clientId),
    bucket: fb.adminStorage.bucket(),
  }, { clientId: context.clientId, id: String(body?.id || '').trim(), dataUrl: body?.dataUrl });
}

/** Items that could lend their media to one item (same Discogs release first, then title words). Read-only. */
async function handleFindItemMedia(context, body) {
  const id = String(body?.id || '').trim();
  if (!id) throw badRequest('id is required.');
  const { packages } = await readInventory({ clientId: context.clientId });
  const target = packages.find((p) => p.id === id);
  if (!target) throw badRequest(`Unknown item: ${id}`, 404);
  return { ok: true, id, candidates: findMediaCandidates(target, packages, { limit: body?.limit }) };
}

/**
 * Every package of a client, paged past readInventory's un-paged bound (READ_LIMIT NAS rows) so the high-res finder sees
 * the whole drive (~6k rows ~8s). Memoized per client for 60s: a find and the following use share one read.
 */
const readAllPackagesFor = memoByClient(60_000, async (clientId) => {
  const all = [];
  let cursor = null;
  for (let page = 0; page < 20; page += 1) {
    const r = await readInventory({ clientId, pageSize: 1000, ...(cursor ? { startAfter: cursor } : {}) });
    all.push(...r.packages);
    cursor = r.nextCursor;
    if (!cursor) break;
  }
  return all;
});

/** Bigger copies of a post's (or item's) picture on the NAS, ranked, with staged/worker state (hires-media.js). Read-only. */
async function handleFindHiresMedia(context, body) {
  const postId = String(body?.postId || '').trim();
  const packageId = String(body?.packageId || '').trim();
  if (!postId && !packageId) throw badRequest('postId or packageId is required.');
  const nasStatus = () => handleNasAction(nasDeps(context.clientId), 'nas-status', {});
  const out = await findHiresMedia({
    readPost: (id) => getSocialPost(context.clientId, id).then((p) => (p ? postStatusRow(p) : null)),
    readPackages: () => readAllPackagesFor(context.clientId),
    readStageStates: (ids) => readStageStatesFromDb(fb.adminDb, ids),
    nasStatus,
  }, { postId, packageId, limit: body?.limit });
  if (out.error) throw badRequest(out.error, 404);
  return out;
}

/**
 * Put the high-res original on a post (hires-media.js): queues the NAS copy when the file is not staged yet, otherwise
 * swaps the post's media (transaction; draft/approved/scheduled only, bumps revision) and links it to the item.
 */
async function handleHiresMediaUse(context, body, decoded) {
  const clientId = context.clientId;
  return useHiresMedia({
    getPost: (id) => getSocialPost(clientId, id),
    getPackage: getPackageFor(clientId),
    readPackages: () => readAllPackagesFor(clientId),
    pendingStage: (id) => pendingStageFromDb(fb.adminDb, id),
    nasStage: (id) => handleNasAction(nasDeps(clientId), 'nas-stage', { id }, decoded),
    nasStatus: () => handleNasAction(nasDeps(clientId), 'nas-status', {}),
    pickMedia: (pkg) => pickMedia(pkg, mediaSigners()),
    // Lifecycle swap: on an approved/scheduled v2 row a new original voids approval + schedule (re-approve to publish).
    applyPostMedia: (postId, media) => swapPostMedia(clientId, postId, media, { statuses: HIRES_EDITABLE_STATUSES }),
    upsertPackage: upsertFor(clientId),
    now: () => Date.now(),
  }, { clientId, postId: body?.postId, candidateId: body?.candidateId, packageId: body?.packageId });
}

/**
 * Put a Content Center item's media on a post (calendar editor creative picker). Same lifecycle swap as hi-res:
 * on an approved/scheduled v2 row the new creative voids approval + schedule. Format/staging checks live in attach-item-media.js.
 */
async function handleAttachItemMedia(context, body) {
  const clientId = context.clientId;
  return attachItemMedia({
    getPackage: getPackageFor(clientId),
    pickMedia: (pkg) => pickMedia(pkg, mediaSigners()),
    swapPostMedia: (postId, media) => swapPostMedia(clientId, postId, media, { statuses: HIRES_EDITABLE_STATUSES }),
    rowOf: async (postId) => { const post = await getSocialPost(clientId, postId); return post ? calendarRowOf(post) : null; },
  }, { clientId, postId: body?.postId, packageId: body?.packageId });
}

/**
 * Give items the media of other items of THIS client (item-media.js). Each link is independent: one bad pair fails
 * alone. Writes package fields only; never touches posts. Used by the route action and the confirmed chat proposal.
 */
async function linkItemMediaFor(clientId, rawLinks) {
  const norm = normalizeLinks(rawLinks);
  if (!norm.ok) throw badRequest(norm.errors.join('; '));
  const pkgs = await readStoredPackages([...new Set(norm.links.flatMap((l) => [l.targetId, l.sourceId]))]);
  const mine = (id) => { const p = pkgs.get(id); return p && p.clientId === clientId ? p : null; };
  const results = [];
  for (const l of norm.links) {
    const target = mine(l.targetId);
    const source = mine(l.sourceId);
    if (!target || !source) { results.push({ ...l, ok: false, error: `${!target ? l.targetId : l.sourceId} not found` }); continue; }
    const r = linkMediaPatch(target, source);
    if (r.error) { results.push({ ...l, ok: false, error: r.error }); continue; }
    try {
      await upsertFor(clientId)({ ...target, ...r.patch });
      results.push({ ...l, ok: true, kind: r.patch.mediaFrom.kind });
    } catch (err) {
      results.push({ ...l, ok: false, error: String(err?.message || err).slice(0, 160) });
    }
  }
  return { linked: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}

async function handleSetRights(context, body) {
  return setRights({ getPackage: getPackageFor(context.clientId), upsertPackage: upsertFor(context.clientId) },
    { id: String(body?.id || '').trim(), rights: body?.rights });
}

/** Media URL resolvers shared by create-draft-from-item and the daily loop's Save (the post stores the object ref; publish re-signs). */
function mediaSigners(bridge = loadBridge()) {
  return {
    async signEvLong(p) {
      try {
        const [url] = await bridge.bridgeBucket().file(p).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + EV_LONG_SIGN_MS });
        return url;
      } catch { return null; }
    },
    hitloopUrl: (p) => tokenUrlFor(fb.adminStorage.bucket(), p),
  };
}

async function handleCreateDraftFromItem(context, body) {
  const bridge = loadBridge();
  return createDraftFromItem({
    getPackage: getPackageFor(context.clientId),
    // Client-scoped, any open status (draft/approved/scheduled/queued/...): one package, one open post.
    findDraft: (packageId) => findOpenPostForPackage(context.clientId, packageId),
    ensureDraft: (clientId, payload) => ensureDraftPost(clientId, payload),
    createPost: createSocialPost,
    patchPost: (postId, patch) => fb.adminDb.collection('social_posts').doc(postId).set(patch, { merge: true }),
    ...mediaSigners(bridge),
  }, { clientId: context.clientId, id: String(body?.id || '').trim() });
}

async function latestDailyRun(store, clientId) {
  return store.latest({ clientId, localDate: localDateOf(Date.now()), channel: 'x', version: LOOP_VERSION });
}

// loadLoopCorpora is the known Today slowness; cache per client for 60s (same memo helper).
// The own handle is the client's (social account → saved profile → Brain), never the owner's.
const readLoopCorpora = memoByClient(LOOP_CORPORA_MEMO_MS, async (clientId) => {
  const xGrowth = await readXGrowthConfigFor(clientId).catch(() => null);
  const own = await resolveClientXHandle(fb.adminDb, clientId, { xGrowth });
  return loadClientLoopCorpora({
    corpusStore: getCorpusStore(),
    ownHandle: own.handle,
    profileHandles: resolveXGrowthProfile({ config: xGrowth }),
    loadCommitted: committedCorpusRows,
  });
});

/** One loader for the runner and the chat: same plan read, same Brain gating, same freshness rules. */
async function readContentContext(clientId, { packageIds = dailyLoopDemoSet.ids, now = Date.now() } = {}) {
  const { loadClientBrainContext } = require('../../../../features/client-brain/store.cjs');
  const loopCorpora = await readLoopCorpora(clientId);
  return loadContentContext({
    db: fb.adminDb,
    buildDayPlan: buildContentDayPlan,
    // Pending/scheduled copies count toward today's engine quota, not just posted ones.
    readRecentPosts: async (id) => recentPostsFromQueue(await readSocialQueue(id)),
    // One plan everywhere: the Strategy plan doc sets the loop's cadence, engine targets, floors and caps.
    readPlanDoc: (id) => createFirestorePlanStore(fb.adminDb).get(id),
    // The owner's Strategy document: a CONFIRMED doc's Rules + Formats ride along in drafting prompts.
    readStrategyDoc: (id) => createFirestoreStrategyDocStore(fb.adminDb).get(id),
    loadBrainContext: (id) => loadClientBrainContext(id, { useFor: 'socialPosts', requireApproved: true }),
    // Compact Market Signals block (headline/topics/opportunities/mentions) -> ctx.raw.marketSignals for both drafters.
    readMarketSignals,
  }, { clientId, now, packageIds, corpora: loopCorpora });
}

// ---- Calendar approve / unapprove (rule: the memory line never blocks approval; approving never schedules or publishes) ----

const calendarRowOf = (post) => {
  const ms = Date.parse(post.scheduledAt || post.postedAt || '');
  return { ...calendarPostRow(post), ...(Number.isFinite(ms) ? { time: new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms)) } : {}) };
};

async function approveCalendarPost(context, decoded, postId, expectedRevision, content) {
  let before = await getSocialPost(context.clientId, postId);
  if (!before) throw Object.assign(new Error('Post not found.'), { status: 404 });
  // Edited text from the row/sheet is applied first (revision-checked), then the placeholder is stripped on approve.
  if (typeof content === 'string' && content.trim() && content.trim() !== before.content) {
    if (expectedRevision != null && (before.revision || 0) !== Number(expectedRevision)) throw Object.assign(new Error('The post changed; reload and try again.'), { status: 409, code: 'revision-conflict' });
    before = await updateSocialPost(context.clientId, postId, { content });
    expectedRevision = before.revision;
  }
  const post = await approveDraft(context.clientId, postId, { reviewedBy: decoded?.email || decoded?.uid || null, expectedRevision });
  return { post, row: calendarRowOf(post), stripped: before.status === 'draft' && before.content !== post.content };
}

async function handleCalendarApprove(context, decoded, body) {
  const postId = String(body?.postId || '').trim();
  if (!postId) throw Object.assign(new Error('postId is required.'), { status: 400 });
  return { ok: true, ...(await approveCalendarPost(context, decoded, postId, body?.expectedRevision, body?.content)) };
}

async function handleCalendarUnapprove(context, body) {
  const postId = String(body?.postId || '').trim();
  if (!postId) throw Object.assign(new Error('postId is required.'), { status: 400 });
  const post = await unapproveDraft(context.clientId, postId, { expectedRevision: body?.expectedRevision });
  return { ok: true, post, row: calendarRowOf(post) };
}

/** Save a calendar suggestion / requote as a draft through the existing paths, then approve it. Nothing is scheduled or published. */
async function handleCalendarSuggestionApprove(context, decoded, body) {
  const kind = body?.kind;
  const id = String(body?.id || '').trim();
  if (!['suggestion', 'requote'].includes(kind) || !id) throw Object.assign(new Error('kind (suggestion|requote) and id are required.'), { status: 400 });
  let postId;
  if (kind === 'suggestion') {
    const store = createFirestoreRunStore(fb.adminDb);
    const run = await latestDailyRun(store, context.clientId);
    if (!run) throw Object.assign(new Error('No daily run found.'), { status: 404 });
    const key = { clientId: run.clientId, localDate: run.localDate, channel: run.channel, version: run.version };
    const postExists = async (pid) => (await fb.adminDb.collection('social_posts').doc(String(pid)).get()).exists;
    try {
      const saved = await saveSuggestionDraft({ store, getPackage: getPackageFor(context.clientId), createDraftPostOnce, postExists, ...mediaSigners() }, { key, suggestionId: id, text: typeof body?.text === 'string' ? body.text : undefined });
      postId = saved.postId;
    } catch (err) {
      if (err.checks) return { ok: false, status: err.status || 422, error: err.message, checks: err.checks };
      if (err.code === 'needs-staging') return { ok: false, status: err.status || 409, error: err.message, code: err.code, packageId: err.packageId };
      throw err;
    }
  } else {
    const targets = await readCalendarQuoteTargets(context.clientId);
    const t = targets.find((x) => String(x.id) === id || String(x.url).endsWith(`/status/${id}`));
    if (!t) throw Object.assign(new Error('That quote target is no longer open.'), { status: 404 });
    const created = Date.parse(t.createdAt || '');
    if (!Number.isFinite(created) || created + windowHoursOf(t) * 3_600_000 <= Date.now()) throw Object.assign(new Error('The quote window for that post has closed.'), { status: 409, code: 'window-closed' });
    if (!QUOTE_URL_RE.test(String(t.url || ''))) throw Object.assign(new Error('That quote target has no valid post URL.'), { status: 422 });
    const handle = String(t.handle || '').replace(/^@/, '');
    const today = ctDate(Date.now());
    // Same row shape as the daily-fill quote draft (same idempotency key, so a fill and this click never double up); a plain
    // quote with no caption, since the memory line is never required.
    const { post } = await ensureDraftPost(context.clientId, {
      idempotencyKey: `daily-fill:${today}:quote:${t.id}`,
      content: t.url, source: 'daily-fill', fillKind: 'quote', fillSource: { type: 'quote-target', id: String(t.id), asOf: today }, reviewOn: today,
      needsStory: false, expiresAt: new Date(created + windowHoursOf(t) * 3_600_000).toISOString(),
      sourceRef: { kind: 'quote-target', url: t.url, id: String(t.id), handle: handle || null },
    });
    postId = post.id;
  }
  const out = await approveCalendarPost(context, decoded, postId, undefined);
  return { ok: true, kind, created: true, ...out };
}

/** Real I/O for decideCalendarItem (calendar-decide.js). Nothing here calls X; a replacement fill writes review drafts only. */
function calendarItemDecideDeps(context, decoded) {
  const clientId = context.clientId;
  return {
    getPost: (cid, postId) => getSocialPost(cid, postId),
    rejectPost: (cid, postId, opts) => rejectDraft(cid, postId, { reviewedBy: opts?.by, expectedRevision: opts?.expectedRevision }),
    unschedulePost: (cid, postId, opts) => updateSocialPost(cid, postId, { scheduledAt: null }, { expectedRevision: opts?.expectedRevision }),
    dismissQuoteTarget: (cid, targetId) => handleDismiss(cid, { candidateId: targetId }),
    dismissSuggestion: async (cid, suggestionId) => {
      const store = createFirestoreRunStore(fb.adminDb);
      const run = await latestDailyRun(store, cid);
      if (!run) throw Object.assign(new Error('No daily run found.'), { status: 404 });
      await dismissSuggestion({ store }, { key: { clientId: run.clientId, localDate: run.localDate, channel: run.channel, version: run.version }, suggestionId });
    },
    rejectPackage: (cid, packageId) => handleDecidePackage({ clientId: cid }, decoded, { id: packageId }, 'rejected'),
    getPackage: (cid, packageId) => getPackageFor(cid)(packageId),
    fill: (cid, spec, opts) => getStrategyHandlers().dailyFill(cid, spec, opts),
    openQuoteTargets: (cid) => readCalendarQuoteTargets(cid),
    rowOf: async (cid, postId) => { const post = await getSocialPost(cid, postId); return post ? calendarRowOf(post) : null; },
    now: () => Date.now(),
  };
}

async function handleCalendarItemDecide(context, decoded, body) {
  return decideCalendarItem(calendarItemDecideDeps(context, decoded), {
    clientId: context.clientId, decision: body?.decision, item: body?.item, by: decoded?.email || decoded?.uid || null,
  });
}

async function handleDailyRun(context, action, body) {
  // Fails closed with a code naming the missing input (approved Brain / plan doc / connected X, or contentLoop.enabled).
  await assertClientReady(fb.adminDb, context.clientId);
  const store = createFirestoreRunStore(fb.adminDb);
  if (action === 'daily-run-latest') return { ok: true, run: await overlayStagedMedia(await latestDailyRun(store, context.clientId), getPackageFor(context.clientId)) };

  if (action === 'daily-run-generate') {
    let draft;
    if (body?.draftWithModel === true) {
      const { createAnthropicClient } = require('../../../../features/not-the-rug-brief/anthropic-client.js');
      const { logAnthropicCall } = require('../../../../api/_lib/usage-logger.cjs');
      draft = createModelDrafter({ anthropic: createAnthropicClient(), logAnthropicCall, clientId: context.clientId });
    }
    const res = await runDailyLoop({
      now: () => Date.now(),
      store,
      draft,
      // The shared content context (same loader the strategy chat reads); `raw` is the runner's legacy input shape.
      readInputs: async () => {
        const ctx = await readContentContext(context.clientId, {
          // Pilot client: the full library by default; the verified demo set only when explicitly asked for.
          packageIds: body?.library === 'demo' ? dailyLoopDemoSet.ids : null,
        });
        // Degraded mode: never generate against a queue we could not read (it could conflict with scheduled posts).
        if (ctx.raw.recentPostsError) {
          throw Object.assign(new Error('The posting queue could not be read, so recommendations are paused (they could conflict with scheduled posts). Try again in a minute.'), { status: 503 });
        }
        return ctx.raw;
      },
    }, { clientId: context.clientId, force: body?.force === true, inputSource: 'live' });
    return { ok: true, skipped: !!res.skipped, reason: res.reason || null, run: res.run || await latestDailyRun(store, context.clientId) };
  }

  const run = await latestDailyRun(store, context.clientId);
  if (!run) throw Object.assign(new Error('No daily run to review yet — generate one first.'), { status: 404 });
  const key = { clientId: run.clientId, localDate: run.localDate, channel: run.channel, version: run.version };
  const suggestionId = String(body?.suggestionId || '').trim();
  if (!suggestionId) throw Object.assign(new Error('suggestionId is required.'), { status: 400 });

  if (action === 'daily-run-dismiss') {
    await dismissSuggestion({ store }, { key, suggestionId });
  } else if (action === 'daily-run-edit') {
    // Empty text clears the edit; saved/dismissed suggestions are refused (409) by editSuggestion.
    const suggestion = await editSuggestion({ store }, { key, suggestionId, text: typeof body?.text === 'string' ? body.text : '' });
    return { ok: true, suggestion, run: await store.read(key) };
  } else {
    const text = typeof body?.text === 'string' ? body.text : undefined;
    const postExists = async (id) => (await fb.adminDb.collection('social_posts').doc(String(id)).get()).exists;
    try {
      const saved = await saveSuggestionDraft({ store, getPackage: getPackageFor(context.clientId), createDraftPostOnce, postExists, ...mediaSigners() }, { key, suggestionId, text });
      return { ok: true, ...saved, run: await store.read(key) };
    } catch (err) {
      if (err.checks) return { ok: false, error: err.message, checks: err.checks, status: err.status };
      if (err.code === 'needs-staging') return { ok: false, error: err.message, code: err.code, packageId: err.packageId, status: err.status };
      throw err;
    }
  }
  return { ok: true, run: await store.read(key) };
}

/** Accept either {bucket:{...}} or the fields flat beside action/clientId. */
function stripEnvelope(body = {}) {
  const { action: _a, clientId: _c, ...rest } = body;
  return rest;
}

async function handleBucketAction(context, action, body) {
  const cid = context.clientId;
  if (action === 'list-buckets') return { ok: true, buckets: await bucketStore.listBuckets(cid) };
  // A bucket change re-syncs the content tracks (one track per active bucket); a sync failure never fails the bucket write.
  const withTrackSync = async (out) => {
    const sync = await getStrategyHandlers().syncTracks(cid);
    return { ok: true, ...out, tracksSynced: !!sync?.changed };
  };
  if (action === 'upsert-bucket') return withTrackSync(await bucketStore.upsertBucket(cid, body?.bucket ?? stripEnvelope(body)));
  if (action === 'delete-bucket') return withTrackSync(await bucketStore.deleteBucket(cid, body?.bucketId ?? body?.id, { reassignTo: body?.reassignTo }));
  if (action === 'list-folders') return { ok: true, folders: await bucketStore.listFolders(cid, { bucketId: body?.bucketId || undefined }) };
  if (action === 'upsert-folder') return { ok: true, ...(await bucketStore.upsertFolder(cid, body?.folder ?? stripEnvelope(body))) };
  return { ok: true, ...(await bucketStore.deleteFolder(cid, body?.folderId ?? body?.id)) };
}

function nasDeps(clientId) {
  return {
    db: fb.adminDb,
    fieldValue: fb.FieldValue,
    getPackage: getPackageFor(clientId),
    upsertPackage: upsertFor(clientId),
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    randomId: () => randomUUID(),
  };
}

// X Strategy tab (master plan T2b). Lazy: Firestore stores are built on first strategy request.
let strategyHandlers = null;
function getStrategyHandlers() {
  if (!strategyHandlers) {
    strategyHandlers = createStrategyHandlersFromDb(fb.adminDb, {
      readAllPackages: readAllPackagesFor,
      onXGrowthSaved: (clientId, prior, next) => require('../../../../features/client-brain/brain-sync.cjs').recordXGrowthEdits(clientId, prior, next),
      onBrainOwnedSaved: (clientId, target, prior, next) => require('../../../../features/client-brain/brain-sync.cjs').recordCardEdits(clientId, target, prior, next),
      readBrainTrackTargets: (clientId) => require('../../../../features/client-brain/brain-sync.cjs').readApprovedTrackTargets(clientId),
      loadCommitted: committedCorpusRows,
      readPackages: async (clientId) => (await readInventory({ clientId })).packages,
      linkItemMedia: (clientId, links) => linkItemMediaFor(clientId, links),
      upsertBucket: (clientId, bucket) => bucketStore.upsertBucket(clientId, bucket),
      deleteBucket: (clientId, bucketId, opts) => bucketStore.deleteBucket(clientId, bucketId, opts),
      mediaForItem: (clientId, pkg) => (pkg && pkg.clientId === clientId ? pickMedia(pkg, mediaSigners()) : null),
      runDailyAction: (context, action, body) => handleDailyRun(context, action, body),
      // Agent / MCP calendar cleanup card (propose_calendar_decide), run on the owner's Confirm: one item at a time,
      // a failed item is reported in its row and never stops the rest.
      decideCalendarItems: async ({ clientId, items }) => {
        const results = [];
        for (const { decision, item } of Array.isArray(items) ? items : []) {
          try {
            // eslint-disable-next-line no-await-in-loop
            results.push(await decideCalendarItem(calendarItemDecideDeps({ clientId }, null), { clientId, decision, item, by: 'agent-card' }));
          } catch (err) {
            results.push({ ok: false, decision, kind: item?.kind ?? null, error: String(err?.message || err).slice(0, 200), reason: err?.code ?? null });
          }
        }
        return { ok: results.some((r) => r.ok), results };
      },
      runUpdateItemFacets: (context, body) => handleUpdateItemFacets(context, body),
      readTodayRun: (clientId) => latestDailyRun(createFirestoreRunStore(fb.adminDb), clientId),
      readContentContext: async (clientId) => summarizeContentContext(await readContentContext(clientId)),
      readQueueSummary,
      readPostsForQuery,
      readQueuePosts: readSocialQueue,
      readPost: readPostForChat,
      readOpportunities,
      readQuoteTargets: readQuoteTargetsForFill,
      readHotQuotes: async (clientId) => (await readQuoteState(clientId)).hotQuotes,
      readResults: readResultsForChat,
      readMarketSignals,
      editPost: editQueuedPost,
      // A confirmed `paid-sync` card (created by the MCP server's request_sync) runs here, and only here: the owner's
      // Confirm click reaches this through strategy-proposal-decide. The daily cap is enforced inside executePaidSync.
      runPaidSync: ({ clientId, kind, params, auth }) => executePaidSync({
        kind, params,
        ctx: {
          email: auth?.decoded?.email || 'admin', clientId, auth, now: () => Date.now(),
          services: {
            strategyHandlers: getStrategyHandlers,
            xMonitor: loadXMonitorService,
            counters: () => createFirestoreCounters(fb.adminDb),
            nas: async (action, body, email) => {
              try { return await handleNasAction(nasDeps(clientId), action, body, { ...(auth?.decoded || {}), email }); } catch (err) {
                if (err?.status && err.status < 500) return { ok: false, error: err.message, status: err.status };
                throw err;
              }
            },
          },
        },
      }),
    });
  }
  return strategyHandlers;
}

const BUCKET_ACTIONS = new Set(['list-buckets', 'upsert-bucket', 'delete-bucket', 'list-folders', 'upsert-folder', 'delete-folder']);

export async function POST(request) {
  let context;
  let decoded;
  try {
    ({ context, decoded } = await requireAdminContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const action = body?.action || new URL(request.url).searchParams.get('action') || '';
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
    if (action === 'content-context') {
      return json({ ok: true, context: summarizeContentContext(await readContentContext(context.clientId)) });
    }
    if (action === 'post-status') return json(await handlePostStatus(context, body));
    if (action === 'quoted-post-preview') return json(await handleQuotedPostPreview(context, body));
    if (action === 'post-results') return json(await handlePostResults(context));
    if (action === 'month-calendar') {
      return json(await handleMonthCalendar(context, body));
    }
    if (action === 'calendar-approve') return json(await handleCalendarApprove(context, decoded, body));
    if (action === 'calendar-unapprove') return json(await handleCalendarUnapprove(context, body));
    if (action === 'calendar-suggestion-approve') {
      const result = await handleCalendarSuggestionApprove(context, decoded, body);
      return json(result, result.ok === false ? (result.status || 422) : 200);
    }
    if (action === 'calendar-item-decide') return json(await handleCalendarItemDecide(context, decoded, body));
    if (action === 'content-task-update') return json(await handleContentTaskUpdate(context, body));
    if (action === 'engine-performance') {
      return json(await handleEnginePerformance(context, body));
    }
    if (action === 'capture-client-story') {
      return json(await handleCaptureClientStory(context, body));
    }
    if (action === 'approve-package') {
      return json(await handleDecidePackage(context, decoded, body, 'approved'));
    }
    if (action === 'reject-package') {
      return json(await handleDecidePackage(context, decoded, body, 'rejected'));
    }
    if (STRATEGY_ROUTE_ACTIONS.includes(action)) {
      // `authorization` + `impersonating` let the chat agent's run_action call routes AS this owner (same checks as the UI).
      const result = await getStrategyHandlers().handle(action, body, context, { decoded, authorization: request.headers.get('authorization'), origin: new URL(request.url).origin, impersonating: context.impersonating === true });
      return json(result, result.ok === false ? (result.status || 422) : 200);
    }
    if (BUCKET_ACTIONS.has(action)) return json(await handleBucketAction(context, action, body));
    if (action === 'update-item-facets') return json(await handleUpdateItemFacets(context, body));
    if (action === 'move-item') return json(await handleMoveItem(context, body));
    if (action === 'media-url') return json(await handleMediaUrl(context, body));
    if (action === 'sync-rendered-videos') return json(await handleSyncRenderedVideos(context, body));
    if (action === 'media-urls') return json(await handleMediaUrls(context, body));
    if (action === 'save-thumb') return json(await handleSaveThumb(context, body));
    if (action === 'find-item-media') return json(await handleFindItemMedia(context, body));
    if (action === 'find-hires-media') return json(await handleFindHiresMedia(context, body));
    if (action === 'hires-media-use') return json(await handleHiresMediaUse(context, body, decoded));
    if (action === 'post-attach-item-media') {
      const result = await handleAttachItemMedia(context, body);
      return json(result, result.ok === false ? (result.status || 422) : 200);
    }
    if (action === 'link-item-media') return json({ ok: true, ...(await linkItemMediaFor(context.clientId, body?.links)) });
    if (action === 'set-rights') return json(await handleSetRights(context, body));
    if (action === 'create-draft-from-item') return json(await handleCreateDraftFromItem(context, body));
    if (NAS_ACTIONS.includes(action)) return json(await handleNasAction(nasDeps(context.clientId), action, body, decoded));
    if (DAILY_RUN_ACTIONS.includes(action)) {
      const result = await handleDailyRun(context, action, body);
      return json(result, result.ok === false ? (result.status || 422) : 200);
    }
    if (DISCOGS_ACTIONS.includes(action)) return json(await handleDiscogsAction(nasDeps(context.clientId), action, body, decoded));
    if (TIMELINE_ACTIONS.includes(action)) return json(await handleTimelineAction({ db: fb.adminDb, clientId: context.clientId, store: timelineStore }, action, body));
    return json({ error: `Unknown action: ${action}`, supportedActions: SUPPORTED_ACTIONS }, 400);
  } catch (err) {
    if (err?.status) {
      return json({ error: err.message, code: err.code || undefined, verdict: err.verdict || undefined }, err.status);
    }
    return json({ error: err.message || 'Quote targets action failed.' }, 500);
  }
}
