import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import ownCorpusRows from '../../../../docs/audits/bai-ee-x-corpus.json' with { type: 'json' };
import benchmarkCorpusRows from '../../../../docs/audits/seb-design-x-corpus.json' with { type: 'json' };

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);
const EV_LONG_SIGN_MS = 6.9 * 24 * 60 * 60 * 1000; // v4 signed URLs cap at 7 days

// Daily content loop cron (06:30 CT). Generates today's suggestions for each PILOT_CLIENT_IDS client from the latest
// SAVED scan, with fallback copy only: no model drafter is wired, so this route cannot spend on a model. It never calls
// bird. The ONLY X API spend is the opt-in auto-daily step (runXApiAutoStep: dataSources 'x-api' + autoDaily on, budget-capped). Fails closed in production without CRON_SECRET, and without PILOT_CLIENT_IDS.
// Same loader wiring as the dashboard's daily-run-generate (app/api/dashboard/quote-targets/route.js readContentContext).
async function buildReadInputsFor() {
  const fb = require('../../../../api/_lib/firebase-admin.cjs');
  const { loadClientBrainContext } = require('../../../../features/client-brain/store.cjs');
  const [
    { readSocialQueue }, { buildDayPlan }, { recentPostsFromQueue }, { createFirestoreCorpusStore }, { createFirestorePlanStore },
    { loadContentContext }, { loadClientLoopCorpora }, { resolveXGrowthProfile }, { createFirestoreStrategyDocStore },
    { assertClientReady, resolveClientXHandle },
  ] = await Promise.all([
    import('../../../../features/social-posting/twitter-service.js'),
    import('../../../../features/x-content-inventory/plan-day.js'),
    import('../../../../features/x-content-inventory/allocate-slot.js'),
    import('../../../../features/x-strategy/corpus-store.js'),
    import('../../../../features/x-strategy/plan-store.js'),
    import('../../../../features/content-context/load-content-context.js'),
    import('../../../../features/x-strategy/loop-corpora.js'),
    import('../../../../features/x-benchmark/profile.js'),
    import('../../../../features/x-strategy/strategy-doc-store.js'),
    import('../../../../features/client-readiness/index.js'),
  ]);
  // Handle-keyed cache for @bai_ee / @seb__design only (not a default): a client reaches these rows only when its own resolved handle is one of them.
  const committed = { bai_ee: ownCorpusRows, seb__design: benchmarkCorpusRows };
  const committedCorpusRows = (h) => (Object.hasOwn(committed, h) ? committed[h] : null);
  const corpusStore = createFirestoreCorpusStore(fb.adminDb, { loadCommitted: committedCorpusRows });
  const readXGrowthConfigFor = async (clientId) => {
    const snap = await fb.adminDb.collection('client_configs').doc(clientId).get();
    return snap.exists ? snap.data()?.marketingBriefConfig?.xGrowth ?? null : null;
  };
  return {
    db: fb.adminDb,
    committedCorpusRows,
    assertReady: (clientId) => assertClientReady(fb.adminDb, clientId),
    async readInputsFor(clientId) {
      const xGrowth = await readXGrowthConfigFor(clientId).catch(() => null);
      // The client's own handle (social account → saved profile → Brain); never the owner's.
      const own = await resolveClientXHandle(fb.adminDb, clientId, { xGrowth });
      const corpora = await loadClientLoopCorpora({
        corpusStore,
        ownHandle: own.handle,
        profileHandles: resolveXGrowthProfile({ config: xGrowth }),
        loadCommitted: committedCorpusRows,
      });
      const ctx = await loadContentContext({
        db: fb.adminDb,
        buildDayPlan,
        readRecentPosts: async (id) => recentPostsFromQueue(await readSocialQueue(id)),
        readPlanDoc: (id) => createFirestorePlanStore(fb.adminDb).get(id),
        readStrategyDoc: (id) => createFirestoreStrategyDocStore(fb.adminDb).get(id),
        loadBrainContext: (id) => loadClientBrainContext(id, { useFor: 'socialPosts', requireApproved: true }),
      }, { clientId, now: Date.now(), packageIds: null, corpora });
      if (ctx.raw.recentPostsError) {
        throw Object.assign(new Error('The posting queue could not be read; recommendations paused.'), { status: 503 });
      }
      return ctx.raw;
    },
  };
}

// Daily fill (calendar drafts per bucket track): runs AFTER the suggestions step, non-fatal, drafts only (never publishes).
// Choice: reuse the Strategy handler factory's `dailyFill` (it already wires ensureDraft/placeDraft/readOpenPackageIds)
// instead of hand-building runDailyFillForCron deps here. readPackages is the FULL inventory (readAllPackages, every
// page, as on the dashboard route), not the suggestions step's slimmed projection: that projection drops clientId
// (mediaForItem's owner check, so no draft got its media), renderedAt (newest-first ordering) and nas (the throwback
// media link).
// Handlers without `dailyFill` are reported as failed, never as a healthy skip.
async function runDailyFillStep({ db, committedCorpusRows }, clientIds, today) {
  let handlers;
  try {
    const { createStrategyHandlersFromDb } = await import('../../../../features/x-strategy/route-handlers.js');
    const { pickMedia } = await import('../../../../features/x-content-inventory/item-actions.js');
    const { readAllPackages } = await import('../../../../features/x-content-inventory/store.js');
    const { tokenUrlFor } = await import('../../../../features/x-content-inventory/thumbs.js');
    const { projectBrief } = require('../../../../features/intelligence/_brief-intel.js');
    const fb = require('../../../../api/_lib/firebase-admin.cjs');
    const bridge = require('../../../../api/_lib/editvideos-bridge.cjs');
    // Same signers as the dashboard route's mediaSigners (the post stores the object ref; publish re-signs).
    const signers = {
      async signEvLong(p) {
        try {
          const [url] = await bridge.bridgeBucket().file(p).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + EV_LONG_SIGN_MS });
          return url;
        } catch { return null; }
      },
      hitloopUrl: (p) => tokenUrlFor(fb.adminStorage.bucket(), p),
    };
    handlers = createStrategyHandlersFromDb(db, {
      loadCommitted: committedCorpusRows,
      // Every page: the un-paged read drops NAS rows past the 2,000th id (throwback items went "not found").
      readPackages: (clientId) => readAllPackages({ clientId, db }),
      // Narratives come from the projected Market Signals brief, as on the dashboard route.
      readMarketSignals: async (clientId) => {
        const snap = await db.collection('dashboard_state').doc(clientId).get();
        return snap.exists ? projectBrief(snap.data()?.marketingBrief, snap.data()) : null;
      },
      mediaForItem: (clientId, pkg) => (pkg && pkg.clientId === clientId ? pickMedia(pkg, signers) : null),
    });
  } catch (err) {
    return clientIds.map((clientId) => ({ clientId, ok: false, error: String(err?.message || err).slice(0, 200) }));
  }
  if (typeof handlers.dailyFill !== 'function') return clientIds.map((clientId) => ({ clientId, ok: false, error: 'daily-fill-unavailable' }));
  const out = [];
  for (const clientId of clientIds) {
    try {
      // Only clients with a saved strategy that has content tracks: a client without one gets no automatic drafts.
      const planSnap = await db.collection('x_strategy_plans').doc(clientId).get();
      const tracks = planSnap.exists ? planSnap.data()?.plan?.contentTracks : null;
      if (!Array.isArray(tracks) || !tracks.length) { out.push({ clientId, ok: true, skipped: 'no-content-tracks' }); continue; }
      const r = await handlers.dailyFill(clientId, { from: today, days: 7 }, { execute: true });
      if (r?.ok === false) { out.push({ clientId, ok: false, error: String(r.error || 'daily fill failed').slice(0, 200) }); continue; }
      // runDailyFill returns ok:true with per-draft write failures in failed[]: any failed write fails this client.
      const failedRows = Array.isArray(r?.failed) ? r.failed : [];
      const failed = failedRows.length || (Number.isFinite(r?.failed) ? r.failed : 0);
      const mb = r?.mediaBackfill;
      out.push({
        clientId, ok: failed === 0, created: r?.created?.length ?? r?.created ?? 0, existing: r?.existing?.length ?? r?.existing ?? 0, placed: r?.placed?.length ?? r?.placed ?? 0, failed,
        ...(failed ? { error: `${failed} draft write(s) failed${failedRows[0]?.error ? `: ${String(failedRows[0].error).slice(0, 160)}` : ''}` } : {}),
        // Calendar media backfill (calendar-media-backfill.js): media attached / NAS copies queued / drafts still bare.
        ...(mb ? { mediaBackfill: mb.ok ? { attached: mb.attached.length, staging: mb.staging.length, lent: mb.lent.length, bare: mb.bare.length, failed: mb.failed.length } : { error: mb.error } } : {}),
      });
    } catch (err) {
      out.push({ clientId, ok: false, error: String(err?.message || err).slice(0, 200) });
    }
  }
  return out;
}

// Rendered videos -> content library (Dj Mix Videos bucket): the 06:00 daily email render is done by ~06:03, so syncing
// here (before suggestions and the fill) puts it in the bucket the same day without anyone opening the Content Engine.
// Only the rendered-video owner (RENDERED_VIDEOS_CLIENT_ID, else NAS_INVENTORY_CLIENT_ID) has the feed; everyone else is a no-op. Non-fatal; reported as
// `renderedVideos`. force: the cron runs once a day, so the dashboard's 10-minute throttle must not skip it.
async function runRenderedVideoSyncStep(db, clientIds) {
  try {
    const { syncRenderedVideosForClient, mediaOwnerClientId } = await import('../../../../features/rendered-videos/firestore-sync.js');
    const owner = mediaOwnerClientId();
    if (!owner || !clientIds.includes(owner)) return { ok: true, skipped: 'media-owner-not-in-run' };
    const { upsertPackage } = await import('../../../../features/x-content-inventory/store.js');
    const bridge = require('../../../../api/_lib/editvideos-bridge.cjs');
    const r = await syncRenderedVideosForClient({
      db, bridge, clientId: owner, force: true,
      upsert: (pkg) => upsertPackage(pkg, { returnPackages: false, clientId: owner }),
    });
    return { clientId: owner, ok: r?.ok !== false, created: r?.created ?? 0, updated: r?.updated ?? 0, total: r?.total ?? 0 };
  } catch (err) {
    return { ok: false, error: String(err?.message || err).slice(0, 200) };
  }
}

// Auto-daily X API refresh (strategy accounts + quote targets): ONLY for clients whose dataSources are 'x-api' with
// autoDaily on; a default client (all 'mac') is skipped without a read of X. Runs before the fill so the fill sees the
// fresh scan. Non-fatal and budget-capped (the pullers call assertXBudget); summarized in the response as `xApiAuto`.
async function runXApiAutoStep(db, clientIds) {
  try {
    const [{ runAutoDailyXApi }, { readDataSources }, { pullCorporaViaXApi, createFirestoreUserIdCache }, { scanQuoteTargetsViaXApi, createFirestoreQuotePayloadWriter }, { createFirestoreCorpusStore }] = await Promise.all([
      import('../../../../features/x-strategy/auto-daily.js'),
      import('../../../../features/x-strategy/data-sources.js'),
      import('../../../../features/x-strategy/x-api-pull.js'),
      import('../../../../features/x-quote-targets/x-api-scan.js'),
      import('../../../../features/x-strategy/corpus-store.js'),
    ]);
    const store = createFirestoreCorpusStore(db);
    const userIdCache = createFirestoreUserIdCache(db);
    const offset = Math.floor(Date.now() / 86_400_000) * 15; // rotate the quote-scan window daily
    return await runAutoDailyXApi(clientIds, {
      readDataSources: (id) => readDataSources(db, id),
      pullCorpora: async (id) => {
        const { readClientXGrowth } = await import('../../../../features/x-strategy/pull-corpora.js');
        return pullCorporaViaXApi(id, { readXGrowth: (cid) => readClientXGrowth(db, cid), store, userIdCache });
      },
      scanQuotes: (id) => scanQuoteTargetsViaXApi(id, { db, offset, userIdCache, writePayload: createFirestoreQuotePayloadWriter(db) }),
    });
  } catch (err) {
    return [{ ok: false, error: String(err?.message || err).slice(0, 200) }];
  }
}

async function run(request) {
  const { cronAuthorized, pilotClientIds, runScheduledDailyLoop } = await import('../../../../features/x-content-inventory/daily-loop/scheduled.js');
  if (!cronAuthorized({ authorization: request.headers.get('authorization') || '', vercelCron: request.headers.get('x-vercel-cron') || '' })) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }
  let clientIds;
  try { clientIds = pilotClientIds(); } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: err.status || 503 });
  }
  const { createFirestoreRunStore } = await import('../../../../features/x-content-inventory/daily-run-store.js');
  const built = await buildReadInputsFor();
  const { db, assertReady, readInputsFor } = built;
  // "Today and queue" is a Daily-profile group (Refresh modal "Daily" tab): clients that untick it (or switch Daily
  // off) get no suggestions or calendar fill from this cron. No saved profile = ticked, as before.
  const refreshDaily = require('../../../../features/intelligence/_refresh-daily.js');
  const todayIds = [];
  const dailyOff = [];
  for (const clientId of clientIds) {
    // eslint-disable-next-line no-await-in-loop
    const groups = refreshDaily.cronGroupsFor(await refreshDaily.readRefreshDaily(clientId).catch(() => refreshDaily.resolveRefreshDaily({})));
    (groups.has('today-queue') ? todayIds : dailyOff).push(clientId);
  }
  const renderedVideos = await runRenderedVideoSyncStep(db, todayIds);
  const ran = todayIds.length ? await runScheduledDailyLoop({ store: createFirestoreRunStore(db), assertReady, readInputsFor }, { clientIds: todayIds }) : [];
  const results = [...ran, ...dailyOff.map((clientId) => ({ clientId, ok: true, skipped: 'not-in-daily-profile' }))];
  // The X API auto-daily step has its own per-client switch (X source autoDaily), independent of "Today and queue".
  const xApiAuto = await runXApiAutoStep(db, results.filter((r) => r.ok).map((r) => r.clientId));
  // A fill failure never blocks or changes the suggestions result (suggestionsOk), but it does fail the top-level ok.
  let dailyFill = [];
  try {
    const { localDateOf } = await import('../../../../features/x-content-inventory/daily-loop/time-ids.js');
    dailyFill = await runDailyFillStep(built, ran.filter((r) => r.ok).map((r) => r.clientId), localDateOf(Date.now()));
  } catch (err) {
    dailyFill = [{ ok: false, error: String(err?.message || err).slice(0, 200) }];
  }
  const suggestionsOk = results.every((r) => r.ok);
  return NextResponse.json({ ok: suggestionsOk && dailyFill.every((r) => r.ok), suggestionsOk, results, xApiAuto, renderedVideos, dailyFill });
}

export const GET = run;
export const POST = run;
