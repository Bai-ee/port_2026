// paid.js - describe and execute the PAID refreshes of MCP-OPS. Pure: every effect is injected (ops.paid.*).
// Only runs.js calls executePaid, and only after: validate -> verify + consume the single-use preview token -> take the
// run lock -> reserve the caps. Reuse paths:
//   market-signals / analysis / renders  the pre-digest-refresh phase for ONE group (same call as the dashboard's agent refresh
//                                        wiring in quote-targets/route.js, source 'mcp-ops'); never allowX / allowXWatchlist
//   x-search                             the SAME function with groups Set(['x-search']) only (its own kind, see xsearch.js); Market Talk + Opportunity with X, requested client only
//   x-monitor / strategy-review          executePaidSync (features/mcp/paid-syncs.js), which takes the existing daily paid slot
//   site-showcase                        the showcase route's create action in-process with the owner's authorization;
//                                        status via the route's GET ?action=status (its healing path), doc read as fallback
//
// ops.paid = { digestRefresh(clientId, args), loadDigestCfg(clientId), loadXSearchInputs(clientId) -> {marketingBriefConfig, include, hasScrapeKey, pricing}, xMonitor(clientId), loadShowcaseRoute(), readShowcaseJob(jobId) }

import { ToolError } from '../jsonrpc.js';
import { describePaidSync, executePaidSync, normalizeParams as normalizeSyncParams } from '../paid-syncs.js';
import { SHOWCASE_CLIENTS, validateCreateInput } from '../../showcase/registry.js';
import { callDashboardRoute } from './dashboard-route.js';
import { planXSearch, xSearchEstimate, xSearchEffects, xSearchOutcome } from './xsearch.js';

const clip = (v, n = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const nowOf = (ctx) => (typeof ctx.now === 'function' ? ctx.now() : Date.now());

export const showcaseClientOf = (clientId) => SHOWCASE_CLIENTS[clientId] || null;

/** Validate + normalize the params of one paid refresh. Pure; throws a refusal the model should read. */
export function normalizePaidParams(entry, raw, { clientId }) {
  const params = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  if (entry.kind === 'digest' || entry.kind === 'x-search') return {};
  if (entry.kind === 'sync') return normalizeSyncParams(entry.syncKind, params);
  const videoClient = showcaseClientOf(clientId);
  if (!videoClient) throw new ToolError('Site Showcase is not enabled for this client.');
  const checked = validateCreateInput(params, videoClient);
  if (!checked.ok) throw new ToolError(`site-showcase params: ${checked.error} (needs focusId and format; theme optional).`);
  return checked.value;
}

/** The x-search plan for one client: free reads only (config, key presence, ledger pricing). */
export async function loadXSearchPlan(clientId, ops) {
  return planXSearch(await ops.paid.loadXSearchInputs(clientId));
}

/** Price + describe. Writes nothing, spends nothing. @returns {{estimate:string, effects:string[], noop?:boolean, plan?:object}} */
export async function describePaid(entry, params, { clientId, ops }) {
  if (entry.kind === 'x-search') {
    const plan = await loadXSearchPlan(clientId, ops);
    return { estimate: xSearchEstimate(plan), effects: [...entry.effects, ...xSearchEffects(plan)], noop: plan.calls === 0, plan };
  }
  if (entry.kind === 'sync') {
    const d = await describePaidSync(entry.syncKind, params, { clientId, services: { xMonitor: ops.paid.xMonitor } });
    return { estimate: d.estimate, effects: [...entry.effects, d.summary] };
  }
  const estimate = entry.kind === 'showcase' ? `${entry.estimate}. Focus ${params.focusId}, format ${params.format}, theme ${params.theme}.` : entry.estimate;
  return { estimate, effects: [...entry.effects] };
}

/**
 * The pre-digest-refresh args for the paid X search: groups is EXACTLY Set(['x-search']) in phase 'signals' (only Market Talk
 * on X + Opportunity with X run), for the requested client only. No allowX / allowXWatchlist (those are other paths).
 */
export function buildXSearchRefreshArgs({ clientId, cfg, actorUid, now }) {
  return {
    freshnessToken: `mcp-ops-${now.toString(36)}-${clientId.slice(0, 8)}`,
    source: 'mcp-ops',
    actorUid: actorUid ?? null,
    phase: 'signals',
    groups: new Set(['x-search']),
    include: cfg?.include || {},
    briefLinkMode: cfg?.briefLinkMode || 'fresh',
  };
}

/**
 * The pre-digest-refresh args for ONE confirmed group. groups is ALWAYS a single-item Set, and there is deliberately no
 * allowX / allowXWatchlist key: the paid X search (x-search) is never reachable from here.
 */
export function buildDigestRefreshArgs({ clientId, entry, cfg, actorUid, now }) {
  if (entry.kind !== 'digest') throw new Error(`buildDigestRefreshArgs is for digest kinds only, not "${entry.id}".`);
  return {
    freshnessToken: `mcp-ops-${now.toString(36)}-${clientId.slice(0, 8)}`,
    source: 'mcp-ops',
    actorUid: actorUid ?? null,
    phase: entry.phase,
    groups: new Set([entry.id]),
    include: cfg?.include || {},
    briefLinkMode: cfg?.briefLinkMode || 'fresh',
  };
}

const STEP_KEYS = ['modules', 'scout', 'strategy', 'executiveSummary'];
/**
 * A digest run is `failed` only when the preflight refused it (nothing ran). If any step ran it is `done` with a per-step
 * summary: step errors are listed, not turned into a failure (money may already have been spent by the steps that ran).
 */
export function digestOutcome(entry, out) {
  if (!out || (out.skipped && out.ok === false)) return { status: 'failed', detail: clip(`Not run: ${out?.reason || out?.error || 'the refresh was refused before any step ran'}.`) };
  if (out.skipped) return { status: 'done', detail: `Nothing to run (${clip(out.reason || 'skipped')}).` };
  const steps = [];
  for (const k of STEP_KEYS) {
    const r = out[k];
    if (!r || (r.skipped && r.reason === 'other-phase')) continue;
    steps.push(`${k} ${r.ok === false ? `failed${r.error || r.reason ? ` (${clip(r.error || r.reason, 80)})` : ''}` : r.skipped ? `skipped (${clip(r.reason, 60)})` : 'ok'}`);
  }
  const brief = out.digestFreshness?.freshBriefPath || out.freshBrief?.path;
  if (brief) steps.push(`freshBriefPath ${clip(brief, 120)}`);
  const errors = STEP_KEYS.filter((k) => out[k] && out[k].ok === false && !out[k].skipped).length;
  return { status: 'done', detail: clip(`${entry.label} ran${errors ? ` with ${errors} step error${errors === 1 ? '' : 's'}` : ''}. Steps: ${steps.join('; ') || 'none reported'}.`, 500) };
}

/** Run one confirmed paid refresh. Returns {status, requestId?, detail}; throws on failure (the caller records it). */
export async function executePaid({ entry, params, ctx, clientId, ops }) {
  if (entry.kind === 'digest') {
    const cfg = await Promise.resolve(ops.paid.loadDigestCfg(clientId)).catch(() => null);
    const out = await ops.paid.digestRefresh(clientId, buildDigestRefreshArgs({ clientId, entry, cfg, actorUid: ctx.uid, now: nowOf(ctx) }));
    return digestOutcome(entry, out);
  }
  if (entry.kind === 'x-search') {
    const [cfg, plan] = await Promise.all([Promise.resolve(ops.paid.loadDigestCfg(clientId)).catch(() => null), loadXSearchPlan(clientId, ops)]);
    const out = await ops.paid.digestRefresh(clientId, buildXSearchRefreshArgs({ clientId, cfg, actorUid: ctx.uid, now: nowOf(ctx) }));
    return xSearchOutcome(plan, out);
  }
  if (entry.kind === 'sync') {
    const res = await executePaidSync({
      kind: entry.syncKind, params,
      ctx: { email: ctx.email, uid: ctx.uid ?? null, clientId, now: () => nowOf(ctx), services: { counters: ctx.services.counters, strategyHandlers: ctx.services.strategyHandlers, xMonitor: ops.paid.xMonitor } },
    });
    return { status: 'done', detail: clip(JSON.stringify(res), 500) };
  }
  // site-showcase: the route's own transaction enforces one active job and the daily cap.
  const route = ctx.services.showcaseRoute ? await ctx.services.showcaseRoute() : await ops.paid.loadShowcaseRoute();
  const { status, json } = await callDashboardRoute(ctx, { route, path: '/api/dashboard/showcase', query: { action: 'create' }, body: params, clientId });
  if (status >= 400 || !json || json.error || !json.jobId) return { status: 'failed', detail: clip(`Showcase refused (${status}): ${json?.error || 'no job'}`) };
  const job = await ops.paid.readShowcaseJob(json.jobId);
  if (!job || job.clientId !== clientId) return { status: 'failed', detail: clip(`Refused: the showcase job ${json.jobId} is not for client ${clientId}. Check HITLOOP Site Showcase.`) };
  return { status: 'running', requestId: json.jobId, detail: 'Render job queued. Follow it with get_run_status.' };
}

const SHOWCASE_STATUS = { done: 'done', failed: 'failed', queued: 'running', rendering: 'running' };

/**
 * Status of a showcase run via the route's GET ?action=status (the healing path: it re-pokes a lost trigger after 20 s and
 * fails jobs older than 20 min; it creates no job and uses no cap). Falls back to reading the job doc only when the route
 * call fails. The job's clientId is verified either way. Returns null when the job is not this client's.
 */
export async function readShowcaseStatus({ row, clientId, ops, ctx }) {
  let job = null;
  try {
    const route = ctx.services.showcaseRoute ? await ctx.services.showcaseRoute() : await ops.paid.loadShowcaseRoute();
    const { status, json } = await callDashboardRoute(ctx, { route, path: '/api/dashboard/showcase', method: 'GET', query: { action: 'status', jobId: row.requestId }, clientId });
    if (status < 400 && json?.job) job = json.job;
  } catch { job = null; }
  if (!job) job = await ops.paid.readShowcaseJob(row.requestId);
  if (!job || job.clientId !== clientId) return null;
  const s = String(job.status || '');
  const result = job.downloadUrl ? { url: job.downloadUrl, sizeBytes: job.sizeBytes ?? null, durationInFrames: job.durationInFrames ?? null } : undefined;
  return {
    status: SHOWCASE_STATUS[s] || 'unknown',
    underlying: { status: s, ...(job.error?.message ? { error: clip(job.error.message), ...(job.error.stage ? { stage: job.error.stage } : {}) } : {}) },
    ...(result ? { result } : {}),
  };
}
