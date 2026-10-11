// ui-model.js - pure view-model helpers for the Strategy tab (T3). Client-safe: no I/O, no node/firebase.
// Turns route payloads (strategy-get / refresh status / plan doc) into the plain-English strings and
// request bodies StrategyPanel renders. Keep wording here so it is unit-testable.

import { PLAN_LIMITS, KNOWN_SLOT_TYPES, EVALUATION_CAVEAT, tierForAuthoredPerDay, isValidAuthoredPerDay } from './contracts.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Slot types a plan may floor/cap (reply = daily minimum, retweet = manual; the server rejects both). */
export const PLANNABLE_SLOT_TYPES = Object.freeze(KNOWN_SLOT_TYPES.filter((t) => t !== 'reply' && t !== 'retweet'));

export const cleanHandle = (h) => String(h ?? '').trim().replace(/^@+/, '').toLowerCase();

/** "fresh 2d" / "committed data - refresh" / "needs refresh" for one profile rowsMeta item (describeRows output). */
export function freshnessLabel(item) {
  if (!isObj(item)) return 'needs refresh';
  const count = item.rowsMeta?.rowCount;
  if (item.source === 'none' || count === 0 || (count === undefined && !item.rowsMeta)) return 'needs refresh';
  const f = item.freshness || {};
  if (!f.pulledAt || !Number.isFinite(f.ageDays)) return 'committed data — refresh';
  const age = f.ageDays === 0 ? 'today' : `${f.ageDays}d`;
  return f.stale ? `stale ${age} — refresh` : (f.ageDays === 0 ? 'fresh today' : `fresh ${age}`);
}

/** Row count for a rowsMeta item (0 when none). */
export function rowCountOf(item) {
  const n = item?.rowsMeta?.rowCount;
  return Number.isFinite(n) ? n : 0;
}

/** Index strategy-get rowsMeta[] by lowercase handle. */
export function indexRowsMeta(rowsMeta) {
  const out = {};
  for (const m of Array.isArray(rowsMeta) ? rowsMeta : []) if (m?.handle) out[cleanHandle(m.handle)] = m;
  return out;
}

// ---- refresh -------------------------------------------------------------------------------------------
export const REFRESH_ACTIVE = Object.freeze(['queued', 'running']);
export const refreshIsActive = (status) => REFRESH_ACTIVE.includes(status);

const REFRESH_WORDS = {
  queued: 'Queued, waiting for the refresh worker.',
  running: 'Refreshing now…',
  done: 'Refresh finished.',
  partial: 'Refresh finished partially; some handles did not fully pull.',
  'rate-limited': 'X rate-limited the pull. Wait a few minutes and try again; remaining handles were skipped.',
  'bird-unavailable': 'The pull tool (bird) is not available on this machine. Run the refresh worker on your Mac.',
  failed: 'Refresh failed.',
};

const KIND_WORDS = {
  'rate-limited': 'rate-limited',
  'cookie-access': 'could not read browser cookies',
  timeout: 'timed out',
  error: 'error',
};

/** One-line text per handle result: {status, added, updated, rowCount, error, errorKind}. */
export function handleResultText(handle, r) {
  if (!isObj(r)) return `@${handle}: waiting`;
  if (r.status === 'done') return `@${handle}: done (${r.added ?? 0} new, ${r.updated ?? 0} updated, ${r.rowCount ?? 0} rows)`;
  if (r.status === 'skipped') return `@${handle}: skipped`;
  const why = r.errorKind && KIND_WORDS[r.errorKind] ? KIND_WORDS[r.errorKind] : (r.error ? String(r.error).slice(0, 120) : '');
  if (r.status === 'partial') return `@${handle}: partial${why ? ` (${why})` : ''}, ${r.added ?? 0} new rows kept`;
  return `@${handle}: ${r.status || 'failed'}${why ? ` (${why})` : ''}`;
}

/**
 * @param {object|null} request  strategy-refresh-status `request`
 * @param {{polls?:number}} [opts]  polls = consecutive polls still showing `queued` (hint after 3)
 * @returns {{headline:string, tone:'info'|'ok'|'warn'|'error', lines:string[], hint:string|null, active:boolean}}
 */
export function refreshStatusView(request, { polls = 0 } = {}) {
  if (!isObj(request)) return { headline: 'No refresh started.', tone: 'info', lines: [], hint: null, active: false };
  const status = request.status;
  const headline = REFRESH_WORDS[status] || `Refresh status: ${String(status || 'unknown')}.`;
  const tone = status === 'done' ? 'ok' : status === 'failed' ? 'error' : refreshIsActive(status) ? 'info' : 'warn';
  const results = isObj(request.results) ? request.results : {};
  const order = Array.isArray(request.handles) ? request.handles : Object.keys(results);
  const lines = order.map((h) => handleResultText(h, results[h]));
  if (status === 'failed' && request.error) lines.push(String(request.error).slice(0, 200));
  const hint = status === 'queued' && polls >= 3
    ? 'Still queued. The refresh runs from your Mac: start the refresh worker there (or enable local ingest) and it will pick this up.'
    : null;
  return { headline, tone, lines, hint, active: refreshIsActive(status) };
}

// ---- evaluation ------------------------------------------------------------------------------------------
/** "Tier 2 - 6/day (Label)" from a tier object {tier, authoredPerDay, label} or a bare tier number. */
export function tierText(t) {
  if (t === null || t === undefined) return '—';
  if (typeof t === 'number') return `Tier ${t}`;
  const bits = [`Tier ${t.tier}`];
  if (Number.isFinite(t.authoredPerDay)) bits.push(`${t.authoredPerDay}/day`);
  return t.label ? `${bits.join(' · ')} (${t.label})` : bits.join(' · ');
}

/** currentTier is a number, recommendedTier an object; render the comparison sentence. */
export function tierComparison(evaluation) {
  if (!evaluation) return '';
  const cur = evaluation.currentTier;
  const rec = evaluation.recommendedTier;
  if (rec?.tier === undefined) return `Your plan sits in ${tierText(cur)}.`;
  if (rec.tier === cur) return `Your plan sits in ${tierText(cur)}, which matches the recommendation.`;
  return `Your plan sits in ${tierText(cur)}. Recommended next step: ${tierText(rec)}.`;
}

const CAVEAT_TITLES = {
  [EVALUATION_CAVEAT.LIKES_ONLY]: 'Likes only',
  [EVALUATION_CAVEAT.FEW_ROWS]: 'Few rows',
  [EVALUATION_CAVEAT.STALE]: 'Stale data',
  'quote-react-undervalued': 'Quote-react undervalued',
};
export const caveatTitle = (code) => CAVEAT_TITLES[code] || String(code);

/** Group caveats by handle ("" handle -> general). Keeps every caveat; order = first-seen. */
export function groupCaveats(caveats) {
  const groups = [];
  const index = new Map();
  for (const c of Array.isArray(caveats) ? caveats : []) {
    if (!c) continue;
    const key = c.handle ? cleanHandle(c.handle) : '';
    if (!index.has(key)) { const g = { handle: key, items: [] }; index.set(key, g); groups.push(g); }
    index.get(key).items.push({ code: c.code, title: caveatTitle(c.code), message: c.message || '' });
  }
  return groups;
}

/** Top-N type shares as "original 52% - quote-react 20%". */
export function typeShareText(byType, limit = 4) {
  const rows = Object.entries(isObj(byType) ? byType : {})
    .filter(([, v]) => Number.isFinite(v?.share))
    .sort((a, b) => b[1].share - a[1].share)
    .slice(0, limit);
  if (!rows.length) return '—';
  return rows.map(([t, v]) => `${t} ${Math.round(v.share)}%`).join(' · ');
}

export function rangeText(range) {
  if (!range || (!range.from && !range.to)) return '—';
  return `${range.from || '?'} to ${range.to || '?'}`;
}

/** Rows for the own-vs-benchmark table from evaluation. */
export function comparisonRows(evaluation) {
  if (!evaluation) return [];
  const mk = (e, role) => ({
    role,
    handle: e.handle,
    rows: e.rows ?? 0,
    window: rangeText(e.range),
    perDay: Number.isFinite(e.cadence?.authoredPerActiveDay) ? e.cadence.authoredPerActiveDay : null,
    types: typeShareText(e.byType),
  });
  return [mk(evaluation.own, 'own'), ...(evaluation.benchmarks || []).map((b) => mk(b, 'benchmark'))];
}

// ---- handles -----------------------------------------------------------------------------------------------
/** Edit-state for the accounts section from profile. */
export function handlesDraftFromProfile(profile) {
  return { own: cleanHandle(profile?.ownHandle), benchmarks: (profile?.benchmarkHandles || []).map(cleanHandle).filter(Boolean) };
}

/** Normalised handles from the draft: own + deduped non-empty benchmarks (own excluded). */
export function normalizeHandlesDraft(draft) {
  const own = cleanHandle(draft?.own);
  const seen = new Set([own]);
  const benchmarks = [];
  for (const raw of draft?.benchmarks || []) {
    const h = cleanHandle(raw);
    if (!h || seen.has(h)) continue;
    seen.add(h);
    benchmarks.push(h);
  }
  return { own, benchmarks };
}

export function handlesDirty(profile, draft) {
  const a = handlesDraftFromProfile(profile);
  const b = normalizeHandlesDraft(draft);
  return a.own !== b.own || JSON.stringify(a.benchmarks) !== JSON.stringify(b.benchmarks);
}

/** @returns {string|null} first problem, or null */
export function validateHandlesDraft(draft) {
  const { own, benchmarks } = normalizeHandlesDraft(draft);
  const re = /^[a-z0-9_]{1,15}$/;
  if (!own) return 'Enter your own X handle.';
  if (!re.test(own)) return `"${own}" is not a valid X handle.`;
  if (benchmarks.length > PLAN_LIMITS.maxBenchmarkHandles) return `At most ${PLAN_LIMITS.maxBenchmarkHandles} benchmark handles.`;
  const bad = benchmarks.find((h) => !re.test(h));
  return bad ? `"${bad}" is not a valid X handle.` : null;
}

// ---- plan ---------------------------------------------------------------------------------------------------
const toMap = (m) => (isObj(m) ? { ...m } : {});

/** Editable draft from a plan: counts as strings so empty inputs stay empty. */
export function planDraftFromPlan(plan) {
  const strMap = (m) => Object.fromEntries(Object.entries(toMap(m)).map(([k, v]) => [k, String(v)]));
  return {
    authoredPerDay: String(plan?.authoredPerDay ?? ''),
    typeFloors: strMap(plan?.typeFloors),
    typeCaps: strMap(plan?.typeCaps),
    notes: String(plan?.notes ?? ''),
  };
}

function parseMap(draftMap) {
  const out = {};
  const bad = [];
  for (const [k, raw] of Object.entries(toMap(draftMap))) {
    const s = String(raw ?? '').trim();
    if (s === '') continue; // blank = no floor/cap for that type
    const n = Number(s);
    if (!Number.isInteger(n) || n < 0) bad.push(k); else out[k] = n;
  }
  return { out, bad };
}

/**
 * Compare a draft against the saved plan; return only changed top-level fields (server replaces whole maps).
 * @returns {{changes:object, errors:string[], dirty:boolean}}
 */
export function planChangesFromDraft(plan, draft) {
  const changes = {};
  const errors = [];
  const perDay = Number(String(draft?.authoredPerDay ?? '').trim());
  if (String(draft?.authoredPerDay ?? '').trim() === '' || !isValidAuthoredPerDay(perDay)) {
    errors.push(`Posts per day must be a whole number ${PLAN_LIMITS.authoredPerDayMin}-${PLAN_LIMITS.authoredPerDayMax}.`);
  } else if (perDay !== plan?.authoredPerDay) changes.authoredPerDay = perDay;

  for (const field of ['typeFloors', 'typeCaps']) {
    const { out, bad } = parseMap(draft?.[field]);
    if (bad.length) errors.push(`${field === 'typeFloors' ? 'Floor' : 'Cap'} for ${bad.join(', ')} must be a whole number 0 or more.`);
    else if (JSON.stringify(sortKeys(out)) !== JSON.stringify(sortKeys(toMap(plan?.[field])))) changes[field] = out;
  }
  const notes = String(draft?.notes ?? '');
  if (notes !== String(plan?.notes ?? '')) changes.notes = notes;

  // Cheap client-side echo of the server rule so the common mistake shows before a round trip.
  if (!errors.length) {
    const floors = changes.typeFloors ?? toMap(plan?.typeFloors);
    const caps = changes.typeCaps ?? toMap(plan?.typeCaps);
    const total = changes.authoredPerDay ?? plan?.authoredPerDay;
    const sum = Object.values(floors).reduce((a, b) => a + b, 0);
    if (Number.isFinite(total) && sum > total) errors.push(`Floors add up to ${sum}, more than ${total} posts per day.`);
    for (const [t, f] of Object.entries(floors)) if (Number.isInteger(caps[t]) && f > caps[t]) errors.push(`Floor for ${t} (${f}) is above its cap (${caps[t]}).`);
  }
  return { changes, errors, dirty: Object.keys(changes).length > 0 };
}

function sortKeys(o) { return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))); }

/** Tier a draft cadence would sit in, or null when the number is invalid. */
export function draftTier(authoredPerDay) {
  const n = Number(String(authoredPerDay ?? '').trim());
  return String(authoredPerDay ?? '').trim() !== '' && isValidAuthoredPerDay(n) ? tierForAuthoredPerDay(n) : null;
}

/** Short diff summary for a history entry: "authoredPerDay 4 -> 6; typeFloors.hook 1 -> 2 (+1 more)". */
export function historyDiffSummary(entry, max = 3) {
  const diff = Array.isArray(entry?.diff) ? entry.diff : [];
  if (!diff.length) return 'no changes';
  const show = (v) => {
    if (v === null || v === undefined) return 'none';
    if (typeof v === 'string') return v.length > 24 ? `"${v.slice(0, 24)}…"` : `"${v}"`;
    return typeof v === 'object' ? JSON.stringify(v).slice(0, 30) : String(v);
  };
  const parts = diff.slice(0, max).map((d) => `${d.path} ${show(d.from)} → ${show(d.to)}`);
  const extra = diff.length - max;
  return parts.join('; ') + (extra > 0 ? ` (+${extra} more)` : '');
}

/** History newest first, tolerant of a missing array. */
export function historyNewestFirst(plan) {
  return [...(Array.isArray(plan?.history) ? plan.history : [])].sort((a, b) => (b.version || 0) - (a.version || 0));
}

export function formatWhen(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

/** "Today: 6 posts (from plan v3)" / "(default)" / unavailable reason. */
export function todayPlanLine(preview, planDoc) {
  if (!preview?.available) {
    const why = preview?.reason === 'no-own-rows' ? 'no posts pulled for your handle yet, refresh first' : (preview?.reason || 'unavailable');
    return `Today: preview unavailable (${why}).`;
  }
  const n = preview.posts ?? preview.plan?.slots?.length ?? null;
  const count = n === null ? 'a day plan' : `${n} post${n === 1 ? '' : 's'}`;
  const src = preview.usedPlan && planDoc?.version ? `from plan v${planDoc.version}` : 'default';
  return `Today: ${count} (${src}).`;
}

/** Plain text for a plan-apply/revert failure result {status,error,errors,currentVersion}. */
export function planErrorView(result) {
  if (result?.status === 409 || result?.code === 'version-conflict') return { conflict: true, message: 'Plan changed elsewhere — reload.', errors: [] };
  return { conflict: false, message: result?.error || 'Plan was not saved.', errors: Array.isArray(result?.errors) ? result.errors : [] };
}

// ---- chat helpers (T4c) ------------------------------------------------------------------------------------

const PROPOSAL_KIND_LABELS = Object.freeze({
  'plan-change': 'Change the plan',
  'benchmarks-change': 'Change the tracked accounts',
  'suggestion-edit': 'Edit a suggestion',
  'suggestion-dismiss': 'Dismiss a suggestion',
  'suggestion-save-draft': 'Save a suggestion as a draft',
  'item-story': 'Write an item story',
  'regenerate-today': "Regenerate today's suggestions",
  'refresh-handles': 'Refresh account data',
});

/** Plain-words label for a proposal kind. Unknown kinds fall back to a readable form, never throw. */
export function proposalKindLabel(kind) {
  if (PROPOSAL_KIND_LABELS[kind]) return PROPOSAL_KIND_LABELS[kind];
  return typeof kind === 'string' && kind ? kind.replace(/-/g, ' ') : 'Proposal';
}

const showVal = (v) => {
  if (v === undefined || v === null || v === '') return 'unset';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};
const atHandles = (list) => (Array.isArray(list) && list.length ? list.map((h) => `@${String(h).replace(/^@+/, '')}`).join(', ') : 'none');

/**
 * What a proposal will do, as short lines for the card. Pure; tolerates missing/odd payloads.
 * plan-change lines read "field: from -> to" using `currentPlan` for the "from" side.
 * @returns {string[]}
 */
export function proposalPayloadPreview(kind, payload, currentPlan) {
  const p = payload && typeof payload === 'object' ? payload : {};
  switch (kind) {
    case 'plan-change': {
      const changes = p.changes && typeof p.changes === 'object' ? p.changes : {};
      const keys = Object.keys(changes);
      if (!keys.length) return ['No field changes.'];
      return keys.map((k) => `${k}: ${showVal(currentPlan?.[k])} → ${showVal(changes[k])}`);
    }
    case 'suggestion-edit': return [`New text: ${showVal(p.text)}`];
    case 'suggestion-save-draft': return p.text ? [`Draft text: ${p.text}`] : ['Saves the suggestion as it stands.'];
    case 'suggestion-dismiss': return ['Removes this suggestion from today.'];
    case 'item-story': return [`Story: ${showVal(p.story)}`];
    case 'benchmarks-change': {
      const lines = [];
      if (p.ownHandle) lines.push(`Your handle: @${String(p.ownHandle).replace(/^@+/, '')}`);
      lines.push(`Benchmarks: ${atHandles(p.benchmarkHandles)}`);
      return lines;
    }
    case 'refresh-handles': return [`Pull fresh posts for: ${atHandles(p.handles)}`];
    case 'regenerate-today': return [`Model drafting: ${p.useModel === true ? 'on' : 'off'}`, ...(p.force === true ? ['Replaces the existing run.'] : [])];
    default: return [];
  }
}

const RESULT_LINES = {
  'plan-change': (r) => (r?.version ? `Plan updated to v${r.version}.` : 'Plan updated.'),
  'benchmarks-change': () => 'Accounts saved.',
  'suggestion-edit': () => "Today's suggestion updated — open the Today tab.",
  'suggestion-dismiss': () => "Today's suggestion dismissed — open the Today tab.",
  'suggestion-save-draft': () => "Today's suggestion saved as a draft — open the Today tab.",
  'regenerate-today': () => "Today's suggestions regenerated — open the Today tab.",
  'item-story': () => 'Story saved.',
  'refresh-handles': () => 'Refresh started.',
};

/**
 * Status badge + detail line for a proposal.
 * @returns {{label:string, tone:'pending'|'ok'|'muted'|'error', detail:string}}
 */
export function proposalStatusText(proposal) {
  const status = proposal?.status;
  const result = proposal?.result && typeof proposal.result === 'object' ? proposal.result : null;
  if (status === 'confirmed') return { label: 'confirmed', tone: 'ok', detail: (RESULT_LINES[proposal.kind] || (() => 'Done.'))(result) };
  if (status === 'rejected') return { label: 'rejected', tone: 'muted', detail: 'Nothing was changed.' };
  if (status === 'failed') {
    let detail;
    if (result?.error === 'stale') {
      detail = result.currentVersion !== undefined && result.currentVersion !== null
        ? `stale: plan is now v${result.currentVersion}, ask again` : 'stale: the plan changed, ask again';
    } else detail = result?.message || (typeof result?.error === 'string' && result.error !== 'failed' ? result.error : '') || 'The change could not be applied.';
    return { label: 'failed', tone: 'error', detail };
  }
  if (status === 'deciding') return { label: 'applying', tone: 'pending', detail: 'Applying\u2026 / interrupted - check Today/Plan before retrying.' };
  return { label: 'pending', tone: 'pending', detail: '' };
}

/** Friendly text for a failed chat/decide call. `err` carries .status / .data from the card's call helper. */
export function chatErrorText(err) {
  const status = err?.status;
  const data = err?.data || {};
  const msg = String(err?.message || '').trim();
  if (status === 429 || data.code === 'chat-cap') {
    const used = data.used ?? data.turnsUsedToday;
    const cap = data.cap;
    return used !== undefined && cap !== undefined ? `Daily chat limit reached (${used}/${cap}).` : 'Daily chat limit reached.';
  }
  if (status === 503) return 'No model is configured for the strategy agent on this deployment.';
  if (status === 502) return msg || 'The strategy agent hit a model error. Try again.';
  if (status === 409) return 'Already decided.';
  if (status === undefined || status === null) return 'Network problem — check your connection and try again.';
  return msg || 'Request failed.';
}

/** "N of CAP turns today · last turn $0.012". Missing pieces are left out, never shown as NaN. */
export function costFooterText(usage, used, cap) {
  const parts = [];
  const u = Number(used);
  const c = Number(cap);
  if (Number.isFinite(u) && Number.isFinite(c) && c > 0) parts.push(`${u} of ${c} turns today`);
  else if (Number.isFinite(u)) parts.push(`${u} turns today`);
  const cost = usage?.costUsd;
  if (typeof cost === 'number' && Number.isFinite(cost)) parts.push(`last turn $${cost.toFixed(3)}`);
  return parts.join(' · ');
}

/**
 * Chat display text: the agent is told to answer in plain text but still sometimes wraps words in
 * **bold** or `code` markers, which the bubble would show as raw symbols. Presentation only: the
 * stored message and what the model sees are unchanged.
 */
export function plainChatText(text) {
  return String(text ?? '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1');
}
