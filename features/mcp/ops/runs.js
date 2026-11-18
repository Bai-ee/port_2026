// runs.js - list_refreshes / run_refresh / get_run_status logic for MCP-OPS. Pure: every effect is injected.
//   ops = { stores, agent, readSources, newId? }  (built by features/mcp/server.js; fakes in tests)
//     stores.runs   {create,get,update}            mcp_ops_runs/{runId}
//     agent.handle  the strategy handlers 'agent-refresh' / 'agent-refresh-status' (an OPS-ONLY instance whose refresh
//                   spend store is off, so even a trustedRefresh client can never spend through it)
//     readSources   (clientId) -> {strategyAccounts, quoteTargets}   free read of the client's data sources
//   ctx.services.counters() / ctx.services.regenerateToday are the existing shared services.
//
// FREE order: resolve client (caller) -> catalog gate -> source validation -> reserve the daily cap -> run.
// PAID order: validate params -> (no confirm: preview + token, nothing invoked) -> verify + consume the single-use token
//   -> take the run lock -> reserve the caps (per refresh/client/day + global paid) -> record the run -> run in the
//   background (ctx.services.defer) -> mark done/failed and release the lock. A refusal never burns a cap; the lock is
//   released on any throw. (Caps are pre-checked at preview time; the two reserves after the lock are separate atomic
//   increments, so if the global reserve loses a race AFTER the per-refresh slot was taken, that one per-refresh slot is
//   not refunded: counters have no atomic decrement. Rare, and it errs on the side of fewer runs.) Paid runs return {status:'running'} at once; follow them with get_run_status.
//   ops.paid and ops.secret are the paid deps (see paid.js / preview.js).

import { ToolError } from '../jsonrpc.js';
import { LimitError, utcDay } from '../limits.js';
import { planGroup } from '../../x-strategy/agent/refresh-engine.js';
import { REFRESHES, EXCLUDED, findRefresh, findExcluded, macEtaSeconds, OPS_PHASE, PAID_GLOBAL_CAP_PER_DAY } from './catalog.js';
import { ID_RE, newId } from './stores.js';
import { issuePreview, verifyPreview, consumePreview } from './preview.js';
import { normalizePaidParams, describePaid, executePaid, readShowcaseStatus, showcaseClientOf } from './paid.js';
import { dailyPaidKey, DAILY_PAID_CAP } from '../limits.js';

export const opsCapKey = (refreshId, clientId, now) => `ops_${refreshId}_${clientId}_${utcDay(now)}`;
export const opsPaidGlobalKey = (now) => `ops_paid_${utcDay(now)}`;

const TERMINAL = new Set(['done', 'failed', 'timed-out', 'refused']);
const STATUS_OF = { done: 'done', completed: 'done', succeeded: 'done', partial: 'done', skipped: 'done', failed: 'failed', error: 'failed', 'rate-limited': 'failed', queued: 'queued', running: 'running' };
export const normalizeStatus = (s) => STATUS_OF[String(s || '').toLowerCase()] || 'unknown';
const STATUS_NOTE = { partial: 'Finished partially: some of the work did not complete. Check the result before relying on it.', skipped: 'Nothing needed to run (skipped).' };
const noteFor = (s) => STATUS_NOTE[String(s || '').toLowerCase()];

const clip = (v, n = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const authFor = (ctx) => ({ decoded: { email: ctx.email, uid: ctx.uid ?? null } });
const nowOf = (ctx) => (typeof ctx.now === 'function' ? ctx.now() : Date.now());

async function sourcesOf(ops, clientId) {
  return (await ops.readSources(clientId)) || {};
}
const SOURCE_DEPENDENT = new Set(['strategy-accounts', 'quote-targets']);

const refusal = (entry, reason, extra = {}) => ({ ran: false, refused: true, refreshId: entry.id, reason, ...extra });

// ---- list_refreshes -------------------------------------------------------------------------------------------

export async function listRefreshes({ ctx, clientId, ops }) {
  const now = nowOf(ctx);
  const counters = ctx.services.counters();
  const sources = await sourcesOf(ops, clientId).catch(() => null);
  const rows = [];
  for (const r of REFRESHES) {
    const base = { id: r.id, label: r.label, costClass: r.costClass, estimate: r.estimate, writes: r.writes };
    if (r.costClass === 'paid') {
      let availability = 'preview-then-confirm';
      if (r.kind === 'showcase' && !showcaseClientOf(clientId)) availability = 'blocked: Site Showcase is not enabled for this client';
      const used = r.kind === 'sync' ? undefined : await counters.get(opsCapKey(r.id, clientId, now)).catch(() => 0);
      rows.push({ ...base, runnable: availability === 'preview-then-confirm', availability, effects: [...r.effects], ...(r.maxPerDay ? { maxPerDay: r.maxPerDay, usedToday: used } : {}) });
      continue;
    }
    let availability = 'available';
    if (SOURCE_DEPENDENT.has(r.id) && sources === null) availability = 'blocked: the client data sources could not be read';
    else if (r.runner === 'agent-mac' && planGroup(r.id, { sources: sources || {} }).paid) availability = 'blocked: this client uses the paid X API for this source (owner runs it from the Refresh panel)';
    const used = await counters.get(opsCapKey(r.id, clientId, now)).catch(() => 0);
    rows.push({ ...base, runnable: availability === 'available', availability, maxPerDay: r.maxPerDay, usedToday: used, etaSeconds: macEtaSeconds(r.id) });
  }
  return {
    phase: OPS_PHASE,
    clientId,
    refreshes: rows,
    excluded: EXCLUDED.map((e) => ({ ...e })),
    paidCaps: { globalPerDay: PAID_GLOBAL_CAP_PER_DAY, usedToday: await counters.get(opsPaidGlobalKey(now)).catch(() => 0), appliesTo: ['market-signals', 'analysis', 'renders', 'site-showcase'], syncKindsShareDailyPaidSlots: DAILY_PAID_CAP, syncKindsNote: 'x-monitor and strategy-review do not use the ops global cap: they share the existing 10/day request_sync paid slots.', syncKindsUsedToday: await counters.get(dailyPaidKey(now)).catch(() => 0) },
    note: 'Free refreshes run directly. Paid ones need a preview, the owner\'s explicit yes, then confirm:true with the previewToken.',
  };
}

// ---- run_refresh ----------------------------------------------------------------------------------------------

export async function runRefresh({ ctx, clientId, refreshId, params, confirm, previewToken, ops }) {
  const id = String(refreshId || '').trim();
  const entry = findRefresh(id);
  if (!entry) {
    const ex = findExcluded(id);
    if (ex) return { ran: false, excluded: true, refreshId: ex.id, reason: ex.reason };
    throw new ToolError(`Unknown refreshId "${id.slice(0, 40)}". Call list_refreshes for the catalog.`);
  }
  if (entry.costClass === 'paid') return runPaid({ ctx, clientId, entry, params, confirm, previewToken, ops });

  // Validate before reserving, so a refusal never burns the cap.
  if (entry.runner === 'agent-mac') {
    let sources = {};
    if (SOURCE_DEPENDENT.has(entry.id)) {
      // A source read error must refuse (before the cap), never default to the free Mac path.
      try { sources = await sourcesOf(ops, clientId); } catch { throw new ToolError('Could not read this client\'s data sources, so nothing ran. Try again in a moment.'); }
    }
    const plan = planGroup(entry.id, { sources });
    if (plan.paid) {
      return refusal(entry, 'x-api-source', { message: 'This client reads this data set from the paid X API, which MCP never starts. The owner runs it from the HITLOOP Refresh panel (it shows the estimate and asks for confirmation).', estimate: plan.estimate });
    }
  }

  const now = nowOf(ctx);
  const slot = await ctx.services.counters().reserve(opsCapKey(entry.id, clientId, now), entry.maxPerDay, now + 2 * 86400000);
  if (!slot.ok) throw new LimitError(`Daily limit reached: ${entry.maxPerDay} "${entry.id}" refreshes per client per day over MCP. It resets at 00:00 UTC.`, 'daily-cap');

  const runId = (ops.newId || newId)('run');
  const row = { clientId, refreshId: entry.id, email: String(ctx.email || '').toLowerCase(), startedAt: new Date(now).toISOString(), startedAtMs: now, leaseMs: entry.leaseMs, status: 'running', requestId: null };
  await ops.stores.runs.create(runId, row);

  let outcome;
  try {
    outcome = entry.runner === 'today-queue' ? await runTodayQueue(ctx, clientId) : await runMac(ctx, clientId, entry, ops);
  } catch (err) {
    outcome = { status: 'failed', detail: clip(err?.message || err) };
  }
  const patch = { status: outcome.status, requestId: outcome.requestId ?? null, detail: outcome.detail ?? null, ...(TERMINAL.has(outcome.status) ? { finishedAt: new Date(nowOf(ctx)).toISOString() } : {}) };
  await ops.stores.runs.update(runId, patch).catch(() => {});
  return {
    ran: outcome.status !== 'refused',
    runId, refreshId: entry.id, clientId, status: outcome.status,
    ...(outcome.requestId ? { requestId: outcome.requestId } : {}),
    ...(outcome.etaSeconds ? { etaSeconds: outcome.etaSeconds } : {}),
    detail: outcome.detail,
    next: outcome.status === 'queued' || outcome.status === 'running' ? 'Call get_run_status with this runId to follow it. The Mac worker picks queued work up within a minute when it is awake.' : 'Re-read the data you need.',
  };
}

// ---- paid run_refresh -----------------------------------------------------------------------------------------

async function runPaid({ ctx, clientId, entry, params, confirm, previewToken, ops }) {
  const now = nowOf(ctx);
  const counters = ctx.services.counters();
  const secret = ops.secret;
  // 1. validate (pure) and price; refusals here cost nothing.
  const clean = normalizePaidParams(entry, params, { clientId });
  if (entry.kind === 'sync' && (await counters.get(dailyPaidKey(now)).catch(() => 0)) >= DAILY_PAID_CAP) {
    throw new LimitError(`Daily limit reached: ${DAILY_PAID_CAP} paid syncs per day (shared with request_sync). It resets at 00:00 UTC.`, 'daily-cap');
  }
  if (entry.kind !== 'sync') {
    if ((await counters.get(opsCapKey(entry.id, clientId, now)).catch(() => 0)) >= entry.maxPerDay) throw new LimitError(`Daily limit reached: ${entry.maxPerDay} "${entry.id}" runs per client per day over MCP. It resets at 00:00 UTC.`, 'daily-cap');
    if ((await counters.get(opsPaidGlobalKey(now)).catch(() => 0)) >= PAID_GLOBAL_CAP_PER_DAY) throw new LimitError(`Daily limit reached: ${PAID_GLOBAL_CAP_PER_DAY} paid MCP refreshes per day. It resets at 00:00 UTC.`, 'daily-cap');
  }
  const { estimate, effects } = await describePaid(entry, clean, { clientId, ops });

  // 2. no confirm: preview only. Nothing is invoked or reserved.
  if (confirm !== true) {
    const { previewToken: token, expiresAt } = issuePreview({ secret, email: ctx.email, clientId, refreshId: entry.id, params: clean, estimate, now });
    return {
      ran: false, needsConfirm: true, refreshId: entry.id, clientId, costClass: 'paid', estimate, effects, writes: entry.writes, params: clean, previewToken: token, expiresAt,
      message: 'Nothing ran and nothing was spent. Show the owner the estimate and effects. Only after they say yes in this conversation, call run_refresh again with confirm:true and this previewToken (valid 10 minutes, single use).',
    };
  }
  if (!previewToken) throw new ToolError('confirm:true needs the previewToken from the preview. Call run_refresh without confirm first.');
  const v = verifyPreview(previewToken, { secret, email: ctx.email, clientId, refreshId: entry.id, params: clean, estimate, now });
  await consumePreview(ops.stores, { jti: v.jti, expMs: v.expMs, email: ctx.email, clientId, refreshId: entry.id, now });

  // 3. lock (one active run per client + refresh; the lease is the refresh's own timeout).
  const lockKey = `run_${clientId}_${entry.id}`;
  const holder = await ops.stores.locks.acquire(lockKey, { now, leaseMs: entry.leaseMs });
  if (!holder) return refusal(entry, 'already-running', { message: `A ${entry.id} run for this client is still active (up to ${Math.round(entry.leaseMs / 60000)} minutes). Nothing was started; the preview token was used up.` });
  let handedOff = false;
  try {
    // 4. caps. x-monitor / strategy-review: executePaidSync takes the existing daily paid slot itself (no double count).
    if (entry.kind !== 'sync') {
      const own = await counters.reserve(opsCapKey(entry.id, clientId, now), entry.maxPerDay, now + 2 * 86400000);
      if (!own.ok) throw new LimitError(`Daily limit reached: ${entry.maxPerDay} "${entry.id}" runs per client per day over MCP.`, 'daily-cap');
      const glob = await counters.reserve(opsPaidGlobalKey(now), PAID_GLOBAL_CAP_PER_DAY, now + 2 * 86400000);
      if (!glob.ok) throw new LimitError(`Daily limit reached: ${PAID_GLOBAL_CAP_PER_DAY} paid MCP refreshes per day.`, 'daily-cap');
    }
    const runId = (ops.newId || newId)('run');
    await ops.stores.runs.create(runId, { clientId, refreshId: entry.id, email: String(ctx.email || '').toLowerCase(), startedAt: new Date(now).toISOString(), startedAtMs: now, leaseMs: entry.leaseMs, status: 'running', requestId: null, paid: true, lockKey });
    const work = async () => {
      let outcome;
      try { outcome = await executePaid({ entry, params: clean, ctx, clientId, ops }); } catch (err) { outcome = { status: 'failed', detail: clip(err?.message || err) }; }
      try {
        await ops.stores.runs.update(runId, { status: outcome.status, requestId: outcome.requestId ?? null, detail: outcome.detail ?? null, ...(TERMINAL.has(outcome.status) ? { finishedAt: new Date(nowOf(ctx)).toISOString() } : {}) });
      } catch { /* the lease still frees the lock; get_run_status reads a stale run as timed-out */ }
      await ops.stores.locks.release(lockKey, holder).catch(() => {});
    };
    let status = 'running';
    if (typeof ctx.services.defer === 'function') {
      try {
        ctx.services.defer(work);
      } catch (err) {
        // The work was never scheduled: record the failure and free the lock (the finally below releases it).
        await ops.stores.runs.update(runId, { status: 'failed', detail: clip(`Could not start the background run: ${err?.message || err}`), finishedAt: new Date(nowOf(ctx)).toISOString() }).catch(() => {});
        return { ran: false, runId, refreshId: entry.id, clientId, status: 'failed', reason: 'defer-failed', message: 'The background run could not be started; nothing ran.' };
      }
      handedOff = true; // from here the background work owns the lock
    } else {
      handedOff = true;
      await work();
      status = (await ops.stores.runs.get(runId))?.status || 'running';
    }
    return {
      ran: true, runId, refreshId: entry.id, clientId, status, costClass: 'paid',
      next: 'Started. It runs in the background: poll get_run_status with this runId (a run that never finishes reads timed-out).',
    };
  } finally {
    if (!handedOff) await ops.stores.locks.release(lockKey, holder).catch(() => {});
  }
}

async function runMac(ctx, clientId, entry, ops) {
  const res = await ops.agent.handle('agent-refresh', { clientId, groups: [entry.id], reason: 'mcp-ops run_refresh' }, { clientId }, authFor(ctx));
  if (!res || res.ok === false) return { status: 'failed', detail: clip(res?.error || 'agent-refresh failed') };
  const r = (res.results || []).find((x) => x.group === entry.id) || res.results?.[0];
  if (!r) return { status: 'failed', detail: 'agent-refresh returned no result' };
  if (r.status === 'needs-confirm' || r.mode === 'paid') return { status: 'refused', detail: clip(r.detail || 'needs owner confirmation') };
  const note = noteFor(r.status);
  return { status: normalizeStatus(r.status), requestId: r.requestId || null, etaSeconds: r.etaSeconds, detail: clip(`${r.detail || ''}${note ? ` ${note}` : ''}`) };
}

async function runTodayQueue(ctx, clientId) {
  const out = await ctx.services.regenerateToday(clientId, { force: false });
  return { status: 'done', detail: out?.skipped ? `Inputs unchanged (${out.reason || 'no change'}); saved run kept.` : `Regenerated: ${out?.suggestionCount ?? '?'} suggestion(s), template drafting only.` };
}

// ---- get_run_status -------------------------------------------------------------------------------------------

export async function getRunStatus({ ctx, clientId, runId, ops }) {
  const id = String(runId || '').trim();
  const row = ID_RE.test(id) ? await ops.stores.runs.get(id) : null;
  // A run of another client reads exactly like a missing one.
  if (!row || row.clientId !== clientId) throw new ToolError('No such run for this client.');
  const now = nowOf(ctx);
  const out = { runId: id, refreshId: row.refreshId, clientId, startedAt: row.startedAt, status: row.status, ...(row.requestId ? { requestId: row.requestId } : {}), ...(row.detail ? { detail: row.detail } : {}) };
  if (TERMINAL.has(row.status)) return out;

  if (row.refreshId === 'site-showcase' && row.requestId) {
    // The route's GET status (the healing path: re-pokes a lost trigger, fails jobs older than 20 min; no job, no cap).
    try {
      const st = await readShowcaseStatus({ row, clientId, ops, ctx });
      if (st) { out.status = st.status; out.underlying = st.underlying; if (st.result) out.result = st.result; }
    } catch (err) { out.statusError = clip(err?.message || err); }
  } else if (row.requestId) {
    try {
      const st = await ops.agent.handle('agent-refresh-status', { clientId, requestIds: [row.requestId] }, { clientId }, authFor(ctx));
      const u = st?.requests?.[0];
      if (u) {
        out.underlying = { status: u.status, ...(u.error ? { error: u.error } : {}) };
        if (u.result !== undefined && JSON.stringify(u.result ?? null).length <= 3000) out.result = u.result;
        else if (u.result !== undefined) out.resultTruncated = true;
        out.status = normalizeStatus(u.status);
        if (noteFor(u.status)) out.note = noteFor(u.status);
      }
    } catch (err) {
      out.statusError = clip(err?.message || err);
    }
  }
  if (TERMINAL.has(out.status)) {
    // Persist the note (e.g. partial) into detail so later reads of the finished run keep it.
    const detail = out.note ? clip(`${row.detail ? `${row.detail} ` : ''}${out.note}`) : undefined;
    if (detail) out.detail = detail;
    await ops.stores.runs.update(id, { status: out.status, finishedAt: new Date(now).toISOString(), ...(detail ? { detail } : {}) }).catch(() => {});
  } else if (now - (row.startedAtMs || 0) > (row.leaseMs || 0)) {
    // Past its lease and still not done: never report it as running.
    out.status = 'timed-out';
    out.note = 'No completion was seen within the expected time (the Mac may be asleep or the request was dropped). Treat it as unknown; run it again if you still need it.';
    await ops.stores.runs.update(id, { status: 'timed-out', finishedAt: new Date(now).toISOString() }).catch(() => {});
  }
  return out;
}
