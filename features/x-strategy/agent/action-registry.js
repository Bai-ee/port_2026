// Action registry: every dashboard server action the strategy chat agent may run, as data.
// The agent sees it only through two generic tools (find_actions / run_action, owned by action-runtime.js).
// Docs: docs/source-of-truth/AGENT-ACTION-REGISTRY.md (tiers, groups, how to add an action, exclusions).
//
// Entry shape (frozen):
//   id        dotted stable id ('queue.post.update')            group   one of GROUPS
//   title, description (<=200 chars)
//   route     key of ROUTE_MODULES                              method  'GET' | 'POST'
//   action    body.action for POST routes with an action switch; null otherwise
//   query?    fixed query params (media / archive-inbox / client-brain select their action here; refresh phases)
//   fixed?    fixed body fields merged AFTER the agent's args (the agent can never override them)
//   args      JSON-schema subset the agent fills. POST: becomes the body (+ action, clientId). GET: query-string params.
//             additionalProperties:false => the runtime should DROP unknown keys before calling the route.
//   tier      0 read | 1 reversible write | 2 destructive | 3 external/spend
//   external? 'x' (publishes to X, incl. arming the cron to publish) | 'email' | 'arweave' | 'paid' | null
//   cost?, irreversible?
//   snapshot? docs to capture before a tier-1/2 run, for undo:
//             { collection, idArg }                 -> doc <collection>/<args[idArg]>   (idArg may be dotted: 'pkg.id')
//             { path:'a/{clientId}/b/{bucket.id}' } -> doc path; {clientId} = resolved client, {x.y} = args path
//             optional `field` = dotted field inside the doc to capture/restore instead of the whole doc
//   viaRefreshPanel?  true => too long for the chat request (270-300 s): run_action never invokes it, it returns a `refresh`
//             proposal (clientAction 'marketing-refresh') for the dashboard Refresh panel. Needs refreshGroups (REFRESH_GROUP_IDS)
//             or refreshGroupsByArg {arg, map:{argValue:[ids]}}; an unmapped arg value is "not runnable in chat".
//   undo?     { actionId, argsFrom:{ param:'args.x' | 'result.x' | 'before.x' } } native undo action (preferred over snapshot)
//
// Tier rules: reads 0; versioned/reversible writes and draft creation 1; deletes/rejects/overwrites 2; anything that
// publishes to X, ARMS a publish (scheduledAt set => the process-due cron posts it), sends email, or spends (Scout,
// ScrapeCreators, X API, Anthropic, renders, Arweave) 3.
//
// EXCLUDED (not in the registry, by design):
//   account/delete, clients/provision, account/update-client, admin/delete-client, admin/create-client, admin/clients/*,
//   admin/client-configs bulk ops   -> identity, provisioning and deletion are never agent actions.
//   payments/*, oauth/*, auth/twitter/callback, social-posting/x-oauth*, dashboard/x-monitor connect-start,
//   dashboard/calendar/connect|callback, dashboard/telegram (setWebhook) -> credentials/consent flows that need a human.
//   quote-targets strategy-chat-send / strategy-proposal-decide / strategy-review / strategy-chat-history -> the agent must
//   not call itself or approve its own proposal cards.   quote-targets save-thumb (binary data URL), media-url (single, superseded
//   by media-urls), media route upload-session / complete-upload (browser uploads), remix-download.
//   social-posting GET ?action=process-due (cron-secret only) and planOverride (plan-cap bypass needs a human reason).
//   worker/* other than pre-digest-refresh, intelligence/*, leadgen/*, site-clone, studio-*, knowledge-base/*, onboarding.
//   mcp/*  -> the MCP transport is a separate surface.

import { REFRESH_GROUP_IDS } from '../contracts.js';
import { QUEUE_ACTIONS } from './catalog/queue.js';
import { CONTENT_ACTIONS } from './catalog/content.js';
import { STRATEGY_ACTIONS } from './catalog/strategy.js';
import {
  BRAIN_ACTIONS, SIGNALS_ACTIONS, DIGEST_ACTIONS, REFRESH_ACTIONS, REFRESH_DAILY_ACTIONS, XMONITOR_ACTIONS, MEDIA_ACTIONS, OTHER_ACTIONS,
} from './catalog/ops.js';

export const GROUPS = Object.freeze(['queue', 'calendar', 'content', 'buckets', 'strategy', 'brain', 'signals', 'digest', 'refresh', 'xmonitor', 'media', 'nas', 'clients', 'other']);
export const TIERS = Object.freeze([0, 1, 2, 3]);
export const EXTERNALS = Object.freeze(['x', 'email', 'arweave', 'paid']);

/** Route key -> lazy import (relative to this file). The runtime calls mod.GET / mod.POST in-process. */
export const ROUTE_MODULES = Object.freeze({
  'quote-targets': () => import('../../../app/api/dashboard/quote-targets/route.js'),
  'social-posting': () => import('../../../app/api/social-posting/route.js'),
  'client-brain': () => import('../../../app/api/dashboard/client-brain/route.js'),
  'client-brain-form': () => import('../../../app/api/dashboard/client-brain/form/route.js'),
  'client-brain-generate': () => import('../../../app/api/dashboard/client-brain/generate/route.js'),
  'client-brain-approve': () => import('../../../app/api/dashboard/client-brain/approve/route.js'),
  'client-brain-sources': () => import('../../../app/api/dashboard/client-brain/sources/route.js'),
  'marketing-brief-config': () => import('../../../app/api/dashboard/marketing-brief/config/route.js'),
  'marketing-brief-run': () => import('../../../app/api/dashboard/marketing-brief/run/route.js'),
  'digest-config': () => import('../../../app/api/admin/digest-config/route.js'),
  'refresh-daily': () => import('../../../app/api/admin/refresh-daily/route.js'),
  'email-digest': () => import('../../../app/api/admin/email-digest/route.js'),
  'cost-report': () => import('../../../app/api/admin/cost-report/route.js'),
  'pre-digest-refresh': () => import('../../../app/api/worker/pre-digest-refresh/route.js'),
  'x-monitor': () => import('../../../app/api/dashboard/x-monitor/route.js'),
  'opportunity-signals-refresh': () => import('../../../app/api/dashboard/opportunity-signals/refresh/route.js'),
  'watchlist-pull': () => import('../../../app/api/dashboard/watchlist-pull/route.js'),
  'recipe-run': () => import('../../../app/api/dashboard/recipe-run/route.js'),
  'web-stats-config': () => import('../../../app/api/dashboard/web-stats/config/route.js'),
  'calendar-status': () => import('../../../app/api/dashboard/calendar/status/route.js'),
  'calendar-disconnect': () => import('../../../app/api/dashboard/calendar/disconnect/route.js'),
  'media': () => import('../../../app/api/dashboard/media/route.js'),
  'archive-inbox': () => import('../../../app/api/dashboard/archive-inbox/route.js'),
});

/** Route key -> repo-relative source file (used by tests to verify action literals; also documentation). */
export const ROUTE_FILES = Object.freeze({
  'quote-targets': 'app/api/dashboard/quote-targets/route.js',
  'social-posting': 'app/api/social-posting/route.js',
  'client-brain': 'app/api/dashboard/client-brain/route.js',
  'client-brain-form': 'app/api/dashboard/client-brain/form/route.js',
  'client-brain-generate': 'app/api/dashboard/client-brain/generate/route.js',
  'client-brain-approve': 'app/api/dashboard/client-brain/approve/route.js',
  'client-brain-sources': 'app/api/dashboard/client-brain/sources/route.js',
  'marketing-brief-config': 'app/api/dashboard/marketing-brief/config/route.js',
  'marketing-brief-run': 'app/api/dashboard/marketing-brief/run/route.js',
  'digest-config': 'app/api/admin/digest-config/route.js',
  'refresh-daily': 'app/api/admin/refresh-daily/route.js',
  'email-digest': 'app/api/admin/email-digest/route.js',
  'cost-report': 'app/api/admin/cost-report/route.js',
  'pre-digest-refresh': 'app/api/worker/pre-digest-refresh/route.js',
  'x-monitor': 'app/api/dashboard/x-monitor/route.js',
  'opportunity-signals-refresh': 'app/api/dashboard/opportunity-signals/refresh/route.js',
  'watchlist-pull': 'app/api/dashboard/watchlist-pull/route.js',
  'recipe-run': 'app/api/dashboard/recipe-run/route.js',
  'web-stats-config': 'app/api/dashboard/web-stats/config/route.js',
  'calendar-status': 'app/api/dashboard/calendar/status/route.js',
  'calendar-disconnect': 'app/api/dashboard/calendar/disconnect/route.js',
  'media': 'app/api/dashboard/media/route.js',
  'archive-inbox': 'app/api/dashboard/archive-inbox/route.js',
});

/**
 * How each route authenticates and resolves the client, so the runtime can forward correctly.
 *   bearer         Firebase ID token in `authorization` (the owner's, forwarded from the chat request)
 *   admin          route checks isAdminEmail / verifyAdminRequest
 *   pilotOwner     route also requires the allowlisted owner uid + pilot client (requirePilotOwner)
 *   impersonation  client = getEffectiveClientContext(request) => honours `?as=<clientId>` for admins
 *   clientFrom     'context' (server-resolved) | 'explicit' (body/query clientId, no impersonation)
 *   rateLimit      per-IP+client limiter; an in-process Request has no forwarded IP => shared 'unknown' bucket
 */
export const ROUTE_AUTH = Object.freeze({
  'quote-targets': { bearer: true, admin: true, pilotOwner: true, impersonation: true, clientFrom: 'context' },
  'social-posting': { bearer: true, admin: false, pilotOwner: 'per-action', impersonation: true, clientFrom: 'context', note: 'approve-draft/approve-and-schedule/reject-draft/reconcile-post and v2 rows require the pilot owner.' },
  'client-brain': { bearer: true, admin: false, pilotOwner: false, impersonation: true, clientFrom: 'context' },
  'client-brain-form': { bearer: true, admin: false, pilotOwner: false, impersonation: true, clientFrom: 'context' },
  'client-brain-generate': { bearer: true, admin: false, pilotOwner: false, impersonation: true, clientFrom: 'context' },
  'client-brain-approve': { bearer: true, admin: 'resync only', pilotOwner: false, impersonation: true, clientFrom: 'context' },
  'client-brain-sources': { bearer: true, admin: false, pilotOwner: false, impersonation: true, clientFrom: 'context' },
  'marketing-brief-config': { bearer: true, admin: false, pilotOwner: false, impersonation: true, clientFrom: 'context' },
  'marketing-brief-run': { bearer: true, admin: false, pilotOwner: false, impersonation: true, clientFrom: 'context', note: 'maxDuration 300 s; runs the whole pipeline in the request.' },
  'digest-config': { bearer: true, admin: true, pilotOwner: false, impersonation: false, clientFrom: 'explicit' },
  'refresh-daily': { bearer: true, admin: true, pilotOwner: false, impersonation: false, clientFrom: 'explicit' },
  'email-digest': { bearer: true, admin: true, pilotOwner: false, impersonation: false, clientFrom: 'explicit', note: 'preview/send-now forward to the legacy daily-digest route through an internal fetch (needs a reachable origin).' },
  'cost-report': { bearer: true, admin: true, pilotOwner: false, impersonation: false, clientFrom: 'explicit' },
  'pre-digest-refresh': { bearer: true, admin: true, pilotOwner: false, impersonation: false, clientFrom: 'explicit', note: 'accepts admin bearer OR CRON_SECRET; the agent uses the admin bearer. May run up to ~270 s.' },
  'x-monitor': { bearer: true, admin: true, pilotOwner: false, impersonation: true, clientFrom: 'context' },
  'opportunity-signals-refresh': { bearer: true, admin: false, pilotOwner: false, impersonation: true, clientFrom: 'context', rateLimit: true },
  'watchlist-pull': { bearer: true, admin: false, pilotOwner: false, impersonation: true, clientFrom: 'context', rateLimit: true },
  'recipe-run': { bearer: true, admin: false, pilotOwner: false, impersonation: true, clientFrom: 'context', rateLimit: true },
  'web-stats-config': { bearer: true, admin: false, pilotOwner: false, impersonation: true, clientFrom: 'context' },
  'calendar-status': { bearer: true, admin: false, pilotOwner: false, impersonation: true, clientFrom: 'context' },
  'calendar-disconnect': { bearer: true, admin: false, pilotOwner: false, impersonation: true, clientFrom: 'context' },
  'media': { bearer: true, admin: 'mutations and archive actions', pilotOwner: false, impersonation: true, clientFrom: 'context', note: 'action is a QUERY param (?action=...), body carries the payload.' },
  'archive-inbox': { bearer: true, admin: true, pilotOwner: false, impersonation: true, clientFrom: 'context', note: 'action is a QUERY param.' },
});

const ALL = [
  ...QUEUE_ACTIONS, ...CONTENT_ACTIONS, ...STRATEGY_ACTIONS,
  ...BRAIN_ACTIONS, ...SIGNALS_ACTIONS, ...DIGEST_ACTIONS, ...REFRESH_ACTIONS, ...REFRESH_DAILY_ACTIONS, ...XMONITOR_ACTIONS, ...MEDIA_ACTIONS, ...OTHER_ACTIONS,
];

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

export const ACTIONS = Object.freeze(ALL.map((a) => deepFreeze({ external: null, ...a })));

const BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

/** @returns {object|null} the frozen entry, or null. */
export function getAction(id) {
  return BY_ID.get(String(id || '').trim()) || null;
}

/** Compact one-line summary of an entry's args: names, required ones starred. */
export function summarizeArgs(args) {
  const props = Object.keys(args?.properties || {});
  const req = new Set(args?.required || []);
  return props.map((k) => (req.has(k) ? `${k}*` : k));
}

const tokens = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);

/**
 * Token search over id / title / description / group. Ranking: id token 4, title 3, group 2, description 1;
 * every query token must hit somewhere (AND), an exact id wins outright. Empty query lists by group order.
 * @returns {{id,title,tier,group,external,args:string[]}[]}
 */
export function findActions(query = '', { group = null, maxTier = 3, limit = 12 } = {}) {
  const qs = tokens(query);
  const pool = ACTIONS.filter((a) => a.tier <= maxTier && (!group || a.group === group));
  const exact = String(query || '').trim();
  const scored = [];
  for (const a of pool) {
    if (exact && a.id === exact) { scored.push({ a, score: 1e6 }); continue; }
    if (!qs.length) { scored.push({ a, score: 0 }); continue; }
    const idT = new Set(tokens(a.id));
    const titleT = new Set(tokens(a.title));
    const descT = new Set(tokens(a.description));
    const groupT = new Set(tokens(a.group));
    let score = 0;
    let all = true;
    for (const q of qs) {
      let hit = 0;
      const prefix = (set) => [...set].some((t) => t === q || (q.length >= 3 && t.startsWith(q)));
      if (prefix(idT)) hit += 4;
      if (prefix(titleT)) hit += 3;
      if (prefix(groupT)) hit += 2;
      if (prefix(descT)) hit += 1;
      if (!hit) { all = false; break; }
      score += hit;
    }
    if (all) scored.push({ a, score });
  }
  const groupOrder = (g) => GROUPS.indexOf(g);
  scored.sort((x, y) => y.score - x.score || groupOrder(x.a.group) - groupOrder(y.a.group) || x.a.id.localeCompare(y.a.id));
  return scored.slice(0, Math.max(1, limit)).map(({ a }) => ({
    id: a.id, title: a.title, tier: a.tier, group: a.group, external: a.external || null, args: summarizeArgs(a.args),
  }));
}

/** Structural validation of one entry; returns a list of problems (empty = valid). Used by the tests. */
export function validateAction(e) {
  const p = [];
  if (!e || typeof e !== 'object') return ['entry must be an object'];
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(e.id || '')) p.push('id must be dotted lowercase');
  if (!GROUPS.includes(e.group)) p.push(`group ${e.group} not allowed`);
  if (!e.title || e.title.length > 80) p.push('title required, <=80 chars');
  if (!e.description || e.description.length > 200) p.push(`description required, <=200 chars (${(e.description || '').length})`);
  if (!Object.hasOwn(ROUTE_MODULES, e.route)) p.push(`route ${e.route} not in ROUTE_MODULES`);
  if (!['GET', 'POST'].includes(e.method)) p.push('method must be GET or POST');
  if (e.method === 'GET' && e.action != null) p.push('GET entries have no body.action');
  if (!(e.action === null || (typeof e.action === 'string' && e.action))) p.push('action must be a string or null');
  if (e.args?.type !== 'object' || typeof e.args.properties !== 'object' || !Array.isArray(e.args.required)) p.push('args must be an object schema with properties + required');
  else for (const r of e.args.required) if (!(r in e.args.properties)) p.push(`required arg ${r} missing from properties`);
  if (!TIERS.includes(e.tier)) p.push('tier must be 0..3');
  if (e.external != null && !EXTERNALS.includes(e.external)) p.push(`external ${e.external} not allowed`);
  if (e.tier === 3 && !e.external) p.push('tier 3 needs external');
  if (e.tier === 3 && !e.cost) p.push('tier 3 needs cost text');
  if (e.tier === 0 && (e.snapshot || e.undo)) p.push('tier 0 has nothing to undo');
  if (e.tier === 0 && e.method === 'POST' && e.irreversible) p.push('tier 0 cannot be irreversible');
  if (e.viaRefreshPanel) {
    const ids = [...(e.refreshGroups || []), ...Object.values(e.refreshGroupsByArg?.map || {}).flat()];
    if (!ids.length) p.push('viaRefreshPanel needs refreshGroups or refreshGroupsByArg');
    for (const g of ids) if (!REFRESH_GROUP_IDS.includes(g)) p.push(`refresh group ${g} unknown`);
    if (e.refreshGroupsByArg && !(e.refreshGroupsByArg.arg in (e.args?.properties || {}))) p.push('refreshGroupsByArg.arg is not an arg');
  }
  if (e.undo && !(e.undo.actionId && e.undo.argsFrom && typeof e.undo.argsFrom === 'object')) p.push('undo needs actionId + argsFrom');
  for (const s of e.snapshot || []) {
    const okDoc = typeof s.collection === 'string' && typeof s.idArg === 'string';
    const okPath = typeof s.path === 'string' && /^[A-Za-z0-9_{}./-]+$/.test(s.path) && s.path.split('/').length % 2 === 0;
    if (!okDoc && !okPath) p.push(`bad snapshot spec ${JSON.stringify(s)}`);
    // Every {placeholder} / idArg must be clientId or an arg the entry declares (dotted: first segment).
    const refs = okDoc ? [s.idArg] : [...s.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
    for (const r of refs) {
      const head = r.split('.')[0];
      if (head !== 'clientId' && !(head in (e.args?.properties || {}))) p.push(`snapshot ref ${r} is not an arg`);
    }
  }
  return p;
}
