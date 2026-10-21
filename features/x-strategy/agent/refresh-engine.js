// refresh-engine.js - the agent refreshes data ITSELF (refresh_data tool, agent-refresh route action).
//
// Server-side equivalents of the browser runners in components/dashboard/marketing/refresh-runners.js. Every effect is an
// injected dep, so this file does no I/O. Three kinds of group:
//   server  runs inside the call (digest phases, X Monitor sync, today queue). Capped at SERVER_TIMEOUT_MS each: a group
//           that overruns reports 'running' (the work continues while the turn lives) and the model says so.
//   mac     queues a request the Mac refresh worker runs with bird (free). Returns 'queued' + requestId + etaSeconds;
//           the model answers with what it has and calls refresh_status on the next turn.
//   paid    a server group that costs money. Runs only under the owner's trustedRefresh policy (default OFF) and the daily
//           cap; otherwise 'needs-confirm' and the model offers the existing propose_refresh card.
// x-search (paid X search) is never offered to the agent. X publishing is untouched: this engine only reads/refreshes.
//
// COST ESTIMATES ARE CONSERVATIVE PLACEHOLDERS, not billing truth: only the Scout run (~$0.10) has a documented dollar
// figure (refresh-groups.js SCOUT_RUN_USD). Analysis / Renders / X reads have counts but no documented rate, so the
// numbers below are rounded up on purpose. The provider's own console remains the bill.

import { AGENT_REFRESH_GROUP_IDS } from '../contracts.js';
import { TRUSTED_REFRESH_DEFAULTS } from './action-runtime.js';
import { utcDayKey } from './refresh-spend.js';

export const SERVER_TIMEOUT_MS = 45_000;
export const MAC_ETA_SECONDS = Object.freeze({ 'quote-targets': 240, 'hot-quotes': 480, bookmarks: 120, 'recent-posts': 60, 'strategy-accounts': 180 });
export const SCAN_MODE_OF_GROUP = Object.freeze({ 'quote-targets': 'quote', 'hot-quotes': 'hot', bookmarks: 'bookmarks', 'recent-posts': 'recent-posts' });
/** Placeholder dollars per paid server group (see header). x-monitor / x-api strategy-accounts price from call counts. */
export const PLACEHOLDER_USD = Object.freeze({ 'market-signals': 0.10, analysis: 0.25, renders: 0.50, 'x-monitor': 0.05, 'strategy-accounts': 0.10 });
/** Placeholder dollars per metered X API read call (the X rate is not documented in this repo). */
export const X_READ_USD_PER_CALL = 0.01;
export const DIGEST_PHASE_OF_GROUP = Object.freeze({ 'market-signals': 'signals', analysis: 'analysis', renders: 'modules' });

const round = (n) => Math.round(n * 10000) / 10000;
const clip = (v, n = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * How one group would run right now. Pure.
 * @returns {{group:string, mode:'server'|'mac'|'paid'|'skipped', paid:boolean, usd:number, estimate:string, reason?:string}}
 */
export function planGroup(group, { sources = {}, estimates = {} } = {}) {
  if (!AGENT_REFRESH_GROUP_IDS.includes(group)) return { group, mode: 'skipped', paid: false, usd: 0, estimate: '', reason: group === 'x-search' ? 'x-search is the paid X search: the owner runs it from the Refresh panel' : 'unknown refresh group' };
  if (SCAN_MODE_OF_GROUP[group]) {
    // Quote targets on the paid X API source is a spend the agent never starts.
    if (group === 'quote-targets' && sources.quoteTargets === 'x-api') return { group, mode: 'paid', paid: true, usd: 0, estimate: 'Quote targets is set to the paid X API (about 2 calls per account, up to 15 accounts).', reason: 'x-api-source' };
    return { group, mode: 'mac', paid: false, usd: 0, estimate: 'Free: Mac bird scan' };
  }
  if (group === 'strategy-accounts') {
    if (sources.strategyAccounts === 'x-api') return { group, mode: 'paid', paid: true, usd: estimates[group]?.usd ?? PLACEHOLDER_USD[group], estimate: estimates[group]?.text || 'Paid X API pull of your own and benchmark timelines.' };
    return { group, mode: 'mac', paid: false, usd: 0, estimate: 'Free: Mac bird pull' };
  }
  if (group === 'today-queue') return { group, mode: 'server', paid: false, usd: 0, estimate: 'Free (no model copy)' };
  const usd = estimates[group]?.usd ?? PLACEHOLDER_USD[group];
  return { group, mode: 'paid', paid: true, usd, estimate: estimates[group]?.text || `about $${usd.toFixed(2)} (placeholder estimate)` };
}

/** True when this paid group may run now under the policy, given what is already spent / committed today. */
function withinPolicy(p, policy, spentUsd) {
  if (!policy?.enabled) return false;
  if (p.reason === 'x-api-source') return false; // never auto-started
  return spentUsd + p.usd <= policy.dailyCapUsd + 1e-9;
}

/**
 * Per-group "may the agent run this now": true | 'needs-confirm' | 'no-path'. Pure (get_freshness uses it).
 * @param {{groups:string[], policy?:object, spentTodayUsd?:number, sources?:object, estimates?:object}} o
 */
export function agentRefreshAvailability({ groups, policy, spentTodayUsd = 0, sources = {}, estimates = {} }) {
  const out = {};
  let committed = spentTodayUsd;
  for (const g of groups || []) {
    if (g === null || g === undefined) { out[g] = 'no-path'; continue; }
    const p = planGroup(g, { sources, estimates });
    if (p.mode === 'skipped') { out[g] = 'no-path'; continue; }
    if (!p.paid) { out[g] = true; continue; }
    if (withinPolicy(p, policy, committed)) { out[g] = true; committed += p.usd; } else out[g] = 'needs-confirm';
  }
  return out;
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), ms); });
  return Promise.race([promise.then((value) => ({ value }), (error) => ({ error })), timeout]).finally(() => clearTimeout(timer));
}

const macNote = (health) => {
  if (health?.state === 'never') return ' The Mac refresh worker has never checked in.';
  if (typeof health?.ageMinutes === 'number' && health.ageMinutes > 3) return ` The Mac last checked in ${health.ageMinutes} min ago, so it may be asleep.`;
  return '';
};

/**
 * @param {object} o
 * @param {string} o.clientId
 * @param {string[]} o.groups
 * @param {string} [o.reason]
 * @param {object} o.deps  { getSources, digestPhase, paidSync, estimatePaid?, queueScan, requestStrategyRefresh, pullStrategyAccounts, generateToday, spend }
 * @param {{enabled?:boolean, dailyCapUsd?:number}} [o.policy]  trustedRefresh
 * @param {number} [o.now]
 * @param {number} [o.serverTimeoutMs]
 * @returns {Promise<{ok:boolean, results:object[], spentUsd:number, spentTodayUsd:number, dailyCapUsd:number, trustedRefresh:boolean, pendingRequestIds:string[], guidance:string}>}
 */
export async function runAgentRefresh({ clientId, groups, reason = '', deps, policy, now = Date.now(), serverTimeoutMs = SERVER_TIMEOUT_MS } = {}) {
  const pol = { ...TRUSTED_REFRESH_DEFAULTS, ...(policy || {}) };
  const day = utcDayKey(now);
  const wanted = [...new Set(Array.isArray(groups) ? groups.filter((g) => typeof g === 'string') : [])];
  const sources = (await Promise.resolve(deps.getSources?.()).catch(() => null)) ?? {};
  const estimates = {};
  for (const g of ['x-monitor', 'strategy-accounts']) {
    const e = await Promise.resolve(deps.estimatePaid?.(g)).catch(() => null);
    if (e && Number.isFinite(e.usd)) estimates[g] = { usd: e.usd, text: clip(e.text) };
  }
  const ledger = (await Promise.resolve(deps.spend?.get(clientId, day)).catch(() => null)) ?? { usd: 0, runs: [] };
  const spentBefore = ledger.usd || 0;

  // 1. Decide every group up front (sequentially, so two paid groups cannot both squeeze under one cap).
  let committed = spentBefore;
  const decided = wanted.map((g) => {
    const p = planGroup(g, { sources, estimates });
    if (p.mode === 'skipped') return { p, result: { group: g, mode: 'skipped', status: 'failed', detail: p.reason } };
    if (p.paid) {
      if (!withinPolicy(p, pol, committed)) {
        const why = p.reason === 'x-api-source' ? 'this group is set to the paid X API, which only the Refresh panel confirm row starts'
          : !pol.enabled ? "the owner's \"Let the agent refresh paid sources\" setting is off"
            : `it would pass today's agent cap ($${committed.toFixed(2)} of $${pol.dailyCapUsd.toFixed(2)} used)`;
        return { p, result: { group: g, mode: 'paid', status: 'needs-confirm', estimate: p.estimate, detail: `Not run: ${why}. Say the cost and offer propose_refresh.` } };
      }
      committed += p.usd;
    }
    return { p };
  });

  // 2. Run what was cleared, concurrently.
  const entries = [];
  const runOne = async ({ p, result }) => {
    if (result) return result;
    const g = p.group;
    if (p.mode === 'mac') return runMac(g, deps);
    const spendNote = p.paid ? { estimate: p.estimate } : {};
    if (p.paid) {
      // Spend is recorded when the work starts: a timeout or a late failure may still have cost money.
      const entry = { at: new Date(now).toISOString(), group: g, usd: round(p.usd) };
      entries.push(entry);
      try { await deps.spend?.add(clientId, day, entry); } catch { /* ledger write is best effort; the cap check already ran */ }
    }
    const run = (() => {
      if (g === 'market-signals' || g === 'analysis' || g === 'renders') return deps.digestPhase({ phase: DIGEST_PHASE_OF_GROUP[g], group: g });
      if (g === 'x-monitor') return deps.paidSync({ kind: 'x_monitor_sync', params: { include: ['profile', 'posts'] } });
      if (g === 'strategy-accounts') return deps.pullStrategyAccounts();
      if (g === 'today-queue') return deps.generateToday();
      return Promise.reject(new Error('no runner'));
    })();
    const out = await withTimeout(Promise.resolve(run), serverTimeoutMs);
    const mode = p.paid ? 'paid' : 'server';
    if (out.timedOut) return { group: g, mode, status: 'running', ...spendNote, detail: `Still running after ${Math.round(serverTimeoutMs / 1000)} s; it keeps going. Answer with what you have and ask the owner to check again in a minute or two.` };
    if (out.error) return { group: g, mode, status: 'failed', ...spendNote, detail: clip(out.error.message || out.error) };
    const v = out.value;
    if (v && v.ok === false) return { group: g, mode, status: 'failed', ...spendNote, detail: clip(v.error || v.reason || 'the refresh reported a failure') };
    return { group: g, mode, status: 'done', ...spendNote, detail: summarize(g, v) };
  };
  const results = await Promise.all(decided.map(runOne));

  const spentUsd = round(entries.reduce((n, e) => n + e.usd, 0));
  const pendingRequestIds = results.filter((r) => r.requestId && (r.status === 'queued' || r.status === 'running')).map((r) => r.requestId);
  const needsConfirm = results.some((r) => r.status === 'needs-confirm');
  const guidance = [
    results.some((r) => r.mode === 'mac' && r.status === 'queued') ? 'Mac groups are queued: answer now with what you have, say what is refreshing and when to ask again, and call refresh_status first next turn.' : '',
    results.some((r) => r.status === 'done') ? 'Groups marked done are fresh: re-read the tool you need (get_recent_posts, get_brief, get_calendar...) before answering.' : '',
    needsConfirm ? 'needs-confirm groups cost money and are off or over the cap: say the cost and offer propose_refresh.' : '',
  ].filter(Boolean).join(' ');
  return {
    ok: !results.some((r) => r.status === 'failed'),
    results, spentUsd, spentTodayUsd: round(spentBefore + spentUsd), dailyCapUsd: pol.dailyCapUsd, trustedRefresh: pol.enabled === true,
    pendingRequestIds, guidance,
  };
}

async function runMac(group, deps) {
  const base = { group, mode: 'mac', etaSeconds: MAC_ETA_SECONDS[group] };
  try {
    const q = group === 'strategy-accounts' ? await deps.requestStrategyRefresh() : await deps.queueScan({ mode: SCAN_MODE_OF_GROUP[group] });
    if (!q?.requestId) return { ...base, status: 'failed', detail: clip(q?.instructions || q?.error || 'The Mac request could not be queued.') };
    const running = q.status === 'running';
    return { ...base, status: running ? 'running' : 'queued', requestId: q.requestId, detail: `${q.merged || q.existing ? 'Already queued. ' : ''}The Mac picks it up within a minute; about ${Math.round(MAC_ETA_SECONDS[group] / 60)} min in total.${macNote(q.workerHealth)}`.trim() };
  } catch (err) {
    return { ...base, status: 'failed', detail: clip(err?.message || err) };
  }
}

function summarize(group, v) {
  if (!v || typeof v !== 'object') return 'Done.';
  if (group === 'x-monitor') return `Synced; ${v.calls ?? '?'} metered X read call(s).`;
  if (group === 'today-queue') return v.skipped ? `Inputs unchanged (${v.reason || 'no change'}); saved run kept.` : `Today's suggestions regenerated (${Array.isArray(v.run?.suggestions) ? v.run.suggestions.length : '?'}), no model copy.`;
  if (group === 'strategy-accounts') return `Pulled via the X API (${v.calls ?? '?'} call(s), ${v.posts ?? '?'} post(s)).`;
  if (v.skipped) return `Nothing to run (${clip(v.reason || 'skipped')}).`;
  return 'Done.';
}

/** Status of previously queued Mac requests. deps.requestStatus(id) -> { status, result?, error?, ... } | null. */
export async function agentRefreshStatus({ requestIds, deps }) {
  const ids = [...new Set((Array.isArray(requestIds) ? requestIds : []).filter((x) => typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x)))].slice(0, 12);
  const statuses = await Promise.all(ids.map(async (requestId) => {
    try {
      const r = await deps.requestStatus(requestId);
      if (!r) return { requestId, status: 'unknown', detail: 'No such request for this client.' };
      return { requestId, status: r.status ?? 'unknown', ...(r.result !== undefined ? { result: r.result } : {}), ...(r.error ? { error: clip(r.error) } : {}) };
    } catch (err) {
      return { requestId, status: 'unknown', detail: clip(err?.message || err) };
    }
  }));
  const open = statuses.filter((s) => ['queued', 'running'].includes(s.status)).length;
  return { ok: true, requests: statuses, ...(open ? { note: `${open} still running on the Mac; ask again shortly.` } : {}) };
}
