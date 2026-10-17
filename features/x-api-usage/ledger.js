// ledger.js — record / budget / read. Recording NEVER throws into the caller's X call.
import { getXUsageContext } from './context.js';
import { buildDelta, checkBudget, dayKey, estimateUsd, monthKey, normalizePricing, sumDays, emptyTotals, XBudgetError } from './core.js';
import { createFirestoreUsageStore } from './store.js';

let injected = null;
let lazyDefault = null;

/** Tests / scripts: replace the store. Pass null to restore the Firestore default. Returns a restore fn. */
export function setXUsageStore(store) {
  const prev = injected;
  injected = store;
  return () => { injected = prev; };
}

function getStore() {
  if (injected) return injected;
  if (process.env.X_API_USAGE_DISABLED === '1') return null;
  return (lazyDefault ||= createFirestoreUsageStore());
}

/** Count one X API call. clientId/source fall back to the withXUsage context. Swallows its own errors. */
export async function recordXApiCall(call = {}, { now = Date.now() } = {}) {
  try {
    const store = getStore();
    if (!store) return false;
    const ctx = getXUsageContext();
    const delta = buildDelta({
      clientId: call.clientId ?? ctx.clientId ?? null,
      endpoint: call.endpoint || 'unknown',
      kind: call.kind === 'write' ? 'write' : 'read',
      posts: call.posts ?? 0,
      source: call.source || ctx.source || (call.kind === 'write' ? 'posting' : 'other'),
      ok: call.ok !== false,
    });
    await store.increment(dayKey(now), delta);
    return true;
  } catch (err) {
    console.error('[x-api-usage] record failed:', err?.message || err);
    return false;
  }
}

export async function getXPricing() {
  const store = getStore();
  return normalizePricing((store && (await store.getPricing())) || {});
}

export async function setXPricing(input = {}) {
  const store = getStore();
  if (!store) throw new Error('x-api-usage store unavailable');
  const current = (await store.getPricing()) || {};
  const patch = {};
  for (const k of ['perPostReadUsd', 'perUserLookupUsd', 'perWriteUsd', 'dailyReadCap', 'note', 'sourceCaps']) {
    if (k in input) patch[k] = input[k];
  }
  const next = normalizePricing({ ...current, ...patch });
  await store.setPricing(next);
  return next;
}

/** Throws XBudgetError (code 'x-budget') when today's reads + estimate would pass the cap. Free: one doc read. */
export async function assertXBudget({ source = 'other', estimatePosts = 0 } = {}, { now = Date.now() } = {}) {
  const store = getStore();
  if (!store) return { ok: true, skipped: true };
  const pricing = normalizePricing((await store.getPricing()) || {});
  if (pricing.dailyReadCap == null && !Object.keys(pricing.sourceCaps).length) return { ok: true, cap: null };
  const [doc] = await store.readDays([dayKey(now)]);
  return checkBudget({ today: sumDays(doc ? [doc] : []), pricing, source, estimatePosts });
}

const daysBack = (n, now) => Array.from({ length: n }, (_, i) => dayKey(now - i * 86400_000));

/** Dashboard read: {today, month, byDay[], bySource, byEndpoint, byClient, estUsd, estUsdToday, pricing, cap, projectUsage}. */
export async function readXUsage({ days = 30, now = Date.now() } = {}) {
  const store = getStore();
  const pricing = normalizePricing((store && (await store.getPricing())) || {});
  const dom = new Date(now).getUTCDate();
  const span = Math.max(Math.min(Math.floor(days) || 30, 90), dom);
  const keys = daysBack(span, now);
  const docs = store ? await store.readDays(keys) : [];
  const byKey = new Map(docs.map((d) => [d.day, d]));
  const window = keys.slice(0, Math.min(Math.floor(days) || 30, 90));
  const byDay = window.map((k) => {
    const t = sumDays(byKey.has(k) ? [byKey.get(k)] : []);
    return { day: k, calls: t.calls, readPosts: t.readPosts, userReads: t.userReads, writes: t.writes, errors: t.errors, estUsd: estimateUsd(t, pricing) };
  }).reverse();
  const todayTotals = sumDays(byKey.has(keys[0]) ? [byKey.get(keys[0])] : []);
  const mk = monthKey(now);
  const monthTotals = sumDays(docs.filter((d) => d.day.startsWith(mk)));
  const windowTotals = sumDays(window.filter((k) => byKey.has(k)).map((k) => byKey.get(k)));
  const used = todayTotals.readPosts + todayTotals.userReads;
  const meta = store ? await store.getMeta() : null;
  const strip = ({ bySource, byEndpoint, byClient, ...t }) => t;
  return {
    today: { ...strip(todayTotals), estUsd: estimateUsd(todayTotals, pricing), bySource: todayTotals.bySource },
    month: { month: mk, ...strip(monthTotals), estUsd: estimateUsd(monthTotals, pricing) },
    byDay,
    bySource: windowTotals.bySource,
    byEndpoint: windowTotals.byEndpoint,
    byClient: windowTotals.byClient,
    windowDays: window.length,
    estUsd: estimateUsd(windowTotals, pricing),
    pricing,
    ratesSet: pricing.perPostReadUsd != null || pricing.perUserLookupUsd != null || pricing.perWriteUsd != null,
    cap: { dailyReadCap: pricing.dailyReadCap, sourceCaps: pricing.sourceCaps, usedToday: used, remainingToday: pricing.dailyReadCap == null ? null : Math.max(0, pricing.dailyReadCap - used) },
    projectUsage: meta?.projectUsage ? { ...meta.projectUsage, checkedAt: meta.projectUsageAt ?? meta.projectUsage.checkedAt ?? null } : null,
    note: 'Counts come from this app only. The X developer portal remains the billing truth.',
  };
}

/**
 * X's own project usage (GET /2/usage/tweets: monthly post consumption + cap). A REAL call to X —
 * call only from an explicit admin action. The default fetcher records the call; the last answer is stored.
 * `fetchUsage` is injectable; the default is x-oauth.js getXUsage (app-only bearer, 2 HTTP calls).
 */
export async function getXProjectUsage({ fetchUsage, now = Date.now() } = {}) {
  const fn = fetchUsage || (await import('../social-posting/x-oauth.js')).getXUsage;
  const usage = await fn(); // the default (x-oauth getXUsage) records its own 'usage/tweets' call
  const store = getStore();
  if (store) await store.setMeta({ projectUsage: usage, projectUsageAt: now });
  return usage;
}

export { XBudgetError, emptyTotals };
