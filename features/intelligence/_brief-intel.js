'use strict';

// _brief-intel.js — reads the established daily-brief intelligence for a client
// and normalizes it for the daily email. Mirrors the strategy of the dashboard
// brief (renderMarketingBriefHtml): scout narrative, post opportunities, and
// KOL / competitor / narrative signals + generated posts. Source of truth:
// `dashboard_state/{clientId}.marketingBrief`.

const fb = require('../../api/_lib/firebase-admin.cjs');
const { getClientWeather } = require('./_weather.js');

function arr(v) {
  return Array.isArray(v) ? v : [];
}

/**
 * Read + normalize the latest brief intelligence for a client.
 * Returns null if no marketingBrief has been generated for the client yet.
 *
 * CANONICAL PROJECTION: this is the single normalized view of
 * `dashboard_state.marketingBrief.scoutBrief` that the email digest, the
 * executive brief (dashboard renderMarketingBriefHtml), and the newsletter
 * aggregator all consume. It is a SUPERSET of every agentData signal — no
 * caps are applied (admin WIP surface), so no consumer loses fields. Do not
 * re-read agentData directly in a consumer; extend this projection instead.
 *
 * @returns {Promise<null | {
 *   headline: string, humanBrief: string, delta: string, generatedAt: string|null,
 *   opportunities: Array, kols: Array, competitors: Array, narratives: Array,
 *   brandMentions: Array, redditSignals: Array, localDemandSignals: Array,
 *   searchedFor: Array, content: object, readyToPublish: boolean|null
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
  return projectBrief(state?.marketingBrief, state);
}

/**
 * Pure projection — normalize an ALREADY-LOADED marketingBrief into the
 * canonical superset (no Firebase read). This is the shared core both surfaces
 * call: getBriefIntelligence (email) wraps it after a Firebase read, and the
 * executive brief view passes the marketingBrief it already loaded. Returns
 * null when no marketingBrief is present. Returned shape documented above.
 */
function projectBrief(marketingBrief, state = null) {
  if (!marketingBrief) return null;

  const scoutBrief = marketingBrief?.scoutBrief || {};
  const agentData = scoutBrief?.agentData || {};
  const opportunities = arr(agentData?.viralOpportunities?.opportunities).length
    ? arr(agentData.viralOpportunities.opportunities)
    : arr(marketingBrief?.contentOpportunities);

  return {
    headline: marketingBrief?.headline || state?.headline || '',
    humanBrief: scoutBrief?.humanBrief || '',
    delta: scoutBrief?.delta || '',
    generatedAt: marketingBrief?.generatedAtIso || scoutBrief?.timestamp || null,
    opportunities: opportunities.map((o) => ({
      topic: o.conversation || o.topic || o.title || 'Opportunity',
      angle: o.injectionAngle || o.whyNow || o.summary || '',
      priority: o.priority || o.authenticity || '',
      windowHours: o.windowHours || null,
      suggestedReply: o.suggestedReply || '',
      url: o.url || '',
    })),
    kols: arr(agentData.kolActivity).map((k) => ({
      name: k.name || k.author || 'KOL',
      platform: k.platform || '',
      detail: k.content || k.summary || '',
      sentiment: k.sentiment || '',
      signalType: k.signalType || '',
      followers: k.followers || '',
      url: k.url || '',
      profileUrl: k.profileUrl || '',
    })),
    competitors: arr(agentData.competitorIntel).map((c) => ({
      name: c.competitor || 'Competitor',
      finding: c.finding || '',
      impact: c.impact || '',
      url: c.url || '',
    })),
    narratives: arr(agentData.categoryTrends).map((t) => ({
      trend: t.trend || t.topic || 'Trend',
      detail: t.detail || '',
      relevance: t.relevance || '',
    })),
    brandMentions: arr(agentData.brandMentions).map((m) => ({
      source: m.source || '',
      author: m.author || '',
      content: m.content || m.finding || '',
      sentiment: m.sentiment || '',
      reach: m.reach || '',
      url: m.url || '',
    })),
    redditSignals: arr(agentData.redditSignals).map((r) => ({
      title: r.title || 'Reddit signal',
      subreddit: r.subreddit || '',
      signalType: r.signalType || '',
      summary: r.summary || '',
      actionableTakeaway: r.actionableTakeaway || '',
      url: r.url || '',
    })),
    localDemandSignals: arr(agentData.localDemandSignals).map((s) => ({
      signal: s.signal || s.title || 'Local signal',
      insight: s.insight || s.summary || '',
      source: s.source || '',
      url: s.url || '',
    })),
    searchedFor: arr(agentData?.viralOpportunities?.searchedFor),
    content: marketingBrief?.content || {},
    readyToPublish: marketingBrief?.guardianFlags?.readyToPublish ?? null,
    // Watchlist-analysis ("Happening on X") snapshot mirrored from the dashboard
    // REPORT tab (written by /api/dashboard/watchlist-pull). Raw recipe text;
    // the email parses + renders it in the brief-kit look.
    watchlistAnalysis: marketingBrief?.reportSnapshot?.watchlistAnalysis?.text || '',
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
    return { handle, found: activity.length > 0, activity };
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
  if (arr(intel.brandMentions).length) {
    lines.push('Brand mentions:');
    intel.brandMentions.forEach((m) => lines.push(`- ${m.author || m.source || 'mention'}${m.sentiment ? ` (${m.sentiment})` : ''}: ${m.content}`));
  }
  if (arr(intel.redditSignals).length) {
    lines.push('Reddit signals:');
    intel.redditSignals.forEach((r) => lines.push(`- ${r.subreddit ? `${r.subreddit} ` : ''}${r.title}: ${r.summary}${r.actionableTakeaway ? ` — ${r.actionableTakeaway}` : ''}`));
  }
  if (arr(intel.localDemandSignals).length) {
    lines.push('Local demand signals:');
    intel.localDemandSignals.forEach((s) => lines.push(`- ${s.signal}: ${s.insight}`));
  }
  if (arr(intel.watchlist).length) {
    lines.push('Watchlist accounts (report each by name):');
    intel.watchlist.forEach((w) => {
      lines.push(w.found
        ? `- ${w.handle}: ${w.activity.map((a) => a.text).filter(Boolean).join(' | ').slice(0, 300)}`
        : `- ${w.handle}: no activity surfaced this run`);
    });
  }
  if (intel.weather?.today) {
    lines.push(`Local weather (${intel.weather.place}): today ${intel.weather.today.short}, ${intel.weather.today.temp}°${intel.weather.today.unit}. 3-day — ${intel.weather.threeDayLine}`);
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
  try {
    intel.weather = await getClientWeather(clientId);
  } catch {
    intel.weather = null;
  }
  return { clientId, clientName, intel };
}

module.exports = { getBriefIntelligence, projectBrief, briefIntelToText, getBriefForClient, buildWatchlist };
