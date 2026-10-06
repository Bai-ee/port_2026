import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { randomUUID } from 'crypto';
import { createSocialPost, readSocialQueue } from '../../../../features/social-posting/twitter-service.js';
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
import { readInventory, upsertPackage, deletePackage, getPackage } from '../../../../features/x-content-inventory/store.js';
import { buildClientPackage, applyApproval } from '../../../../features/x-content-inventory/client-capture.js';
import { buildWeekCalendar } from '../../../../features/x-content-inventory/week-calendar.js';
import { joinPerformance, engineStats } from '../../../../features/x-content-inventory/performance.js';
import { mergeEngineConfig } from '../../../../features/x-content-inventory/engine-quota.js';
import * as bucketStore from '../../../../features/x-content-inventory/bucket-store.js';
import { normalizeFacets } from '../../../../features/x-content-inventory/facets.js';
import { resolveMediaUrls } from '../../../../features/rendered-videos/media-url.js';
import { syncRenderedVideos } from '../../../../features/rendered-videos/sync.js';
import { resolveMediaUrlsBatch, MEDIA_URLS_MAX_IDS, MEDIA_KINDS, tokenUrlFor } from '../../../../features/x-content-inventory/thumbs.js';
import { setRights, saveThumb, createDraftFromItem } from '../../../../features/x-content-inventory/item-actions.js';
import { NAS_ACTIONS, handleNasAction } from '../../../../features/x-content-inventory/nas.js';
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
  ...NAS_ACTIONS,
  'engine-performance',
  'draft-quote',
  'dismiss',
  'refresh-analysis',
  'content-plan',
  'inventory-list',
  'inventory-save',
  'inventory-delete',
  'week-calendar',
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
  'set-rights',
  'create-draft-from-item',
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
 * Week calendar over social_posts. Read-only: the buttons on the card call the
 * existing social-posting actions (approve-draft / schedule), never this route.
 * Reads the whole client queue and filters in memory, which needs no new index.
 */
async function handleWeekCalendar(context, body) {
  const start = typeof body?.start === 'string' && DATE_RE.test(body.start.trim())
    ? body.start.trim()
    : new Date().toISOString().slice(0, 10);

  let overrides = null;
  try {
    const snap = await fb.adminDb.collection('content_system_config').doc('x').get();
    overrides = snap.exists ? snap.data() : null;
  } catch {
    // Config is advisory; defaults keep the calendar usable.
  }
  const config = mergeEngineConfig(overrides);
  const posts = await readSocialQueue(context.clientId);
  return { ok: true, calendar: buildWeekCalendar({ posts, start, config }) };
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
  const { pkg, created, warnings } = await upsertPackage(built.pkg, { returnPackages: false });
  return { ok: true, pkg, created, warnings: warnings ?? built.warnings };
}

/** Admin-only (the whole route is): record an approve/reject decision. */
async function handleDecidePackage(decoded, body, state) {
  const id = typeof body?.id === 'string' ? body.id.trim() : '';
  if (!id) {
    const err = new Error('id is required.');
    err.status = 400;
    throw err;
  }
  const existing = await getPackage(id);
  if (!existing) {
    const err = new Error(`No package ${id}.`);
    err.status = 404;
    throw err;
  }
  const next = applyApproval(existing, state, decoded?.email || decoded?.uid || null);
  const { pkg } = await upsertPackage(next, { returnPackages: false });
  return { ok: true, pkg };
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
  const existing = await getPackage(id);
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
  const { pkg } = await upsertPackage(next, { returnPackages: false });
  return { ok: true, pkg: { id: pkg.id, bucketId: pkg.bucketId ?? null, story: pkg.story, humanEdits: pkg.humanEdits || {}, facets: pkg.facets || {}, searchTokens: pkg.searchTokens || [] } };
}

async function handleMoveItem(context, body) {
  const id = typeof body?.id === 'string' ? body.id.trim() : '';
  const bucketId = typeof body?.bucketId === 'string' ? body.bucketId.trim() : '';
  if (!id || !bucketId) throw badRequest('id and bucketId are required.');
  const buckets = await bucketStore.listBuckets(context.clientId);
  if (!buckets.some((b) => b.id === bucketId)) throw badRequest(`Unknown bucket: ${bucketId}`);
  const existing = await getPackage(id);
  if (!existing) throw badRequest(`No package ${id}.`, 404);
  const { pkg } = await upsertPackage({ ...existing, bucketId }, { returnPackages: false });
  return { ok: true, id: pkg.id, bucketId: pkg.bucketId };
}

/** Fresh 1h signed URL(s) for a rendered-video package's stored ev: object path.
 * Admin-only (the POST gate). Paths are stored, never URLs, so this is the only
 * place a signed URL is minted for the Studio. */
async function handleMediaUrl(body) {
  const id = String(body?.id || '').trim();
  if (!id) throw badRequest('id is required.');
  const pkg = await getPackage(id); // initializes the Hitloop adminDb BEFORE the bridge (named app)
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

const rvMetaRef = (clientId) => fb.adminDb.collection('content_buckets').doc(clientId).collection('meta').doc('rendered-videos');

async function handleSyncRenderedVideos(context, body) {
  const bridge = loadBridge();
  const clientId = context.clientId;
  return syncRenderedVideos({
    async listVideos() {
      const videos = [];
      let cursor = null;
      for (let i = 0; i < 50; i += 1) {
        const page = await bridge.listRenderedVideos({ limit: 200, startAfter: cursor });
        videos.push(...page.videos);
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      return videos;
    },
    async listMediaJobs(jobIds) {
      const map = new Map();
      for (let i = 0; i < jobIds.length; i += 30) {
        const snap = await fb.adminDb.collection('media_jobs').where('editJobId', 'in', jobIds.slice(i, i + 30)).get();
        for (const d of snap.docs) { const j = d.data(); if (j.editJobId) map.set(String(j.editJobId), j); }
      }
      return map;
    },
    readExisting: readStoredPackages,
    upsert: (pkg) => upsertPackage(pkg, { returnPackages: false }),
    async readMeta() { const s = await rvMetaRef(clientId).get(); return s.exists ? s.data() : null; },
    async writeMeta(m) { await rvMetaRef(clientId).set(m, { merge: true }); },
    now: () => Date.now(),
    ueArtists: [], // artists.json is a local file; sync keeps stored genres/era (see sync.js)
  }, { force: body?.force === true });
}

async function handleMediaUrls(context, body) {
  const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.map((x) => String(x || '').trim()).filter(Boolean))] : [];
  if (!ids.length) throw badRequest('ids[] is required.');
  if (ids.length > MEDIA_URLS_MAX_IDS) throw badRequest(`At most ${MEDIA_URLS_MAX_IDS} ids per call.`);
  const kinds = Array.isArray(body?.kinds) && body.kinds.length ? body.kinds : ['thumb'];
  if (!kinds.every((k) => MEDIA_KINDS.includes(k))) throw badRequest(`kinds must be among ${MEDIA_KINDS.join(', ')}.`);
  const stored = await readStoredPackages(ids);
  const bridge = loadBridge();
  const urls = await resolveMediaUrlsBatch([...stored.values()], kinds, {
    hitloopBucket: fb.adminStorage.bucket(),
    signEv: (p) => bridge.signReadUrl(p),
  });
  return { ok: true, urls };
}

async function handleSaveThumb(context, body) {
  return saveThumb({
    getPackage,
    upsertPackage: (pkg) => upsertPackage(pkg, { returnPackages: false }),
    bucket: fb.adminStorage.bucket(),
  }, { clientId: context.clientId, id: String(body?.id || '').trim(), dataUrl: body?.dataUrl });
}

async function handleSetRights(body) {
  return setRights({ getPackage, upsertPackage: (pkg) => upsertPackage(pkg, { returnPackages: false }) },
    { id: String(body?.id || '').trim(), rights: body?.rights });
}

async function handleCreateDraftFromItem(context, body) {
  const bridge = loadBridge();
  return createDraftFromItem({
    getPackage,
    async findDraft(packageId) {
      const snap = await fb.adminDb.collection('social_posts').where('packageId', '==', packageId).limit(10).get();
      const rows = snap.docs.map((d) => d.data());
      return rows.find((r) => r.status === 'draft' || r.status === 'scheduled') || rows[0] || null;
    },
    createPost: createSocialPost,
    patchPost: (postId, patch) => fb.adminDb.collection('social_posts').doc(postId).set(patch, { merge: true }),
    async signEvLong(p) {
      try {
        const [url] = await bridge.bridgeBucket().file(p).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + EV_LONG_SIGN_MS });
        return url;
      } catch { return null; }
    },
    hitloopUrl: (p) => tokenUrlFor(fb.adminStorage.bucket(), p),
  }, { clientId: context.clientId, id: String(body?.id || '').trim() });
}

/** Accept either {bucket:{...}} or the fields flat beside action/clientId. */
function stripEnvelope(body = {}) {
  const { action: _a, clientId: _c, ...rest } = body;
  return rest;
}

async function handleBucketAction(context, action, body) {
  const cid = context.clientId;
  if (action === 'list-buckets') return { ok: true, buckets: await bucketStore.listBuckets(cid) };
  if (action === 'upsert-bucket') return { ok: true, ...(await bucketStore.upsertBucket(cid, body?.bucket ?? stripEnvelope(body))) };
  if (action === 'delete-bucket') return { ok: true, ...(await bucketStore.deleteBucket(cid, body?.bucketId ?? body?.id, { reassignTo: body?.reassignTo })) };
  if (action === 'list-folders') return { ok: true, folders: await bucketStore.listFolders(cid, { bucketId: body?.bucketId || undefined }) };
  if (action === 'upsert-folder') return { ok: true, ...(await bucketStore.upsertFolder(cid, body?.folder ?? stripEnvelope(body))) };
  return { ok: true, ...(await bucketStore.deleteFolder(cid, body?.folderId ?? body?.id)) };
}

function nasDeps() {
  return {
    db: fb.adminDb,
    fieldValue: fb.FieldValue,
    getPackage,
    upsertPackage: (pkg) => upsertPackage(pkg, { returnPackages: false }),
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    randomId: () => randomUUID(),
  };
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
    if (action === 'week-calendar') {
      return json(await handleWeekCalendar(context, body));
    }
    if (action === 'engine-performance') {
      return json(await handleEnginePerformance(context, body));
    }
    if (action === 'capture-client-story') {
      return json(await handleCaptureClientStory(context, body));
    }
    if (action === 'approve-package') {
      return json(await handleDecidePackage(decoded, body, 'approved'));
    }
    if (action === 'reject-package') {
      return json(await handleDecidePackage(decoded, body, 'rejected'));
    }
    if (BUCKET_ACTIONS.has(action)) return json(await handleBucketAction(context, action, body));
    if (action === 'update-item-facets') return json(await handleUpdateItemFacets(context, body));
    if (action === 'move-item') return json(await handleMoveItem(context, body));
    if (action === 'media-url') return json(await handleMediaUrl(body));
    if (action === 'sync-rendered-videos') return json(await handleSyncRenderedVideos(context, body));
    if (action === 'media-urls') return json(await handleMediaUrls(context, body));
    if (action === 'save-thumb') return json(await handleSaveThumb(context, body));
    if (action === 'set-rights') return json(await handleSetRights(body));
    if (action === 'create-draft-from-item') return json(await handleCreateDraftFromItem(context, body));
    if (NAS_ACTIONS.includes(action)) return json(await handleNasAction(nasDeps(), action, body, decoded));
    return json({ error: `Unknown action: ${action}`, supportedActions: SUPPORTED_ACTIONS }, 400);
  } catch (err) {
    if (err?.status) {
      return json({ error: err.message, verdict: err.verdict || undefined }, err.status);
    }
    return json({ error: err.message || 'Quote targets action failed.' }, 500);
  }
}
