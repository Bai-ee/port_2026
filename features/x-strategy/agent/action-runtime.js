// action-runtime.js - runs entries of the action registry (action-registry.js) for the strategy chat agent.
// Pure + injected I/O: the route call (`invoke`), the audit log, the autonomy setting and the doc store are all
// injected, so every path is testable with memory stores (see action-stores.js).
//
// SAFETY MODEL
//   tier 0  read                      -> run now, return data
//   tier 1  reversible write          -> run now when autonomy.tier1 === 'auto' (default), else a confirm card.
//                                        Snapshot before + audit row; the result carries an `undoId`.
//   tier 2  destructive               -> always a confirm card (danger tone)
//   tier 3  external / spend          -> always a card; typed confirm ("post 3") when the entry publishes to X.
//           One exception: queue.post.schedule-approved (trusted:'schedule-approved') runs while the owner has trusted scheduling on.
//                                        (floor, can never be lowered) or the owner set autonomy.tier3 = 'typed'.
// The model never writes the card payload: it is rebuilt here from the registry entry (warning, count, confirmText).
// Calls go to the SAME route handlers the dashboard buttons use, with the owner's own authorization header
// (and `?as=` when impersonating), so every auth / pilot / admin check still applies.
//
// NO AUTHORIZATION (MCP chat_send: the OAuth identity carries no Firebase bearer): nothing is ever invoked. Tier 0
// reads answer "use the dedicated read tools", and every write (even tier 1 on autonomy 'auto') becomes a confirm
// card that the owner confirms in the dashboard, where the bearer exists. Undo is refused for the same reason.

import { randomUUID } from 'node:crypto';
import { ROUTE_MODULES as DEFAULT_ROUTE_MODULES, ROUTE_FILES, ROUTE_AUTH, getAction as defaultGetAction, findActions as defaultFindActions } from './action-registry.js';
import { REFRESH_GROUP_IDS } from '../contracts.js';
import { REFRESH_GROUPS, estimateFor } from '../../../components/dashboard/marketing/refresh-groups.js';

export const ACTION_ITEMS_MAX = 50;
export const AUTO_BATCH_MAX = 10; // a tier-1 batch larger than this asks for a card even when autonomy is 'auto'
export const ACTION_LOG_LIMIT = 50;
export const ACTION_TOOL_NAMES = Object.freeze(['find_actions', 'run_action', 'undo_action', 'get_action_log']);
const RESERVED_ARGS = Object.freeze(['action', 'clientId', 'as']);
const SNAPSHOT_MAX_CHARS = 150000;
const RESULT_MAX_CHARS = 1500;
const READ_MAX_CHARS = 8000;
const TIER3_VERBS = Object.freeze({ x: 'post', email: 'send', arweave: 'spend', paid: 'spend' });

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const iso = (ms) => new Date(ms).toISOString();
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (isPlain(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v === undefined ? null : v);
}
export const sameState = (a, b) => stable(a ?? null) === stable(b ?? null);

/** Bound a value to something small and Firestore-safe (no undefined). */
export function compactJson(v, max = RESULT_MAX_CHARS) {
  let s;
  try { s = JSON.stringify(v === undefined ? null : v); } catch { return { unserializable: true }; }
  if (s.length <= max) return JSON.parse(s);
  return { truncated: true, chars: s.length, preview: s.slice(0, max) };
}

// ---- autonomy ------------------------------------------------------------------------------------------------

export const DEFAULT_AUTONOMY = Object.freeze({ tier1: 'auto', tier2: 'confirm', tier3: 'confirm' });

/** Stored client_configs.agentAutonomy -> a full, valid setting. Anything unknown falls back to the safe default. */
// Trusted scheduling (owner opt-in, default off): the agent may schedule a post the OWNER already approved and that is
// unchanged since, at least minLeadMinutes ahead, at most dailyCap a day, without a card. The server re-checks all of it
// (social-posting 'trusted-schedule'). Every other X write keeps the typed floor.
export const TRUSTED_SCHEDULE_DEFAULTS = Object.freeze({ enabled: false, minLeadMinutes: 10, dailyCap: 3 });
const clampInt = (v, lo, hi, dflt) => (Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
export function normalizeTrustedSchedule(raw) {
  const r = isPlain(raw) ? raw : {};
  return {
    enabled: r.enabled === true,
    minLeadMinutes: clampInt(r.minLeadMinutes, 10, 1440, TRUSTED_SCHEDULE_DEFAULTS.minLeadMinutes),
    dailyCap: clampInt(r.dailyCap, 1, 10, TRUSTED_SCHEDULE_DEFAULTS.dailyCap),
  };
}

export function normalizeAutonomy(raw) {
  const r = isPlain(raw) ? raw : {};
  return {
    tier1: r.tier1 === 'confirm' ? 'confirm' : 'auto',
    tier2: 'confirm',
    tier3: r.tier3 === 'typed' ? 'typed' : 'confirm',
    trustedSchedule: normalizeTrustedSchedule(r.trustedSchedule),
  };
}

/** @returns {'run'|'confirm'|'typed'} what a run_action call for this entry needs, given the owner's autonomy. */
export function resolveGate(entry, autonomy, { itemCount = 1 } = {}) {
  const a = normalizeAutonomy(autonomy);
  if (entry.tier === 0) return 'run';
  if (entry.tier === 1) return a.tier1 === 'auto' && itemCount <= AUTO_BATCH_MAX ? 'run' : 'confirm';
  if (entry.tier === 2) return 'confirm';
  // The one exception to the X floor: scheduling an owner-approved post, only while the owner has trusted scheduling on.
  if (entry.trusted === 'schedule-approved' && a.trustedSchedule.enabled && itemCount <= a.trustedSchedule.dailyCap) return 'run';
  return entry.external === 'x' || a.tier3 === 'typed' ? 'typed' : 'confirm'; // X publishing can never go below typed
}

// ---- args ----------------------------------------------------------------------------------------------------

const TYPE_OK = {
  string: (v) => typeof v === 'string',
  integer: (v) => Number.isInteger(v),
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  boolean: (v) => typeof v === 'boolean',
  array: (v) => Array.isArray(v),
  object: (v) => isPlain(v),
};

/** JSON-schema-subset check of the agent's args against entry.args. Reserved body keys are always refused.
 *  Unknown keys are DROPPED (not refused) when the schema is closed (additionalProperties:false) and reported in `dropped`. */
export function validateActionArgs(entry, args) {
  const errors = [];
  const dropped = [];
  if (!isPlain(args)) return { ok: false, errors: ['args must be an object'] };
  const schema = isPlain(entry?.args) ? entry.args : { properties: {}, required: [] };
  const props = isPlain(schema.properties) ? schema.properties : {};
  for (const k of Object.keys(args)) {
    if (RESERVED_ARGS.includes(k)) errors.push(`${k} is set by the system and cannot be passed`);
    else if (!(k in props) && schema.additionalProperties !== true && (Object.keys(props).length || schema.additionalProperties === false)) dropped.push(k);
  }
  for (const k of schema.required || []) if (args[k] === undefined || args[k] === null || args[k] === '') errors.push(`${k} is required`);
  for (const [k, def] of Object.entries(props)) {
    const v = args[k];
    if (v === undefined) continue;
    if (def?.type && TYPE_OK[def.type] && !TYPE_OK[def.type](v)) errors.push(`${k} must be ${def.type}`);
    else if (Array.isArray(def?.enum) && !def.enum.includes(v)) errors.push(`${k} must be one of ${def.enum.join(', ')}`);
  }
  if (errors.length) return { ok: false, errors };
  const kept = clone(args);
  for (const k of dropped) delete kept[k];
  return { ok: true, errors: [], args: kept, dropped };
}

/** Compact "name:type*" summary of an entry's arguments for find_actions (* = required). */
export function summarizeArgs(entry) {
  const props = isPlain(entry?.args?.properties) ? entry.args.properties : {};
  const req = new Set(entry?.args?.required || []);
  return Object.fromEntries(Object.entries(props).map(([k, d]) => [k, `${d?.type || 'any'}${Array.isArray(d?.enum) ? `(${d.enum.join('|')})` : ''}${req.has(k) ? '*' : ''}`]));
}

// ---- refusals + Refresh-panel routing -------------------------------------------------------------------------

/** Route actions the agent may never run, whatever the catalog says: it must not change its own permissions,
 *  decide its own proposals, call itself, or undo outside the audited undo_action tool. */
export const FORBIDDEN_ROUTE_ACTIONS = Object.freeze(['strategy-autonomy-save', 'strategy-proposal-decide', 'strategy-chat-send', 'strategy-action-undo']);

/** @returns {string|null} why the agent may not run this entry at all. */
export function refusalFor(entry) {
  const act = entry?.action || entry?.query?.action || '';
  if (/autonomy/i.test(act) && /save|set|update|write/i.test(act)) return 'The agent cannot change its own permissions; only the owner can (Autonomy settings).';
  if (/autonomy/i.test(String(entry?.id)) && entry?.tier > 0) return 'The agent cannot change its own permissions; only the owner can (Autonomy settings).';
  if (Object.keys(entry?.args?.properties || {}).some((k) => /^(agentAutonomy|autonomy)$/i.test(k)) && entry?.tier > 0) return 'The agent cannot change its own permissions; only the owner can (Autonomy settings).';
  if (FORBIDDEN_ROUTE_ACTIONS.includes(act)) return 'The agent cannot run this action (it would approve, undo or call itself).';
  return null;
}

/** Refresh group ids an entry maps to for these args; null = the entry is not a Refresh-panel entry. [] = no mapping. */
export function refreshGroupsFor(entry, args) {
  if (!entry?.viaRefreshPanel) return null;
  if (Array.isArray(entry.refreshGroups)) return entry.refreshGroups.filter((g) => REFRESH_GROUP_IDS.includes(g));
  const by = entry.refreshGroupsByArg;
  const ids = by ? by.map?.[args?.[by.arg]] : null;
  return Array.isArray(ids) ? ids.filter((g) => REFRESH_GROUP_IDS.includes(g)) : [];
}

function refreshProposal(entry, groups) {
  const estimate = groups.map((id) => {
    const g = REFRESH_GROUPS.find((x) => x.id === id);
    return { id, label: g?.label ?? id, paid: g?.paid === true, text: String(estimateFor(id, {})?.text ?? g?.cost ?? '').slice(0, 200) };
  });
  const reason = `${entry.title}: runs in the dashboard Refresh panel (too long for chat).`.slice(0, 300);
  return {
    kind: 'refresh', payload: { groups, reason, estimate },
    summary: `Refresh: ${estimate.map((e) => e.label).join(', ')}`.slice(0, 200), rationale: reason, evidence: [],
  };
}

// ---- card payload --------------------------------------------------------------------------------------------

export function confirmTextFor(entry, count) {
  if (entry.tier !== 3) return undefined;
  return `${TIER3_VERBS[entry.external] || 'run'} ${count}`;
}

/** Plain-language lines the confirm card shows. Built here, never by the model. */
export function warningLinesFor(entry, count) {
  const n = plural(count, 'item');
  const lines = [];
  if (entry.tier === 3) {
    if (entry.external === 'x') lines.push(`This publishes or schedules ${n} on the live X account.`);
    else if (entry.external === 'email') lines.push(`This sends email for ${n}.`);
    else lines.push(`This runs ${n} that spend money or call an outside service.`);
    if (entry.cost) lines.push(`Cost: ${entry.cost}`);
  } else if (entry.tier === 2) {
    lines.push(`This changes or removes ${n}: ${entry.title}.`);
  } else {
    lines.push(`This changes ${n}: ${entry.title}.`);
  }
  if (entry.irreversible) lines.push("This can't be undone.");
  else if (entry.snapshot?.length || entry.undo) lines.push('You can undo it afterwards from the action log.');
  else lines.push('There is no automatic undo for this.');
  return lines;
}

/**
 * Validate + rebuild an `action` proposal payload. Used by validateProposal and by run_action itself, so a card
 * can only ever carry what the registry says about its action. `typed` is forced for X publishing.
 */
export function normalizeActionPayload(raw, { registry } = {}) {
  const getAction = registry?.getAction || defaultGetAction;
  const errors = [];
  const p = isPlain(raw) ? raw : {};
  const entry = typeof p.actionId === 'string' ? getAction(p.actionId.trim()) : null;
  if (!entry) return { ok: false, errors: [`unknown actionId ${String(p.actionId).slice(0, 80)}; use find_actions`] };
  if (entry.tier === 0) return { ok: false, errors: ['read actions run directly and never need a card'] };
  const refused = refusalFor(entry);
  if (refused) return { ok: false, errors: [refused] };
  if (entry.viaRefreshPanel) return { ok: false, errors: ['this action runs from the Refresh panel, not as an action card'] };
  const list = Array.isArray(p.items) ? p.items : isPlain(p.args) ? [p.args] : p.items === undefined && p.args === undefined ? [{}] : null;
  if (!list || !list.length) return { ok: false, errors: ['items must be a non-empty array of args'] };
  if (list.length > ACTION_ITEMS_MAX) return { ok: false, errors: [`at most ${ACTION_ITEMS_MAX} items per action`] };
  const items = [];
  list.forEach((a, i) => {
    const v = validateActionArgs(entry, a ?? {});
    if (!v.ok) errors.push(`item ${i + 1}: ${v.errors.join('; ')}`); else items.push(v.args);
  });
  if (errors.length) return { ok: false, errors: errors.slice(0, 6) };
  const count = items.length;
  const warningLines = warningLinesFor(entry, count);
  const typed = entry.tier === 3 && (entry.external === 'x' || p.typed === true);
  return {
    ok: true, errors: [], entry,
    payload: {
      actionId: entry.id, items, tier: entry.tier, title: entry.title, warning: warningLines.join(' '), warningLines,
      affected: count, sample: items.slice(0, 5).map((a) => compactJson(a, 160)),
      irreversible: entry.irreversible === true, ...(entry.cost ? { cost: entry.cost } : {}), ...(entry.external ? { external: entry.external } : {}),
      typed, ...(entry.tier === 3 ? { confirmText: confirmTextFor(entry, count) } : {}),
    },
  };
}

/** The text the owner must type to confirm a stored `action` payload, or null. Recomputed from the registry (X is always typed). */
export function requiredTypedText(payload, { registry } = {}) {
  const entry = (registry?.getAction || defaultGetAction)(payload?.actionId);
  if (!entry) return payload?.typed === true && typeof payload.confirmText === 'string' ? payload.confirmText : null; // unknown entry: honour the card
  if (entry.tier !== 3) return null;
  if (!(entry.external === 'x' || payload?.typed === true)) return null;
  return confirmTextFor(entry, Array.isArray(payload.items) ? payload.items.length : 1);
}

// ---- invoking a route in-process ------------------------------------------------------------------------------

/**
 * Call the route handler the dashboard button calls, in-process. `ctx` = {clientId, authorization, impersonating}.
 * Refuses to run without the owner's authorization header (never an anonymous call).
 * @returns {Promise<{ok:boolean,status:number,json:any}>}
 */
export async function invokeAction(entry, args, ctx, { routeModules = DEFAULT_ROUTE_MODULES } = {}) {
  if (!ctx?.authorization) throw new Error('no authorization available for this action');
  const refused = refusalFor(entry);
  if (refused) throw new Error(refused);
  if (entry.viaRefreshPanel) throw new Error('this action runs from the Refresh panel, not in chat');
  const load = routeModules?.[entry.route];
  if (typeof load !== 'function') throw new Error(`no route module for ${entry.route}`);
  const mod = await load();
  const handler = mod?.[entry.method];
  if (typeof handler !== 'function') throw new Error(`route ${entry.route} has no ${entry.method} handler`);
  const auth = ROUTE_AUTH[entry.route] || {};
  // body.action for POST routes with an action switch; media/archive-inbox/client-brain take it from the query (entry.query.action).
  const qs = new URLSearchParams(entry.query || {});
  // Routes that resolve the client from body/query (verifyAdminRequest) never honour ?as=; the rest do while impersonating.
  const explicit = auth.clientFrom === 'explicit';
  if (!explicit && ctx.impersonating && ctx.clientId) qs.set('as', ctx.clientId);
  const headers = { authorization: ctx.authorization, 'content-type': 'application/json' };
  const rel = (ROUTE_FILES[entry.route] || `app/api/dashboard/${entry.route}/route.js`).replace(/^app/, '').replace(/\/route\.js$/, '');
  let url = `${ctx.origin || 'http://internal'}${rel}`;
  let init;
  if (entry.method === 'GET') {
    for (const [k, v] of Object.entries(args || {})) qs.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    for (const [k, v] of Object.entries(entry.fixed || {})) qs.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    if (entry.action && !qs.has('action')) qs.set('action', entry.action);
    if (explicit && ctx.clientId) qs.set('clientId', ctx.clientId);
    init = { method: 'GET', headers };
  } else {
    // Order: agent args, then `fixed` (the agent can never override it), then the system fields.
    init = { method: entry.method, headers, body: JSON.stringify({ ...(args || {}), ...(entry.fixed || {}), ...(entry.action ? { action: entry.action } : {}), clientId: ctx.clientId }) };
  }
  const q = qs.toString();
  if (q) url += `?${q}`;
  const res = await handler(new Request(url, init));
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  const ok = res.status < 400 && json?.ok !== false && !(isPlain(json) && json.error);
  return { ok, status: res.status, json };
}

// ---- the runtime ---------------------------------------------------------------------------------------------

const getPath = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const setPath = (obj, dotted, value) => {
  const keys = dotted.split('.');
  let o = obj;
  keys.slice(0, -1).forEach((k) => { if (!isPlain(o[k])) o[k] = {}; o = o[k]; });
  if (value === undefined) delete o[keys.at(-1)]; else o[keys.at(-1)] = value;
};

/**
 * @param {{audit:object, autonomy:object, docs:object, invoke?:Function, registry?:object, clock?:()=>number, idGen?:()=>string}} deps
 *   audit {append,get,update,recent}  autonomy {get,save}  docs {get(path),put(path,data),remove(path)}
 */
// social_posts states that publish (or are mid-publish) without another owner step.
const ARMED_POST_STATUSES = new Set(['scheduled', 'queued', 'manual', 'posting', 'awaiting_approval']);
const isArmedPost = (path, before) => String(path).startsWith('social_posts/') && !!before
  && (ARMED_POST_STATUSES.has(before.status) || !!before.scheduledAt);

export function createActionRuntime({ audit, autonomy, docs, invoke, registry, clock = Date.now, idGen = () => randomUUID().replace(/-/g, '').slice(0, 20) } = {}) {
  const reg = { getAction: defaultGetAction, findActions: defaultFindActions, ...(registry || {}) };
  const call = invoke || ((entry, args, ctx) => invokeAction(entry, args, ctx, { routeModules: reg.ROUTE_MODULES || DEFAULT_ROUTE_MODULES }));
  const getAutonomy = async (clientId) => normalizeAutonomy(await autonomy.get(clientId));

  /** Doc refs an entry snapshots for these args: [{path, field?}] or null when it cannot be resolved. */
  function refsFor(entry, args, clientId) {
    const refs = [];
    for (const s of entry.snapshot || []) {
      if (s.collection) {
        const id = args?.[s.idArg];
        if (typeof id !== 'string' || !id) return null;
        refs.push({ path: `${s.collection}/${id}`, ownerChecked: true });
      } else if (s.path) {
        let unresolved = false;
        const path = s.path.replace(/\{([^}]+)\}/g, (_, k) => {
          if (k === 'clientId') return clientId;
          const v = getPath(args, k);
          if (typeof v !== 'string' && typeof v !== 'number') { unresolved = true; return ''; }
          return String(v);
        });
        if (unresolved || path.includes('//')) return null;
        refs.push({ path, ...(s.field ? { field: s.field } : {}) });
      }
    }
    return refs;
  }
  const readRef = async (ref) => {
    const doc = await docs.get(ref.path);
    if (doc === null || doc === undefined) return null;
    return ref.field ? (getPath(doc, ref.field) ?? null) : doc;
  };

  async function snapshotBefore(entry, args, ctx) {
    if (!entry.snapshot?.length) return { snaps: [], undoable: !!entry.undo };
    const refs = refsFor(entry, args, ctx.clientId);
    if (!refs) return { snaps: [], undoable: !!entry.undo };
    const snaps = [];
    for (const ref of refs) {
      const before = await readRef(ref);
      const own = ref.ownerChecked && isPlain(before) && before.clientId && before.clientId !== ctx.clientId;
      if (own) return { snaps: [], undoable: false, foreign: true };
      snaps.push({ path: ref.path, ...(ref.field ? { field: ref.field } : {}), before: clone(before) });
    }
    const size = JSON.stringify(snaps).length;
    if (size > SNAPSHOT_MAX_CHARS) return { snaps: [], undoable: !!entry.undo, tooLarge: true };
    return { snaps, undoable: true };
  }

  /** One item: snapshot -> invoke -> post-state. Returns the audit item. */
  async function runItem(entry, args, ctx) {
    const snap = await snapshotBefore(entry, args, ctx);
    let out;
    try { out = await call(entry, args, ctx); } catch (err) { out = { ok: false, status: 0, json: { error: String(err?.message || err).slice(0, 200) } }; }
    const item = { args: compactJson(args, 800), status: out.ok ? 'ok' : 'failed', httpStatus: out.status, result: compactJson(out.json, RESULT_MAX_CHARS) };
    if (out.ok && snap.undoable && snap.snaps.length) {
      item.snapshots = [];
      for (const s of snap.snaps) item.snapshots.push({ ...s, after: clone(await readRef(s)) });
    }
    item.undoable = out.ok && snap.undoable && (!!entry.undo || !!item.snapshots?.length);
    if (out.ok && entry.undo) item.undoArgs = nativeUndoArgs(entry, args, out.json);
    return { item, raw: out };
  }

  function nativeUndoArgs(entry, args, result) {
    const from = entry.undo?.argsFrom || {};
    const out = {};
    for (const [k, src] of Object.entries(from)) {
      if (typeof src === 'string' && src.startsWith('args.')) out[k] = getPath(args, src.slice(5));
      else if (typeof src === 'string' && src.startsWith('result.')) out[k] = getPath(result, src.slice(7));
      else out[k] = src;
    }
    return compactJson(out, 800);
  }

  /** Run already-validated items, write ONE audit row. */
  async function execute(entry, items, ctx, { via = 'auto', proposalId = null } = {}) {
    const results = [];
    const rawResults = [];
    for (const args of items) { const r = await runItem(entry, args, ctx); results.push(r.item); rawResults.push(r.raw); }
    const done = results.filter((r) => r.status === 'ok').length;
    const status = done === results.length ? 'ok' : done ? 'partial' : 'failed';
    const undoable = done > 0 && results.every((r) => r.status !== 'ok' || r.undoable);
    const id = idGen();
    const row = {
      at: iso(clock()), by: ctx.by || 'admin', actionId: entry.id, tier: entry.tier, via, ...(proposalId ? { proposalId } : {}),
      status, undoable, items: results,
      ...(results.length === 1 ? { args: results[0].args, result: results[0].result } : {}),
    };
    await audit.append(ctx.clientId, id, row);
    return { id, status, undoable, results, rawResults, done };
  }

  const shaped = (exec, entry) => ({
    ok: exec.status !== 'failed',
    message: exec.status === 'ok' ? `${entry.title}: done${exec.results.length > 1 ? ` (${exec.done} of ${exec.results.length})` : ''}.${exec.undoable ? ' You can undo it.' : ''}`
      : exec.status === 'partial' ? `${entry.title}: ${exec.done} of ${exec.results.length} done; the rest failed.` : `${entry.title}: failed.`, status: exec.status, actionId: entry.id, done: exec.done, of: exec.results.length,
    ...(exec.undoable ? { undoId: exec.id } : { undoNote: 'not undoable' }),
    results: exec.results.map((r) => ({ status: r.status, result: compactJson(r.result, 500) })).slice(0, 10),
  });

  return {
    getAutonomy,
    saveAutonomy: async (clientId, raw) => { const v = normalizeAutonomy(raw); await autonomy.save(clientId, v); return v; },

    find(query, { group } = {}) {
      const rows = reg.findActions(query, { group, limit: 8 }) || [];
      return rows.map((r) => {
        const e = reg.getAction(r.id);
        return { ...r, ...(e ? { args: summarizeArgs(e), ...(e.external ? { external: e.external } : {}), ...(e.cost ? { cost: e.cost } : {}) } : {}) };
      });
    },

    /**
     * run_action. Returns {kind:'result', result} | {kind:'proposal', proposal, result} | {kind:'error', error}.
     * A proposal is returned (never persisted here) for confirm / typed gates.
     */
    async run(ctx, { actionId, args, items } = {}) {
      const entry = typeof actionId === 'string' ? reg.getAction(actionId.trim()) : null;
      if (!entry) return { kind: 'error', error: `unknown actionId ${String(actionId).slice(0, 80)}; call find_actions first` };
      const refused = refusalFor(entry);
      if (refused) return { kind: 'error', error: refused };
      const list = Array.isArray(items) ? items : [args ?? {}];
      if (!list.length || list.length > ACTION_ITEMS_MAX) return { kind: 'error', error: `items must hold 1-${ACTION_ITEMS_MAX} entries` };
      const checked = list.map((a) => validateActionArgs(entry, a ?? {}));
      const bad = checked.map((c, i) => (c.ok ? null : `item ${i + 1}: ${c.errors.join('; ')}`)).filter(Boolean);
      if (bad.length) return { kind: 'error', error: bad.slice(0, 5).join(' | ') };
      const clean = checked.map((c) => c.args);
      const dropped = [...new Set(checked.flatMap((c) => c.dropped || []))];
      const withDropped = (res) => (dropped.length ? { ...res, droppedArgs: dropped, droppedNote: `Ignored unknown arguments: ${dropped.join(', ')}.` } : res);

      if (entry.viaRefreshPanel) {
        // Long-running (270-300 s) group: never invoked from the chat request. The owner's confirm hands the group ids to the Refresh panel.
        const groups = [...new Set(clean.flatMap((a) => refreshGroupsFor(entry, a) || []))];
        if (!groups.length) return { kind: 'error', error: `${entry.title} cannot run in chat with these arguments; ask the owner to use the dashboard Refresh panel.` };
        return {
          kind: 'proposal', proposal: refreshProposal(entry, groups),
          result: withDropped({ ok: true, needsConfirmation: true, viaRefreshPanel: true, groups, note: 'Nothing has run. A Refresh card is up; confirming it starts the groups in the dashboard Refresh panel (the owner sees the cost there). Tell the owner to confirm it.' }),
        };
      }

      const noAuth = !ctx?.authorization;
      if (entry.tier === 0 && noAuth) {
        return { kind: 'error', error: `${entry.title} is a dashboard read that cannot run from this connection. Use the dedicated strategy read tools (get_queue, get_results, get_today_run, ...), or ask the owner to run it in the dashboard Strategy chat.` };
      }
      if (entry.tier === 0) {
        const rows = [];
        for (const a of clean) {
          let out;
          try { out = await call(entry, a, ctx); } catch (err) { return { kind: 'error', error: `read failed: ${String(err?.message || err).slice(0, 160)}` }; }
          if (!out.ok) return { kind: 'error', error: `read failed (${out.status}): ${JSON.stringify(out.json?.error ?? out.json ?? null).slice(0, 200)}` };
          rows.push(out.json);
        }
        return { kind: 'result', result: withDropped({ ok: true, actionId: entry.id, data: compactJson(clean.length === 1 ? rows[0] : rows, READ_MAX_CHARS) }) };
      }

      let gate = resolveGate(entry, await getAutonomy(ctx.clientId), { itemCount: clean.length });
      if (gate === 'run' && noAuth) gate = 'confirm'; // cannot invoke without the owner's authorization: always a card
      if (gate === 'run') {
        return { kind: 'result', result: withDropped(shaped(await execute(entry, clean, ctx, { via: 'auto' }), entry)) };
      }
      const norm = normalizeActionPayload({ actionId: entry.id, items: clean, typed: gate === 'typed' }, { registry: reg });
      if (!norm.ok) return { kind: 'error', error: norm.errors.join('; ') };
      const p = norm.payload;
      return {
        kind: 'proposal',
        proposal: {
          kind: 'action', payload: p,
          summary: `${entry.title}${clean.length > 1 ? ` (${clean.length})` : ''}`.slice(0, 200),
          rationale: p.warning.slice(0, 800), evidence: [],
        },
        result: withDropped({
          ok: true, needsConfirmation: true, tier: p.tier, typedConfirm: p.typed, warning: p.warning,
          note: 'Nothing has run. A confirmation card is up for the owner. Tell them what it will change and that they must confirm it.',
        }),
      };
    },

    /** The confirm-click executor: re-validates, then snapshots, invokes and audits. Typed text is checked by the decide path. */
    async executeApproved(ctx, payload, { proposalId } = {}) {
      const norm = normalizeActionPayload(payload, { registry: reg });
      if (!norm.ok) return { ok: false, error: norm.errors.join('; ') };
      const exec = await execute(norm.entry, norm.payload.items, ctx, { via: 'confirm', proposalId });
      return { ...shaped(exec, norm.entry), ...(exec.status === 'failed' ? { error: exec.results[0]?.result?.error ? String(exec.results[0].result.error).slice(0, 200) : 'the action failed' } : {}) };
    },

    /** undo_action: native undo when the entry has one, else snapshot restore only if nothing changed since. */
    async undo(ctx, undoId) {
      if (!ctx?.authorization) return { ok: false, error: 'Undo needs the dashboard session. Ask the owner to undo it from the dashboard Strategy chat (or the action log).' };
      const row = typeof undoId === 'string' && undoId ? await audit.get(ctx.clientId, undoId) : null;
      if (!row) return { ok: false, error: 'No such action in the log.' };
      if (row.undoneAt) return { ok: false, error: `Already undone at ${row.undoneAt}.` };
      if (!row.undoable) return { ok: false, error: 'This action cannot be undone automatically.' };
      const entry = reg.getAction(row.actionId);
      const done = row.items.filter((i) => i.status === 'ok');

      if (entry?.undo) {
        const back = reg.getAction(entry.undo.actionId);
        if (!back || back.tier > 1) return { ok: false, error: 'The undo path for this action is not available.' };
        const exec = await execute(back, done.map((i) => i.undoArgs || {}), ctx, { via: 'undo' });
        if (exec.status === 'failed') return { ok: false, error: 'The undo call failed; nothing was reverted.' };
        await audit.update(ctx.clientId, undoId, { undoneAt: iso(clock()), undoneBy: ctx.by || 'admin' });
        return { ok: true, undone: exec.done };
      }

      const snaps = done.flatMap((i) => i.snapshots || []).reverse();
      if (!snaps.length) return { ok: false, error: 'No snapshot was kept for this action.' };
      // A raw restore never touches a publishing post: restoring a scheduled snapshot would skip the owner's typed
      // schedule confirm and the slot ledger/collision checks (commitPostTransition); restoring over a scheduled row
      // (undo of approve-and-schedule) would leave its ledger slot reserved. Either way: use unschedule / schedule.
      const armed = snaps.find((s) => !s.field && (isArmedPost(s.path, s.before) || isArmedPost(s.path, s.after)));
      if (armed) return { ok: false, error: `Not undone: ${armed.path} is or was on the publishing schedule, so a raw restore would bypass the schedule checks. Unschedule or schedule it instead (scheduling asks for your confirmation).` };
      for (const s of snaps) { // verify EVERY doc first: all or nothing
        const current = await readRef(s);
        if (!sameState(current, s.after)) return { ok: false, error: `Not undone: ${s.path}${s.field ? ` (${s.field})` : ''} changed since the action ran, so restoring it would overwrite newer edits.` };
      }
      for (const s of snaps) {
        if (s.field) {
          const doc = clone((await docs.get(s.path)) ?? {});
          setPath(doc, s.field, s.before === null ? undefined : clone(s.before));
          await docs.put(s.path, doc);
        } else if (s.before === null) await docs.remove(s.path);
        else await docs.put(s.path, clone(s.before));
      }
      await audit.update(ctx.clientId, undoId, { undoneAt: iso(clock()), undoneBy: ctx.by || 'admin' });
      return { ok: true, restored: snaps.length };
    },

    async log(ctx, limit = ACTION_LOG_LIMIT) {
      const rows = await audit.recent(ctx.clientId, Math.min(Math.max(Number(limit) || ACTION_LOG_LIMIT, 1), ACTION_LOG_LIMIT));
      return rows.map((r) => ({
        id: r.id, undoId: r.id, title: reg.getAction(r.actionId)?.title ?? r.actionId, at: r.at, by: r.by, actionId: r.actionId, tier: r.tier, status: r.status, via: r.via ?? null,
        count: Array.isArray(r.items) ? r.items.length : 1, undoable: !!r.undoable && !r.undoneAt, undoneAt: r.undoneAt ?? null,
        ...(r.args ? { args: r.args } : {}),
      }));
    },
  };
}

// ---- agent tool schemas + dispatcher -------------------------------------------------------------------------

export const ACTION_TOOLS = Object.freeze([
  {
    name: 'find_actions',
    description: 'Search the registry of everything the dashboard can do (queue, calendar, content, buckets, strategy, brain, signals, digest, refresh, X Monitor, media, NAS, clients). Call this FIRST whenever the owner asks for something you have no dedicated tool for. Returns id, title, tier (0 read, 1 reversible write, 2 destructive, 3 external or spend) and the argument names/types (* = required). Read-only.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'What to do, in plain words' }, group: { type: 'string', description: 'Optional group filter' } }, required: ['query'] },
  },
  {
    name: 'run_action',
    description: 'Run one registry action (or up to 50 of the same action via items). Tier 0 returns data. Tier 1 runs now and returns an undoId. Tier 2 and 3 never run from here: they put up a confirmation card (typed confirmation for X publishing) and nothing changes until the owner confirms. Exception: queue.post.schedule-approved runs directly when the owner turned on trusted scheduling (approved, unchanged posts only, with a cancel window); tell the owner what you scheduled and when. Never claim a carded action happened.',
    input_schema: {
      type: 'object',
      properties: {
        actionId: { type: 'string', description: 'Id from find_actions' },
        args: { type: 'object', description: 'Arguments for one run' },
        items: { type: 'array', maxItems: ACTION_ITEMS_MAX, items: { type: 'object' }, description: 'Args for several runs of the same action (one card / one log entry)' },
      },
      required: ['actionId'],
    },
  },
  {
    name: 'undo_action',
    description: 'Undo a tier-1 action by its undoId (from run_action or get_action_log). Refuses when the data changed since the action ran.',
    input_schema: { type: 'object', properties: { undoId: { type: 'string' } }, required: ['undoId'] },
  },
  {
    name: 'get_action_log',
    description: 'The most recent actions run through run_action (who, what, status, whether still undoable). Read-only.',
    input_schema: { type: 'object', properties: {} },
  },
]);

/**
 * Dispatch one action tool. `deps.actions` = {runtime, ctx} built per request (absent => not available).
 * @returns {Promise<{result:any, isError?:boolean, proposal?:object}>}
 */
export async function runActionTool(name, input, deps) {
  const a = deps?.actions;
  if (!a?.runtime || !a?.ctx) return { result: { error: 'actions are not available here' }, isError: true };
  const { runtime, ctx } = a;
  try {
    switch (name) {
      case 'find_actions': return { result: { actions: runtime.find(String(input?.query ?? ''), { group: typeof input?.group === 'string' ? input.group : undefined }) } };
      case 'run_action': {
        const out = await runtime.run(ctx, { actionId: input?.actionId, args: input?.args, items: input?.items });
        if (out.kind === 'error') return { result: { ok: false, error: out.error }, isError: true };
        return { result: out.result, ...(out.kind === 'proposal' ? { proposal: out.proposal } : {}) };
      }
      case 'undo_action': {
        const out = await runtime.undo(ctx, input?.undoId);
        return { result: out, isError: out.ok === false };
      }
      case 'get_action_log': return { result: { actions: await runtime.log(ctx) } };
      default: return { result: { error: `unknown action tool ${name}` }, isError: true };
    }
  } catch (err) {
    return { result: { ok: false, error: String(err?.message || err).slice(0, 200) }, isError: true };
  }
}
