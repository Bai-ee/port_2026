// ui-model.js - pure view-model helpers for the Strategy tab (T3). Client-safe: no I/O, no node/firebase.
// Turns route payloads (strategy-get / refresh status / plan doc) into the plain-English strings and
// request bodies StrategyPanel renders. Keep wording here so it is unit-testable.

import { tracksOf, normalizeContentTracks, MAX_BENCHMARKS_PER_TRACK, MAX_DISTINCT_BENCHMARKS } from './content-tracks.js';
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
  queued: 'Queued — run the Mac refresh worker to load posts.',
  running: 'Refreshing now…',
  done: 'Refresh finished.',
  partial: 'Refresh finished partially; some handles did not fully pull.',
  'rate-limited': 'Rate-limited by X — retry after ~15 min. Remaining handles were skipped.',
  'bird-unavailable': 'The pull tool (bird) is not available on this machine. Run the refresh worker on your Mac.',
  failed: 'Refresh failed.',
};

/** Auto-polls of a still-queued request before the UI parks it (no spinner) and offers Re-check. 5 x 4s. */
export const QUEUED_POLL_LIMIT = 5;
/** X rate-limit window the worker hit; the retry time shown is finishedAt + this. */
export const RATE_LIMIT_RETRY_MS = 15 * 60 * 1000;
const RETRYABLE = new Set(['rate-limited', 'bird-unavailable']);

/** "9:41 PM" for an ISO time, or '' when unparseable. */
export function clockText(iso) {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
}

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
 * @param {{polls?:number}} [opts]  polls = consecutive polls still showing `queued` (hint after 3, parked at QUEUED_POLL_LIMIT)
 * @returns {{headline:string, tone:'info'|'ok'|'warn'|'error', lines:string[], hint:string|null, active:boolean,
 *            parked:boolean, queuedAt:string, retryAt:string, retryHandles:string[]}}
 *   active = keep auto-polling / show progress; parked = queued but polling stopped (offer Re-check);
 *   retryHandles = handles not pulled by a rate-limited / bird-unavailable request (offer Retry).
 */
export function refreshStatusView(request, { polls = 0 } = {}) {
  if (!isObj(request)) return { headline: 'No refresh started.', tone: 'info', lines: [], hint: null, active: false, parked: false, queuedAt: '', retryAt: '', retryHandles: [] };
  const status = request.status;
  const headline = REFRESH_WORDS[status] || `Refresh status: ${String(status || 'unknown')}.`;
  const tone = status === 'done' ? 'ok' : status === 'failed' ? 'error' : refreshIsActive(status) ? 'info' : 'warn';
  const results = isObj(request.results) ? request.results : {};
  const order = Array.isArray(request.handles) ? request.handles : Object.keys(results);
  const lines = order.map((h) => handleResultText(h, results[h]));
  if (status === 'failed' && request.error) lines.push(String(request.error).slice(0, 200));
  const queued = status === 'queued';
  const parked = queued && polls >= QUEUED_POLL_LIMIT;
  const hint = queued && polls >= 3
    ? 'Still queued. The refresh runs from your Mac: start the refresh worker there (or enable local ingest) and it will pick this up.'
    : null;
  const queuedAt = queued ? clockText(request.requeuedAt || request.createdAt) : '';
  const retryable = RETRYABLE.has(status);
  const retryAt = status === 'rate-limited' && Number.isFinite(Date.parse(request.finishedAt))
    ? clockText(new Date(Date.parse(request.finishedAt) + RATE_LIMIT_RETRY_MS).toISOString()) : '';
  const retryHandles = retryable ? order.filter((h) => results[h]?.status !== 'done') : [];
  return { headline, tone, lines, hint, active: status === 'running' || (queued && !parked), parked, queuedAt, retryAt, retryHandles };
}

// ---- worker heartbeat ------------------------------------------------------------------------------------
const spanText = (min) => (min < 1 ? 'less than a minute' : min < 60 ? `${min} min` : `${Math.round(min / 60)} h`);

/** Honest one-liner from readWorkerHealth(); null when the payload has no workerHealth (caller keeps its fallback). */
export function workerHealthLine(health) {
  if (!isObj(health) || !['recent', 'stale', 'never'].includes(health.state)) return null;
  if (health.state === 'never') return 'Worker has never reported in (not running, or an older worker without this signal)';
  const min = Number.isFinite(health.ageMinutes) ? health.ageMinutes : 0;
  if (health.state === 'recent') return min < 1 ? 'Worker last seen just now' : `Worker last seen ${min} min ago`;
  return `Worker not seen for ${spanText(min)} — refresh requests will stay queued until it runs`;
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


// ---- content tracks (plan section 4.6) ----------------------------------------------------------------------
// Draft shape: [{ id, label, engines[], benchmarks[], share: <whole percent number>, promotions:[{id,label,engine,url:string,weeklyTarget}], topics[] }]
// Shares are whole percents that always sum to 100; the payload converts to 0..1 fractions.

/** Split 100 across weights with the largest-remainder rule so the integers sum to exactly 100. */
export function percentsFromWeights(weights) {
  const w = (weights || []).map((x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : 0));
  if (!w.length) return [];
  const total = w.reduce((a, b) => a + b, 0);
  const raw = total > 0 ? w.map((x) => (x / total) * 100) : w.map(() => 100 / w.length);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).forEach(([, i]) => { if (left > 0) { out[i] += 1; left -= 1; } });
  return out;
}

/** Editable draft from the saved plan (or plan doc); absent/invalid contentTracks => the contract defaults. */
export function trackDraftFromPlan(planOrDoc) {
  const tracks = tracksOf(planOrDoc);
  const pct = percentsFromWeights(tracks.map((t) => t.share));
  return tracks.map((t, i) => ({
    id: t.id, label: t.label, engines: [...t.engines], benchmarks: [...t.benchmarks], topics: [...(t.topics || [])],
    share: pct[i],
    promotions: t.promotions.map((p) => ({ id: p.id, label: p.label, engine: p.engine, url: p.url || '', weeklyTarget: p.weeklyTarget })),
  }));
}

/** Set one track's share (0-100); the others rescale proportionally so the total stays exactly 100. */
export function setTrackShare(draft, trackId, value) {
  const list = Array.isArray(draft) ? draft : [];
  if (list.length < 2) return list.map((t) => ({ ...t, share: 100 }));
  const v = Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
  const others = list.filter((t) => t.id !== trackId);
  const sum = others.reduce((x, o) => x + o.share, 0);
  const share = percentsFromWeights(others.map((o) => (sum > 0 ? o.share : 1)));
  const scaled = share.map((p) => Math.round((p / 100) * (100 - v)));
  const drift = (100 - v) - scaled.reduce((x, y) => x + y, 0); // rounding drift lands on the largest other track
  if (drift && scaled.length) scaled[scaled.indexOf(Math.max(...scaled))] += drift;
  let k = 0;
  return list.map((t) => (t.id === trackId ? { ...t, share: v } : { ...t, share: scaled[k++] }));
}

/** @returns {string|null} first problem with a handle about to be added to a track. */
export function validateTrackBenchmark(draft, trackId, raw) {
  const h = cleanHandle(raw);
  if (!h) return 'Enter an X handle.';
  if (!/^[a-z0-9_]{1,15}$/.test(h)) return `"${h}" is not a valid X handle.`;
  const list = Array.isArray(draft) ? draft : [];
  const track = list.find((t) => t.id === trackId);
  if (!track) return 'Unknown track.';
  if (track.benchmarks.includes(h)) return `@${h} is already a benchmark here.`;
  if (track.benchmarks.length >= MAX_BENCHMARKS_PER_TRACK) return `At most ${MAX_BENCHMARKS_PER_TRACK} benchmarks per track.`;
  const distinct = new Set(list.flatMap((t) => t.benchmarks));
  if (!distinct.has(h) && distinct.size >= MAX_DISTINCT_BENCHMARKS) return `At most ${MAX_DISTINCT_BENCHMARKS} distinct benchmarks across tracks.`;
  return null;
}

export function addTrackBenchmark(draft, trackId, raw) {
  const h = cleanHandle(raw);
  return (draft || []).map((t) => (t.id === trackId && !t.benchmarks.includes(h) ? { ...t, benchmarks: [...t.benchmarks, h] } : t));
}

export function removeTrackBenchmark(draft, trackId, handle) {
  const h = cleanHandle(handle);
  return (draft || []).map((t) => (t.id === trackId ? { ...t, benchmarks: t.benchmarks.filter((x) => x !== h) } : t));
}

/** @returns {string|null} inline problem for a promotion link input (blank is fine: no link). */
export function validatePromotionUrl(value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  let u;
  try { u = new URL(v); } catch { return 'Not a valid link. Use a full https:// address.'; }
  return u.protocol === 'https:' ? null : 'Links must start with https://';
}

export function setPromotionUrl(draft, trackId, promotionId, url) {
  return (draft || []).map((t) => (t.id !== trackId ? t : { ...t, promotions: t.promotions.map((p) => (p.id === promotionId ? { ...p, url } : p)) }));
}

/** Request body fragment for the plan save: shares become 0..1 fractions, blank links null. */
export function trackPayloadFromDraft(draft) {
  return (draft || []).map((t) => ({
    id: t.id, label: t.label, engines: [...t.engines], benchmarks: t.benchmarks.map(cleanHandle), topics: [...(t.topics || [])],
    share: (Number(t.share) || 0) / 100,
    promotions: t.promotions.map((p) => ({ id: p.id, label: p.label, engine: p.engine, url: String(p.url ?? '').trim() || null, weeklyTarget: p.weeklyTarget })),
  }));
}

/**
 * Compare the track draft with the saved plan.
 * @returns {{contentTracks:object[]|null, errors:string[], dirty:boolean}}  contentTracks only when dirty and valid
 */
export function trackChangesFromDraft(planOrDoc, draft) {
  const errors = [];
  for (const t of draft || []) for (const p of t.promotions) {
    const e = validatePromotionUrl(p.url);
    if (e) errors.push(`${p.label}: ${e}`);
  }
  const dirty = JSON.stringify(trackPayloadFromDraft(draft)) !== JSON.stringify(trackPayloadFromDraft(trackDraftFromPlan(planOrDoc)));
  if (!errors.length && dirty) {
    try { normalizeContentTracks(trackPayloadFromDraft(draft)); } catch (err) { errors.push(String(err?.message || 'Tracks are not valid.')); }
  }
  return { contentTracks: dirty && !errors.length ? trackPayloadFromDraft(draft) : null, errors, dirty };
}

const WORKER_CMD = 'node scripts/x-content/strategy-refresh-worker.mjs';

/**
 * Message after a track save (strategy-plan-apply response): saved, which new handles were queued for the
 * Mac worker, and whether the xGrowth profile mirror failed. kind 'err' only when the mirror failed.
 * @returns {{kind:'ok'|'err', text:string}}
 */
export function tracksSavedText(res) {
  const bits = ['Tracks saved.'];
  const handles = (res?.refresh?.handles || []).map((h) => `@${cleanHandle(h)}`).join(', ');
  if (res?.refresh?.requestId) bits.push(`${handles} queued — run the Mac refresh worker to load posts.`);
  else if (res?.refresh?.error) bits.push(`Could not queue ${handles} for a refresh: ${res.refresh.error}`);
  if (res?.profileSync?.error) bits.push(`Benchmark list was not copied to the X growth profile: ${res.profileSync.error}`);
  return { kind: res?.profileSync?.error ? 'err' : 'ok', text: bits.join(' ') };
}

/** Per-benchmark row: rows pulled, last pulled, and honest refresh state. */
export function trackBenchmarkRow(handle, rowsMetaByHandle, request) {
  const h = cleanHandle(handle);
  const item = rowsMetaByHandle?.[h];
  const rows = rowCountOf(item);
  const result = isObj(request?.results) ? request.results[h] : null;
  const inRequest = Array.isArray(request?.handles) && request.handles.includes(h);
  let note = '';
  const at = clockText(request?.requeuedAt || request?.createdAt);
  if (inRequest && request.status === 'queued') note = `Queued${at ? ` at ${at}` : ''}. Needs the Mac worker: ${WORKER_CMD}`;
  else if (inRequest && request.status === 'running') note = 'Refreshing now…';
  else if (inRequest && result) note = handleResultText(h, result);
  return { handle: h, rows, freshness: freshnessLabel(item), needsRefresh: /refresh/.test(freshnessLabel(item)), note, queued: inRequest && request.status === 'queued' };
}

const pctText = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : null);

/**
 * Per-track profile summary lines. `profile` is the server's per-track profile (tolerated absent):
 * { status:'no-benchmark'|'ok', rowCount, formatMix:{video,image,text}, medianLength, linkInReplyRate, bestHoursCT:[] }.
 * @returns {{state:'no-benchmark'|'pending'|'ready', headline:string, lines:string[]}}
 */
export function trackProfileSummary(track, profile) {
  if (!track?.benchmarks?.length || profile?.status === 'no-benchmark') {
    return { state: 'no-benchmark', headline: 'No benchmark yet. Add one.', lines: ['Until then this track leans on your own history, shown as a gap, not as benchmark numbers.'] };
  }
  if (!isObj(profile) || profile.status === 'pending' || !(profile.rowCount > 0)) {
    return { state: 'pending', headline: 'Profile not built yet.', lines: ['Refresh the benchmark data, then reload.'] };
  }
  const lines = [];
  const mix = isObj(profile.formatMix) ? Object.entries(profile.formatMix).filter(([, v]) => Number.isFinite(v)).map(([k, v]) => `${pctText(v)} ${k}`) : [];
  if (mix.length) lines.push(`Format mix: ${mix.join(' · ')}`);
  if (Number.isFinite(profile.medianLength)) lines.push(`Median length: ${Math.round(profile.medianLength)} characters`);
  if (Number.isFinite(profile.linkInReplyRate)) lines.push(`Link in reply: ${pctText(profile.linkInReplyRate)} of posts`);
  if (Array.isArray(profile.bestHoursCT) && profile.bestHoursCT.length) lines.push(`Best hours (CT): ${profile.bestHoursCT.join(', ')}`);
  return { state: 'ready', headline: `Built from ${profile.rowCount} benchmark posts.`, lines };
}

// ---- library labels (rights / story) ------------------------------------------------------------------------
/** Label for a cleared rights state; UE-hosted policy clearance reads differently from a hand-cleared one. */
export function rightsLabel(item) {
  if (item?.rights === 'cleared') return item?.rightsSource?.policy === 'ue-hosted-cleared' ? 'cleared (UE-hosted)' : 'Cleared';
  return null;
}

/** Placeholder stories ("TODO", "[add your memory]") read as an honest state, not as missing data. */
export function storyStateLabel(item, isMissing) {
  return isMissing ? 'no memory yet — facts used' : null;
}

// ---- daily suggestion chips ---------------------------------------------------------------------------------
/** "music · Underground Existence" style chip text, or null when neither is present. */
export function suggestionTrackChip(s) {
  const parts = [s?.track && (typeof s.track === 'string' ? s.track : s.track.label || s.track.id), s?.promotion?.label].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** The self-reply / promotion link line, or null. */
export function suggestionLinkLine(s) {
  const reply = String(s?.draft?.selfReply ?? '').trim();
  if (reply) return { kind: 'self-reply', text: reply };
  if (s?.promotion?.url) return { kind: 'promotion', text: `${s.promotion.label || 'Link'}: ${s.promotion.url}` };
  return null;
}

// ---- suggestion media staging (NAS item with no playable ref) -------------------------------------------------
export const STAGE_APPROVAL_COPY = 'Your click is the approval: it uploads this file from the NAS to Firebase so it can be scheduled. The Mac analyzer must be online to do the upload.';

/**
 * Button set for a suggestion card's media.
 * @param {object} s  suggestion ({package:{media:{kind,ref}|{status:'needs-staging'}}})
 * @param {{busy?:boolean, queued?:boolean, error?:string}} [stage]  local state of the owner's Stage click
 * @returns {{status:'none'|'ready'|'needs-staging', chip:string|null, canSave:boolean, showStage:boolean, stageLabel:string, stageDisabled:boolean, note:string, noteTone:'info'|'warn'|'error'|null}}
 */
export function suggestionMediaState(s, stage = {}) {
  const media = s?.package?.media;
  if (!isObj(media) || media.status !== 'needs-staging') {
    const has = isObj(media) && !!media.ref;
    return { status: has ? 'ready' : 'none', chip: null, canSave: true, showStage: false, stageLabel: '', stageDisabled: true, note: '', noteTone: null };
  }
  let note = STAGE_APPROVAL_COPY;
  let noteTone = 'info';
  let stageLabel = 'Stage from NAS';
  if (stage.busy) { stageLabel = 'Staging…'; }
  if (stage.error) { note = stage.error; noteTone = 'error'; }
  else if (stage.queued) { note = 'Queued for the Mac analyzer. If it is offline the upload waits until it is back. Check again once it finishes; Save draft turns on when the file is staged.'; noteTone = 'warn'; stageLabel = 'Check again'; }
  return { status: 'needs-staging', chip: 'needs staging', canSave: false, showStage: true, stageLabel, stageDisabled: !!stage.busy, note, noteTone };
}

/** Plain text for a failed nas-stage call (offline analyzer, rights block, etc.). */
export function stageErrorText(err) {
  const msg = String(err?.message || '');
  if (/analyzer|offline|worker/i.test(msg)) return `The Mac analyzer is offline or not registered, so nothing was queued. ${msg}`.trim();
  return msg || 'Could not queue the staging upload.';
}
