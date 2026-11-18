// settings.js - get_settings / set_setting / undo_setting logic for MCP-OPS. Pure: every effect is injected.
//   ops.settings = {
//     digest:        { get(clientId), save(clientId, patch) }            getDigestConfig / saveDigestConfig (features/intelligence/_digest-config.js)
//     refreshDaily:  { read(clientId), save(clientId, input, {by}) }     readRefreshDaily / saveRefreshDaily (_refresh-daily.js)
//     dataSources:   { read(clientId), save(clientId, patch) }           features/x-strategy/data-sources.js (what x-data-sources-save calls)
//     modules:       { read(clientId) -> {cardId: bool}, write(clientId, cardId, enabled) }   nested client_configs.moduleConfig (features/scout-intake/module-toggle.mjs)
//     trustedRefresh?: (clientId) -> {enabled, dailyCapUsd}              read-only display
//   }
//   ops.stores = { changes, locks }   ops.sleep? ops.newId?
//
// RULE: the reduce-risk direction runs directly. Increase-risk is `confirm:true` when it only changes emailed
// content, and BLOCKED (dashboard only) when it spends money, sends email or starts a standing daily job.
// The rule is applied to the VALUE BEING WRITTEN, so undo gets the same gate for free.
//
// Writer semantics (verified in code, do not "simplify"):
//  - saveDigestConfig rebuilds `include` from defaults and `schedule` from defaults: always send the FULL current map.
//    `todayPlan` is left out unless it is the key being changed (sending it would freeze the home-client default).
//  - saveRefreshDaily replaces the whole object and an omitted `enabled` means true: always send enabled + groups,
//    starting from readRefreshDaily's effective value (so a never-saved client keeps its derived default groups).
//  - saveDataSources deep-merges onto the stored value, so only the touched key is sent.
// modules.<cardId>.enabled writes through applyModuleToggle (the FIXED nested writer shared with the modules/config route).
// NEVER touched: recipientEmail, autoPublish, autoPostX, agentAutonomy, tone/extraInstructions, homeClientId,
// includeClientIds, dailyVideo.

import { ToolError } from '../jsonrpc.js';
import { createRequire } from 'node:module';
import { ID_RE, newId } from './stores.js';

const { REGISTRY: MODULE_REGISTRY } = createRequire(import.meta.url)('../../scout-intake/module-registry'); // pure CJS: the module card ids
export const MODULE_IDS = Object.freeze(Object.keys(MODULE_REGISTRY));

export const REFRESH_DAILY_GROUPS = Object.freeze(['market-signals', 'analysis', 'renders', 'today-queue', 'x-search']);
// digest.include.<section> ON fails CLOSED: only the pinned presentation-only sections below can be turned ON (with
// confirm:true). They render data the brief already holds (or a fixed CTA); turning one ON may cause free Firestore reads plus the weather lookup (getBriefForClient), with no model or paid-API spend. EVERY other
// registry section is BLOCKED ON (cost keys, data-fetching sections, GA4/platform/user data), and a test requires every
// key of features/email-digest/sections.registry.cjs to be in exactly one of the two lists, so a new section fails
// until someone classifies it. OFF is always free.
// These sections render the BRIEF of every client in digest_config.includeClientIds, so ON is blocked when that list is non-empty.
const BRIEF_DERIVED_KEYS = Object.freeze(['humanBrief', 'opportunities', 'suggestedReplies', 'signals', 'pressCoverage', 'suggestedPosts', 'planPreview']);
export const CONFIRM_ON_INCLUDE_KEYS = Object.freeze(['contactHuman', 'todayPlan', 'humanBrief', 'opportunities', 'suggestedReplies', 'signals', 'pressCoverage', 'suggestedPosts', 'planPreview']);
export const BLOCKED_ON_INCLUDE_KEYS = Object.freeze([
  'execBriefLink', 'execSummary', 'videoPosts', 'videoPromo', 'creativeBrief', 'xMarketTalk', // cost / model / render per email
  'agenda', 'weather', 'followerPosts', 'watchlist', 'redditAnalysis', 'instagramAnalysis', 'opportunitySignals', 'watchlistAccounts', // fetch external data (unverified)
  'platformOverview', 'signups', 'dashboards', 'pipeline', 'deployments', 'runtimeErrors', // platform / user data
  'ga4Traffic', 'topPages', 'trafficSources', 'keyEvents', 'homepage', // HITLOOP-global GA4 collectors
]);
const BRIEF_LINK_MODES = Object.freeze(['fresh', 'latest', 'off']);
const SOURCE_VALUES = Object.freeze(['mac', 'x-api']);
const SOURCE_KEYS = Object.freeze(['strategyAccounts', 'quoteTargets']);

const LOCK_LEASE_MS = 20_000;
const LOCK_TRIES = 40;
const LOCK_WAIT_MS = 100;

const BLOCK_SPEND = 'This would start spending money or sending email on a schedule. Turn it on in HITLOOP (dashboard) instead.';

const nowOf = (ctx) => (typeof ctx.now === 'function' ? ctx.now() : Date.now());
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- state ----------------------------------------------------------------------------------------------------

async function loadState(ops, clientId) {
  const s = ops.settings;
  const [digest, refreshDaily, dataSources, modules] = await Promise.all([s.digest.get(clientId), s.refreshDaily.read(clientId), s.dataSources.read(clientId), s.modules ? s.modules.read(clientId) : {}]);
  return { digest, refreshDaily, dataSources, modules };
}

// ---- key descriptors ------------------------------------------------------------------------------------------
// d = { key, type, values, read(state), classify(value) -> 'free'|'confirm'|'blocked', why?, write(ops, clientId, state, value, by) }

const onBlocked = (why) => (v) => (v === true ? { gate: 'blocked', why } : { gate: 'free' });
const offOnly = (why) => (v) => (v === false ? { gate: 'free' } : { gate: 'blocked', why });

function describeKey(key, state) {
  if (key === 'refresh-daily.enabled') {
    return { key, type: 'boolean', read: (st) => st.refreshDaily.enabled === true, classify: onBlocked(BLOCK_SPEND), write: (ops, cid, st, v, by) => writeRefreshDaily(ops, cid, st, { enabled: v }, by) };
  }
  const g = /^refresh-daily\.group\.([a-z-]+)$/.exec(key);
  if (g && REFRESH_DAILY_GROUPS.includes(g[1])) {
    const id = g[1];
    return {
      key, type: 'boolean', read: (st) => (st.refreshDaily.groups || []).includes(id), classify: onBlocked(BLOCK_SPEND),
      write: (ops, cid, st, v, by) => writeRefreshDaily(ops, cid, st, { groups: v ? [...new Set([...(st.refreshDaily.groups || []), id])] : (st.refreshDaily.groups || []).filter((x) => x !== id) }, by),
    };
  }
  if (key === 'digest.schedule.enabled') {
    return {
      key, type: 'boolean', read: (st) => st.digest.schedule?.enabled === true,
      classify: offOnly('Turning the daily email ON starts sending email every day. Do that in HITLOOP (Email Digest card). Turning it OFF is allowed here but cannot be undone over MCP.'),
      // Full current schedule with only `enabled` changed, so hour / weekday / timezone / frequency survive.
      write: (ops, cid, st, v) => ops.settings.digest.save(cid, { schedule: { ...st.digest.schedule, enabled: v } }),
    };
  }
  if (key === 'digest.dailyXSearch') {
    return { key, type: 'boolean', read: (st) => st.digest.dailyXSearch === true, classify: offOnly('The daily paid X search spends X API credits every day. Turn it on in HITLOOP.'),
      note: (st) => (st.refreshDaily.saved && st.refreshDaily.enabled && (st.refreshDaily.groups || []).includes('x-search')
        ? 'The saved daily refresh profile still includes x-search, so the paid X search STILL runs every day. Turn off refresh-daily.group.x-search (a separate set_setting) to stop it.' : undefined),
      write: (ops, cid, _st, v) => ops.settings.digest.save(cid, { dailyXSearch: v }) };
  }
  if (key === 'digest.summaryEnabled') {
    return { key, type: 'boolean', read: (st) => st.digest.summaryEnabled !== false, classify: onBlocked('The email summary is a model call on every send. Turn it on in HITLOOP.'), write: (ops, cid, _st, v) => ops.settings.digest.save(cid, { summaryEnabled: v }) };
  }
  if (key === 'digest.briefLinkMode') {
    return {
      key, type: 'enum', values: BRIEF_LINK_MODES, read: (st) => st.digest.briefLinkMode,
      classify: (v) => {
        if (v === 'fresh') return { gate: 'blocked', why: '"fresh" runs a brand-new brief (model cost) on every send. Choose it in HITLOOP.' };
        if (v === 'latest') return { gate: 'confirm', why: 'Adds a link to the newest hosted Executive Brief to the emailed digest.' };
        return { gate: 'free' };
      },
      write: (ops, cid, _st, v) => ops.settings.digest.save(cid, { briefLinkMode: v }),
    };
  }
  const inc = /^digest\.include\.([A-Za-z0-9]+)$/.exec(key);
  if (inc && state?.digest?.include && Object.hasOwn(state.digest.include, inc[1])) {
    const k = inc[1];
    const confirmOk = CONFIRM_ON_INCLUDE_KEYS.includes(k); // anything not pinned there is blocked ON (fail closed)
    const multiClient = BRIEF_DERIVED_KEYS.includes(k) && (state.digest.includeClientIds || []).length > 0;
    return {
      key, type: 'boolean', read: (st) => st.digest.include?.[k] === true,
      classify: (v) => (v === false ? { gate: 'free' } : multiClient ? { gate: 'blocked', why: `The "${k}" section would also render the briefs of the other clients listed in this digest's includeClientIds. Change it in HITLOOP.` } : !confirmOk ? { gate: 'blocked', why: `The "${k}" section is not on the MCP allowlist (it costs money, fetches extra data or shows platform/user data). Turn it on in HITLOOP.` } : { gate: 'confirm', why: `Adds the "${k}" section to the digest email sent to the configured recipient.` }),
      write: (ops, cid, st, v) => {
        const include = { ...st.digest.include };
        if (k !== 'todayPlan') delete include.todayPlan; // never freeze the home-client todayPlan default
        include[k] = v;
        return ops.settings.digest.save(cid, { include });
      },
    };
  }
  const mod = /^modules\.([A-Za-z0-9_-]+)\.enabled$/.exec(key);
  if (mod && MODULE_IDS.includes(mod[1])) {
    const id = mod[1];
    return {
      key, type: 'boolean', read: (st) => st.modules?.[id] === true,
      classify: (v) => (v === false ? { gate: 'free' } : { gate: 'confirm', why: `Enables the "${id}" module card: it shows its Run button AND adds the card to the daily refresh and to the paid "renders" run, so it means RECURRING model spend. Ask the owner first.` }),
      write: (ops, cid, _st, v) => ops.settings.modules.write(cid, id, v),
    };
  }
  const src = /^x-sources\.(strategyAccounts|quoteTargets)$/.exec(key);
  if (src) {
    const k = src[1];
    return {
      key, type: 'enum', values: SOURCE_VALUES, read: (st) => st.dataSources[k],
      classify: (v) => (v === 'mac' ? { gate: 'free' } : { gate: 'blocked', why: 'The paid X API source spends real money. Switch it in HITLOOP (Refresh panel > data sources).' }),
      write: (ops, cid, _st, v) => ops.settings.dataSources.save(cid, { [k]: v }),
    };
  }
  const auto = /^x-sources\.autoDaily\.(strategyAccounts|quoteTargets)$/.exec(key);
  if (auto) {
    const k = auto[1];
    return { key, type: 'boolean', read: (st) => st.dataSources.autoDaily?.[k] === true, classify: offOnly('Auto-daily X API pulls spend money every day. Turn them on in HITLOOP.'), write: (ops, cid, _st, v) => ops.settings.dataSources.save(cid, { autoDaily: { [k]: v } }) };
  }
  return null;
}

function writeRefreshDaily(ops, clientId, state, change, by) {
  const next = { enabled: state.refreshDaily.enabled === true, groups: [...(state.refreshDaily.groups || [])], ...change };
  return ops.settings.refreshDaily.save(clientId, next, { by });
}

const staticKeys = () => ['refresh-daily.enabled', ...REFRESH_DAILY_GROUPS.map((g) => `refresh-daily.group.${g}`), 'digest.schedule.enabled', 'digest.dailyXSearch', 'digest.summaryEnabled', 'digest.briefLinkMode', 'digest.include.<section>', 'modules.<cardId>.enabled', 'x-sources.strategyAccounts', 'x-sources.quoteTargets', 'x-sources.autoDaily.strategyAccounts', 'x-sources.autoDaily.quoteTargets'];

function validValue(d, value) {
  if (d.type === 'boolean') return typeof value === 'boolean';
  return d.values.includes(value);
}

// ---- get_settings ---------------------------------------------------------------------------------------------

export async function getSettings({ clientId, ops }) {
  const state = await loadState(ops, clientId);
  const keys = [...staticKeys().filter((k) => !k.includes('<')), ...Object.keys(state.digest.include || {}).sort().map((k) => `digest.include.${k}`), ...MODULE_IDS.map((id) => `modules.${id}.enabled`)];
  const settings = [];
  for (const key of keys) {
    const d = describeKey(key, state);
    if (!d) continue;
    const candidates = d.type === 'boolean' ? [true, false] : d.values;
    settings.push({ key, value: d.read(state), set: Object.fromEntries(candidates.map((c) => [String(c), d.classify(c).gate])) });
  }
  let trusted = null;
  try { trusted = ops.settings.trustedRefresh ? await ops.settings.trustedRefresh(clientId) : null; } catch { trusted = null; }
  const sched = state.digest.schedule || {};
  return {
    clientId,
    settings,
    legend: { free: 'applies directly', confirm: 'needs confirm:true (changes emailed content)', blocked: 'refused over MCP: change it in HITLOOP' },
    readOnly: {
      note: 'Read-only here: change these in HITLOOP.',
      schedule: { enabled: sched.enabled === true, frequency: sched.frequency ?? null, sendHour: sched.sendHour ?? null, weekday: sched.weekday ?? null, timezone: sched.timezone ?? null },
      autoPublish: Object.fromEntries(Object.entries(state.digest.autoPublish?.platforms || {}).map(([p, v]) => [p, v?.mode ?? 'off'])),
      autoPostX: state.digest.autoPostX !== false,
      trustedRefresh: trusted ? { enabled: trusted.enabled === true, dailyCapUsd: trusted.dailyCapUsd ?? null } : null,
    },
  };
}

// ---- mutex ----------------------------------------------------------------------------------------------------

async function withClientLock(ctx, ops, clientId, fn) {
  const key = `settings_${clientId}`;
  const sleep = ops.sleep || defaultSleep;
  let holder = null;
  for (let i = 0; i < LOCK_TRIES && !holder; i += 1) {
    holder = await ops.stores.locks.acquire(key, { now: nowOf(ctx), leaseMs: LOCK_LEASE_MS });
    if (!holder) await sleep(LOCK_WAIT_MS);
  }
  if (!holder) throw new ToolError('Another settings change for this client is still running. Wait a few seconds and try again.');
  try { return await fn(); } finally { await ops.stores.locks.release(key, holder).catch(() => {}); }
}

// ---- set_setting ----------------------------------------------------------------------------------------------

function gateResult(d, gate, { key, before, value, confirm, verb }) {
  if (gate.gate === 'blocked') return { applied: false, blocked: true, key, before, requested: value, reason: gate.why };
  if (gate.gate === 'confirm' && confirm !== true) {
    return { applied: false, needsConfirm: true, key, before, requested: value, message: `${gate.why} Ask the owner, then call ${verb} again with confirm:true.` };
  }
  return null;
}

export async function setSetting({ ctx, clientId, key, value, confirm, ops }) {
  const k = String(key || '').trim();
  return withClientLock(ctx, ops, clientId, async () => {
    const state = await loadState(ops, clientId);
    const d = describeKey(k, state);
    if (!d) throw new ToolError(`"${k.slice(0, 80)}" is not a setting that can be changed over MCP. Call get_settings for the list (settings not listed there are dashboard-only).`);
    if (!validValue(d, value)) throw new ToolError(`${k} takes ${d.type === 'boolean' ? 'true or false' : `one of: ${d.values.join(', ')}`}.`);
    const before = d.read(state);
    if (before === value) return { applied: false, unchanged: true, key: k, value, message: 'Already set; nothing written.' };
    const gate = d.classify(value);
    const refused = gateResult(d, gate, { key: k, before, value, confirm, verb: 'set_setting' });
    if (refused) return refused;

    await d.write(ops, clientId, state, value, ctx.email);
    // Log first (the write already happened), then verify; a mismatch still carries the changeId.
    const undoGate = d.classify(before);
    const undoable = undoGate.gate !== 'blocked';
    const changeId = (ops.newId || newId)('chg');
    const row = { clientId, key: k, before, after: value, email: String(ctx.email || '').toLowerCase(), at: new Date(nowOf(ctx)).toISOString(), via: 'mcp', undoable, undoneAt: null };
    let logged = true;
    try { await ops.stores.changes.create(changeId, row); } catch { logged = false; }
    const fresh = await loadState(ops, clientId);
    const after = d.read(fresh);
    if (after !== value) {
      if (logged) await ops.stores.changes.update(changeId, { verified: false, after, undoable: false }).catch(() => {});
      throw new ToolError(`The write was accepted but ${k} reads back as ${JSON.stringify(after)}, not ${JSON.stringify(value)}. Check it in HITLOOP.${logged ? ` (changeId ${changeId})` : ''}`);
    }
    const note = d.note?.(fresh);
    return {
      applied: true, ...(logged ? { changeId } : { changeLogged: false }), key: k, before, after, undoable,
      ...(undoable && undoGate.gate === 'confirm' ? { undoNeedsConfirm: true } : {}),
      ...(note ? { warning: note } : {}),
      note: undoable ? 'Undo with undo_setting {changeId}; it only works while the value is still what this change set.' : 'This change cannot be undone over MCP (the reverse direction needs the dashboard).',
    };
  });
}

// ---- undo_setting ---------------------------------------------------------------------------------------------

export async function undoSetting({ ctx, clientId, changeId, confirm, ops }) {
  const id = String(changeId || '').trim();
  const change = ID_RE.test(id) ? await ops.stores.changes.get(id) : null;
  if (!change || change.clientId !== clientId) throw new ToolError('No such change for this client.'); // another client's id reads like a missing one
  if (change.undoneAt) return { undone: false, changeId: id, message: `Already undone at ${change.undoneAt}.` };
  if (change.undoable === false) return { undone: false, changeId: id, key: change.key, reason: 'This change cannot be undone over MCP (undoing it would turn on spending or sending). Use HITLOOP.' };

  return withClientLock(ctx, ops, clientId, async () => {
    const state = await loadState(ops, clientId);
    const d = describeKey(change.key, state);
    if (!d) throw new ToolError(`"${String(change.key).slice(0, 80)}" can no longer be changed over MCP.`);
    const current = d.read(state);
    if (current !== change.after) {
      return { undone: false, conflict: true, changeId: id, key: change.key, current, expected: change.after, message: 'The value changed since this change (edited elsewhere). Nothing was written.' };
    }
    const gate = d.classify(change.before);
    const refused = gateResult(d, gate, { key: change.key, before: current, value: change.before, confirm, verb: 'undo_setting' });
    if (refused) return { undone: false, ...refused, changeId: id };

    await d.write(ops, clientId, state, change.before, ctx.email);
    const after = d.read(await loadState(ops, clientId));
    if (after !== change.before) throw new ToolError(`The undo was accepted but ${change.key} reads back as ${JSON.stringify(after)}. Check it in HITLOOP.`);
    await ops.stores.changes.update(id, { undoneAt: new Date(nowOf(ctx)).toISOString(), undoneBy: String(ctx.email || '').toLowerCase() }).catch(() => {});
    return { undone: true, changeId: id, key: change.key, before: current, after };
  });
}
