'use strict';

// _brief-intel.js — reads the established daily-brief intelligence for a client
// and normalizes it for the daily email. Mirrors the strategy of the dashboard
// brief (renderMarketingBriefHtml): scout narrative, post opportunities, and
// KOL / competitor / narrative signals + generated posts. Source of truth:
// `dashboard_state/{clientId}.marketingBrief`.

const fb = require('../../api/_lib/firebase-admin.cjs');

function arr(v) {
  return Array.isArray(v) ? v : [];
}

/**
 * Read + normalize the latest brief intelligence for a client.
 * Returns null if no marketingBrief has been generated for the client yet.
 * @returns {Promise<null | {
 *   headline: string, humanBrief: string, generatedAt: string|null,
 *   opportunities: Array, kols: Array, competitors: Array, narratives: Array,
 *   content: object, readyToPublish: boolean|null
 * }>}
 */
async function getBriefIntelligence(clientId) {
  if (!clientId) return null;
  let state = null;
  try {
    const snap = await fb.adminDb.collection('dashboard_state').doc(clientId).get();
    state = snap.exists ? snap.data() : null;
  } catch {
    return null;
  }
  const marketingBrief = state?.marketingBrief;
  if (!marketingBrief) return null;

  const agentData = marketingBrief?.scoutBrief?.agentData || {};
  const opportunities = arr(agentData?.viralOpportunities?.opportunities).length
    ? arr(agentData.viralOpportunities.opportunities)
    : arr(marketingBrief?.contentOpportunities);

  return {
    headline: marketingBrief?.headline || state?.headline || '',
    humanBrief: marketingBrief?.scoutBrief?.humanBrief || '',
    generatedAt: marketingBrief?.generatedAtIso || null,
    opportunities: opportunities.slice(0, 6).map((o) => ({
      topic: o.conversation || o.topic || o.title || 'Opportunity',
      angle: o.injectionAngle || o.whyNow || o.summary || '',
      priority: o.priority || o.authenticity || '',
      windowHours: o.windowHours || null,
      url: o.url || '',
    })),
    kols: arr(agentData.kolActivity).slice(0, 5).map((k) => ({
      name: k.name || k.author || 'KOL',
      platform: k.platform || '',
      detail: k.content || k.summary || '',
      sentiment: k.sentiment || '',
      url: k.url || '',
    })),
    competitors: arr(agentData.competitorIntel).slice(0, 5).map((c) => ({
      name: c.competitor || 'Competitor',
      finding: c.finding || '',
      impact: c.impact || '',
      url: c.url || '',
    })),
    narratives: arr(agentData.categoryTrends).slice(0, 5).map((t) => ({
      trend: t.trend || t.topic || 'Trend',
      detail: t.detail || '',
      relevance: t.relevance || '',
    })),
    content: marketingBrief?.content || {},
    readyToPublish: marketingBrief?.guardianFlags?.readyToPublish ?? null,
    _agentData: agentData, // raw, for per-handle watchlist matching (stripped before return)
  };
}

function normHandle(s) {
  return String(s || '').toLowerCase().replace(/^@/, '').trim();
}

/**
 * Match each configured watchlist account (kols) to its activity in this run's
 * agentData. Returns one entry per handle — name-for-name — with the activity
 * found (or found:false when the account was quiet this run).
 */
function buildWatchlist(kols, agentData) {
  const handles = arr(kols).map((k) => String(k || '').trim()).filter(Boolean);
  if (!handles.length) return [];
  const kolActivity = arr(agentData?.kolActivity);
  const mentions = arr(agentData?.brandMentions);
  return handles.map((handle) => {
    const h = normHandle(handle);
    const activity = [];
    for (const k of kolActivity) {
      const hay = `${normHandle(k.name)} ${String(k.content || '').toLowerCase()} ${String(k.url || '').toLowerCase()}`;
      if (h && hay.includes(h)) activity.push({ text: k.content || k.summary || '', url: k.url || '', platform: k.platform || 'x' });
    }
    for (const m of mentions) {
      const hay = `${normHandle(m.author)} ${String(m.content || '').toLowerCase()} ${String(m.url || '').toLowerCase()}`;
      if (h && hay.includes(h)) activity.push({ text: m.content || '', url: m.url || '', platform: '' });
    }
    return { handle, found: activity.length > 0, activity: activity.slice(0, 4) };
  });
}

/** Compact, model-readable text block of the brief intelligence for the LLM. */
function briefIntelToText(intel) {
  if (!intel) return '';
  const lines = ['Established daily brief (mirror this strategy):'];
  if (intel.headline) lines.push(`Headline: ${intel.headline}`);
  if (intel.humanBrief) lines.push(`Scout brief: ${intel.humanBrief}`);
  if (intel.opportunities.length) {
    lines.push('Post opportunities today:');
    intel.opportunities.forEach((o) => lines.push(`- ${o.topic}${o.angle ? ` — ${o.angle}` : ''}${o.windowHours ? ` (act within ${o.windowHours}h)` : ''}`));
  }
  if (intel.kols.length) {
    lines.push('KOL activity:');
    intel.kols.forEach((k) => lines.push(`- ${k.name}${k.platform ? ` (${k.platform})` : ''}: ${k.detail}`));
  }
  if (intel.competitors.length) {
    lines.push('Competitor moves:');
    intel.competitors.forEach((c) => lines.push(`- ${c.name}: ${c.finding}${c.impact ? ` [${c.impact}]` : ''}`));
  }
  if (intel.narratives.length) {
    lines.push('Narratives to get into:');
    intel.narratives.forEach((n) => lines.push(`- ${n.trend}${n.detail ? ` — ${n.detail}` : ''}`));
  }
  if (arr(intel.watchlist).length) {
    lines.push('Watchlist accounts (report each by name):');
    intel.watchlist.forEach((w) => {
      lines.push(w.found
        ? `- ${w.handle}: ${w.activity.map((a) => a.text).filter(Boolean).join(' | ').slice(0, 300)}`
        : `- ${w.handle}: no activity surfaced this run`);
    });
  }
  return lines.join('\n');
}

/** Resolve { clientId, clientName, intel } for a client, or null if no brief. */
async function getBriefForClient(clientId) {
  if (!clientId) return null;
  const intel = await getBriefIntelligence(clientId);
  if (!intel) return null;
  let clientName = clientId;
  let kols = [];
  try {
    const snap = await fb.adminDb.collection('clients').doc(clientId).get();
    if (snap.exists) clientName = snap.data()?.companyName || clientId;
  } catch {
    /* fall back to clientId */
  }
  try {
    const cfg = await fb.adminDb.collection('client_configs').doc(clientId).get();
    kols = arr(cfg.data()?.marketingBriefConfig?.kols);
  } catch {
    /* no config — empty watchlist */
  }
  intel.watchlist = buildWatchlist(kols, intel._agentData);
  delete intel._agentData;
  return { clientId, clientName, intel };
}

module.exports = { getBriefIntelligence, briefIntelToText, getBriefForClient, buildWatchlist };
