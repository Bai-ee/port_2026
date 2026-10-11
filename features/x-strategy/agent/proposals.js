// proposals.js - proposal shape, validation and confirm/reject execution (T4b).
// Pure + injected I/O: nothing here imports a store or a model. A proposal NEVER runs anything until the
// owner confirms it; confirm runs exactly the one action mapped to its kind (PROPOSAL_KIND_ACTIONS) through
// an injected executor. Reject executes nothing.

import { randomUUID } from 'node:crypto';
import { PROPOSAL_KINDS, PROPOSAL_STATUSES, PLAN_LIMITS, DEFAULT_PLAN } from '../contracts.js';
import { normalizePlan, validatePlan, HANDLE_RE } from '../plan-state.js';
import { StrategyPlanError } from '../plan-store.js';

export const SUMMARY_MAX = 200;
export const RATIONALE_MAX = 800;
export const STORY_MAX = 1000;
export const TEXT_MAX = 1000;
export const MAX_EVIDENCE = 8;
const RESULT_MAX_CHARS = 4000;
const ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const iso = (now) => { const d = new Date(now ?? Date.now()); return (Number.isNaN(d.getTime()) ? new Date() : d).toISOString(); };
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Thrown by an executor to record a structured failure result (e.g. stale). */
export class ProposalExecutionError extends Error {
  constructor(message, result = {}) {
    super(message);
    this.name = 'ProposalExecutionError';
    this.result = result;
  }
}

/**
 * Validate + normalize an X handle list. Shared by `benchmarks-change` and `strategy-profile-save`.
 * Strips @ / profile-URL noise via the same shape rule the plan uses; dedupes case-insensitively.
 * @returns {{ok:true, ownHandle?:string, benchmarkHandles:string[]} | {ok:false, errors:string[]}}
 */
export function normalizeHandleInput({ ownHandle, benchmarkHandles }, { requireOwn = false, requireBenchmarks = true } = {}) {
  const errors = [];
  const clean = (h) => String(h ?? '').trim().replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '').replace(/^@+/, '');
  let own;
  if (ownHandle !== undefined && ownHandle !== null && String(ownHandle).trim() !== '') {
    own = clean(ownHandle);
    if (!HANDLE_RE.test(own)) errors.push('ownHandle must be an X handle (1-15 letters, digits, underscore)');
  } else if (requireOwn) errors.push('ownHandle is required');
  // The agent may propose changing only one of the two; saveXGrowthProfile keeps whatever is not named.
  if (benchmarkHandles === undefined && !requireBenchmarks) {
    if (own === undefined) errors.push('provide ownHandle and/or benchmarkHandles');
    return errors.length ? { ok: false, errors } : { ok: true, ownHandle: own };
  }
  if (!Array.isArray(benchmarkHandles)) errors.push('benchmarkHandles must be an array');
  const seen = new Set();
  const list = [];
  for (const raw of Array.isArray(benchmarkHandles) ? benchmarkHandles : []) {
    const h = clean(raw);
    if (!HANDLE_RE.test(h)) { errors.push(`invalid benchmark handle: ${String(raw).slice(0, 30)}`); continue; }
    const k = h.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    list.push(h);
  }
  if (list.length > PLAN_LIMITS.maxBenchmarkHandles) errors.push(`at most ${PLAN_LIMITS.maxBenchmarkHandles} benchmark handles`);
  if (own && seen.has(own.toLowerCase())) errors.push('ownHandle cannot also be a benchmark');
  if (errors.length) return { ok: false, errors };
  return { ok: true, ...(own ? { ownHandle: own } : {}), benchmarkHandles: list };
}

const idField = (payload, key, errors) => {
  const v = typeof payload[key] === 'string' ? payload[key].trim() : '';
  if (!ID_RE.test(v)) errors.push(`${key} is required`);
  return v;
};

/**
 * Validate a raw proposal. Returns {ok, errors, proposal?} where `proposal` has the payload NORMALIZED
 * (only the fields its kind may carry). `currentPlan` (optional) is the plan the merged change is checked against.
 */
export function validateProposal(raw, { currentPlan } = {}) {
  const errors = [];
  if (!isPlain(raw)) return { ok: false, errors: ['proposal must be an object'] };
  const kind = raw.kind;
  if (!PROPOSAL_KINDS.includes(kind)) return { ok: false, errors: [`unknown proposal kind: ${String(kind).slice(0, 40)}`] };
  const payload = isPlain(raw.payload) ? raw.payload : null;
  if (!payload) return { ok: false, errors: ['payload must be an object'] };
  let norm = {};

  switch (kind) {
    case 'plan-change': {
      if (!isPlain(payload.changes) || !Object.keys(payload.changes).length) { errors.push('changes must be a non-empty object'); break; }
      if ('tier' in payload.changes) errors.push('tier is derived from authoredPerDay and cannot be set');
      if (!Number.isInteger(payload.expectedVersion) || payload.expectedVersion < 0) errors.push('expectedVersion must be a non-negative integer');
      if (!errors.length) {
        const merged = normalizePlan({ ...(currentPlan ?? DEFAULT_PLAN), ...clone(payload.changes) });
        const check = validatePlan(merged);
        if (!check.ok) errors.push(...check.errors);
      }
      norm = { changes: clone(payload.changes), expectedVersion: payload.expectedVersion };
      break;
    }
    case 'benchmarks-change': {
      const h = normalizeHandleInput(payload, { requireBenchmarks: false });
      if (!h.ok) errors.push(...h.errors); else norm = { ...(h.ownHandle ? { ownHandle: h.ownHandle } : {}), ...(h.benchmarkHandles ? { benchmarkHandles: h.benchmarkHandles } : {}) };
      break;
    }
    case 'suggestion-edit': {
      const suggestionId = idField(payload, 'suggestionId', errors);
      if (typeof payload.text !== 'string') errors.push('text must be a string');
      norm = { suggestionId, text: str(payload.text, TEXT_MAX) };
      break;
    }
    case 'suggestion-dismiss': norm = { suggestionId: idField(payload, 'suggestionId', errors) }; break;
    case 'suggestion-save-draft': {
      norm = { suggestionId: idField(payload, 'suggestionId', errors) };
      if (payload.text !== undefined) { if (typeof payload.text !== 'string') errors.push('text must be a string'); else norm.text = str(payload.text, TEXT_MAX); }
      break;
    }
    case 'item-story': {
      // The agent's propose_item_story tool names the field `itemId` (+ a `sourceQuote` it already enforced); the
      // update-item-facets body wants `id`. Accept either, normalize to `id`.
      const id = idField({ id: payload.id ?? payload.itemId }, 'id', errors);
      const story = typeof payload.story === 'string' ? payload.story.trim() : '';
      if (!story) errors.push('story is required');
      if (story.length > STORY_MAX) errors.push(`story must be at most ${STORY_MAX} characters`);
      const sourceQuote = typeof payload.sourceQuote === 'string' ? payload.sourceQuote.trim().slice(0, TEXT_MAX) : '';
      norm = { id, story, ...(sourceQuote ? { sourceQuote } : {}) }; // story ONLY: humanEdits / facets are never part of this payload; sourceQuote is display/audit only
      break;
    }
    // useModel is an OWNER decision made at confirm time (decide options), never part of a model-authored payload.
    case 'regenerate-today': norm = { useModel: false, force: payload.force === true }; break;
    case 'refresh-handles': {
      const hs = Array.isArray(payload.handles) ? payload.handles.map((h) => String(h ?? '').trim().replace(/^@+/, '')) : [];
      if (!hs.length) errors.push('handles must be a non-empty array');
      else if (hs.length > PLAN_LIMITS.maxHandlesPerRefreshRequest) errors.push(`at most ${PLAN_LIMITS.maxHandlesPerRefreshRequest} handles`);
      else if (hs.some((h) => !HANDLE_RE.test(h))) errors.push('handles must be valid X handles');
      norm = { handles: [...new Set(hs)] };
      break;
    }
    default: break;
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], proposal: { kind, payload: norm } };
}

/** Raw model proposal -> a pending, identified proposal. Pure (no validation: call validateProposal first). */
export function assignProposal(raw, { threadId, now, id } = {}) {
  const evidence = (Array.isArray(raw?.evidence) ? raw.evidence : []).slice(0, MAX_EVIDENCE)
    .filter((e) => isPlain(e)).map((e) => ({ source: str(e.source, 120), figure: str(e.figure, 200) }));
  return {
    id: id ?? randomUUID(),
    threadId,
    kind: raw.kind,
    payload: clone(raw.payload),
    summary: str(raw.summary, SUMMARY_MAX),
    rationale: str(raw.rationale, RATIONALE_MAX),
    evidence,
    status: 'pending',
    createdAt: iso(now),
  };
}

/** Keep stored results small: drop the whole `run` doc (the UI refetches it) and cap the rest. */
export function compactResult(res) {
  if (res === undefined) return null;
  let out = clone(res);
  if (isPlain(out) && 'run' in out) { const { run, ...rest } = out; out = { ...rest, runDate: run?.localDate ?? null }; }
  if (isPlain(out) && isPlain(out.plan) && out.plan.history) out.plan = { version: out.plan.version, updatedAt: out.plan.updatedAt };
  return JSON.stringify(out ?? null).length > RESULT_MAX_CHARS ? { truncated: true } : out;
}

/**
 * Executors for each kind, over injected capabilities. Each takes
 * ({clientId, payload, by, proposalId, proposal, context, auth, now}) and returns a result or throws.
 * @param {Object} deps
 * @param {{get:Function,apply:Function}} deps.planStore
 * @param {(context:object, action:string, body:object)=>Promise<object>} [deps.runDailyAction]
 * @param {(context:object, body:object)=>Promise<object>} [deps.runUpdateItemFacets]
 * @param {(clientId:string, profile:object)=>Promise<object>} [deps.saveXGrowthProfile]
 * @param {(args:{clientId:string, handles:string[], context:object, auth:object})=>Promise<object>} [deps.refreshHandles]
 */
export function buildExecutors({ planStore, runDailyAction, runUpdateItemFacets, saveXGrowthProfile, refreshHandles, clock = Date.now }) {
  const need = (fn, name) => { if (typeof fn !== 'function') throw new ProposalExecutionError(`${name} is not available on this deployment`); return fn; };
  const daily = (action, body) => async ({ context }) => {
    const res = await need(runDailyAction, 'daily-run actions')(context, action, body);
    if (res && res.ok === false) throw new ProposalExecutionError(res.error || 'action refused', { ...compactResult(res), ok: false });
    return compactResult(res);
  };
  return {
    async 'plan-change'({ clientId, payload, by, proposalId, proposal }) {
      const cur = await planStore.get(clientId);
      const currentVersion = cur?.version ?? 0;
      if (currentVersion !== payload.expectedVersion) throw new ProposalExecutionError('plan changed since this was proposed', { error: 'stale', currentVersion });
      try {
        const out = await planStore.apply(clientId, {
          changes: payload.changes, expectedVersion: payload.expectedVersion, reason: proposal?.summary || '',
          by, source: 'chat', proposalId, now: clock(),
        });
        return { changed: out.changed, version: out.doc?.version ?? currentVersion };
      } catch (err) {
        if (err instanceof StrategyPlanError && err.code === 'version-conflict') {
          throw new ProposalExecutionError('plan changed since this was proposed', { error: 'stale', currentVersion: err.currentVersion ?? null });
        }
        throw err;
      }
    },
    async 'benchmarks-change'({ clientId, payload }) {
      const h = normalizeHandleInput(payload, { requireBenchmarks: false }); // re-validate at execute time
      if (!h.ok) throw new ProposalExecutionError(h.errors.join('; '));
      const saved = await need(saveXGrowthProfile, 'profile save')(clientId, { ...(h.ownHandle ? { ownHandle: h.ownHandle } : {}), ...(h.benchmarkHandles ? { benchmarkHandles: h.benchmarkHandles } : {}) });
      return { ownHandle: saved?.ownHandle ?? h.ownHandle ?? null, benchmarkHandles: saved?.benchmarkHandles ?? h.benchmarkHandles ?? null };
    },
    'suggestion-edit': ({ payload, context }) => daily('daily-run-edit', { suggestionId: payload.suggestionId, text: payload.text })({ context }),
    'suggestion-dismiss': ({ payload, context }) => daily('daily-run-dismiss', { suggestionId: payload.suggestionId })({ context }),
    'suggestion-save-draft': ({ payload, context }) => daily('daily-run-save-draft', {
      suggestionId: payload.suggestionId, ...(payload.text !== undefined ? { text: payload.text } : {}),
    })({ context }),
    async 'item-story'({ payload, context }) {
      // story ONLY - never humanEdits.
      const res = await need(runUpdateItemFacets, 'item update')(context, { id: payload.id, story: payload.story });
      if (res && res.ok === false) throw new ProposalExecutionError(res.error || 'update refused');
      return compactResult(res);
    },
    // Model drafting is OFF unless the OWNER ticked it at confirm time (options.useModel); payload.useModel is ignored.
    'regenerate-today': ({ payload, context, options }) => daily('daily-run-generate', { draftWithModel: options?.useModel === true, force: payload.force === true })({ context }),
    async 'refresh-handles'({ clientId, payload, context, auth }) {
      const res = await need(refreshHandles, 'refresh')({ clientId, handles: payload.handles, context, auth });
      if (res && res.ok === false) throw new ProposalExecutionError(res.error || 'refresh refused');
      return compactResult(res);
    },
  };
}

/**
 * Decide one proposal. Does NOT persist - returns the updated proposal for the caller to save.
 * - not pending            -> {ok:false, status:409} (idempotent: nothing runs twice)
 * - reject                 -> status 'rejected', executors untouched
 * - confirm                -> exactly executors[kind]; ok => 'confirmed'; throw => 'failed' (message / structured result)
 * @returns {Promise<{ok:boolean, status?:number, error?:string, proposal?:object}>}
 */
export async function decideProposal({ proposal, decision, executors, context, clientId, by = 'admin', auth, options, now = Date.now() }) {
  if (!proposal || !PROPOSAL_STATUSES.includes(proposal.status)) return { ok: false, status: 404, error: 'Proposal not found.' };
  if (decision !== 'confirm' && decision !== 'reject') return { ok: false, status: 400, error: "decision must be 'confirm' or 'reject'" };
  if (proposal.status !== 'pending') return { ok: false, status: 409, error: `Proposal already ${proposal.status}.`, proposal };
  const base = { ...proposal };
  delete base.decidingAt;
  const decidedAt = iso(now);
  if (decision === 'reject') return { ok: true, proposal: { ...base, status: 'rejected', decidedAt, decidedBy: by } };

  const run = executors?.[proposal.kind];
  if (typeof run !== 'function') {
    return { ok: true, proposal: { ...base, status: 'failed', decidedAt, decidedBy: by, result: { error: `no executor for ${proposal.kind}` } } };
  }
  try {
    const result = await run({ clientId, payload: clone(proposal.payload), by, proposalId: proposal.id, proposal, context, auth, options: isPlain(options) ? { ...options } : {}, now });
    return { ok: true, proposal: { ...base, status: 'confirmed', decidedAt, decidedBy: by, result: result ?? { done: true } } };
  } catch (err) {
    const structured = err instanceof ProposalExecutionError ? err.result : {};
    const result = { error: 'failed', message: String(err?.message || err).slice(0, 300), ...structured, ...(structured.error ? { error: structured.error } : {}) };
    return { ok: true, proposal: { ...base, status: 'failed', decidedAt, decidedBy: by, result } };
  }
}
