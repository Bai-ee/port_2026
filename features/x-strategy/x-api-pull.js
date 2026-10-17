// Strategy accounts via the PAID X API (data source 'x-api'; the default 'mac' path is bird + the Mac worker).
// SERVER-ONLY (the default client comes from twitter-service.js). Works in production with the Mac off.
//
// Same destination as the bird path: rows are produced by the SAME normalizer (normalizeTimeline) from X API tweets
// reshaped by x-api-mapper.js, and merged through the corpus store's writeMergedRows (merge by id, never drops
// stored rows) with source 'x-api'. Views come from public_metrics.impression_count (bird rows usually have none).
//
// Cost shape (estimateCorporaPull): per handle = 1 users/by/username lookup (skipped when x_api_user_ids has the id)
// + ceil(maxPerHandle/100) timeline pages of 100 posts. Incremental by default: since = newest stored post - 3 days.
// Every call is tagged with withXUsage({clientId, source:'strategy-accounts'}) and gated by assertXBudget (LEDGER).
// All I/O is injected (client, store, id cache, usage); tests use fakes and never reach the network.

import { normalizeTimeline } from '../x-benchmark/normalize-corpus.js';
import { withXUsage as defaultWithXUsage, assertXBudget as defaultAssertXBudget, XBudgetError } from '../x-api-usage/index.js';
import { normalizeHandle } from './corpus-store.js';
import { resolveHandles } from './pull-corpora.js';
import { mapXApiPage } from './x-api-mapper.js';
import { DEFAULT_DAYS } from './ingest.js';
import { PAGE_SIZE, DEFAULT_MAX_PER_HANDLE, HARD_MAX_PER_HANDLE, clampMaxPerHandle, estimateCorporaPull } from './x-api-estimate.js';

export { PAGE_SIZE, DEFAULT_MAX_PER_HANDLE, HARD_MAX_PER_HANDLE, estimateCorporaPull };

export const OVERLAP_DAYS = 3;                   // re-pull the last days so recent metrics (views/likes) refresh
export const DEFAULT_DEADLINE_MS = 80_000;       // fits the 120 s route maxDuration (vercel.json app/api/**)
export const MAX_INLINE_HANDLES = 6;             // same cap as PLAN_LIMITS.maxHandlesPerRefreshRequest

export const TIMELINE_FIELDS = Object.freeze({
  'tweet.fields': 'created_at,public_metrics,referenced_tweets,attachments,conversation_id',
  expansions: 'attachments.media_keys,referenced_tweets.id,referenced_tweets.id.author_id',
  'media.fields': 'type',
  'user.fields': 'username,name',
});

const clampMax = clampMaxPerHandle;

/** x_api_user_ids/{handle} -> {id} cache so a handle costs one lookup ever. */
export function createFirestoreUserIdCache(db) {
  const ref = (h) => db.collection('x_api_user_ids').doc(normalizeHandle(h));
  return {
    async get(h) { const s = await ref(h).get(); return s.exists ? (s.data()?.id ? String(s.data().id) : null) : null; },
    async set(h, id) { await ref(h).set({ id: String(id), handle: normalizeHandle(h), cachedAt: new Date().toISOString() }, { merge: true }); },
  };
}
export function createMemoryUserIdCache(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { async get(h) { return m.get(normalizeHandle(h)) ?? null; }, async set(h, id) { m.set(normalizeHandle(h), String(id)); }, _map: m };
}

const unwrap = (res) => res?.data && !Array.isArray(res.data) && ('data' in res.data || 'meta' in res.data) ? res.data : (res || {});

/** Classify an X API error: 429 / 403 stop the whole run, anything else only fails that handle. */
export function classifyXApiError(err) {
  const code = Number(err?.code ?? err?.status ?? err?.data?.status);
  if (err instanceof XBudgetError || err?.code === 'x-budget') return { kind: 'x-budget', stop: true, message: String(err.message).slice(0, 200) };
  if (code === 429 || err?.rateLimitError) return { kind: 'rate-limited', stop: true, message: 'X API rate limit (429)' };
  if (code === 401 || code === 403) return { kind: 'x-forbidden', stop: true, message: `X API ${code}: not entitled or unauthorized` };
  return { kind: 'error', stop: false, message: String(err?.message || err).slice(0, 200) };
}

/** Resolve (and cache) one handle's user id. -> {id, called:boolean}. */
async function resolveUserId({ client, cache, handle, cached }) {
  if (cached) return { id: cached, called: false };
  const res = await client.v2.userByUsername(handle);
  const id = res?.data?.id;
  if (!id) throw Object.assign(new Error(`@${handle}: user not found`), { code: 404 });
  await cache.set(handle, id).catch(() => {});
  return { id: String(id), called: true, user: res.data };
}

/**
 * Page one user's timeline (retweets excluded). -> {tweets (bird shape), pages, error}. Keeps what was pulled on error.
 * Pure of Firestore; `client.v2.userTimeline(id, params)` is the only call.
 */
export async function fetchTimelineViaXApi({ client, userId, author, sinceIso, maxPerHandle = DEFAULT_MAX_PER_HANDLE, deadlineAt = Infinity, now = Date.now }) {
  const cap = clampMax(maxPerHandle);
  const tweets = [];
  const seen = new Set();
  let token = null;
  let pages = 0;
  let error = null;
  while (tweets.length < cap) {
    if (now() > deadlineAt) { error = { kind: 'deadline', message: 'time budget reached' }; break; }
    const params = {
      ...TIMELINE_FIELDS,
      max_results: Math.max(5, Math.min(PAGE_SIZE, cap - tweets.length)),
      exclude: ['retweets'],
      ...(sinceIso ? { start_time: sinceIso } : {}),
      ...(token ? { pagination_token: token } : {}),
    };
    let page;
    try { page = unwrap(await client.v2.userTimeline(userId, params)); } catch (err) { error = classifyXApiError(err); break; }
    pages += 1;
    for (const t of mapXApiPage(page, { author })) {
      if (t.id && !seen.has(t.id)) { seen.add(t.id); tweets.push(t); }
    }
    token = page?.meta?.next_token || null;
    if (!token || !(page?.data || []).length) break;
  }
  return { tweets, pages, error };
}

const newestUtc = (rows) => rows.reduce((m, r) => (typeof r?.utc === 'string' && r.utc > m ? r.utc : m), '');

/**
 * @param {string} clientId
 * @param {Object} o
 * @param {string[]} [o.handles]       explicit; else resolved from o.readXGrowth(clientId) (own + benchmarks)
 * @param {()=>Promise<object|null>|((id:string)=>Promise<object|null>)} [o.readXGrowth]
 * @param {string} [o.since]           ISO; wins over the incremental default
 * @param {number} [o.maxPerHandle]    default 300, hard max 1000
 * @param {number} [o.days]            history window when a handle has no stored rows (default 65)
 * @param {object} o.store             corpus store {readRows, writeMergedRows}
 * @param {object} [o.client]          X API client (v2.userByUsername / v2.userTimeline) or o.getClient()
 * @param {object} [o.userIdCache]
 * @param {{withXUsage?:Function, assertXBudget?:Function}} [o.usage]
 * @param {boolean} [o.write=true]
 * @param {number} [o.deadlineMs] @param {()=>number} [o.now] @param {(l:string)=>void} [o.log]
 * @returns {Promise<{ok:boolean, source:'x-api', clientId:string, handles:object, calls:number, posts:number, stopped:string|null, error?:string}>}
 */
export async function pullCorporaViaXApi(clientId, {
  handles, readXGrowth, since, maxPerHandle = DEFAULT_MAX_PER_HANDLE, days = DEFAULT_DAYS, store, client, getClient, userIdCache,
  usage = {}, write = true, deadlineMs = DEFAULT_DEADLINE_MS, now = Date.now, log = () => {},
} = {}) {
  if (!store) throw new Error('pullCorporaViaXApi: store is required');
  const withXUsage = usage.withXUsage || defaultWithXUsage;
  const assertXBudget = usage.assertXBudget || defaultAssertXBudget;
  const cache = userIdCache || createMemoryUserIdCache();
  const out = { ok: false, source: 'x-api', clientId, handles: {}, calls: 0, posts: 0, stopped: null };

  let list = handles;
  if (!Array.isArray(list)) {
    if (typeof readXGrowth !== 'function') throw new Error('pullCorporaViaXApi: handles or readXGrowth is required');
    list = resolveHandles(await readXGrowth(clientId)).handles;
  }
  const clean = [...new Set(list.map((h) => { try { return normalizeHandle(h); } catch { return null; } }).filter(Boolean))];
  if (!clean.length) return { ...out, ok: false, error: 'No handles to pull: the X growth profile has no own or benchmark handle.' };
  if (clean.length > MAX_INLINE_HANDLES) return { ...out, error: `At most ${MAX_INLINE_HANDLES} handles per X API pull (got ${clean.length}).` };

  let xc = client;
  if (!xc) {
    try { xc = (getClient || (async () => (await import('../social-posting/twitter-service.js')).getXReadClient()))(); xc = await xc; } catch (err) {
      return { ...out, error: String(err?.message || 'X API credentials are not configured.').slice(0, 200), stopped: 'no-credentials' };
    }
  }

  const deadlineAt = now() + deadlineMs;
  const pulledAt = new Date(now()).toISOString();
  const per = clampMax(maxPerHandle);

  for (const handle of clean) {
    if (out.stopped) { out.handles[handle] = { status: 'skipped', reason: out.stopped }; continue; }
    if (now() > deadlineAt) { out.stopped = 'deadline'; out.handles[handle] = { status: 'skipped', reason: 'deadline' }; continue; }
    const rec = { status: 'failed', calls: 0, pulledRows: 0 };
    out.handles[handle] = rec;
    try {
      const stored = await store.readRows(handle).catch(() => ({ rows: [] }));
      const newest = newestUtc(stored.rows || []);
      const sinceIso = since || (newest ? new Date(Date.parse(newest) - OVERLAP_DAYS * 86_400_000).toISOString() : new Date(now() - days * 86_400_000).toISOString());
      rec.since = sinceIso;
      const cached = await cache.get(handle).catch(() => null);
      await assertXBudget({ source: 'strategy-accounts', clientId, estimatePosts: Math.ceil(per / PAGE_SIZE) * PAGE_SIZE });

      await withXUsage({ clientId, source: 'strategy-accounts' }, async () => {
        const who = await resolveUserId({ client: xc, cache, handle, cached });
        if (who.called) { rec.calls += 1; out.calls += 1; }
        const tl = await fetchTimelineViaXApi({ client: xc, userId: who.id, author: { username: handle, ...(who.user?.name ? { name: who.user.name } : {}) }, sinceIso, maxPerHandle: per, deadlineAt, now });
        rec.calls += tl.pages; out.calls += tl.pages;
        const { rows } = normalizeTimeline(tl.tweets, { handle, tzOffsetHours: 0, lanes: [], since: sinceIso });
        rec.pulledRows = rows.length;
        out.posts += tl.tweets.length;
        if (tl.error) { rec.error = tl.error; if (tl.error.kind !== 'error') out.stopped = tl.error.kind; } // rate-limited / x-forbidden / deadline end the run
        if (!rows.length) { rec.status = tl.error ? 'failed' : 'done'; return; }
        if (!write) { rec.status = tl.error ? 'partial' : 'done'; rec.wouldWrite = true; return; }
        const merged = await store.writeMergedRows(handle, rows, { pulledAt, source: 'x-api' });
        Object.assign(rec, { status: tl.error ? 'partial' : 'done', added: merged.added, updated: merged.updated, rowCount: merged.after });
      });
      log(`  @${handle}: ${rec.status} (${rec.pulledRows} rows, ${rec.calls} calls)`);
    } catch (err) {
      const c = classifyXApiError(err);
      rec.error = { kind: c.kind, message: c.message };
      if (c.stop) out.stopped = c.kind;
      log(`  @${handle}: FAILED ${c.kind}: ${c.message}`);
    }
  }
  const vals = Object.values(out.handles);
  out.ok = vals.some((h) => h.status === 'done' || h.status === 'partial');
  return out;
}
