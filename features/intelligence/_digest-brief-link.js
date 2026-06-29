'use strict';

// _digest-brief-link.js — resolves the "Open Executive Brief" link for the daily
// digest email. Three modes (digest_config.briefLinkMode):
//   'off'    → no hosted link (caller hides the button / uses the dashboard fallback)
//   'latest' → link to the newest already-published hosted brief (free, read-only)
//   'fresh'  → run a brand-new brief on send, publish it, link to it (LLM cost)
//
// Every path is best-effort: any failure resolves to the newest published brief,
// or null, so the digest route can fall back to the dashboard link. A brief
// problem must NEVER block the email. CJS so the ESM digest route can require it.

const fb = require('../../api/_lib/firebase-admin.cjs');

function compactSlug(value, fallback) {
  const slug = String(value || '')
    .trim().toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '');
  return slug || String(fallback || '').replace(/[^a-z0-9]+/gi, '').toLowerCase() || 'brief';
}

function clientDisplayName(client, fallback) {
  return client?.companyName || client?.name || client?.dashboardTitle || client?.displayName || fallback;
}

function tsToMs(value) {
  if (!value) return 0;
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (typeof value === 'string') { const n = Date.parse(value); return Number.isFinite(n) ? n : 0; }
  if (typeof value === 'number') return value;
  return 0;
}

/** Newest published (public:true) custom brief for a client, or null. */
async function getLatestPublishedBrief(clientId) {
  const snap = await fb.adminDb
    .collection('clients').doc(clientId).collection('custom_briefs')
    .where('public', '==', true).limit(20).get();
  if (snap.empty) return null;
  const docs = snap.docs
    .map((d) => ({ id: d.id, data: d.data() || {} }))
    .sort((a, b) => Math.max(tsToMs(b.data.updatedAt), tsToMs(b.data.createdAt)) - Math.max(tsToMs(a.data.updatedAt), tsToMs(a.data.createdAt)));
  const top = docs[0];
  const publicClientSlug = top.data.publicClientSlug || compactSlug(top.id, clientId);
  const publicBriefSlug = top.data.publicBriefSlug || compactSlug(top.data.briefSlug || top.id, top.id);
  return {
    path: `/briefs/${encodeURIComponent(publicClientSlug)}/${encodeURIComponent(publicBriefSlug)}`,
    updatedAtMs: Math.max(tsToMs(top.data.updatedAt), tsToMs(top.data.createdAt)),
  };
}

/** Render the standalone Executive Brief HTML for a client from dashboard_state. */
async function renderExecutiveBriefHtml(clientId, client) {
  // Dynamic import: the renderer is exported from the (ESM) brief-preview route.
  const mod = await import('../../app/api/dashboard/brief-preview/route.js');
  const render = mod.renderMarketingBriefHtml || mod.default?.renderMarketingBriefHtml;
  if (typeof render !== 'function') throw new Error('renderMarketingBriefHtml unavailable');

  const dashSnap = await fb.adminDb.collection('dashboard_state').doc(clientId).get();
  const dash = dashSnap.exists ? dashSnap.data() || {} : {};
  const marketingBrief = dash.marketingBrief || null;
  if (!marketingBrief) throw new Error('no marketingBrief in dashboard_state');
  const executiveSummary = dash.briefSummaries?.['executive-daily'] || null;
  const freshFloorMs = Math.max(
    tsToMs(marketingBrief.generatedAtIso),
    tsToMs(dash.strategyBuilder?.lastPlan?.generatedAt)
  );
  const freshExecutiveSummary = tsToMs(executiveSummary?.generatedAtIso) >= Math.max(0, freshFloorMs - 5 * 60 * 1000)
    ? executiveSummary.summary
    : null;

  return render({
    marketingBrief,
    clientName: clientDisplayName(client, clientId),
    websiteUrl: client?.websiteUrl || '',
    generatedAt: marketingBrief.generatedAtIso || new Date().toISOString(),
    clientId,
    userEmail: process.env.DIGEST_EMAIL || '',
    tier: dash.tier || client?.tier || 'free',
    moduleBriefs: dash.moduleBriefs?.items || [],
    auditMockupUrl: dash.artifacts?.homepageDeviceMockup?.downloadUrl || null,
    socialPreviewImageUrl: dash.siteMeta?.ogImage || null,
    siteMeta: dash.siteMeta || null,
    fullPageScreenshots: dash.artifacts?.fullPageScreenshots || null,
    company: {
      brandOverview: dash.snapshot?.brandOverview || null,
      brandTone: dash.snapshot?.brandTone || null,
      onboardingSummary: dash.onboardingAnswers
        ? {
            total: 10,
            answeredCount: Object.values(dash.onboardingAnswers.answers || {}).filter((a) => a && !a.skipped && a.value != null).length,
            completedAt: dash.onboardingAnswers.completedAt || null,
          }
        : null,
      knowledgeBaseSources: dash.knowledgeBase?.sources || [],
    },
    strategyData: {
      strategy30: dash.strategy30 || null,
      strategy: dash.strategy || null,
      strategyBuilder: dash.strategyBuilder?.lastPlan || null,
    },
    signalsCore: Array.isArray(dash.signals?.core) ? dash.signals.core : [],
    dashboardState: dash,
    coverSummary: freshExecutiveSummary,
    briefType: 'executive-daily',
  });
}

/** Write a published custom-brief doc directly via the admin SDK and return its path. */
async function publishBriefDoc({ clientId, client, html }) {
  const now = new Date();
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
  const briefSlug = `daily-${now.toISOString().slice(0, 10)}`;   // doc id
  const publicClientSlug = compactSlug(
    client?.publicClientSlug || client?.publicSlug || clientDisplayName(client, clientId), clientId,
  );
  const publicBriefSlug = compactSlug(`daily ${ymd}`, briefSlug);
  const title = `Executive Brief · ${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;

  await fb.adminDb
    .collection('clients').doc(clientId).collection('custom_briefs').doc(briefSlug)
    .set({
      html, title, briefSlug, publicBriefSlug, publicClientSlug,
      public: true,
      description: `Daily executive brief for ${clientDisplayName(client, clientId)}.`,
      source: 'daily-digest',
      createdAt: fb.FieldValue.serverTimestamp(),
      updatedAt: fb.FieldValue.serverTimestamp(),
    }, { merge: true });

  // Alias so the public route resolves the client slug → clientId.
  await fb.adminDb.collection('brief_client_slugs').doc(publicClientSlug)
    .set({ clientId }, { merge: true });

  return `/briefs/${encodeURIComponent(publicClientSlug)}/${encodeURIComponent(publicBriefSlug)}`;
}

/**
 * Resolve the hosted Executive Brief URL for the digest email.
 *
 * The daily-digest route refreshes the client's intelligence BEFORE calling this
 * (on a real send), so `dashboard_state` is already fresh here. 'fresh' therefore
 * just renders that fresh state and publishes it to today's hosted slug — it does
 * NOT run its own pipeline (that would double the cost). Every failure degrades to
 * the newest published brief, or null, so the email is never blocked.
 *
 * @param {object} opts
 * @param {string} opts.mode  'fresh' | 'latest' | 'off'
 * @param {boolean} opts.allowFreshRun  true only on a real send; a preview passes
 *   false so it never publishes (just links the newest published brief).
 * @returns {Promise<string|null>} absolute URL, or null to use the caller's fallback.
 */
async function resolveExecutiveBriefUrl({ clientId, mode = 'fresh', origin = '', allowFreshRun = false } = {}) {
  if (!clientId || mode === 'off') return null;
  const base = String(origin || '').replace(/\/+$/, '');
  const abs = (path) => (path ? `${base}${path}` : null);

  let client = null;
  try {
    const cSnap = await fb.adminDb.collection('clients').doc(clientId).get();
    client = cSnap.exists ? cSnap.data() || {} : {};
  } catch { client = {}; }

  // 'fresh' on a real send: render the just-refreshed dashboard_state brief and
  // publish it to today's hosted slug, overwriting any stale same-day content.
  if (mode === 'fresh' && allowFreshRun) {
    try {
      const html = await renderExecutiveBriefHtml(clientId, client);
      const path = await publishBriefDoc({ clientId, client, html });
      return abs(path);
    } catch {
      // render/publish failed → fall through to newest published / null.
    }
  }

  // 'latest', or a 'fresh' preview, or a 'fresh' publish that failed.
  const latest = await getLatestPublishedBrief(clientId).catch(() => null);
  return abs(latest?.path || null);
}

module.exports = { resolveExecutiveBriefUrl, getLatestPublishedBrief };
