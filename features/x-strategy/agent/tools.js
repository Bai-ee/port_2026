// tools.js - tool schemas + pure handlers for the X Strategy agent (T4a).
// No I/O: every read goes through injected `toolDeps`. Safe to import anywhere.
// Propose tools never write; they validate a payload and hand back a proposal for the owner to confirm.

import { PROPOSAL_KINDS, PLAN_LIMITS, KNOWN_SLOT_TYPES } from '../contracts.js';
import { PLAN_FIELDS, HANDLE_RE, applyChange } from '../plan-state.js';

export const LIMITS = Object.freeze({
  inventoryMax: 20,
  topPostsMax: 10,
  textMax: 1000,
  summaryMax: 200,
  rationaleMax: 600,
  evidenceMax: 6,
  evidenceFieldMax: 240,
  resultMaxChars: 12000,
});

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const int = (description, extra = {}) => ({ type: 'integer', description, ...extra });

const COMMON_PROPS = {
  summary: str('One-line description of the proposal, shown on the card.', { maxLength: LIMITS.summaryMax }),
  rationale: str('Why, in 1-3 sentences. Cite figures with source and window.', { maxLength: LIMITS.rationaleMax }),
  evidence: {
    type: 'array',
    maxItems: LIMITS.evidenceMax,
    description: 'Figures from tool results that support this. Each: where it came from and the figure with its window.',
    items: {
      type: 'object',
      properties: { source: str('Handle/tool and window, e.g. "@handle, N rows, from to"'), figure: str('The figure as stated by the tool') },
      required: ['source', 'figure'],
    },
  },
};
const COMMON_REQUIRED = ['summary', 'rationale', 'evidence'];

/** @type {Record<string,string>} proposal kind -> propose tool name */
export const PROPOSE_TOOL_BY_KIND = Object.freeze({
  'plan-change': 'propose_plan_change',
  'benchmarks-change': 'propose_benchmarks_change',
  'suggestion-edit': 'propose_suggestion_edit',
  'suggestion-dismiss': 'propose_suggestion_dismiss',
  'suggestion-save-draft': 'propose_suggestion_save_draft',
  'item-story': 'propose_item_story',
  'regenerate-today': 'propose_regenerate_today',
  'refresh-handles': 'propose_refresh_handles',
});
export const KIND_BY_PROPOSE_TOOL = Object.freeze(
  Object.fromEntries(Object.entries(PROPOSE_TOOL_BY_KIND).map(([k, v]) => [v, k])),
);

const propose = (kind, description, props, required = []) => ({
  name: PROPOSE_TOOL_BY_KIND[kind],
  description: `${description} Records a proposal only; the owner must confirm it. Nothing is changed by calling this.`,
  input_schema: {
    type: 'object',
    properties: { ...props, ...COMMON_PROPS },
    required: [...required, ...COMMON_REQUIRED],
  },
});

const planChangeProps = {
  changes: {
    type: 'object',
    description: 'Partial plan: only the fields to change. Whole-field replace (typeFloors/typeCaps are replaced as maps). tier is derived and not allowed.',
    properties: {
      authoredPerDay: int('Authored posts per day', { minimum: PLAN_LIMITS.authoredPerDayMin, maximum: PLAN_LIMITS.authoredPerDayMax }),
      typeFloors: { type: 'object', description: `Minimum per slot type. Keys: ${KNOWN_SLOT_TYPES.join(', ')} (not reply/retweet).`, additionalProperties: int('count', { minimum: 0 }) },
      typeCaps: { type: 'object', description: 'Maximum per slot type. Same keys as typeFloors.', additionalProperties: int('count', { minimum: 0 }) },
      engineTargets: { type: 'object', description: 'Engine quota overrides (authored / engines).' },
      benchmarkPrimary: str('Primary benchmark handle, no @'),
      notes: str('Rationale note shown on the Plan card', { maxLength: 1000 }),
    },
    additionalProperties: false,
  },
  expectedVersion: int('The plan version from get_plan (0 if no plan is saved).', { minimum: 0 }),
};

export const READ_TOOLS = Object.freeze([
  {
    name: 'get_evaluation',
    description: 'The current evaluation: own vs benchmark cadence, type mix, lift, top gaps, recommended tier, and caveats (likes-only, few rows, stale). Every figure has a row count and date range.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_plan',
    description: 'The saved strategy plan document (version, plan fields, recent history) or null if none is saved.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_context',
    description: 'The shared content context the daily runner uses: executable plan version, Client Brain approval, campaign, scan, corpora and inventory — each with source, as-of time, usable flag and caveats, plus a versions hash.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_today_run',
    description: "Today's daily-run suggestions: id, slot, type, status, text.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'search_inventory',
    description: `Search the owner's content inventory. Returns summary rows (max ${LIMITS.inventoryMax}).`,
    input_schema: {
      type: 'object',
      properties: { query: str('Search text'), limit: int('Max rows', { minimum: 1, maximum: LIMITS.inventoryMax }) },
      required: ['query'],
    },
  },
  {
    name: 'top_posts',
    description: `Top posts by engagement for the owner's own account or a benchmark, optionally by type or topic (max ${LIMITS.topPostsMax}). Lift is likes-based unless the result says otherwise.`,
    input_schema: {
      type: 'object',
      properties: {
        handle: str('Account handle, no @. Omit for the owner.'),
        type: str('Post type filter, e.g. quote-react'),
        topic: str('Topic filter'),
        limit: int('Max rows', { minimum: 1, maximum: LIMITS.topPostsMax }),
      },
    },
  },
]);

export const PROPOSE_TOOLS = Object.freeze([
  propose('plan-change', 'Propose a change to the strategy plan. Call get_plan first and pass its version as expectedVersion.', planChangeProps, ['changes', 'expectedVersion']),
  propose('benchmarks-change', `Propose a new own handle and/or benchmark handles (max ${PLAN_LIMITS.maxBenchmarkHandles}).`, {
    ownHandle: str('Owner handle, no @'),
    benchmarkHandles: { type: 'array', maxItems: PLAN_LIMITS.maxBenchmarkHandles, items: str('Handle, no @') },
  }),
  propose('suggestion-edit', "Propose new text for one of today's suggestions.", { suggestionId: str('Id from get_today_run'), text: str('The replacement text', { maxLength: LIMITS.textMax }) }, ['suggestionId', 'text']),
  propose('suggestion-dismiss', "Propose dismissing one of today's suggestions.", { suggestionId: str('Id from get_today_run') }, ['suggestionId']),
  propose('suggestion-save-draft', "Propose saving one of today's suggestions as an unscheduled draft.", { suggestionId: str('Id from get_today_run') }, ['suggestionId']),
  propose('item-story', "Propose a story text for an inventory item. Use ONLY facts the owner stated in this conversation, and quote their words in sourceQuote (at least 20 characters, copied exactly).", {
    itemId: str('Inventory item id'),
    story: str('The story text, using only owner-stated facts', { maxLength: LIMITS.textMax }),
    sourceQuote: str("The owner's own words from this conversation that the story is based on, copied exactly, at least 20 characters"),
  }, ['itemId', 'story', 'sourceQuote']),
  propose('regenerate-today', "Propose regenerating today's suggestions. Drafting stays template-only; the owner may tick 'use the model' on the card when confirming. You cannot enable it.", {}),
  propose('refresh-handles', `Propose refreshing the data for up to ${PLAN_LIMITS.maxHandlesPerRefreshRequest} handles (free local read).`, {
    handles: { type: 'array', minItems: 1, maxItems: PLAN_LIMITS.maxHandlesPerRefreshRequest, items: str('Handle, no @') },
  }, ['handles']),
]);

export const TOOL_SCHEMAS = Object.freeze([...READ_TOOLS, ...PROPOSE_TOOLS]);
export const READ_TOOL_NAMES = Object.freeze(READ_TOOLS.map((t) => t.name));

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const cleanHandle = (h) => String(h ?? '').trim().replace(/^@+/, '');
const SOURCE_QUOTE_MIN = 20;
const normText = (s) => String(s ?? '').toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

/** Cap a read-tool result to something the model can use; returns a JSON string. */
export function serializeResult(value, max = LIMITS.resultMaxChars) {
  let s;
  try { s = JSON.stringify(value === undefined ? null : value); } catch { s = JSON.stringify({ error: 'unserializable result' }); }
  return s.length > max ? `${s.slice(0, max)}... [truncated ${s.length - max} chars]` : s;
}

function capRows(res, max) {
  if (Array.isArray(res)) return res.slice(0, max);
  if (isPlain(res) && Array.isArray(res.rows)) return { ...res, rows: res.rows.slice(0, max) };
  return res;
}
const clampLimit = (n, max) => (Number.isFinite(Number(n)) && Number(n) >= 1 ? Math.min(Math.floor(Number(n)), max) : max);

/** Run a read tool through injected deps. Throws on dep failure (the loop turns that into a tool error). */
export async function runReadTool(name, input, toolDeps) {
  const deps = toolDeps ?? {};
  const need = (fn) => { if (typeof deps[fn] !== 'function') throw new Error(`${fn} is not available`); return deps[fn]; };
  switch (name) {
    case 'get_evaluation': return need('getEvaluation')();
    case 'get_plan': return { plan: await need('getPlan')() };
    case 'get_context': return need('getContext')();
    case 'get_today_run': return need('getTodayRun')();
    case 'search_inventory': {
      const query = String(input?.query ?? '').trim();
      if (!query) throw new Error('query is required');
      return capRows(await need('searchInventory')({ query, limit: clampLimit(input?.limit, LIMITS.inventoryMax) }), LIMITS.inventoryMax);
    }
    case 'top_posts': {
      const args = {
        handle: input?.handle ? cleanHandle(input.handle) : undefined,
        type: input?.type || undefined,
        topic: input?.topic || undefined,
        limit: clampLimit(input?.limit, LIMITS.topPostsMax),
      };
      return capRows(await need('topPosts')(args), LIMITS.topPostsMax);
    }
    default: throw new Error(`unknown read tool: ${name}`);
  }
}

function cleanText(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function cleanEvidence(ev) {
  if (!Array.isArray(ev)) return [];
  const out = [];
  for (const e of ev) {
    if (!isPlain(e)) continue;
    const source = cleanText(e.source, LIMITS.evidenceFieldMax);
    const figure = cleanText(e.figure, LIMITS.evidenceFieldMax);
    if (source && figure) out.push({ source, figure });
    if (out.length >= LIMITS.evidenceMax) break;
  }
  return out;
}

function cleanHandles(list, max) {
  const out = [];
  for (const h of Array.isArray(list) ? list : []) {
    const c = cleanHandle(h);
    if (!HANDLE_RE.test(c)) return { error: `invalid handle: ${String(h).slice(0, 30)}` };
    if (!out.some((x) => x.toLowerCase() === c.toLowerCase())) out.push(c);
  }
  if (out.length > max) return { error: `at most ${max} handles` };
  return { handles: out };
}

async function todaySuggestionIds(deps) {
  if (typeof deps?.getTodayRun !== 'function') throw new Error('getTodayRun is not available');
  const run = await deps.getTodayRun();
  const list = Array.isArray(run?.suggestions) ? run.suggestions : [];
  return new Set(list.map((s) => s?.id).filter((x) => typeof x === 'string'));
}

/**
 * Validate a propose-tool call. Never throws for bad input.
 * @param {string} toolName
 * @param {object} input
 * @param {{toolDeps:object, userMessages:string[]}} ctx  userMessages = owner's words in this conversation
 * @returns {Promise<{ok:true, proposal:object}|{ok:false, error:string}>}
 */
export async function prepareProposal(toolName, input, { toolDeps, userMessages = [] } = {}) {
  const kind = KIND_BY_PROPOSE_TOOL[toolName];
  if (!kind || !PROPOSAL_KINDS.includes(kind)) return { ok: false, error: `unknown propose tool: ${toolName}` };
  if (!isPlain(input)) return { ok: false, error: 'input must be a JSON object' };

  const summary = cleanText(input.summary, LIMITS.summaryMax);
  const rationale = cleanText(input.rationale, LIMITS.rationaleMax);
  if (!summary) return { ok: false, error: 'summary is required' };
  if (!rationale) return { ok: false, error: 'rationale is required' };
  const evidence = cleanEvidence(input.evidence);
  const fail = (error) => ({ ok: false, error });
  let payload;

  try {
    switch (kind) {
      case 'plan-change': {
        if (!isPlain(input.changes) || !Object.keys(input.changes).length) return fail('changes must be a non-empty object');
        if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) return fail('expectedVersion must be a non-negative integer (use the version from get_plan)');
        const bad = Object.keys(input.changes).filter((k) => k === 'tier' || !PLAN_FIELDS.includes(k));
        if (bad.length) return fail(`not allowed in changes: ${bad.join(', ')} (tier is derived; allowed: ${PLAN_FIELDS.filter((f) => f !== 'tier').join(', ')})`);
        if (typeof toolDeps?.getPlan !== 'function') return fail('getPlan is not available');
        const doc = (await toolDeps.getPlan()) ?? null;
        const res = applyChange(doc, { changes: input.changes, by: 'agent-dry-run', source: 'chat', expectedVersion: input.expectedVersion });
        if (res.error === 'version-conflict') return fail(`plan is at version ${res.currentVersion}, not ${input.expectedVersion}; call get_plan and retry`);
        if (res.error === 'noop') return fail('these changes do not alter the current plan');
        if (res.error) return fail(`invalid plan change: ${(res.errors ?? []).join('; ')}`);
        payload = { changes: JSON.parse(JSON.stringify(input.changes)), expectedVersion: input.expectedVersion };
        break;
      }
      case 'benchmarks-change': {
        const out = {};
        if (input.ownHandle !== undefined) {
          const own = cleanHandle(input.ownHandle);
          if (!HANDLE_RE.test(own)) return fail('ownHandle is not a valid X handle');
          out.ownHandle = own;
        }
        if (input.benchmarkHandles !== undefined) {
          const r = cleanHandles(input.benchmarkHandles, PLAN_LIMITS.maxBenchmarkHandles);
          if (r.error) return fail(r.error);
          out.benchmarkHandles = r.handles;
        }
        if (!Object.keys(out).length) return fail('provide ownHandle and/or benchmarkHandles');
        payload = out;
        break;
      }
      case 'suggestion-edit':
      case 'suggestion-dismiss':
      case 'suggestion-save-draft': {
        const id = cleanText(input.suggestionId, 200);
        if (!id) return fail('suggestionId is required');
        const ids = await todaySuggestionIds(toolDeps);
        if (!ids.has(id)) return fail(`unknown suggestionId ${id}; ids come from get_today_run`);
        payload = { suggestionId: id };
        if (kind === 'suggestion-edit') {
          const text = cleanText(input.text, LIMITS.textMax);
          if (!text) return fail('text is required');
          payload.text = text;
        }
        break;
      }
      case 'item-story': {
        const itemId = cleanText(input.itemId, 200);
        const story = cleanText(input.story, LIMITS.textMax);
        const quote = normText(input.sourceQuote);
        if (!itemId) return fail('itemId is required');
        if (!story) return fail('story is required');
        if (quote.length < SOURCE_QUOTE_MIN) return fail(`sourceQuote is required: at least ${SOURCE_QUOTE_MIN} characters of the owner's own words, copied exactly`);
        const found = userMessages.some((m) => normText(m).includes(quote));
        if (!found) return fail("sourceQuote does not appear in the owner's messages in this conversation. Do not write a story from facts the owner has not stated; ask them for the facts instead.");
        payload = { itemId, story, sourceQuote: cleanText(input.sourceQuote, LIMITS.textMax) };
        break;
      }
      case 'regenerate-today':
        payload = { useModel: false }; // the owner opts into model drafting on the card at confirm time; the model cannot
        break;
      case 'refresh-handles': {
        const r = cleanHandles(input.handles, PLAN_LIMITS.maxHandlesPerRefreshRequest);
        if (r.error) return fail(r.error);
        if (!r.handles.length) return fail('handles must be a non-empty list');
        const known = new Set((typeof toolDeps?.getProfileHandles === 'function' ? await toolDeps.getProfileHandles() : []).map((h) => cleanHandle(h).toLowerCase()).filter(Boolean));
        const said = userMessages.map((m) => String(m ?? '').toLowerCase().replace(/@/g, ''));
        const unknown = r.handles.filter((h) => !known.has(h.toLowerCase()) && !said.some((m) => m.split(/[^a-z0-9_]+/).includes(h.toLowerCase())));
        if (unknown.length) return fail(`not in the profile (own + benchmarks) and not named by the owner in this conversation: ${unknown.join(', ')}. Ask the owner before proposing a refresh.`);
        payload = { handles: r.handles };
        break;
      }
      default: return fail(`unsupported kind: ${kind}`);
    }
  } catch (err) {
    return fail(`could not validate: ${String(err?.message ?? err).slice(0, 200)}`);
  }
  return { ok: true, proposal: { kind, payload, summary, rationale, evidence } };
}
