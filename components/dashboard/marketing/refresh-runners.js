// Unified Refresh — runners for groups 2-7 (group 1 is run by the host via the dashboard generateReport path).
// Each runner: (ctx) => Promise<{ detail: [{ type: 'dim'|'ok'|'error', prefix, text }] }>, THROWS on failure.
// ctx = { getIdToken, clientId, options: { todayWithModel }, note(text), apiPath?(path) }
// Nothing here runs on import; the host calls a runner only after the confirm row.

const QUOTE_TARGETS = '/api/dashboard/quote-targets';
const X_MONITOR = '/api/dashboard/x-monitor';
const OPP_REFRESH = '/api/dashboard/opportunity-signals/refresh';
const EMAIL_DIGEST = '/api/admin/email-digest';
const PRE_DIGEST = '/api/worker/pre-digest-refresh';

async function request(ctx, path, { method = 'POST', body } = {}) {
  const token = ctx.getIdToken ? await ctx.getIdToken() : null;
  const url = typeof ctx.apiPath === 'function' ? ctx.apiPath(path) : path;
  const res = await fetch(url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) throw new Error(data?.error || `${path} failed (${res.status})`);
  return data;
}

const quoteCall = (ctx, action, body = {}) => request(ctx, QUOTE_TARGETS, { body: { action, ...body } });
const okLine = (prefix, text) => ({ type: 'ok', prefix, text });
const dimLine = (prefix, text) => ({ type: 'dim', prefix, text });

function requireClient(ctx) {
  if (!ctx?.clientId) throw new Error('No client loaded — pre-digest-refresh not wired without a clientId.');
  return ctx.clientId;
}

// pre-digest-refresh phase call — same shape as runAndSend in AdminEmailModals.jsx (admin Bearer, clientId scoped).
function preDigest(ctx, clientId, phase, extra = '') {
  const token = `marketing-refresh-${Date.now().toString(36)}`;
  return request(ctx, `${PRE_DIGEST}?phase=${phase}&clientId=${encodeURIComponent(clientId)}&freshnessToken=${encodeURIComponent(token)}${extra}`);
}

export const GROUP_RUNNERS = {
  // Group 2 — PAID X API. Opportunity Signals X search; Market Talk on X only if the digest toggle is on.
  'x-search': async (ctx) => {
    const clientId = requireClient(ctx);
    const detail = [];
    const opp = await request(ctx, OPP_REFRESH); // no body; server derives the client from auth and passes allowX:true
    // The route returns no X call count; it runs one X search per enabled Opportunity query row when X is a platform.
    detail.push(okLine('[X SEARCH]', `Opportunity Signals: ${opp?.itemCount ?? 0} item(s) across ${(opp?.platforms || []).join(', ') || 'no platforms'} (one paid X call per enabled query row)`));
    (opp?.warnings || []).forEach((w) => detail.push(dimLine('[X SEARCH]', w)));

    const cfg = await request(ctx, EMAIL_DIGEST, { body: { action: 'config', clientId } });
    if (cfg?.config?.include?.xMarketTalk === true) {
      const homeId = cfg.config.homeClientId || clientId;
      const res = await preDigest(ctx, homeId, 'signals', '&allowX=1');
      const r = Array.isArray(res?.results) ? res.results[0] : null;
      detail.push(okLine('[X MARKET TALK]', `X market talk ${r?.platformSignals?.xMarketTalk ?? 'n/a'} (1 paid X search)`));
    } else {
      detail.push(dimLine('[X MARKET TALK]', 'Skipped — Market Talk on X is off in the digest.'));
    }
    return { detail };
  },

  // Group 3 — model calls.
  analysis: async (ctx) => {
    const clientId = requireClient(ctx);
    const res = await preDigest(ctx, clientId, 'analysis');
    const r = Array.isArray(res?.results) ? res.results[0] : null;
    return {
      detail: [okLine('[ANALYSIS]', `reddit ${r?.redditAnalysis?.ok ? '✓' : (r?.redditAnalysis?.reason || 'skipped')} · X market talk ${r?.xMarketTalkAnalysis?.ok ? '✓' : (r?.xMarketTalkAnalysis?.reason || 'skipped')} · exec summary ${r?.executiveSummary?.ok ? '✓' : 'skipped'}`)],
    };
  },

  // Group 4 — free; enqueues a Mac-worker (bird) refresh for you + every benchmark (no handles = all).
  'strategy-accounts': async (ctx) => {
    const res = await quoteCall(ctx, 'strategy-refresh', { clientId: ctx.clientId });
    return { detail: [okLine('[ACCOUNTS]', `Queued for the Mac worker${res?.requestId ? ` (request ${res.requestId})` : ''} — status ${res?.status || 'queued'}`)] };
  },

  // Group 5 — free; draft copy via model only when the option is on. Results are not stored here.
  'today-queue': async (ctx) => {
    const withModel = !!ctx.options?.todayWithModel;
    const detail = [];
    const run = await quoteCall(ctx, 'daily-run-generate', { force: false, draftWithModel: withModel });
    const count = Array.isArray(run?.run?.suggestions) ? run.run.suggestions.length : 0;
    detail.push(okLine('[TODAY]', run?.skipped ? `Inputs unchanged (${run.reason || 'no change'}) — saved run kept` : `${count} suggestion(s) generated${withModel ? ' with model copy' : ' (no model)'}`));
    const month = new Date().toISOString().slice(0, 7);
    const cal = await quoteCall(ctx, 'month-calendar', { month });
    detail.push(okLine('[CALENDAR]', `Month ${month} reloaded${Array.isArray(cal?.calendar?.days) ? ` (${cal.calendar.days.length} days)` : ''}`));
    const results = await quoteCall(ctx, 'post-results');
    detail.push(okLine('[RESULTS]', `Post results reloaded${Array.isArray(results?.posts) ? ` (${results.posts.length})` : ''}`));
    return { detail };
  },

  // Group 6 — PAID X API; exactly the X Monitor card's "Sync now" body.
  'x-monitor': async (ctx) => {
    const res = await request(ctx, X_MONITOR, { body: { action: 'sync-all' } });
    return { detail: [okLine('[X MONITOR]', `Synced — ${res?.callsMade ?? '?'} metered X API call(s) made`)] };
  },

  // Group 7 — render cost; modules phase only (creative/video renders).
  renders: async (ctx) => {
    const clientId = requireClient(ctx);
    const res = await preDigest(ctx, clientId, 'modules');
    const r = Array.isArray(res?.results) ? res.results[0] : null;
    return { detail: [okLine('[RENDERS]', r ? 'Modules phase finished' : 'Modules phase requested')] };
  },
};

export default GROUP_RUNNERS;
