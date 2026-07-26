import { NextResponse } from 'next/server';
import { createRequire } from 'module';

// Operating-cost report for the admin "Operating Cost" card.
//
// Reads the two persisted cost ledgers LIVE on each request and returns a
// per-client → per-run → per-stage tree plus per-module line items, a fixed /
// subscription cost section, and (behind a flag) the Anthropic org-level
// cost_report. Read-only; never writes.
//
//   1. brief_runs.providerUsage.stageCosts  → pipeline stage costs (scout/scribe/…)
//   2. usage_events                         → per-call logger (leadgen/brand-system/…)
//
// Mirrors the cost extraction in api/_lib/ops-overview.cjs (estimatedUsd OR
// estimatedCostUsd; stageCosts[] OR a single number).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { buildAuthRequestShim, verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const centsToUsd = (n) => (Number(n) || 0) / 100;

// ── Fixed / subscription operating costs ──────────────────────────────────────
// Flat monthly spend that is NOT per-run attributable. EDIT THESE to match your
// real plans — they are shown as a separate section, never faked into per-client
// totals. monthlyUsd = your actual recurring charge.
const FIXED_COSTS = [
  { name: 'Vercel (hosting)',        monthlyUsd: 20,  note: 'Pro plan — edit in app/api/admin/cost-report/route.js' },
  { name: 'Domains / DNS',           monthlyUsd: 0,   note: 'Set if applicable' },
];

// Browserless has no per-call $ ledger — we estimate per completed render
// request. EDIT to your plan's effective per-render cost. Always shown as (est).
const BROWSERLESS_PER_REQUEST_USD = 0.003;

// ── ScrapeCreators (last30days social-scraper backend) ────────────────────────
// Credit-based; the API exposes credits but no $/credit. Set your plan's
// effective rate (plan $ ÷ credits granted). Tune against your usage dashboard:
// https://app.scrapecreators.com/ . Shown as an (est) — scraper credits only,
// last30days LLM planning is a separate, not-yet-instrumented cost.
const SCRAPECREATORS_USD_PER_CREDIT = 0.0012;
const SCRAPECREATORS_API_BASE = 'https://api.scrapecreators.com';
// Each usage call itself costs 1 credit — cache hourly so repeat card opens
// don't burn credits.
const SCRAPECREATORS_CACHE_TTL_MS = 60 * 60 * 1000;

// Deep links to the Anthropic Console (account management lives there).
const ACCOUNT_LINKS = [
  { label: 'Console · Cost',     url: 'https://platform.claude.com/settings/billing' },
  { label: 'Console · Limits',   url: 'https://platform.claude.com/settings/limits' },
  { label: 'Console · API keys', url: 'https://platform.claude.com/settings/keys' },
  { label: 'Console · Billing',  url: 'https://platform.claude.com/settings/billing' },
];

function tsToMs(v) {
  if (!v) return 0;
  if (typeof v === 'string') return Date.parse(v) || 0;
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  if (v._seconds) return v._seconds * 1000;
  return 0;
}

// Provider inference from a model id (for the by-provider rollup of run stages).
function providerForModel(model = '') {
  const m = String(model).toLowerCase();
  if (m.startsWith('claude') || m.includes('anthropic')) return 'anthropic';
  if (m.startsWith('gpt') || m.includes('openai')) return 'openai';
  if (m.includes('gemini') || m.includes('imagen')) return 'google';
  if (m.includes('serpapi')) return 'serpapi';
  return 'other';
}

// Stage list + total for one run's providerUsage payload.
function runStages(usage) {
  if (!usage) return { stages: [], usd: 0, inTok: 0, outTok: 0 };
  if (Array.isArray(usage.stageCosts)) {
    const stages = usage.stageCosts.map((s) => ({
      stage: s.stage || '?',
      model: s.model || '?',
      inTok: Number(s.inputTokens) || 0,
      outTok: Number(s.outputTokens) || 0,
      usd: round4(Number(s.estimatedUsd ?? s.estimatedCostUsd) || 0),
    }));
    return stages.reduce((a, s) => ({
      stages: a.stages,
      usd: a.usd + s.usd, inTok: a.inTok + s.inTok, outTok: a.outTok + s.outTok,
    }), { stages, usd: 0, inTok: 0, outTok: 0 });
  }
  if (typeof usage.estimatedCostUsd === 'number') {
    return { stages: [], usd: round4(usage.estimatedCostUsd), inTok: 0, outTok: 0 };
  }
  return { stages: [], usd: 0, inTok: 0, outTok: 0 };
}

// Best-effort Anthropic org cost_report (dormant until an Admin key + team org
// exist). Never throws — returns an availability flag the card renders.
async function fetchAnthropicCost(windowDays) {
  const adminKey = process.env.ANTHROPIC_ADMIN_KEY;
  if (!adminKey) {
    return { available: false, reason: 'No ANTHROPIC_ADMIN_KEY set (Individual org cannot issue an Admin key — convert to a team org to enable).' };
  }
  try {
    // cost_report buckets by UTC day. Two constraints handled here:
    //  1. It requires ending_at strictly AFTER starting_at at day resolution AND
    //     clamps ending_at to now — so a start-of-TODAY → start-of-tomorrow range
    //     collapses to start==end for the in-progress day and 400s ("ending date
    //     must be after starting date"). Start N *full* days back (start ≤
    //     yesterday) so the range always spans ≥1 closed day plus today-so-far.
    //  2. Results paginate (has_more / next_page). A wide window returns only the
    //     first page (~7 daily buckets), so 30D/90D undercount unless we follow
    //     the cursor to the end.
    const DAY_MS = 86400_000;
    const floorUtcDay = (ms) => { const d = new Date(ms); d.setUTCHours(0, 0, 0, 0); return d; };
    const now = Date.now();
    const startingAt = floorUtcDay(now - Math.max(1, windowDays) * DAY_MS).toISOString();
    const endingAt = floorUtcDay(now + DAY_MS).toISOString();

    let total = 0;
    const byDescription = {};
    let page = null;
    let guard = 0;
    while (guard++ < 40) {
      const params = new URLSearchParams();
      params.set('starting_at', startingAt);
      params.set('ending_at', endingAt);
      params.append('group_by[]', 'description');
      if (page) params.set('page', page);
      const url = `https://api.anthropic.com/v1/organizations/cost_report?${params.toString()}`;
      const res = await fetch(url, {
        headers: { 'x-api-key': adminKey, 'anthropic-version': '2023-06-01' },
      });
      if (!res.ok) {
        const t = await res.text();
        return { available: false, reason: `cost_report ${res.status}: ${t.slice(0, 160)}` };
      }
      const data = await res.json();
      const buckets = Array.isArray(data?.data) ? data.data : [];
      for (const b of buckets) {
        for (const item of (b.results || [])) {
          // Anthropic reports cost amount as decimal strings in cents.
          const amt = centsToUsd(item?.amount ?? item?.cost ?? item?.amount_cents ?? 0);
          total += amt;
          const parsed = item?.parsed_fields || item?.parsedFields || {};
          const key = parsed.model || item?.description || item?.group || 'unknown';
          byDescription[key] = (byDescription[key] || 0) + amt;
        }
      }
      if (!data?.has_more || !data?.next_page) break;
      page = data.next_page;
    }
    return {
      available: true,
      totalUsd: round2(total),
      byDescription: Object.entries(byDescription).map(([description, usd]) => ({ description, usd: round4(usd) })).sort((a, b) => b.usd - a.usd),
    };
  } catch (err) {
    return { available: false, reason: `cost_report fetch failed: ${err.message}` };
  }
}

// Live ScrapeCreators account usage (credit balance + per-day consumption).
// Dormant until SCRAPECREATORS_API_KEY is set in the SERVER env — note that the
// key currently lives only in ~/.config/last30days/.env (loaded into the python
// subprocess), NOT process.env of this Next server. Never throws.
async function fetchScrapeCreatorsRaw() {
  const key = process.env.SCRAPECREATORS_API_KEY;
  const headers = { 'x-api-key': key, 'content-type': 'application/json' };
  const [balRes, dailyRes] = await Promise.all([
    fetch(`${SCRAPECREATORS_API_BASE}/v1/account/credit-balance`, { headers }),
    fetch(`${SCRAPECREATORS_API_BASE}/v1/account/get-daily-usage-count`, { headers }),
  ]);
  if (!balRes.ok) throw new Error(`credit-balance ${balRes.status}: ${(await balRes.text()).slice(0, 120)}`);
  const bal = await balRes.json();
  let byDay = [];
  if (dailyRes.ok) {
    const daily = await dailyRes.json();
    if (Array.isArray(daily)) {
      byDay = daily
        .map((d) => ({ date: d.usage_date || null, credits: Number(d.total_credits) || 0, requests: Number(d.request_count) || 0 }))
        .filter((d) => d.date);
    }
  }
  return { creditCount: Number(bal?.creditCount) || 0, byDay };
}

async function fetchScrapeCreatorsUsage(cutoffMs, force = false) {
  const key = process.env.SCRAPECREATORS_API_KEY;
  if (!key) {
    return { available: false, reason: 'No SCRAPECREATORS_API_KEY in the server env (it lives only in ~/.config/last30days/.env for the subprocess — add it to .env.local + Vercel to enable).' };
  }

  // Hourly Firestore cache — each usage call costs 1 credit. We cache the raw
  // balance + full per-day array once, then compute any window locally.
  // force=true (admin "live" refresh) bypasses the read but still rewrites cache.
  let raw = null;
  let cached = false;
  if (!force) {
    try {
      const doc = await fb.adminDb.collection('scrapecreators_usage').doc('latest').get();
      const d = doc.exists ? doc.data() : null;
      if (d && d.fetchedAt && (Date.now() - Date.parse(d.fetchedAt)) < SCRAPECREATORS_CACHE_TTL_MS) {
        raw = { creditCount: Number(d.creditCount) || 0, byDay: Array.isArray(d.byDay) ? d.byDay : [] };
        cached = true;
      }
    } catch { /* cache optional */ }
  }

  if (!raw) {
    try {
      raw = await fetchScrapeCreatorsRaw();
    } catch (err) {
      return { available: false, reason: `ScrapeCreators fetch failed: ${err.message}` };
    }
    try {
      await fb.adminDb.collection('scrapecreators_usage').doc('latest').set({
        fetchedAt: new Date().toISOString(), creditCount: raw.creditCount, byDay: raw.byDay,
      });
    } catch { /* cache write optional */ }
  }

  const inWindow = (raw.byDay || []).filter((x) => {
    const ms = Date.parse(x.date);
    return ms && ms >= cutoffMs;
  });
  const creditsUsedInWindow = inWindow.reduce((s, x) => s + (Number(x.credits) || 0), 0);
  const requestsInWindow = inWindow.reduce((s, x) => s + (Number(x.requests) || 0), 0);
  return {
    available: true,
    cached,
    creditsRemaining: raw.creditCount,
    creditsUsedInWindow,
    requestsInWindow,
    usdPerCredit: SCRAPECREATORS_USD_PER_CREDIT,
    estUsd: round4(creditsUsedInWindow * SCRAPECREATORS_USD_PER_CREDIT),
    daysCovered: (raw.byDay || []).length,
    byDay: inWindow.sort((a, b) => (b.date || '').localeCompare(a.date || '')),
  };
}

async function handle(request) {
  try {
    await verifyAdminRequest(buildAuthRequestShim(request));
  } catch {
    return json({ error: 'Unauthorized.' }, 401);
  }

  const url = new URL(request.url);
  const daysRaw = Number(url.searchParams.get('days') || 30);
  const windowDays = [1, 7, 30, 90].includes(daysRaw) ? daysRaw : 30;
  const cutoffMs = Date.now() - windowDays * 86400_000;

  // Client name map (clientId → display name).
  const names = {};
  try {
    const cfgSnap = await fb.adminDb.collection('client_configs').get();
    cfgSnap.forEach((d) => {
      const c = d.data() || {};
      names[d.id] = c.companyName || c.normalizedHost || c.sourceInputs?.websiteUrl || c.websiteUrl || d.id;
    });
  } catch { /* names fall back to clientId */ }

  // Per-client accumulator.
  const clients = {};
  const ensure = (clientId) => (clients[clientId] = clients[clientId] || {
    clientId, name: names[clientId] || clientId,
    runUsd: 0, moduleUsd: 0, estUsd: 0, runs: [], modules: {},
  });
  const byProvider = {};
  const addProvider = (provider, usd) => { byProvider[provider] = (byProvider[provider] || 0) + (usd || 0); };

  // 1. brief_runs → per-run stage costs.
  let runUsd = 0;
  try {
    const snap = await fb.adminDb.collection('brief_runs').orderBy('createdAt', 'desc').limit(2000).get();
    snap.forEach((d) => {
      const r = d.data() || {};
      const ms = tsToMs(r.createdAt) || tsToMs(r.completedAt);
      if (ms && ms < cutoffMs) return;
      const { stages, usd, inTok, outTok } = runStages(r.providerUsage);
      if (!usd && !stages.length) return;
      const cid = r.clientId || 'unknown';
      const c = ensure(cid);
      c.runUsd += usd; runUsd += usd;
      for (const s of stages) addProvider(providerForModel(s.model), s.usd);
      c.runs.push({
        runId: r.runId || d.id,
        trigger: r.trigger || 'unknown',
        source: r.source || null,
        requestedByUid: r.requestedByUid || null,
        status: r.status || '?',
        date: ms ? new Date(ms).toISOString() : null,
        costUsd: round4(usd), inTok, outTok,
        stages,
      });
    });
  } catch (err) {
    return json({ error: `brief_runs read failed: ${err.message}` }, 500);
  }

  // 2. usage_events → per-module line items.
  let moduleUsd = 0;
  // X API writes are counted here (logUsage, costUsd:0) but not priced — X
  // spend genuinely isn't knowable per-call from the API. Tallied separately
  // so the Cost-sources row below can say "N counted, not priced" honestly
  // instead of implying $0 actually means free.
  let xApiWriteCount = 0;
  try {
    const snap = await fb.adminDb.collection('usage_events').orderBy('createdAt', 'desc').limit(5000).get();
    snap.forEach((d) => {
      const e = d.data() || {};
      const ms = tsToMs(e.createdAt) || tsToMs(e.timestamp);
      if (ms && ms < cutoffMs) return;
      const usd = Number(e.estimatedCostUsd) || 0;
      const cid = e.clientId || 'unknown';
      const c = ensure(cid);
      c.moduleUsd += usd; moduleUsd += usd;
      addProvider(e.provider || providerForModel(e.model), usd);
      const key = `${e.module || '?'}|${e.provider || '?'}|${e.model || '?'}`;
      const m = c.modules[key] = c.modules[key] || { module: e.module || '?', provider: e.provider || '?', model: e.model || '?', events: 0, usd: 0 };
      m.events++; m.usd += usd;
      if (e.provider === 'x-api') xApiWriteCount++;
    });
  } catch { /* usage_events optional */ }

  // 3. browserless_requests → per-client infra ESTIMATE (no exact $ ledger).
  // Kept out of the exact "tracked" total; surfaced as estUsd + a (est) module
  // line + the Cost-sources coverage row.
  let browserlessUsd = 0;
  let browserlessReqs = 0;
  try {
    const snap = await fb.adminDb.collection('browserless_requests').orderBy('createdAt', 'desc').limit(5000).get();
    snap.forEach((d) => {
      const e = d.data() || {};
      const ms = tsToMs(e.createdAt);
      if (ms && ms < cutoffMs) return;
      if (e.status === 'started') return; // only count completed renders
      const est = BROWSERLESS_PER_REQUEST_USD;
      const c = ensure(e.clientId || 'unknown');
      c.estUsd += est; browserlessUsd += est; browserlessReqs++;
      addProvider('browserless (est)', est);
      const key = 'browserless|browserless|render';
      const m = c.modules[key] = c.modules[key] || { module: 'browserless (est)', provider: 'browserless', model: 'screenshot/pdf', events: 0, usd: 0 };
      m.events++; m.usd += est;
    });
  } catch { /* browserless optional */ }

  const clientList = Object.values(clients).map((c) => ({
    clientId: c.clientId,
    name: c.name,
    totalUsd: round4(c.runUsd + c.moduleUsd),
    runUsd: round4(c.runUsd),
    moduleUsd: round4(c.moduleUsd),
    estUsd: round4(c.estUsd),
    runs: c.runs.sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    modules: Object.values(c.modules).map((m) => ({ ...m, usd: round4(m.usd) })).sort((a, b) => b.usd - a.usd),
  })).sort((a, b) => b.totalUsd - a.totalUsd);

  const anthropic = await fetchAnthropicCost(windowDays);
  const forceScRefresh = url.searchParams.get('refresh') === '1';
  const scrapeCreators = await fetchScrapeCreatorsUsage(cutoffMs, forceScRefresh);
  const scStatusNote = scrapeCreators.available
    ? `${scrapeCreators.creditsUsedInWindow} credits × $${SCRAPECREATORS_USD_PER_CREDIT}/credit (scraper only; last30days LLM planning not incl.) — ${scrapeCreators.creditsRemaining} credits left${scrapeCreators.cached ? ' · cached' : ''}`
    : (scrapeCreators.reason || 'External scraper cost — not logged locally');

  // Cost-source coverage — every known operating-cost stream + how completely we
  // capture it. status: 'tracked' (exact $) | 'estimate' | 'not-instrumented'.
  // Honest about what the per-client totals do and don't include.
  const sources = [
    { key: 'brief_runs',   label: 'Pipeline runs · Scout / Scribe / Guardian / modules', status: 'tracked',         usd: round2(runUsd),         note: 'Exact — brief_runs.providerUsage stage costs' },
    { key: 'usage_events', label: 'Per-call · leadgen, brand-system, narrators, strategy, summaries, external-scout', status: 'tracked', usd: round2(moduleUsd), note: 'Exact — usage_events ledger (now incl. Strategy Builder/Roller, exec summaries, external-scout web_search)' },
    { key: 'browserless',  label: 'Browserless · screenshot / PDF renders',               status: 'estimate',        usd: round2(browserlessUsd), note: `${browserlessReqs} render${browserlessReqs === 1 ? '' : 's'} × $${BROWSERLESS_PER_REQUEST_USD}/req — edit rate in route` },
    { key: 'web_search',   label: 'Anthropic web_search surcharge',                       status: 'tracked',         usd: 0,                      note: 'Now captured per-call ($10/1k, exact count from usage.server_tool_use) for external-scout paths — folded into Per-call above. Scout stage-1 surcharge still only in stage-cost tokens.' },
    { key: 'last30days',   label: 'last30days · social search (ScrapeCreators)',           status: scrapeCreators.available ? 'estimate' : 'not-instrumented', usd: scrapeCreators.available ? round2(scrapeCreators.estUsd) : 0, note: scStatusNote },
    { key: 'recipes',      label: 'Analysis recipes',                                     status: 'tracked',         usd: 0,                      note: 'Logged to usage_events (recipe-run + pre-digest) — folded into Per-call above' },
    { key: 'kb_summaries', label: 'Knowledge-base chat',                                  status: 'not-instrumented', usd: 0,                      note: 'KB chat LLM calls still not routed through usage_events (brief/exec summaries now are)' },
    { key: 'x_writes',     label: 'X API writes · Social Auto-Publish + Copywriter/Schedule Posts', status: 'not-instrumented', usd: 0, note: `${xApiWriteCount} write${xApiWriteCount === 1 ? '' : 's'} counted via usage_events in this window — X has no per-call price via the API, so it's counted but not priced. Dollar spend stays on developer.x.com.` },
  ];

  return json({
    ok: true,
    generatedAt: new Date().toISOString(),
    windowDays,
    totals: {
      trackedUsd: round2(runUsd + moduleUsd),
      runUsd: round2(runUsd),
      moduleUsd: round2(moduleUsd),
      estimatedUsd: round2(browserlessUsd + (scrapeCreators.available ? scrapeCreators.estUsd : 0)),
      fixedMonthlyUsd: round2(FIXED_COSTS.reduce((s, f) => s + (f.monthlyUsd || 0), 0)),
    },
    byProvider: Object.entries(byProvider).map(([provider, usd]) => ({ provider, usd: round4(usd) })).sort((a, b) => b.usd - a.usd),
    clients: clientList,
    sources,
    fixed: FIXED_COSTS,
    anthropic,
    scrapeCreators,
    accountLinks: ACCOUNT_LINKS,
    note: 'Tracked = exact LLM/image/search ($) from brief_runs + usage_events. Estimate = browserless. Not-instrumented sources are listed under Cost sources below.',
  });
}

export async function GET(request) { return handle(request); }
export async function POST(request) { return handle(request); }
