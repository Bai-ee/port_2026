// readers.js - the strategy agent's chat readers, built for the MCP server.
//
// app/api/dashboard/quote-targets/route.js builds the same readers privately (a Next route file may not export
// helpers, and importing a route into another route is not allowed), so they are re-stated here over the same
// shared modules. If the route's readers change, change these too (output shape is what the tools expose).
// SERVER ONLY: pulls in Firestore-backed modules and bundled JSON corpora; never imported by the node tests.

import { createRequire } from 'node:module';
import { readSocialQueue, getSocialPost } from '../social-posting/twitter-service.js';
import { ageHoursOf, DEFAULT_WINDOW_HOURS } from '../x-quote-targets/rank.js';
import { joinPerformance, engineStats } from '../x-content-inventory/performance.js';
import { buildDayPlan as buildContentDayPlan } from '../x-content-inventory/plan-day.js';
import { readInventory } from '../x-content-inventory/store.js';
import { recentPostsFromQueue } from '../x-content-inventory/allocate-slot.js';
import { createFirestoreRunStore } from '../x-content-inventory/daily-run-store.js';
import { runDailyLoop, assertOwnerClient, localDateOf, LOOP_VERSION } from '../x-content-inventory/daily-loop.js';
import { loadContentContext, summarizeContentContext } from '../content-context/load-content-context.js';
import { loadLoopCorpora } from '../x-strategy/loop-corpora.js';
import { resolveXGrowthProfile } from '../x-benchmark/profile.js';
import { createFirestoreCorpusStore } from '../x-strategy/corpus-store.js';
import { createFirestorePlanStore } from '../x-strategy/plan-store.js';
import { createFirestoreStrategyDocStore } from '../x-strategy/strategy-doc-store.js';
import ownCorpusRows from '../../docs/audits/bai-ee-x-corpus.json' with { type: 'json' };
import benchmarkCorpusRows from '../../docs/audits/seb-design-x-corpus.json' with { type: 'json' };
import dailyLoopDemoSet from '../x-content-inventory/daily-loop-demo-set.json' with { type: 'json' };

const require = createRequire(import.meta.url);

const COMMITTED_CORPORA = { bai_ee: ownCorpusRows, seb__design: benchmarkCorpusRows };
export const committedCorpusRows = (handle) => (Object.hasOwn(COMMITTED_CORPORA, handle) ? COMMITTED_CORPORA[handle] : null);

const excerptOf = (t, n = 160) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const postStatusRow = (p) => ({
  id: p.id, status: p.status, scheduledAt: p.scheduledAt || null, postedAt: p.postedAt || null,
  reviewedAt: p.reviewedAt || null, content: p.content, packageId: p.packageId || null, source: p.source || null, updatedAt: p.updatedAt || null,
  errorClass: p.errorClass || null, error: p.error || null, replyTo: !!p.replyTo, revision: p.revision || 0,
  lifecycleVersion: p.lifecycleVersion || null,
  provenance: { runId: p.runId || null, suggestionId: p.suggestionId || null, strategyVersion: p.strategyVersion ?? null, sourceRef: p.sourceRef || null },
});

export function createReaders(db) {
  let corpusStore = null;
  const getCorpusStore = () => (corpusStore ||= createFirestoreCorpusStore(db, { loadCommitted: committedCorpusRows }));
  const readXGrowthConfigFor = async (clientId) => {
    const snap = await db.collection('client_configs').doc(clientId).get();
    return snap.exists ? snap.data()?.marketingBriefConfig?.xGrowth ?? null : null;
  };

  const readQuoteTargets = async (clientId) => {
    const snap = await db.collection('dashboard_state').doc(clientId).get();
    return snap.exists ? snap.data()?.marketingBrief?.quoteTargets ?? null : null;
  };

  async function readQueueSummary(clientId) {
    const posts = await readSocialQueue(clientId);
    const counts = {};
    for (const p of posts) counts[p.status] = (counts[p.status] || 0) + 1;
    return {
      counts,
      // Newest 200 across every source (same as the dashboard route); the tool filters and caps what the model sees.
      posts: posts.slice(0, 200).map((p) => ({ id: p.id, status: p.status, scheduledAt: p.scheduledAt || null, source: p.source || null, excerpt: excerptOf(p.content), packageId: p.packageId || null, errorClass: p.errorClass || null })),
    };
  }

  // Latest Market Signals report via the canonical brief projection (same as the dashboard route). Read-only.
  async function readMarketSignals(clientId) {
    const snap = await db.collection('dashboard_state').doc(clientId).get();
    if (!snap.exists) return null;
    const state = snap.data();
    const { projectBrief } = require('../intelligence/_brief-intel.js');
    return projectBrief(state?.marketingBrief, state);
  }

  async function readPost(clientId, postId) {
    const p = await getSocialPost(clientId, postId);
    return p ? postStatusRow(p) : null;
  }

  async function readOpportunities(clientId) {
    const qt = await readQuoteTargets(clientId);
    const now = Date.now();
    const generatedMs = Date.parse(qt?.generatedAt || '');
    const targets = (Array.isArray(qt?.candidates) ? qt.candidates : []).slice(0, 10).map((c) => {
      const ageHours = ageHoursOf(c.createdAt, now);
      return {
        id: c.id || c.url || null,
        handle: c.author?.username || (typeof c.author === 'string' ? c.author : null),
        url: c.url || null,
        text: excerptOf(c.text),
        ageHours: ageHours == null ? null : Math.round(ageHours * 10) / 10,
        windowOpen: ageHours == null ? null : ageHours <= DEFAULT_WINDOW_HOURS,
        kind: 'quote',
      };
    });
    return { generatedAt: qt?.generatedAt || null, stale: Number.isFinite(generatedMs) ? (now - generatedMs) / 3_600_000 > 48 : null, targets };
  }

  async function readResults(clientId) {
    const rows = joinPerformance({ posts: await readSocialQueue(clientId) });
    const stats = engineStats(rows, { windowDays: 30, now: Date.now() });
    return {
      window: `last ${stats.windowDays} days`,
      engines: Object.entries(stats.engines).map(([engine, e]) => ({
        engine, n: e.n ?? null, medianViews: e.medianViews ?? null,
        caveats: [e.insufficient ? `Fewer than ${stats.minN} measured posts: not ranked.` : null, 'Lift is likes-based; missing metrics are not zero.'].filter(Boolean),
      })),
    };
  }

  /** Same loader as the runner and the in-app chat: same plan read, same Brain gating, same freshness rules. */
  async function readContentContext(clientId, { packageIds = dailyLoopDemoSet.ids, now = Date.now() } = {}) {
    const { loadClientBrainContext } = require('../client-brain/store.cjs');
    const loopCorpora = await loadLoopCorpora({
      corpusStore: getCorpusStore(),
      profileHandles: resolveXGrowthProfile({ config: await readXGrowthConfigFor(clientId).catch(() => null) }),
      loadCommitted: committedCorpusRows,
    });
    return loadContentContext({
      db,
      buildDayPlan: buildContentDayPlan,
      readRecentPosts: async (id) => recentPostsFromQueue(await readSocialQueue(id)),
      readPlanDoc: (id) => createFirestorePlanStore(db).get(id),
      readStrategyDoc: (id) => createFirestoreStrategyDocStore(db).get(id),
      loadBrainContext: (id) => loadClientBrainContext(id, { useFor: 'socialPosts', requireApproved: true }),
    }, { clientId, now, packageIds, corpora: loopCorpora });
  }

  const latestDailyRun = (store, clientId) => store.latest({ clientId, localDate: localDateOf(Date.now()), channel: 'x', version: LOOP_VERSION });

  /** Template-only daily loop (NO model call): the free path behind regenerate_today_suggestions. */
  async function regenerateToday(clientId, { force = false } = {}) {
    assertOwnerClient(clientId);
    const store = createFirestoreRunStore(db);
    const res = await runDailyLoop({
      now: () => Date.now(),
      store,
      draft: undefined,
      readInputs: async () => {
        const ctx = await readContentContext(clientId, { packageIds: null });
        if (ctx.raw.recentPostsError) {
          throw Object.assign(new Error('The posting queue could not be read, so recommendations are paused (they could conflict with scheduled posts). Try again in a minute.'), { status: 503, expose: true });
        }
        return ctx.raw;
      },
    }, { clientId, force: force === true, inputSource: 'live' });
    const run = res.run || await latestDailyRun(store, clientId);
    return {
      skipped: !!res.skipped, reason: res.reason || null, localDate: run?.localDate ?? null,
      suggestionCount: run?.suggestions?.length ?? 0, drafting: 'template-only (no model call)',
      next: 'Read the suggestions with strategy_get_today_run. Nothing was saved, scheduled or posted.',
    };
  }

  return {
    strategyExtras: {
      onXGrowthSaved: (clientId, prior, next) => require('../client-brain/brain-sync.cjs').recordXGrowthEdits(clientId, prior, next),
      onBrainOwnedSaved: (clientId, target, prior, next) => require('../client-brain/brain-sync.cjs').recordCardEdits(clientId, target, prior, next),
      readBrainTrackTargets: (clientId) => require('../client-brain/brain-sync.cjs').readApprovedTrackTargets(clientId),
      loadCommitted: committedCorpusRows,
      readPackages: async () => (await readInventory()).packages,
      readTodayRun: (clientId) => latestDailyRun(createFirestoreRunStore(db), clientId),
      readContentContext: async (clientId) => summarizeContentContext(await readContentContext(clientId)),
      readQueueSummary, readPost, readOpportunities, readResults, readMarketSignals,
    },
    regenerateToday,
  };
}
