// Discogs panel backend actions (docs/plans/DISCOGS-PANEL-CONTRACT.md).
//
// Dashboard -> POST /api/dashboard/quote-targets {action:'discogs-*'} -> Firestore
// `archive_commands` -> Mac analyzer plugin. Plan rows travel back in the command
// `result`; held-record decisions live in `discogs_decisions/{groupId}`.
// Equality-only Firestore queries (no composite index); filtering is in memory.

import {
  findAnalyzer, isOnline, baseSources, queueCommand, bad, str, toIso, toMs,
} from '../x-content-inventory/nas.js';

export const DISCOGS_JOB_TYPES = ['DISCOGS_PLAN', 'DISCOGS_APPLY', 'DISCOGS_UNDO'];
export const DISCOGS_MAX_LIMIT = 300;
export const DISCOGS_DEFAULT_CAP_USD = 2;
export const DISCOGS_MAX_CAP_USD = 20;
export const DISCOGS_MAX_GROUPS = 100;
export const DISCOGS_DECISIONS = 'discogs_decisions';

const ACTIVE_STATES = new Set(['QUEUED', 'CLAIMED', 'RUNNING']);
const isReleaseId = (v) => Number.isInteger(v) && v > 0;

function cleanFolder(p) {
  const s = String(p ?? '').trim() || '.';
  if (s.startsWith('/') || s.includes('\0') || s.split(/[\\/]+/).includes('..')) return null;
  return s;
}

/** Every command for the analyzer, oldest -> newest (stable on ties). */
async function loadCommands(deps, analyzerId) {
  const snap = await deps.db.collection('archive_commands').where('workerId', '==', analyzerId).limit(500).get();
  return snap.docs
    .map((d, i) => ({ id: d.id, ...(d.data() || {}), __i: i }))
    .sort((a, b) => ((toMs(a.createdAt) ?? 0) - (toMs(b.createdAt) ?? 0)) || (a.__i - b.__i));
}

async function requireDiscogsAnalyzer(deps) {
  const a = await findAnalyzer(deps.db);
  if (!a) throw bad('No NAS analyzer has registered yet.', 409);
  if (!isOnline(a, deps.now())) throw bad('NAS analyzer is offline. Start it on the Mac and retry.', 409);
  if (!supportsDiscogs(a)) throw bad('The analyzer on the Mac does not have Discogs support loaded. Restart it with the Discogs entry point.', 409);
  return a;
}

const supportsDiscogs = (a) => Array.isArray(a?.data?.capabilities) && a.data.capabilities.includes('DISCOGS_PLAN');

// ---------------------------------------------------------------- status --

async function status(deps) {
  const a = await findAnalyzer(deps.db);
  if (!a) return { ok: true, online: false, workerId: null, supportsDiscogs: false, localThumbBase: null, sources: [] };
  const { sources } = await baseSources(deps.db, a.id);
  return {
    ok: true, online: isOnline(a, deps.now()), workerId: a.id, supportsDiscogs: supportsDiscogs(a),
    localThumbBase: a.data.localThumbBase || null, sources,
  };
}

// ------------------------------------------------------------------ plan --

async function plan(deps, body, decoded) {
  const sourceId = str(body?.sourceId);
  if (!sourceId) throw bad('sourceId is required.');
  const relativePath = cleanFolder(body?.relativePath);
  if (!relativePath) throw bad('relativePath is invalid.');
  let limit = DISCOGS_MAX_LIMIT;
  if (body?.limit !== undefined && body?.limit !== null) {
    limit = Number(body.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > DISCOGS_MAX_LIMIT) throw bad(`limit must be an integer 1..${DISCOGS_MAX_LIMIT}.`);
  }
  let capUsd = DISCOGS_DEFAULT_CAP_USD;
  if (body?.capUsd !== undefined && body?.capUsd !== null) {
    capUsd = Number(body.capUsd);
    if (!Number.isFinite(capUsd) || capUsd <= 0 || capUsd > DISCOGS_MAX_CAP_USD) throw bad(`capUsd must be > 0 and ≤ ${DISCOGS_MAX_CAP_USD}.`);
  }
  const a = await requireDiscogsAnalyzer(deps);
  const commandId = await queueCommand(deps, {
    type: 'DISCOGS_PLAN', workerId: a.id, sourceId, relativePath, limit, capUsd,
    requestedBy: decoded?.email || null,
  });
  return { ok: true, commandId };
}

// ------------------------------------------------------------------ jobs --

function shapeJob(c) {
  const r = c.result || {};
  const len = (v) => (Array.isArray(v) ? v.length : 0);
  return {
    id: c.id, type: c.type, state: c.state,
    relativePath: c.relativePath ?? r.relativePath ?? null,
    planId: c.planId ?? r.planId ?? null,
    progress: r.progress ?? null,
    summary: r.summary ?? null,
    spentUsd: r.spentUsd ?? null,
    capUsd: c.capUsd ?? null,
    counts: { applied: len(r.applied), skipped: len(r.skipped), removed: len(r.removed), errors: len(r.errors) },
    journal: r.journal ?? c.journal ?? null,
    applyCommandId: c.applyCommandId ?? null,
    error: c.error || null,
    createdAt: toIso(c.createdAt), updatedAt: toIso(c.updatedAt),
  };
}

async function jobs(deps) {
  const a = await findAnalyzer(deps.db);
  if (!a) return { ok: true, jobs: [] };
  const all = await loadCommands(deps, a.id);
  const rows = all.filter((c) => DISCOGS_JOB_TYPES.includes(c.type)).reverse().slice(0, 10).map(shapeJob);
  return { ok: true, jobs: rows };
}

async function cancel(deps, body) {
  const target = str(body?.commandId);
  if (!target) throw bad('commandId is required.');
  const snap = await deps.db.collection('archive_commands').doc(target).get();
  const t = snap.exists ? snap.data() : null;
  if (!t || !DISCOGS_JOB_TYPES.includes(t.type)) throw bad('No such Discogs job.', 404);
  const commandId = await queueCommand(deps, {
    type: 'CANCEL_JOB', workerId: t.workerId, sourceId: t.sourceId || null,
    targetCommandId: target, commandId: target,
  });
  return { ok: true, commandId };
}

// --------------------------------------------------------------- records --

const hasRows = (c) => Array.isArray(c.result?.rows) && c.result.rows.length > 0;

/** The plan to show: given planId, else latest DISCOGS_PLAN that produced rows. */
function pickPlan(commands, planId) {
  const plans = commands.filter((c) => c.type === 'DISCOGS_PLAN' && hasRows(c) && (c.state === 'COMPLETE' || c.state === 'FAILED'));
  if (planId) return plans.filter((c) => c.result.planId === planId).pop() || null;
  return plans.pop() || null;
}

/** Added-ness per group for one plan: apply results minus later COMPLETE undos. */
function computeAdded(commands, planId) {
  const applyIds = new Set(commands.filter((c) => c.type === 'DISCOGS_APPLY' && c.planId === planId).map((c) => c.id));
  const added = new Map();
  const adding = new Set();
  for (const c of commands) {
    if (c.type === 'DISCOGS_APPLY' && applyIds.has(c.id)) {
      if (c.state === 'COMPLETE') {
        for (const x of c.result?.applied || []) {
          added.set(x.groupId, { releaseId: x.releaseId, instanceId: x.instanceId ?? null, applyCommandId: c.id, journal: c.result?.journal ?? null });
        }
      } else if (ACTIVE_STATES.has(c.state)) {
        for (const it of c.items || []) adding.add(it.groupId);
      }
    } else if (c.type === 'DISCOGS_UNDO' && c.state === 'COMPLETE' && applyIds.has(c.applyCommandId)) {
      for (const x of c.result?.removed || []) {
        if (added.get(x.groupId)?.applyCommandId === c.applyCommandId) added.delete(x.groupId);
      }
    }
  }
  return { added, adding };
}

async function loadDecisions(deps) {
  const snap = await deps.db.collection(DISCOGS_DECISIONS).get();
  const map = new Map();
  for (const d of snap.docs) map.set(d.id, d.data() || {});
  return map;
}

function deriveStatus(row, ctx) {
  const added = ctx.added.get(row.groupId) || null;
  const dec = ctx.decisions.get(row.groupId) || null;
  let status;
  if (added) status = 'added';
  else if (ctx.adding.has(row.groupId)) status = 'adding';
  else if (dec?.decision === 'skip') status = 'skipped';
  else if (row.action === 'add' || dec?.decision === 'accept') status = 'ready';
  else if (row.action === 'review') status = 'review';
  else if (row.action === 'already-owned') status = 'owned';
  else status = 'unreadable';
  return { status, added, dec };
}

async function loadPlanContext(deps, a, planId) {
  const commands = await loadCommands(deps, a.id);
  const pc = pickPlan(commands, planId);
  if (!pc) return null;
  const decisions = await loadDecisions(deps);
  const { added, adding } = computeAdded(commands, pc.result.planId);
  return { pc, ctx: { added, adding, decisions } };
}

async function records(deps, body) {
  const a = await findAnalyzer(deps.db);
  if (!a) return { ok: true, plan: null, rows: [] };
  const loaded = await loadPlanContext(deps, a, str(body?.planId) || null);
  if (!loaded) return { ok: true, plan: null, rows: [] };
  const { pc, ctx } = loaded;
  const r = pc.result;
  const rows = r.rows.map((row) => {
    const { status, added, dec } = deriveStatus(row, ctx);
    return {
      ...row,
      decision: dec ? { decision: dec.decision, releaseId: dec.releaseId ?? null, manual: dec.manual === true } : null,
      status, added,
    };
  });
  return {
    ok: true,
    plan: {
      commandId: pc.id, planId: r.planId, sourceId: r.sourceId ?? pc.sourceId ?? null,
      relativePath: r.relativePath ?? pc.relativePath ?? null, summary: r.summary ?? null,
      capReached: r.capReached === true, remaining: r.remaining ?? null, createdAt: toIso(pc.createdAt),
    },
    rows,
  };
}

// ---------------------------------------------------------------- decide --

async function decide(deps, body, decoded) {
  const groupId = str(body?.groupId);
  if (!groupId || groupId.includes('/')) throw bad('groupId is required.');
  const decision = str(body?.decision);
  if (!['accept', 'skip', 'reset'].includes(decision)) throw bad("decision must be 'accept', 'skip' or 'reset'.");
  const ref = deps.db.collection(DISCOGS_DECISIONS).doc(groupId);
  if (decision === 'reset') {
    await ref.delete();
    return { ok: true, groupId, decision: null };
  }

  const a = await findAnalyzer(deps.db);
  const loaded = a ? await loadPlanContext(deps, a, str(body?.planId) || null) : null;
  const row = loaded?.pc.result.rows.find((x) => x.groupId === groupId) || null;
  let releaseId = null;
  let manual = false;
  if (decision === 'accept') {
    releaseId = Number(body?.releaseId);
    if (!isReleaseId(releaseId)) throw bad('releaseId must be a positive integer.');
    manual = body?.manual === true;
    if (!row) throw bad('No such record in the current plan.', 404);
    if (!manual && !(row.candidates || []).some((c) => Number(c.releaseId) === releaseId)) {
      throw bad('releaseId is not one of this record\'s candidates (use manual to override).');
    }
  }
  const doc = {
    groupId, decision, releaseId, manual, planId: loaded?.pc.result.planId ?? null,
    by: decoded?.email || null, at: new Date(deps.now()).toISOString(),
  };
  await ref.set(doc);
  return { ok: true, groupId, decision, releaseId };
}

// ----------------------------------------------------------------- apply --

async function apply(deps, body, decoded) {
  const planId = str(body?.planId);
  if (!planId) throw bad('planId is required.');
  const ids = body?.groupIds;
  if (!Array.isArray(ids) || !ids.length) throw bad('groupIds[] is required.');
  if (ids.length > DISCOGS_MAX_GROUPS) throw bad(`At most ${DISCOGS_MAX_GROUPS} groupIds per call.`);
  const groupIds = [...new Set(ids.map((g) => str(g)))];
  if (groupIds.some((g) => !g)) throw bad('groupIds must be non-empty strings.');

  const a = await requireDiscogsAnalyzer(deps);
  const loaded = await loadPlanContext(deps, a, planId);
  if (!loaded) throw bad(`No plan ${planId}.`, 404);
  const { pc, ctx } = loaded;
  const byId = new Map(pc.result.rows.map((r) => [r.groupId, r]));

  const items = [];
  const problems = [];
  for (const g of groupIds) {
    const row = byId.get(g);
    if (!row) { problems.push(`${g} (not in plan)`); continue; }
    const { status, dec } = deriveStatus(row, ctx);
    if (status === 'added' || status === 'adding') { problems.push(`${g} (already added)`); continue; }
    if (status === 'skipped') { problems.push(`${g} (skipped)`); continue; }
    let releaseId = null;
    if (dec?.decision === 'accept') releaseId = Number(dec.releaseId);
    else if (row.action === 'add') releaseId = Number(row.best);
    if (!isReleaseId(releaseId)) { problems.push(`${g} (${status === 'review' ? 'needs a decision' : status})`); continue; }
    items.push({ groupId: g, releaseId });
  }
  if (problems.length) throw bad(`Cannot add: ${problems.join(', ')}.`);

  const commandId = await queueCommand(deps, {
    type: 'DISCOGS_APPLY', workerId: a.id, sourceId: pc.result.sourceId ?? pc.sourceId ?? null,
    relativePath: pc.result.relativePath ?? pc.relativePath ?? null,
    planId, items, notes: body?.notes === true, folderId: 1, requestedBy: decoded?.email || null,
  });
  return { ok: true, commandId, count: items.length };
}

// ------------------------------------------------------------------ undo --

async function undo(deps, body, decoded) {
  const applyCommandId = str(body?.applyCommandId);
  if (!applyCommandId) throw bad('applyCommandId is required.');
  const snap = await deps.db.collection('archive_commands').doc(applyCommandId).get();
  const t = snap.exists ? snap.data() : null;
  if (!t || t.type !== 'DISCOGS_APPLY') throw bad('No such Discogs add job.', 404);
  const journal = str(t.result?.journal);
  if (t.state !== 'COMPLETE' || !journal) throw bad('Only a completed add job with a journal can be undone.', 409);
  const a = await requireDiscogsAnalyzer(deps);
  const commandId = await queueCommand(deps, {
    type: 'DISCOGS_UNDO', workerId: a.id, sourceId: t.sourceId || null,
    journal, applyCommandId, requestedBy: decoded?.email || null,
  });
  return { ok: true, commandId };
}

export const DISCOGS_ACTIONS = [
  'discogs-status', 'discogs-plan', 'discogs-jobs', 'discogs-cancel',
  'discogs-records', 'discogs-decide', 'discogs-apply', 'discogs-undo',
];

export async function handleDiscogsAction(deps, action, body, decoded) {
  switch (action) {
    case 'discogs-status': return status(deps);
    case 'discogs-plan': return plan(deps, body, decoded);
    case 'discogs-jobs': return jobs(deps);
    case 'discogs-cancel': return cancel(deps, body);
    case 'discogs-records': return records(deps, body);
    case 'discogs-decide': return decide(deps, body, decoded);
    case 'discogs-apply': return apply(deps, body, decoded);
    case 'discogs-undo': return undo(deps, body, decoded);
    default: throw bad(`Unknown Discogs action: ${action}`);
  }
}
