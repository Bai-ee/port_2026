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
async function fetchAnthropicCost(startMs) {
  const adminKey = process.env.ANTHROPIC_ADMIN_KEY;
  if (!adminKey) {
    return { available: false, reason: 'No ANTHROPIC_ADMIN_KEY set (Individual org cannot issue an Admin key — convert to a team org to enable).' };
  }
  try {
    const startingAt = new Date(startMs).toISOString();
    const endingAt = new Date().toISOString();
    const params = new URLSearchParams();
    params.set('starting_at', startingAt);
    params.set('ending_at', endingAt);
    params.append('group_by[]', 'description');
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
    let total = 0;
    const byDescription = {};
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
    return {
      available: true,
      totalUsd: round2(total),
      byDescription: Object.entries(byDescription).map(([description, usd]) => ({ description, usd: round4(usd) })).sort((a, b) => b.usd - a.usd),
    };
  } catch (err) {
    return { available: false, reason: `cost_report fetch failed: ${err.message}` };
  }
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

  const anthropic = await fetchAnthropicCost(cutoffMs);

  // Cost-source coverage — every known operating-cost stream + how completely we
  // capture it. status: 'tracked' (exact $) | 'estimate' | 'not-instrumented'.
  // Honest about what the per-client totals do and don't include.
  const sources = [
    { key: 'brief_runs',   label: 'Pipeline runs · Scout / Scribe / Guardian / modules', status: 'tracked',         usd: round2(runUsd),         note: 'Exact — brief_runs.providerUsage stage costs' },
    { key: 'usage_events', label: 'Per-call · leadgen, brand-system, narrators',          status: 'tracked',         usd: round2(moduleUsd),      note: 'Exact — usage_events ledger' },
    { key: 'browserless',  label: 'Browserless · screenshot / PDF renders',               status: 'estimate',        usd: round2(browserlessUsd), note: `${browserlessReqs} render${browserlessReqs === 1 ? '' : 's'} × $${BROWSERLESS_PER_REQUEST_USD}/req — edit rate in route` },
    { key: 'web_search',   label: 'Anthropic web_search surcharge',                       status: 'not-instrumented', usd: 0,                      note: '~$10 / 1k searches — only the Anthropic account block (admin key) sees it' },
    { key: 'last30days',   label: 'last30days · social search',                           status: 'not-instrumented', usd: 0,                      note: 'External LLM + scraper cost — not logged locally' },
    { key: 'recipes',      label: 'Analysis recipes + external-scout web_search',         status: 'not-instrumented', usd: 0,                      note: 'Computes cost but is not yet persisted to usage_events' },
    { key: 'kb_summaries', label: 'Knowledge-base chat + brief summaries',                status: 'not-instrumented', usd: 0,                      note: 'LLM calls not yet routed through usage_events' },
  ];

  return json({
    ok: true,
    generatedAt: new Date().toISOString(),
    windowDays,
    totals: {
      trackedUsd: round2(runUsd + moduleUsd),
      runUsd: round2(runUsd),
      moduleUsd: round2(moduleUsd),
      estimatedUsd: round2(browserlessUsd),
      fixedMonthlyUsd: round2(FIXED_COSTS.reduce((s, f) => s + (f.monthlyUsd || 0), 0)),
    },
    byProvider: Object.entries(byProvider).map(([provider, usd]) => ({ provider, usd: round4(usd) })).sort((a, b) => b.usd - a.usd),
    clients: clientList,
    sources,
    fixed: FIXED_COSTS,
    anthropic,
    accountLinks: ACCOUNT_LINKS,
    note: 'Tracked = exact LLM/image/search ($) from brief_runs + usage_events. Estimate = browserless. Not-instrumented sources are listed under Cost sources below.',
  });
}

export async function GET(request) { return handle(request); }
export async function POST(request) { return handle(request); }
