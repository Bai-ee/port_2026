// proposals.js - proposal shape, validation and confirm/reject execution (T4b).
// Pure + injected I/O: nothing here imports a store or a model. A proposal NEVER runs anything until the
// owner confirms it; confirm runs exactly the one action mapped to its kind (PROPOSAL_KIND_ACTIONS) through
// an injected executor. Reject executes nothing.

import { randomUUID } from 'node:crypto';
import { PROPOSAL_KINDS, PROPOSAL_STATUSES, PLAN_LIMITS, DEFAULT_PLAN, PAID_SYNC_KINDS, BULK_LIMITS, DAILY_FILL_INCLUDES, QUEUE_BULK_ACTIONS, BUCKET_EDIT_OPS, REFRESH_GROUP_IDS } from '../contracts.js';
import { SOURCE_KINDS } from '../../x-content-inventory/buckets.js';
import { normalizePlan, validatePlan, HANDLE_RE } from '../plan-state.js';
import { StrategyPlanError } from '../plan-store.js';
import { SECTION_KEYS, SECTION_MAX } from '../strategy-doc.js';
import { StrategyDocError } from '../strategy-doc-store.js';
import { normalizeBatchSpec } from '../../x-content-inventory/calendar-batch.js';
import { normalizeLinks } from '../../x-content-inventory/item-media.js';
import { normalizeActionPayload, requiredTypedText } from './action-runtime.js';
import { MAX_MEMORY_SUGGESTIONS, normalizeMemoryLine, applyMemoryLine } from '../../x-content-inventory/memory-suggest.js';
import { MAX_MEDIA_TASKS, TASK_KINDS } from '../../x-content-inventory/content-tasks.js';

export const SUMMARY_MAX = 200;
export const RATIONALE_MAX = 800;
export const STORY_MAX = 1000;
export const TEXT_MAX = 1000;
export const MAX_EVIDENCE = 8;
export const PAID_SYNC_PARAMS_MAX = 4000; // serialized params of a paid-sync proposal
export const PAID_SYNC_ESTIMATE_MAX = 400;
export const POST_TEXT_MAX = 280; // X limit; matches updateSocialPost
export const EDITABLE_POST_STATUSES = Object.freeze(['draft', 'approved', 'scheduled']);
const RESULT_MAX_CHARS = 4000;
const ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const BUCKET_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const BUCKET_SHARE_KEYS = ['perDayMin', 'perDayMax', 'targetPerDay', 'perWeekMin', 'perWeekMax', 'maxSharePct'];

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
export function validateProposal(raw, { currentPlan, registry } = {}) {
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
    case 'strategy-doc-edit': {
      const section = typeof payload.section === 'string' ? payload.section.trim() : '';
      if (!SECTION_KEYS.includes(section)) errors.push(`section must be one of ${SECTION_KEYS.join(', ')}`);
      if (typeof payload.text !== 'string') errors.push('text must be a string');
      else if (payload.text.trim().length > SECTION_MAX) errors.push(`text must be at most ${SECTION_MAX} characters`);
      if (!Number.isInteger(payload.expectedVersion) || payload.expectedVersion < 0) errors.push('expectedVersion must be a non-negative integer');
      norm = { section, text: typeof payload.text === 'string' ? payload.text.trim() : '', expectedVersion: payload.expectedVersion };
      break;
    }
    case 'post-edit': {
      const postId = idField(payload, 'postId', errors);
      const hasText = payload.text !== undefined;
      const hasTime = payload.scheduledAt !== undefined;
      if (!hasText && !hasTime) errors.push('provide text and/or scheduledAt');
      norm = { postId };
      if (hasText) {
        const text = typeof payload.text === 'string' ? payload.text.trim() : '';
        if (!text) errors.push('text must be a non-empty string');
        else if (text.length > POST_TEXT_MAX) errors.push(`text must be at most ${POST_TEXT_MAX} characters`);
        norm.text = text;
      }
      if (hasTime) {
        const ms = typeof payload.scheduledAt === 'string' ? Date.parse(payload.scheduledAt) : NaN;
        if (Number.isNaN(ms)) errors.push('scheduledAt must be an ISO time');
        else norm.scheduledAt = new Date(ms).toISOString();
      }
      const stamp = typeof payload.expectedUpdatedAt === 'string' ? payload.expectedUpdatedAt.trim() : '';
      if (!stamp) errors.push('expectedUpdatedAt is required (the post updatedAt from get_post)');
      norm.expectedUpdatedAt = stamp;
      // Display-only snapshot for the card (current vs new); never used by the executor.
      if (typeof payload.currentText === 'string') norm.currentText = payload.currentText.slice(0, POST_TEXT_MAX * 2);
      if (typeof payload.currentScheduledAt === 'string') norm.currentScheduledAt = payload.currentScheduledAt.slice(0, 40);
      if (typeof payload.currentStatus === 'string') norm.currentStatus = payload.currentStatus.slice(0, 20);
      break;
    }
    case 'post-approve':
    case 'post-schedule':
    case 'post-unschedule': {
      const postId = idField(payload, 'postId', errors);
      norm = { postId };
      if (kind === 'post-schedule') {
        const ms = typeof payload.scheduledAt === 'string' ? Date.parse(payload.scheduledAt) : NaN;
        if (Number.isNaN(ms)) errors.push('scheduledAt must be an ISO time');
        else if (ms <= Date.now()) errors.push('scheduledAt must be in the future');
        else norm.scheduledAt = new Date(ms).toISOString();
      }
      const stamp = typeof payload.expectedUpdatedAt === 'string' ? payload.expectedUpdatedAt.trim() : '';
      if (!stamp) errors.push('expectedUpdatedAt is required (the post updatedAt from get_post)');
      norm.expectedUpdatedAt = stamp;
      // Display-only snapshot for the card; never used by the executor.
      if (typeof payload.currentText === 'string') norm.currentText = payload.currentText.slice(0, POST_TEXT_MAX * 2);
      if (typeof payload.currentScheduledAt === 'string') norm.currentScheduledAt = payload.currentScheduledAt.slice(0, 40);
      if (typeof payload.currentStatus === 'string') norm.currentStatus = payload.currentStatus.slice(0, 20);
      break;
    }
    // Created ONLY by server code (the MCP server's request_sync, which prices + validates it first). Shape-checked here;
    // the executor (features/mcp/paid-syncs.js) re-validates the params at confirm time.
    case 'paid-sync': {
      const syncKind = typeof payload.kind === 'string' ? payload.kind.trim() : '';
      if (!PAID_SYNC_KINDS.includes(syncKind)) errors.push(`kind must be one of ${PAID_SYNC_KINDS.join(', ')}`);
      if (!isPlain(payload.params)) errors.push('params must be an object');
      else if (JSON.stringify(payload.params).length > PAID_SYNC_PARAMS_MAX) errors.push('params are too large');
      const estimate = str(payload.estimate, PAID_SYNC_ESTIMATE_MAX);
      if (!estimate) errors.push('estimate is required (what the owner will be charged)');
      norm = { kind: syncKind, params: isPlain(payload.params) ? clone(payload.params) : {}, estimate };
      break;
    }
    // Bulk review drafts (calendar-batch.js). The spec is re-planned against live data at confirm time; `preview` is
    // the propose-time dry run, display only.
    case 'calendar-batch': {
      const spec = normalizeBatchSpec(payload.spec);
      if (!spec.ok) { errors.push(...spec.errors); break; }
      norm = { spec: spec.spec, ...(isPlain(payload.preview) ? { preview: clone(payload.preview) } : {}) };
      break;
    }
    // Item media links (item-media.js). `rows` = the propose-time titles/kinds, display only.
    case 'item-media': {
      const l = normalizeLinks(payload.links);
      if (!l.ok) { errors.push(...l.errors); break; }
      norm = { links: l.links, ...(Array.isArray(payload.rows) ? { rows: clone(payload.rows).slice(0, l.links.length) } : {}) };
      break;
    }
    // Suggested memory lines for drafts that still carry a placeholder. `rows` = propose-time snapshot (the line is a
    // SUGGESTION: the owner edits or skips each row on the card; the decide body carries {edits, skip}).
    case 'memory-suggest': {
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      if (!rows.length) { errors.push('rows must be a non-empty list'); break; }
      if (rows.length > MAX_MEMORY_SUGGESTIONS) { errors.push(`at most ${MAX_MEMORY_SUGGESTIONS} posts`); break; }
      const seen = new Set();
      const out = [];
      for (const r of rows) {
        const postId = isPlain(r) ? str(r.postId, 128) : '';
        if (!ID_RE.test(postId)) { errors.push('rows contains an invalid postId'); break; }
        if (seen.has(postId)) continue;
        seen.add(postId);
        const line = normalizeMemoryLine(r.suggestion);
        if (!line.ok) { errors.push(`${postId}: ${line.error}`); break; }
        out.push({ postId, expectedUpdatedAt: str(r.expectedUpdatedAt, 60), title: str(r.title, 90) || null, currentText: str(r.currentText, POST_TEXT_MAX * 2), suggestion: line.line, source: r.source === 'agent' ? 'agent' : 'facts' });
      }
      if (errors.length) break;
      norm = { rows: out };
      break;
    }
    // "Film this" reminders (content_tasks). Never touches a post or an item.
    case 'media-tasks': {
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      if (!rows.length) { errors.push('rows must be a non-empty list'); break; }
      if (rows.length > MAX_MEDIA_TASKS) { errors.push(`at most ${MAX_MEDIA_TASKS} tasks`); break; }
      const seen = new Set();
      const out = [];
      for (const r of rows) {
        const postId = isPlain(r) ? str(r.postId, 128) : '';
        if (!ID_RE.test(postId)) { errors.push('rows contains an invalid postId'); break; }
        if (seen.has(postId)) continue;
        seen.add(postId);
        const dueOn = str(r.dueOn, 10);
        if (!DAY_RE.test(dueOn) || Number.isNaN(Date.parse(`${dueOn}T00:00:00Z`))) { errors.push(`${postId}: dueOn must be a YYYY-MM-DD date`); break; }
        const kind = TASK_KINDS.includes(r.kind) ? r.kind : 'film';
        const reviewOn = DAY_RE.test(str(r.reviewOn, 10)) ? str(r.reviewOn, 10) : null;
        out.push({ postId, packageId: str(r.packageId, 128) || null, title: str(r.title, 90) || postId, kind, dueOn, reviewOn, ...(r.existing === true ? { existing: true } : {}) });
      }
      if (errors.length) break;
      norm = { rows: out };
      break;
    }
    // Multi-day fill of the calendar (x-content-inventory/daily-fill.js): DRAFTS only. `preview` = propose-time counts + sample rows, display only.
    case 'daily-fill': {
      const from = typeof payload.from === 'string' ? payload.from.trim() : '';
      if (!DAY_RE.test(from) || Number.isNaN(Date.parse(`${from}T00:00:00Z`))) errors.push('from must be a YYYY-MM-DD date');
      const days = Number(payload.days);
      if (!Number.isInteger(days) || days < 1 || days > BULK_LIMITS.dailyFillMaxDays) errors.push(`days must be a whole number 1-${BULK_LIMITS.dailyFillMaxDays}`);
      let include = DAILY_FILL_INCLUDES.slice();
      if (payload.include !== undefined) {
        const inc = Array.isArray(payload.include) ? [...new Set(payload.include.map((x) => String(x ?? '').trim()))] : null;
        if (!inc || !inc.length || inc.some((x) => !DAILY_FILL_INCLUDES.includes(x))) errors.push(`include must be a non-empty list from ${DAILY_FILL_INCLUDES.join(', ')}`);
        else include = inc;
      }
      if (errors.length) break;
      norm = { from, days, include, ...(isPlain(payload.preview) ? { preview: clone(payload.preview) } : {}) };
      break;
    }
    // Runs NOTHING on the server: confirm hands the group ids to the dashboard, whose Refresh panel runs them.
    case 'refresh': {
      const groups = Array.isArray(payload.groups) ? [...new Set(payload.groups.map((g) => String(g ?? '').trim()))] : [];
      if (!groups.length) errors.push('groups must be a non-empty list');
      else if (groups.some((g) => !REFRESH_GROUP_IDS.includes(g))) errors.push(`groups must be from ${REFRESH_GROUP_IDS.join(', ')}`);
      if (errors.length) break;
      norm = {
        groups, reason: str(payload.reason, BULK_LIMITS.refreshReasonMax),
        ...(Array.isArray(payload.estimate) ? { estimate: payload.estimate.slice(0, REFRESH_GROUP_IDS.length).filter(isPlain).map((e) => ({ id: str(e.id, 40), label: str(e.label, 80), text: str(e.text, 200), paid: e.paid === true })) } : {}),
      };
      break;
    }
    // Drafts / queue only. Never schedules or publishes. `rows` = propose-time snapshot, display only.
    case 'queue-bulk': {
      const action = typeof payload.action === 'string' ? payload.action.trim() : '';
      if (!QUEUE_BULK_ACTIONS.includes(action)) errors.push(`action must be one of ${QUEUE_BULK_ACTIONS.join(', ')}`);
      const ids = Array.isArray(payload.postIds) ? [...new Set(payload.postIds.map((x) => String(x ?? '').trim()))] : [];
      if (!ids.length) errors.push('postIds must be a non-empty list');
      else if (ids.length > BULK_LIMITS.queueBulkMax) errors.push(`at most ${BULK_LIMITS.queueBulkMax} posts`);
      else if (ids.some((x) => !ID_RE.test(x))) errors.push('postIds contains an invalid id');
      norm = { action, postIds: ids };
      if (action === 'set-review-date') {
        const date = typeof payload.date === 'string' ? payload.date.trim() : '';
        if (!DAY_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) errors.push('date must be a YYYY-MM-DD date');
        norm.date = date;
      }
      if (Array.isArray(payload.rows)) norm.rows = clone(payload.rows).slice(0, BULK_LIMITS.queueBulkMax);
      break;
    }
    // Content Center bucket upsert/delete (the quote-targets bucket store), then the tracks re-sync.
    case 'bucket-edit': {
      const op = typeof payload.op === 'string' ? payload.op.trim() : '';
      if (!BUCKET_EDIT_OPS.includes(op)) { errors.push(`op must be one of ${BUCKET_EDIT_OPS.join(', ')}`); break; }
      const b = isPlain(payload.bucket) ? payload.bucket : null;
      if (!b) { errors.push('bucket must be an object'); break; }
      const id = typeof b.id === 'string' ? b.id.trim() : '';
      if (id && !BUCKET_ID_RE.test(id)) errors.push('bucket.id must be lowercase kebab-case, at most 40 characters');
      if (op === 'delete') {
        if (!id) errors.push('bucket.id is required to delete');
        const reassignTo = typeof payload.reassignTo === 'string' ? payload.reassignTo.trim() : '';
        if (reassignTo && !BUCKET_ID_RE.test(reassignTo)) errors.push('reassignTo must be a bucket id');
        norm = { op, bucket: { id, ...(typeof b.name === 'string' ? { name: str(b.name, BULK_LIMITS.bucketLabelMax) } : {}) }, ...(reassignTo ? { reassignTo } : {}) };
        break;
      }
      const name = str(b.name, 60);
      if (!name && !id) errors.push('bucket.name is required');
      const bucket = { ...(id ? { id } : {}), ...(name ? { name } : {}) };
      if (b.sourceKind !== undefined) { if (!SOURCE_KINDS.includes(b.sourceKind)) errors.push(`sourceKind must be one of ${SOURCE_KINDS.join(', ')}`); else bucket.sourceKind = b.sourceKind; }
      else if (!id) bucket.sourceKind = 'manual';
      if (b.color !== undefined) { if (typeof b.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(b.color.trim())) errors.push('color must be a #rrggbb value'); else bucket.color = b.color.trim(); }
      if (b.active !== undefined) bucket.active = b.active === true;
      if (b.order !== undefined) { if (!Number.isInteger(b.order) || b.order < 0) errors.push('order must be a non-negative integer'); else bucket.order = b.order; }
      if (b.share !== undefined) {
        if (!isPlain(b.share)) errors.push('share must be an object');
        else {
          const share = {};
          for (const [k, v] of Object.entries(b.share)) {
            if (!BUCKET_SHARE_KEYS.includes(k)) errors.push(`unknown share field ${k}`);
            else if (!(Number.isFinite(v) && v >= 0)) errors.push(`share.${k} must be a non-negative number`);
            else share[k] = v;
          }
          bucket.share = share;
        }
      }
      norm = { op, bucket };
      break;
    }
    // Any registry action (tier 1-3). The payload is REBUILT from the registry entry, never trusted from the model.
    case 'action': {
      const n = normalizeActionPayload(payload, { registry });
      if (!n.ok) errors.push(...n.errors); else norm = n.payload;
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
 * @param {{get:Function,apply:Function}} [deps.docStore]  strategy-doc-store.js
 * @param {object} [deps.docBase]  sections to start from when no doc is saved yet (the seed draft)
 * @param {(clientId:string, postId:string)=>Promise<object|null>} [deps.readPost]  client-scoped read of the raw post (post-edit)
 * @param {(a:{clientId:string, postId:string, content?:string, scheduledAt?:string})=>Promise<object>} [deps.editPost]  the existing update path (updateSocialPost)
 * @param {(clientId:string, postId:string, o:{reviewedBy:string, expectedRevision?:number})=>Promise<object>} [deps.approvePost]  existing approveDraft (default: lazy import of twitter-service)
 * @param {(clientId:string, postId:string, o:{scheduledAt:string, reviewedBy:string, expectedRevision?:number})=>Promise<object>} [deps.approveAndSchedulePost]  existing approveAndSchedule (ledger/reservation path; default: lazy import)
 * @param {(a:{clientId:string, spec:object, proposalId?:string})=>Promise<object>} [deps.runDailyFill]  daily-fill executor (execute=true: creates drafts only)
 * @param {(clientId:string, postId:string, o:{reviewedBy:string, expectedRevision?:number})=>Promise<object>} [deps.rejectPost]  existing rejectDraft (queue-bulk delete-draft; default: lazy import)
 * @param {(clientId:string, postId:string, patch:{reviewOn:string})=>Promise<boolean>} [deps.placeDraft]  sets an unscheduled draft's review day (queue-bulk set-review-date)
 * @param {(clientId:string, bucket:object)=>Promise<object>} [deps.upsertBucket]  bucket-store upsertBucket
 * @param {(clientId:string, bucketId:string, o:{reassignTo?:string})=>Promise<object>} [deps.deleteBucket]  bucket-store deleteBucket
 * @param {(a:{clientId:string, rows:object[], by:string, proposalId?:string})=>Promise<{created:number,existing:number}>} [deps.runMediaTasks]  content_tasks writer (media-tasks)
 * @param {(clientId:string)=>Promise<object>} [deps.syncTracks]  re-sync content tracks after a bucket change
 * @param {(a:{clientId:string, kind:string, params:object, by:string, auth:object, context:object})=>Promise<object>} [deps.runPaidSync]  features/mcp/paid-syncs.js executor (daily cap enforced inside)
 */
export function buildExecutors({ planStore, runDailyAction, runUpdateItemFacets, saveXGrowthProfile, refreshHandles, docStore, docBase, readPost, editPost, approvePost, approveAndSchedulePost, runPaidSync, runCalendarBatch, runItemMedia, runDailyFill, rejectPost, placeDraft, upsertBucket, deleteBucket, syncTracks, runAction, runMediaTasks, clock = Date.now }) {
  const need = (fn, name) => { if (typeof fn !== 'function') throw new ProposalExecutionError(`${name} is not available on this deployment`); return fn; };
  const social = () => import('../../social-posting/twitter-service.js');
  const readOwnedPost = async (clientId, payload) => {
    const post = await need(readPost, 'post read')(clientId, payload.postId);
    if (!post || (post.clientId && post.clientId !== clientId)) throw new ProposalExecutionError('post not found for this client', { error: 'not-found' });
    if ((post.updatedAt || '') !== payload.expectedUpdatedAt) throw new ProposalExecutionError('post changed since this was proposed', { error: 'stale', currentUpdatedAt: post.updatedAt || null });
    return post;
  };
  const mapPostError = (err) => {
    if (err instanceof ProposalExecutionError) throw err;
    if (err?.code === 'revision-conflict') throw new ProposalExecutionError('post changed since this was proposed', { error: 'stale' });
    throw err;
  };
  const postResult = (payload, saved) => ({ postId: payload.postId, status: saved?.status ?? null, scheduledAt: saved?.scheduledAt ?? null, updatedAt: saved?.updatedAt ?? null });
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
        return { changed: out.changed, version: out.doc?.version ?? currentVersion, ...(out.profileSync ? { profileSync: out.profileSync } : {}) };
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
    // Writes ONE section of the strategy document, version-checked, recorded as source 'chat' (never confirms a draft).
    async 'strategy-doc-edit'({ clientId, payload, by, proposalId, proposal }) {
      if (!docStore || typeof docStore.apply !== 'function') throw new ProposalExecutionError('strategy document is not available on this deployment');
      const store = docStore;
      const cur = await store.get(clientId);
      const currentVersion = cur?.version ?? 0;
      if (currentVersion !== payload.expectedVersion) throw new ProposalExecutionError('strategy changed since this was proposed', { error: 'stale', currentVersion });
      try {
        const out = await store.apply(clientId, {
          sections: { [payload.section]: payload.text }, expectedVersion: payload.expectedVersion, by, source: 'chat', proposalId,
          reason: proposal?.summary || '', now: clock(), base: docBase,
        });
        return { changed: out.changed, version: out.doc?.version ?? currentVersion, section: payload.section };
      } catch (err) {
        if (err instanceof StrategyDocError && err.code === 'version-conflict') {
          throw new ProposalExecutionError('strategy changed since this was proposed', { error: 'stale', currentVersion: err.currentVersion ?? null });
        }
        throw err;
      }
    },
    // Edits ONE queued post through the existing update path. Re-reads and re-checks everything at confirm time.
    // Never approves, schedules from nothing, or publishes: a scheduled post stays scheduled (at the new time),
    // and updateSocialPost itself decides what an edit does to approval (it can void it back to draft).
    async 'post-edit'({ clientId, payload }) {
      const read = need(readPost, 'post read');
      const edit = need(editPost, 'post edit');
      const post = await read(clientId, payload.postId);
      if (!post || (post.clientId && post.clientId !== clientId)) throw new ProposalExecutionError('post not found for this client', { error: 'not-found' });
      if (!EDITABLE_POST_STATUSES.includes(post.status)) throw new ProposalExecutionError(`post is ${post.status} and can no longer be edited from chat`, { error: 'not-editable', status: post.status });
      if ((post.updatedAt || '') !== payload.expectedUpdatedAt) throw new ProposalExecutionError('post changed since this was proposed', { error: 'stale', currentUpdatedAt: post.updatedAt || null });
      const body = { clientId, postId: payload.postId, ...(Number.isInteger(post.revision) ? { expectedRevision: post.revision } : {}) };
      if (payload.text !== undefined) body.content = payload.text;
      if (payload.scheduledAt !== undefined) {
        if (post.status !== 'scheduled') throw new ProposalExecutionError('only a scheduled post can be moved to a new time from chat', { error: 'not-scheduled', status: post.status });
        if (Date.parse(payload.scheduledAt) <= clock()) throw new ProposalExecutionError('the new time must be in the future', { error: 'past-time' });
        body.scheduledAt = payload.scheduledAt;
      }
      let saved;
      try { saved = await edit(body); } catch (err) {
        if (err?.code === 'revision-conflict') throw new ProposalExecutionError('post changed since this was proposed', { error: 'stale' });
        throw err;
      }
      return { postId: payload.postId, status: saved?.status ?? null, scheduledAt: saved?.scheduledAt ?? null, updatedAt: saved?.updatedAt ?? null };
    },
    // Approve / schedule / unschedule ONE queued post through the EXISTING social-posting paths (same functions as the
    // Queue & Calendar buttons: approveDraft, approveAndSchedule, updateSocialPost). They only change post state;
    // the process-due cron is the only publisher. Everything is re-read and re-checked at confirm time.
    async 'post-approve'({ clientId, payload, by }) {
      const post = await readOwnedPost(clientId, payload);
      if (post.status !== 'draft' && post.status !== 'approved') throw new ProposalExecutionError(`post is ${post.status}; only a draft can be approved`, { error: 'not-approvable', status: post.status });
      const approve = approvePost ?? (await social()).approveDraft;
      const saved = await approve(clientId, payload.postId, { reviewedBy: by, ...(Number.isInteger(post.revision) ? { expectedRevision: post.revision } : {}) }).catch(mapPostError);
      return postResult(payload, saved);
    },
    async 'post-schedule'({ clientId, payload, by }) {
      const post = await readOwnedPost(clientId, payload);
      if (post.status !== 'draft' && post.status !== 'approved') throw new ProposalExecutionError(`post is ${post.status}; only a draft or approved post can be scheduled (edit a scheduled post's time instead)`, { error: 'not-schedulable', status: post.status });
      if (Date.parse(payload.scheduledAt) <= clock()) throw new ProposalExecutionError('the time must be in the future', { error: 'past-time' });
      const schedule = approveAndSchedulePost ?? (await social()).approveAndSchedule;
      const saved = await schedule(clientId, payload.postId, { scheduledAt: payload.scheduledAt, reviewedBy: by, ...(Number.isInteger(post.revision) ? { expectedRevision: post.revision } : {}) }).catch(mapPostError);
      return postResult(payload, saved);
    },
    async 'post-unschedule'({ clientId, payload }) {
      const post = await readOwnedPost(clientId, payload);
      if (post.status !== 'scheduled') throw new ProposalExecutionError(`post is ${post.status}; only a scheduled post can be unscheduled`, { error: 'not-scheduled', status: post.status });
      const edit = need(editPost, 'post edit');
      // Clearing scheduledAt through the existing update path returns it to approved (or draft) and releases its slot.
      const saved = await edit({ clientId, postId: payload.postId, scheduledAt: '', ...(Number.isInteger(post.revision) ? { expectedRevision: post.revision } : {}) }).catch(mapPostError);
      return postResult(payload, saved);
    },
    // The ONLY way a paid sync from MCP ever runs: the owner pressed Confirm on this card in HITLOOP.
    async 'paid-sync'({ clientId, payload, by, context, auth }) {
      const res = await need(runPaidSync, 'paid syncs')({ clientId, kind: payload.kind, params: payload.params, by, auth, context });
      return compactResult(res);
    },
    // Copies media refs between library items of this client. Never touches a post; each link succeeds or fails alone.
    async 'item-media'({ clientId, payload }) {
      const res = await need(runItemMedia, 'item media')({ clientId, links: payload.links });
      if (!res?.linked && res?.failed) throw new ProposalExecutionError('no link could be made', { results: (res.results || []).slice(0, 10) });
      return compactResult({ linked: res.linked, failed: res.failed, results: (res.results || []).filter((r) => !r.ok).slice(0, 10) });
    },
    // Writes review DRAFTS only (status draft, no schedule); items already on the queue are skipped, re-runs add nothing.
    async 'calendar-batch'({ clientId, payload, proposalId }) {
      const res = await need(runCalendarBatch, 'calendar batch')({ clientId, spec: payload.spec, proposalId });
      if (res && res.ok === false) throw new ProposalExecutionError(res.error || 'calendar batch refused');
      return compactResult({ created: res.created, existing: res.existing, failed: (res.failed || []).length, counts: res.counts, firstDate: res.firstDate, lastDate: res.lastDate });
    },
    // Multi-day fill: DRAFTS only (review day set, never approved/scheduled/published); re-runs add nothing (idempotent keys).
    async 'daily-fill'({ clientId, payload, proposalId }) {
      const res = await need(runDailyFill, 'daily fill')({ clientId, spec: { from: payload.from, days: payload.days, include: payload.include }, proposalId });
      if (res && res.ok === false) throw new ProposalExecutionError(res.error || 'daily fill refused');
      const failed = Array.isArray(res?.failed) ? res.failed.length : Number(res?.failed) || 0;
      return compactResult({ created: res?.created ?? 0, existing: res?.existing ?? 0, placed: res?.placed ?? 0, failed, counts: res?.counts, firstDate: res?.firstDate, lastDate: res?.lastDate });
    },
    // Replaces the placeholder in each non-skipped draft with the owner-approved line (edits[postId] wins over the
    // suggestion). Each post goes through the existing update path, revision-checked; one stale/failed post fails alone.
    // Never approves, schedules or publishes. `options` = {edits, skip}, sanitized by the decide route.
    async 'memory-suggest'({ clientId, payload, options }) {
      const read = need(readPost, 'post read');
      const edit = need(editPost, 'post edit');
      const skip = new Set(Array.isArray(options?.skip) ? options.skip : []);
      const edits = isPlain(options?.edits) ? options.edits : {};
      const results = [];
      let skipped = 0;
      for (const row of payload.rows) {
        if (skip.has(row.postId)) { skipped += 1; continue; }
        try {
          const post = await read(clientId, row.postId);
          if (!post || (post.clientId && post.clientId !== clientId)) throw Object.assign(new Error('post not found for this client'), { code: 'not-found' });
          if (post.status !== 'draft') throw Object.assign(new Error(`post is ${post.status}; only a draft can take a memory line`), { code: 'not-draft' });
          if (row.expectedUpdatedAt && (post.updatedAt || '') !== row.expectedUpdatedAt) throw Object.assign(new Error('post changed since this was proposed'), { code: 'stale' });
          const applied = applyMemoryLine(post.content ?? post.text, typeof edits[row.postId] === 'string' ? edits[row.postId] : row.suggestion);
          if (!applied.ok) throw Object.assign(new Error(applied.error), { code: 'cannot-apply' });
          // needsStory is cleared explicitly (updateSocialPost only derives it for calendar-batch / daily-fill drafts).
          await edit({ clientId, postId: row.postId, content: applied.content, needsStory: false, ...(Number.isInteger(post.revision) ? { expectedRevision: post.revision } : {}) });
          results.push({ postId: row.postId, ok: true });
        } catch (err) {
          results.push({ postId: row.postId, ok: false, error: err?.code === 'revision-conflict' ? 'stale' : err?.code || 'failed', reason: err?.code === 'revision-conflict' ? 'changed since this was proposed' : String(err?.message || err).slice(0, 160) });
        }
      }
      const updated = results.filter((r) => r.ok).length;
      const failedRows = results.filter((r) => !r.ok);
      if (!updated && failedRows.length) throw new ProposalExecutionError('no draft could be updated', { results: failedRows.slice(0, 10) });
      return compactResult({ updated, skipped, failed: failedRows.length, results: failedRows.slice(0, 10) });
    },
    // Writes content_tasks reminders only; idempotent per post (re-runs report `existing`).
    async 'media-tasks'({ clientId, payload, by, proposalId }) {
      const res = await need(runMediaTasks, 'media tasks')({ clientId, rows: payload.rows, by, proposalId });
      return compactResult({ created: res?.created ?? 0, existing: res?.existing ?? 0 });
    },
    // Runs NOTHING here. The dashboard (StrategyChat) sees clientAction and fires the Refresh panel's own run.
    async refresh({ payload }) {
      return { clientAction: 'marketing-refresh', groups: payload.groups.filter((g) => REFRESH_GROUP_IDS.includes(g)) };
    },
    // Per-post results; a post that cannot take the action fails alone with a reason. Never schedules or publishes.
    async 'queue-bulk'({ clientId, payload, by }) {
      const read = need(readPost, 'post read');
      const results = [];
      for (const postId of payload.postIds) {
        try {
          const post = await read(clientId, postId);
          if (!post || (post.clientId && post.clientId !== clientId)) throw Object.assign(new Error('post not found for this client'), { code: 'not-found' });
          const rev = Number.isInteger(post.revision) ? { expectedRevision: post.revision } : {};
          if (payload.action === 'approve') {
            if (post.status === 'approved') { results.push({ postId, ok: true, status: 'approved', note: 'already approved' }); continue; }
            if (post.status !== 'draft') throw Object.assign(new Error(`post is ${post.status}; only a draft can be approved`), { code: 'not-approvable' });
            // approveDraft runs the story gate: "[add your memory]" / needsStory posts are refused here.
            const saved = await (approvePost ?? (await social()).approveDraft)(clientId, postId, { reviewedBy: by, ...rev });
            results.push({ postId, ok: true, status: saved?.status ?? 'approved' });
          } else if (payload.action === 'unschedule') {
            if (post.status !== 'scheduled') throw Object.assign(new Error(`post is ${post.status}; only a scheduled post can be unscheduled`), { code: 'not-scheduled' });
            const saved = await need(editPost, 'post edit')({ clientId, postId, scheduledAt: '', ...rev });
            results.push({ postId, ok: true, status: saved?.status ?? null });
          } else if (payload.action === 'delete-draft') {
            if (post.status !== 'draft') throw Object.assign(new Error(`post is ${post.status}; only a draft can be deleted`), { code: 'not-draft' });
            // rejectDraft keeps the doc as 'rejected' (it leaves the queue and calendar); nothing is hard-deleted.
            const saved = await (rejectPost ?? (await social()).rejectDraft)(clientId, postId, { reviewedBy: by, ...rev });
            results.push({ postId, ok: true, status: saved?.status ?? 'rejected' });
          } else {
            if (post.status !== 'draft' || post.scheduledAt) throw Object.assign(new Error('only an unscheduled draft can get a review date'), { code: 'not-draft' });
            const done = await need(placeDraft, 'draft placement')(clientId, postId, { reviewOn: payload.date });
            if (!done) throw Object.assign(new Error('draft changed or is no longer an unscheduled draft'), { code: 'stale' });
            results.push({ postId, ok: true, reviewOn: payload.date });
          }
        } catch (err) {
          if (err instanceof ProposalExecutionError) throw err;
          const reason = err?.code === 'needs-story' ? 'still needs its story (add your memory) before it can be approved'
            : err?.code === 'revision-conflict' ? 'changed since this was proposed' : String(err?.message || err).slice(0, 160);
          results.push({ postId, ok: false, error: err?.code || 'failed', reason });
        }
      }
      const done = results.filter((r) => r.ok).length;
      const failedRows = results.filter((r) => !r.ok);
      if (!done) throw new ProposalExecutionError('no post could be changed', { results: failedRows.slice(0, 10) });
      return compactResult({ action: payload.action, done, failed: failedRows.length, results: failedRows.slice(0, 10) });
    },
    // Upsert/delete one Content Center bucket through the same store as the bucket UI, then re-sync the tracks.
    async 'bucket-edit'({ clientId, payload }) {
      let out;
      if (payload.op === 'delete') out = await need(deleteBucket, 'bucket delete')(clientId, payload.bucket.id, { reassignTo: payload.reassignTo });
      else out = await need(upsertBucket, 'bucket save')(clientId, payload.bucket);
      let synced = false;
      if (typeof syncTracks === 'function') { try { synced = !!(await syncTracks(clientId))?.changed; } catch { /* a sync failure never fails the bucket write */ } }
      return compactResult({ op: payload.op, bucketId: out?.bucket?.id ?? payload.bucket.id ?? null, ...(out?.created !== undefined ? { created: out.created } : {}), tracksSynced: synced });
    },
    // One registry action (<=50 items): snapshot -> route call -> audit, through the runtime. Typed text was checked by decideProposal.
    async action({ clientId, payload, by, auth, context, proposalId }) {
      const res = await need(runAction, 'action runtime')({ clientId, payload, by, auth, context, proposalId });
      if (!res || res.ok === false) throw new ProposalExecutionError(res?.error || 'action failed', compactResult(res) ?? {});
      return compactResult(res);
    },
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

  // Typed confirmation (X publishing is always typed): the owner must type the card's confirmText exactly. Nothing runs otherwise.
  if (proposal.kind === 'action') {
    const need = requiredTypedText(proposal.payload);
    const given = String(options?.typed ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (need && given !== need.toLowerCase()) return { ok: false, status: 400, error: `Type "${need}" to confirm this action.`, code: 'typed-mismatch' };
  }
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
    return { ok: true, proposal: { ...base, status: 'failed', decidedAt, decidedBy: by, result, error: result.message } };
  }
}
