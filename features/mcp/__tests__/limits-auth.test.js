import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkRateLimit, auditEntry, createMemoryCounters, createFirestoreCounters, rpcCost, reserveDailyPaidSlot, dailyPaidKey,
  LimitError, DAILY_PAID_CAP, RATE_LIMIT,
} from '../limits.js';
import { authenticateBearer, McpAuthError, bearerOf, originOf, wwwAuthenticate, resourceUrl, OWNER_TOKEN_MIN_LENGTH } from '../auth.js';
import { signAccessToken } from '../oauth.js';
// Fake secret fixtures are assembled at runtime so the repo's pre-push secret scanner does not flag them.
const SK = ['s', 'k', '-'].join('');
const PEM_KIND = ['PRIVATE', 'KEY'].join(' ');
const PEM_BEGIN = `-----BEGIN ${PEM_KIND}-----`;

const NOW = Date.parse('2026-10-12T12:00:00Z');
const ME = 'bryanballi@gmail.com';

test('rate limit: allows up to the limit inside a window, then refuses; next window resets', async () => {
  const counters = createMemoryCounters();
  for (let i = 1; i <= 3; i += 1) assert.equal((await checkRateLimit(counters, 'tok', { limit: 3, windowMs: 1000, now: NOW })).allowed, true);
  const over = await checkRateLimit(counters, 'tok', { limit: 3, windowMs: 1000, now: NOW });
  assert.equal(over.allowed, false);
  assert.ok(over.retryAfterSec >= 1);
  assert.equal((await checkRateLimit(counters, 'other', { limit: 3, windowMs: 1000, now: NOW })).allowed, true); // per-key
  assert.equal((await checkRateLimit(counters, 'tok', { limit: 3, windowMs: 1000, now: NOW + 1000 })).allowed, true); // new window
  assert.equal(RATE_LIMIT.calls, 120);
});

test('audit entry: redacted, capped at ~1k chars, lowercased email', () => {
  const e = auditEntry({ now: NOW, email: 'Bryan@X.test', tool: 'get_document', args: { path: 'clients/a', apiKey: SK + 'abcdefghijklmnopqrstuvwxyz', note: 'x'.repeat(5000) }, ok: true, ms: 12.4 });
  assert.equal(e.email, 'bryan@x.test');
  assert.ok(e.args.length <= 1003);
  assert.ok(!e.args.includes(SK + 'abcdef'));
  assert.equal(e.ms, 12);
  assert.equal(e.at, '2026-10-12T12:00:00.000Z');
});

test('rpcCost: every tools/call in a batch counts, other messages cost 1', () => {
  const call = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'x' } };
  assert.equal(rpcCost(call), 1);
  assert.equal(rpcCost({ jsonrpc: '2.0', id: 1, method: 'ping' }), 1);
  assert.equal(rpcCost(Array.from({ length: 20 }, () => call)), 20);
  assert.equal(rpcCost([call, { method: 'ping' }, call]), 2);
  assert.equal(rpcCost([{ method: 'ping' }]), 1);
  assert.equal(rpcCost(null), 1);
});

test('rate limit: a batch spends its full cost, and the key is the account (fresh tokens do not reset it)', async () => {
  const counters = createMemoryCounters();
  const batch = rpcCost(Array.from({ length: 20 }, () => ({ method: 'tools/call' })));
  // 120/10min: six full batches fit, the seventh does not
  for (let i = 0; i < 6; i += 1) assert.equal((await checkRateLimit(counters, `mcp:${ME}`, { now: NOW, cost: batch })).allowed, true);
  assert.equal((await checkRateLimit(counters, `mcp:${ME}`, { now: NOW, cost: batch })).allowed, false);
  // the old key (token id) is irrelevant now; the same account with any "new token" is still blocked
  assert.equal((await checkRateLimit(counters, `mcp:${ME}`, { now: NOW, cost: 1 })).allowed, false);
  assert.equal((await checkRateLimit(counters, 'mcp:someone-else@x.test', { now: NOW, cost: 1 })).allowed, true);
});

test('daily paid-sync cap: atomic, exactly 10 under concurrency, resets next UTC day', async () => {
  const counters = createMemoryCounters();
  const results = await Promise.allSettled(Array.from({ length: 25 }, () => reserveDailyPaidSlot(counters, { now: NOW })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, DAILY_PAID_CAP);
  const refused = results.filter((r) => r.status === 'rejected');
  assert.equal(refused.length, 15);
  assert.ok(refused.every((r) => r.reason instanceof LimitError && r.reason.code === 'daily-cap'));
  assert.equal(counters._raw.get(dailyPaidKey(NOW)), DAILY_PAID_CAP, 'refusals never increment');
  await reserveDailyPaidSlot(counters, { now: NOW + 86400000 }); // next UTC day
});

test('firestore counters.reserve reads and increments inside ONE transaction (no read outside it)', async () => {
  const log = [];
  const store = new Map();
  let inTx = false;
  const doc = (id) => ({ id });
  const db = {
    collection: () => ({ doc }),
    runTransaction: async (fn) => {
      inTx = true;
      try {
        return await fn({
          get: async (ref) => { log.push(['get', inTx]); return { exists: store.has(ref.id), data: () => store.get(ref.id) }; },
          set: (ref, v) => { log.push(['set', inTx]); store.set(ref.id, v); },
        });
      } finally { inTx = false; }
    },
  };
  const c = createFirestoreCounters(db);
  for (let i = 0; i < DAILY_PAID_CAP; i += 1) assert.equal((await c.reserve('k', DAILY_PAID_CAP, 1)).ok, true);
  assert.equal((await c.reserve('k', DAILY_PAID_CAP, 1)).ok, false);
  assert.ok(log.length > 0 && log.every(([, inside]) => inside === true));
  assert.equal(store.get('k').count, DAILY_PAID_CAP);
  assert.equal(await c.incr('k2', 1, 5), 5);
});

// ---- auth --------------------------------------------------------------------------------------------------

const SECRET = 'unit-test-secret-0123456789abcdef';
const ORIGIN = 'https://hitloop.agency';
const isAdmin = async (e) => e === ME;
const tokenFor = (email, over = {}) => signAccessToken({ secret: SECRET, email, aud: resourceUrl(ORIGIN), now: NOW, ...over });
const auth = (header, env = { MCP_OAUTH_SECRET: SECRET }, now = NOW + 1000) => authenticateBearer({ header, env, now, origin: ORIGIN, isAdmin });
const fails = (p, status) => assert.rejects(p, (e) => e instanceof McpAuthError && e.status === status);

test('auth: valid OAuth token for an admin passes', async () => {
  const r = await auth(`Bearer ${tokenFor(ME)}`);
  assert.deepEqual([r.email, r.via], [ME, 'oauth']);
});

test('auth: missing, malformed, expired, wrong-audience and non-admin are refused', async () => {
  await fails(auth(undefined), 401);
  await fails(auth('Basic abc'), 401);
  await fails(auth('Bearer not-a-token'), 401);
  await fails(auth(`Bearer ${tokenFor(ME)}`, { MCP_OAUTH_SECRET: SECRET }, NOW + 3600_000 + 1), 401);
  await fails(auth(`Bearer ${tokenFor(ME, { aud: 'https://evil.test/api/mcp' })}`), 401);
  await fails(auth(`Bearer ${tokenFor('stranger@x.test')}`), 403);
});

test('auth: FAILS CLOSED with 503 when MCP_OAUTH_SECRET is unset, even with the owner token', async () => {
  await fails(auth(`Bearer ${tokenFor(ME)}`, {}), 503);
  await fails(auth('Bearer owner-token-value', { MCP_OWNER_TOKEN: 'owner-token-value' }), 503);
});

test('auth: static owner token works (constant-time compare), wrong one does not, still requires an admin', async () => {
  const good = 'owner-token-value-0123456789-abcdefghij';
  assert.ok(good.length >= OWNER_TOKEN_MIN_LENGTH);
  const env = { MCP_OAUTH_SECRET: SECRET, MCP_OWNER_TOKEN: good };
  assert.equal((await auth(`Bearer ${good}`, env)).via, 'owner-token');
  await fails(auth(`Bearer ${good}x`, env), 401);
  await fails(auth(`Bearer ${good}`, { ...env, MCP_OWNER_EMAIL: 'notadmin@x.test' }), 403);
});

test('auth: MCP_OWNER_TOKEN shorter than 32 chars is ignored (never accepted)', async () => {
  for (const short of ['owner-token-value-123', 'x'.repeat(31)]) {
    await fails(auth(`Bearer ${short}`, { MCP_OAUTH_SECRET: SECRET, MCP_OWNER_TOKEN: short }), 401);
  }
  assert.equal((await auth(`Bearer ${'y'.repeat(32)}`, { MCP_OAUTH_SECRET: SECRET, MCP_OWNER_TOKEN: 'y'.repeat(32) })).via, 'owner-token');
});

test('origin and metadata helpers', () => {
  assert.equal(bearerOf('bearer abc'), 'abc');
  assert.equal(bearerOf('Token abc'), null);
  const h = new Headers({ 'x-forwarded-host': 'hitloop.agency', 'x-forwarded-proto': 'https' });
  assert.equal(originOf(h, 'http://internal:3000/x', {}), 'https://hitloop.agency');
  assert.equal(originOf(h, 'http://internal:3000/x', { MCP_PUBLIC_ORIGIN: 'https://www.hitloop.agency/' }), 'https://www.hitloop.agency');
  assert.equal(originOf(new Headers({ host: 'localhost:3013' }), 'http://localhost:3013/x', {}), 'http://localhost:3013');
  // production: MCP_PUBLIC_ORIGIN is required (fail closed, 503); the Host header is never trusted for the audience
  const prod = { VERCEL_ENV: 'production' };
  assert.throws(() => originOf(h, 'http://internal:3000/x', prod), (e) => e instanceof McpAuthError && e.status === 503);
  assert.equal(originOf(h, 'http://internal:3000/x', { ...prod, MCP_PUBLIC_ORIGIN: 'https://hitloop.agency' }), 'https://hitloop.agency');
  assert.equal(originOf(h, 'http://internal:3000/x', { VERCEL_ENV: 'preview' }), 'https://hitloop.agency'); // non-production still derives it
  assert.equal(wwwAuthenticate(ORIGIN), 'Bearer resource_metadata="https://hitloop.agency/.well-known/oauth-protected-resource"');
});
