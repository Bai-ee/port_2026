import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import ownCorpusRows from '../../../../docs/audits/bai-ee-x-corpus.json' with { type: 'json' };
import benchmarkCorpusRows from '../../../../docs/audits/seb-design-x-corpus.json' with { type: 'json' };

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);

// Daily content loop cron (06:30 CT). Generates today's suggestions for each PILOT_CLIENT_IDS client from the latest
// SAVED scan, with fallback copy only: no model drafter is wired, so this route cannot spend on a model. It never
// calls bird or the X API. Fails closed in production without CRON_SECRET, and without PILOT_CLIENT_IDS.
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
  const { db, assertReady, readInputsFor } = await buildReadInputsFor();
  const results = await runScheduledDailyLoop({ store: createFirestoreRunStore(db), assertReady, readInputsFor }, { clientIds });
  return NextResponse.json({ ok: results.every((r) => r.ok), results });
}

export const GET = run;
export const POST = run;
