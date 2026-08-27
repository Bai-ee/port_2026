// Plain `node --test` has no `window`/`sessionStorage` (no jsdom). The cache
// helpers below gate on `typeof window === 'undefined'` and then read/write
// via `window.sessionStorage` — this shim provides a minimal in-memory
// window global, assigned before the module's functions are ever called
// (module-load order doesn't matter: bootstrap-session.js has no top-level
// side effects, only function bodies that touch `window`).
const sessionMemory = new Map();
const fakeSessionStorage = {
  getItem(key) { return sessionMemory.has(key) ? sessionMemory.get(key) : null; },
  setItem(key, value) { sessionMemory.set(key, String(value)); },
  removeItem(key) { sessionMemory.delete(key); },
  clear() { sessionMemory.clear(); },
};
globalThis.window = globalThis.window || {};
globalThis.window.sessionStorage = fakeSessionStorage;

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  withImpersonation,
  getBootstrapCacheKey,
  readCachedDashboardBootstrap,
  writeCachedDashboardBootstrap,
  isCachedBootstrapUsable,
  fetchDashboardBootstrap,
  DASHBOARD_BOOTSTRAP_CACHE_MAX_AGE_MS,
} from '../bootstrap-session.js';

const USER = { uid: 'user-1', getIdToken: async () => 'fake-token' };

beforeEach(() => {
  sessionMemory.clear();
  delete globalThis.fetch;
});

test('withImpersonation: no clientId returns the path untouched', () => {
  assert.strictEqual(withImpersonation('/api/dashboard/bootstrap', null), '/api/dashboard/bootstrap');
  assert.strictEqual(withImpersonation('/api/dashboard/bootstrap', undefined), '/api/dashboard/bootstrap');
});

test('withImpersonation: appends "?as=" when the path has no existing query string', () => {
  assert.strictEqual(withImpersonation('/api/dashboard/bootstrap', 'client-123'), '/api/dashboard/bootstrap?as=client-123');
});

test('withImpersonation: appends "&as=" when the path already has a query string', () => {
  assert.strictEqual(withImpersonation('/dashboard?tab=brief', 'client-123'), '/dashboard?tab=brief&as=client-123');
});

test('withImpersonation: preserves a trailing hash fragment after the query param', () => {
  assert.strictEqual(withImpersonation('/dashboard#section', 'client-123'), '/dashboard?as=client-123#section');
});

test('withImpersonation: URL-encodes the clientId', () => {
  assert.strictEqual(withImpersonation('/dashboard', 'client id/with spaces'), '/dashboard?as=client%20id%2Fwith%20spaces');
});

// ── Phase 3 (DASHBOARD_CREATION_FAILURE_UX_CLAUDE_PLAN.md §3): the bootstrap
// cache must never let a stale "healthy" reading stand in for a live check
// that could reveal a newly-opened incident, while a cached OPEN incident
// stays safe to serve at any age (it can only be sticky, never hide one).

function seedRawCache(user, impersonateId, data, cachedAtMs) {
  window.sessionStorage.setItem(getBootstrapCacheKey(user, impersonateId), JSON.stringify({ data, cachedAtMs }));
}

test('writeCachedDashboardBootstrap + readCachedDashboardBootstrap: round-trips data with a cachedAtMs stamp', () => {
  const before = Date.now();
  writeCachedDashboardBootstrap(USER, null, { hello: 'world' });
  const entry = readCachedDashboardBootstrap(USER, null);
  assert.deepEqual(entry.data, { hello: 'world' });
  assert.ok(entry.cachedAtMs >= before);
});

test('readCachedDashboardBootstrap: a pre-existing bare (unwrapped) cache entry is treated as maximally stale, not thrown on', () => {
  window.sessionStorage.setItem(getBootstrapCacheKey(USER, null), JSON.stringify({ some: 'legacy-shape' }));
  const entry = readCachedDashboardBootstrap(USER, null);
  assert.deepEqual(entry.data, { some: 'legacy-shape' });
  assert.equal(entry.cachedAtMs, 0);
});

test('isCachedBootstrapUsable: a healthy cache is usable within the max age, not usable once past it', () => {
  const freshHealthy = { data: {}, cachedAtMs: Date.now() - 1000 };
  assert.equal(isCachedBootstrapUsable(freshHealthy), true);

  const staleHealthy = { data: {}, cachedAtMs: Date.now() - (DASHBOARD_BOOTSTRAP_CACHE_MAX_AGE_MS + 1000) };
  assert.equal(isCachedBootstrapUsable(staleHealthy), false);
});

test('isCachedBootstrapUsable: a cache showing an OPEN incident is usable no matter how old', () => {
  const veryOldButOpen = { data: { creationFailure: { status: 'open' } }, cachedAtMs: Date.now() - (DASHBOARD_BOOTSTRAP_CACHE_MAX_AGE_MS * 100) };
  assert.equal(isCachedBootstrapUsable(veryOldButOpen), true);
});

test('isCachedBootstrapUsable: null/empty entries are never usable', () => {
  assert.equal(isCachedBootstrapUsable(null), false);
  assert.equal(isCachedBootstrapUsable({ data: null, cachedAtMs: Date.now() }), false);
});

test('fetchDashboardBootstrap: a successful fetch writes the cache and returns the data untouched', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ creationFailure: null, foo: 'bar' }) });
  const result = await fetchDashboardBootstrap(USER, null);
  assert.deepEqual(result, { creationFailure: null, foo: 'bar' });
  const cached = readCachedDashboardBootstrap(USER, null);
  assert.deepEqual(cached.data, { creationFailure: null, foo: 'bar' });
});

test('fetchDashboardBootstrap: a non-ok, non-401/403 response falls back to a FRESH healthy cache with a warning', async () => {
  seedRawCache(USER, null, { creationFailure: null, foo: 'cached' }, Date.now() - 1000);
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
  const result = await fetchDashboardBootstrap(USER, null);
  assert.equal(result.foo, 'cached');
  assert.match(result._bootstrapWarning, /boom/);
});

test('fetchDashboardBootstrap: a non-ok response does NOT fall back to a STALE healthy cache — throws instead of silently hiding a possible new incident', async () => {
  seedRawCache(USER, null, { creationFailure: null, foo: 'stale-cached' }, Date.now() - (DASHBOARD_BOOTSTRAP_CACHE_MAX_AGE_MS + 1000));
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
  await assert.rejects(() => fetchDashboardBootstrap(USER, null), /boom/);
});

test('fetchDashboardBootstrap: a non-ok response DOES fall back to a STALE cache that already shows an open incident — sticky-safe, never hidden', async () => {
  seedRawCache(USER, null, { creationFailure: { status: 'open', publicCode: 'HIT-ABC123' }, foo: 'stale-but-gated' }, Date.now() - (DASHBOARD_BOOTSTRAP_CACHE_MAX_AGE_MS + 1000));
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
  const result = await fetchDashboardBootstrap(USER, null);
  assert.equal(result.creationFailure.status, 'open');
  assert.equal(result.foo, 'stale-but-gated');
});

test('fetchDashboardBootstrap: a 401/403 never falls back to cache, even a fresh one — an auth failure must not resurrect a stale session', async () => {
  seedRawCache(USER, null, { creationFailure: null, foo: 'cached' }, Date.now());
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) });
  await assert.rejects(() => fetchDashboardBootstrap(USER, null), /unauthorized/);
});

test('fetchDashboardBootstrap: a network throw falls back to a fresh cache, but a stale one still throws honestly', async () => {
  globalThis.fetch = async () => { throw new Error('network down'); };

  seedRawCache(USER, null, { creationFailure: null, foo: 'fresh' }, Date.now() - 1000);
  const fresh = await fetchDashboardBootstrap(USER, null);
  assert.equal(fresh.foo, 'fresh');

  seedRawCache(USER, null, { creationFailure: null, foo: 'stale' }, Date.now() - (DASHBOARD_BOOTSTRAP_CACHE_MAX_AGE_MS + 1000));
  await assert.rejects(() => fetchDashboardBootstrap(USER, null), /network down/);
});
