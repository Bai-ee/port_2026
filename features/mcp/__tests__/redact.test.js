import test from 'node:test';
import assert from 'node:assert/strict';
import { redactValue, redactString, isDeniedPath, isDeniedSubcollection, REDACT_KEY_RE, assertReadablePath, parsePath, isDeniedCollectionName, capText, DENY_COLLECTIONS, PathError } from '../redact.js';
import { normalizeQueryArgs, runQuery, runGetDocument, runListCollections } from '../firestore-query.js';
import { createFakeDb } from './fake-db.js';
import { ToolError } from '../jsonrpc.js';
// Fake secret fixtures are assembled at runtime so the repo's pre-push secret scanner does not flag them.
const SK = ['s', 'k', '-'].join('');
const PEM_KIND = ['PRIVATE', 'KEY'].join(' ');
const PEM_BEGIN = `-----BEGIN ${PEM_KIND}-----`;
const SKL = ['sk', 'live', ''].join('_');
const SKT = ['sk', 'test', ''].join('_');
const RKL = ['rk', 'live', ''].join('_');
const GHP = ['gh', 'p_'].join('');
const AIZA = ['AI', 'za'].join('');
const RE = ['r', 'e_'].join('');
const G1 = ['1', '//'].join('');
const COLON = ':';

test('redaction: secret-looking keys, recursively, in arrays too', () => {
  const out = redactValue({
    name: 'ok', accessToken: 'abc', nested: { refreshToken: 'r', api_key: 'k', apiKey: 'k2', password: 'p', privateKey: 'x', Authorization: 'Bearer q', cookie: 'c', sessionId: 's', client_secret: 'z', credentials: { a: 1 } },
    list: [{ token: 't' }, { fine: 1 }],
  });
  assert.equal(out.name, 'ok');
  assert.equal(out.accessToken, '[redacted]');
  for (const k of ['refreshToken', 'api_key', 'apiKey', 'password', 'privateKey', 'Authorization', 'cookie', 'sessionId', 'client_secret', 'credentials']) assert.equal(out.nested[k], '[redacted]', k);
  assert.equal(out.list[0].token, '[redacted]');
  assert.equal(out.list[1].fine, 1);
});

test('redaction: numeric/boolean values under token-ish keys pass (usage counts), strings do not', () => {
  const out = redactValue({ inputTokens: 12, outputTokens: 3, tokenUsed: true, tokens: 'abc' });
  assert.deepEqual(out, { inputTokens: 12, outputTokens: 3, tokenUsed: true, tokens: '[redacted]' });
});

test('redaction: key rule can be turned off for agent output, value patterns still apply', () => {
  const out = redactValue({ lastRefreshAt: '2026-10-12', note: 'key ' + SK + 'abcdefghijklmnopqrstuv here' }, { keys: false });
  assert.equal(out.lastRefreshAt, '2026-10-12');
  assert.equal(out.note, 'key [redacted] here');
});

test('redaction: secret-looking string values', () => {
  assert.equal(redactString('x sk-ant-api03-abcdefghijklmnop y'), 'x [redacted] y');
  assert.equal(redactString(`${GHP}abcdefghijklmnopqrstuvwx`), '[redacted]');
  assert.equal(redactString('github_pat_11ABCDEFG0123456789_abcdef'), '[redacted]');
  assert.equal(redactString(`${AIZA}SyA-1234567890abcdefghijklmnopqrstu`), '[redacted]');
  assert.equal(redactString(`${['xo', 'xb-'].join('')}1234567890-abcdef`), '[redacted]');
  assert.equal(redactString(`${PEM_BEGIN}\nMIIE\n-----END ${PEM_KIND}-----`), '[redacted]');
  assert.equal(redactString('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abcdefghijk'), '[redacted]');
  assert.equal(redactString('plain sentence about skis and ghosts'), 'plain sentence about skis and ghosts');
});

test('timestamps, refs, dates and binaries are converted to plain JSON', () => {
  const ts = { toDate: () => new Date('2026-01-02T03:04:05.000Z') };
  const out = redactValue({ a: ts, b: { _seconds: 1767323045, _nanoseconds: 0 }, c: new Date('2026-01-01T00:00:00Z'), d: { path: 'clients/x', collection() {} }, e: Buffer.from('hi'), f: null });
  assert.equal(out.a, '2026-01-02T03:04:05.000Z');
  assert.equal(out.b, '2026-01-02T03:04:05.000Z');
  assert.equal(out.c, '2026-01-01T00:00:00.000Z');
  assert.equal(out.d, 'ref:clients/x');
  assert.equal(out.e, '[binary]');
  assert.equal(out.f, null);
});

test('deny list: every named collection, at any depth, plus name patterns and mcp_ internals', () => {
  for (const c of DENY_COLLECTIONS) {
    assert.equal(isDeniedPath(`${c}/abc`), true, c);
    assert.equal(isDeniedPath(`clients/abc/${c}`), true, `sub ${c}`);
  }
  assert.equal(isDeniedPath('system_flags/x_oauth_tokens'), true);
  assert.equal(isDeniedPath('Users/abc'), true);
  assert.equal(isDeniedPath('clients/abc/oauth_things'), true);
  assert.equal(isDeniedPath('foo/bar_token_baz'), true);
  assert.equal(isDeniedPath('mcp_audit'), false);
  assert.equal(isDeniedPath('mcp_pending_actions'), true);
  assert.equal(isDeniedPath('mcp_whatever'), true);
  for (const ok of ['clients/abc', 'social_posts', 'dashboard_state/x', 'x_strategy_docs/x', 'clients/abc/client_brain', 'usage_events']) assert.equal(isDeniedPath(ok), false, ok);
  assert.equal(isDeniedCollectionName('credentials_v2'), true);
});

test('path parsing: traversal, empties, dunder and deep paths rejected', () => {
  for (const bad of ['', '/', '../x', 'a/../b', 'a//b', '__name__/x', 'a/b/c/d/e/f/g/h/i/j/k/l/m']) assert.throws(() => parsePath(bad), PathError, bad);
  assert.equal(parsePath('/clients/abc/').path, 'clients/abc');
  assert.equal(parsePath('clients/abc').isDocument, true);
  assert.equal(parsePath('clients').isDocument, false);
  assert.throws(() => assertReadablePath('users/u1'), (e) => e.status === 403);
});

test('capText truncates and says so', () => {
  const small = capText({ a: 1 }, 100);
  assert.equal(small.truncated, false);
  const big = capText({ s: 'x'.repeat(500) }, 100);
  assert.equal(big.truncated, true);
  assert.match(big.text, /truncated: \d+ chars total/);
});

// ---- query builder -----------------------------------------------------------------------------------------

const seeded = () => createFakeDb({
  'clients/c1': { name: 'One', apiKey: SK + 'shouldnotshow1234567890' },
  'social_posts/p1': { clientId: 'c1', status: 'draft', n: 1, token: 't' },
  'social_posts/p2': { clientId: 'c1', status: 'posted', n: 2 },
  'social_posts/p3': { clientId: 'c2', status: 'draft', n: 3 },
  'users/u1': { email: 'a@b.test' },
  'system_flags/x_oauth_tokens': { accessToken: 'secret' },
  'clients/c1/client_brain/current': { voice: 'calm', refreshToken: 'r' },
  'clients/c1/secrets_vault/s': { v: 1 },
});

test('query args: defaults, limit clamp, max 3 filters, bad shapes rejected', () => {
  assert.equal(normalizeQueryArgs({ collection: 'social_posts' }).limit, 50);
  assert.equal(normalizeQueryArgs({ collection: 'social_posts', limit: 9999 }).limit, 200);
  assert.equal(normalizeQueryArgs({ collection: 'social_posts', direction: 'desc', orderBy: 'n' }).direction, 'desc');
  const w = (n) => Array.from({ length: n }, (_, i) => ({ field: `f${i}`, value: 1 }));
  assert.equal(normalizeQueryArgs({ collection: 'social_posts', where: w(3) }).where.length, 3);
  assert.throws(() => normalizeQueryArgs({ collection: 'social_posts', where: w(4) }), ToolError);
  assert.throws(() => normalizeQueryArgs({ collection: 'clients/c1' }), /collection path/);
  assert.throws(() => normalizeQueryArgs({ collection: 'users' }), ToolError);
  assert.throws(() => normalizeQueryArgs({ collection: 'social_posts', where: [{ field: 'a b!', value: 1 }] }), ToolError);
  assert.throws(() => normalizeQueryArgs({ collection: 'social_posts', where: [{ field: 'a', value: { x: 1 } }] }), ToolError);
  assert.throws(() => normalizeQueryArgs({ collection: 'social_posts', limit: 0 }), ToolError);
  assert.throws(() => normalizeQueryArgs({ collection: 'social_posts', startAfter: 'a/b' }), ToolError);
});

test('runQuery: filters, ordering, paging, redaction', async () => {
  const db = seeded();
  const r = await runQuery(db, { collection: 'social_posts', where: [{ field: 'clientId', value: 'c1' }], orderBy: 'n', direction: 'asc', limit: 1 });
  assert.equal(r.count, 1);
  assert.equal(r.hasMore, true);
  assert.equal(r.documents[0].id, 'p1');
  assert.equal(r.documents[0].data.token, '[redacted]');
  const page2 = await runQuery(db, { collection: 'social_posts', where: [{ field: 'clientId', value: 'c1' }], orderBy: 'n', limit: 1, startAfter: r.nextStartAfter });
  assert.equal(page2.documents[0].id, 'p2');
  assert.equal(page2.hasMore, false);
  await assert.rejects(runQuery(db, { collection: 'social_posts', startAfter: 'missing' }), ToolError);
  await assert.rejects(runQuery(db, { collection: 'system_flags' }), ToolError);
});

test('get_document: redacts, lists only readable subcollections, refuses denied paths and collections', async () => {
  const db = seeded();
  const r = await runGetDocument(db, 'clients/c1');
  assert.equal(r.data.apiKey, '[redacted]');
  assert.deepEqual(r.subcollections, ['client_brain']); // secrets_vault hidden
  const sub = await runGetDocument(db, 'clients/c1/client_brain/current');
  assert.equal(sub.data.refreshToken, '[redacted]');
  assert.equal(sub.data.voice, 'calm');
  assert.equal((await runGetDocument(db, 'clients/none')).exists, false);
  await assert.rejects(runGetDocument(db, 'users/u1'), ToolError);
  await assert.rejects(runGetDocument(db, 'system_flags/x_oauth_tokens'), ToolError);
  await assert.rejects(runGetDocument(db, 'clients'), /document path/);
});

test('list_collections hides denied collections and counts the rest', async () => {
  const r = await runListCollections(seeded());
  const names = r.collections.map((c) => c.name);
  assert.deepEqual(names, ['clients', 'social_posts']);
  assert.equal(r.collections.find((c) => c.name === 'social_posts').count, 3);
});

test('redaction: extended key names (appKey, consumerKey, oauth, jwt, webhook, verifier, signature, dsn); numbers/booleans still pass', () => {
  const out = redactValue({
    appKey: 'a', app_key: 'a', consumerKey: 'c', consumer_secret: 'x', oauthState: 'o', oauth: { a: 1 }, jwt: 'j', webhookUrl: 'https://hooks.example/abc', webhookSecretOk: true,
    codeVerifier: 'v', signature: 's', sentryDsn: 'https://k@o.ingest.sentry.io/1', inputTokens: 5, dsnCount: 3, name: 'fine',
  });
  for (const k of ['appKey', 'app_key', 'consumerKey', 'consumer_secret', 'oauthState', 'jwt', 'webhookUrl', 'codeVerifier', 'signature', 'sentryDsn']) assert.equal(out[k], '[redacted]', k);
  assert.equal(out.oauth, '[redacted]');
  assert.equal(out.webhookSecretOk, true, 'booleans pass');
  assert.equal(out.inputTokens, 5);
  assert.equal(out.dsnCount, 3);
  assert.equal(out.name, 'fine');
  assert.ok(REDACT_KEY_RE.test('appKey') && REDACT_KEY_RE.test('verifier'));
});

test('redaction: extended value patterns (Stripe, Resend, Telegram bot, Google refresh)', () => {
  assert.equal(redactString(`key ${SKL}51Abcdefghijklmnop end`), 'key [redacted] end');
  assert.equal(redactString(`${SKT}4eC39HqLyjWDarjtT1zdp7dc`), '[redacted]');
  assert.equal(redactString(`${RKL}abcdefghijklmnop12`), '[redacted]');
  assert.equal(redactString(`send with ${RE}AbCdEf1234567890 now`), 'send with [redacted] now');
  assert.equal(redactString(`bot 123456789${COLON}AAH-abcdefghijklmnopqrstuvwxyz012345 ok`), 'bot [redacted] ok');
  assert.equal(redactString(`refresh ${G1}0gAbCdEfGhIjKlMnOpQrStUvWxYz-_12 end`), 'refresh [redacted] end');
  // look-alikes that must survive
  assert.equal(redactString('re_short and there_are_words'), 're_short and there_are_words');
  assert.equal(redactString('ratio 12345:6 and 1/2 and https://x.test//path'), 'ratio 12345:6 and 1/2 and https://x.test//path');
  assert.equal(redactString(`ta${SKL}stuff and sk_like`), `ta${SKL}stuff and sk_like`);
  // values nested in otherwise innocent keys
  assert.equal(redactValue({ note: `use ${SKL}51Abcdefghijklmnop` }).note, 'use [redacted]');
});

test('PII collections and the clients/<id>/members subcollection are denied; other subcollections are not', () => {
  for (const c of ['records_waitlist', 'digest_deliveries', 'leadgen_prospects', 'telegram_updates']) {
    assert.ok(DENY_COLLECTIONS.includes(c), c);
    assert.equal(isDeniedPath(`${c}/x`), true, c);
    assert.equal(isDeniedPath(c), true, c);
    assert.equal(isDeniedCollectionName(c), true, c);
  }
  assert.equal(isDeniedPath('clients/abc/members'), true);
  assert.equal(isDeniedPath('clients/abc/members/m1'), true);
  assert.equal(isDeniedPath('Clients/abc/Members/m1'), true);
  assert.equal(isDeniedPath('clients/abc/client_brain/current'), false);
  assert.equal(isDeniedPath('members/abc'), false, 'only under clients');
  assert.equal(isDeniedPath('projects/p/members/m1'), false);
  assert.equal(isDeniedSubcollection('members', 'clients'), true);
  assert.equal(isDeniedSubcollection('members', 'projects'), false);
  assert.throws(() => assertReadablePath('clients/abc/members'), (e) => e.status === 403);
});

test('query args: where/orderBy on credential-looking fields are rejected', () => {
  for (const field of ['accessToken', 'user.refreshToken', 'apiKey', 'appKey', 'webhook', 'signature', 'oauthState', 'jwt']) {
    assert.throws(() => normalizeQueryArgs({ collection: 'social_posts', where: [{ field, value: 'x' }] }), ToolError, field);
    assert.throws(() => normalizeQueryArgs({ collection: 'social_posts', orderBy: field }), ToolError, field);
  }
  assert.doesNotThrow(() => normalizeQueryArgs({ collection: 'social_posts', where: [{ field: 'metadata.kind', value: 'x' }], orderBy: 'createdAt' }));
});
