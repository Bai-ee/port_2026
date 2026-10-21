// Unified Refresh — runners for groups 2-7 (group 1 is run by the host via the dashboard generateReport path).
// Each runner: (ctx) => Promise<{ detail: [{ type: 'dim'|'ok'|'error', prefix, text }] }>, THROWS on failure.
// ctx = { getIdToken, clientId, options: { todayWithModel }, note(text), apiPath?(path) }
// X API data sources (groups 4 and 8): a run on the paid X API needs ctx.options.xApiConfirmed === true, which the host sets only
// after the panel's confirm row listed that group's estimate (paidGroupsFor with the client's dataSources). Without it the runner throws.
// Nothing here runs on import; the host calls a runner only after the confirm row.

const QUOTE_TARGETS = '/api/dashboard/quote-targets';
const X_MONITOR = '/api/dashboard/x-monitor';
const OPP_REFRESH = '/api/dashboard/opportunity-signals/refresh';
const EMAIL_DIGEST = '/api/admin/email-digest';
const PRE_DIGEST = '/api/worker/pre-digest-refresh';

// allowSkip: a 200 `{ ok:false, skipped:true }` (feature off, no key, over budget) is a skip to report, not a failure.
async function request(ctx, path, { method = 'POST', body, allowSkip = false } = {}) {
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
  if (allowSkip && res.ok && data?.skipped) return data;
  if (!res.ok || data?.ok === false) throw new Error(data?.error || `${path} failed (${res.status})`);
  return data;
}

function requireXApiConfirm(ctx, label) {
  if (ctx?.options?.xApiConfirmed !== true) throw new Error(`${label} is set to the paid X API; confirm its estimate in the Refresh panel first.`);
}

const quoteCall = (ctx, action, body = {}) => request(ctx, QUOTE_TARGETS, { body: { action, ...body } });
const okLine = (prefix, text) => ({ type: 'ok', prefix, text });
const dimLine = (prefix, text) => ({ type: 'dim', prefix, text });

// Mac-source groups: the server queues a request the Mac refresh worker (launchd, every 60 s) runs with bird. Follow it
// live in the run terminal until it finishes; give up waiting (not the request) after a few minutes.
const MAC_POLL_MS = 5000;
const MAC_WAIT_MS = 6 * 60 * 1000;
const HOT_WAIT_MS = 12 * 60 * 1000; // the hot scan paces ~35 bird calls (about 4-8 minutes)
const MAC_TERMINAL = new Set(['done', 'partial', 'failed', 'rate-limited', 'bird-unavailable']);
function macLine(health) {
  const age = health?.ageMinutes;
  if (health?.state === 'never') return 'Your Mac refresh worker has never checked in. Is the launchd job installed?';
  if (typeof age === 'number' && age > 3) return `Your Mac last checked in ${age} min ago. Is it awake and logged in?`;
  return null;
}
async function followMacRequest(ctx, { statusAction, requestId, label, waitMs = MAC_WAIT_MS }) {
  const note = typeof ctx.note === 'function' ? ctx.note : () => {};
  const started = Date.now();
  let last = '';
  let warned = false;
  while (Date.now() - started < waitMs) {
    // eslint-disable-next-line no-await-in-loop
    const st = await quoteCall(ctx, statusAction, { clientId: ctx.clientId, requestId }).catch(() => null);
    const req = st?.request;
    if (req && MAC_TERMINAL.has(req.status)) return { request: req, health: st.workerHealth };
    const now = req?.status === 'running' ? `${label}: running on your Mac…` : `${label}: queued — your Mac picks it up within a minute…`;
    if (now !== last) { note(now); last = now; }
    const warn = macLine(st?.workerHealth);
    if (warn && !warned) { note(warn); warned = true; }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, MAC_POLL_MS));
  }
  return { request: null, timedOut: true };
}

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
    const opp = await request(ctx, OPP_REFRESH, { allowSkip: true }); // no body; server derives the client; X only for an admin
    // The route returns no X call count; it runs one X search per enabled Opportunity query row when X is a platform.
    if (opp?.skipped) detail.push(dimLine('[X SEARCH]', `Opportunity Signals skipped (${opp.reason || 'skipped'}).`));
    else detail.push(okLine('[X SEARCH]', `Opportunity Signals: ${opp?.itemCount ?? 0} item(s) across ${(opp?.platforms || []).join(', ') || 'no platforms'} (one paid X call per enabled query row)`));
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

  // Group 4 — Mac worker (free, queued) or the paid X API, per the client's saved data source. confirmPaid is sent only
  // because the panel's confirm row already named the estimate; the server refuses an x-api run without it.
  'strategy-accounts': async (ctx) => {
    const src = await quoteCall(ctx, 'x-data-sources-get', { clientId: ctx.clientId });
    if (src?.dataSources?.strategyAccounts === 'x-api') {
      requireXApiConfirm(ctx, 'Strategy accounts');
      const res = await quoteCall(ctx, 'strategy-refresh', { clientId: ctx.clientId, confirmPaid: true });
      const done = Object.values(res?.handles || {}).filter((h) => h.status === 'done' || h.status === 'partial').length;
      return { detail: [okLine('[ACCOUNTS]', `Pulled via the X API — ${done}/${Object.keys(res?.handles || {}).length} account(s), ${res?.calls ?? '?'} call(s), ${res?.posts ?? '?'} post(s)${res?.stopped ? ` — stopped: ${res.stopped}` : ''}`)] };
    }
    const res = await quoteCall(ctx, 'strategy-refresh', { clientId: ctx.clientId });
    if (!res?.requestId) return { detail: [dimLine('[ACCOUNTS]', `Not queued (${res?.status || 'no request id'}).`)] };
    const out = await followMacRequest(ctx, { statusAction: 'strategy-refresh-status', requestId: res.requestId, label: 'Strategy accounts' });
    if (out.timedOut) return { detail: [dimLine('[ACCOUNTS]', 'Still waiting on your Mac. It stays queued and runs when the Mac checks in.')] };
    const handles = Object.values(out.request.results || {});
    const done = handles.filter((h) => h.status === 'done' || h.status === 'partial').length;
    const added = handles.reduce((n, h) => n + (Number(h.added) || 0), 0);
    const line = `Mac pull ${out.request.status} — ${done}/${handles.length} account(s), ${added} new post(s)`;
    if (out.request.status === 'done' || out.request.status === 'partial') return { detail: [okLine('[ACCOUNTS]', line)] };
    if (out.request.status === 'rate-limited') return { detail: [dimLine('[ACCOUNTS]', `${line}. X rate-limited the pull; try again in ~15 min.`)] };
    throw new Error(`Strategy accounts: ${line}${out.request.error ? ` (${out.request.error})` : ''}`);
  },

  // Group 8 — quote-target scan. X API source: runs on the server (paid, inline); Mac source: the scan runs locally, nothing to start here.
  'quote-targets': async (ctx) => {
    const src = await quoteCall(ctx, 'x-data-sources-get', { clientId: ctx.clientId });
    if (src?.dataSources?.quoteTargets === 'x-api') {
      requireXApiConfirm(ctx, 'Quote targets');
      const res = await quoteCall(ctx, 'quote-scan-refresh', { clientId: ctx.clientId, confirmPaid: true });
      return { detail: [okLine('[QUOTES]', `Scanned via the X API — ${res?.succeeded ?? '?'}/${res?.scanned ?? '?'} account(s), ${res?.candidates ?? 0} candidate(s), ${res?.calls ?? '?'} call(s), ${res?.posts ?? '?'} post(s)${res?.stopped ? ` — stopped: ${res.stopped}` : ''}`)] };
    }
    const res = await quoteCall(ctx, 'quote-scan-refresh', { clientId: ctx.clientId });
    if (!res?.requestId) return { detail: [dimLine('[QUOTES]', res?.instructions || 'The quote scan runs on your Mac (launchd).')] };
    const out = await followMacRequest(ctx, { statusAction: 'quote-scan-status', requestId: res.requestId, label: 'Quote targets' });
    if (out.timedOut) return { detail: [dimLine('[QUOTES]', 'Still waiting on your Mac. It stays queued and runs when the Mac checks in.')] };
    const r = out.request.result || {};
    const line = `Mac scan ${out.request.status} — ${r.candidates ?? 0} candidate(s) from ${r.succeeded ?? '?'}/${r.scanned ?? '?'} account(s)`;
    if (r.note) return { detail: [dimLine('[QUOTES]', r.note)] };
    if (out.request.status === 'done') return { detail: [okLine('[QUOTES]', line)] };
    if (out.request.status === 'rate-limited') return { detail: [dimLine('[QUOTES]', `${line}. X rate-limited the scan; try again in ~15 min.`)] };
    throw new Error(`Quote targets: ${line}${out.request.error ? ` (${out.request.error})` : ''}`);
  },

  // Group 9 — hot quotes: always the Mac (bird). Picks replace the previous unacted ones on the calendar.
  'hot-quotes': async (ctx) => {
    const res = await quoteCall(ctx, 'hot-quotes-find', { clientId: ctx.clientId });
    if (!res?.requestId) return { detail: [dimLine('[HOT]', res?.instructions || 'The hot scan runs on your Mac.')] };
    const out = await followMacRequest(ctx, { statusAction: 'quote-scan-status', requestId: res.requestId, label: 'Hot quotes', waitMs: HOT_WAIT_MS });
    if (out.timedOut) return { detail: [dimLine('[HOT]', 'Still waiting on your Mac. It stays queued and runs when the Mac checks in.')] };
    const r = out.request.result || {};
    const line = `Hot scan ${out.request.status} — ${r.picks ?? 0} new pick(s), ${r.quotesLeftToday ?? '?'} quote(s) left today`;
    if (out.request.status === 'done') return { detail: [okLine('[HOT]', line)] };
    if (out.request.status === 'rate-limited') return { detail: [dimLine('[HOT]', `${line}. X rate-limited the scan; try again in ~15 min.`)] };
    throw new Error(`Hot quotes: ${line}${out.request.error ? ` (${out.request.error})` : ''}`);
  },

  // Group 10 — bookmarks: always the Mac (bird). The judged picks land in marketingBrief.bookmarkPicks.
  bookmarks: async (ctx) => {
    const res = await quoteCall(ctx, 'bookmarks-find', { clientId: ctx.clientId });
    if (!res?.requestId) return { detail: [dimLine('[BOOKMARKS]', res?.instructions || 'The bookmarks scan runs on your Mac.')] };
    const out = await followMacRequest(ctx, { statusAction: 'quote-scan-status', requestId: res.requestId, label: 'Bookmarks', waitMs: HOT_WAIT_MS });
    if (out.timedOut) return { detail: [dimLine('[BOOKMARKS]', 'Still waiting on your Mac. It stays queued and runs when the Mac checks in.')] };
    const r = out.request.result || {};
    const line = `Bookmarks scan ${out.request.status} — ${r.picks ?? r.newThisRun ?? 0} pick(s)`;
    if (out.request.status === 'done') return { detail: [okLine('[BOOKMARKS]', line)] };
    if (out.request.status === 'rate-limited') return { detail: [dimLine('[BOOKMARKS]', `${line}. X rate-limited the scan; try again in ~15 min.`)] };
    throw new Error(`Bookmarks: ${line}${out.request.error ? ` (${out.request.error})` : ''}`);
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
    const days = Array.isArray(cal?.calendar?.weeks) ? cal.calendar.weeks.flat().filter(Boolean).length : null;
    detail.push(okLine('[CALENDAR]', `Month ${month} reloaded${days ? ` (${days} days)` : ''}`));
    const results = await quoteCall(ctx, 'post-results');
    const list = Array.isArray(results?.results) ? results.results : (Array.isArray(results?.posts) ? results.posts : null);
    detail.push(okLine('[RESULTS]', `Post results reloaded${list ? ` (${list.length})` : ''}`));
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
