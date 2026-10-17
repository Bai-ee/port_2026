// core.js — pure: day keys, endpoint naming, increments, aggregation, estimates, budget check.
// No I/O. Pricing is NEVER guessed: dollars are shown only for rates the owner set.

export class XBudgetError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'XBudgetError';
    this.code = 'x-budget';
    this.status = 429;
    Object.assign(this, detail);
  }
}

export const dayKey = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
export const monthKey = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 7);

/** Map keys must not contain '.', '/', ':' (Firestore field paths); keep readable. */
export const safeKey = (s) => String(s || 'unknown').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'unknown';

// Endpoints whose payload is USERS (billed as user lookups), not posts.
const USER_ENDPOINT = /^users\/by\/username$|^users\/me$|^users$|^users\/:id$|\/followers$|\/following$|^users\/by$/;
export const unitFor = (endpoint, kind) => (kind === 'write' ? 'write' : USER_ENDPOINT.test(endpoint) ? 'user' : 'post');

/** One call's increments, as a nested object of plain numbers (store turns them into increments). */
export function buildDelta({ clientId = null, endpoint, kind = 'read', posts = 0, source = 'other', ok = true }) {
  const unit = unitFor(endpoint, kind);
  const n = Math.max(0, Math.floor(Number(posts) || 0));
  const flat = {
    calls: 1,
    readCalls: kind === 'write' ? 0 : 1,
    writeCalls: kind === 'write' ? 1 : 0,
    readPosts: unit === 'post' ? n : 0,
    userReads: unit === 'user' ? n : 0,
    writes: unit === 'write' ? 1 : 0,
    errors: ok ? 0 : 1,
  };
  const slice = (key) => ({ calls: 1, readPosts: flat.readPosts, userReads: flat.userReads, writes: flat.writes, errors: flat.errors, _k: key });
  const strip = ({ _k, ...rest }) => rest;
  const delta = { ...flat, bySource: {}, byEndpoint: {}, byClient: {} };
  delta.bySource[safeKey(source)] = strip(slice());
  delta.byEndpoint[safeKey(endpoint)] = strip(slice());
  if (clientId) delta.byClient[safeKey(clientId)] = strip(slice());
  return delta;
}

const NUM = ['calls', 'readCalls', 'writeCalls', 'readPosts', 'userReads', 'writes', 'errors'];

function mergeSlice(into, from) {
  for (const k of NUM) into[k] = (into[k] || 0) + (Number(from?.[k]) || 0);
}
function mergeGroup(into, from) {
  for (const [name, v] of Object.entries(from || {})) mergeSlice((into[name] ||= {}), v);
}

export function emptyTotals() {
  return Object.fromEntries(NUM.map((k) => [k, 0]));
}

export function sumDays(days) {
  const t = emptyTotals();
  const bySource = {}, byEndpoint = {}, byClient = {};
  for (const d of days) {
    mergeSlice(t, d);
    mergeGroup(bySource, d.bySource); mergeGroup(byEndpoint, d.byEndpoint); mergeGroup(byClient, d.byClient);
  }
  return { ...t, bySource, byEndpoint, byClient };
}

/** Normalise the owner-set pricing/caps doc. Absent/invalid numbers become null (= not set). */
export function normalizePricing(raw = {}) {
  const num = (v, { int = false } = {}) => {
    if (v === '' || v == null) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    return int ? Math.floor(n) : n;
  };
  const sourceCaps = {};
  for (const [k, v] of Object.entries(raw.sourceCaps || {})) {
    const n = num(v, { int: true });
    if (n != null) sourceCaps[safeKey(k)] = n;
  }
  return {
    perPostReadUsd: num(raw.perPostReadUsd),
    perUserLookupUsd: num(raw.perUserLookupUsd),
    perWriteUsd: num(raw.perWriteUsd),
    dailyReadCap: num(raw.dailyReadCap, { int: true }),
    sourceCaps,
    note: String(raw.note || '').slice(0, 300),
  };
}

/** Estimated dollars for a totals slice; null when NO rate is set. Unset rates contribute nothing. */
export function estimateUsd(t, pricing) {
  const p = pricing || {};
  if (p.perPostReadUsd == null && p.perUserLookupUsd == null && p.perWriteUsd == null) return null;
  const usd = (t.readPosts || 0) * (p.perPostReadUsd || 0) + (t.userReads || 0) * (p.perUserLookupUsd || 0) + (t.writes || 0) * (p.perWriteUsd || 0);
  return Math.round(usd * 10000) / 10000;
}

/** Throws XBudgetError when today's read units + estimate exceed the daily (or per-source) cap. */
export function checkBudget({ today, pricing, source = 'other', estimatePosts = 0 }) {
  const est = Math.max(0, Math.floor(Number(estimatePosts) || 0));
  const used = (today?.readPosts || 0) + (today?.userReads || 0);
  const cap = pricing?.dailyReadCap;
  if (cap != null && used + est > cap) {
    throw new XBudgetError(`X API daily read cap reached: ${used} used + ${est} requested > cap ${cap}.`, { scope: 'daily', used, estimate: est, cap, source });
  }
  const sCap = pricing?.sourceCaps?.[safeKey(source)];
  if (sCap != null) {
    const s = today?.bySource?.[safeKey(source)] || {};
    const sUsed = (s.readPosts || 0) + (s.userReads || 0);
    if (sUsed + est > sCap) {
      throw new XBudgetError(`X API cap for "${source}" reached: ${sUsed} used + ${est} requested > cap ${sCap}.`, { scope: 'source', used: sUsed, estimate: est, cap: sCap, source });
    }
  }
  return { ok: true, used, estimate: est, cap: cap ?? null };
}
