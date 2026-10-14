// paid-syncs.js - the paid syncs the MCP server may ASK for. Shared server module:
//   - the MCP server (tools/syncs.js request_sync) uses describePaidSync() to validate + price an action and turn it
//     into a `paid-sync` proposal card;
//   - the dashboard route (quote-targets) injects executePaidSync() as the `runPaidSync` dep of the strategy handlers,
//     so the action runs ONLY when the owner presses Confirm on that card inside HITLOOP (strategy-proposal-decide).
// Nothing in the MCP server calls executePaidSync. No model can spend money through MCP.
//
// Kinds: strategy_review (one Anthropic agent turn), x_monitor_sync (X API READS only, metered), nas_analyze (Anthropic
// batch, hard-capped). market_signals_refresh was REMOVED: its signals phase runs paid X watchlist reads and the
// dailyXSearch override; use the Market Signals card in the dashboard.
// NEVER here: X API writes, posting, scheduling, approving, deleting, sending email, Telegram sends.
//
// ctx for execute: { email, clientId, now(), auth?, services: { strategyHandlers(), xMonitor(), nas(action, body, email), counters() } }

import { PAID_SYNC_KINDS } from '../x-strategy/contracts.js';
import { reserveDailyPaidSlot } from './limits.js';

export const NAS_ANALYZE_MAX_CAP_USD = 2;
export const NAS_MAX_PATHS = 50;
export const X_MONITOR_INCLUDES = Object.freeze(['profile', 'posts', 'audience']);

/** A refusal the caller (MCP model or the owner's card) should read. */
export class PaidSyncError extends Error {
  constructor(message, code = 'invalid', status = 400) { super(message); this.name = 'PaidSyncError'; this.code = code; this.status = status; this.expose = true; }
}

const authFor = (ctx) => ctx.auth || { decoded: { email: ctx.email, uid: ctx.uid ?? null } };

function unwrap(res, what) {
  if (res && res.ok === false) throw new PaidSyncError(`${what} failed: ${res.error || `status ${res.status || '?'}`}`, 'failed', 502);
  return res;
}

// ---- params: validate + normalize (pure; runs at request time AND again at confirm time) -----------------------

export function normalizeParams(kind, raw) {
  const params = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  switch (kind) {
    case 'strategy_review': return {};
    case 'x_monitor_sync': {
      const include = Array.isArray(params.include) && params.include.length ? [...new Set(params.include)] : ['profile', 'posts'];
      const bad = include.filter((i) => !X_MONITOR_INCLUDES.includes(i));
      if (bad.length) throw new PaidSyncError(`include may only contain profile, posts, audience (got ${bad.map((b) => String(b).slice(0, 20)).join(', ')}).`);
      return { include };
    }
    case 'nas_analyze': {
      if (typeof params.sourceId !== 'string' || !params.sourceId.trim() || params.sourceId.length > 200) throw new PaidSyncError('params.sourceId is required.');
      if (!Array.isArray(params.paths) || !params.paths.length || params.paths.length > NAS_MAX_PATHS) throw new PaidSyncError(`params.paths must list 1-${NAS_MAX_PATHS} paths.`);
      if (params.paths.some((p) => typeof p !== 'string' || !p.trim() || p.length > 500)) throw new PaidSyncError('params.paths must be non-empty strings of at most 500 characters.');
      const cap = params.capUsd === undefined ? NAS_ANALYZE_MAX_CAP_USD : Number(params.capUsd);
      if (!Number.isFinite(cap) || cap <= 0 || cap > NAS_ANALYZE_MAX_CAP_USD) throw new PaidSyncError(`params.capUsd must be > 0 and <= ${NAS_ANALYZE_MAX_CAP_USD}.`);
      return { sourceId: params.sourceId.trim(), paths: params.paths.map((p) => p.trim()), capUsd: cap };
    }
    default: throw new PaidSyncError(`Unknown kind "${String(kind).slice(0, 40)}". Valid: ${PAID_SYNC_KINDS.join(', ')}.`);
  }
}

// ---- describe: validate + price. Writes nothing, spends nothing. -----------------------------------------------

export const SYNC_SUMMARIES = Object.freeze({
  strategy_review: 'Run a Strategy review (one AI agent turn over the latest data)',
  x_monitor_sync: 'Refresh X Monitor from the X API (reads only)',
  nas_analyze: 'Run AI analysis on NAS files (Anthropic batch, hard-capped)',
});

/** @returns {Promise<{kind:string, params:object, estimate:string, summary:string}>} */
export async function describePaidSync(kind, rawParams, ctx) {
  const params = normalizeParams(kind, rawParams);
  let estimate;
  let summary = SYNC_SUMMARIES[kind];
  if (kind === 'strategy_review') {
    estimate = '~$0.17 Anthropic (Sonnet, up to 6 tool rounds). Counts as 1 of the daily strategy-chat turns. Creates a new chat thread; any proposals it makes are pending cards.';
  } else if (kind === 'x_monitor_sync') {
    let calls = (params.include.includes('profile') ? 1 : 0) + (params.include.includes('posts') ? 2 : 0); // posts: 1, or 2 on the public-metrics fallback
    let audiencePages = 0;
    if (params.include.includes('audience')) {
      const x = await ctx.services.xMonitor();
      const st = await x.status();
      const est = st.accountId ? await x.estimateAudienceCalls(st.accountId) : { pages: 1 };
      audiencePages = est.pages; calls += audiencePages;
    }
    estimate = `Up to ${calls} metered X API READ call${calls === 1 ? '' : 's'}${audiencePages ? ` (including ~${audiencePages} follower page${audiencePages === 1 ? '' : 's'})` : ''}. X spend is invisible on the Operating Cost card. No writes.`;
    summary = `Refresh X Monitor from the X API: up to ${calls} metered read call${calls === 1 ? '' : 's'}`;
  } else {
    estimate = `Hard-capped at $${params.capUsd.toFixed(2)} Anthropic (Haiku, batch pricing) for ${params.paths.length} path${params.paths.length === 1 ? '' : 's'}. Results arrive minutes to hours later.`;
    summary = `Run AI analysis on ${params.paths.length} NAS path${params.paths.length === 1 ? '' : 's'}, capped at $${params.capUsd.toFixed(2)}`;
  }
  return { kind, params, estimate, summary: summary.slice(0, 200) };
}

// ---- execute: only reachable from a confirmed proposal card --------------------------------------------------

/**
 * Run one paid sync. Re-validates the params, takes a slot of the daily budget ATOMICALLY (read + increment in one
 * transaction), then runs. The slot is spent even if the run then fails (the money may have been).
 */
export async function executePaidSync({ kind, params, ctx }) {
  const clean = normalizeParams(kind, params);
  await reserveDailyPaidSlot(ctx.services.counters(), { now: ctx.now() });
  if (kind === 'strategy_review') {
    const out = unwrap(await ctx.services.strategyHandlers().handle('strategy-review', { clientId: ctx.clientId }, { clientId: ctx.clientId }, authFor(ctx)), 'Strategy review');
    return {
      kind, threadId: out.threadId ?? null,
      proposals: (out.proposals || []).slice(0, 5).map((p) => ({ id: p.id, kind: p.kind, summary: String(p.summary || '').slice(0, 160) })),
      lastReview: out.lastReview ?? null,
    };
  }
  if (kind === 'x_monitor_sync') {
    const x = await ctx.services.xMonitor();
    const out = { kind, calls: 0, synced: [] };
    if (clean.include.includes('profile')) { const r = await x.syncProfile(); out.calls += r?.callsMade || 0; out.synced.push('profile'); }
    if (clean.include.includes('posts')) { const r = await x.syncPosts({}); out.calls += r?.callsMade || 0; out.synced.push('posts'); }
    if (clean.include.includes('audience')) { const r = await x.syncAudience({}); out.calls += r?.callsMade || 0; out.synced.push('audience'); }
    return out;
  }
  const res = unwrap(await ctx.services.nas('nas-process', { sourceId: clean.sourceId, paths: clean.paths, capUsd: clean.capUsd, batch: true }, ctx.email), 'NAS analyze');
  return { kind, ...(res && typeof res === 'object' ? res : {}) };
}

/** Lazy, server-only X Monitor service (same shape as features/mcp/server.js xMonitor()). Dynamic imports keep tests light. */
export async function loadXMonitorService() {
  const [{ getXOAuthStatus }, xSync, xStore] = await Promise.all([
    import('../social-posting/x-oauth.js'), import('../x-monitor/sync.js'), import('../x-monitor/store.js'),
  ]);
  return {
    status: async () => { const s = await getXOAuthStatus(); return { accountId: s.userId ? String(s.userId) : null, username: s.username || null }; },
    estimateAudienceCalls: xSync.estimateAudienceCalls,
    syncProfile: xSync.syncProfile, syncPosts: xSync.syncPosts, syncAudience: xSync.syncAudience,
  };
}
