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

// Reuse a published brief younger than this instead of re-running (and re-paying)
// on a fresh send. Protects against repeated "Run & Send" clicks within minutes.
const REUSE_WINDOW_MINUTES = 90;

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

  return render({
    marketingBrief,
    clientName: clientDisplayName(client, clientId),
    websiteUrl: client?.websiteUrl || '',
    generatedAt: marketingBrief.generatedAtIso || new Date().toISOString(),
    clientId,
    userEmail: process.env.DIGEST_EMAIL || '',
    tier: dash.tier || client?.tier || 'free',
    strategyData: dash.strategy30 ? { strategy30: dash.strategy30 } : null,
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

/** Run a fresh brief, persist it, render + publish it. Returns the public path or null. */
async function runAndPublishFreshBrief({ clientId, client }) {
  const { runClientPipeline } = require('../not-the-rug-brief/runtime.js');
  const runLifecycle = require('../../api/_lib/run-lifecycle.cjs');

  const ccSnap = await fb.adminDb.collection('client_configs').doc(clientId).get();
  const clientConfig = ccSnap.exists ? ccSnap.data() : null;

  const result = await runClientPipeline({ clientId, clientConfig });
  if (!result || result.status !== 'succeeded') throw new Error(`pipeline status ${result?.status || 'unknown'}`);

  // Persist to dashboard_state so the render + the dashboard both see the new brief.
  const runId = result.pipelineRunId || `digest-${clientId}-${Date.now()}`;
  try { await runLifecycle.completeRun(runId, clientId, result); } catch { /* non-fatal */ }

  const html = await renderExecutiveBriefHtml(clientId, client);
  return publishBriefDoc({ clientId, client, html });
}

/**
 * Resolve the hosted Executive Brief URL for the digest email.
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

  const latest = await getLatestPublishedBrief(clientId).catch(() => null);

  // 'latest', or 'fresh' on a preview (no paid run) → newest published brief.
  if (mode !== 'fresh' || !allowFreshRun) return abs(latest?.path || null);

  // 'fresh': reuse a very recent publish to avoid reburning cost on repeat sends.
  if (latest && (Date.now() - latest.updatedAtMs) < REUSE_WINDOW_MINUTES * 60 * 1000) {
    return abs(latest.path);
  }

  try {
    const freshPath = await runAndPublishFreshBrief({ clientId, client });
    return abs(freshPath || latest?.path || null);
  } catch {
    // Any failure (pipeline, render import, publish) → newest published or null.
    return abs(latest?.path || null);
  }
}

module.exports = { resolveExecutiveBriefUrl, getLatestPublishedBrief };
